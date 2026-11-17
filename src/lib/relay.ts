import { schnorr } from '@noble/curves/secp256k1.js';
import type { EncryptedMessageEnvelope, ReceiptStatus } from '../types';

const RELAY_URLS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.mom',
];

const CHUNK_SIZE = 24_000;
const encoder = new TextEncoder();

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

type StoredOp =
  | { op: 'init'; createdAt: number }
  | { op: 'msg'; envelope: EncryptedMessageEnvelope }
  | { op: 'msg-chunked'; total: number; envelope: EncryptedMessageEnvelope }
  | { op: 'chunk'; id: string; idx: number; total: number; data: string }
  | { op: 'soft-delete'; messageId: string; deletedByClientId: string; timestamp: number }
  | { op: 'delete'; messageId: string; timestamp: number }
  | { op: 'clear'; clearedAt: number }
  | {
      op: 'receipt';
      messageIds: string[];
      status: 'delivered' | 'read';
      fromClientId: string;
      timestamp: number;
    };

type EphemeralOp =
  | { op: 'typing'; clientId: string; isTyping: boolean; ts: number }
  | { op: 'presence'; clientId: string; online: boolean; ts: number }
  | {
      op: 'receipt';
      messageIds: string[];
      status: 'delivered' | 'read';
      fromClientId: string;
      ts: number;
    };

interface LocalRelayCache {
  createdAt: number;
  clearedAt: number;
  deletedIds: string[];
  messages: EncryptedMessageEnvelope[];
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return new Uint8Array(digest);
}

interface DerivedRelayIdentity {
  privKey: Uint8Array;
  pubKeyHex: string;
  roomTag: string;
  cacheKey: string;
}

async function deriveRelayIdentity(
  roomId: string,
  gateHash: string
): Promise<DerivedRelayIdentity> {
  const privKey = await sha256Bytes(`ie:v1:relay-priv:${roomId}:${gateHash}`);
  const pubKeyBytes = schnorr.getPublicKey(privKey);
  const pubKeyHex = bytesToHex(pubKeyBytes);
  const roomTag = `ie-${roomId.slice(0, 32)}`;
  const cacheKey = `ie_relay_cache_${roomId}_${gateHash.slice(0, 12)}`;
  return { privKey, pubKeyHex, roomTag, cacheKey };
}

async function buildSignedEvent(
  identity: DerivedRelayIdentity,
  kind: number,
  tags: string[][],
  content: string,
  createdAtSec = Math.floor(Date.now() / 1000)
): Promise<NostrEvent> {
  const serialized = JSON.stringify([
    0,
    identity.pubKeyHex,
    createdAtSec,
    kind,
    tags,
    content,
  ]);
  const idBytes = await sha256Bytes(serialized);
  const id = bytesToHex(idBytes);
  const sigBytes = schnorr.sign(idBytes, identity.privKey);
  return {
    id,
    pubkey: identity.pubKeyHex,
    created_at: createdAtSec,
    kind,
    tags,
    content,
    sig: bytesToHex(sigBytes),
  };
}

function loadLocalCache(cacheKey: string): LocalRelayCache | null {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalRelayCache;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLocalCache(cacheKey: string, cache: LocalRelayCache): void {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(cache));
  } catch {
    // Ignore storage quota errors
  }
}

function receiptRank(status?: ReceiptStatus): number {
  if (status === 'read') return 3;
  if (status === 'delivered') return 2;
  return 1;
}

