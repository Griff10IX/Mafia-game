/**
 * App-wide theme: applies to all pages (primary/accent colour).
 * Set via Profile → Settings → Game theme settings. Stored in localStorage.
 * Default theme: Gold. Options: 'gold' | 'emerald' | 'cyan' | 'amber' | 'violet' | 'rose'
 */
export const GAME_THEME_STORAGE_KEY = 'game-theme';
export const DEFAULT_GAME_THEME = 'gold';

/** Hex palettes for CSS variables (--app-accent, --app-accent-foreground) so theme applies app-wide */
export const APP_THEME_PALETTES = {
  gold:     { accent: '#d4af37', accentForeground: '#ffffff', accentBright: '#e6c229', accentDark: '#b8860b' },
  emerald:  { accent: '#10b981', accentForeground: '#ffffff', accentBright: '#34d399', accentDark: '#059669' },
  teal:     { accent: '#14b8a6', accentForeground: '#ffffff', accentBright: '#2dd4bf', accentDark: '#0d9488' },
  cyan:     { accent: '#06b6d4', accentForeground: '#ffffff', accentBright: '#22d3ee', accentDark: '#0891b2' },
  sky:      { accent: '#0ea5e9', accentForeground: '#ffffff', accentBright: '#38bdf8', accentDark: '#0284c7' },
  blue:     { accent: '#3b82f6', accentForeground: '#ffffff', accentBright: '#60a5fa', accentDark: '#2563eb' },
  indigo:   { accent: '#6366f1', accentForeground: '#ffffff', accentBright: '#818cf8', accentDark: '#4f46e5' },
  violet:   { accent: '#8b5cf6', accentForeground: '#ffffff', accentBright: '#a78bfa', accentDark: '#7c3aed' },
  purple:   { accent: '#a855f7', accentForeground: '#ffffff', accentBright: '#c084fc', accentDark: '#9333ea' },
  fuchsia:  { accent: '#d946ef', accentForeground: '#ffffff', accentBright: '#e879f9', accentDark: '#c026d3' },
  pink:     { accent: '#ec4899', accentForeground: '#ffffff', accentBright: '#f472b6', accentDark: '#db2777' },
  rose:     { accent: '#f43f5e', accentForeground: '#ffffff', accentBright: '#fb7185', accentDark: '#e11d48' },
  red:      { accent: '#ef4444', accentForeground: '#ffffff', accentBright: '#f87171', accentDark: '#dc2626' },
  orange:   { accent: '#f97316', accentForeground: '#ffffff', accentBright: '#fb923c', accentDark: '#ea580c' },
  amber:    { accent: '#f59e0b', accentForeground: '#ffffff', accentBright: '#fbbf24', accentDark: '#d97706' },
  lime:     { accent: '#84cc16', accentForeground: '#000000', accentBright: '#a3e635', accentDark: '#65a30d' },
  yellow:   { accent: '#eab308', accentForeground: '#000000', accentBright: '#facc15', accentDark: '#ca8a04' },
  copper:   { accent: '#b45309', accentForeground: '#ffffff', accentBright: '#d97706', accentDark: '#92400e' },
};

