import type { DeviceNetworkInfo } from '../types';
import { safeFetchJson } from './api';

export async function fetchDeviceNetworkInfo(): Promise<DeviceNetworkInfo> {
  const { ok, data } = await safeFetchJson<DeviceNetworkInfo>('/api/device-info');
  if (!ok) {
    throw new Error('Could not retrieve network details.');
  }

  // If behind local loopback or private proxy, also try resolving public WAN IP
  const isLocalOrPrivate =
    !data.ip ||
    data.ip === '127.0.0.1' ||
    data.ip === '::1' ||
    data.ip.startsWith('10.') ||
    data.ip.startsWith('192.168.');

  if (isLocalOrPrivate) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const pubRes = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (pubRes.ok) {
        const pubJson = (await pubRes.json()) as { ip?: string };
        if (pubJson.ip) {
          data.publicIp = pubJson.ip;
        }
      }
    } catch {
      // Ignore external fallback timeout
    }
  }

  return data;
}

export interface ExactGeoLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export function getExactGeoPosition(): Promise<ExactGeoLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: Math.round(pos.coords.accuracy),
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new Error('Location permission denied. Allow location access in browser settings.')
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject(new Error('GPS position is currently unavailable.'));
        } else {
          reject(new Error('Timed out trying to acquire exact GPS location.'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  });
}

export function readFileAsDataUrl(file: File, maxBytes = 15 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(`File exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

export function getAudioDurationFromDataUrl(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio(dataUrl);
    audio.addEventListener('loadedmetadata', () => {
      resolve(Number.isFinite(audio.duration) ? Math.max(1, Math.round(audio.duration)) : 1);
    });
    audio.addEventListener('error', () => resolve(1));
  });
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export function playHighPriorityAlertChime(): void {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, dur: number, gainPeak = 0.14) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur);
    };

    playTone(784, now, 0.14);
    playTone(1046.5, now + 0.14, 0.22);
    setTimeout(() => {
      ctx.close().catch(() => undefined);
    }, 600);
  } catch {
    // Ignore autoplay restrictions
  }
}

export function playSendFeedback(): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(25);
    }
  } catch {
    // Ignore
  }
}

export function playReceiveAlertFeedback(): void {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([160, 70, 160]);
  }
  playHighPriorityAlertChime();
}

export function playBlueTickFeedback(): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate([35, 45, 35]);
    }
    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();
    const now = ctx.currentTime;

    const ping = (freq: number, offset: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.11, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.15);
    };

    ping(880, 0);
    ping(1318.5, 0.09);
    setTimeout(() => ctx.close().catch(() => undefined), 450);
  } catch {
    // Ignore
  }
}

export async function showBrowserNotificationBar(
  title: string,
  body: string,
  tag = 'veil-private-alert'
): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, {
          body,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag,
          requireInteraction: true,
        });
        return;
      }
    }
    new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      tag,
    });
  } catch {
    // Ignore restricted iframe notification context
  }
}
