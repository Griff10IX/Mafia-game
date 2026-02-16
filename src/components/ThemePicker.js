import { useState } from 'react';
import { Palette, X, RotateCcw } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { THEME_COLOURS, THEME_TEXTURES, DEFAULT_COLOUR_ID, DEFAULT_TEXTURE_ID } from '../constants/themes';
import styles from '../styles/noir.module.css';

export default function ThemePicker({ open, onClose }) {
  const { colourId, textureId, setColour, setTexture } = useTheme();
  const [colourPage, setColourPage] = useState(0);
  const COLOURS_PER_PAGE = 24;
  const totalColourPages = Math.ceil(THEME_COLOURS.length / COLOURS_PER_PAGE);
  const coloursSlice = THEME_COLOURS.slice(
    colourPage * COLOURS_PER_PAGE,
    (colourPage + 1) * COLOURS_PER_PAGE
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className={`${styles.panel} rounded-lg border border-primary/20 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col`}
        onClick={(e) => e.stopPropagation()}
        data-testid="theme-picker"
      >
        <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            <h2 className="text-base font-heading font-bold text-primary uppercase tracking-wider">Theme</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => { setColour(DEFAULT_COLOUR_ID); setTexture(DEFAULT_TEXTURE_ID); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-heading uppercase tracking-wider border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              data-testid="theme-reset-default"
              title="Reset to default (Gold, no texture)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to default
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-mutedForeground hover:text-primary hover:bg-primary/10 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          {/* Colour */}
          <div>
            <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2">Colour</p>
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
              {coloursSlice.map((c) => {
                const stops = c.stops && c.stops.length >= 2 ? c.stops : null;
                const isGradient = c.id.startsWith('gradient-') || stops;
                const swatchStyle = stops
                  ? { background: `linear-gradient(135deg, ${stops.join(', ')})` }
                  : isGradient
                    ? { background: `linear-gradient(135deg, ${c.primaryDark}, ${c.primaryBright})` }
                    : { backgroundColor: c.primary };
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColour(c.id)}
                    className={`w-full aspect-square rounded-md border-2 transition-all shrink-0 ${
                      colourId === c.id
                        ? 'border-primary ring-2 ring-primary/30'
                        : 'border-transparent hover:border-primary/50'
                    }`}
                    style={swatchStyle}
                    title={c.name}
                    aria-label={c.name}
                  />
                );
              })}
            </div>
            {totalColourPages > 1 && (
              <div className="flex items-center justify-center gap-1 mt-2">
                {Array.from({ length: totalColourPages }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setColourPage(i)}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      i === colourPage ? 'bg-primary' : 'bg-zinc-600 hover:bg-zinc-500'
                    }`}
                    aria-label={`Page ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Texture – preview swatches like colours */}
          <div>
            <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2">Texture</p>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {THEME_TEXTURES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTexture(t.id)}
                  className={`flex flex-col items-center gap-1 rounded-md border-2 transition-all shrink-0 ${
                    textureId === t.id
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-transparent hover:border-primary/50'
                  }`}
                  title={t.name}
                  aria-label={t.name}
                >
                  <div
                    className="theme-texture-swatch w-full aspect-square min-h-[44px]"
                    data-texture={t.id}
                  />
                  <span className="text-[9px] sm:text-[10px] font-heading text-mutedForeground truncate w-full text-center px-0.5">
                    {t.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
