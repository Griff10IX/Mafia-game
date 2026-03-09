import { useState, useEffect } from 'react';
import api from '../utils/api';
import {
  Palette, X, RotateCcw, MousePointer2, Minus, LayoutGrid, Plus, Trash2,
  Type, Square, Sparkles, AlignLeft, Box, PanelLeft, PanelRight,
  LayoutDashboard, Smartphone, Check, ChevronDown, Layers, Wand2,
  Search, Eye, Grid3x3
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
  THEME_COLOURS, THEME_TEXTURES, THEME_PRESETS, THEME_FONTS,
  THEME_BUTTON_STYLES, THEME_BUTTON_SHAPES, THEME_DIVIDER_STYLES,
  THEME_SIDEBAR_SPACING, THEME_SIDEBAR_LAYOUT, THEME_TOAST_POSITION, THEME_WRITING_COLOURS, THEME_TEXT_STYLES,
  THEME_COLOUR_SECTIONS, THEME_WRITING_SECTIONS,
  DEFAULT_COLOUR_ID, DEFAULT_TEXTURE_ID, DEFAULT_FONT_ID,
  DEFAULT_BUTTON_STYLE_ID, DEFAULT_WRITING_COLOUR_ID, DEFAULT_TEXT_STYLE_ID,
  getThemeColour,
} from '../constants/themes';
import styles from '../styles/noir.module.css';

/* ─────────────────────────── helpers ─────────────────────────── */

function customToColourEntry(c) {
  const stops = c.stops?.length >= 1 ? c.stops : [c.stops?.[0] || '#888'];
  return {
    id: c.id, name: c.name || 'Custom',
    stops: stops.length >= 2 ? stops : null,
    primary: stops[0], primaryBright: stops[0],
    primaryDark: stops[stops.length - 1],
    foregroundOnPrimary: c.foregroundOnPrimary || '#ffffff',
  };
}

function swatchStyle(c) {
  if (c.stops?.length >= 2) return { background: `linear-gradient(135deg,${c.stops.slice(0,3).join(',')})` };
  if (c.id?.startsWith('gradient-')) return { background: `linear-gradient(135deg,${c.primaryDark},${c.primaryBright})` };
  return { backgroundColor: c.primary };
}

/* ─────────────────────── sub-components ─────────────────────── */

/** Pill-style toggle group */
function Pills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" onClick={() => onChange(id)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-heading font-bold uppercase tracking-wider transition-all active:scale-95 ${
            value === id
              ? 'border-primary bg-primary/20 text-primary shadow-[0_0_10px_rgba(212,175,55,0.12)]'
              : 'border-zinc-700 bg-zinc-800/70 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
          }`}>
          {Icon && <Icon className="w-3 h-3 shrink-0" />}{label}
        </button>
      ))}
    </div>
  );
}

/** Square swatch grid */
function SwatchGrid({ colours, selectedId, onSelect, cols = 8 }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` }}>
      {colours.map((c) => {
        const sw = swatchStyle(c);
        const active = selectedId === c.id;
        return (
          <button key={c.id} type="button" onClick={() => onSelect(c.id)} title={c.name} aria-label={c.name}
            className={`relative aspect-square rounded-md border-2 transition-all hover:scale-105 ${
              active ? 'border-primary ring-2 ring-primary/40 scale-105' : 'border-transparent hover:border-zinc-500'
            }`} style={sw}>
            {active && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Check className="w-3 h-3 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,1)]" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Collapsible accordion colour section */
function ColourSection({ label, colours, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const hasActive = colours.some(c => c.id === selectedId);
  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${hasActive ? 'border-primary/40' : 'border-zinc-700/60'}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-zinc-800/60 hover:bg-zinc-800 transition-colors">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`text-[10px] font-heading font-bold uppercase tracking-wider shrink-0 ${hasActive ? 'text-primary' : 'text-zinc-300'}`}>{label}</span>
          <span className="text-[9px] text-zinc-600 shrink-0">({colours.length})</span>
          <div className="flex gap-0.5 overflow-hidden">
            {colours.slice(0,10).map(c => (
              <span key={c.id} className={`w-2.5 h-2.5 rounded-sm shrink-0 border ${c.id === selectedId ? 'border-primary scale-125' : 'border-zinc-600/40'}`}
                style={swatchStyle(c)} />
            ))}
          </div>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform shrink-0 ml-2 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="p-3 bg-zinc-900/50 border-t border-zinc-700/40">
          <SwatchGrid colours={colours} selectedId={selectedId} onSelect={onSelect} cols={8} />
        </div>
      )}
    </div>
  );
}

/** Slider with +/- nudge buttons */
function SliderRow({ label, sub, min, max, value, onChange }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="text-[10px] font-heading text-zinc-300 uppercase tracking-wider">{label}</span>
          {sub && <span className="text-[9px] text-zinc-600 ml-2">{sub}</span>}
        </div>
        <span className="text-[11px] font-heading tabular-nums text-primary font-bold">{value}%</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onChange(Math.max(min, value - 5))}
          className="w-6 h-6 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-300 flex items-center justify-center text-sm transition-colors shrink-0 font-bold">−</button>
        <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))}
          className="flex-1 h-1.5 rounded-full cursor-pointer appearance-none"
          style={{ background: `linear-gradient(to right,#d4af37 ${((value-min)/(max-min))*100}%,#3f3f46 ${((value-min)/(max-min))*100}%)` }} />
        <button type="button" onClick={() => onChange(Math.min(max, value + 5))}
          className="w-6 h-6 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-300 flex items-center justify-center text-sm transition-colors shrink-0 font-bold">+</button>
      </div>
    </div>
  );
}