function reconstructMessagesFromEvents(
  events: NostrEvent[],
  myPubKey: string,
  localCache: LocalRelayCache | null
): {
  hasMyInitOrData: boolean;
  hasOtherPubkey: boolean;
  messages: EncryptedMessageEnvelope[];
  clearedAt: number;
} {
  let hasMyInitOrData = Boolean(localCache);
  let hasOtherPubkey = false;
  let clearedAt = localCache?.clearedAt ?? 0;

  const messageMap = new Map<string, EncryptedMessageEnvelope>();
  const chunkMetaMap = new Map<string, { total: number; envelope: EncryptedMessageEnvelope }>();
  const chunksMap = new Map<string, Map<number, string>>();
  const softDeletedMap = new Map<string, string>();
  const hardDeletedSet = new Set<string>(localCache?.deletedIds ?? []);
  const receiptMap = new Map<string, 'delivered' | 'read'>();

  if (localCache) {
    for (const msg of localCache.messages) {
      messageMap.set(msg.id, msg);
    }
  }

  for (const ev of events) {
    if (ev.pubkey !== myPubKey) {
      hasOtherPubkey = true;
      continue;
    }
    hasMyInitOrData = true;
    try {
      const data = JSON.parse(ev.content) as StoredOp;
      if (!data || typeof data !== 'object') continue;

      if (data.op === 'msg' && data.envelope) {
        messageMap.set(data.envelope.id, data.envelope);
      } else if (data.op === 'msg-chunked' && data.envelope) {
        chunkMetaMap.set(data.envelope.id, {
          total: data.total,
          envelope: data.envelope,
        });
      } else if (data.op === 'chunk' && typeof data.id === 'string') {
        let partMap = chunksMap.get(data.id);
        if (!partMap) {
          partMap = new Map();
          chunksMap.set(data.id, partMap);
        }
        partMap.set(data.idx, data.data);
      } else if (data.op === 'soft-delete' && data.messageId) {
        softDeletedMap.set(data.messageId, data.deletedByClientId || 'unknown');
      } else if (data.op === 'delete' && data.messageId) {
        hardDeletedSet.add(data.messageId);
      } else if (data.op === 'clear' && typeof data.clearedAt === 'number') {
        clearedAt = Math.max(clearedAt, data.clearedAt);
      } else if (data.op === 'receipt' && Array.isArray(data.messageIds)) {
        for (const id of data.messageIds) {
          const prev = receiptMap.get(id);
          if (!prev || receiptRank(data.status) > receiptRank(prev)) {
            receiptMap.set(id, data.status);
          }
        }
      }
    } catch {
      // Ignore malformed event content
    }
  }

  for (const [id, meta] of chunkMetaMap.entries()) {
    const partMap = chunksMap.get(id);
    if (!partMap || partMap.size < meta.total) continue;
    let assembled = '';
    let complete = true;
    for (let i = 0; i < meta.total; i++) {
      const part = partMap.get(i);
      if (typeof part !== 'string') {
        complete = false;
        break;
      }
      assembled += part;
    }
    if (complete) {
      messageMap.set(id, { ...meta.envelope, ciphertext: assembled });
    }
  }

  const now = Date.now();
  const result: EncryptedMessageEnvelope[] = [];
  for (const msg of messageMap.values()) {
    if (hardDeletedSet.has(msg.id)) continue;
    if (clearedAt > 0 && msg.timestamp <= clearedAt) continue;
    if (msg.expiresAt !== null && msg.expiresAt <= now) continue;

    let finalMsg = msg;
    const deletedBy = softDeletedMap.get(msg.id);
    if (deletedBy !== undefined) {
      finalMsg = {
        ...msg,
        deletedForEveryone: true,
        deletedByClientId: deletedBy,
        iv: '',
        ciphertext: '',
      };
    }

    const rStatus = receiptMap.get(msg.id);
    if (rStatus && receiptRank(rStatus) > receiptRank(finalMsg.receiptStatus)) {
      finalMsg = { ...finalMsg, receiptStatus: rStatus };
    }

    result.push(finalMsg);
  }

  result.sort((a, b) => a.timestamp - b.timestamp);
  return {
    hasMyInitOrData,
    hasOtherPubkey,
    messages: result.slice(-500),
    clearedAt,
  };
}

