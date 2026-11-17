import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { ChatMessage, SpaceSession } from '../types';

/* 1. Safety Number & Private Invite Modal */
interface SafetyNumberModalProps {
  session: SpaceSession;
  onClose: () => void;
}

export const SafetyNumberModal: React.FC<SafetyNumberModalProps> = ({
  session,
  onClose,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCreds, setCopiedCreds] = useState(false);

  const inviteUrl = `${window.location.origin}/?space=${encodeURIComponent(
    session.normalizedName
  )}#${encodeURIComponent(session.passphrase)}`;

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Ignore
    }
  };

  const handleCopyCreds = async () => {
    const text = `Space Name: ${session.normalizedName}\nPassphrase: ${session.passphrase}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCreds(true);
      setTimeout(() => setCopiedCreds(false), 2000);
    } catch {
      // Ignore
    }
  };

  const blocks = session.safetyNumber.split(' ');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="safety-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 p-6 space-y-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2
              id="safety-modal-title"
              className="text-lg font-semibold text-slate-900 dark:text-white"
            >
              Safety Number & Partner Invite
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Space: {session.normalizedName} · AES-256-GCM
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close safety number modal"
            className="min-h-[40px] min-w-[40px] rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Compare this 60-digit safety number with your partner to verify you share the
          exact same end-to-end encryption keys.
        </p>

        <div className="grid grid-cols-4 gap-2.5 p-4 rounded-xl bg-slate-50 dark:bg-[#0D1119] border border-slate-200/80 dark:border-slate-800 font-mono tabular-nums text-sm text-center text-slate-800 dark:text-slate-100">
          {blocks.map((block, idx) => (
            <span key={idx} className="tracking-wider">
              {block}
            </span>
          ))}
        </div>

        <div className="space-y-2.5 pt-1">
          <button
            type="button"
            onClick={handleCopyInvite}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>
              {copiedLink ? 'Private Invite Link Copied' : 'Copy Private Invite Link'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleCopyCreds}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            {copiedCreds ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>
              {copiedCreds
                ? 'Space Name & Passphrase Copied'
                : 'Copy Space Name & Passphrase'}
            </span>
          </button>

          <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
            The secret passphrase stays in the URL hash fragment and is never sent to the server.
          </p>
        </div>
      </div>
    </div>
  );
};

/* 2. Ciphertext Envelope Inspector Modal */
interface CipherInspectorModalProps {
  message: ChatMessage;
  onClose: () => void;
}

export const CipherInspectorModal: React.FC<CipherInspectorModalProps> = ({
  message,
  onClose,
}) => {
  const truncatedCipher =
    message.envelope.ciphertext.length > 420
      ? `${message.envelope.ciphertext.slice(0, 420)}… (${message.envelope.ciphertext.length} chars total)`
      : message.envelope.ciphertext;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cipher-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2
              id="cipher-modal-title"
              className="text-lg font-semibold text-slate-900 dark:text-white"
            >
              Encrypted Server Envelope
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Exact unreadable payload stored by the server
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ciphertext inspector"
            className="min-h-[40px] min-w-[40px] rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs font-mono">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-slate-800">
            <div className="text-slate-400 mb-1">Cipher Suite</div>
            <div className="text-slate-800 dark:text-slate-200">
              AES-256-GCM · PBKDF2-HMAC-SHA256 (150,000 iterations)
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-slate-800">
            <div className="text-slate-400 mb-1">Random 96-bit IV (Base64)</div>
            <div className="text-slate-800 dark:text-slate-200 break-all">
              {message.envelope.iv}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-slate-800">
            <div className="text-slate-400 mb-1">Encrypted Ciphertext (Base64)</div>
            <div className="text-slate-800 dark:text-slate-200 break-all max-h-40 overflow-y-auto veil-scroll">
              {truncatedCipher}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* 3. Fullscreen Image Lightbox */
interface ImageLightboxProps {
  src: string;
  caption?: string;
  onClose: () => void;
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  src,
  caption,
  onClose,
}) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Encrypted photo viewer"
      className="fixed inset-0 z-50 flex flex-col bg-black/92 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-4 pb-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-slate-300 font-medium">
          Decrypted locally in your browser
        </span>
        <div className="flex items-center gap-2">
          <a
            href={src}
            download={`veil-photo-${Date.now()}.jpg`}
            className="min-h-[44px] px-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium flex items-center gap-2 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Save</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close photo viewer"
            className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center">
        <img
          src={src}
          alt={caption || 'Decrypted photo'}
          referrerPolicy="no-referrer"
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain rounded-xl"
        />
      </div>

      {caption && (
        <p className="text-center text-sm text-slate-200 pt-3 max-w-2xl mx-auto">
          {caption}
        </p>
      )}
    </div>
  );
};

/* 4. Delete Message Choice Modal (Delete for Me / Delete for Everyone) */
interface DeleteMessageModalProps {
  message: ChatMessage;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onClose: () => void;
}

export const DeleteMessageModal: React.FC<DeleteMessageModalProps> = ({
  message,
  onDeleteForMe,
  onDeleteForEveryone,
  onClose,
}) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl"
      >
        <div className="space-y-1">
          <h2
            id="delete-modal-title"
            className="text-base font-semibold text-slate-900 dark:text-white"
          >
            Delete Message
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Deleted messages stay encrypted in your private device archive so you can still
            tap &ldquo;Show&rdquo; later if needed.
          </p>
        </div>

        <div className="space-y-2">
          {message.isMine && (
            <button
              type="button"
              onClick={onDeleteForEveryone}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Users className="w-4 h-4" />
              <span>Delete for everyone</span>
            </button>
          )}

          <button
            type="button"
            onClick={onDeleteForMe}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-[#1A2130] hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-900 dark:text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Trash2 className="w-4 h-4 text-slate-500" />
            <span>Delete for me</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[42px] px-4 py-2 rounded-xl text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

/* 5. Privacy Screen Lock Veil (Zero-Leakage: hides all notifications while locked) */
interface PrivacyLockScreenProps {
  spaceName: string;
  expectedPassphrase: string;
  onUnlock: () => void;
  onExitSpace: () => void;
}

export const PrivacyLockScreen: React.FC<PrivacyLockScreenProps> = ({
  spaceName,
  expectedPassphrase,
  onUnlock,
  onExitSpace,
}) => {
  const [input, setInput] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input === expectedPassphrase) {
      setInput('');
      setError(false);
      onUnlock();
    } else {
      setError(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-[#0B0E14] flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-[#2C6BED]/10 text-[#2C6BED] dark:text-blue-400 flex items-center justify-center">
          <Lock className="w-7 h-7" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Space Locked
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Notifications and messages are hidden until you unlock{' '}
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {spaceName}
            </span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              autoFocus
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(false);
              }}
              placeholder="Secret passphrase"
              className="w-full min-h-[46px] pl-3.5 pr-12 py-2.5 rounded-xl bg-slate-100 dark:bg-[#141923] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2C6BED]"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide passphrase' : 'Show passphrase'}
              className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Incorrect passphrase. Try again.
            </p>
          )}

          <button
            type="submit"
            className="w-full min-h-[46px] rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Unlock Space</span>
          </button>
        </form>

        <button
          type="button"
          onClick={onExitSpace}
          className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline"
        >
          Leave space completely
        </button>
      </div>
    </div>
  );
};
