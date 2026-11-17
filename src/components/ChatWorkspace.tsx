import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  Camera,
  Check,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  LogOut,
  MapPin,
  Menu,
  Mic,
  Moon,
  Paperclip,
  Send,
  ShieldCheck,
  Smile,
  Sun,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import { decryptPayload, encryptPayload } from '../lib/crypto';
import {
  getAudioDurationFromDataUrl,
  playBlueTickFeedback,
  playHighPriorityAlertChime,
  playReceiveAlertFeedback,
  playSendFeedback,
  readFileAsDataUrl,
  showBrowserNotificationBar,
  urlBase64ToUint8Array,
} from '../lib/device';
import { formatBytes, formatDuration, scrubAndCompressImage } from '../lib/media';
import { RelayRoomConnection } from '../lib/relay';
import { buildMeetingInviteUrl } from '../lib/session';
import type {
  ChatMessage,
  ConnectionState,
  DecryptedMessagePayload,
  DeletedArchiveEntry,
  DisappearingOption,
  EncryptedMessageEnvelope,
  ReplyPreview,
  SpaceSession,
} from '../types';
import {
  AttachmentMenuPopover,
  ContactShareModal,
  LocationShareModal,
} from './AttachmentMenus';
import { CameraModal } from './CameraModal';
import { MessageBubble } from './MessageBubble';
import { PWAInstallButton } from './PWAInstallButton';
import {
  CipherInspectorModal,
  DeleteMessageModal,
  ImageLightbox,
  PrivacyLockScreen,
  SafetyNumberModal,
} from './PrivacyModals';
import { type StickerItem, StickerPicker } from './Stickers';
import { type RecordedVoiceNote, VoiceRecorder } from './VoiceRecorder';

interface ChatWorkspaceProps {
  session: SpaceSession;
  initialEnvelopes: EncryptedMessageEnvelope[];
  isNewSpace: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  onLeaveSpace: () => void;
}