async function queryAndPublishInit(
  identity: DerivedRelayIdentity,
  shouldPublishInitOnMissing: boolean
): Promise<{
  events: NostrEvent[];
  connectedCount: number;
}> {
  const subId = `join-${Math.random().toString(36).slice(2, 10)}`;
  const collected = new Map<string, NostrEvent>();

  return new Promise((resolve) => {
    let settled = false;
    let eoseCount = 0;
    let closedOrErrCount = 0;
    let connectedCount = 0;
    const sockets: WebSocket[] = [];

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (eoseGraceTimer) clearTimeout(eoseGraceTimer);
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          // Ignore
        }
      }
      resolve({
        events: Array.from(collected.values()),
        connectedCount,
      });
    };

    let eoseGraceTimer: ReturnType<typeof setTimeout> | null = null;
    const hardTimer = setTimeout(finish, 3600);

    for (const url of RELAY_URLS) {
      try {
        const ws = new WebSocket(url);
        sockets.push(ws);

        ws.onopen = () => {
          connectedCount += 1;
          ws.send(
            JSON.stringify([
              'REQ',
              subId,
              { kinds: [30078], '#t': [identity.roomTag], limit: 500 },
            ])
          );
        };

        ws.onmessage = (evt) => {
          try {
            const frame = JSON.parse(String(evt.data)) as unknown[];
            if (!Array.isArray(frame)) return;
            if (frame[0] === 'EVENT' && frame[2] && typeof frame[2] === 'object') {
              const nostrEv = frame[2] as NostrEvent;
              if (nostrEv.id && !collected.has(nostrEv.id)) {
                collected.set(nostrEv.id, nostrEv);
              }
            } else if (frame[0] === 'EOSE') {
              eoseCount += 1;
              if (eoseCount >= RELAY_URLS.length) {
                finish();
              } else if (!eoseGraceTimer) {
                eoseGraceTimer = setTimeout(finish, 900);
              }
            }
          } catch {
            // Ignore malformed relay frame
          }
        };

        ws.onerror = () => {
          // Wait for onclose
        };

        ws.onclose = () => {
          closedOrErrCount += 1;
          if (closedOrErrCount >= RELAY_URLS.length) {
            finish();
          }
        };
      } catch {
        closedOrErrCount += 1;
      }
    }
  }).then(async (res) => {
    const { events, connectedCount } = res as {
      events: NostrEvent[];
      connectedCount: number;
    };

    if (shouldPublishInitOnMissing) {
      const hasAnyMine = events.some((e) => e.pubkey === identity.pubKeyHex);
      const hasAnyOther = events.some((e) => e.pubkey !== identity.pubKeyHex);
      if (!hasAnyMine && !hasAnyOther && connectedCount > 0) {
        const initEvent = await buildSignedEvent(
          identity,
          30078,
          [
            ['d', `init:${identity.roomTag.slice(0, 16)}`],
            ['t', identity.roomTag],
          ],
          JSON.stringify({ op: 'init', createdAt: Date.now() })
        );
        await publishEventsToRelays([initEvent], 1500);
      }
    }

    return { events, connectedCount };
  });
}

async function publishEventsToRelays(events: NostrEvent[], timeoutMs = 2000): Promise<void> {
  if (events.length === 0) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let acks = 0;
    const sockets: WebSocket[] = [];
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          // Ignore
        }
      }
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);

    for (const url of RELAY_URLS) {
      try {
        const ws = new WebSocket(url);
        sockets.push(ws);
        ws.onopen = () => {
          for (const ev of events) {
            ws.send(JSON.stringify(['EVENT', ev]));
          }
        };
        ws.onmessage = (evt) => {
          try {
            const frame = JSON.parse(String(evt.data)) as unknown[];
            if (Array.isArray(frame) && frame[0] === 'OK') {
              acks += 1;
              if (acks >= events.length) {
                setTimeout(done, 250);
              }
            }
          } catch {
            // Ignore
          }
        };
      } catch {
        // Ignore
      }
    }
  });
}

export interface RelayJoinResponse {
  ok?: boolean;
  isNew?: boolean;
  code?: string;
  messages?: EncryptedMessageEnvelope[];
  error?: string;
}

