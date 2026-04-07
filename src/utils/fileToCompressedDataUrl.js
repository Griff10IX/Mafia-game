/**
 * Read an image file as a small JPEG/PNG data URL (for emblems / avatars).
 */
export async function fileToCompressedDataUrl(file, maxDim = 160, quality = 0.82) {
  if (!file) return '';
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
  ctx.drawImage(img, 0, 0, cw, ch);
  const jpeg = canvas.toDataURL('image/jpeg', quality);
  return jpeg && jpeg.startsWith('data:image/') ? jpeg : canvas.toDataURL('image/png');
}