const DISAPPEAR_OPTIONS: { label: string; value: DisappearingOption }[] = [
  { label: 'Off', value: 0 },
  { label: '30s', value: 30_000 },
  { label: '5m', value: 300_000 },
  { label: '1h', value: 3_600_000 },
  { label: '24h', value: 86_400_000 },
];

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  session,
  initialEnvelopes,
  isNewSpace,
  isDark,
  onToggleTheme,
  onLeaveSpace,
}) => {
  const archiveStorageKey = `veil_deleted_archive_${session.roomId}`;

  const [deletedArchive, setDeletedArchive] = useState<Record<string, DeletedArchiveEntry>>(() => {
    try {
      const raw = localStorage.getItem(archiveStorageKey);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, DeletedArchiveEntry>;
    } catch {
      return {};
    }
  });

  const [rawEnvelopes, setRawEnvelopes] = useState<EncryptedMessageEnvelope[]>(initialEnvelopes);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [activeDevices, setActiveDevices] = useState(1);
  const [partnerTyping, setPartnerTyping] = useState(false);

  const [textInput, setTextInput] = useState('');
  const [disappearMs, setDisappearMs] = useState<DisappearingOption>(0);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [stagedImage, setStagedImage] = useState<{
    dataUrl: string;
    width: number;
    height: number;
    name: string;
    scrubbedSize: number;
  } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const [vaultTab, setVaultTab] = useState<'all' | 'photos' | 'voice'>('all');
  const [revealAllDeleted, setRevealAllDeleted] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Floating composer menus & modals
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [locationModalMode, setLocationModalMode] = useState<'share' | 'inspect' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);

  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [inspectedMessage, setInspectedMessage] = useState<ChatMessage | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; caption?: string } | null>(
    null
  );

  // Lock & High-Priority Notification state
  const [isLocked, setIsLocked] = useState(false);
  const [autoLockOnHide, setAutoLockOnHide] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('veil_alerts_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );
  const [pushStatusText, setPushStatusText] = useState<string | null>(null);
  const [dismissedPushPrompt, setDismissedPushPrompt] = useState(false);
  const [pendingAlertWhileLocked, setPendingAlertWhileLocked] = useState(false);
  const [foregroundBanner, setForegroundBanner] = useState<{
    title: string;
    detail: string;
  } | null>(null);

  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [copiedInviteInline, setCopiedInviteInline] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const relayRef = useRef<RelayRoomConnection | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingEmitRef = useRef(0);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isLockedRef = useRef(isLocked);
  const alertsEnabledRef = useRef(alertsEnabled);

  const showScreenAlert = useCallback((title: string, detail: string) => {
    if (isLockedRef.current) return;
    setForegroundBanner({ title, detail });
    setTimeout(() => {
      setForegroundBanner((prev) =>
        prev && prev.title === title && prev.detail === detail ? null : prev
      );
    }, 4000);
  }, []);

  useEffect(() => {
    isLockedRef.current = isLocked;
    if (!isLocked && pendingAlertWhileLocked) {
      // Only trigger alert chime/banner AFTER user unlocks the screen
      setPendingAlertWhileLocked(false);
      if (alertsEnabledRef.current) {
        playReceiveAlertFeedback();
      }
      showScreenAlert(
        'Encrypted Activity',
        'New message received while your screen was locked.'
      );
    }
  }, [isLocked, pendingAlertWhileLocked, showScreenAlert]);

  useEffect(() => {
    alertsEnabledRef.current = alertsEnabled;
  }, [alertsEnabled]);

  const persistArchive = useCallback(
    (next: Record<string, DeletedArchiveEntry>) => {
      setDeletedArchive(next);
      try {
        localStorage.setItem(archiveStorageKey, JSON.stringify(next));
      } catch {
        // Ignore quota exceeded
      }
    },
    [archiveStorageKey]
  );

  // Build hydrated ChatMessage list from rawEnvelopes + local deletedArchive
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const mergedMap = new Map<string, EncryptedMessageEnvelope>();
      for (const env of rawEnvelopes) {
        mergedMap.set(env.id, env);
      }

      // Include locally "deleted for me" entries that might still be on server or only in archive
      for (const arch of Object.values(deletedArchive)) {
        if (!mergedMap.has(arch.id)) {
          mergedMap.set(arch.id, {
            id: arch.id,
            iv: arch.iv,
            ciphertext: arch.ciphertext,
            timestamp: arch.timestamp,
            expiresAt: null,
            deletedForEveryone: arch.scope === 'everyone',
          });
        }
      }

      const hydrated = await Promise.all(
        Array.from(mergedMap.values()).map(async (env): Promise<ChatMessage> => {
          const archived = deletedArchive[env.id];

          if (env.deletedForEveryone || archived) {
            let archivedPayload: DecryptedMessagePayload | null = null;
            if (archived && archived.iv && archived.ciphertext) {
              try {
                archivedPayload = await decryptPayload(
                  session.aesKey,
                  archived.iv,
                  archived.ciphertext
                );
              } catch {
                archivedPayload = null;
              }
            }

            const scope: 'me' | 'everyone' = env.deletedForEveryone
              ? 'everyone'
              : archived?.scope || 'me';

            const deletedByMe =
              env.deletedByClientId === session.clientId || Boolean(archived);

            return {
              id: env.id,
              envelope: env,
              payload: null,
              decryptError: false,
              isMine: archivedPayload
                ? archivedPayload.senderClientId === session.clientId
                : env.deletedByClientId === session.clientId,
              expiresAt: env.expiresAt,
              deletedScope: scope,
              deletedByMe,
              archivedPayload,
            };
          }

          try {
            const payload = await decryptPayload(session.aesKey, env.iv, env.ciphertext);
            return {
              id: env.id,
              envelope: env,
              payload,
              decryptError: false,
              isMine: payload.senderClientId === session.clientId,
              expiresAt: env.expiresAt,
              receiptStatus: env.receiptStatus || 'sent',
            };
          } catch {
            return {
              id: env.id,
              envelope: env,
              payload: null,
              decryptError: true,
              isMine: false,
              expiresAt: env.expiresAt,
            };
          }
        })
      );

      if (cancelled) return;
      hydrated.sort((a, b) => a.envelope.timestamp - b.envelope.timestamp);
      setMessages(hydrated);
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [rawEnvelopes, deletedArchive, session.aesKey, session.clientId]);

  const hasExpiringMessages = useMemo(
    () => messages.some((m) => m.expiresAt !== null),
    [messages]
  );

  useEffect(() => {
    if (!hasExpiringMessages) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      setRawEnvelopes((prev) =>
        prev.filter((m) => m.expiresAt === null || m.expiresAt > now)
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [hasExpiringMessages]);

  useEffect(() => {
    if (!autoLockOnHide) return;
    const handleVisibility = () => {
      if (document.hidden) {
        setIsLocked(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [autoLockOnHide]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setIsLocked(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const triggerUnlockedAlert = useCallback(
    async (senderClientId?: string, senderAlias?: string) => {
      if (senderClientId === session.clientId) return;
      if (isLockedRef.current) {
        // Do NOT show any notification, preview, or sound while locked!
        setPendingAlertWhileLocked(true);
        return;
      }

      if (alertsEnabledRef.current) {
        playReceiveAlertFeedback();
        showScreenAlert(
          senderAlias ? `New message from ${senderAlias}` : 'New Encrypted Message',
          'Decrypted inside your private space'
        );

        await showBrowserNotificationBar(
          'Internet Edge',
          'New encrypted activity · Open & unlock to view'
        );
      }
    },
    [session.clientId, showScreenAlert]
  );

  // Automatically send read receipts for partner messages when unlocked & visible
  const markPartnerMessagesAsRead = useCallback(() => {
    if (isLockedRef.current || document.visibilityState !== 'visible') return;
    const unreadIds = messages
      .filter((m) => !m.isMine && !m.deletedScope && m.receiptStatus !== 'read')
      .map((m) => m.id);

    if (unreadIds.length === 0) return;

    if (session.transport === 'relay') {
      void relayRef.current?.sendReceipt(unreadIds, 'read');
      return;
    }

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'receipt:read', messageIds: unreadIds }));
  }, [messages, session.transport]);

  useEffect(() => {
    markPartnerMessagesAsRead();
  }, [markPartnerMessagesAsRead, isLocked]);

  useEffect(() => {
    const handleFocusOrVis = () => markPartnerMessagesAsRead();
    window.addEventListener('focus', handleFocusOrVis);
    document.addEventListener('visibilitychange', handleFocusOrVis);
    return () => {
      window.removeEventListener('focus', handleFocusOrVis);
      document.removeEventListener('visibilitychange', handleFocusOrVis);
    };
  }, [markPartnerMessagesAsRead]);

  // Real-time connection (Express WebSocket or Serverless Relay fallback)
  useEffect(() => {
    let unmounted = false;

    const handleIncomingMessageCreated = async (
      incomingEnv: EncryptedMessageEnvelope,
      ackReceipt: (status: 'delivered' | 'read') => void
    ) => {
      let isFromMe = incomingEnv.senderClientId === session.clientId;
      let senderAlias: string | undefined;
      try {
        const p = await decryptPayload(
          session.aesKey,
          incomingEnv.iv,
          incomingEnv.ciphertext
        );
        isFromMe = p.senderClientId === session.clientId;
        senderAlias = p.senderAlias;
      } catch {
        // Ignore
      }

      if (unmounted) return;

      setRawEnvelopes((prev) => {
        if (prev.some((m) => m.id === incomingEnv.id)) {
          return prev.map((m) =>
            m.id === incomingEnv.id
              ? { ...m, receiptStatus: incomingEnv.receiptStatus || m.receiptStatus }
              : m
          );
        }
        return [...prev, incomingEnv];
      });

      if (!isFromMe) {
        const status =
          isLockedRef.current || document.visibilityState !== 'visible'
            ? 'delivered'
            : 'read';
        ackReceipt(status);
        triggerUnlockedAlert(incomingEnv.senderClientId, senderAlias);
      }
    };

    const handleReceiptUpdated = (
      messageIds: string[],
      nextStatus: 'delivered' | 'read'
    ) => {
      const idSet = new Set(messageIds);
      let newlyBlueTicked = false;

      setRawEnvelopes((prev) =>
        prev.map((m) => {
          if (!idSet.has(m.id)) return m;
          const isMine = m.senderClientId === session.clientId;
          if (isMine && nextStatus === 'read' && m.receiptStatus !== 'read') {
            newlyBlueTicked = true;
          }
          return { ...m, receiptStatus: nextStatus };
        })
      );

      if (newlyBlueTicked && alertsEnabledRef.current && !isLockedRef.current) {
        playBlueTickFeedback();
        showScreenAlert(
          'Blue Tick · Read by Partner',
          'Your partner opened and read your encrypted message'
        );
        void showBrowserNotificationBar(
          'Internet Edge · Blue Tick',
          'Your partner read your encrypted message',
          'veil-blue-tick'
        );
      }
    };

    if (session.transport === 'relay') {
      const relay = new RelayRoomConnection(
        session.roomId,
        session.gateHash,
        session.clientId,
        {
          onConnectionChange: (state) => {
            if (!unmounted) setConnectionState(state);
          },
          onRoomSynced: (msgs) => {
            if (!unmounted) setRawEnvelopes(msgs);
          },
          onMessageCreated: (msg) => {
            void handleIncomingMessageCreated(msg, (status) => {
              void relay.sendReceipt([msg.id], status);
            });
          },
          onReceiptUpdated: (ids, status) => {
            if (!unmounted) handleReceiptUpdated(ids, status);
          },
          onMessageSoftDeleted: (messageId, deletedByClientId) => {
            if (unmounted) return;
            setRawEnvelopes((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      deletedForEveryone: true,
                      deletedByClientId,
                      iv: '',
                      ciphertext: '',
                    }
                  : m
              )
            );
          },
          onMessageDeleted: (messageId) => {
            if (!unmounted) {
              setRawEnvelopes((prev) => prev.filter((m) => m.id !== messageId));
            }
          },
          onMessagesExpired: (expiredIds) => {
            if (unmounted) return;
            const expiredSet = new Set(expiredIds);
            setRawEnvelopes((prev) => prev.filter((m) => !expiredSet.has(m.id)));
          },
          onRoomCleared: () => {
            if (!unmounted) setRawEnvelopes([]);
          },
          onPresenceUpdate: (activeCount, online) => {
            if (unmounted) return;
            setActiveDevices(activeCount);
            setPartnerOnline(online);
          },
          onPartnerTyping: (isTyping) => {
            if (unmounted) return;
            setPartnerTyping(isTyping);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            if (isTyping) {
              typingTimeoutRef.current = setTimeout(() => {
                setPartnerTyping(false);
              }, 3500);
            }
          },
        }
      );
      relayRef.current = relay;

      return () => {
        unmounted = true;
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        relay.close();
        relayRef.current = null;
      };
    }

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) return;
        reconnectAttemptRef.current = 0;
        setConnectionState('connected');
        ws.send(
          JSON.stringify({
            type: 'room:subscribe',
            roomId: session.roomId,
            gateHash: session.gateHash,
            clientId: session.clientId,
          })
        );
      };

      ws.onmessage = async (event) => {
        if (unmounted) return;
        try {
          const data = JSON.parse(event.data as string) as {
            type?: string;
            messages?: EncryptedMessageEnvelope[];
            message?: EncryptedMessageEnvelope;
            messageId?: string;
            deletedByClientId?: string;
            messageIds?: string[];
            status?: 'delivered' | 'read';
            activeCount?: number;
            partnerOnline?: boolean;
            isTyping?: boolean;
          };

          if (data.type === 'room:synced' && Array.isArray(data.messages)) {
            setRawEnvelopes(data.messages);
            return;
          }

          if (data.type === 'message:created' && data.message) {
            const incomingEnv = data.message;
            await handleIncomingMessageCreated(incomingEnv, (status) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: status === 'delivered' ? 'receipt:delivered' : 'receipt:read',
                    messageIds: [incomingEnv.id],
                  })
                );
              }
            });
            return;
          }

          if (data.type === 'receipt:updated' && Array.isArray(data.messageIds) && data.status) {
            handleReceiptUpdated(data.messageIds, data.status);
            return;
          }

          if (data.type === 'message:soft-deleted' && data.messageId) {
            setRawEnvelopes((prev) =>
              prev.map((m) =>
                m.id === data.messageId
                  ? {
                      ...m,
                      deletedForEveryone: true,
                      deletedByClientId: data.deletedByClientId,
                      iv: '',
                      ciphertext: '',
                    }
                  : m
              )
            );
            return;
          }

          if (data.type === 'message:deleted' && data.messageId) {
            setRawEnvelopes((prev) => prev.filter((m) => m.id !== data.messageId));
            return;
          }

          if (data.type === 'messages:expired' && Array.isArray(data.messageIds)) {
            const expiredSet = new Set(data.messageIds);
            setRawEnvelopes((prev) => prev.filter((m) => !expiredSet.has(m.id)));
            return;
          }

          if (data.type === 'room:cleared') {
            setRawEnvelopes([]);
            return;
          }

          if (data.type === 'presence:update') {
            setActiveDevices(data.activeCount ?? 1);
            setPartnerOnline(Boolean(data.partnerOnline));
            return;
          }

          if (data.type === 'partner:typing') {
            setPartnerTyping(Boolean(data.isTyping));
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            if (data.isTyping) {
              typingTimeoutRef.current = setTimeout(() => {
                setPartnerTyping(false);
              }, 3500);
            }
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setConnectionState('reconnecting');
        const delay = Math.min(8000, 800 * Math.pow(1.6, reconnectAttemptRef.current));
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [
    session.roomId,
    session.gateHash,
    session.clientId,
    session.aesKey,
    session.transport,
    showScreenAlert,
    triggerUnlockedAlert,
  ]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, partnerTyping]);

  const registerWebPushSubscription = useCallback(async (): Promise<boolean> => {
    if (session.transport === 'relay') {
      return false;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return false;
    }
    try {
      const keyRes = await fetch('/api/push/vapid-public-key', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!keyRes.ok) return false;
      const contentType = keyRes.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return false;
      const { publicKey } = (await keyRes.json()) as { publicKey: string };
      const reg = await navigator.serviceWorker.ready;
      const existingSub = await reg.pushManager.getSubscription();
      const subscription =
        existingSub ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      await fetch(`/api/rooms/${session.roomId}/push-subscribe`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-gate-hash': session.gateHash,
        },
        body: JSON.stringify({
          clientId: session.clientId,
          subscription: subscription.toJSON(),
        }),
      });
      return true;
    } catch {
      return false;
    }
  }, [session.roomId, session.gateHash, session.clientId, session.transport]);

  useEffect(() => {
    if (alertsEnabled && notificationPermission === 'granted') {
      void registerWebPushSubscription();
    }
  }, [alertsEnabled, notificationPermission, registerWebPushSubscription]);

  // Enable / disable High-Priority Web Push notifications (works even when browser is closed)
  const handleToggleHighPriorityAlerts = async () => {
    setPushStatusText(null);
    const currentPerm =
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'unsupported';
    setNotificationPermission(currentPerm);

    // If alerts are enabled and OS notification bar permission is already granted (or unsupported),
    // clicking again turns alerts off. If permission is still 'default', request permission first!
    if (alertsEnabled && (currentPerm === 'granted' || currentPerm === 'unsupported')) {
      setAlertsEnabled(false);
      localStorage.setItem('veil_alerts_enabled', 'false');
      if (session.transport !== 'relay') {
        try {
          await fetch(`/api/rooms/${session.roomId}/push-subscribe`, {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: {
              'x-gate-hash': session.gateHash,
              'x-client-id': session.clientId,
            },
          });
        } catch {
          // Ignore
        }
      }
      return;
    }

    if (!('Notification' in window)) {
      setAlertsEnabled(true);
      localStorage.setItem('veil_alerts_enabled', 'true');
      playHighPriorityAlertChime();
      showScreenAlert('In-App Alerts Active', 'Sound & vibration alerts enabled');
      setPushStatusText('In-app sound & screen alerts active (OS notifications unsupported).');
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== 'granted') {
      setAlertsEnabled(true);
      localStorage.setItem('veil_alerts_enabled', 'true');
      playHighPriorityAlertChime();
      showScreenAlert(
        'In-App Alerts Active',
        'Allow notifications in browser settings for top-bar alerts'
      );
      setPushStatusText('In-app alerts on. Enable Notifications in browser settings for bar alerts.');
      return;
    }

    setAlertsEnabled(true);
    localStorage.setItem('veil_alerts_enabled', 'true');
    playHighPriorityAlertChime();
    showScreenAlert('High-Priority Alerts Active', 'Screen & notification bar alerts enabled');
    await showBrowserNotificationBar(
      'Internet Edge',
      'High-priority encrypted alerts are active',
      'veil-alerts-ready'
    );

    const pushOk = await registerWebPushSubscription();
    if (pushOk) {
      setPushStatusText('High-priority background push & notification bar alerts active.');
    } else {
      setPushStatusText('Screen & notification bar alerts active.');
    }
  };

  const emitTyping = (isTyping: boolean) => {
    const now = Date.now();
    if (isTyping && now - lastTypingEmitRef.current < 1500) return;
    lastTypingEmitRef.current = now;
    if (session.transport === 'relay') {
      void relayRef.current?.sendTyping(isTyping);
      return;
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'typing', isTyping }));
  };

  const buildReplyPreview = (): ReplyPreview | undefined => {
    if (!replyTarget || !replyTarget.payload) return undefined;
    const p = replyTarget.payload;
    const snippet =
      p.kind === 'image'
        ? p.text || 'Encrypted photo'
        : p.kind === 'video'
          ? p.text || 'Encrypted video'
          : p.kind === 'voice'
            ? `Audio (${formatDuration(p.audioDuration || 1)})`
            : p.kind === 'document'
              ? p.docName || 'Document'
              : p.kind === 'contact'
                ? `Contact: ${p.contactName}`
                : p.kind === 'location'
                  ? p.locationLabel || 'Shared Location'
                  : p.kind === 'sticker'
                    ? `Sticker: ${p.stickerLabel || 'Sticker'}`
                    : p.text || '';
    return {
      id: replyTarget.id,
      senderAlias: p.senderAlias,
      kind: p.kind,
      snippet: snippet.slice(0, 80),
    };
  };

  const sendEncryptedMessage = async (
    payloadWithoutMeta: Omit<
      DecryptedMessagePayload,
      'senderClientId' | 'senderAlias' | 'createdAt' | 'replyTo'
    >
  ) => {
    const createdAt = Date.now();
    const id = crypto.randomUUID();
    const fullPayload: DecryptedMessagePayload = {
      ...payloadWithoutMeta,
      senderClientId: session.clientId,
      senderAlias: session.alias,
      replyTo: buildReplyPreview(),
      createdAt,
    };

    const { iv, ciphertext } = await encryptPayload(session.aesKey, fullPayload);
    const expiresAt = disappearMs > 0 ? createdAt + disappearMs : null;

    const envelope: EncryptedMessageEnvelope = {
      id,
      iv,
      ciphertext,
      timestamp: createdAt,
      expiresAt,
      senderClientId: session.clientId,
      receiptStatus: partnerOnline ? 'delivered' : 'sent',
    };

    setRawEnvelopes((prev) => [...prev, envelope]);
    setReplyTarget(null);
    emitTyping(false);

    if (alertsEnabledRef.current) {
      playSendFeedback();
      showScreenAlert(
        'Encrypted Message Sent',
        partnerOnline ? 'Delivered to partner device' : 'Stored encrypted in vault'
      );
      showBrowserNotificationBar(
        'Internet Edge',
        'Encrypted message sent'
      );
    }

    if (session.transport === 'relay') {
      await relayRef.current?.sendMessage(envelope);
      return;
    }

    try {
      const res = await fetch(`/api/rooms/${session.roomId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gate-hash': session.gateHash,
          'x-client-id': session.clientId,
        },
        body: JSON.stringify(envelope),
      });
      if (!res.ok) {
        throw new Error('Failed to deliver encrypted message');
      }
      const saved = (await res.json()) as { message?: EncryptedMessageEnvelope };
      if (saved.message?.receiptStatus) {
        setRawEnvelopes((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, receiptStatus: saved.message!.receiptStatus } : m
          )
        );
      }
    } catch {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'message:send', message: envelope }));
      }
    }
  };

  const handleSendTextOrImage = async () => {
    const trimmed = textInput.trim();
    if (stagedImage) {
      const img = stagedImage;
      setStagedImage(null);
      setTextInput('');
      await sendEncryptedMessage({
        kind: 'image',
        imageDataUrl: img.dataUrl,
        imageWidth: img.width,
        imageHeight: img.height,
        imageName: img.name,
        text: trimmed || undefined,
      });
      return;
    }

    if (!trimmed) return;
    setTextInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    await sendEncryptedMessage({
      kind: 'text',
      text: trimmed,
    });
  };

  const handleSendVoice = async (voice: RecordedVoiceNote) => {
    setIsRecordingVoice(false);
    await sendEncryptedMessage({
      kind: 'voice',
      audioDataUrl: voice.audioDataUrl,
      audioDuration: voice.durationSec,
      waveform: voice.waveform,
    });
  };

  const handleSendSticker = async (sticker: StickerItem) => {
    setShowStickerPicker(false);
    await sendEncryptedMessage({
      kind: 'sticker',
      stickerId: sticker.id,
      stickerLabel: sticker.label,
    });
  };

  // Delete for me OR Delete for everyone (preserving encrypted local archive so user can still Show it)
  const handleDeleteForMe = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    const entry: DeletedArchiveEntry = {
      id: target.id,
      scope: 'me',
      deletedAt: Date.now(),
      iv: target.envelope.iv,
      ciphertext: target.envelope.ciphertext,
      timestamp: target.envelope.timestamp,
    };

    persistArchive({ ...deletedArchive, [target.id]: entry });
  };

  const handleDeleteForEveryone = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    if (target.envelope.iv && target.envelope.ciphertext) {
      const entry: DeletedArchiveEntry = {
        id: target.id,
        scope: 'everyone',
        deletedAt: Date.now(),
        iv: target.envelope.iv,
        ciphertext: target.envelope.ciphertext,
        timestamp: target.envelope.timestamp,
      };
      persistArchive({ ...deletedArchive, [target.id]: entry });
    }

    setRawEnvelopes((prev) =>
      prev.map((m) =>
        m.id === target.id
          ? {
              ...m,
              deletedForEveryone: true,
              deletedByClientId: session.clientId,
              iv: '',
              ciphertext: '',
            }
          : m
      )
    );

    if (session.transport === 'relay') {
      await relayRef.current?.softDeleteMessage(target.id);
      return;
    }

    try {
      await fetch(`/api/rooms/${session.roomId}/messages/${target.id}/soft-delete`, {
        method: 'POST',
        headers: {
          'x-gate-hash': session.gateHash,
          'x-client-id': session.clientId,
        },
      });
    } catch {
      // Ignored
    }
  };

  const handlePurgeDeleted = async (messageId: string) => {
    const next = { ...deletedArchive };
    delete next[messageId];
    persistArchive(next);
    setRawEnvelopes((prev) => prev.filter((m) => m.id !== messageId));
    if (session.transport === 'relay') {
      await relayRef.current?.deleteMessage(messageId);
      return;
    }
    try {
      await fetch(`/api/rooms/${session.roomId}/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'x-gate-hash': session.gateHash },
      });
    } catch {
      // Ignore
    }
  };

  const handleClearVault = async () => {
    setRawEnvelopes([]);
    persistArchive({});
    setConfirmClearAll(false);
    if (session.transport === 'relay') {
      await relayRef.current?.clearRoom();
      return;
    }
    await fetch(`/api/rooms/${session.roomId}/messages`, {
      method: 'DELETE',
      headers: { 'x-gate-hash': session.gateHash },
    });
  };

  const handleSelectImageOrVideoFile = async (file: File) => {
    setMediaError(null);
    if (file.type.startsWith('video/')) {
      try {
        const dataUrl = await readFileAsDataUrl(file, 16 * 1024 * 1024);
        await sendEncryptedMessage({
          kind: 'video',
          videoDataUrl: dataUrl,
          videoMime: file.type,
          videoName: file.name,
          videoSize: file.size,
        });
      } catch (err) {
        setMediaError(err instanceof Error ? err.message : 'Unable to attach video.');
      }
      return;
    }

    try {
      const scrubbed = await scrubAndCompressImage(file);
      setStagedImage({
        dataUrl: scrubbed.dataUrl,
        width: scrubbed.width,
        height: scrubbed.height,
        name: file.name,
        scrubbedSize: scrubbed.scrubbedSize,
      });
    } catch (err) {
      setMediaError(
        err instanceof Error ? err.message : 'Unable to process selected photo.'
      );
    }
  };

  const handleSelectDocumentFile = async (file: File) => {
    setMediaError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file, 15 * 1024 * 1024);
      await sendEncryptedMessage({
        kind: 'document',
        docDataUrl: dataUrl,
        docName: file.name,
        docMime: file.type || 'application/octet-stream',
        docSize: file.size,
      });
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Unable to attach document.');
    }
  };

  const handleSelectAudioFile = async (file: File) => {
    setMediaError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file, 15 * 1024 * 1024);
      const duration = await getAudioDurationFromDataUrl(dataUrl);
      await sendEncryptedMessage({
        kind: 'voice',
        audioDataUrl: dataUrl,
        audioDuration: duration,
        audioName: file.name,
        waveform: [0.35, 0.65, 0.5, 0.85, 0.7, 0.45, 0.9, 0.6, 0.4, 0.75, 0.55, 0.8, 0.5, 0.65, 0.4, 0.7],
      });
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Unable to attach audio.');
    }
  };

  const handleCopyInviteInline = async () => {
    const inviteUrl = buildMeetingInviteUrl(session.normalizedName, session.passphrase);
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedInviteInline(true);
      showScreenAlert(
        'Meeting Link Copied',
        'Reusable even after exit or browser restart'
      );
      setTimeout(() => setCopiedInviteInline(false), 2000);
    } catch {
      // Ignore
    }
  };

  const photoMessages = useMemo(
    () => messages.filter((m) => !m.deletedScope && m.payload?.kind === 'image' && m.payload.imageDataUrl),
    [messages]
  );

  const voiceMessages = useMemo(
    () => messages.filter((m) => !m.deletedScope && m.payload?.kind === 'voice' && m.payload.audioDataUrl),
    [messages]
  );

  const deletedRecoverableCount = useMemo(
    () => messages.filter((m) => m.deletedScope && m.archivedPayload).length,
    [messages]
  );

  const filteredMessages = useMemo(() => {
    if (vaultTab === 'photos') return photoMessages;
    if (vaultTab === 'voice') return voiceMessages;
    return messages;
  }, [messages, photoMessages, voiceMessages, vaultTab]);

  const SidebarContent = (
    <div className="h-full flex flex-col bg-[#F8F9FB] dark:bg-[#0F131C]">
      <div className="p-5 border-b border-slate-200/80 dark:border-slate-800/80 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-[#2C6BED] text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {session.normalizedName}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Signed in as {session.alias}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileDrawerOpen(false)}
            aria-label="Close space drawer"
            className="lg:hidden min-h-[40px] min-w-[40px] rounded-lg text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
          <span>
            {partnerOnline
              ? `Partner active · ${activeDevices} connected`
              : 'Waiting for partner'}
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            {connectionState === 'connected' ? 'Synced' : 'Reconnecting'}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopyInviteInline}
          className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-white dark:bg-[#171D29] border border-slate-200 dark:border-slate-800 hover:border-[#2C6BED]/50 text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center justify-center gap-2 transition-colors"
        >
          {copiedInviteInline ? (
            <Check className="w-3.5 h-3.5 text-[#2C6BED]" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-[#2C6BED]" />
          )}
          <span>
            {copiedInviteInline ? 'Invite Link Copied' : 'Copy Partner Invite Link'}
          </span>
        </button>

        <PWAInstallButton />
      </div>

      {/* Interactive Filter Tabs */}
      <div className="p-4 border-b border-slate-200/80 dark:border-slate-800/80 space-y-3">
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          Feed Filter
        </div>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-[#161C28]">
          <button
            type="button"
            onClick={() => {
              setVaultTab('all');
              setMobileDrawerOpen(false);
            }}
            className={`min-h-[38px] px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              vaultTab === 'all'
                ? 'bg-white dark:bg-[#232B3B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            All ({messages.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setVaultTab('photos');
              setMobileDrawerOpen(false);
            }}
            className={`min-h-[38px] px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              vaultTab === 'photos'
                ? 'bg-white dark:bg-[#232B3B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Photos ({photoMessages.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setVaultTab('voice');
              setMobileDrawerOpen(false);
            }}
            className={`min-h-[38px] px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              vaultTab === 'voice'
                ? 'bg-white dark:bg-[#232B3B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Voice ({voiceMessages.length})
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto veil-scroll p-4 space-y-5">
        {/* High-Priority Background Push Alerts */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleToggleHighPriorityAlerts}
            className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors ${
              alertsEnabled
                ? 'bg-blue-50/70 dark:bg-blue-950/30 border-[#2C6BED]/40 text-[#2C6BED] dark:text-blue-300'
                : 'bg-white dark:bg-[#171D29] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            <span className="flex items-center gap-2 text-xs font-semibold">
              {alertsEnabled ? (
                <BellRing className="w-4 h-4 shrink-0" />
              ) : (
                <BellOff className="w-4 h-4 shrink-0 text-slate-400" />
              )}
              <span>High-Priority Push Alerts</span>
            </span>
            <span className="text-[11px] font-medium">
              {!alertsEnabled
                ? 'Off'
                : notificationPermission === 'default'
                  ? 'Allow Bar'
                  : 'On'}
            </span>
          </button>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Receives background alerts even when closed. Hidden on lock screen until unlocked.
          </p>
          {pushStatusText && (
            <p className="text-[11px] text-[#2C6BED] dark:text-blue-400">{pushStatusText}</p>
          )}
        </div>

        {/* Disappearing Messages */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5 text-[#2C6BED]" />
              <span>Disappearing Messages</span>
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-[#161C28]">
            {DISAPPEAR_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setDisappearMs(opt.value)}
                className={`min-h-[36px] rounded-lg text-xs font-medium transition-colors ${
                  disappearMs === opt.value
                    ? 'bg-[#2C6BED] text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Device IP & Location + Deleted Archive + Safety */}
        <div className="space-y-1.5 pt-2 border-t border-slate-200/80 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => {
              setLocationModalMode('inspect');
              setMobileDrawerOpen(false);
            }}
            className="w-full min-h-[42px] px-3 py-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800/70 text-left text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center justify-between transition-colors"
          >
            <span className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Device Exact IP & Location</span>
            </span>
            <span className="text-[11px] text-slate-400">Inspect</span>
          </button>

          {deletedRecoverableCount > 0 && (
            <button
              type="button"
              onClick={() => setRevealAllDeleted((v) => !v)}
              className="w-full min-h-[42px] px-3 py-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800/70 text-left text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-2">
                {revealAllDeleted ? (
                  <EyeOff className="w-3.5 h-3.5 text-[#2C6BED]" />
                ) : (
                  <Eye className="w-3.5 h-3.5 text-[#2C6BED]" />
                )}
                <span>
                  {revealAllDeleted ? 'Hide Deleted Messages' : 'Show Deleted Messages'}
                </span>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {deletedRecoverableCount}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setShowSafetyModal(true);
              setMobileDrawerOpen(false);
            }}
            className="w-full min-h-[42px] px-3 py-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800/70 text-left text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center justify-between transition-colors"
          >
            <span>Verify Safety Number</span>
            <span className="font-mono text-[11px] text-slate-400">
              {session.keyFingerprint.slice(0, 8)}
            </span>
          </button>

          <label className="w-full min-h-[42px] px-3 py-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800/70 flex items-center justify-between cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-200">
            <span>Auto-lock when tab hidden</span>
            <input
              type="checkbox"
              checked={autoLockOnHide}
              onChange={(e) => setAutoLockOnHide(e.target.checked)}
              className="w-4 h-4 accent-[#2C6BED] rounded"
            />
          </label>

          {!confirmClearAll ? (
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="w-full min-h-[42px] px-3 py-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/40 text-left text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-2 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Erase All Space Messages</span>
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 space-y-2">
              <p className="text-xs text-red-700 dark:text-red-300">
                Permanently erase all encrypted messages for both partners?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClearVault}
                  className="flex-1 min-h-[36px] rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                >
                  Erase All
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(false)}
                  className="flex-1 min-h-[36px] rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Leave & Theme Bar */}
      <div className="p-4 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onLeaveSpace}
          className="min-h-[44px] px-3 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Leave Space</span>
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="min-h-[44px] min-w-[44px] rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-dvh flex overflow-hidden bg-white dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100">
      {/* Desktop Left Rail */}
      <aside className="hidden lg:block w-80 xl:w-88 border-r border-slate-200/80 dark:border-slate-800/80 shrink-0">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden bg-black/50 backdrop-blur-xs flex"
          onClick={() => setMobileDrawerOpen(false)}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            className="w-80 max-w-[85vw] h-full shadow-2xl"
          >
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* Main Conversation Pane */}
      <main
        className="flex-1 flex flex-col min-w-0 relative"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingFile(true);
        }}
        onDragLeave={() => setIsDraggingFile(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingFile(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) {
            if (dropped.type.startsWith('image/') || dropped.type.startsWith('video/')) {
              handleSelectImageOrVideoFile(dropped);
            } else if (dropped.type.startsWith('audio/')) {
              handleSelectAudioFile(dropped);
            } else {
              handleSelectDocumentFile(dropped);
            }
          }
        }}
      >
        {isDraggingFile && (
          <div className="absolute inset-0 z-30 bg-[#2C6BED]/12 backdrop-blur-xs border-2 border-dashed border-[#2C6BED] m-3 rounded-2xl flex items-center justify-center pointer-events-none">
            <div className="px-6 py-4 rounded-2xl bg-white dark:bg-[#131823] shadow-lg text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2.5">
              <ImageIcon className="w-5 h-5 text-[#2C6BED]" />
              <span>Drop file, photo, audio, or video to encrypt & send</span>
            </div>
          </div>
        )}

        {/* Top Bar */}
        <header className="h-14 sm:h-16 px-4 sm:px-6 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-4 shrink-0 bg-white/90 dark:bg-[#0B0E14]/90 backdrop-blur-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open space menu"
              className="lg:hidden min-h-[44px] min-w-[44px] -ml-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="min-w-0">
              <h1 className="text-base font-semibold text-slate-900 dark:text-white truncate">
                {session.normalizedName}
              </h1>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {partnerTyping
                  ? 'Partner is typing...'
                  : partnerOnline
                    ? 'Partner online · End-to-end encrypted'
                    : 'End-to-end encrypted · Only you & your partner'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleHighPriorityAlerts}
              aria-label={
                !alertsEnabled
                  ? 'Enable high priority alerts'
                  : notificationPermission === 'default'
                    ? 'Allow browser notification bar alerts'
                    : 'High priority alerts enabled'
              }
              title={
                !alertsEnabled
                  ? 'Enable high-priority alerts'
                  : notificationPermission === 'default'
                    ? 'Click to allow browser notification bar & closed-tab push'
                    : 'High-priority screen & notification bar alerts On'
              }
              className={`min-h-[44px] min-w-[44px] px-2.5 rounded-xl flex items-center justify-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                alertsEnabled
                  ? 'text-[#2C6BED] dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {alertsEnabled ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
              <span className="hidden md:inline">
                {!alertsEnabled
                  ? 'Alerts Off'
                  : notificationPermission === 'default'
                    ? 'Allow Alerts'
                    : 'Alerts On'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowSafetyModal(true)}
              aria-label="Safety number and invite"
              title="Safety number & partner invite"
              className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors"
            >
              <ShieldCheck className="w-4 h-4 text-[#2C6BED] dark:text-blue-400" />
              <span className="hidden md:inline">Safety</span>
            </button>

            <button
              type="button"
              onClick={() => setIsLocked(true)}
              aria-label="Lock screen now"
              title="Instant Privacy Lock (Ctrl+L)"
              className="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-[#161C28] hover:bg-slate-200/80 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock</span>
            </button>
          </div>
        </header>

        {/* One-tap background / closed-browser push permission prompt */}
        {alertsEnabled &&
          notificationPermission === 'default' &&
          !dismissedPushPrompt &&
          !isLocked && (
            <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950/40 border-b border-blue-200/80 dark:border-blue-900/60 text-xs flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 min-w-0 text-slate-700 dark:text-slate-200">
                <BellRing className="w-4 h-4 text-[#2C6BED] dark:text-blue-400 shrink-0" />
                <span className="truncate">
                  Allow alerts so notifications arrive even when you close the browser.
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleHighPriorityAlerts}
                  className="min-h-[34px] px-3 rounded-lg bg-[#2C6BED] hover:bg-[#2359C9] text-white font-semibold whitespace-nowrap cursor-pointer"
                >
                  Allow Alerts
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedPushPrompt(true)}
                  aria-label="Dismiss alert setup prompt"
                  className="min-h-[34px] min-w-[34px] rounded-lg text-slate-500 hover:bg-blue-100/70 dark:hover:bg-blue-900/40 flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

        {/* Foreground High-Priority Unlocked Alert Banner */}
        {foregroundBanner && !isLocked && (
          <div
            role="status"
            className="px-4 py-2.5 bg-[#2C6BED] text-white text-xs font-medium flex items-center justify-between gap-3 shrink-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <BellRing className="w-4 h-4 shrink-0" />
              <span className="font-semibold truncate">{foregroundBanner.title}</span>
              <span className="hidden sm:inline text-blue-100 truncate">
                · {foregroundBanner.detail}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setForegroundBanner(null)}
              aria-label="Dismiss notification alert"
              className="text-blue-100 hover:text-white shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Scrollable Feed */}
        <div className="flex-1 overflow-y-auto veil-scroll px-4 sm:px-6 lg:px-10 py-6 space-y-4">
          {filteredMessages.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {vaultTab === 'all'
                  ? 'No messages yet in this private space.'
                  : vaultTab === 'photos'
                    ? 'No encrypted photos shared yet.'
                    : 'No encrypted voice notes shared yet.'}
              </p>
              <p className="text-xs text-slate-400">
                Attach documents, camera photos/videos, audio, contacts, location, stickers, or
                write a note below.
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto w-full space-y-3">
              {filteredMessages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  nowMs={nowMs}
                  forceRevealDeleted={revealAllDeleted}
                  onReply={(m) => {
                    setReplyTarget(m);
                    textareaRef.current?.focus();
                  }}
                  onRequestDelete={(m) => setDeleteTarget(m)}
                  onPurgeDeleted={handlePurgeDeleted}
                  onInspectCipher={(m) => setInspectedMessage(m)}
                  onOpenImage={(src, caption) => setLightboxImage({ src, caption })}
                />
              ))}
            </div>
          )}

          <div ref={feedEndRef} />
        </div>

        {/* Bottom Composer */}
        <footer className="px-4 sm:px-6 lg:px-10 py-3 border-t border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-[#0B0E14] shrink-0 relative">
          <div className="max-w-3xl mx-auto space-y-2.5 relative">
            {/* Hidden File Pickers for Attachment Menu */}
            <input
              ref={mediaFileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleSelectImageOrVideoFile(file);
                e.target.value = '';
              }}
            />
            <input
              ref={docFileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.csv,.json,.zip,.md,application/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleSelectDocumentFile(file);
                e.target.value = '';
              }}
            />
            <input
              ref={audioFileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleSelectAudioFile(file);
                e.target.value = '';
              }}
            />

            {/* Floating WhatsApp-style Attachment Menu */}
            {showAttachmentMenu && (
              <div className="absolute bottom-full left-0 mb-3 z-30">
                <AttachmentMenuPopover
                  onPickDocument={() => docFileInputRef.current?.click()}
                  onPickPhotosAndVideos={() => mediaFileInputRef.current?.click()}
                  onOpenCamera={() => setShowCameraModal(true)}
                  onPickAudio={() => audioFileInputRef.current?.click()}
                  onOpenContact={() => setShowContactModal(true)}
                  onOpenLocation={() => setLocationModalMode('share')}
                  onClose={() => setShowAttachmentMenu(false)}
                />
              </div>
            )}

            {/* Floating Sticker Picker */}
            {showStickerPicker && (
              <div className="absolute bottom-full left-12 mb-3 z-30">
                <StickerPicker
                  onSelectSticker={handleSendSticker}
                  onClose={() => setShowStickerPicker(false)}
                />
              </div>
            )}

            {mediaError && (
              <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
                <span>{mediaError}</span>
                <button
                  type="button"
                  onClick={() => setMediaError(null)}
                  className="font-semibold hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            {replyTarget && replyTarget.payload && (
              <div className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-[#141923] border border-slate-200/70 dark:border-slate-800">
                <div className="min-w-0 text-xs">
                  <div className="font-semibold text-[#2C6BED] dark:text-blue-400">
                    Replying to {replyTarget.payload.senderAlias}
                  </div>
                  <div className="text-slate-600 dark:text-slate-300 truncate">
                    {replyTarget.payload.text ||
                      replyTarget.payload.docName ||
                      replyTarget.payload.contactName ||
                      replyTarget.payload.locationLabel ||
                      'Encrypted attachment'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyTarget(null)}
                  aria-label="Cancel reply"
                  className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {stagedImage && (
              <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-100 dark:bg-[#141923] border border-slate-200/80 dark:border-slate-800">
                <img
                  src={stagedImage.dataUrl}
                  alt="Photo ready to encrypt"
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 rounded-xl object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {stagedImage.name}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    EXIF metadata stripped · {formatBytes(stagedImage.scrubbedSize)} · Ready to
                    encrypt
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setStagedImage(null)}
                  aria-label="Remove attached photo"
                  className="min-h-[40px] min-w-[40px] rounded-xl text-slate-400 hover:text-red-600 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {isRecordingVoice ? (
              <VoiceRecorder
                onSendVoice={handleSendVoice}
                onCancel={() => setIsRecordingVoice(false)}
              />
            ) : (
              <div className="flex items-end gap-1.5 sm:gap-2">
                {/* Attachment Menu Trigger */}
                <button
                  type="button"
                  onClick={() => {
                    setShowStickerPicker(false);
                    setShowAttachmentMenu((v) => !v);
                  }}
                  aria-label="Open attachment options"
                  title="Attach Document, Photos & Videos, Camera, Audio, Contact, or Location"
                  className={`min-h-[46px] min-w-[46px] rounded-xl flex items-center justify-center transition-colors shrink-0 ${
                    showAttachmentMenu
                      ? 'bg-[#2C6BED] text-white'
                      : 'bg-slate-100 dark:bg-[#151B26] hover:bg-slate-200/80 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <Paperclip className="w-5 h-5" />
                </button>

                {/* Sticker Picker Trigger */}
                <button
                  type="button"
                  onClick={() => {
                    setShowAttachmentMenu(false);
                    setShowStickerPicker((v) => !v);
                  }}
                  aria-label="Open encrypted stickers"
                  title="Send encrypted sticker"
                  className={`min-h-[46px] min-w-[46px] rounded-xl flex items-center justify-center transition-colors shrink-0 ${
                    showStickerPicker
                      ? 'bg-[#2C6BED] text-white'
                      : 'bg-slate-100 dark:bg-[#151B26] hover:bg-slate-200/80 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <Smile className="w-5 h-5" />
                </button>

                {/* Note / Caption Input */}
                <div className="flex-1 min-w-0">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={textInput}
                    onFocus={() => {
                      setShowAttachmentMenu(false);
                      setShowStickerPicker(false);
                    }}
                    onChange={(e) => {
                      setTextInput(e.target.value);
                      emitTyping(e.target.value.trim().length > 0);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 130)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendTextOrImage();
                      }
                    }}
                    placeholder={
                      stagedImage
                        ? 'Add a caption...'
                        : 'Message'
                    }
                    className="w-full min-h-[46px] max-h-[132px] px-4 py-3 rounded-2xl bg-slate-100 dark:bg-[#151B26] text-sm sm:text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#2C6BED]"
                  />
                </div>

                {/* Quick Camera Button (when input is empty) */}
                {textInput.trim().length === 0 && !stagedImage && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachmentMenu(false);
                      setShowStickerPicker(false);
                      setShowCameraModal(true);
                    }}
                    aria-label="Open camera for photo or video"
                    title="Camera (Photo / Video with Audio, Front & Back)"
                    className="min-h-[46px] min-w-[46px] rounded-xl bg-slate-100 dark:bg-[#151B26] hover:bg-slate-200/80 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center transition-colors shrink-0"
                  >
                    <Camera className="w-5 h-5" />
                  </button>
                )}

                {textInput.trim().length > 0 || stagedImage ? (
                  <button
                    type="button"
                    onClick={handleSendTextOrImage}
                    aria-label="Send encrypted message"
                    className="min-h-[46px] min-w-[46px] px-4 rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] text-white flex items-center justify-center transition-colors shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsRecordingVoice(true)}
                    aria-label="Record encrypted voice note"
                    title="Record encrypted voice note"
                    className="min-h-[46px] min-w-[46px] px-4 rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] text-white flex items-center justify-center transition-colors shrink-0"
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </footer>
      </main>

      {/* Modals */}
      {showCameraModal && (
        <CameraModal
          onClose={() => setShowCameraModal(false)}
          onFallbackUpload={() => mediaFileInputRef.current?.click()}
          onSendPhoto={async (photo) => {
            setShowCameraModal(false);
            await sendEncryptedMessage({
              kind: 'image',
              imageDataUrl: photo.dataUrl,
              imageWidth: photo.width,
              imageHeight: photo.height,
              imageName: `camera-${Date.now()}.jpg`,
              text: photo.caption,
            });
          }}
          onSendVideo={async (video) => {
            setShowCameraModal(false);
            await sendEncryptedMessage({
              kind: 'video',
              videoDataUrl: video.dataUrl,
              videoMime: video.mime,
              videoName: `camera-video-${Date.now()}.webm`,
              videoSize: video.size,
              text: video.caption,
            });
          }}
        />
      )}

      {showContactModal && (
        <ContactShareModal
          onClose={() => setShowContactModal(false)}
          onSendContact={async (contact) => {
            setShowContactModal(false);
            await sendEncryptedMessage({
              kind: 'contact',
              contactName: contact.contactName,
              contactPhoneOrHandle: contact.contactPhoneOrHandle,
              contactNote: contact.contactNote,
            });
          }}
        />
      )}

      {locationModalMode && (
        <LocationShareModal
          mode={locationModalMode}
          onClose={() => setLocationModalMode(null)}
          onSendLocation={async (loc) => {
            setLocationModalMode(null);
            await sendEncryptedMessage({
              kind: 'location',
              latitude: loc.latitude,
              longitude: loc.longitude,
              accuracyMeters: loc.accuracyMeters,
              locationLabel: loc.locationLabel,
              ipAddress: loc.ipAddress,
            });
          }}
        />
      )}

      {deleteTarget && (
        <DeleteMessageModal
          message={deleteTarget}
          onDeleteForMe={handleDeleteForMe}
          onDeleteForEveryone={handleDeleteForEveryone}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {showSafetyModal && (
        <SafetyNumberModal
          session={session}
          onClose={() => setShowSafetyModal(false)}
        />
      )}

      {inspectedMessage && (
        <CipherInspectorModal
          message={inspectedMessage}
          onClose={() => setInspectedMessage(null)}
        />
      )}

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          caption={lightboxImage.caption}
          onClose={() => setLightboxImage(null)}
        />
      )}

      {isLocked && (
        <PrivacyLockScreen
          spaceName={session.normalizedName}
          expectedPassphrase={session.passphrase}
          onUnlock={() => setIsLocked(false)}
          onExitSpace={() => {
            setIsLocked(false);
            onLeaveSpace();
          }}
        />
      )}
    </div>
  );
};