/** Apply the selected theme to the document so all pages (noir CSS, Tailwind primary) use it. Call on mount and when theme changes. */
export const applyAppTheme = () => {
  if (typeof document === 'undefined') return;
  try {
    const saved = localStorage.getItem(GAME_THEME_STORAGE_KEY);
    const key = saved && APP_THEME_PALETTES[saved] ? saved : DEFAULT_GAME_THEME;
    const p = APP_THEME_PALETTES[key];
    const root = document.documentElement;
    root.style.setProperty('--app-accent', p.accent);
    root.style.setProperty('--app-accent-foreground', p.accentForeground);
    root.style.setProperty('--app-accent-bright', p.accentBright);
    root.style.setProperty('--app-accent-dark', p.accentDark);
  } catch (_) {}
};
export const RACKET_ACCENT_STYLES = {
  gold:     { bar: 'bg-primary', text: 'text-primary', btn: 'bg-primary text-primaryForeground hover:bg-primary/90 border-primary/50', bannerBg: 'bg-primary/10', bannerText: 'text-primary', border: 'border-primary/30', tabActive: 'text-primary border-primary bg-primary/5' },
  emerald:  { bar: 'bg-emerald-500', text: 'text-emerald-400', btn: 'bg-emerald-600 text-white hover:bg-emerald-500 border-emerald-500/50', bannerBg: 'bg-emerald-500/10', bannerText: 'text-emerald-400', border: 'border-emerald-500/30', tabActive: 'text-emerald-400 border-emerald-500 bg-emerald-500/10' },
  teal:     { bar: 'bg-teal-500', text: 'text-teal-400', btn: 'bg-teal-600 text-white hover:bg-teal-500 border-teal-500/50', bannerBg: 'bg-teal-500/10', bannerText: 'text-teal-400', border: 'border-teal-500/30', tabActive: 'text-teal-400 border-teal-500 bg-teal-500/10' },
  cyan:     { bar: 'bg-cyan-500', text: 'text-cyan-400', btn: 'bg-cyan-600 text-white hover:bg-cyan-500 border-cyan-500/50', bannerBg: 'bg-cyan-500/10', bannerText: 'text-cyan-400', border: 'border-cyan-500/30', tabActive: 'text-cyan-400 border-cyan-500 bg-cyan-500/10' },
  sky:      { bar: 'bg-sky-500', text: 'text-sky-400', btn: 'bg-sky-600 text-white hover:bg-sky-500 border-sky-500/50', bannerBg: 'bg-sky-500/10', bannerText: 'text-sky-400', border: 'border-sky-500/30', tabActive: 'text-sky-400 border-sky-500 bg-sky-500/10' },
  blue:     { bar: 'bg-blue-500', text: 'text-blue-400', btn: 'bg-blue-600 text-white hover:bg-blue-500 border-blue-500/50', bannerBg: 'bg-blue-500/10', bannerText: 'text-blue-400', border: 'border-blue-500/30', tabActive: 'text-blue-400 border-blue-500 bg-blue-500/10' },
  indigo:   { bar: 'bg-indigo-500', text: 'text-indigo-400', btn: 'bg-indigo-600 text-white hover:bg-indigo-500 border-indigo-500/50', bannerBg: 'bg-indigo-500/10', bannerText: 'text-indigo-400', border: 'border-indigo-500/30', tabActive: 'text-indigo-400 border-indigo-500 bg-indigo-500/10' },
  violet:   { bar: 'bg-violet-500', text: 'text-violet-400', btn: 'bg-violet-600 text-white hover:bg-violet-500 border-violet-500/50', bannerBg: 'bg-violet-500/10', bannerText: 'text-violet-400', border: 'border-violet-500/30', tabActive: 'text-violet-400 border-violet-500 bg-violet-500/10' },
  purple:   { bar: 'bg-purple-500', text: 'text-purple-400', btn: 'bg-purple-600 text-white hover:bg-purple-500 border-purple-500/50', bannerBg: 'bg-purple-500/10', bannerText: 'text-purple-400', border: 'border-purple-500/30', tabActive: 'text-purple-400 border-purple-500 bg-purple-500/10' },
  fuchsia:  { bar: 'bg-fuchsia-500', text: 'text-fuchsia-400', btn: 'bg-fuchsia-600 text-white hover:bg-fuchsia-500 border-fuchsia-500/50', bannerBg: 'bg-fuchsia-500/10', bannerText: 'text-fuchsia-400', border: 'border-fuchsia-500/30', tabActive: 'text-fuchsia-400 border-fuchsia-500 bg-fuchsia-500/10' },
  pink:     { bar: 'bg-pink-500', text: 'text-pink-400', btn: 'bg-pink-600 text-white hover:bg-pink-500 border-pink-500/50', bannerBg: 'bg-pink-500/10', bannerText: 'text-pink-400', border: 'border-pink-500/30', tabActive: 'text-pink-400 border-pink-500 bg-pink-500/10' },
  rose:     { bar: 'bg-rose-500', text: 'text-rose-400', btn: 'bg-rose-600 text-white hover:bg-rose-500 border-rose-500/50', bannerBg: 'bg-rose-500/10', bannerText: 'text-rose-400', border: 'border-rose-500/30', tabActive: 'text-rose-400 border-rose-500 bg-rose-500/10' },
  red:      { bar: 'bg-red-500', text: 'text-red-400', btn: 'bg-red-600 text-white hover:bg-red-500 border-red-500/50', bannerBg: 'bg-red-500/10', bannerText: 'text-red-400', border: 'border-red-500/30', tabActive: 'text-red-400 border-red-500 bg-red-500/10' },
  orange:   { bar: 'bg-orange-500', text: 'text-orange-400', btn: 'bg-orange-600 text-white hover:bg-orange-500 border-orange-500/50', bannerBg: 'bg-orange-500/10', bannerText: 'text-orange-400', border: 'border-orange-500/30', tabActive: 'text-orange-400 border-orange-500 bg-orange-500/10' },
  amber:    { bar: 'bg-amber-500', text: 'text-amber-400', btn: 'bg-amber-600 text-white hover:bg-amber-500 border-amber-500/50', bannerBg: 'bg-amber-500/10', bannerText: 'text-amber-400', border: 'border-amber-500/30', tabActive: 'text-amber-400 border-amber-500 bg-amber-500/10' },
  lime:     { bar: 'bg-lime-500', text: 'text-lime-400', btn: 'bg-lime-600 text-white hover:bg-lime-500 border-lime-500/50', bannerBg: 'bg-lime-500/10', bannerText: 'text-lime-400', border: 'border-lime-500/30', tabActive: 'text-lime-400 border-lime-500 bg-lime-500/10' },
  yellow:   { bar: 'bg-yellow-500', text: 'text-yellow-400', btn: 'bg-yellow-600 text-white hover:bg-yellow-500 border-yellow-500/50', bannerBg: 'bg-yellow-500/10', bannerText: 'text-yellow-400', border: 'border-yellow-500/30', tabActive: 'text-yellow-400 border-yellow-500 bg-yellow-500/10' },
  copper:   { bar: 'bg-amber-700', text: 'text-amber-500', btn: 'bg-amber-700 text-white hover:bg-amber-600 border-amber-600/50', bannerBg: 'bg-amber-600/10', bannerText: 'text-amber-500', border: 'border-amber-600/30', tabActive: 'text-amber-500 border-amber-600 bg-amber-600/10' },
};

