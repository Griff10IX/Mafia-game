import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { PROFILE_GLOW_PRESETS, isCustomGlowValue } from '../constants/profileGlowPresets';
import styles from '../styles/noir.module.css';

/**
 * Glow colour picker (presets + custom hex) — shared by Store purchase and Edit Profile.
 * `value` is a preset id (e.g. "crimson") or a custom "#rrggbb" hex.
 * Modal is portaled to document.body so overflow/transform on profile cards cannot clip it.
 */
export default function GlowPresetPicker({
  value,
  onChange,
  disabled = false,
  buttonClassName = 'text-[11px] font-heading px-3 py-1.5 rounded-md border border-primary/40 bg-primary/10 flex items-center gap-2 hover:bg-primary/20 disabled:opacity-50',
  savingLabel = 'Saving…',
  idlePrefix = 'Colour:',
}) {
  const [open, setOpen] = useState(false);
  const isCustom = isCustomGlowValue(value);
  const customHexValue = isCustom ? (String(value).startsWith('#') ? String(value).toLowerCase() : `#${String(value).toLowerCase()}`) : null;
  const [customHex, setCustomHex] = useState(customHexValue || '#a78bfa');
  const current = isCustom
    ? { id: 'custom', label: `Custom ${customHexValue}`, hex: customHexValue }
    : (PROFILE_GLOW_PRESETS.find((p) => p.id === value) || PROFILE_GLOW_PRESETS.find((p) => p.hex.toLowerCase() === String(value || '').toLowerCase()) || PROFILE_GLOW_PRESETS[0]);

  const pick = (next) => {
    onChange?.(next);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const modal = open
    ? createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Glow colour"
        >
          <div
            className={`${styles.panel} w-full max-w-md rounded-xl border border-primary/25 overflow-hidden max-h-[85vh] flex flex-col shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-primary/15 bg-primary/5 flex items-center justify-between shrink-0">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Glow colour</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-mutedForeground hover:text-foreground">
                <X size={14} />
              </button>
            </div>
            <div className="p-3 space-y-3 overflow-y-auto">
              <p className="text-[9px] text-mutedForeground font-heading">
                {PROFILE_GLOW_PRESETS.length} presets — same colours as the Points Store. Or pick any custom shade below.
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {PROFILE_GLOW_PRESETS.map((p) => {
                  const selected = !isCustom && (value === p.id || String(value || '').toLowerCase() === p.hex.toLowerCase());
                  return (
                    <button
                      key={p.id}
                      type="button"
                      title={p.label}
                      disabled={disabled}
                      onClick={() => pick(p.id)}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-colors disabled:opacity-50 ${selected ? 'border-white bg-white/10' : 'border-zinc-700/50 hover:border-zinc-500 hover:bg-zinc-800/40'}`}
                    >
                      <span
                        className="w-6 h-6 rounded-full"
                        style={{ backgroundColor: p.hex, boxShadow: `0 0 8px ${p.hex}aa` }}
                      />
                      <span className="text-[8px] font-heading text-zinc-400 truncate w-full text-center">{p.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="pt-2 border-t border-zinc-700/40 space-y-1.5">
                <p className="text-[9px] font-heading uppercase tracking-wider text-mutedForeground">Custom colour — pick any shade</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="color"
                    value={customHex}
                    onChange={(e) => setCustomHex(e.target.value)}
                    className="w-9 h-9 rounded-lg border-2 border-zinc-600 cursor-pointer p-0.5 bg-transparent shrink-0"
                    aria-label="Custom glow colour"
                  />
                  <span
                    className="text-[10px] font-heading font-bold px-2 py-1 rounded border border-zinc-700"
                    style={{ color: customHex, textShadow: `0 0 8px ${customHex}88` }}
                  >
                    {customHex} preview
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => pick(customHex.toLowerCase())}
                    className="ml-auto px-2.5 py-1.5 rounded text-[9px] font-heading font-bold uppercase border border-primary/50 bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50"
                  >
                    Use custom
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (isCustom && customHexValue) setCustomHex(customHexValue);
          else if (current?.hex) setCustomHex(current.hex);
          setOpen(true);
        }}
        className={buttonClassName}
        style={{ color: current.hex }}
      >
        <span
          className="inline-block w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: current.hex, boxShadow: `0 0 6px ${current.hex}` }}
        />
        {disabled ? savingLabel : `${idlePrefix} ${current.label}`}
        <ChevronDown size={12} className="shrink-0" />
      </button>
      {modal}
    </div>
  );
}
