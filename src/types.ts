export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'voice'
  | 'document'
  | 'contact'
  | 'location'
  | 'sticker';

export interface ReplyPreview {
  id: string;
  senderAlias: string;
  kind: MessageKind;
  snippet: string;
}

export interface DecryptedMessagePayload {
  senderClientId: string;
  senderAlias: string;
  kind: MessageKind;
  text?: string;
  // Photo / Video
  imageDataUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageName?: string;
  videoDataUrl?: string;
  videoMime?: string;
  videoName?: string;
  videoSize?: number;
  // Voice / Audio
  audioDataUrl?: string;
  audioDuration?: number;
  audioName?: string;
  waveform?: number[];
  // Document
  docDataUrl?: string;
  docName?: string;
  docMime?: string;
  docSize?: number;
  // Contact card
  contactName?: string;
  contactPhoneOrHandle?: string;
  contactNote?: string;
  // Location & Device IP
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationLabel?: string;
  ipAddress?: string;
  // Sticker
  stickerId?: string;
  stickerLabel?: string;
  replyTo?: ReplyPreview;
  createdAt: number;
}

export type ReceiptStatus = 'sent' | 'delivered' | 'read';

export interface EncryptedMessageEnvelope {
  id: string;
  iv: string;
  ciphertext: string;
  timestamp: number;
  expiresAt: number | null;
  senderClientId?: string;
  receiptStatus?: ReceiptStatus;
  deletedForEveryone?: boolean;
  deletedByClientId?: string;
}

export interface DeletedArchiveEntry {
  id: string;
  scope: 'me' | 'everyone';
  deletedAt: number;
  iv: string;
  ciphertext: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  envelope: EncryptedMessageEnvelope;
  payload: DecryptedMessagePayload | null;
  decryptError: boolean;
  isMine: boolean;
  expiresAt: number | null;
  receiptStatus?: ReceiptStatus;
  deletedScope?: 'me' | 'everyone';
  deletedByMe?: boolean;
  archivedPayload?: DecryptedMessagePayload | null;
}

export type DisappearingOption = 0 | 30_000 | 300_000 | 3_600_000 | 86_400_000;

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface SpaceSession {
  spaceName: string;
  normalizedName: string;
  passphrase: string;
  alias: string;
  clientId: string;
  roomId: string;
  gateHash: string;
  aesKey: CryptoKey;
  safetyNumber: string;
  keyFingerprint: string;
}

export interface DeviceNetworkInfo {
  ip: string;
  publicIp?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  userAgent: string;
  serverTime: number;
}
