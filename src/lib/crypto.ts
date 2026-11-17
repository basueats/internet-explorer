import type { DecryptedMessagePayload } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sha256Bytes(input: string): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return new Uint8Array(digest);
}

async function sha256Hex(input: string): Promise<string> {
  return bytesToHex(await sha256Bytes(input));
}

function formatSafetyNumber(bytesA: Uint8Array, bytesB: Uint8Array): string {
  const combined = new Uint8Array(64);
  combined.set(bytesA, 0);
  combined.set(bytesB, 32);

  // Produce 12 groups of 5 digits (60 digits total), Signal-style
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const offset = (i * 5) % 60;
    const val =
      ((combined[offset] << 24) |
        (combined[offset + 1] << 16) |
        (combined[offset + 2] << 8) |
        combined[offset + 3]) >>>
      0;
    groups.push((val % 100000).toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

export function normalizeSpaceName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '');
}

export interface DerivedSpaceCredentials {
  normalizedName: string;
  roomId: string;
  gateHash: string;
  aesKey: CryptoKey;
  safetyNumber: string;
  keyFingerprint: string;
}

export async function deriveSpaceCredentials(
  spaceName: string,
  passphrase: string
): Promise<DerivedSpaceCredentials> {
  const normalizedName = normalizeSpaceName(spaceName);
  if (!normalizedName) {
    throw new Error('Please enter a valid unique space name.');
  }
  if (passphrase.length < 4) {
    throw new Error('Passphrase must be at least 4 characters long.');
  }

  // Deterministic room lookup ID (server never knows the plaintext space name)
  const roomId = await sha256Hex(`veil:v1:room:${normalizedName}`);

  // Zero-knowledge access gate hash (server verifies this without learning passphrase or AES key)
  const gateHash = await sha256Hex(`veil:v1:gate:${normalizedName}:${passphrase}`);

  // Salt for PBKDF2 key derivation
  const saltBytes = await sha256Bytes(`veil:v1:salt:${normalizedName}`);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 150_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  // Separate deterministic fingerprint / safety number branch
  const safetyBytesA = await sha256Bytes(`veil:v1:safety-a:${normalizedName}:${passphrase}`);
  const safetyBytesB = await sha256Bytes(`veil:v1:safety-b:${normalizedName}:${passphrase}`);
  const safetyNumber = formatSafetyNumber(safetyBytesA, safetyBytesB);
  const keyFingerprint = bytesToHex(safetyBytesA).slice(0, 16).toUpperCase();

  return {
    normalizedName,
    roomId,
    gateHash,
    aesKey,
    safetyNumber,
    keyFingerprint,
  };
}

export async function encryptPayload(
  aesKey: CryptoKey,
  payload: DecryptedMessagePayload
): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = encoder.encode(JSON.stringify(payload));
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintextBytes
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
  };
}

export async function decryptPayload(
  aesKey: CryptoKey,
  ivBase64: string,
  ciphertextBase64: string
): Promise<DecryptedMessagePayload> {
  const iv = base64ToBytes(ivBase64);
  const ciphertext = base64ToBytes(ciphertextBase64);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext
  );
  const jsonText = decoder.decode(decryptedBuffer);
  return JSON.parse(jsonText) as DecryptedMessagePayload;
}

const ADJECTIVES = [
  'amber', 'cedar', 'quiet', 'silver', 'velvet', 'linen', 'nordic', 'cobalt',
  'still', 'lunar', 'misty', 'warm', 'ochre', 'alpine', 'harbor', 'ivory',
];

const NOUNS = [
  'harbor', 'garden', 'lantern', 'meadow', 'cove', 'bridge', 'window', 'atelier',
  'canopy', 'solstice', 'cabin', 'horizon', 'valley', 'haven', 'courtyard', 'ridge',
];

export function generateUniqueSpaceName(): string {
  const arr = new Uint32Array(3);
  crypto.getRandomValues(arr);
  const adj = ADJECTIVES[arr[0] % ADJECTIVES.length];
  const noun = NOUNS[arr[1] % NOUNS.length];
  const num = 100 + (arr[2] % 900);
  return `${adj}-${noun}-${num}`;
}

export function generatePassphrase(): string {
  const words = [
    'maple', 'river', 'cloud', 'stone', 'echo', 'linen', 'spark', 'cedar',
    'frost', 'petal', 'orbit', 'flint', 'amber', 'shore', 'grove', 'prism',
  ];
  const arr = new Uint32Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((n) => words[n % words.length])
    .join('-');
}

export function getOrCreateClientId(): string {
  const key = 'veil_device_client_id';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}
