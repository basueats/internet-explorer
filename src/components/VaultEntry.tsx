import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react';
import {
  deriveSpaceCredentials,
  generatePassphrase,
  generateUniqueSpaceName,
  getOrCreateClientId,
  normalizeSpaceName,
} from '../lib/crypto';
import { joinRoomViaWebSocket, ProxyAuthError, safeFetchJson } from '../lib/api';
import {
  buildMeetingInviteUrl,
  clearSavedLastSession,
  getSavedLastSession,
  type SavedSpaceBookmark,
} from '../lib/session';
import type { EncryptedMessageEnvelope, SpaceSession } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface VaultEntryProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onEnterSpace: (
    session: SpaceSession,
    initialMessages: EncryptedMessageEnvelope[],
    isNewSpace: boolean
  ) => void;
}

export const VaultEntry: React.FC<VaultEntryProps> = ({
  isDark,
  onToggleTheme,
  onEnterSpace,
}) => {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [spaceName, setSpaceName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [alias, setAlias] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsSessionReload, setNeedsSessionReload] = useState(false);
  const [suggestedAvailableName, setSuggestedAvailableName] = useState<string | null>(null);
  const [lastSession, setLastSession] = useState<SavedSpaceBookmark | null>(
    () => getSavedLastSession()?.bookmark ?? null
  );
  const [copiedLastLink, setCopiedLastLink] = useState(false);

  const openSpaceWithCredentials = async (
    rawName: string,
    rawPassphrase: string,
    rawAlias: string,
    entryMode: 'create' | 'join' | 'auto'
  ) => {
    setErrorMsg(null);
    setNeedsSessionReload(false);
    setSuggestedAvailableName(null);

    const normalized = normalizeSpaceName(rawName);
    if (!normalized) {
      setErrorMsg('Enter a unique space name using letters or numbers.');
      return;
    }
    if (rawPassphrase.trim().length < 4) {
      setErrorMsg('Secret passphrase must be at least 4 characters.');
      return;
    }

    const cleanAlias =
      rawAlias.trim() || (entryMode === 'create' ? 'Partner A' : 'Partner B');

    setIsSubmitting(true);
    try {
      const creds = await deriveSpaceCredentials(normalized, rawPassphrase);
      type JoinResponse = {
        ok?: boolean;
        isNew?: boolean;
        code?: string;
        messages?: EncryptedMessageEnvelope[];
        error?: string;
      };

      let result: { status: number; ok: boolean; data: JoinResponse };
      try {
        result = await safeFetchJson<JoinResponse>('/api/rooms/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: creds.roomId,
            gateHash: creds.gateHash,
            mode: entryMode,
          }),
        });
      } catch (err) {
        if (err instanceof ProxyAuthError) {
          try {
            result = await joinRoomViaWebSocket<JoinResponse>({
              roomId: creds.roomId,
              gateHash: creds.gateHash,
              mode: entryMode,
            });
          } catch {
            setNeedsSessionReload(true);
            throw new Error(
              'Your browser blocked or expired the preview session cookie (HTTP 403). Click "Refresh Session" or open the app in a new tab.'
            );
          }
        } else {
          throw err;
        }
      }

      if (!result.ok || !result.data.ok) {
        if (result.status === 409 || result.data.code === 'SPACE_NAME_TAKEN') {
          const suffix = Math.floor(100 + Math.random() * 900);
          setSuggestedAvailableName(`${normalized}-${suffix}`);
        }
        throw new Error(result.data.error || 'Could not open this private space.');
      }

      if (window.location.hash || window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }

      const session: SpaceSession = {
        spaceName: normalized,
        normalizedName: creds.normalizedName,
        passphrase: rawPassphrase,
        alias: cleanAlias,
        clientId: getOrCreateClientId(),
        roomId: creds.roomId,
        gateHash: creds.gateHash,
        aesKey: creds.aesKey,
        safetyNumber: creds.safetyNumber,
        keyFingerprint: creds.keyFingerprint,
      };

      onEnterSpace(session, result.data.messages || [], Boolean(result.data.isNew));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to unlock space.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Support opening & reusing meeting/invite link: ?space=name#passphrase
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const invitedSpace = url.searchParams.get('space');
      const invitedKey = window.location.hash.replace(/^#/, '');
      if (invitedSpace) {
        const decodedSpace = decodeURIComponent(invitedSpace);
        setSpaceName(decodedSpace);
        setMode('join');
        if (invitedKey) {
          const decodedKey = decodeURIComponent(invitedKey);
          setPassphrase(decodedKey);
          void openSpaceWithCredentials(decodedSpace, decodedKey, '', 'auto');
        }
      } else if (invitedKey) {
        setPassphrase(decodeURIComponent(invitedKey));
      }
    } catch {
      // Ignore malformed URL params
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSuggestName = () => {
    setSpaceName(generateUniqueSpaceName());
    setErrorMsg(null);
  };

  const handleGeneratePassphrase = () => {
    setPassphrase(generatePassphrase());
    setShowPassphrase(true);
    setErrorMsg(null);
  };

  const handleRefreshPreviewSession = async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // Ignore cache clear failure
    }
    window.location.reload();
  };

  const handleCopyLastSessionLink = async () => {
    if (!lastSession) return;
    try {
      const inviteUrl = buildMeetingInviteUrl(
        lastSession.normalizedName,
        lastSession.passphrase
      );
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLastLink(true);
      setTimeout(() => setCopiedLastLink(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleForgetLastSession = () => {
    clearSavedLastSession();
    setLastSession(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await openSpaceWithCredentials(spaceName, passphrase, alias, mode);
  };

  return (
    <div className="min-h-dvh flex flex-col bg-white dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100">
      {/* Top Bar (3-zone clean header) */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 shrink-0">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <span className="w-8 h-8 rounded-lg bg-[#2C6BED] text-white flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          </span>
          <span className="text-lg font-bold tracking-tight">Internet Edge</span>
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
          <span>Zero Phone or Email</span>
          <span aria-hidden="true">·</span>
          <span>AES-256-GCM Client Encryption</span>
          <span aria-hidden="true">·</span>
          <span>Private for Two</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:block">
            <PWAInstallButton />
          </div>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="min-h-[44px] min-w-[44px] px-3 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 flex items-center justify-center gap-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2C6BED]"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      {/* Main Centered Space Access Workspace */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <section className="w-full max-w-md space-y-7">
            <div className="space-y-3">
              <p className="text-xs font-medium text-[#2C6BED] dark:text-blue-400">
                End-to-End Encrypted Space
              </p>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white [text-wrap:balance]">
                A quiet signal just for the two of you.
              </h1>
              <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                Open your private space with a unique name and shared passphrase. No phone
                number, no email address, and zero readable data on the server.
              </p>
            </div>

            {lastSession && (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#131720] border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[#2C6BED] dark:text-blue-400">
                      Last Session
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {lastSession.normalizedName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      Alias: {lastSession.alias}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleForgetLastSession}
                    aria-label="Remove saved last session"
                    title="Remove saved last session"
                    className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center transition-colors shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      void openSpaceWithCredentials(
                        lastSession.spaceName,
                        lastSession.passphrase,
                        lastSession.alias,
                        'auto'
                      )
                    }
                    className="flex-1 min-h-[42px] px-3.5 py-2 rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Resume Space</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyLastSessionLink}
                    className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white dark:bg-[#1A202D] border border-slate-200 dark:border-slate-700 hover:border-[#2C6BED]/50 text-slate-800 dark:text-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {copiedLastLink ? (
                      <Check className="w-3.5 h-3.5 text-[#2C6BED]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[#2C6BED]" />
                    )}
                    <span>{copiedLastLink ? 'Link Copied' : 'Copy Link'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Mode Selector (Interactive segmented control) */}
            <div
              role="tablist"
              aria-label="Space entry mode"
              className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-[#141923] rounded-xl border border-slate-200/70 dark:border-slate-800"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'create'}
                onClick={() => {
                  setMode('create');
                  setErrorMsg(null);
                }}
                className={`min-h-[44px] px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'create'
                    ? 'bg-white dark:bg-[#1E2533] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Create Space
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'join'}
                onClick={() => {
                  setMode('join');
                  setErrorMsg(null);
                }}
                className={`min-h-[44px] px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'join'
                    ? 'bg-white dark:bg-[#1E2533] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Join Partner
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Unique Space Name */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="space-name"
                    className="text-sm font-medium text-slate-800 dark:text-slate-200"
                  >
                    Unique Space Name
                  </label>
                  {mode === 'create' && (
                    <button
                      type="button"
                      onClick={handleSuggestName}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2C6BED] dark:text-blue-400 hover:underline py-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Suggest unique name</span>
                    </button>
                  )}
                </div>
                <input
                  id="space-name"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={spaceName}
                  onChange={(e) => setSpaceName(e.target.value)}
                  placeholder="e.g. amber-harbor-48"
                  className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#131720] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C6BED] focus:border-transparent"
                  required
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Both you and your partner enter this exact name to meet inside.
                </p>
              </div>

              {/* Secret Passphrase */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="space-passphrase"
                    className="text-sm font-medium text-slate-800 dark:text-slate-200"
                  >
                    Shared Secret Passphrase
                  </label>
                  {mode === 'create' && (
                    <button
                      type="button"
                      onClick={handleGeneratePassphrase}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2C6BED] dark:text-blue-400 hover:underline py-1"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Generate strong phrase</span>
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="space-passphrase"
                    type={showPassphrase ? 'text' : 'password'}
                    autoComplete="off"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Never sent to the server"
                    className="w-full min-h-[46px] pl-3.5 pr-12 py-2.5 rounded-xl bg-slate-50 dark:bg-[#131720] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C6BED] focus:border-transparent"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase((v) => !v)}
                    aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg"
                  >
                    {showPassphrase ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Derives your local AES-256-GCM key via 150,000 PBKDF2 rounds.
                </p>
              </div>

              {/* Your Local Alias */}
              <div className="space-y-1.5">
                <label
                  htmlFor="partner-alias"
                  className="text-sm font-medium text-slate-800 dark:text-slate-200"
                >
                  Your Display Name <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  id="partner-alias"
                  type="text"
                  maxLength={28}
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder={mode === 'create' ? 'e.g. Sam' : 'e.g. Maya'}
                  className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#131720] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C6BED] focus:border-transparent"
                />
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-sm text-red-700 dark:text-red-300 space-y-2.5"
                >
                  <p>{errorMsg}</p>
                  {suggestedAvailableName && (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSpaceName(suggestedAvailableName);
                          setSuggestedAvailableName(null);
                          setErrorMsg(null);
                        }}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#2C6BED] hover:bg-[#2359C9] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>Use &ldquo;{suggestedAvailableName}&rdquo;</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('join');
                          setSuggestedAvailableName(null);
                          setErrorMsg(null);
                        }}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white dark:bg-[#1A202E] border border-red-200 dark:border-red-800/70 text-red-700 dark:text-red-200 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-red-100/60 dark:hover:bg-red-950/60 cursor-pointer"
                      >
                        <span>Switch to Join Partner</span>
                      </button>
                    </div>
                  )}
                  {needsSessionReload && (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={handleRefreshPreviewSession}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Refresh Session</span>
                      </button>
                      <a
                        href={window.location.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white dark:bg-[#1A202E] border border-red-200 dark:border-red-800/70 text-red-700 dark:text-red-200 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-red-100/60 dark:hover:bg-red-950/60"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open in New Tab</span>
                      </a>
                    </div>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2C6BED]"
              >
                <Lock className="w-4 h-4" />
                <span>
                  {isSubmitting
                    ? 'Deriving Encryption Keys...'
                    : mode === 'create'
                      ? 'Open Private Space'
                      : 'Unlock Partner Space'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
        </section>
      </main>
    </div>
  );
};