export async function joinSpaceViaRelay(payload: {
  roomId: string;
  gateHash: string;
  mode: 'create' | 'join' | 'auto';
}): Promise<{ status: number; ok: boolean; data: RelayJoinResponse }> {
  const identity = await deriveRelayIdentity(payload.roomId, payload.gateHash);
  const localCache = loadLocalCache(identity.cacheKey);

  const { events } = await queryAndPublishInit(
    identity,
    payload.mode === 'create' || payload.mode === 'auto'
  );

  const reconstructed = reconstructMessagesFromEvents(
    events,
    identity.pubKeyHex,
    localCache
  );

  if (!reconstructed.hasMyInitOrData && !reconstructed.hasOtherPubkey) {
    if (payload.mode === 'join') {
      return {
        status: 404,
        ok: false,
        data: {
          ok: false,
          code: 'ROOM_NOT_FOUND',
          error:
            'No private space found with that unique name. Switch to Create Space to start it.',
        },
      };
    }

    const freshCache: LocalRelayCache = {
      createdAt: Date.now(),
      clearedAt: 0,
      deletedIds: [],
      messages: [],
    };
    saveLocalCache(identity.cacheKey, freshCache);

    return {
      status: 200,
      ok: true,
      data: {
        ok: true,
        isNew: true,
        messages: [],
      },
    };
  }

  if (reconstructed.hasOtherPubkey && !reconstructed.hasMyInitOrData) {
    if (payload.mode === 'create') {
      return {
        status: 409,
        ok: false,
        data: {
          ok: false,
          code: 'SPACE_NAME_TAKEN',
          error:
            'This unique space name is already registered with a different passphrase. Choose a new unique name or switch to Join Partner.',
        },
      };
    }
    return {
      status: 403,
      ok: false,
      data: {
        ok: false,
        code: 'INVALID_PASSPHRASE',
        error: 'Incorrect secret passphrase for this unique space name.',
      },
    };
  }

  saveLocalCache(identity.cacheKey, {
    createdAt: localCache?.createdAt ?? Date.now(),
    clearedAt: reconstructed.clearedAt,
    deletedIds: localCache?.deletedIds ?? [],
    messages: reconstructed.messages,
  });

  return {
    status: 200,
    ok: true,
    data: {
      ok: true,
      isNew: false,
      messages: reconstructed.messages,
    },
  };
}

export interface RelayRoomHandlers {
  onConnectionChange: (state: 'connecting' | 'connected' | 'reconnecting') => void;
  onRoomSynced: (messages: EncryptedMessageEnvelope[]) => void;
  onMessageCreated: (message: EncryptedMessageEnvelope) => void;
  onReceiptUpdated: (messageIds: string[], status: 'delivered' | 'read') => void;
  onMessageSoftDeleted: (messageId: string, deletedByClientId: string) => void;
  onMessageDeleted: (messageId: string) => void;
  onMessagesExpired: (messageIds: string[]) => void;
  onRoomCleared: () => void;
  onPresenceUpdate: (activeCount: number, partnerOnline: boolean) => void;
  onPartnerTyping: (isTyping: boolean) => void;
}

