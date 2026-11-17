import { useEffect, useState } from 'react';
import { ChatWorkspace } from './components/ChatWorkspace';
import { VaultEntry } from './components/VaultEntry';
import { connectAndJoinSpace } from './lib/api';
import { deriveSpaceCredentials, getOrCreateClientId } from './lib/crypto';
import {
  getSavedLastSession,
  saveLastSession,
  setAutoResumeSession,
} from './lib/session';
import type { EncryptedMessageEnvelope, SpaceSession } from './types';

export default function App() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('veil_theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;
    }
  });

  const [activeSpace, setActiveSpace] = useState<{
    session: SpaceSession;
    initialMessages: EncryptedMessageEnvelope[];
    isNewSpace: boolean;
  } | null>(null);

  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('space') && window.location.hash.length > 1) {
        return false; // Let VaultEntry handle direct meeting/invite link auto-join
      }
      const saved = getSavedLastSession();
      return Boolean(saved && saved.autoResume);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('veil_theme', isDark ? 'dark' : 'light');
    } catch {
      // Ignore storage failures
    }
  }, [isDark]);

  // Restore last active session automatically on page refresh / browser reopen
  useEffect(() => {
    if (!isRestoringSession || activeSpace) return;
    let cancelled = false;

    async function restore() {
      const saved = getSavedLastSession();
      if (!saved || !saved.autoResume) {
        if (!cancelled) setIsRestoringSession(false);
        return;
      }

      try {
        const { bookmark } = saved;
        const creds = await deriveSpaceCredentials(bookmark.spaceName, bookmark.passphrase);
        const result = await connectAndJoinSpace({
          roomId: creds.roomId,
          gateHash: creds.gateHash,
          mode: 'auto',
        });

        if (!cancelled && result.ok && result.data.ok) {
          setActiveSpace({
            session: {
              spaceName: bookmark.spaceName,
              normalizedName: creds.normalizedName,
              passphrase: bookmark.passphrase,
              alias: bookmark.alias,
              clientId: getOrCreateClientId(),
              roomId: creds.roomId,
              gateHash: creds.gateHash,
              aesKey: creds.aesKey,
              safetyNumber: creds.safetyNumber,
              keyFingerprint: creds.keyFingerprint,
              transport: result.transport,
            },
            initialMessages: result.data.messages || [],
            isNewSpace: Boolean(result.data.isNew),
          });
        }
      } catch {
        // Fall back to VaultEntry where Last Session card remains available
      } finally {
        if (!cancelled) setIsRestoringSession(false);
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, [isRestoringSession, activeSpace]);

  const toggleTheme = () => setIsDark((prev) => !prev);

  if (isRestoringSession) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-white dark:bg-[#0B0E14] text-slate-600 dark:text-slate-300 text-sm">
        Reconnecting to your last session...
      </div>
    );
  }

  if (!activeSpace) {
    return (
      <VaultEntry
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onEnterSpace={(session, initialMessages, isNewSpace) => {
          saveLastSession(
            {
              spaceName: session.spaceName,
              normalizedName: session.normalizedName,
              passphrase: session.passphrase,
              alias: session.alias,
              updatedAt: Date.now(),
            },
            true
          );
          setActiveSpace({ session, initialMessages, isNewSpace });
        }}
      />
    );
  }

  return (
    <ChatWorkspace
      session={activeSpace.session}
      initialEnvelopes={activeSpace.initialMessages}
      isNewSpace={activeSpace.isNewSpace}
      isDark={isDark}
      onToggleTheme={toggleTheme}
      onLeaveSpace={() => {
        // Keep last session saved in localStorage + push subscription intact so user can resume or reuse link
        setAutoResumeSession(false);
        setActiveSpace(null);
      }}
    />
  );
}