/** Section heading within a tab */
function TabSection({ icon: Icon, title, sub, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-primary/50 shrink-0" />}
        <span className="text-[10px] font-heading font-bold text-primary/80 uppercase tracking-widest">{title}</span>
      </div>
      {sub && <p className="text-[9px] text-zinc-600 font-heading mb-2.5 pl-5">{sub}</p>}
      {children}
    </div>
  );
}

/** Preset card for Presets tab — defined outside main component to avoid re-creation on every render */
function PresetCard({ preset, active, onSelect }) {
  const colour = getThemeColour(preset.colourId);
  const sw = swatchStyle(colour);
  return (
    <button type="button" onClick={() => onSelect(preset)} title={preset.description}
      data-testid={`theme-preset-${preset.id}`}
      className={`group flex flex-col rounded-xl border-2 overflow-hidden text-left transition-all active:scale-[0.97] ${
        active
          ? 'border-primary ring-2 ring-primary/30 shadow-[0_0_20px_rgba(212,175,55,0.15)]'
          : 'border-zinc-700 hover:border-zinc-500'
      }`}>
      <div className="h-11 w-full relative" style={sw}>
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(0,0,0,.2) 3px,rgba(0,0,0,.2) 6px)' }} />
        {active && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 flex items-center justify-center">
            <Check className="w-3 h-3 text-white" />
          </div>
        )}
      </div>
      <div className="px-2.5 py-2 bg-zinc-800/90 flex-1">
        <span className="block text-[10px] font-heading font-bold text-zinc-100 truncate leading-tight">{preset.name}</span>
        {preset.description && (
          <span className="block text-[8px] text-zinc-500 truncate mt-0.5">{preset.description}</span>
        )}
      </div>
    </button>
  );
}

