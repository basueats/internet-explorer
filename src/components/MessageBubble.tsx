import React, { useState } from 'react';
import {
  Ban,
  Check,
  CheckCheck,
  Code2,
  Copy,
  CornerUpLeft,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Lock,
  MapPin,
  Trash2,
  User,
} from 'lucide-react';
import { formatBytes, formatTimeRemaining } from '../lib/media';
import type { ChatMessage, DecryptedMessagePayload, ReceiptStatus } from '../types';
import { STICKER_CATALOG } from './Stickers';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';

interface MessageBubbleProps {
  message: ChatMessage;
  nowMs: number;
  forceRevealDeleted?: boolean;
  onReply: (message: ChatMessage) => void;
  onRequestDelete: (message: ChatMessage) => void;
  onPurgeDeleted?: (messageId: string) => void;
  onInspectCipher: (message: ChatMessage) => void;
  onOpenImage: (src: string, caption?: string) => void;
}

function ReceiptTickIcon({ status }: { status?: ReceiptStatus }) {
  if (status === 'read') {
    return (
      <span
        title="Read by partner"
        aria-label="Read by partner"
        className="inline-flex items-center text-[#0284C7] dark:text-[#38BDF8]"
      >
        <CheckCheck className="w-4 h-4 stroke-[2.4]" />
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span
        title="Delivered to partner"
        aria-label="Delivered to partner"
        className="inline-flex items-center text-slate-400 dark:text-slate-400"
      >
        <CheckCheck className="w-4 h-4 stroke-[2.2]" />
      </span>
    );
  }
  return (
    <span
      title="Sent to encrypted vault"
      aria-label="Sent"
      className="inline-flex items-center text-slate-400 dark:text-slate-400"
    >
      <Check className="w-3.5 h-3.5 stroke-[2.2]" />
    </span>
  );
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  nowMs,
  forceRevealDeleted = false,
  onReply,
  onRequestDelete,
  onPurgeDeleted,
  onInspectCipher,
  onOpenImage,
}) => {
  const [revealedLocally, setRevealedLocally] = useState(false);
  const [copiedContact, setCopiedContact] = useState(false);

  const {
    payload,
    archivedPayload,
    decryptError,
    isMine,
    expiresAt,
    envelope,
    deletedScope,
    receiptStatus,
  } = message;

  const formattedTime = new Date(
    payload?.createdAt || archivedPayload?.createdAt || envelope.timestamp
  ).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const remainingMs = expiresAt ? expiresAt - nowMs : null;

  if (deletedScope) {
    const canReveal = Boolean(archivedPayload);
    const isRevealed = canReveal && (forceRevealDeleted || revealedLocally);

    return (
      <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
        <div
          className={`max-w-[88%] sm:max-w-[74%] lg:max-w-[65%] rounded-2xl px-3.5 py-2.5 border text-xs space-y-2 ${
            isMine
              ? 'bg-slate-100 dark:bg-[#141A24] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
              : 'bg-slate-50 dark:bg-[#121721] border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          <div className="flex items-center flex-wrap gap-2">
            <Ban className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="italic">
              {deletedScope === 'me'
                ? 'You deleted this message (for you)'
                : message.deletedByMe
                  ? 'You deleted this message for everyone'
                  : 'This message was deleted'}
            </span>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {formattedTime}
            </span>

            {canReveal && (
              <button
                type="button"
                onClick={() => setRevealedLocally((v) => !v)}
                className="ml-auto inline-flex items-center gap-1 font-semibold text-[#2C6BED] dark:text-blue-400 hover:underline"
              >
                {isRevealed ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Hide</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>Show</span>
                  </>
                )}
              </button>
            )}
          </div>

          {isRevealed && archivedPayload && (
            <div className="pt-2 border-t border-dashed border-slate-300 dark:border-slate-700 space-y-2">
              <div className="text-[11px] text-slate-400 flex items-center justify-between gap-2">
                <span>Recovered from your local encrypted archive</span>
                {onPurgeDeleted && (
                  <button
                    type="button"
                    onClick={() => onPurgeDeleted(message.id)}
                    className="text-red-600 dark:text-red-400 hover:underline font-medium"
                  >
                    Purge permanently
                  </button>
                )}
              </div>
              {renderPayloadContent(
                archivedPayload,
                false,
                onOpenImage,
                copiedContact,
                setCopiedContact
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (decryptError || !payload) {
    return (
      <div className="flex justify-center my-2">
        <div className="max-w-md px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>Encrypted message could not be decrypted with the current passphrase.</span>
        </div>
      </div>
    );
  }

  if (payload.kind === 'sticker' && payload.stickerId) {
    const sticker = STICKER_CATALOG.find((s) => s.id === payload.stickerId);
    return (
      <div className={`group flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
        {!isMine && (
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 px-1">
            {payload.senderAlias}
          </span>
        )}
        <div className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className="flex flex-col items-end">
            <div className="p-1">
              {sticker ? (
                sticker.renderSvg('w-28 h-28 sm:w-32 sm:h-32')
              ) : (
                <span className="text-sm text-slate-500">{payload.stickerLabel || 'Sticker'}</span>
              )}
            </div>
            <div className="px-2 flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span>{formattedTime}</span>
              {remainingMs !== null && remainingMs > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatTimeRemaining(remainingMs)}</span>
                </>
              )}
              {isMine && <ReceiptTickIcon status={receiptStatus} />}
            </div>
          </div>

          <QuickActions
            message={message}
            onReply={onReply}
            onInspectCipher={onInspectCipher}
            onRequestDelete={onRequestDelete}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
      {!isMine && (
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 px-1">
          {payload.senderAlias}
        </span>
      )}

      <div
        className={`flex items-end gap-2 max-w-[88%] sm:max-w-[74%] lg:max-w-[65%] ${
          isMine ? 'flex-row-reverse' : 'flex-row'
        }`}
      >
        <div
          className={`rounded-2xl overflow-hidden transition-colors ${
            isMine
              ? 'bg-[#E8F1FF] dark:bg-[#152544] text-slate-900 dark:text-slate-100 border border-blue-200/80 dark:border-blue-800/60 rounded-br-md'
              : 'bg-[#F1F3F6] dark:bg-[#171D29] text-slate-900 dark:text-slate-100 border border-slate-200/70 dark:border-slate-800 rounded-bl-md'
          }`}
        >
          {payload.replyTo && (
            <div
              className={`mx-3 mt-2.5 px-3 py-1.5 rounded-lg text-xs ${
                isMine
                  ? 'bg-white/80 dark:bg-[#0F1B33] text-slate-700 dark:text-slate-200 border border-blue-200/60 dark:border-blue-800/50'
                  : 'bg-white/80 dark:bg-[#10151F] text-slate-600 dark:text-slate-300 border border-slate-200/70 dark:border-slate-800'
              }`}
            >
              <div className="font-semibold truncate">{payload.replyTo.senderAlias}</div>
              <div className="truncate opacity-85">{payload.replyTo.snippet}</div>
            </div>
          )}

          {renderPayloadContent(
            payload,
            isMine,
            onOpenImage,
            copiedContact,
            setCopiedContact
          )}

          <div className="px-3.5 pb-2 pt-1 flex items-center justify-end gap-1.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            <span>{formattedTime}</span>
            {remainingMs !== null && remainingMs > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatTimeRemaining(remainingMs)}</span>
              </>
            )}
            {isMine && <ReceiptTickIcon status={receiptStatus} />}
          </div>
        </div>

        <QuickActions
          message={message}
          onReply={onReply}
          onInspectCipher={onInspectCipher}
          onRequestDelete={onRequestDelete}
        />
      </div>
    </div>
  );
};

