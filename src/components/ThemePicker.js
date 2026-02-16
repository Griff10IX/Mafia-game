import { useState } from 'react';
import { Palette, X, RotateCcw, MousePointer2, Minus, LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { THEME_COLOURS, THEME_TEXTURES, THEME_PRESETS, DEFAULT_COLOUR_ID, DEFAULT_TEXTURE_ID, getThemeColour } from '../constants/themes';
import styles from '../styles/noir.module.css';

function customToColourEntry(c) {
  const stops = c.stops && c.stops.length >= 1 ? c.stops : [c.stops?.[0] || '#888'];
  return {
    id: c.id,
    name: c.name || 'Custom',
    stops: stops.length >= 2 ? stops : null,
    primary: stops[0],
    primaryBright: stops[0],
    primaryDark: stops[stops.length - 1],
    foregroundOnPrimary: c.foregroundOnPrimary || '#ffffff',
  };
}

export default function ThemePicker({ open, onClose }) {
  const { colourId, textureId, buttonColourId, accentLineColourId, setColour, setTexture, setButtonColour, setAccentLineColour, resetButtonToDefault, resetAccentLineToDefault, customThemes, addCustomTheme, removeCustomTheme } = useTheme();

  const applyPreset = (preset) => {
    setColour(preset.colourId);
    setTexture(preset.textureId);
    setButtonColour(preset.buttonColourId ?? null);
    setAccentLineColour(preset.accentLineColourId ?? null);
  };

  const allColours = [...customThemes.map(customToColourEntry), ...THEME_COLOURS];
  const [colourPage, setColourPage] = useState(0);
  const [buttonPage, setButtonPage] = useState(0);
  const [accentLinePage, setAccentLinePage] = useState(0);
  const COLOURS_PER_PAGE = 24;
  const totalColourPages = Math.ceil(allColours.length / COLOURS_PER_PAGE);
  const totalButtonPages = Math.ceil(allColours.length / COLOURS_PER_PAGE);
  const totalAccentLinePages = Math.ceil(allColours.length / COLOURS_PER_PAGE);
  const coloursSlice = allColours.slice(
    colourPage * COLOURS_PER_PAGE,
    (colourPage + 1) * COLOURS_PER_PAGE
  );
  const buttonColoursSlice = allColours.slice(
    buttonPage * COLOURS_PER_PAGE,
    (buttonPage + 1) * COLOURS_PER_PAGE
  );
  const accentLineColoursSlice = allColours.slice(
    accentLinePage * COLOURS_PER_PAGE,
    (accentLinePage + 1) * COLOURS_PER_PAGE
  );

  const [customName, setCustomName] = useState('');
  const [customNumColours, setCustomNumColours] = useState(2);
  const [customHexes, setCustomHexes] = useState(['#d4af37', '#b8860b']);
  const [customTextLight, setCustomTextLight] = useState(true);

  const handleSaveCustom = () => {
    const name = customName.trim() || 'My theme';
    const stops = customHexes.slice(0, customNumColours).filter(Boolean).map((h) => (h.startsWith('#') ? h : `#${h}`));
    if (stops.length < 1) return;
    const newId = addCustomTheme({
      name,
      stops,
      foregroundOnPrimary: customTextLight ? '#ffffff' : '#000000',
    });
    setColour(newId);
    setCustomName('');
    setCustomHexes(['#d4af37', '#b8860b', '#0d9488', '#ea580c']);
  };

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
          {/* Presets – one-click theme bundles */}
          <div>
            <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <LayoutGrid className="w-3.5 h-3.5" />
              Presets
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {THEME_PRESETS.map((preset) => {
                const colour = getThemeColour(preset.colourId);
                const stops = colour.stops && colour.stops.length >= 2 ? colour.stops : null;
                const swatchStyle = stops
                  ? { background: `linear-gradient(135deg, ${stops.slice(0, 3).join(', ')})` }
                  : { backgroundColor: colour.primary };
                const isActive =
                  colourId === preset.colourId &&
                  textureId === preset.textureId &&
                  (preset.buttonColourId == null ? buttonColourId == null : buttonColourId === preset.buttonColourId) &&
                  (preset.accentLineColourId == null ? accentLineColourId == null : accentLineColourId === preset.accentLineColourId);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`flex flex-col rounded-lg border-2 transition-all text-left overflow-hidden ${
                      isActive ? 'border-primary ring-2 ring-primary/30' : 'border-zinc-700 hover:border-primary/50'
                    }`}
                    title={preset.description}
                    data-testid={`theme-preset-${preset.id}`}
                  >
                    <div className="h-10 w-full shrink-0" style={swatchStyle} />
                    <div className="p-2 bg-zinc-800/80">
                      <span className="block text-xs font-heading font-bold text-foreground truncate">{preset.name}</span>
                      {preset.description && (
                        <span className="block text-[10px] text-mutedForeground truncate mt-0.5">{preset.description}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Create custom theme (1–4 colours) */}
          <div className="rounded-lg border border-primary/20 bg-zinc-800/40 p-3 space-y-3">
            <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              Create custom theme (up to 4 colours)
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-mutedForeground">Name</span>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="My theme"
                  className="w-32 bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-mutedForeground">Colours</span>
                <select
                  value={customNumColours}
                  onChange={(e) => setCustomNumColours(Number(e.target.value))}
                  className="bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              {[1, 2, 3, 4].map((i) => (
                <label key={i} className="flex flex-col gap-1" style={{ visibility: i <= customNumColours ? 'visible' : 'hidden' }}>
                  <span className="text-[10px] text-mutedForeground">{i}</span>
                  <input
                    type="color"
                    value={customHexes[i - 1] || '#888888'}
                    onChange={(e) => {
                      const next = [...customHexes];
                      next[i - 1] = e.target.value;
                      setCustomHexes(next);
                    }}
                    className="w-10 h-10 rounded border border-zinc-600 cursor-pointer bg-transparent"
                  />
                </label>
              ))}
              <label className="flex items-center gap-2">
                <span className="text-[10px] text-mutedForeground">Text on accent</span>
                <select
                  value={customTextLight ? 'light' : 'dark'}
                  onChange={(e) => setCustomTextLight(e.target.value === 'light')}
                  className="bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <button
                type="button"
                onClick={handleSaveCustom}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-heading uppercase tracking-wider border border-primary/40 bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                data-testid="theme-save-custom"
              >
                <Plus className="w-3.5 h-3.5" />
                Save theme
              </button>
            </div>
          </div>

          {/* Your themes (custom only) */}
          {customThemes.length > 0 && (
            <div>
              <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2">Your themes</p>
              <div className="flex flex-wrap gap-2">
                {customThemes.map((c) => {
                  const entry = customToColourEntry(c);
                  const stops = entry.stops;
                  const swatchStyle = stops
                    ? { background: `linear-gradient(135deg, ${stops.join(', ')})` }
                    : { backgroundColor: entry.primary };
                  return (
                    <div key={c.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setColour(c.id)}
                        className={`w-12 h-12 rounded-lg border-2 transition-all shrink-0 ${colourId === c.id ? 'border-primary ring-2 ring-primary/30' : 'border-zinc-600 hover:border-primary/50'}`}
                        style={swatchStyle}
                        title={entry.name}
                      />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeCustomTheme(c.id); }}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label={`Delete ${entry.name}`}
                        title={`Delete ${entry.name}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <span className="block text-[9px] text-mutedForeground truncate w-12 mt-0.5 text-center">{entry.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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

          {/* Button colour – same palette; null = use main theme */}
          <div>
            <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <MousePointer2 className="w-3.5 h-3.5" />
              Button colour
            </p>
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={resetButtonToDefault}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-heading uppercase tracking-wider border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                data-testid="theme-reset-buttons"
                title="Use same as main theme"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset buttons to default
              </button>
              {buttonColourId === null && (
                <span className="text-[10px] text-mutedForeground">(using main theme)</span>
              )}
            </div>
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
              {buttonColoursSlice.map((c) => {
                const stops = c.stops && c.stops.length >= 2 ? c.stops : null;
                const isGradient = c.id.startsWith('gradient-') || stops;
                const swatchStyle = stops
                  ? { background: `linear-gradient(135deg, ${stops.join(', ')})` }
                  : isGradient
                    ? { background: `linear-gradient(135deg, ${c.primaryDark}, ${c.primaryBright})` }
                    : { backgroundColor: c.primary };
                const isSelected = buttonColourId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setButtonColour(c.id)}
                    className={`w-full aspect-square rounded-md border-2 transition-all shrink-0 ${
                      isSelected
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
            {totalButtonPages > 1 && (
              <div className="flex items-center justify-center gap-1 mt-2">
                {Array.from({ length: totalButtonPages }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setButtonPage(i)}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      i === buttonPage ? 'bg-primary' : 'bg-zinc-600 hover:bg-zinc-500'
                    }`}
                    aria-label={`Button page ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Lines & progress – dividers, progress bars */}
          <div>
            <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Minus className="w-3.5 h-3.5" />
              Lines & progress
            </p>
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={resetAccentLineToDefault}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-heading uppercase tracking-wider border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                data-testid="theme-reset-lines"
                title="Use same as main theme"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset to default
              </button>
              {accentLineColourId === null && (
                <span className="text-[10px] text-mutedForeground">(using main theme)</span>
              )}
            </div>
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
              {accentLineColoursSlice.map((c) => {
                const stops = c.stops && c.stops.length >= 2 ? c.stops : null;
                const isGradient = c.id.startsWith('gradient-') || stops;
                const swatchStyle = stops
                  ? { background: `linear-gradient(135deg, ${stops.join(', ')})` }
                  : isGradient
                    ? { background: `linear-gradient(135deg, ${c.primaryDark}, ${c.primaryBright})` }
                    : { backgroundColor: c.primary };
                const isSelected = accentLineColourId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setAccentLineColour(c.id)}
                    className={`w-full aspect-square rounded-md border-2 transition-all shrink-0 ${
                      isSelected
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
            {totalAccentLinePages > 1 && (
              <div className="flex items-center justify-center gap-1 mt-2">
                {Array.from({ length: totalAccentLinePages }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setAccentLinePage(i)}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      i === accentLinePage ? 'bg-primary' : 'bg-zinc-600 hover:bg-zinc-500'
                    }`}
                    aria-label={`Lines page ${i + 1}`}
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
