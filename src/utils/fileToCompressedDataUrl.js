/**
 * Read an image file as a small JPEG/PNG data URL (for emblems / avatars).
 */
const SAFE_UPLOAD_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const SAFE_UPLOAD_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export function validateSafeImageFile(file) {
  if (!file) return { ok: false, reason: 'No file selected' };
  const mime = String(file.type || '').toLowerCase().trim();
  if (!SAFE_UPLOAD_IMAGE_TYPES.has(mime)) {
    return { ok: false, reason: 'Only JPG, PNG, GIF, or WEBP files are allowed' };
  }
  const name = String(file.name || '').toLowerCase().trim();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  if (!SAFE_UPLOAD_IMAGE_EXTS.has(ext)) {
    return { ok: false, reason: 'File extension not allowed. Use .jpg, .png, .gif, or .webp' };
  }
  return { ok: true };
}

export async function fileToCompressedDataUrl(file, maxDim = 160, quality = 0.82) {
  if (!file) return '';
  const valid = validateSafeImageFile(file);
  if (!valid.ok) return '';
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Failed to read file'));
    r.readAsDataURL(file);
  });
  if (!String(dataUrl).startsWith('data:image/')) return '';
  const img = await new Promise((resolve, reject) => {
    const i = new window.Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Invalid image'));
    i.src = String(dataUrl);
  });
  const w = img.width || 1;
  const h = img.height || 1;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return String(dataUrl);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cw, ch);
  const jpeg = canvas.toDataURL('image/jpeg', quality);
  return jpeg && jpeg.startsWith('data:image/') ? jpeg : canvas.toDataURL('image/png');
}

/** Must match backend `AVATAR_MAX_BYTES` in profile router (data URL string length). */
export const AVATAR_MAX_DATA_URL_CHARS = Math.floor(1.2 * 1024 * 1024);

/**
 * Avatar upload: JPEG/PNG/WebP are resized to JPEG via canvas (larger than emblem presets so lightbox/profile stay sharp).
 * GIF is kept as-is so animation works.
 * @returns {{ ok: true, dataUrl: string } | { ok: false, reason: 'invalid' | 'gif_too_large' }}
 */
export async function fileToAvatarDataUrl(file, maxDim = 512, quality = 0.88) {
  if (!file) return { ok: false, reason: 'invalid' };
  const valid = validateSafeImageFile(file);
  if (!valid.ok) return { ok: false, reason: 'invalid' };
  const mime = String(file.type || '').toLowerCase();
  if (mime === 'image/gif') {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('Failed to read file'));
      r.readAsDataURL(file);
    });
    if (!dataUrl.startsWith('data:image/gif')) return { ok: false, reason: 'invalid' };
    if (dataUrl.length > AVATAR_MAX_DATA_URL_CHARS) return { ok: false, reason: 'gif_too_large' };
    return { ok: true, dataUrl };
  }
  const dataUrl = await fileToCompressedDataUrl(file, maxDim, quality);
  return dataUrl ? { ok: true, dataUrl } : { ok: false, reason: 'invalid' };
}