function QuickActions({
  message,
  onReply,
  onInspectCipher,
  onRequestDelete,
}: {
  message: ChatMessage;
  onReply: (m: ChatMessage) => void;
  onInspectCipher: (m: ChatMessage) => void;
  onRequestDelete: (m: ChatMessage) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
      <button
        type="button"
        onClick={() => onReply(message)}
        aria-label="Reply to message"
        title="Reply"
        className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
      >
        <CornerUpLeft className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onInspectCipher(message)}
        aria-label="Inspect encrypted ciphertext"
        title="Inspect AES-256-GCM ciphertext"
        className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
      >
        <Code2 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onRequestDelete(message)}
        aria-label="Delete message"
        title="Delete message"
        className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function renderPayloadContent(
  payload: DecryptedMessagePayload,
  isMine: boolean,
  onOpenImage: (src: string, caption?: string) => void,
  copiedContact: boolean,
  setCopiedContact: (v: boolean) => void
) {
  return (
    <>
      {payload.kind === 'image' && payload.imageDataUrl && (
        <div className="p-1.5 pb-0">
          <button
            type="button"
            onClick={() => onOpenImage(payload.imageDataUrl!, payload.text)}
            aria-label="Open encrypted photo full screen"
            className="block rounded-xl overflow-hidden focus-visible:outline-2 focus-visible:outline-[#2C6BED] cursor-zoom-in"
          >
            <img
              src={payload.imageDataUrl}
              alt={payload.text || payload.imageName || 'Encrypted shared photo'}
              referrerPolicy="no-referrer"
              className="max-h-80 w-auto object-cover rounded-xl"
            />
          </button>
        </div>
      )}

      {payload.kind === 'video' && payload.videoDataUrl && (
        <div className="p-1.5 pb-0">
          <video
            src={payload.videoDataUrl}
            controls
            playsInline
            className="max-h-80 w-full rounded-xl bg-black"
          />
        </div>
      )}

      {payload.kind === 'voice' && payload.audioDataUrl && (
        <div className="px-3.5 pt-3 pb-1 space-y-1">
          {payload.audioName && (
            <div className="text-[11px] font-medium truncate text-slate-500 dark:text-slate-400">
              {payload.audioName}
            </div>
          )}
          <VoiceMessagePlayer
            audioDataUrl={payload.audioDataUrl}
            durationSec={payload.audioDuration || 1}
            waveform={payload.waveform || []}
            isMine={isMine}
          />
        </div>
      )}

      {payload.kind === 'document' && payload.docDataUrl && (
        <div className="px-3.5 pt-3 pb-1">
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white dark:bg-[#10151F] border border-slate-200/80 dark:border-slate-800">
            <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400">
              <FileText className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate text-slate-900 dark:text-white">
                {payload.docName || 'Encrypted Document'}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {payload.docSize ? formatBytes(payload.docSize) : 'Document'}
              </div>
            </div>
            <a
              href={payload.docDataUrl}
              download={payload.docName || 'document'}
              aria-label="Download decrypted document"
              className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center transition-colors shrink-0 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200"
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
        </div>
      )}

      {payload.kind === 'contact' && (
        <div className="px-3.5 pt-3 pb-1 min-w-[230px]">
          <div className="p-3 rounded-xl space-y-2 bg-white dark:bg-[#10151F] border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
                <User className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate text-slate-900 dark:text-white">
                  {payload.contactName}
                </div>
                <div className="text-xs font-mono truncate text-slate-500 dark:text-slate-400">
                  {payload.contactPhoneOrHandle}
                </div>
              </div>
            </div>
            {payload.contactNote && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {payload.contactNote}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(
                  `${payload.contactName}: ${payload.contactPhoneOrHandle}`
                );
                setCopiedContact(true);
                setTimeout(() => setCopiedContact(false), 1800);
              }}
              className="w-full min-h-[36px] rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiedContact ? 'Contact Copied' : 'Copy Contact'}</span>
            </button>
          </div>
        </div>
      )}

      {payload.kind === 'location' && (
        <div className="px-3.5 pt-3 pb-1 min-w-[240px]">
          <div className="p-3 rounded-xl space-y-2 bg-white dark:bg-[#10151F] border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-start gap-2.5">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                <MapPin className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate text-slate-900 dark:text-white">
                  {payload.locationLabel || 'Shared Device Location'}
                </div>
                {typeof payload.latitude === 'number' && typeof payload.longitude === 'number' && (
                  <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {payload.latitude.toFixed(5)}, {payload.longitude.toFixed(5)}
                    {payload.accuracyMeters ? ` (±${payload.accuracyMeters}m)` : ''}
                  </div>
                )}
                {payload.ipAddress && (
                  <div className="text-[11px] font-mono tabular-nums mt-0.5 text-slate-500 dark:text-slate-400">
                    Device IP: {payload.ipAddress}
                  </div>
                )}
              </div>
            </div>

            {typeof payload.latitude === 'number' && typeof payload.longitude === 'number' && (
              <a
                href={`https://maps.google.com/?q=${payload.latitude},${payload.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="w-full min-h-[36px] rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Maps</span>
              </a>
            )}
          </div>
        </div>
      )}

      {payload.text && (
        <p className="px-3.5 pt-2.5 pb-1 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
          {payload.text}
        </p>
      )}
    </>
  );
}