/** Shared chip sizing controls for Mobile and Top Bar tabs */
function ChipSizingSection({ topBarSize, setSize, chipW, setChipWP, chipH, setChipHP, topBarGap, setGap, CHIP_MIN, CHIP_MAX, showChipWidthSub }) {
  return (
    <div className="rounded-xl border border-zinc-700/60 overflow-hidden">
      <div className="p-4 space-y-5">
        <div>
          <p className="text-[9px] font-heading text-zinc-500 uppercase tracking-wider mb-2">Size preset</p>
          <Pills
            options={['small','medium','large'].map(v => ({ id: v, label: v[0].toUpperCase()+v.slice(1) }))}
            value={topBarSize} onChange={setSize}
          />
        </div>
        <SliderRow label="Chip width" sub={showChipWidthSub ? 'Lower = more compact' : undefined} min={CHIP_MIN} max={CHIP_MAX} value={chipW} onChange={setChipWP} />
        <SliderRow label="Chip height" min={CHIP_MIN} max={CHIP_MAX} value={chipH} onChange={setChipHP} />
        <div>
          <p className="text-[9px] font-heading text-zinc-500 uppercase tracking-wider mb-2">Gap between chips</p>
          <Pills
            options={[{id:'compact',label:'Compact'},{id:'normal',label:'Normal'},{id:'spread',label:'Spread'}]}
            value={topBarGap} onChange={setGap}
          />
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════ */
export default function ThemePicker({ open, onClose }) {
  const {
    colourId, textureId, buttonColourId, accentLineColourId, fontId,
    buttonStyleId, buttonShapeId, writingColourId, mutedWritingColourId,
    toastTextColourId, textStyleId, mobileNavStyle,
    setColour, setTexture, setButtonColour, setAccentLineColour, setFont,
    setButtonStyle, setButtonShape, setWritingColour, setMutedWritingColour,
    setToastTextColour, setTextStyle, setMobileNavStyle,
    resetButtonToDefault, resetAccentLineToDefault,
    customThemes, addCustomTheme, removeCustomTheme,
  } = useTheme();

  /* ── state ── */
  const [activeTab, setActiveTab] = useState('presets');
  const [colourSearch, setColourSearch] = useState('');
  const [customName, setCustomName] = useState('');
  const [customNumColours, setCustomNumColours] = useState(2);
  const [customHexes, setCustomHexes] = useState(['#d4af37', '#b8860b', '#0d9488', '#ea580c']);
  const [customTextLight, setCustomTextLight] = useState(true);

  /* ── localStorage ── */
  const KEYS = {
    gap: 'topbar_gap', size: 'topbar_size',
    chipW: 'topbar_chip_width_scale', chipH: 'topbar_chip_height_scale',
    statsDisplay: 'mobile_stats_display',
    sidebarDividers: 'sidebar_show_dividers',
    bottomDividers: 'bottom_nav_show_dividers',
    dividerStyle: 'sidebar_divider_style',
    sidebarSpacing: 'sidebar_spacing',
    sidebarLayout: 'sidebar_layout',
    toastPosition: 'toast_position',
    toastCloseButton: 'toast_close_button',
  };
  const CHIP_MIN = 20, CHIP_MAX = 100;
  const ls = (k, fb = '') => (typeof window !== 'undefined' && localStorage.getItem(k)) || fb;
  const lsSet = (k, v, event) => { try { localStorage.setItem(k, String(v)); } catch(_){} window.dispatchEvent(new Event(event)); };

  const topBarGap = ls(KEYS.gap, 'normal');
  const topBarSize = ls(KEYS.size, 'medium');
  const mobileStatsDisplay = ls(KEYS.statsDisplay, 'right_sidebar');
  const sidebarShowDividers = ls(KEYS.sidebarDividers) === 'true';
  const bottomNavShowDividers = ls(KEYS.bottomDividers) === 'true';
  const sidebarDividerStyle = ls(KEYS.dividerStyle, 'solid');
  const sidebarSpacing = ls(KEYS.sidebarSpacing, 'normal');
  const sidebarLayout = ls(KEYS.sidebarLayout, 'default');
  const toastPosition = ls(KEYS.toastPosition, 'bottom-center');
  const toastCloseButton = ls(KEYS.toastCloseButton) !== 'false';

  const loadChip = (k) => {
    if (typeof window === 'undefined') return 50;
    const v = parseInt(localStorage.getItem(k), 10);
    return Number.isFinite(v) && v >= CHIP_MIN && v <= CHIP_MAX ? v : 50;
  };
  const [chipW, setChipW] = useState(50);
  const [chipH, setChipH] = useState(50);
  useEffect(() => { if (open) { setChipW(loadChip(KEYS.chipW)); setChipH(loadChip(KEYS.chipH)); } }, [open]);

  const setChipWP = v => { const n = Math.max(CHIP_MIN,Math.min(CHIP_MAX,v)); setChipW(n); lsSet(KEYS.chipW,n,'topbar-prefs-changed'); };
  const setChipHP = v => { const n = Math.max(CHIP_MIN,Math.min(CHIP_MAX,v)); setChipH(n); lsSet(KEYS.chipH,n,'topbar-prefs-changed'); };
  const setGap = v => lsSet(KEYS.gap,v,'topbar-prefs-changed');
  const setSize = v => lsSet(KEYS.size,v,'topbar-prefs-changed');
  const setStatsDisplay = v => lsSet(KEYS.statsDisplay,v,'mobile-stats-display-changed');
  const setSidebarDividers = v => lsSet(KEYS.sidebarDividers,v?'true':'false','sidebar-dividers-changed');
  const setDividerStyle = v => lsSet(KEYS.dividerStyle,v,'sidebar-layout-changed');
  const setSidebarSpacing = v => lsSet(KEYS.sidebarSpacing,v,'sidebar-layout-changed');
  const setSidebarLayout = (v) => {
    lsSet(KEYS.sidebarLayout, v, 'sidebar-layout-changed');
    api.patch('/profile/theme', { sidebar_layout: v }).catch(() => {});
  };
  const setToastPosition = v => lsSet(KEYS.toastPosition,v,'toast-prefs-changed');
  const setToastCloseButton = v => lsSet(KEYS.toastCloseButton,v?'true':'false','toast-prefs-changed');
  const setBottomDividers = v => lsSet(KEYS.bottomDividers,v?'true':'false','bottom-nav-dividers-changed');

  /* ── data ── */
  const allColours = [...customThemes.map(customToColourEntry), ...THEME_COLOURS];
  const colourById = Object.fromEntries(allColours.map(c => [c.id, c]));
  const sectionedColours = THEME_COLOUR_SECTIONS
    .map(({ label, ids }) => ({ label, colours: ids.map(id => colourById[id]).filter(Boolean) }))
    .filter(s => s.colours.length > 0);
  const writingById = Object.fromEntries(THEME_WRITING_COLOURS.map(w => [w.id, w]));
  const sectionedWriting = THEME_WRITING_SECTIONS
    .map(({ label, ids }) => ({ label, colours: ids.map(id => writingById[id]).filter(Boolean) }))
    .filter(s => s.colours.length > 0);

  const filteredColours = colourSearch.trim()
    ? allColours.filter(c => c.name?.toLowerCase().includes(colourSearch.toLowerCase()))
    : null;

  /* ── presets ── */
  const getPresetIsActive = (p) =>
    colourId === p.colourId && textureId === p.textureId &&
    (p.buttonColourId == null ? buttonColourId == null : buttonColourId === p.buttonColourId) &&
    (p.accentLineColourId == null ? accentLineColourId == null : accentLineColourId === p.accentLineColourId) &&
    (p.writingColourId == null || writingColourId === p.writingColourId) &&
    (p.mutedWritingColourId === undefined || (p.mutedWritingColourId == null ? mutedWritingColourId == null : mutedWritingColourId === p.mutedWritingColourId)) &&
    (p.buttonStyleId == null || buttonStyleId === p.buttonStyleId) &&
    (p.fontId == null || fontId === p.fontId) &&
    (p.textStyleId == null || textStyleId === p.textStyleId) &&
    (p.toastTextColourId === undefined || (p.toastTextColourId == null ? toastTextColourId == null : toastTextColourId === p.toastTextColourId)) &&
    (p.mobileNavStyle == null || mobileNavStyle === p.mobileNavStyle);

  const applyPreset = (p) => {
    setColour(p.colourId); setTexture(p.textureId);
    setButtonColour(p.buttonColourId ?? null); setAccentLineColour(p.accentLineColourId ?? null);
    if (p.writingColourId != null) setWritingColour(p.writingColourId);
    if (p.mutedWritingColourId !== undefined) setMutedWritingColour(p.mutedWritingColourId ?? null);
    if (p.buttonStyleId != null) setButtonStyle(p.buttonStyleId);
    if (p.fontId != null) setFont(p.fontId);
    if (p.textStyleId != null) setTextStyle(p.textStyleId);
    if (p.toastTextColourId !== undefined) setToastTextColour(p.toastTextColourId ?? null);
    if (p.mobileNavStyle != null) setMobileNavStyle(p.mobileNavStyle);
  };

  const handleSaveCustom = () => {
    const name = customName.trim() || 'My theme';
    const stops = customHexes.slice(0, customNumColours).filter(Boolean).map(h => h.startsWith('#') ? h : `#${h}`);
    if (!stops.length) return;
    const newId = addCustomTheme({ name, stops, foregroundOnPrimary: customTextLight ? '#ffffff' : '#000000' });
    setColour(newId);
    setCustomName('');
    setCustomHexes(['#d4af37','#b8860b','#0d9488','#ea580c']);
  };

  /* ── tabs ── */
  const tabs = [
    { id: 'presets',  label: 'Presets',  icon: Sparkles },
    { id: 'colours',  label: 'Colours',  icon: Palette },
    { id: 'text',     label: 'Text',     icon: Type },
    { id: 'buttons',  label: 'Buttons',  icon: Box },
    { id: 'texture',  label: 'Texture',  icon: Layers },
    { id: 'layout',   label: 'Layout',   icon: PanelLeft },
    { id: 'mobile',   label: 'Mobile',   icon: Smartphone },
    { id: 'topbar',   label: 'Top Bar',  icon: LayoutDashboard },
  ];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 bg-black/65 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`${styles.panel} rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col`}
        style={{
          background: 'linear-gradient(180deg,#1c1917 0%,#141210 100%)',
          border: '1px solid rgba(212,175,55,0.15)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.5),0 32px 80px rgba(0,0,0,0.85)',
        }}
        onClick={e => e.stopPropagation()}
        data-testid="theme-picker"
      >

        {/* ── Header ── */}
        <div
          className="px-4 py-3 flex items-center justify-between gap-3 shrink-0 border-b border-zinc-800/80"
          style={{ background: 'linear-gradient(90deg,rgba(212,175,55,0.09) 0%,transparent 60%)' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl border border-primary/30 bg-primary/15 flex items-center justify-center shrink-0">
              <Palette className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-heading font-black text-primary uppercase tracking-wider leading-none">
                Theme Studio
              </h2>
              <p className="text-[9px] text-zinc-600 font-heading mt-0.5">Changes apply instantly</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setColour(DEFAULT_COLOUR_ID); setTexture(DEFAULT_TEXTURE_ID); setFont(DEFAULT_FONT_ID);
                setButtonStyle(DEFAULT_BUTTON_STYLE_ID); setWritingColour(DEFAULT_WRITING_COLOUR_ID);
                setMutedWritingColour(null); setTextStyle(DEFAULT_TEXT_STYLE_ID);
                resetButtonToDefault(); resetAccentLineToDefault();
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-heading font-bold uppercase tracking-wider border border-zinc-700 bg-zinc-800/80 text-zinc-400 hover:border-primary/40 hover:text-primary transition-all"
              data-testid="theme-reset-default"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
            <button
              type="button" onClick={onClose} aria-label="Close"
              className="w-8 h-8 rounded-xl border border-zinc-700 bg-zinc-800/80 text-zinc-400 hover:text-primary hover:border-primary/40 flex items-center justify-center transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Tab strip ── */}
        <div
          className="flex shrink-0 overflow-x-auto border-b border-zinc-800/80 bg-zinc-900/50"
          style={{ scrollbarWidth: 'none' }}
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id} type="button" onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-[9px] font-heading font-bold uppercase tracking-wider whitespace-nowrap border-b-2 transition-all shrink-0 ${
                activeTab === id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-transparent text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">

          {/* ════ PRESETS ════ */}
          {activeTab === 'presets' && (
            <>
              <TabSection icon={Wand2} title="Quick colour presets" sub="Changes accent colour only — leaves text, buttons and layout untouched">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {THEME_PRESETS.filter(p => !p.isFullPreset).map(p => <PresetCard key={p.id} preset={p} active={getPresetIsActive(p)} onSelect={applyPreset} />)}
                </div>
              </TabSection>

              <TabSection icon={Sparkles} title="Full presets" sub="Applies accent + text + buttons + layout all at once">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {THEME_PRESETS.filter(p => p.isFullPreset).map(p => <PresetCard key={p.id} preset={p} active={getPresetIsActive(p)} onSelect={applyPreset} />)}
                </div>
              </TabSection>

              {/* Custom builder */}
              <div className="rounded-xl border border-zinc-700/70 overflow-hidden">
                <div className="px-4 py-3 bg-zinc-800/60 border-b border-zinc-700/50 flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5 text-primary/50" />
                  <span className="text-[10px] font-heading font-bold text-zinc-300 uppercase tracking-wider">
                    Build custom theme
                  </span>
                </div>
                <div className="p-4 space-y-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-heading text-zinc-500 uppercase tracking-wider">Name</span>
                      <input
                        type="text" value={customName} onChange={e => setCustomName(e.target.value)}
                        placeholder="My theme"
                        className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 focus:border-primary/50 focus:outline-none placeholder:text-zinc-700"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-heading text-zinc-500 uppercase tracking-wider">Colour stops</span>
                      <select
                        value={customNumColours} onChange={e => setCustomNumColours(Number(e.target.value))}
                        className="bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 focus:border-primary/50 focus:outline-none"
                      >
                        {[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    {[1,2,3,4].map(i => (
                      <label
                        key={i}
                        style={{ visibility: i <= customNumColours ? 'visible' : 'hidden' }}
                        className="flex flex-col gap-1.5 items-center"
                      >
                        <span className="text-[9px] font-heading text-zinc-500">Stop {i}</span>
                        <input
                          type="color" value={customHexes[i-1] || '#888888'}
                          onChange={e => { const n=[...customHexes]; n[i-1]=e.target.value; setCustomHexes(n); }}
                          className="w-10 h-10 rounded-lg border-2 border-zinc-600 cursor-pointer p-0.5 bg-transparent"
                        />
                      </label>
                    ))}
                  </div>
                  {(() => {
                    const stops = customHexes.slice(0, customNumColours).filter(Boolean);
                    const bg = stops.length >= 2 ? `linear-gradient(135deg,${stops.join(',')})` : stops[0] || '#888';
                    return (
                      <div className="flex items-center gap-3">
                        <div className="h-8 flex-1 rounded-lg border border-zinc-700/60" style={{ background: bg }} />
                        <select
                          value={customTextLight ? 'light' : 'dark'}
                          onChange={e => setCustomTextLight(e.target.value === 'light')}
                          className="bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none"
                        >
                          <option value="light">Light text</option>
                          <option value="dark">Dark text</option>
                        </select>
                        <button
                          type="button" onClick={handleSaveCustom} data-testid="theme-save-custom"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-bold uppercase border border-primary/40 bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" /> Save
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Saved themes */}
              {customThemes.length > 0 && (
                <TabSection title="Your saved themes">
                  <div className="flex flex-wrap gap-3">
                    {customThemes.map(c => {
                      const entry = customToColourEntry(c);
                      const sw = swatchStyle(entry);
                      return (
                        <div key={c.id} className="relative group flex flex-col items-center gap-1">
                          <button
                            type="button" onClick={() => setColour(c.id)} title={entry.name}
                            className={`w-12 h-12 rounded-xl border-2 transition-all flex items-center justify-center ${
                              colourId === c.id ? 'border-primary ring-2 ring-primary/30 scale-105' : 'border-zinc-700 hover:border-zinc-500'
                            }`}
                            style={sw}
                          >
                            {colourId === c.id && <Check className="w-4 h-4 text-white drop-shadow-md" />}
                          </button>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); removeCustomTheme(c.id); }}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                            aria-label={`Delete ${entry.name}`}
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                          <span className="text-[8px] text-zinc-600 truncate w-12 text-center font-heading">{entry.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </TabSection>
              )}
            </>
          )}

          {/* ════ COLOURS ════ */}
          {activeTab === 'colours' && (
            <TabSection icon={Palette} title="Accent colour" sub="Primary colour for highlights, headers, links and interactive elements">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                <input
                  type="text" value={colourSearch} onChange={e => setColourSearch(e.target.value)}
                  placeholder="Search colours…"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-8 pr-8 py-2 text-xs text-zinc-100 focus:border-primary/50 focus:outline-none placeholder:text-zinc-700"
                />
                {colourSearch && (
                  <button type="button" onClick={() => setColourSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-300" />
                  </button>
                )}
              </div>

              {filteredColours ? (
                <div>
                  <p className="text-[9px] text-zinc-600 mb-2 font-heading">
                    {filteredColours.length} result{filteredColours.length !== 1 ? 's' : ''}
                  </p>
                  <SwatchGrid colours={filteredColours} selectedId={colourId} onSelect={setColour} />
                </div>
              ) : (
                <div className="space-y-2.5">
                  {customThemes.length > 0 && (
                    <ColourSection label="Your custom colours"
                      colours={customThemes.map(customToColourEntry)}
                      selectedId={colourId} onSelect={setColour} />
                  )}
                  {/* Featured gradients */}
                  <div className="rounded-xl border border-zinc-700/60 overflow-hidden">
                    <div className="px-3 py-2 bg-zinc-800/60 text-[9px] font-heading font-bold text-zinc-400 uppercase tracking-wider">
                      Featured gradients
                    </div>
                    <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {['tone-2-sunset','tone-2-ocean','tone-2-forest','tone-2-berry','tone-2-teal-orange','tone-2-cyan-amber','tone-2-dark-teal-amber','tone-2-slate-orange'].map(id => {
                        const c = colourById[id]; if (!c) return null;
                        const sw = swatchStyle(c);
                        return (
                          <button
                            key={id} type="button" onClick={() => setColour(id)}
                            className={`flex items-center gap-2 rounded-lg border transition-all px-2 py-1.5 ${
                              colourId === id ? 'border-primary bg-primary/10' : 'border-zinc-700/60 hover:border-zinc-500 bg-zinc-800/40'
                            }`}
                          >
                            <span className="w-8 h-5 rounded shrink-0" style={sw} />
                            <span className="text-[9px] font-heading text-zinc-400 truncate flex-1">{c.name}</span>
                            {colourId === id && <Check className="w-3 h-3 text-primary shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {sectionedColours.map(({ label, colours }) => (
                    <ColourSection key={label} label={label} colours={colours} selectedId={colourId} onSelect={setColour} />
                  ))}
                </div>
              )}
            </TabSection>
          )}

          {/* ════ TEXT ════ */}
          {activeTab === 'text' && (
            <div className="space-y-6">
              <TabSection icon={AlignLeft} title="Font family" sub="Heading and body typeface">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {THEME_FONTS.map(f => (
                    <button
                      key={f.id} type="button" onClick={() => setFont(f.id)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 transition-all text-left ${
                        fontId === f.id ? 'border-primary bg-primary/10' : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-500'
                      }`}
                    >
                      <div>
                        <span className="block text-xs font-bold text-zinc-100" style={{ fontFamily: f.heading }}>{f.name}</span>
                        <span className="block text-[9px] text-zinc-500 mt-0.5" style={{ fontFamily: f.body }}>
                          The quick brown fox — Aa Bb
                        </span>
                      </div>
                      {fontId === f.id && <Check className="w-4 h-4 text-primary shrink-0 ml-2" />}
                    </button>
                  ))}
                </div>
              </TabSection>

              <TabSection title="Text weight" sub="Body text weight and style">
                <Pills
                  options={THEME_TEXT_STYLES.map(t => ({ id: t.id, label: t.name }))}
                  value={textStyleId} onChange={setTextStyle}
                />
              </TabSection>

              <TabSection icon={Type} title="Main text colour">
                <div className="space-y-2">
                  {sectionedWriting.map(({ label, colours }) => (
                    <ColourSection key={label} label={label}
                      colours={colours.map(w => ({ ...w, primary: w.foreground, stops: null }))}
                      selectedId={writingColourId} onSelect={setWritingColour} />
                  ))}
                </div>
              </TabSection>

              <TabSection title="Muted text colour" sub="Secondary / helper text — or Same as main">
                <div className="mb-2">
                  <button
                    type="button" onClick={() => setMutedWritingColour(null)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${
                      mutedWritingColourId === null ? 'border-primary bg-primary/20 text-primary' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500'
                    }`}
                  >
                    {mutedWritingColourId === null && <Check className="w-3 h-3" />} Same as main
                  </button>
                </div>
                <div className="space-y-2">
                  {sectionedWriting.map(({ label, colours }) => (
                    <ColourSection key={`m-${label}`} label={label}
                      colours={colours.map(w => ({ ...w, primary: w.foreground, stops: null }))}
                      selectedId={mutedWritingColourId} onSelect={setMutedWritingColour} />
                  ))}
                </div>
              </TabSection>

              <TabSection title="Toast notification text" sub="Colour of popup notification text">
                <div className="mb-2">
                  <button
                    type="button" onClick={() => setToastTextColour(null)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${
                      toastTextColourId === null ? 'border-primary bg-primary/20 text-primary' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500'
                    }`}
                  >
                    {toastTextColourId === null && <Check className="w-3 h-3" />} Same as main
                  </button>
                </div>
                <div className="space-y-2">
                  {sectionedWriting.map(({ label, colours }) => (
                    <ColourSection key={`t-${label}`} label={label}
                      colours={colours.map(w => ({ ...w, primary: w.foreground, stops: null }))}
                      selectedId={toastTextColourId} onSelect={setToastTextColour} />
                  ))}
                </div>
              </TabSection>
            </div>
          )}

          {/* ════ BUTTONS ════ */}
          {activeTab === 'buttons' && (
            <div className="space-y-6">
              <TabSection icon={MousePointer2} title="Button colour" sub="Overrides main accent colour for buttons only">
                <div className="flex items-center gap-2 mb-3">
                  <button
                    type="button" onClick={resetButtonToDefault} data-testid="theme-reset-buttons"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-heading font-bold uppercase border border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-primary/40 hover:text-primary transition-all"
                  >
                    <RotateCcw className="w-3 h-3" /> Use main colour
                  </button>
                  {buttonColourId === null && <span className="text-[9px] text-zinc-600 font-heading">Currently using theme colour</span>}
                </div>
                <div className="space-y-2">
                  {sectionedColours.map(({ label, colours }) => (
                    <ColourSection key={`bc-${label}`} label={label} colours={colours} selectedId={buttonColourId} onSelect={setButtonColour} />
                  ))}
                </div>
              </TabSection>

              <TabSection icon={Minus} title="Lines & progress bars" sub="Dividers, borders, progress bar fill colour">
                <div className="flex items-center gap-2 mb-3">
                  <button
                    type="button" onClick={resetAccentLineToDefault} data-testid="theme-reset-lines"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-heading font-bold uppercase border border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-primary/40 hover:text-primary transition-all"
                  >
                    <RotateCcw className="w-3 h-3" /> Use main colour
                  </button>
                  {accentLineColourId === null && <span className="text-[9px] text-zinc-600 font-heading">Currently using theme colour</span>}
                </div>
                <div className="space-y-2">
                  {sectionedColours.map(({ label, colours }) => (
                    <ColourSection key={`lc-${label}`} label={label} colours={colours} selectedId={accentLineColourId} onSelect={setAccentLineColour} />
                  ))}
                </div>
              </TabSection>

              <TabSection icon={Square} title="Button style" sub="Visual treatment of primary action buttons">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {THEME_BUTTON_STYLES.map(b => (
                    <button
                      key={b.id} type="button" onClick={() => setButtonStyle(b.id)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-[10px] font-heading font-bold uppercase tracking-wider transition-all ${
                        buttonStyleId === b.id ? 'border-primary bg-primary/10 text-primary' : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-500'
                      }`}
                    >
                      {b.name} {buttonStyleId === b.id && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              </TabSection>

              <TabSection title="Button shape" sub="Corner radius of primary buttons">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {THEME_BUTTON_SHAPES.map(s => (
                    <button
                      key={s.id} type="button" onClick={() => setButtonShape(s.id)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-[10px] font-heading font-bold uppercase tracking-wider transition-all ${
                        (buttonShapeId||'rounded') === s.id ? 'border-primary bg-primary/10 text-primary' : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-500'
                      }`}
                    >
                      {s.name} {(buttonShapeId||'rounded') === s.id && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              </TabSection>
            </div>
          )}

          {/* ════ TEXTURE ════ */}
          {activeTab === 'texture' && (
            <TabSection icon={Layers} title="Background texture" sub="Pattern overlaid on the page background">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {THEME_TEXTURES.map(t => (
                  <button
                    key={t.id} type="button" onClick={() => setTexture(t.id)}
                    title={t.name} aria-label={t.name}
                    className={`flex flex-col items-center rounded-xl border-2 overflow-hidden transition-all ${
                      textureId === t.id ? 'border-primary ring-2 ring-primary/30' : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    <div className="theme-texture-swatch w-full aspect-square relative" data-texture={t.id}>
                      {textureId === t.id && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Check className="w-5 h-5 text-white drop-shadow-md" />
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] font-heading text-zinc-400 text-center px-1 py-1.5 w-full truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            </TabSection>
          )}

          {/* ════ LAYOUT ════ */}
          {activeTab === 'layout' && (
            <div className="space-y-6">
              <TabSection icon={PanelLeft} title="Sidebar dividers" sub="Gold dividers between sidebar navigation items">
                <Pills
                  options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
                  value={sidebarShowDividers ? 'on' : 'off'}
                  onChange={v => setSidebarDividers(v === 'on')}
                />
              </TabSection>

              {sidebarShowDividers && (
                <TabSection title="Divider style" sub="Line appearance when sidebar dividers are on">
                  <Pills
                    options={THEME_DIVIDER_STYLES.map(d => ({ id: d.id, label: d.name }))}
                    value={sidebarDividerStyle} onChange={setDividerStyle}
                  />
                </TabSection>
              )}

              <TabSection title="Bottom bar dividers" sub="Dividers between bottom nav items on mobile">
                <Pills
                  options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
                  value={bottomNavShowDividers ? 'on' : 'off'}
                  onChange={v => setBottomDividers(v === 'on')}
                />
              </TabSection>

              <TabSection title="Sidebar item spacing" sub="Gap between navigation items">
                <Pills
                  options={THEME_SIDEBAR_SPACING.map(s => ({ id: s.id, label: s.name }))}
                  value={sidebarSpacing} onChange={setSidebarSpacing}
                />
              </TabSection>

              <TabSection title="Sidebar layout" sub="Flat list or categorized with headers (INFORMATION, RANKING, etc.)">
                <Pills
                  options={THEME_SIDEBAR_LAYOUT.map(s => ({ id: s.id, label: s.name }))}
                  value={sidebarLayout} onChange={setSidebarLayout}
                />
              </TabSection>

              <TabSection title="Toast position" sub="Where notifications appear. Custom: drag the grip icon to reposition.">
                <Pills
                  options={THEME_TOAST_POSITION.map(s => ({ id: s.id, label: s.name }))}
                  value={toastPosition} onChange={setToastPosition}
                />
              </TabSection>

              <TabSection title="Toast close button" sub="Show X to dismiss each toast">
                <Pills
                  options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
                  value={toastCloseButton ? 'on' : 'off'}
                  onChange={v => setToastCloseButton(v === 'on')}
                />
              </TabSection>
            </div>
          )}

          {/* ════ MOBILE ════ */}
          {activeTab === 'mobile' && (
            <div className="space-y-6">
              <TabSection icon={Smartphone} title="Navigation style" sub="Sidebar or fixed bottom bar on small screens">
                <Pills
                  options={[
                    { id: 'sidebar', label: 'Sidebar', icon: PanelLeft },
                    { id: 'bottom', label: 'Bottom bar', icon: LayoutGrid },
                  ]}
                  value={mobileNavStyle} onChange={setMobileNavStyle}
                />
              </TabSection>

              <TabSection title="Stats display" sub="Where to show health, cash and rank on mobile">
                <Pills
                  options={[
                    { id: 'top_bar',      label: 'Top bar',     icon: LayoutDashboard },
                    { id: 'touch_ball',   label: 'Touch ball',  icon: Grid3x3 },
                    { id: 'right_sidebar',label: 'Right panel', icon: PanelRight },
                  ]}
                  value={mobileStatsDisplay} onChange={setStatsDisplay}
                />
              </TabSection>

              <div className="rounded-xl border border-zinc-700/60 overflow-hidden">
                <div className="px-4 py-2.5 bg-zinc-800/50 border-b border-zinc-700/50">
                  <span className="text-[10px] font-heading font-bold text-zinc-300 uppercase tracking-wider">Stats chip sizing</span>
                </div>
                <ChipSizingSection
                  topBarSize={topBarSize} setSize={setSize} chipW={chipW} setChipWP={setChipWP} chipH={chipH} setChipHP={setChipHP}
                  topBarGap={topBarGap} setGap={setGap} CHIP_MIN={CHIP_MIN} CHIP_MAX={CHIP_MAX} showChipWidthSub={false}
                />
              </div>
            </div>
          )}

          {/* ════ TOP BAR ════ */}
          {activeTab === 'topbar' && (
            <div className="space-y-6">
              <TabSection icon={LayoutDashboard} title="Top bar chip sizing" sub="Controls size and spacing of stat chips in the top bar">
                <ChipSizingSection
                  topBarSize={topBarSize} setSize={setSize} chipW={chipW} setChipWP={setChipWP} chipH={chipH} setChipHP={setChipHP}
                  topBarGap={topBarGap} setGap={setGap} CHIP_MIN={CHIP_MIN} CHIP_MAX={CHIP_MAX} showChipWidthSub
                />
              </TabSection>
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div className="px-4 py-2 shrink-0 border-t border-zinc-800/80 bg-zinc-900/40 flex items-center gap-2">
          <Eye className="w-3 h-3 text-zinc-700 shrink-0" />
          <span className="text-[9px] font-heading text-zinc-700">
            All changes apply instantly · Click outside or press Esc to close
          </span>
        </div>

      </div>
    </div>
  );
}