/** Theme options with label and accent hex for swatch preview */
export const GAME_THEME_OPTIONS = [
  { value: 'gold', label: 'Gold', color: '#d4af37' },
  { value: 'emerald', label: 'Emerald', color: '#10b981' },
  { value: 'teal', label: 'Teal', color: '#14b8a6' },
  { value: 'cyan', label: 'Cyan', color: '#06b6d4' },
  { value: 'sky', label: 'Sky', color: '#0ea5e9' },
  { value: 'blue', label: 'Blue', color: '#3b82f6' },
  { value: 'indigo', label: 'Indigo', color: '#6366f1' },
  { value: 'violet', label: 'Violet', color: '#8b5cf6' },
  { value: 'purple', label: 'Purple', color: '#a855f7' },
  { value: 'fuchsia', label: 'Fuchsia', color: '#d946ef' },
  { value: 'pink', label: 'Pink', color: '#ec4899' },
  { value: 'rose', label: 'Rose', color: '#f43f5e' },
  { value: 'red', label: 'Red', color: '#ef4444' },
  { value: 'orange', label: 'Orange', color: '#f97316' },
  { value: 'amber', label: 'Amber', color: '#f59e0b' },
  { value: 'lime', label: 'Lime', color: '#84cc16' },
  { value: 'yellow', label: 'Yellow', color: '#eab308' },
  { value: 'copper', label: 'Copper', color: '#b45309' },
];
export const getRacketAccent = () => {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(GAME_THEME_STORAGE_KEY) : null;
    const key = saved && RACKET_ACCENT_STYLES[saved] ? saved : DEFAULT_GAME_THEME;
    return RACKET_ACCENT_STYLES[key];
  } catch {
    return RACKET_ACCENT_STYLES[DEFAULT_GAME_THEME];
  }
};

/**
 * Jail page background (Al Capone prison cell) for the status cards.
 * Uses local public/jail-background.jpg if present; otherwise the URL below.
 * Override: set REACT_APP_JAIL_BACKGROUND_IMAGE in .env (e.g. /jail-background.png if you used .png).
 */
const JAIL_BACKGROUND_URL =
  'https://media.istockphoto.com/id/146916841/photo/al-capones-old-prison-cell-in-black-and-white.jpg?s=612x612&w=0&k=20&c=7-xMDByWhz32QGkQyVJ3BoDHIIrrMRXLbZNjxT9lPhA=';

const JAIL_BACKGROUND_LOCAL = `${process.env.PUBLIC_URL || ''}/jail-background.jpg`;

export const JAIL_BACKGROUND_IMAGE =
  process.env.REACT_APP_JAIL_BACKGROUND_IMAGE || JAIL_BACKGROUND_LOCAL || JAIL_BACKGROUND_URL;

/**
 * Full-page background for the Jail route (Alcatraz panorama). Override: REACT_APP_JAIL_PAGE_BACKGROUND in .env.
 */
export const JAIL_PAGE_BACKGROUND =
  process.env.REACT_APP_JAIL_PAGE_BACKGROUND ||
  'https://thumbs.dreamstime.com/b/panorama-alcatraz-island-famous-prison-building-san-francisco-usa-black-white-image-panorama-alcatraz-island-99504728.jpg?w=992';
