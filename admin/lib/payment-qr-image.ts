/**
 * QR-specific image processing for the Super Admin payment settings editor.
 * Preserve a lossless original when it fits; only compress oversize images.
 * Payment proof screenshots intentionally retain their separate smaller limit.
 */
export const MAX_PAYMENT_QR_DATA_URL_LENGTH = 320_000;
const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Unable to read QR image'));
    reader.readAsDataURL(blob);
  });
}

function imageBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Unable to optimize QR image')), type, quality);
  });
}

export async function preparePaymentQrImage(file: File): Promise<{ dataUrl: string; optimized: boolean }> {
  if (!SUPPORTED_TYPES.includes(file.type)) {
    throw new Error('Use a PNG, JPEG or WebP image for the payment QR.');
  }
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('QR image must be smaller than 8 MB before optimization.');
  }

  // Avoid unnecessary re-encoding of already small QR images.
  if (file.size <= Math.floor((MAX_PAYMENT_QR_DATA_URL_LENGTH - 48) * 3 / 4)) {
    const original = await readAsDataUrl(file);
    if (original.length <= MAX_PAYMENT_QR_DATA_URL_LENGTH) {
      return { dataUrl: original, optimized: false };
    }
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('The selected QR image could not be opened. Please use a valid PNG, JPEG or WebP.');
  }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32_000_000) {
      throw new Error('QR image dimensions are too large to process safely.');
    }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Browser image optimization is unavailable.');

    for (const longestEdge of [1200, 960, 768, 640, 512]) {
      const scale = Math.min(1, longestEdge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      // PNG stays lossless for simple QR graphics. JPEG covers photographs/screenshots.
      for (const [type, quality] of [['image/png', 1], ['image/jpeg', 0.92], ['image/jpeg', 0.82]] as const) {
        const blob = await imageBlob(canvas, type, quality);
        if (blob.size > Math.floor((MAX_PAYMENT_QR_DATA_URL_LENGTH - 48) * 3 / 4)) continue;
        const dataUrl = await readAsDataUrl(blob);
        if (dataUrl.length <= MAX_PAYMENT_QR_DATA_URL_LENGTH) {
          return { dataUrl, optimized: true };
        }
      }
    }
  } finally {
    bitmap.close();
  }

  throw new Error('Unable to optimize QR without losing readability. Please crop tightly around the QR and try again.');
}
