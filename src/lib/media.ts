export interface ScrubbedImageResult {
  dataUrl: string;
  width: number;
  height: number;
  originalSize: number;
  scrubbedSize: number;
}

/**
 * Draws the image onto an offscreen HTMLCanvasElement to automatically strip all EXIF
 * metadata (GPS coordinates, camera serial numbers, timestamps) before AES-256-GCM encryption.
 */
export async function scrubAndCompressImage(file: File): Promise<ScrubbedImageResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not decode image file.'));
      image.src = objectUrl;
    });

    const maxDim = 1600;
    let targetW = img.naturalWidth || img.width;
    let targetH = img.naturalHeight || img.height;

    if (targetW > maxDim || targetH > maxDim) {
      if (targetW >= targetH) {
        targetH = Math.round((targetH * maxDim) / targetW);
        targetW = maxDim;
      } else {
        targetW = Math.round((targetW * maxDim) / targetH);
        targetH = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas image processing is unavailable.');
    }

    ctx.drawImage(img, 0, 0, targetW, targetH);

    // Export as JPEG (or WebP) which strips all EXIF metadata
    const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    let quality = 0.86;
    let dataUrl = canvas.toDataURL(mimeType, quality);

    // If PNG is very large, fallback to high-quality JPEG to stay comfortably under transfer limits
    if (mimeType === 'image/png' && dataUrl.length > 2_500_000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    }

    const approxBytes = Math.round((dataUrl.length * 3) / 4);
    return {
      dataUrl,
      width: targetW,
      height: targetH,
      originalSize: file.size,
      scrubbedSize: approxBytes,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'Expiring';
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}
