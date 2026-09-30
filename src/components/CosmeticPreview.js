import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Tiny clickable cosmetic thumbnail + fullscreen enlarge overlay.
 * Used by Crimes/GTA toasts, Quick Trade, and forum thumbs.
 */
export function CosmeticThumb({
  src,
  alt = '',
  size = 36,
  className = '',
  title,
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
  if (!src) return null;
  const px = Math.max(24, Math.min(72, Number(size) || 36));
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={`shrink-0 rounded border border-primary/30 overflow-hidden bg-secondary/80 hover:border-primary/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${className}`}
        style={{ width: px, height: px }}
        title={title || 'Tap to enlarge'}
        aria-label={title || alt || 'Enlarge preview'}
      >
        <img src={src} alt={alt} className="w-full h-full object-cover" loading="lazy" draggable={false} />
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center p-3 sm:p-6 bg-black/85"
          role="dialog"
          aria-modal="true"
          onClick={close}
        >
          <div
            className="relative w-full max-w-lg rounded-xl border border-primary/30 bg-zinc-950/95 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-primary/20 flex items-center justify-between gap-2">
              <p className="text-xs font-heading font-bold text-foreground truncate">{title || alt || 'Preview'}</p>
              <button
                type="button"
                onClick={close}
                className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/80 text-mutedForeground hover:text-foreground"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-3">
              <img
                src={src}
                alt={alt}
                className="w-full h-auto max-h-[min(70vh,520px)] object-contain rounded-md"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Compact toast row: small thumb + label (does not dominate the toast). */
export function CosmeticDropToastPreview({ drop }) {
  if (!drop || !drop.id) return null;
  const label =
    drop.label ||
    (drop.kind === 'back'
      ? `Blackjack cover: ${drop.name || drop.id}`
      : `Profile theme: ${drop.name || drop.id}`);
  return (
    <div className="mt-1.5 flex items-center gap-2 min-w-0">
      {drop.image ? (
        <CosmeticThumb src={drop.image} alt={drop.name || ''} size={32} title={label} />
      ) : null}
      <div className="min-w-0 text-[10px] leading-snug text-mutedForeground">
        <div className="text-foreground font-semibold truncate">{label}</div>
        <div className="opacity-70">Tap preview to enlarge</div>
      </div>
    </div>
  );
}

/** Open enlarge overlay for a raw image URL (forum / Imperative). */
export function openImageLightbox(src, title = 'Preview') {
  if (!src || typeof document === 'undefined') return;
  const existing = document.getElementById('mafia-img-lightbox-root');
  if (existing) existing.remove();
  const root = document.createElement('div');
  root.id = 'mafia-img-lightbox-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.style.cssText =
    'position:fixed;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(0,0,0,0.85);';
  root.innerHTML = `
    <div style="position:relative;width:100%;max-width:32rem;border-radius:12px;border:1px solid rgba(234,179,8,0.3);background:rgba(9,9,11,0.95);overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,0.5);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(234,179,8,0.2);">
        <p style="margin:0;font-size:12px;font-weight:700;color:#fafafa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${String(title).replace(/</g, '&lt;')}</p>
        <button type="button" data-close style="width:32px;height:32px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#a1a1aa;cursor:pointer;font-size:18px;line-height:1;">×</button>
      </div>
      <div style="padding:12px;">
        <img src="${String(src).replace(/"/g, '&quot;')}" alt="" style="width:100%;height:auto;max-height:min(70vh,520px);object-fit:contain;border-radius:8px;display:block;" />
      </div>
    </div>
  `;
  const close = () => {
    root.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  root.addEventListener('click', (e) => {
    if (e.target === root || e.target?.dataset?.close != null) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(root);
}

/** Delegate clicks on forum thumbs / content images to enlarge. */
export function bindForumImageLightbox(rootEl) {
  if (!rootEl || rootEl.dataset.imgLightboxBound === '1') return;
  rootEl.dataset.imgLightboxBound = '1';
  rootEl.addEventListener('click', (e) => {
    const img = e.target?.closest?.('img.forum-content-thumb, img.forum-content-img');
    if (!img || !img.src) return;
    e.preventDefault();
    openImageLightbox(img.src, img.getAttribute('alt') || 'Preview');
  });
}
