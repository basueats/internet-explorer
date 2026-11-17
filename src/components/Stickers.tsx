import React from 'react';

export interface StickerItem {
  id: string;
  label: string;
  renderSvg: (className?: string) => React.ReactNode;
}

export const STICKER_CATALOG: StickerItem[] = [
  {
    id: 'heart-pulse',
    label: 'Love',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#FFF1F2" />
        <path
          d="M60 92C60 92 26 70.4 26 46.5C26 35.7 34.4 28 44.5 28C51.2 28 57 31.6 60 36.8C63 31.6 68.8 28 75.5 28C85.6 28 94 35.7 94 46.5C94 70.4 60 92 60 92Z"
          fill="#E11D48"
        />
        <path
          d="M42 40C38 42 35 46 35 50"
          stroke="#FFE4E6"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    ),
  },
  {
    id: 'good-morning',
    label: 'Good Morning',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#FEF3C7" />
        <circle cx="60" cy="56" r="24" fill="#F59E0B" />
        <g stroke="#F59E0B" strokeWidth="5" strokeLinecap="round">
          <line x1="60" y1="18" x2="60" y2="26" />
          <line x1="60" y1="86" x2="60" y2="94" />
          <line x1="22" y1="56" x2="30" y2="56" />
          <line x1="90" y1="56" x2="98" y2="56" />
          <line x1="33" y1="29" x2="39" y2="35" />
          <line x1="81" y1="77" x2="87" y2="83" />
          <line x1="87" y1="29" x2="81" y2="35" />
          <line x1="39" y1="77" x2="33" y2="83" />
        </g>
        <path
          d="M52 54c0-2 3-2 3 0M65 54c0-2 3-2 3 0M52 63c3 4 13 4 16 0"
          stroke="#78350F"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    ),
  },
  {
    id: 'good-night',
    label: 'Good Night',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#1E293B" />
        <path
          d="M68 28A28 28 0 1 0 92 74A22 22 0 1 1 68 28Z"
          fill="#FDE047"
        />
        <circle cx="80" cy="36" r="3" fill="#FEF08A" />
        <circle cx="90" cy="52" r="2.5" fill="#FEF08A" />
        <circle cx="42" cy="34" r="2" fill="#FEF08A" />
      </svg>
    ),
  },
  {
    id: 'coffee-break',
    label: 'Coffee',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#FFEDD5" />
        <rect x="34" y="48" width="46" height="40" rx="10" fill="#9A3412" />
        <path
          d="M80 56h8a8 8 0 0 1 0 16h-8"
          stroke="#9A3412"
          strokeWidth="6"
          fill="none"
        />
        <path
          d="M46 38c0-6 6-6 6-12M62 38c0-6 6-6 6-12"
          stroke="#EA580C"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    ),
  },
  {
    id: 'thumbs-yes',
    label: 'Yes!',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#DBEAFE" />
        <rect x="28" y="54" width="16" height="34" rx="5" fill="#1D4ED8" />
        <path
          d="M44 56l14-24c3-5 10-3 10 3v15h18c5 0 9 4 8 9l-4 22c-1 4-4 7-9 7H44V56z"
          fill="#2563EB"
        />
      </svg>
    ),
  },
  {
    id: 'hug-warm',
    label: 'Hugs',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#FCE7F3" />
        <circle cx="60" cy="60" r="30" fill="#FBBF24" />
        <path
          d="M46 54c2-3 6-3 8 0M66 54c2-3 6-3 8 0"
          stroke="#78350F"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M48 66c4 6 20 6 24 0"
          stroke="#78350F"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M28 66c6-6 14-2 16 6l6 14M92 66c-6-6-14-2-16 6l-6 14"
          stroke="#EC4899"
          strokeWidth="7"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    ),
  },
  {
    id: 'wink-smile',
    label: 'Wink',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#ECFDF5" />
        <circle cx="60" cy="60" r="32" fill="#FACC15" />
        <circle cx="48" cy="54" r="4.5" fill="#713F12" />
        <path
          d="M66 54c3-3 7-3 10 0"
          stroke="#713F12"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M46 68c5 7 23 7 28 0"
          stroke="#713F12"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    ),
  },
  {
    id: 'laugh-tears',
    label: 'Haha',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#FEF9C3" />
        <circle cx="60" cy="60" r="32" fill="#FBBF24" />
        <path
          d="M42 52l9-5-9-5M78 52l-9-5 9-5"
          stroke="#78350F"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path d="M44 65h32c0 12-8 18-16 18s-16-6-16-18z" fill="#991B1B" />
        <circle cx="32" cy="62" r="5" fill="#38BDF8" />
        <circle cx="88" cy="62" r="5" fill="#38BDF8" />
      </svg>
    ),
  },
  {
    id: 'kiss-blow',
    label: 'Kiss',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#FFF1F2" />
        <circle cx="56" cy="60" r="30" fill="#FDE047" />
        <circle cx="46" cy="54" r="4" fill="#713F12" />
        <path
          d="M60 54c3-3 7-3 10 0"
          stroke="#713F12"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M54 66c3 0 6 2 4 4 2 2-1 4-4 4"
          stroke="#713F12"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M84 58c0-5 7-7 10-2 3-5 10-3 10 2 0 7-10 13-10 13s-10-6-10-13z"
          fill="#E11D48"
        />
      </svg>
    ),
  },
  {
    id: 'on-my-way',
    label: 'On My Way',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#E0F2FE" />
        <path
          d="M28 68l60-24-22 52-10-20-28-8z"
          fill="#0284C7"
        />
        <path
          d="M56 76l32-32"
          stroke="#BAE6FD"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'celebrate',
    label: 'Yay!',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#EDE9FE" />
        <path d="M34 86l16-44 28 28-44 16z" fill="#7C3AED" />
        <circle cx="76" cy="36" r="5" fill="#F59E0B" />
        <circle cx="90" cy="54" r="4" fill="#EC4899" />
        <circle cx="54" cy="28" r="4" fill="#10B981" />
        <path
          d="M66 52l14-14M74 64l18-6"
          stroke="#F59E0B"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'safe-vault',
    label: 'Private',
    renderSvg: (c = 'w-24 h-24') => (
      <svg viewBox="0 0 120 120" className={c}>
        <circle cx="60" cy="60" r="52" fill="#EFF6FF" />
        <path
          d="M60 22L32 34v22c0 20 12 38 28 44 16-6 28-24 28-44V34L60 22z"
          fill="#2C6BED"
        />
        <path
          d="M49 60l8 8 15-16"
          stroke="#FFFFFF"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    ),
  },
];

interface StickerPickerProps {
  onSelectSticker: (sticker: StickerItem) => void;
  onClose: () => void;
}

export const StickerPicker: React.FC<StickerPickerProps> = ({
  onSelectSticker,
  onClose,
}) => {
  return (
    <div
      role="dialog"
      aria-label="Choose encrypted sticker"
      className="w-72 sm:w-80 rounded-2xl bg-white dark:bg-[#141923] border border-slate-200 dark:border-slate-800 shadow-xl p-3 space-y-2.5"
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Encrypted Stickers
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto veil-scroll">
        {STICKER_CATALOG.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            title={sticker.label}
            aria-label={`Send ${sticker.label} sticker`}
            onClick={() => onSelectSticker(sticker)}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex flex-col items-center justify-center gap-1 transition-transform active:scale-95"
          >
            {sticker.renderSvg('w-12 h-12')}
            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-full">
              {sticker.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
