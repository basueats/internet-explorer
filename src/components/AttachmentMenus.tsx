import React, { useEffect, useState } from 'react';
import {
  Camera,
  Copy,
  FileText,
  Headphones,
  Image as ImageIcon,
  MapPin,
  RefreshCw,
  Send,
  User,
  X,
} from 'lucide-react';
import {
  type ExactGeoLocation,
  fetchDeviceNetworkInfo,
  getExactGeoPosition,
} from '../lib/device';
import type { DeviceNetworkInfo } from '../types';

/* 1. WhatsApp-style Floating Attachment Menu */
interface AttachmentMenuPopoverProps {
  onPickDocument: () => void;
  onPickPhotosAndVideos: () => void;
  onOpenCamera: () => void;
  onPickAudio: () => void;
  onOpenContact: () => void;
  onOpenLocation: () => void;
  onClose: () => void;
}

export const AttachmentMenuPopover: React.FC<AttachmentMenuPopoverProps> = ({
  onPickDocument,
  onPickPhotosAndVideos,
  onOpenCamera,
  onPickAudio,
  onOpenContact,
  onOpenLocation,
  onClose,
}) => {
  const items = [
    {
      label: 'Document',
      icon: <FileText className="w-4 h-4" />,
      color: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/50',
      action: onPickDocument,
    },
    {
      label: 'Photos & videos',
      icon: <ImageIcon className="w-4 h-4" />,
      color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50',
      action: onPickPhotosAndVideos,
    },
    {
      label: 'Camera',
      icon: <Camera className="w-4 h-4" />,
      color: 'text-pink-600 dark:text-pink-400 bg-pink-50 dark:bg-pink-950/50',
      action: onOpenCamera,
    },
    {
      label: 'Audio',
      icon: <Headphones className="w-4 h-4" />,
      color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/50',
      action: onPickAudio,
    },
    {
      label: 'Contact',
      icon: <User className="w-4 h-4" />,
      color: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50',
      action: onOpenContact,
    },
    {
      label: 'Location & IP',
      icon: <MapPin className="w-4 h-4" />,
      color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50',
      action: onOpenLocation,
    },
  ];

  return (
    <div
      role="menu"
      aria-label="Encrypted attachments"
      className="w-60 rounded-2xl bg-white dark:bg-[#141923] border border-slate-200 dark:border-slate-800 shadow-xl p-1.5 space-y-0.5"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            item.action();
          }}
          className="w-full min-h-[44px] px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 flex items-center gap-3 text-left text-sm font-medium text-slate-800 dark:text-slate-100 transition-colors"
        >
          <span
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${item.color}`}
          >
            {item.icon}
          </span>
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
};

/* 2. Encrypted Contact Card Modal */
interface ContactShareModalProps {
  onSendContact: (contact: {
    contactName: string;
    contactPhoneOrHandle: string;
    contactNote?: string;
  }) => void;
  onClose: () => void;
}

export const ContactShareModal: React.FC<ContactShareModalProps> = ({
  onSendContact,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [phoneOrHandle, setPhoneOrHandle] = useState('');
  const [note, setNote] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phoneOrHandle.trim()) return;
    onSendContact({
      contactName: name.trim(),
      contactPhoneOrHandle: phoneOrHandle.trim(),
      contactNote: note.trim() || undefined,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2
            id="contact-modal-title"
            className="text-base font-semibold text-slate-900 dark:text-white"
          >
            Share Encrypted Contact
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close contact dialog"
            className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-slate-700 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Contact Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dr. Patel"
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2C6BED]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Phone Number or Handle
            </label>
            <input
              type="text"
              required
              value={phoneOrHandle}
              onChange={(e) => setPhoneOrHandle(e.target.value)}
              placeholder="e.g. +1 555 234 5678"
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2C6BED]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Note <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Clinic reception"
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2C6BED]"
            />
          </div>

          <button
            type="submit"
            className="w-full min-h-[44px] rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            <Send className="w-4 h-4" />
            <span>Encrypt & Share Contact</span>
          </button>
        </form>
      </div>
    </div>
  );
};

/* 3. Location & Exact Device IP Share / Inspector Modal */
interface LocationShareModalProps {
  mode: 'share' | 'inspect';
  onSendLocation?: (loc: {
    latitude?: number;
    longitude?: number;
    accuracyMeters?: number;
    locationLabel?: string;
    ipAddress: string;
  }) => void;
  onClose: () => void;
}

export const LocationShareModal: React.FC<LocationShareModalProps> = ({
  mode,
  onSendLocation,
  onClose,
}) => {
  const [netInfo, setNetInfo] = useState<DeviceNetworkInfo | null>(null);
  const [geo, setGeo] = useState<ExactGeoLocation | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('Current Device Location');

  const refreshAll = async () => {
    setLoading(true);
    setGeoError(null);
    const [netRes, geoRes] = await Promise.allSettled([
      fetchDeviceNetworkInfo(),
      getExactGeoPosition(),
    ]);

    if (netRes.status === 'fulfilled') {
      setNetInfo(netRes.value);
    }
    if (geoRes.status === 'fulfilled') {
      setGeo(geoRes.value);
    } else {
      setGeoError(
        geoRes.reason instanceof Error
          ? geoRes.reason.message
          : 'GPS coordinates unavailable.'
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const displayIp = netInfo?.publicIp || netInfo?.ip || 'Detecting...';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2
              id="location-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-white"
            >
              {mode === 'share'
                ? 'Share Location & Device IP'
                : 'Device Exact IP & Location'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {mode === 'share'
                ? 'Encrypted inside your message before sending'
                : 'Live network address and GPS coordinates on this device'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close location dialog"
            className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-slate-700 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Network & GPS Grid */}
        <div className="space-y-2.5">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Exact Device IP Address
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(displayIp)}
                aria-label="Copy IP address"
                className="text-xs text-[#2C6BED] dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </button>
            </div>
            <div className="font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-white">
              {displayIp}
            </div>
            {netInfo?.publicIp && netInfo.ip !== netInfo.publicIp && (
              <div className="text-[11px] font-mono text-slate-500">
                Socket Peer IP: {netInfo.ip}
              </div>
            )}
            {(netInfo?.city || netInfo?.country) && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Network Region:{' '}
                {[netInfo.city, netInfo.region, netInfo.country].filter(Boolean).join(', ')}
              </div>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Exact GPS Coordinates
              </span>
              <button
                type="button"
                onClick={refreshAll}
                disabled={loading}
                className="text-xs text-[#2C6BED] dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {geo ? (
              <>
                <div className="font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-white">
                  {geo.latitude.toFixed(6)}, {geo.longitude.toFixed(6)}
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Accuracy ±{geo.accuracyMeters}m</span>
                  <a
                    href={`https://maps.google.com/?q=${geo.latitude},${geo.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#2C6BED] dark:text-blue-400 font-medium hover:underline"
                  >
                    Open in Maps
                  </a>
                </div>
              </>
            ) : (
              <div className="text-xs text-amber-700 dark:text-amber-300">
                {loading
                  ? 'Acquiring high-accuracy GPS fix...'
                  : geoError || 'GPS unavailable. You can still share your exact device IP.'}
              </div>
            )}
          </div>
        </div>

        {mode === 'share' && onSendLocation && (
          <div className="space-y-3 pt-1">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Location label (optional)"
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2C6BED]"
            />

            <button
              type="button"
              disabled={loading && !netInfo}
              onClick={() =>
                onSendLocation({
                  latitude: geo?.latitude,
                  longitude: geo?.longitude,
                  accuracyMeters: geo?.accuracyMeters,
                  locationLabel: label.trim() || undefined,
                  ipAddress: displayIp,
                })
              }
              className="w-full min-h-[44px] rounded-xl bg-[#2C6BED] hover:bg-[#2359C9] disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <MapPin className="w-4 h-4" />
              <span>Encrypt & Send Location + IP</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
