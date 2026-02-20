import { useState } from 'react';
import { Palette, X, RotateCcw, MousePointer2, Minus, LayoutGrid, Plus, Trash2, Type, Square, Sparkles, AlignLeft, Box, PanelLeft, LayoutDashboard, Smartphone } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { THEME_COLOURS, THEME_TEXTURES, THEME_PRESETS, THEME_FONTS, THEME_BUTTON_STYLES, THEME_WRITING_COLOURS, THEME_TEXT_STYLES, THEME_COLOUR_SECTIONS, THEME_WRITING_SECTIONS, DEFAULT_COLOUR_ID, DEFAULT_TEXTURE_ID, DEFAULT_FONT_ID, DEFAULT_BUTTON_STYLE_ID, DEFAULT_WRITING_COLOUR_ID, DEFAULT_TEXT_STYLE_ID, getThemeColour } from '../constants/themes';
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
  const { colourId, textureId, buttonColourId, accentLineColourId, fontId, buttonStyleId, writingColourId, mutedWritingColourId, toastTextColourId, textStyleId, mobileNavStyle, setColour, setTexture, setButtonColour, setAccentLineColour, setFont, setButtonStyle, setWritingColour, setMutedWritingColour, setToastTextColour, setTextStyle, setMobileNavStyle, resetButtonToDefault, resetAccentLineToDefault, customThemes, addCustomTheme, removeCustomTheme } = useTheme();

  const applyPreset = (preset) => {
    setColour(preset.colourId);
    setTexture(preset.textureId);
    setButtonColour(preset.buttonColourId ?? null);
    setAccentLineColour(preset.accentLineColourId ?? null);
    if (preset.writingColourId != null) setWritingColour(preset.writingColourId);
    if (preset.mutedWritingColourId !== undefined) setMutedWritingColour(preset.mutedWritingColourId ?? null);
    if (preset.buttonStyleId != null) setButtonStyle(preset.buttonStyleId);
    if (preset.fontId != null) setFont(preset.fontId);
    if (preset.textStyleId != null) setTextStyle(preset.textStyleId);
    if (preset.toastTextColourId !== undefined) setToastTextColour(preset.toastTextColourId ?? null);
    if (preset.mobileNavStyle != null) setMobileNavStyle(preset.mobileNavStyle);
  };

  const allColours = [...customThemes.map(customToColourEntry), ...THEME_COLOURS];
  const colourById = Object.fromEntries(allColours.map((c) => [c.id, c]));
  const sectionedColours = THEME_COLOUR_SECTIONS.map(({ label, ids }) => ({
    label,
    colours: ids.map((id) => colourById[id]).filter(Boolean),
  })).filter((s) => s.colours.length > 0);
  const writingColourById = Object.fromEntries(THEME_WRITING_COLOURS.map((w) => [w.id, w]));
  const sectionedWriting = THEME_WRITING_SECTIONS.map(({ label, ids }) => ({
    label,
    colours: ids.map((id) => writingColourById[id]).filter(Boolean),
  })).filter((s) => s.colours.length > 0);

  const getPresetIsActive = (preset) =>
    colourId === preset.colourId &&
    textureId === preset.textureId &&
    (preset.buttonColourId == null ? buttonColourId == null : buttonColourId === preset.buttonColourId) &&
    (preset.accentLineColourId == null ? accentLineColourId == null : accentLineColourId === preset.accentLineColourId) &&
    (preset.writingColourId == null ? true : writingColourId === preset.writingColourId) &&
    (preset.mutedWritingColourId === undefined ? true : (preset.mutedWritingColourId == null ? mutedWritingColourId == null : mutedWritingColourId === preset.mutedWritingColourId)) &&
    (preset.buttonStyleId == null ? true : buttonStyleId === preset.buttonStyleId) &&
    (preset.fontId == null ? true : fontId === preset.fontId) &&
    (preset.textStyleId == null ? true : textStyleId === preset.textStyleId) &&
    (preset.toastTextColourId === undefined ? true : (preset.toastTextColourId == null ? toastTextColourId == null : toastTextColourId === preset.toastTextColourId)) &&
    (preset.mobileNavStyle == null ? true : mobileNavStyle === preset.mobileNavStyle);

  const renderPresetCard = (preset) => {
    const colour = getThemeColour(preset.colourId);
    const stops = colour.stops && colour.stops.length >= 2 ? colour.stops : null;
    const swatchStyle = stops
      ? { background: `linear-gradient(135deg, ${stops.slice(0, 3).join(', ')})` }
      : { backgroundColor: colour.primary };
    const isActive = getPresetIsActive(preset);
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
  };

  const [customName, setCustomName] = useState('');
  const [customNumColours, setCustomNumColours] = useState(2);
  const [customHexes, setCustomHexes] = useState(['#d4af37', '#b8860b']);
  const [customTextLight, setCustomTextLight] = useState(true);

  const TOPBAR_GAP_KEY = 'topbar_gap';
  const TOPBAR_SIZE_KEY = 'topbar_size';
  const topBarGap = (typeof window !== 'undefined' && localStorage.getItem(TOPBAR_GAP_KEY)) || 'normal';
  const topBarSize = (typeof window !== 'undefined' && localStorage.getItem(TOPBAR_SIZE_KEY)) || 'medium';

  const setTopBarGap = (v) => {
    try { localStorage.setItem(TOPBAR_GAP_KEY, v); } catch (_) {}
    window.dispatchEvent(new Event('topbar-prefs-changed'));
  };
  const setTopBarSize = (v) => {
    try { localStorage.setItem(TOPBAR_SIZE_KEY, v); } catch (_) {}
    window.dispatchEvent(new Event('topbar-prefs-changed'));
  };

  const tabs = [
    { id: 'presets', label: 'Presets', icon: Sparkles },
    { id: 'colours', label: 'Colours', icon: Palette },
    { id: 'text', label: 'Text', icon: Type },
    { id: 'buttons', label: 'Buttons', icon: Box },
    { id: 'mobile', label: 'Mobile layout', icon: Smartphone },
    { id: 'topbar', label: 'Top bar', icon: LayoutDashboard },
  ];
  const [activeTab, setActiveTab] = useState('presets');

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
              onClick={() => { setColour(DEFAULT_COLOUR_ID); setTexture(DEFAULT_TEXTURE_ID); setFont(DEFAULT_FONT_ID); setButtonStyle(DEFAULT_BUTTON_STYLE_ID); setWritingColour(DEFAULT_WRITING_COLOUR_ID); setMutedWritingColour(null); setTextStyle(DEFAULT_TEXT_STYLE_ID); resetButtonToDefault(); resetAccentLineToDefault(); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-heading uppercase tracking-wider border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              data-testid="theme-reset-default"
              title="Reset to Original theme (gold, no texture)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to original
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

        <div className="flex flex-col min-h-0 flex-1">
          {/* Tab bar */}
          <div className="flex border-b border-primary/20 bg-zinc-800/50 shrink-0">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-[10px] font-heading uppercase tracking-wider transition-colors border-b-2 min-w-0 ${
                  activeTab === id
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-transparent text-mutedForeground hover:text-foreground hover:bg-zinc-700/50'
                }`}
                title={label}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline truncate">{label}</span>
              </button>
            ))}
          </div>

          <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-4">
            {/* Tab: Presets */}
            {activeTab === 'presets' && (
              <>
                <div>
                  <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <LayoutGrid className="w-3.5 h-3.5" />
                    One-click presets
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {THEME_PRESETS.filter((p) => !p.isFullPreset).map((preset) => renderPresetCard(preset))}
                  </div>
                  <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mt-4 mb-2 flex items-center gap-1.5">
                    <LayoutGrid className="w-3.5 h-3.5" />
                    Full presets (accent, text & buttons)
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {THEME_PRESETS.filter((p) => p.isFullPreset).map((preset) => renderPresetCard(preset))}
                  </div>
                </div>
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
                {customThemes.length > 0 && (
                  <div>
                    <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2">Your saved themes</p>
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
              </>
            )}

            {/* Tab: Colours — main accent only */}
            {activeTab === 'colours' && (
              <div className="space-y-4">
                <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider">Main colour (accent, headers, highlights)</p>
                {customThemes.length > 0 && (
                  <div>
                    <p className="text-[10px] text-mutedForeground/80 mb-1.5">Custom</p>
                    <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                      {customThemes.map((c) => {
                        const entry = customToColourEntry(c);
                        const stops = entry.stops && entry.stops.length >= 2 ? entry.stops : null;
                        const swatchStyle = stops ? { background: `linear-gradient(135deg, ${stops.join(', ')})` } : { backgroundColor: entry.primary };
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => setColour(entry.id)}
                            className={`w-full aspect-square rounded-md border-2 transition-all shrink-0 ${colourId === entry.id ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'}`}
                            style={swatchStyle}
                            title={entry.name}
                            aria-label={entry.name}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
                {sectionedColours.map(({ label, colours }) => (
                  <div key={label}>
                    <p className="text-[10px] text-mutedForeground/80 mb-1.5">{label}</p>
                    <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                      {colours.map((c) => {
                        const stops = c.stops && c.stops.length >= 2 ? c.stops : null;
                        const isGradient = c.id.startsWith('gradient-') || stops;
                        const swatchStyle = stops ? { background: `linear-gradient(135deg, ${stops.join(', ')})` } : isGradient ? { background: `linear-gradient(135deg, ${c.primaryDark}, ${c.primaryBright})` } : { backgroundColor: c.primary };
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setColour(c.id)}
                            className={`w-full aspect-square rounded-md border-2 transition-all shrink-0 ${colourId === c.id ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'}`}
                            style={swatchStyle}
                            title={c.name}
                            aria-label={c.name}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tab: Text */}
            {activeTab === 'text' && (
              <>
                <div>
                  <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <AlignLeft className="w-3.5 h-3.5" />
                    Writing style (font)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {THEME_FONTS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFont(f.id)}
                        className={`px-3 py-1.5 rounded-md border-2 text-xs font-heading uppercase tracking-wider transition-all ${
                          fontId === f.id ? 'border-primary bg-primary/20 text-primary' : 'border-zinc-600 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                        }`}
                        style={fontId === f.id ? undefined : { fontFamily: f.body }}
                        title={`Heading: ${f.heading}, Body: ${f.body}`}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2">Text style (weight)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {THEME_TEXT_STYLES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTextStyle(t.id)}
                        className={`px-3 py-1.5 rounded-md border-2 text-[10px] font-heading uppercase tracking-wider transition-all ${
                          textStyleId === t.id ? 'border-primary bg-primary/20 text-primary' : 'border-zinc-600 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                        }`}
                        style={textStyleId !== t.id ? { fontWeight: t.fontWeight, fontStyle: t.fontStyle } : undefined}
                        title={`${t.fontWeight} / ${t.fontStyle}`}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider">Writing colour (main text)</p>
                  <div className="max-h-64 overflow-y-auto space-y-3">
                    {sectionedWriting.map(({ label, colours }) => (
                      <div key={label}>
                        <p className="text-[10px] text-mutedForeground/80 mb-1.5">{label}</p>
                        <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                          {colours.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => setWritingColour(w.id)}
                              className={`w-full aspect-square rounded-md border-2 transition-all shrink-0 flex flex-col items-center justify-center ${
                                writingColourId === w.id ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'
                              }`}
                              style={{ backgroundColor: w.foreground }}
                              title={w.name}
                              aria-label={w.name}
                            >
                              <span className="w-1/2 h-0.5 rounded shrink-0 opacity-70" style={{ backgroundColor: w.muted }} aria-hidden />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider">Muted text colour (secondary)</p>
                  <p className="text-[9px] text-mutedForeground">Pick a colour for muted text, or &quot;Same as main&quot; to use the preset’s muted.</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setMutedWritingColour(null)}
                      className={`px-3 py-1.5 rounded-md border-2 text-[10px] font-heading uppercase tracking-wider transition-colors ${
                        mutedWritingColourId === null ? 'bg-primary/30 text-primary border-primary' : 'border-zinc-600 bg-zinc-800 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                      }`}
                    >
                      Same as main
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-3">
                    {sectionedWriting.map(({ label, colours }) => (
                      <div key={`muted-${label}`}>
                        <p className="text-[10px] text-mutedForeground/80 mb-1.5">{label}</p>
                        <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                          {colours.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => setMutedWritingColour(w.id)}
                              className={`w-full aspect-square rounded-md border-2 transition-all shrink-0 flex items-center justify-center ${
                                mutedWritingColourId === w.id ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'
                              }`}
                              style={{ backgroundColor: w.foreground }}
                              title={w.name}
                              aria-label={`Muted: ${w.name}`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider">Toast text colour</p>
                  <p className="text-[9px] text-mutedForeground">Colour of toast notification text. &quot;Same as main&quot; uses your main writing colour.</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setToastTextColour(null)}
                      className={`px-3 py-1.5 rounded-md border-2 text-[10px] font-heading uppercase tracking-wider transition-colors ${
                        toastTextColourId === null ? 'bg-primary/30 text-primary border-primary' : 'border-zinc-600 bg-zinc-800 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                      }`}
                    >
                      Same as main
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-3">
                    {sectionedWriting.map(({ label, colours }) => (
                      <div key={`toast-${label}`}>
                        <p className="text-[10px] text-mutedForeground/80 mb-1.5">{label}</p>
                        <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                          {colours.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => setToastTextColour(w.id)}
                              className={`w-full aspect-square rounded-md border-2 transition-all shrink-0 flex flex-col items-center justify-center ${
                                toastTextColourId === w.id ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'
                              }`}
                              style={{ backgroundColor: w.foreground }}
                              title={w.name}
                              aria-label={`Toast text: ${w.name}`}
                            >
                              <span className="w-1/2 h-0.5 rounded shrink-0 opacity-70" style={{ backgroundColor: w.muted }} aria-hidden />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Tab: Buttons — button colour, lines, style, texture, layout */}
            {activeTab === 'buttons' && (
              <>
                <div className="space-y-4">
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
                      Reset to default
                    </button>
                    {buttonColourId === null && <span className="text-[10px] text-mutedForeground">(using main theme)</span>}
                  </div>
                  {sectionedColours.map(({ label, colours }) => (
                    <div key={`btn-${label}`}>
                      <p className="text-[10px] text-mutedForeground/80 mb-1.5">{label}</p>
                      <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                        {colours.map((c) => {
                          const stops = c.stops && c.stops.length >= 2 ? c.stops : null;
                          const isGradient = c.id.startsWith('gradient-') || stops;
                          const swatchStyle = stops ? { background: `linear-gradient(135deg, ${stops.join(', ')})` } : isGradient ? { background: `linear-gradient(135deg, ${c.primaryDark}, ${c.primaryBright})` } : { backgroundColor: c.primary };
                          const isSelected = buttonColourId === c.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setButtonColour(c.id)}
                              className={`w-full aspect-square rounded-md border-2 transition-all shrink-0 ${isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'}`}
                              style={swatchStyle}
                              title={c.name}
                              aria-label={c.name}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-4 pt-4 border-t border-primary/20">
                  <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Minus className="w-3.5 h-3.5" />
                    Lines & progress bars
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
                    {accentLineColourId === null && <span className="text-[10px] text-mutedForeground">(using main theme)</span>}
                  </div>
                  {sectionedColours.map(({ label, colours }) => (
                    <div key={`line-${label}`}>
                      <p className="text-[10px] text-mutedForeground/80 mb-1.5">{label}</p>
                      <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                        {colours.map((c) => {
                          const stops = c.stops && c.stops.length >= 2 ? c.stops : null;
                          const isGradient = c.id.startsWith('gradient-') || stops;
                          const swatchStyle = stops ? { background: `linear-gradient(135deg, ${stops.join(', ')})` } : isGradient ? { background: `linear-gradient(135deg, ${c.primaryDark}, ${c.primaryBright})` } : { backgroundColor: c.primary };
                          const isSelected = accentLineColourId === c.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setAccentLineColour(c.id)}
                              className={`w-full aspect-square rounded-md border-2 transition-all shrink-0 ${isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'}`}
                              style={swatchStyle}
                              title={c.name}
                              aria-label={c.name}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="pt-4 border-t border-primary/20">
                  <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Square className="w-3.5 h-3.5" />
                    Button style
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {THEME_BUTTON_STYLES.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setButtonStyle(b.id)}
                        className={`px-3 py-1.5 rounded-md border-2 text-[10px] font-heading uppercase tracking-wider transition-colors ${
                          buttonStyleId === b.id ? 'bg-primary/30 text-primary border-primary' : 'border-zinc-600 bg-zinc-800 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                        }`}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pt-4 border-t border-primary/20">
                  <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2">Background texture</p>
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    {THEME_TEXTURES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTexture(t.id)}
                        className={`flex flex-col items-center gap-1 rounded-md border-2 transition-all shrink-0 ${
                          textureId === t.id ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'
                        }`}
                        title={t.name}
                        aria-label={t.name}
                      >
                        <div className="theme-texture-swatch w-full aspect-square min-h-[44px]" data-texture={t.id} />
                        <span className="text-[9px] sm:text-[10px] font-heading text-mutedForeground truncate w-full text-center px-0.5">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {activeTab === 'mobile' && (
              <>
                <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" />
                  Mobile layout
                </p>
                <p className="text-[9px] text-mutedForeground mb-3">Navigation, stats ball, and bar appearance on small screens.</p>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1.5">Navigation</p>
                    <p className="text-[9px] text-mutedForeground mb-1.5">On small screens: sidebar (slide-out menu) or bottom bar.</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setMobileNavStyle('sidebar')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 text-[10px] font-heading uppercase tracking-wider transition-colors ${
                          mobileNavStyle === 'sidebar' ? 'bg-primary/30 text-primary border-primary' : 'border-zinc-600 bg-zinc-800 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                        }`}
                      >
                        <PanelLeft className="w-3.5 h-3.5" />
                        Sidebar
                      </button>
                      <button
                        type="button"
                        onClick={() => setMobileNavStyle('bottom')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 text-[10px] font-heading uppercase tracking-wider transition-colors ${
                          mobileNavStyle === 'bottom' ? 'bg-primary/30 text-primary border-primary' : 'border-zinc-600 bg-zinc-800 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                        }`}
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                        Bottom bar
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1.5">Stats ball & panel</p>
                    <p className="text-[9px] text-mutedForeground mb-1.5">On mobile, tap the floating ball to open stats and notifications. Drag the ball to move it; position is saved. Use &quot;Customize bar&quot; inside the ball to reorder items and set size.</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1.5">Chip size (stats panel)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['small', 'medium', 'large'].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setTopBarSize(v)}
                          className={`px-3 py-1.5 rounded-md border-2 text-[10px] font-heading uppercase tracking-wider transition-colors ${
                            topBarSize === v ? 'bg-primary/30 text-primary border-primary' : 'border-zinc-600 bg-zinc-800 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                          }`}
                        >
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1.5">Spacing between chips</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['compact', 'normal', 'spread'].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setTopBarGap(v)}
                          className={`px-3 py-1.5 rounded-md border-2 text-[10px] font-heading uppercase tracking-wider transition-colors ${
                            topBarGap === v ? 'bg-primary/30 text-primary border-primary' : 'border-zinc-600 bg-zinc-800 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                          }`}
                        >
                          {v === 'compact' ? 'Close' : v === 'spread' ? 'Spread' : 'Normal'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
            {activeTab === 'topbar' && (
              <>
                <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  Top bar (stats, search, notifications)
                </p>
                <p className="text-[9px] text-mutedForeground mb-3">Spacing and size of the chips in the top bar. Drag to reorder.</p>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1.5">Spacing between chips</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['compact', 'normal', 'spread'].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setTopBarGap(v)}
                          className={`px-3 py-1.5 rounded-md border-2 text-[10px] font-heading uppercase tracking-wider transition-colors ${
                            topBarGap === v ? 'bg-primary/30 text-primary border-primary' : 'border-zinc-600 bg-zinc-800 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                          }`}
                        >
                          {v === 'compact' ? 'Close' : v === 'spread' ? 'Spread' : 'Normal'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1.5">Chip size</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['small', 'medium', 'large'].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setTopBarSize(v)}
                          className={`px-3 py-1.5 rounded-md border-2 text-[10px] font-heading uppercase tracking-wider transition-colors ${
                            topBarSize === v ? 'bg-primary/30 text-primary border-primary' : 'border-zinc-600 bg-zinc-800 text-mutedForeground hover:border-primary/50 hover:text-foreground'
                          }`}
                        >
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