export class RelayRoomConnection {
  private roomId: string;
  private gateHash: string;
  private clientId: string;
  private handlers: RelayRoomHandlers;
  private identity: DerivedRelayIdentity | null = null;
  private sockets = new Map<string, WebSocket>();
  private bc: BroadcastChannel | null = null;
  private seenEvents = new Set<string>();
  private incomingChunks = new Map<
    string,
    { total?: number; envelope?: EncryptedMessageEnvelope; parts: Map<number, string> }
  >();
  private partnerLastSeen = new Map<string, number>();
  private closed = false;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    roomId: string,
    gateHash: string,
    clientId: string,
    handlers: RelayRoomHandlers
  ) {
    this.roomId = roomId;
    this.gateHash = gateHash;
    this.clientId = clientId;
    this.handlers = handlers;
    void this.init();
  }

  private async init(): Promise<void> {
    this.identity = await deriveRelayIdentity(this.roomId, this.gateHash);
    if (this.closed) return;

    if ('BroadcastChannel' in window) {
      try {
        this.bc = new BroadcastChannel(`ie_relay_bc_${this.roomId}`);
        this.bc.onmessage = (evt) => {
          const payload = evt.data as { senderClientId?: string; event?: NostrEvent };
          if (payload?.event && payload.senderClientId !== this.clientId) {
            this.handleIncomingEvent(payload.event, true);
          }
        };
      } catch {
        this.bc = null;
      }
    }

    const cached = loadLocalCache(this.identity.cacheKey);
    if (cached) {
      this.handlers.onRoomSynced(cached.messages);
    }

    for (const url of RELAY_URLS) {
      this.connectRelay(url, 0);
    }

    this.presenceTimer = setInterval(() => {
      void this.emitPresence(true);
      this.prunePresence();
    }, 15_000);

    this.expiryTimer = setInterval(() => {
      if (!this.identity) return;
      const cache = loadLocalCache(this.identity.cacheKey);
      if (!cache) return;
      const now = Date.now();
      const expiredIds: string[] = [];
      const kept: EncryptedMessageEnvelope[] = [];
      for (const msg of cache.messages) {
        if (msg.expiresAt !== null && msg.expiresAt <= now) {
          expiredIds.push(msg.id);
        } else {
          kept.push(msg);
        }
      }
      if (expiredIds.length > 0) {
        cache.messages = kept;
        saveLocalCache(this.identity.cacheKey, cache);
        this.handlers.onMessagesExpired(expiredIds);
      }
    }, 5_000);
  }

  private connectRelay(url: string, attempt: number): void {
    if (this.closed || !this.identity) return;
    const identity = this.identity;

    try {
      const ws = new WebSocket(url);
      this.sockets.set(url, ws);

      ws.onopen = () => {
        if (this.closed) {
          ws.close();
          return;
        }
        this.handlers.onConnectionChange('connected');
        const subId = `live-${this.clientId.slice(0, 8)}`;
        ws.send(
          JSON.stringify([
            'REQ',
            subId,
            {
              kinds: [30078, 20001],
              authors: [identity.pubKeyHex],
              '#t': [identity.roomTag],
              limit: 400,
            },
          ])
        );
        void this.emitPresence(true);
      };

      ws.onmessage = (evt) => {
        if (this.closed) return;
        try {
          const frame = JSON.parse(String(evt.data)) as unknown[];
          if (!Array.isArray(frame)) return;
          if (frame[0] === 'EVENT' && frame[2] && typeof frame[2] === 'object') {
            this.handleIncomingEvent(frame[2] as NostrEvent, false);
          }
        } catch {
          // Ignore malformed relay frame
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onclose = () => {
        this.sockets.delete(url);
        if (this.closed) return;
        const anyOpen = Array.from(this.sockets.values()).some(
          (s) => s.readyState === WebSocket.OPEN
        );
        if (!anyOpen) {
          this.handlers.onConnectionChange('reconnecting');
        }
        const delay = Math.min(10_000, 1000 * Math.pow(1.6, attempt));
        const timer = setTimeout(() => {
          this.reconnectTimers.delete(url);
          this.connectRelay(url, attempt + 1);
        }, delay);
        this.reconnectTimers.set(url, timer);
      };
    } catch {
      // Ignore invalid socket
    }
  }

  private handleIncomingEvent(ev: NostrEvent, isLiveLocal: boolean): void {
    if (!this.identity || ev.pubkey !== this.identity.pubKeyHex) return;
    if (this.seenEvents.has(ev.id)) return;
    this.seenEvents.add(ev.id);

    if (ev.kind === 20001) {
      try {
        const op = JSON.parse(ev.content) as EphemeralOp;
        if (!op || typeof op !== 'object') return;
        if (op.op === 'typing' && op.clientId !== this.clientId) {
          this.handlers.onPartnerTyping(Boolean(op.isTyping));
        } else if (op.op === 'presence' && op.clientId !== this.clientId) {
          if (op.online) {
            this.partnerLastSeen.set(op.clientId, Date.now());
          } else {
            this.partnerLastSeen.delete(op.clientId);
          }
          this.prunePresence();
        } else if (op.op === 'receipt' && op.fromClientId !== this.clientId) {
          this.applyReceiptLocally(op.messageIds, op.status);
          this.handlers.onReceiptUpdated(op.messageIds, op.status);
        }
      } catch {
        // Ignore
      }
      return;
    }

    if (ev.kind === 30078) {
      try {
        const op = JSON.parse(ev.content) as StoredOp;
        if (!op || typeof op !== 'object') return;
        const cache =
          loadLocalCache(this.identity.cacheKey) || {
            createdAt: Date.now(),
            clearedAt: 0,
            deletedIds: [],
            messages: [],
          };

        if (op.op === 'msg' && op.envelope) {
          const msg = op.envelope;
          if (cache.deletedIds.includes(msg.id)) return;
          if (cache.clearedAt > 0 && msg.timestamp <= cache.clearedAt) return;
          if (msg.expiresAt !== null && msg.expiresAt <= Date.now()) return;

          if (!cache.messages.some((m) => m.id === msg.id)) {
            cache.messages = [...cache.messages, msg]
              .sort((a, b) => a.timestamp - b.timestamp)
              .slice(-500);
            saveLocalCache(this.identity.cacheKey, cache);
            this.handlers.onMessageCreated(msg);
          }
        } else if (op.op === 'msg-chunked' && op.envelope) {
          const entry = this.incomingChunks.get(op.envelope.id) || {
            parts: new Map<number, string>(),
          };
          entry.total = op.total;
          entry.envelope = op.envelope;
          this.incomingChunks.set(op.envelope.id, entry);
          this.tryFinalizeChunked(op.envelope.id);
        } else if (op.op === 'chunk' && typeof op.id === 'string') {
          const entry = this.incomingChunks.get(op.id) || {
            parts: new Map<number, string>(),
          };
          entry.total = entry.total ?? op.total;
          entry.parts.set(op.idx, op.data);
          this.incomingChunks.set(op.id, entry);
          this.tryFinalizeChunked(op.id);
        } else if (op.op === 'soft-delete' && op.messageId) {
          cache.messages = cache.messages.map((m) =>
            m.id === op.messageId
              ? {
                  ...m,
                  deletedForEveryone: true,
                  deletedByClientId: op.deletedByClientId,
                  iv: '',
                  ciphertext: '',
                }
              : m
          );
          saveLocalCache(this.identity.cacheKey, cache);
          this.handlers.onMessageSoftDeleted(op.messageId, op.deletedByClientId);
        } else if (op.op === 'delete' && op.messageId) {
          if (!cache.deletedIds.includes(op.messageId)) {
            cache.deletedIds = [...cache.deletedIds, op.messageId].slice(-500);
          }
          cache.messages = cache.messages.filter((m) => m.id !== op.messageId);
          saveLocalCache(this.identity.cacheKey, cache);
          this.handlers.onMessageDeleted(op.messageId);
        } else if (op.op === 'clear' && typeof op.clearedAt === 'number') {
          if (op.clearedAt > cache.clearedAt) {
            cache.clearedAt = op.clearedAt;
            cache.messages = cache.messages.filter((m) => m.timestamp > op.clearedAt);
            saveLocalCache(this.identity.cacheKey, cache);
            this.handlers.onRoomCleared();
          }
        } else if (op.op === 'receipt' && op.fromClientId !== this.clientId) {
          this.applyReceiptLocally(op.messageIds, op.status);
          this.handlers.onReceiptUpdated(op.messageIds, op.status);
        }
      } catch {
        // Ignore
      }
      if (isLiveLocal) {
        // Already handled
      }
    }
  }

  private tryFinalizeChunked(messageId: string): void {
    if (!this.identity) return;
    const entry = this.incomingChunks.get(messageId);
    if (!entry || !entry.envelope || !entry.total) return;
    if (entry.parts.size < entry.total) return;

    let assembled = '';
    for (let i = 0; i < entry.total; i++) {
      const part = entry.parts.get(i);
      if (typeof part !== 'string') return;
      assembled += part;
    }

    this.incomingChunks.delete(messageId);
    const fullEnvelope: EncryptedMessageEnvelope = {
      ...entry.envelope,
      ciphertext: assembled,
    };

    const cache =
      loadLocalCache(this.identity.cacheKey) || {
        createdAt: Date.now(),
        clearedAt: 0,
        deletedIds: [],
        messages: [],
      };
    if (cache.deletedIds.includes(fullEnvelope.id)) return;
    if (cache.clearedAt > 0 && fullEnvelope.timestamp <= cache.clearedAt) return;
    if (!cache.messages.some((m) => m.id === fullEnvelope.id)) {
      cache.messages = [...cache.messages, fullEnvelope]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-500);
      saveLocalCache(this.identity.cacheKey, cache);
      this.handlers.onMessageCreated(fullEnvelope);
    }
  }

  private applyReceiptLocally(
    messageIds: string[],
    status: 'delivered' | 'read'
  ): void {
    if (!this.identity) return;
    const cache = loadLocalCache(this.identity.cacheKey);
    if (!cache) return;
    const idSet = new Set(messageIds);
    let changed = false;
    cache.messages = cache.messages.map((m) => {
      if (!idSet.has(m.id)) return m;
      if (receiptRank(status) > receiptRank(m.receiptStatus)) {
        changed = true;
        return { ...m, receiptStatus: status };
      }
      return m;
    });
    if (changed) {
      saveLocalCache(this.identity.cacheKey, cache);
    }
  }

  private prunePresence(): void {
    const cutoff = Date.now() - 40_000;
    for (const [cid, ts] of this.partnerLastSeen.entries()) {
      if (ts < cutoff) this.partnerLastSeen.delete(cid);
    }
    const partnerCount = this.partnerLastSeen.size;
    this.handlers.onPresenceUpdate(1 + partnerCount, partnerCount > 0);
  }

  private broadcastSigned(ev: NostrEvent): void {
    this.seenEvents.add(ev.id);
    const frame = JSON.stringify(['EVENT', ev]);
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(frame);
      }
    }
    if (this.bc) {
      try {
        this.bc.postMessage({ senderClientId: this.clientId, event: ev });
      } catch {
        // Ignore
      }
    }
  }

  async emitPresence(online: boolean): Promise<void> {
    if (!this.identity) return;
    const ev = await buildSignedEvent(
      this.identity,
      20001,
      [['t', this.identity.roomTag]],
      JSON.stringify({
        op: 'presence',
        clientId: this.clientId,
        online,
        ts: Date.now(),
      } satisfies EphemeralOp)
    );
    this.broadcastSigned(ev);
  }

  async sendTyping(isTyping: boolean): Promise<void> {
    if (!this.identity) return;
    const ev = await buildSignedEvent(
      this.identity,
      20001,
      [['t', this.identity.roomTag]],
      JSON.stringify({
        op: 'typing',
        clientId: this.clientId,
        isTyping,
        ts: Date.now(),
      } satisfies EphemeralOp)
    );
    this.broadcastSigned(ev);
  }

  async sendReceipt(messageIds: string[], status: 'delivered' | 'read'): Promise<void> {
    if (!this.identity || messageIds.length === 0) return;
    this.applyReceiptLocally(messageIds, status);
    const ephEv = await buildSignedEvent(
      this.identity,
      20001,
      [['t', this.identity.roomTag]],
      JSON.stringify({
        op: 'receipt',
        messageIds,
        status,
        fromClientId: this.clientId,
        ts: Date.now(),
      } satisfies EphemeralOp)
    );
    this.broadcastSigned(ephEv);

    const storedEv = await buildSignedEvent(
      this.identity,
      30078,
      [
        ['d', `receipt:${this.clientId.slice(0, 12)}:${Date.now()}`],
        ['t', this.identity.roomTag],
      ],
      JSON.stringify({
        op: 'receipt',
        messageIds,
        status,
        fromClientId: this.clientId,
        timestamp: Date.now(),
      } satisfies StoredOp)
    );
    this.broadcastSigned(storedEv);
  }

  async sendMessage(envelope: EncryptedMessageEnvelope): Promise<void> {
    if (!this.identity) {
      this.identity = await deriveRelayIdentity(this.roomId, this.gateHash);
    }
    const cache =
      loadLocalCache(this.identity.cacheKey) || {
        createdAt: Date.now(),
        clearedAt: 0,
        deletedIds: [],
        messages: [],
      };
    if (!cache.messages.some((m) => m.id === envelope.id)) {
      cache.messages = [...cache.messages, envelope]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-500);
      saveLocalCache(this.identity.cacheKey, cache);
    }

    if (envelope.ciphertext.length <= CHUNK_SIZE) {
      const ev = await buildSignedEvent(
        this.identity,
        30078,
        [
          ['d', `msg:${envelope.id}`],
          ['t', this.identity.roomTag],
        ],
        JSON.stringify({ op: 'msg', envelope } satisfies StoredOp)
      );
      this.broadcastSigned(ev);
      return;
    }

    const total = Math.ceil(envelope.ciphertext.length / CHUNK_SIZE);
    for (let idx = 0; idx < total; idx++) {
      const slice = envelope.ciphertext.slice(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE);
      const chunkEv = await buildSignedEvent(
        this.identity,
        30078,
        [
          ['d', `chunk:${envelope.id}:${idx}`],
          ['t', this.identity.roomTag],
        ],
        JSON.stringify({
          op: 'chunk',
          id: envelope.id,
          idx,
          total,
          data: slice,
        } satisfies StoredOp)
      );
      this.broadcastSigned(chunkEv);
    }

    const metaEv = await buildSignedEvent(
      this.identity,
      30078,
      [
        ['d', `msg:${envelope.id}`],
        ['t', this.identity.roomTag],
      ],
      JSON.stringify({
        op: 'msg-chunked',
        total,
        envelope: { ...envelope, ciphertext: '' },
      } satisfies StoredOp)
    );
    this.broadcastSigned(metaEv);
  }

  async softDeleteMessage(messageId: string): Promise<void> {
    if (!this.identity) return;
    const cache = loadLocalCache(this.identity.cacheKey);
    if (cache) {
      cache.messages = cache.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              deletedForEveryone: true,
              deletedByClientId: this.clientId,
              iv: '',
              ciphertext: '',
            }
          : m
      );
      saveLocalCache(this.identity.cacheKey, cache);
    }
    const ev = await buildSignedEvent(
      this.identity,
      30078,
      [
        ['d', `msg:${messageId}`],
        ['t', this.identity.roomTag],
      ],
      JSON.stringify({
        op: 'soft-delete',
        messageId,
        deletedByClientId: this.clientId,
        timestamp: Date.now(),
      } satisfies StoredOp)
    );
    this.broadcastSigned(ev);
  }

  async deleteMessage(messageId: string): Promise<void> {
    if (!this.identity) return;
    const cache = loadLocalCache(this.identity.cacheKey);
    if (cache) {
      if (!cache.deletedIds.includes(messageId)) {
        cache.deletedIds = [...cache.deletedIds, messageId].slice(-500);
      }
      cache.messages = cache.messages.filter((m) => m.id !== messageId);
      saveLocalCache(this.identity.cacheKey, cache);
    }
    const ev = await buildSignedEvent(
      this.identity,
      30078,
      [
        ['d', `msg:${messageId}`],
        ['t', this.identity.roomTag],
      ],
      JSON.stringify({
        op: 'delete',
        messageId,
        timestamp: Date.now(),
      } satisfies StoredOp)
    );
    this.broadcastSigned(ev);
  }

  async clearRoom(): Promise<void> {
    if (!this.identity) return;
    const clearedAt = Date.now();
    const cache = loadLocalCache(this.identity.cacheKey);
    if (cache) {
      cache.clearedAt = clearedAt;
      cache.messages = [];
      saveLocalCache(this.identity.cacheKey, cache);
    }
    const ev = await buildSignedEvent(
      this.identity,
      30078,
      [
        ['d', `clear:${this.identity.roomTag.slice(0, 16)}`],
        ['t', this.identity.roomTag],
      ],
      JSON.stringify({ op: 'clear', clearedAt } satisfies StoredOp)
    );
    this.broadcastSigned(ev);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.emitPresence(false);
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    for (const ws of this.sockets.values()) {
      try {
        ws.close();
      } catch {
        // Ignore
      }
    }
    this.sockets.clear();
    if (this.bc) {
      try {
        this.bc.close();
      } catch {
        // Ignore
      }
    }
  }
}
