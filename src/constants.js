/**
 * App-wide theme: applies to all pages (primary/accent colour).
 * Set via Profile → Settings → Game theme settings. Stored in localStorage.
 * Default theme: Gold. Options: 'gold' | 'emerald' | 'cyan' | 'amber' | 'violet' | 'rose'
 */
export const GAME_THEME_STORAGE_KEY = 'game-theme';
export const DEFAULT_GAME_THEME = 'gold';

/** Hex palettes for CSS variables (--app-accent, --app-accent-foreground) so theme applies app-wide */
export const APP_THEME_PALETTES = {
  gold:    { accent: '#d4af37', accentForeground: '#ffffff', accentBright: '#e6c229', accentDark: '#b8860b' },
  emerald: { accent: '#10b981', accentForeground: '#ffffff', accentBright: '#34d399', accentDark: '#059669' },
  cyan:    { accent: '#06b6d4', accentForeground: '#ffffff', accentBright: '#22d3ee', accentDark: '#0891b2' },
  amber:   { accent: '#f59e0b', accentForeground: '#ffffff', accentBright: '#fbbf24', accentDark: '#d97706' },
  violet:  { accent: '#8b5cf6', accentForeground: '#ffffff', accentBright: '#a78bfa', accentDark: '#7c3aed' },
  rose:    { accent: '#f43f5e', accentForeground: '#ffffff', accentBright: '#fb7185', accentDark: '#e11d48' },
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
  gold:    { bar: 'bg-primary', text: 'text-primary', btn: 'bg-primary text-primaryForeground hover:bg-primary/90 border-primary/50', bannerBg: 'bg-primary/10', bannerText: 'text-primary', border: 'border-primary/30', tabActive: 'text-primary border-primary bg-primary/5' },
  emerald: { bar: 'bg-emerald-500', text: 'text-emerald-400', btn: 'bg-emerald-600 text-white hover:bg-emerald-500 border-emerald-500/50', bannerBg: 'bg-emerald-500/10', bannerText: 'text-emerald-400', border: 'border-emerald-500/30', tabActive: 'text-emerald-400 border-emerald-500 bg-emerald-500/10' },
  cyan:    { bar: 'bg-cyan-500', text: 'text-cyan-400', btn: 'bg-cyan-600 text-white hover:bg-cyan-500 border-cyan-500/50', bannerBg: 'bg-cyan-500/10', bannerText: 'text-cyan-400', border: 'border-cyan-500/30', tabActive: 'text-cyan-400 border-cyan-500 bg-cyan-500/10' },
  amber:   { bar: 'bg-amber-500', text: 'text-amber-400', btn: 'bg-amber-600 text-white hover:bg-amber-500 border-amber-500/50', bannerBg: 'bg-amber-500/10', bannerText: 'text-amber-400', border: 'border-amber-500/30', tabActive: 'text-amber-400 border-amber-500 bg-amber-500/10' },
  violet:  { bar: 'bg-violet-500', text: 'text-violet-400', btn: 'bg-violet-600 text-white hover:bg-violet-500 border-violet-500/50', bannerBg: 'bg-violet-500/10', bannerText: 'text-violet-400', border: 'border-violet-500/30', tabActive: 'text-violet-400 border-violet-500 bg-violet-500/10' },
  rose:    { bar: 'bg-rose-500', text: 'text-rose-400', btn: 'bg-rose-600 text-white hover:bg-rose-500 border-rose-500/50', bannerBg: 'bg-rose-500/10', bannerText: 'text-rose-400', border: 'border-rose-500/30', tabActive: 'text-rose-400 border-rose-500 bg-rose-500/10' },
};
export const GAME_THEME_OPTIONS = [
  { value: 'gold', label: 'Gold' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'amber', label: 'Amber' },
  { value: 'violet', label: 'Violet' },
  { value: 'rose', label: 'Rose' },
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
