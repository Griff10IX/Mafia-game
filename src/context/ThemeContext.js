import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  getThemeColour,
  getThemeTexture,
  getThemeFont,
  getThemeButtonStyle,
  getThemeWritingColour,
  getThemeTextStyle,
  getThemePreset,
  DEFAULT_COLOUR_ID,
  DEFAULT_TEXTURE_ID,
  DEFAULT_FONT_ID,
  DEFAULT_BUTTON_STYLE_ID,
  DEFAULT_WRITING_COLOUR_ID,
  DEFAULT_TEXT_STYLE_ID,
  DEFAULT_THEME_VARIANT,
  DEFAULT_BUTTON_SHAPE_ID,
  THEME_LAYOUT_RESET_DEFAULTS,
  THEME_RESET_CLASSIC_ID,
} from '../constants/themes';
import api from '../utils/api';
import { getThemeUiPlatform } from '../utils/themePlatform';

const STORAGE_KEY_COLOUR = 'app_theme_colour';
const STORAGE_KEY_TEXTURE = 'app_theme_texture';
const STORAGE_KEY_BUTTON = 'app_theme_button';
const STORAGE_KEY_ACCENT_LINE = 'app_theme_accent_line';
const STORAGE_KEY_FONT = 'app_theme_font';
const STORAGE_KEY_BUTTON_STYLE = 'app_theme_button_style';
const STORAGE_KEY_WRITING = 'app_theme_writing_colour';
const STORAGE_KEY_MUTED_WRITING = 'app_theme_muted_writing_colour';
const STORAGE_KEY_TOAST_TEXT = 'app_theme_toast_text_colour';
const STORAGE_KEY_TEXT_STYLE = 'app_theme_text_style';
const STORAGE_KEY_CUSTOM_THEMES = 'app_theme_custom_themes';
const STORAGE_KEY_MOBILE_NAV = 'app_theme_mobile_nav';
const MOBILE_STATS_DISPLAY_LS = 'mobile_stats_display';
const STORAGE_KEY_BUTTON_SHAPE = 'app_theme_button_shape';
const STORAGE_KEY_THEME_VARIANT = 'app_theme_variant';
const STORAGE_KEY_MODERN_VISUAL_QUALITY = 'app_theme_modern_visual_quality';

const LS_TOPBAR_GAP = 'topbar_gap';
const LS_TOPBAR_SIZE = 'topbar_size';
const LS_TOPBAR_CHIP_W = 'topbar_chip_width_scale';
const LS_TOPBAR_CHIP_H = 'topbar_chip_height_scale';
const LS_SIDEBAR_DIVIDERS = 'sidebar_show_dividers';
const LS_BOTTOM_NAV_DIVIDERS = 'bottom_nav_show_dividers';
const LS_SIDEBAR_DIV_STYLE = 'sidebar_divider_style';
const LS_SIDEBAR_SPACING = 'sidebar_spacing';
const LS_TOAST_POS = 'toast_position';
const LS_TOAST_CLOSE = 'toast_close_button';
const LS_KILL_TOAST = 'kill_toast_style';
const LS_TOAST_X = 'toast_custom_x';
const LS_TOAST_Y = 'toast_custom_y';
const LS_STAT_ORDER = 'topbar_stat_order';
const LS_NOTIF_BALL = 'notification_ball_position';
const CHIP_LS_MIN = 20;
const CHIP_LS_MAX = 100;
const VALID_TOPBAR_STAT_IDS = new Set(['rank', 'health', 'bullets', 'kills', 'money', 'points', 'respect_points', 'notifications', 'property']);

/** Apply layout prefs returned from GET /profile/theme to localStorage. Returns event names to dispatch. */
function applyLayoutPrefsFromServerToLS(prefs) {
  const events = new Set();
  try {
    if (prefs.topBarGap === 'compact' || prefs.topBarGap === 'normal' || prefs.topBarGap === 'spread') {
      localStorage.setItem(LS_TOPBAR_GAP, prefs.topBarGap);
      events.add('topbar-prefs-changed');
    }
    if (prefs.topBarSize === 'small' || prefs.topBarSize === 'medium' || prefs.topBarSize === 'large') {
      localStorage.setItem(LS_TOPBAR_SIZE, prefs.topBarSize);
      events.add('topbar-prefs-changed');
    }
    const cw = prefs.topBarChipWidthScale;
    if (typeof cw === 'number' && Number.isFinite(cw) && cw >= CHIP_LS_MIN && cw <= CHIP_LS_MAX) {
      localStorage.setItem(LS_TOPBAR_CHIP_W, String(Math.round(cw)));
      events.add('topbar-prefs-changed');
    }
    const ch = prefs.topBarChipHeightScale;
    if (typeof ch === 'number' && Number.isFinite(ch) && ch >= CHIP_LS_MIN && ch <= CHIP_LS_MAX) {
      localStorage.setItem(LS_TOPBAR_CHIP_H, String(Math.round(ch)));
      events.add('topbar-prefs-changed');
    }
    if (typeof prefs.sidebarShowDividers === 'boolean') {
      localStorage.setItem(LS_SIDEBAR_DIVIDERS, prefs.sidebarShowDividers ? 'true' : 'false');
      events.add('sidebar-dividers-changed');
    }
    if (typeof prefs.bottomNavShowDividers === 'boolean') {
      localStorage.setItem(LS_BOTTOM_NAV_DIVIDERS, prefs.bottomNavShowDividers ? 'true' : 'false');
      events.add('bottom-nav-dividers-changed');
    }
    if (prefs.sidebarDividerStyle === 'solid' || prefs.sidebarDividerStyle === 'dotted' || prefs.sidebarDividerStyle === 'dashed') {
      localStorage.setItem(LS_SIDEBAR_DIV_STYLE, prefs.sidebarDividerStyle);
      events.add('sidebar-layout-changed');
    }
    if (prefs.sidebarSpacing === 'compact' || prefs.sidebarSpacing === 'normal' || prefs.sidebarSpacing === 'relaxed') {
      localStorage.setItem(LS_SIDEBAR_SPACING, prefs.sidebarSpacing);
      events.add('sidebar-layout-changed');
    }
    const tp = prefs.toastPosition;
    if (['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'custom'].includes(tp)) {
      localStorage.setItem(LS_TOAST_POS, tp);
      events.add('toast-prefs-changed');
    }
    if (typeof prefs.toastCloseButton === 'boolean') {
      localStorage.setItem(LS_TOAST_CLOSE, prefs.toastCloseButton ? 'true' : 'false');
      events.add('toast-prefs-changed');
    }
    if (prefs.killToastStyle === 'banner' || prefs.killToastStyle === 'popup') {
      localStorage.setItem(LS_KILL_TOAST, prefs.killToastStyle);
      events.add('kill-toast-style-changed');
    }
    const tcx = prefs.toastCustomX;
    const tcy = prefs.toastCustomY;
    if (typeof tcx === 'number' && Number.isFinite(tcx)) {
      localStorage.setItem(LS_TOAST_X, String(Math.round(tcx)));
      events.add('toast-prefs-changed');
    }
    if (typeof tcy === 'number' && Number.isFinite(tcy)) {
      localStorage.setItem(LS_TOAST_Y, String(Math.round(tcy)));
      events.add('toast-prefs-changed');
    }
    if (Array.isArray(prefs.topBarStatOrder) && prefs.topBarStatOrder.length
        && prefs.topBarStatOrder.every((id) => typeof id === 'string' && VALID_TOPBAR_STAT_IDS.has(id))) {
      localStorage.setItem(LS_STAT_ORDER, JSON.stringify(prefs.topBarStatOrder));
      events.add('topbar-stat-order-changed');
    }
    const nbp = prefs.notificationBallPosition;
    if (nbp && typeof nbp.x === 'number' && typeof nbp.y === 'number' && Number.isFinite(nbp.x) && Number.isFinite(nbp.y)) {
      localStorage.setItem(LS_NOTIF_BALL, JSON.stringify({ x: Math.round(nbp.x), y: Math.round(nbp.y) }));
      events.add('notification-ball-changed');
    }
  } catch (_) {}
  return [...events];
}

/** Read layout-related keys from localStorage for PATCH /profile/theme snapshot. */
function readLayoutSnapshotForPatch() {
  const o = {};
  try {
    if (typeof localStorage === 'undefined') return o;
    const g = localStorage.getItem(LS_TOPBAR_GAP);
    if (g === 'compact' || g === 'normal' || g === 'spread') o.top_bar_gap = g;
    const sz = localStorage.getItem(LS_TOPBAR_SIZE);
    if (sz === 'small' || sz === 'medium' || sz === 'large') o.top_bar_size = sz;
    const cw = parseInt(localStorage.getItem(LS_TOPBAR_CHIP_W), 10);
    if (Number.isFinite(cw) && cw >= CHIP_LS_MIN && cw <= CHIP_LS_MAX) o.top_bar_chip_width_scale = cw;
    const ch = parseInt(localStorage.getItem(LS_TOPBAR_CHIP_H), 10);
    if (Number.isFinite(ch) && ch >= CHIP_LS_MIN && ch <= CHIP_LS_MAX) o.top_bar_chip_height_scale = ch;
    const sd = localStorage.getItem(LS_SIDEBAR_DIVIDERS);
    if (sd === 'true') o.sidebar_show_dividers = true;
    else if (sd === 'false') o.sidebar_show_dividers = false;
    const bd = localStorage.getItem(LS_BOTTOM_NAV_DIVIDERS);
    if (bd === 'true') o.bottom_nav_show_dividers = true;
    else if (bd === 'false') o.bottom_nav_show_dividers = false;
    const dstyle = localStorage.getItem(LS_SIDEBAR_DIV_STYLE);
    if (dstyle === 'solid' || dstyle === 'dotted' || dstyle === 'dashed') o.sidebar_divider_style = dstyle;
    const ssp = localStorage.getItem(LS_SIDEBAR_SPACING);
    if (ssp === 'compact' || ssp === 'normal' || ssp === 'relaxed') o.sidebar_spacing = ssp;
    const tp = localStorage.getItem(LS_TOAST_POS);
    if (['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'custom'].includes(tp)) o.toast_position = tp;
    const tc = localStorage.getItem(LS_TOAST_CLOSE);
    if (tc === 'true') o.toast_close_button = true;
    else if (tc === 'false') o.toast_close_button = false;
    const kts = localStorage.getItem(LS_KILL_TOAST);
    if (kts === 'banner' || kts === 'popup') o.kill_toast_style = kts;
    const tx = parseInt(localStorage.getItem(LS_TOAST_X), 10);
    if (Number.isFinite(tx)) o.toast_custom_x = tx;
    const ty = parseInt(localStorage.getItem(LS_TOAST_Y), 10);
    if (Number.isFinite(ty)) o.toast_custom_y = ty;
    const rawOrder = localStorage.getItem(LS_STAT_ORDER);
    if (rawOrder) {
      const parsed = JSON.parse(rawOrder);
      if (Array.isArray(parsed) && parsed.length
          && parsed.every((id) => typeof id === 'string' && VALID_TOPBAR_STAT_IDS.has(id))) {
        o.top_bar_stat_order = parsed;
      }
    }
    const rawBall = localStorage.getItem(LS_NOTIF_BALL);
    if (rawBall) {
      const p = JSON.parse(rawBall);
      if (typeof p?.x === 'number' && typeof p?.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        o.notification_ball_position = { x: Math.round(p.x), y: Math.round(p.y) };
      }
    }
  } catch (_) {}
  return o;
}

/** Convert saved custom theme to colour shape used by applyColourToDocument */
function customToColour(custom) {
  if (!custom || !custom.stops || custom.stops.length < 1) return null;
  const stops = custom.stops.slice(0, 4);
  const primary = stops[0];
  const primaryDark = stops[stops.length - 1];
  return {
    primary,
    primaryBright: primary,
    primaryDark,
    foregroundOnPrimary: custom.foregroundOnPrimary || '#ffffff',
    stops: stops.length >= 2 ? stops : null,
  };
}

function getResolvedColour(colourId, customThemes) {
  if (!colourId) return null;
  const custom = customThemes?.find((c) => c.id === colourId);
  if (custom) return customToColour(custom);
  return getThemeColour(colourId);
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return { h: 43, s: 74, l: 52 };
  let r = rgb.r / 255;
  let g = rgb.g / 255;
  let b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h;
  let s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return {
    h: Math.round(360 * h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function applyColourToDocument(colour) {
  if (!colour) return;
  const root = document.documentElement;
  const stops = colour.stops && colour.stops.length >= 2 ? colour.stops : null;
  const primary = stops ? stops[0] : colour.primary;
  const primaryBright = stops ? stops[0] : colour.primaryBright;
  const primaryDark = stops ? stops[stops.length - 1] : colour.primaryDark;

  const hsl = hexToHsl(primary);
  root.style.setProperty('--primary', `${hsl.h} ${hsl.s}% ${hsl.l}%`);
  const fgIsWhite = colour.foregroundOnPrimary.toLowerCase() === '#ffffff' || colour.foregroundOnPrimary.toLowerCase() === '#fff';
  root.style.setProperty('--primary-foreground', fgIsWhite ? '0 0% 100%' : '0 0% 0%');
  root.style.setProperty('--noir-primary', primary);
  root.style.setProperty('--noir-primary-bright', primaryBright);
  root.style.setProperty('--noir-primary-dark', primaryDark);
  root.style.setProperty('--noir-primary-foreground', colour.foregroundOnPrimary);

  if (stops) {
    const g1 = stops[0];
    const g2 = stops[1] ?? stops[0];
    const g3 = stops[2] ?? g2;
    const g4 = stops[3] ?? g3;
    root.style.setProperty('--noir-gradient-1', g1);
    root.style.setProperty('--noir-gradient-2', g2);
    root.style.setProperty('--noir-gradient-3', g3);
    root.style.setProperty('--noir-gradient-4', g4);
  } else {
    root.style.setProperty('--noir-gradient-1', colour.primaryBright);
    root.style.setProperty('--noir-gradient-2', colour.primaryDark);
    root.style.setProperty('--noir-gradient-3', colour.primaryDark);
    root.style.setProperty('--noir-gradient-4', colour.primaryDark);
  }

  const rgb = hexToRgb(primary);
  if (rgb) {
    root.style.setProperty('--noir-primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  }
  const brightRgb = hexToRgb(primaryBright);
  if (brightRgb) {
    root.style.setProperty('--noir-primary-bright-rgb', `${brightRgb.r}, ${brightRgb.g}, ${brightRgb.b}`);
  }
  const darkRgb = hexToRgb(primaryDark);
  if (darkRgb) {
    root.style.setProperty('--noir-primary-dark-rgb', `${darkRgb.r}, ${darkRgb.g}, ${darkRgb.b}`);
  }
}

function applyButtonColourToDocument(buttonColour) {
  if (!buttonColour) return;
  const root = document.documentElement;
  const stops = buttonColour.stops && buttonColour.stops.length >= 2 ? buttonColour.stops : null;
  const primary = stops ? stops[0] : buttonColour.primary;
  const primaryBright = stops ? stops[0] : buttonColour.primaryBright;
  const primaryDark = stops ? stops[stops.length - 1] : buttonColour.primaryDark;

  const hsl = hexToHsl(primary);
  root.style.setProperty('--button-primary', `${hsl.h} ${hsl.s}% ${hsl.l}%`);
  const fgIsWhite = buttonColour.foregroundOnPrimary.toLowerCase() === '#ffffff' || buttonColour.foregroundOnPrimary.toLowerCase() === '#fff';
  root.style.setProperty('--button-foreground', fgIsWhite ? '0 0% 100%' : '0 0% 0%');
  root.style.setProperty('--noir-button-foreground', buttonColour.foregroundOnPrimary);
  if (buttonColour.foregroundShadow) {
    root.style.setProperty('--noir-button-text-shadow', buttonColour.foregroundShadow);
  } else {
    root.style.removeProperty('--noir-button-text-shadow');
  }

  if (stops) {
    const g1 = stops[0];
    const g2 = stops[1] ?? stops[0];
    const g3 = stops[2] ?? g2;
    const g4 = stops[3] ?? g3;
    root.style.setProperty('--noir-button-gradient-1', g1);
    root.style.setProperty('--noir-button-gradient-2', g2);
    root.style.setProperty('--noir-button-gradient-3', g3);
    root.style.setProperty('--noir-button-gradient-4', g4);
  } else {
    root.style.setProperty('--noir-button-gradient-1', primaryBright);
    root.style.setProperty('--noir-button-gradient-2', primaryDark);
    root.style.setProperty('--noir-button-gradient-3', primaryDark);
    root.style.setProperty('--noir-button-gradient-4', primaryDark);
  }

  const rgb = hexToRgb(primary);
  if (rgb) {
    root.style.setProperty('--noir-button-primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  }
  root.style.setProperty('--noir-button-border', buttonColour.primaryBright ?? primaryBright);
}

function applyAccentLineToDocument(accentLineColour) {
  if (!accentLineColour) return;
  const root = document.documentElement;
  const stops = accentLineColour.stops && accentLineColour.stops.length >= 2 ? accentLineColour.stops : null;
  const primary = stops ? stops[0] : accentLineColour.primary;
  const primaryDark = stops ? stops[stops.length - 1] : accentLineColour.primaryDark;
  root.style.setProperty('--noir-accent-line', primary);
  root.style.setProperty('--noir-accent-line-dark', primaryDark);
}

function applyFontToDocument(font) {
  if (!font) return;
  const root = document.documentElement;
  root.style.setProperty('--font-heading', font.heading);
  root.style.setProperty('--font-body', font.body);
}

function hexToHslString(hex) {
  const hsl = hexToHsl(hex);
  return `${hsl.h} ${hsl.s}% ${hsl.l}%`;
}

function applyWritingColourToDocument(foregroundHex, mutedHex) {
  if (!foregroundHex) return;
  const root = document.documentElement;
  root.style.setProperty('--noir-foreground', foregroundHex);
  root.style.setProperty('--noir-muted', mutedHex || foregroundHex);
  root.style.setProperty('--foreground', hexToHslString(foregroundHex));
  root.style.setProperty('--muted-foreground', hexToHslString(mutedHex || foregroundHex));
}

function applyTextStyleToDocument(style) {
  if (!style) return;
  const root = document.documentElement;
  root.style.setProperty('--app-font-weight', style.fontWeight);
  root.style.setProperty('--app-font-style', style.fontStyle);
}

function applyTextureToDocument(textureId) {
  const body = document.body;
  const prev = body.getAttribute('data-texture');
  if (prev) body.removeAttribute('data-texture');
  if (textureId && textureId !== 'none') {
    body.setAttribute('data-texture', textureId);
  }
}

function applyThemeVariantToDocument(themeVariant) {
  const body = document.body;
  const root = document.documentElement;
  const variant = themeVariant === 'modern' ? 'modern' : 'classic';
  if (variant === 'modern') {
    body.setAttribute('data-theme-variant', 'modern');
    root.setAttribute('data-theme-variant', 'modern');
  } else {
    body.removeAttribute('data-theme-variant');
    root.removeAttribute('data-theme-variant');
  }
}

function applyModernPerfFlagToDocument(themeVariant, modernVisualQuality) {
  const body = document.body;
  const root = document.documentElement;
  const isModern = themeVariant === 'modern';
  const usePerf = modernVisualQuality !== 'high';
  if (isModern && usePerf) {
    body.setAttribute('data-modern-perf', 'on');
    root.setAttribute('data-modern-perf', 'on');
  } else {
    body.removeAttribute('data-modern-perf');
    root.removeAttribute('data-modern-perf');
    body.removeAttribute('data-busy-animations');
    root.removeAttribute('data-busy-animations');
  }
}

/** Android Blink/WebView: backdrop-filter on fixed/floating UI + scroll often shows GPU "static" (e.g. Samsung Chrome). */
function shouldApplyMobileCompositorBackdropWorkaround() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (!/Android/i.test(ua)) return false;
  if (/Firefox/i.test(ua)) return false;
  return /Chrome\/|SamsungBrowser|Version\/[\d.]+.*Chrome|CriOS|EdgA/i.test(ua);
}

function applyMobileCompositorSafeToDocument() {
  const body = document.body;
  const root = document.documentElement;
  if (shouldApplyMobileCompositorBackdropWorkaround()) {
    body.setAttribute('data-mobile-compositor-safe', 'on');
    root.setAttribute('data-mobile-compositor-safe', 'on');
  } else {
    body.removeAttribute('data-mobile-compositor-safe');
    root.removeAttribute('data-mobile-compositor-safe');
  }
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const themeSourceRef = useRef('local'); // 'server' = just loaded from API, skip next persist
  /** True after first GET /profile/theme settles (success or failure). Used to avoid first-visit theme modal racing server prefs. */
  const [themeServerHydrated, setThemeServerHydrated] = useState(false);
  const [colourId, setColourIdState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_COLOUR) || DEFAULT_COLOUR_ID;
    } catch {
      return DEFAULT_COLOUR_ID;
    }
  });
  const [textureId, setTextureIdState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_TEXTURE) || DEFAULT_TEXTURE_ID;
    } catch {
      return DEFAULT_TEXTURE_ID;
    }
  });
  const [buttonColourId, setButtonColourIdState] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY_BUTTON);
      if (v === null) return null;
      if (v === '') return null;
      return v;
    } catch {
      return null;
    }
  });
  const [accentLineColourId, setAccentLineColourIdState] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY_ACCENT_LINE);
      return v === '' ? null : (v || null);
    } catch {
      return null;
    }
  });
  const [fontId, setFontIdState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_FONT) || DEFAULT_FONT_ID;
    } catch {
      return DEFAULT_FONT_ID;
    }
  });
  const [buttonStyleId, setButtonStyleIdState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_BUTTON_STYLE) || DEFAULT_BUTTON_STYLE_ID;
    } catch {
      return DEFAULT_BUTTON_STYLE_ID;
    }
  });
  const [writingColourId, setWritingColourIdState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_WRITING) || DEFAULT_WRITING_COLOUR_ID;
    } catch {
      return DEFAULT_WRITING_COLOUR_ID;
    }
  });
  const [mutedWritingColourId, setMutedWritingColourIdState] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY_MUTED_WRITING);
      return (v === '' || v == null) ? null : v;
    } catch {
      return null;
    }
  });
  const [toastTextColourId, setToastTextColourIdState] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY_TOAST_TEXT);
      return (v === '' || v == null) ? null : v;
    } catch {
      return null;
    }
  });
  const [textStyleId, setTextStyleIdState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_TEXT_STYLE) || DEFAULT_TEXT_STYLE_ID;
    } catch {
      return DEFAULT_TEXT_STYLE_ID;
    }
  });
  const [customThemes, setCustomThemesState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_THEMES);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [mobileNavStyle, setMobileNavStyleState] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY_MOBILE_NAV);
      if (v === 'bottom') return 'bottom';
      if (v === 'sidebar') return 'sidebar';
      return 'bottom';
    } catch {
      return 'bottom';
    }
  });
  const [buttonShapeId, setButtonShapeIdState] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY_BUTTON_SHAPE);
      if (v === 'sharp' || v === 'rounded' || v === 'pill') return v;
    } catch (_) {}
    return 'rounded';
  });
  const [themeVariant, setThemeVariantState] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY_THEME_VARIANT);
      if (v === 'modern' || v === 'classic') return v;
      const texture = localStorage.getItem(STORAGE_KEY_TEXTURE);
      if (texture === 'modern-soft') return 'modern';
    } catch (_) {}
    return DEFAULT_THEME_VARIANT;
  });
  const [modernVisualQuality, setModernVisualQualityState] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY_MODERN_VISUAL_QUALITY);
      return v === 'high' ? 'high' : 'performance';
    } catch (_) {}
    return 'performance';
  });
  useEffect(() => {
    const colour = getResolvedColour(colourId, customThemes);
    applyColourToDocument(colour);
    const buttonColour = buttonColourId
      ? getResolvedColour(buttonColourId, customThemes)
      : { ...colour, stops: [colour.primary, colour.primary, colour.primary, colour.primary] };
    applyButtonColourToDocument(buttonColour);
    const accentLineColour = accentLineColourId ? getResolvedColour(accentLineColourId, customThemes) : colour;
    applyAccentLineToDocument(accentLineColour);
  }, [colourId, buttonColourId, accentLineColourId, customThemes]);

  useEffect(() => {
    const font = getThemeFont(fontId);
    applyFontToDocument(font);
  }, [fontId]);

  useEffect(() => {
    document.documentElement.setAttribute('data-button-style', buttonStyleId || 'original');
  }, [buttonStyleId]);

  useEffect(() => {
    document.documentElement.setAttribute('data-button-shape', buttonShapeId || 'rounded');
  }, [buttonShapeId]);

  useEffect(() => {
    const w = getThemeWritingColour(writingColourId);
    const mutedHex = mutedWritingColourId
      ? getThemeWritingColour(mutedWritingColourId).foreground
      : w.muted;
    applyWritingColourToDocument(w.foreground, mutedHex);
  }, [writingColourId, mutedWritingColourId]);

  useEffect(() => {
    const toastW = getThemeWritingColour(toastTextColourId || writingColourId);
    document.documentElement.style.setProperty('--noir-toast-foreground', toastW.foreground);
  }, [toastTextColourId, writingColourId]);

  useEffect(() => {
    const style = getThemeTextStyle(textStyleId);
    applyTextStyleToDocument(style);
  }, [textStyleId]);

  const persistCustomThemes = useCallback((next) => {
    setCustomThemesState(next);
    try {
      localStorage.setItem(STORAGE_KEY_CUSTOM_THEMES, JSON.stringify(next));
    } catch (_) {}
  }, []);

  const addCustomTheme = useCallback((theme) => {
    const id = theme.id || `custom-${Date.now()}`;
    const next = [...customThemes, { ...theme, id }];
    persistCustomThemes(next);
    return id;
  }, [customThemes, persistCustomThemes]);

  const removeCustomTheme = useCallback((id) => {
    const next = customThemes.filter((c) => c.id !== id);
    persistCustomThemes(next);
    if (colourId === id) {
      setColourIdState(DEFAULT_COLOUR_ID);
      try {
        localStorage.setItem(STORAGE_KEY_COLOUR, DEFAULT_COLOUR_ID);
      } catch (_) {}
    }
    if (buttonColourId === id) {
      setButtonColourIdState(null);
      try {
        localStorage.setItem(STORAGE_KEY_BUTTON, '');
      } catch (_) {}
    }
    if (accentLineColourId === id) {
      setAccentLineColourIdState(null);
      try {
        localStorage.setItem(STORAGE_KEY_ACCENT_LINE, '');
      } catch (_) {}
    }
  }, [customThemes, persistCustomThemes, colourId, buttonColourId, accentLineColourId]);

  useEffect(() => {
    applyTextureToDocument(textureId);
  }, [textureId]);

  useEffect(() => {
    applyThemeVariantToDocument(themeVariant);
    applyModernPerfFlagToDocument(themeVariant, modernVisualQuality);
  }, [themeVariant, modernVisualQuality]);

  useEffect(() => {
    applyMobileCompositorSafeToDocument();
  }, []);

  const themeLoadedRef = useRef(false);
  const serverThemePcRef = useRef(null);
  const serverThemeMobileRef = useRef(null);
  const themeViewportBucketRef = useRef(null);

  const applyThemePreferencesFromServer = useCallback((prefs) => {
    if (!prefs || typeof prefs !== 'object' || Object.keys(prefs).length === 0) {
      try {
        localStorage.setItem(STORAGE_KEY_FONT, DEFAULT_FONT_ID);
        setFontIdState(DEFAULT_FONT_ID);
      } catch (_) {}
      return;
    }
    themeSourceRef.current = 'server';
    try {
      if (prefs.sidebarLayout != null && (prefs.sidebarLayout === 'default' || prefs.sidebarLayout === 'categorized' || prefs.sidebarLayout === 'categorized_classic')) {
        localStorage.setItem('sidebar_layout', prefs.sidebarLayout);
        window.dispatchEvent(new Event('sidebar-layout-changed'));
      }
      if (prefs.colourId != null) { localStorage.setItem(STORAGE_KEY_COLOUR, prefs.colourId); setColourIdState(prefs.colourId); }
      if (prefs.textureId != null) { localStorage.setItem(STORAGE_KEY_TEXTURE, prefs.textureId); setTextureIdState(prefs.textureId); }
      if (prefs.buttonColourId !== undefined) { localStorage.setItem(STORAGE_KEY_BUTTON, prefs.buttonColourId || ''); setButtonColourIdState(prefs.buttonColourId || null); }
      if (prefs.accentLineColourId !== undefined) { localStorage.setItem(STORAGE_KEY_ACCENT_LINE, prefs.accentLineColourId || ''); setAccentLineColourIdState(prefs.accentLineColourId || null); }
      if (prefs.fontId != null && prefs.fontId !== '') {
        localStorage.setItem(STORAGE_KEY_FONT, prefs.fontId);
        setFontIdState(prefs.fontId);
      } else {
        localStorage.setItem(STORAGE_KEY_FONT, DEFAULT_FONT_ID);
        setFontIdState(DEFAULT_FONT_ID);
      }
      if (prefs.buttonStyleId != null) { localStorage.setItem(STORAGE_KEY_BUTTON_STYLE, prefs.buttonStyleId); setButtonStyleIdState(prefs.buttonStyleId); }
      if (prefs.writingColourId != null) { localStorage.setItem(STORAGE_KEY_WRITING, prefs.writingColourId); setWritingColourIdState(prefs.writingColourId); }
      if (prefs.mutedWritingColourId !== undefined) { localStorage.setItem(STORAGE_KEY_MUTED_WRITING, prefs.mutedWritingColourId || ''); setMutedWritingColourIdState(prefs.mutedWritingColourId || null); }
      if (prefs.toastTextColourId !== undefined) { localStorage.setItem(STORAGE_KEY_TOAST_TEXT, prefs.toastTextColourId || ''); setToastTextColourIdState(prefs.toastTextColourId || null); }
      if (prefs.textStyleId != null) { localStorage.setItem(STORAGE_KEY_TEXT_STYLE, prefs.textStyleId); setTextStyleIdState(prefs.textStyleId); }
      const loadedThemeVariant = (prefs.themeVariant === 'modern' || prefs.themeVariant === 'classic')
        ? prefs.themeVariant
        : (prefs.theme_variant === 'modern' || prefs.theme_variant === 'classic')
        ? prefs.theme_variant
        : (prefs.textureId === 'modern-soft' ? 'modern' : DEFAULT_THEME_VARIANT);
      localStorage.setItem(STORAGE_KEY_THEME_VARIANT, loadedThemeVariant);
      setThemeVariantState(loadedThemeVariant);
      if (Array.isArray(prefs.customThemes)) { localStorage.setItem(STORAGE_KEY_CUSTOM_THEMES, JSON.stringify(prefs.customThemes)); setCustomThemesState(prefs.customThemes); }
      if (prefs.mobileNavStyle === 'bottom' || prefs.mobileNavStyle === 'sidebar') {
        localStorage.setItem(STORAGE_KEY_MOBILE_NAV, prefs.mobileNavStyle);
        setMobileNavStyleState(prefs.mobileNavStyle);
      }
      if (prefs.mobileStatsDisplay != null && ['top_bar', 'touch_ball', 'right_sidebar'].includes(prefs.mobileStatsDisplay)) {
        try {
          localStorage.setItem(MOBILE_STATS_DISPLAY_LS, prefs.mobileStatsDisplay);
          window.dispatchEvent(new Event('mobile-stats-display-changed'));
        } catch (_) {}
      }
      if (prefs.buttonShapeId != null) { localStorage.setItem(STORAGE_KEY_BUTTON_SHAPE, prefs.buttonShapeId); setButtonShapeIdState(prefs.buttonShapeId); }
      applyLayoutPrefsFromServerToLS(prefs).forEach((ev) => {
        try { window.dispatchEvent(new Event(ev)); } catch (_) {}
      });
      try {
        localStorage.setItem('app_initial_theme_chosen', '1');
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('app-initial-theme-chosen'));
      } catch (_) {}
    } catch (_) {}
  }, []);

  const buildThemePatchPayload = useCallback(() => {
    let mobile_stats_display = null;
    try {
      const msd = typeof localStorage !== 'undefined' ? localStorage.getItem(MOBILE_STATS_DISPLAY_LS) : null;
      if (msd === 'top_bar' || msd === 'touch_ball' || msd === 'right_sidebar') mobile_stats_display = msd;
    } catch (_) {}
    return {
      colour_id: colourId,
      texture_id: textureId,
      button_colour_id: buttonColourId || null,
      accent_line_colour_id: accentLineColourId || null,
      font_id: fontId,
      button_style_id: buttonStyleId,
      writing_colour_id: writingColourId,
      muted_writing_colour_id: mutedWritingColourId || null,
      toast_text_colour_id: toastTextColourId || null,
      text_style_id: textStyleId,
      custom_themes: customThemes,
      theme_variant: themeVariant,
      sidebar_layout: (typeof localStorage !== 'undefined' && localStorage.getItem('sidebar_layout')) || null,
      mobile_nav_style: mobileNavStyle || null,
      mobile_stats_display,
      button_shape_id: buttonShapeId || null,
      ...readLayoutSnapshotForPatch(),
    };
  }, [colourId, textureId, buttonColourId, accentLineColourId, fontId, buttonStyleId, writingColourId, mutedWritingColourId, toastTextColourId, textStyleId, customThemes, themeVariant, mobileNavStyle, buttonShapeId]);

  useEffect(() => {
    api.get('/profile/theme').then((res) => {
      const pc = res.data?.theme_preferences_pc ?? res.data?.theme_preferences ?? {};
      const mobile = res.data?.theme_preferences_mobile ?? res.data?.theme_preferences ?? {};
      serverThemePcRef.current = pc;
      serverThemeMobileRef.current = mobile;
      themeViewportBucketRef.current = getThemeUiPlatform();
      const prefs = getThemeUiPlatform() === 'mobile' ? mobile : pc;
      applyThemePreferencesFromServer(prefs);
    }).catch(() => {}).finally(() => {
      themeLoadedRef.current = true;
      setThemeServerHydrated(true);
    });
  }, [applyThemePreferencesFromServer]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 767px)');
    const onViewportThemeBucketChange = async () => {
      const next = getThemeUiPlatform();
      const prev = themeViewportBucketRef.current;
      if (prev == null || next === prev) return;
      if (!themeLoadedRef.current) return;
      themeViewportBucketRef.current = next;
      const payload = { ...buildThemePatchPayload(), theme_platform: prev };
      try {
        await api.patch('/profile/theme', payload);
      } catch (_) {}
      try {
        const res = await api.get('/profile/theme');
        const npc = res.data?.theme_preferences_pc ?? res.data?.theme_preferences ?? {};
        const nmo = res.data?.theme_preferences_mobile ?? res.data?.theme_preferences ?? {};
        serverThemePcRef.current = npc;
        serverThemeMobileRef.current = nmo;
        const toApply = next === 'mobile' ? nmo : npc;
        applyThemePreferencesFromServer(toApply);
      } catch (_) {}
    };
    mq.addEventListener('change', onViewportThemeBucketChange);
    return () => mq.removeEventListener('change', onViewportThemeBucketChange);
  }, [applyThemePreferencesFromServer, buildThemePatchPayload]);

  useEffect(() => {
    if (!themeLoadedRef.current) return;
    if (themeSourceRef.current === 'server') {
      themeSourceRef.current = 'local';
      return;
    }
    const payload = { ...buildThemePatchPayload(), theme_platform: getThemeUiPlatform() };
    api.patch('/profile/theme', payload).then(() => {
      try { window.dispatchEvent(new CustomEvent('theme-saved')); } catch (_) {}
    }).catch(() => {});
  }, [colourId, textureId, buttonColourId, accentLineColourId, fontId, buttonStyleId, writingColourId, mutedWritingColourId, toastTextColourId, textStyleId, customThemes, themeVariant, mobileNavStyle, buttonShapeId, buildThemePatchPayload]);

  const setColour = useCallback((id) => {
    setColourIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY_COLOUR, id);
    } catch (_) {}
  }, []);

  const setTexture = useCallback((id) => {
    setTextureIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY_TEXTURE, id);
    } catch (_) {}
  }, []);

  const setButtonColour = useCallback((id) => {
    setButtonColourIdState(id || null);
    try {
      localStorage.setItem(STORAGE_KEY_BUTTON, id || '');
    } catch (_) {}
  }, []);

  const resetButtonToDefault = useCallback(() => {
    setButtonColourIdState(null);
    try {
      localStorage.setItem(STORAGE_KEY_BUTTON, '');
    } catch (_) {}
  }, []);

  const setAccentLineColour = useCallback((id) => {
    setAccentLineColourIdState(id || null);
    try {
      localStorage.setItem(STORAGE_KEY_ACCENT_LINE, id || '');
    } catch (_) {}
  }, []);

  const resetAccentLineToDefault = useCallback(() => {
    setAccentLineColourIdState(null);
    try {
      localStorage.setItem(STORAGE_KEY_ACCENT_LINE, '');
    } catch (_) {}
  }, []);

  const setFont = useCallback((id) => {
    setFontIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY_FONT, id);
    } catch (_) {}
  }, []);

  const setButtonStyle = useCallback((id) => {
    setButtonStyleIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY_BUTTON_STYLE, id);
    } catch (_) {}
  }, []);

  const setButtonShape = useCallback((id) => {
    const v = id === 'sharp' || id === 'pill' ? id : 'rounded';
    setButtonShapeIdState(v);
    try {
      localStorage.setItem(STORAGE_KEY_BUTTON_SHAPE, v);
    } catch (_) {}
  }, []);

  const setWritingColour = useCallback((id) => {
    setWritingColourIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY_WRITING, id);
    } catch (_) {}
  }, []);

  const setMutedWritingColour = useCallback((id) => {
    const v = id || null;
    setMutedWritingColourIdState(v);
    try {
      localStorage.setItem(STORAGE_KEY_MUTED_WRITING, v === null ? '' : v);
    } catch (_) {}
  }, []);

  const setToastTextColour = useCallback((id) => {
    const v = id || null;
    setToastTextColourIdState(v);
    try {
      localStorage.setItem(STORAGE_KEY_TOAST_TEXT, v === null ? '' : v);
    } catch (_) {}
  }, []);

  const setTextStyle = useCallback((id) => {
    setTextStyleIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY_TEXT_STYLE, id);
    } catch (_) {}
  }, []);

  const setMobileNavStyle = useCallback((style) => {
    const v = style === 'bottom' ? 'bottom' : 'sidebar';
    setMobileNavStyleState(v);
    try {
      localStorage.setItem(STORAGE_KEY_MOBILE_NAV, v);
    } catch (_) {}
    try {
      window.dispatchEvent(new Event('toast-prefs-changed'));
    } catch (_) {}
  }, []);

  const setThemeVariant = useCallback((variant) => {
    const v = variant === 'modern' ? 'modern' : 'classic';
    setThemeVariantState(v);
    if (v === 'modern') {
      setTextureIdState('modern-soft');
      try {
        localStorage.setItem(STORAGE_KEY_TEXTURE, 'modern-soft');
      } catch (_) {}
    }
    try {
      localStorage.setItem(STORAGE_KEY_THEME_VARIANT, v);
    } catch (_) {}
  }, []);

  const setModernVisualQuality = useCallback((quality) => {
    const v = quality === 'high' ? 'high' : 'performance';
    setModernVisualQualityState(v);
    try {
      localStorage.setItem(STORAGE_KEY_MODERN_VISUAL_QUALITY, v);
    } catch (_) {}
  }, []);

  /**
   * Full restore to a starting preset (Classic / Modern): colour axes + layout chrome defaults.
   * Writes localStorage keys Layout listens for and PATCHes /profile/theme.
   */
  const resetThemeToPreset = useCallback((presetId = THEME_RESET_CLASSIC_ID) => {
    const p = getThemePreset(presetId);
    const layout = THEME_LAYOUT_RESET_DEFAULTS;
    const colour = p.colourId || DEFAULT_COLOUR_ID;
    const texture = p.textureId || DEFAULT_TEXTURE_ID;
    const font = p.fontId || DEFAULT_FONT_ID;
    const buttonStyle = p.buttonStyleId || DEFAULT_BUTTON_STYLE_ID;
    const writing = p.writingColourId || DEFAULT_WRITING_COLOUR_ID;
    const textStyle = p.textStyleId || DEFAULT_TEXT_STYLE_ID;
    const variant = p.themeVariant === 'modern' ? 'modern' : DEFAULT_THEME_VARIANT;
    const mobileNav = p.mobileNavStyle === 'sidebar' ? 'sidebar' : 'bottom';
    const buttonShape = p.buttonShapeId || layout.buttonShapeId || DEFAULT_BUTTON_SHAPE_ID;
    const mobileStats = p.mobileStatsDisplay || 'right_sidebar';
    const sidebarLayout = p.sidebarLayout || 'categorized_classic';
    const resolvedTexture = variant === 'modern' ? 'modern-soft' : texture;

    setColourIdState(colour);
    setTextureIdState(resolvedTexture);
    setButtonColourIdState(p.buttonColourId ?? null);
    setAccentLineColourIdState(p.accentLineColourId ?? null);
    setFontIdState(font);
    setButtonStyleIdState(buttonStyle);
    setWritingColourIdState(writing);
    setMutedWritingColourIdState(p.mutedWritingColourId ?? null);
    setToastTextColourIdState(p.toastTextColourId ?? null);
    setTextStyleIdState(textStyle);
    setMobileNavStyleState(mobileNav);
    setThemeVariantState(variant);
    setButtonShapeIdState(buttonShape === 'sharp' || buttonShape === 'pill' ? buttonShape : 'rounded');

    try {
      localStorage.setItem(STORAGE_KEY_COLOUR, colour);
      localStorage.setItem(STORAGE_KEY_TEXTURE, resolvedTexture);
      localStorage.setItem(STORAGE_KEY_BUTTON, p.buttonColourId || '');
      localStorage.setItem(STORAGE_KEY_ACCENT_LINE, p.accentLineColourId || '');
      localStorage.setItem(STORAGE_KEY_FONT, font);
      localStorage.setItem(STORAGE_KEY_BUTTON_STYLE, buttonStyle);
      localStorage.setItem(STORAGE_KEY_WRITING, writing);
      localStorage.setItem(STORAGE_KEY_MUTED_WRITING, p.mutedWritingColourId || '');
      localStorage.setItem(STORAGE_KEY_TOAST_TEXT, p.toastTextColourId || '');
      localStorage.setItem(STORAGE_KEY_TEXT_STYLE, textStyle);
      localStorage.setItem(STORAGE_KEY_MOBILE_NAV, mobileNav);
      localStorage.setItem(STORAGE_KEY_THEME_VARIANT, variant);
      localStorage.setItem(STORAGE_KEY_BUTTON_SHAPE, buttonShape === 'sharp' || buttonShape === 'pill' ? buttonShape : 'rounded');

      localStorage.setItem('mobile_stats_display', mobileStats);
      localStorage.setItem('sidebar_layout', sidebarLayout);
      localStorage.setItem('topbar_gap', layout.topBarGap);
      localStorage.setItem('topbar_size', layout.topBarSize);
      localStorage.setItem('topbar_chip_width_scale', String(layout.topBarChipWidthScale));
      localStorage.setItem('topbar_chip_height_scale', String(layout.topBarChipHeightScale));
      localStorage.setItem('sidebar_show_dividers', layout.sidebarShowDividers ? 'true' : 'false');
      localStorage.setItem('bottom_nav_show_dividers', layout.bottomNavShowDividers ? 'true' : 'false');
      localStorage.setItem('sidebar_divider_style', layout.sidebarDividerStyle);
      localStorage.setItem('sidebar_spacing', layout.sidebarSpacing);
      localStorage.setItem('toast_position', layout.toastPosition);
      localStorage.setItem('toast_close_button', layout.toastCloseButton ? 'true' : 'false');
      localStorage.setItem('kill_toast_style', layout.killToastStyle);

      window.dispatchEvent(new Event('mobile-stats-display-changed'));
      window.dispatchEvent(new Event('sidebar-layout-changed'));
      window.dispatchEvent(new Event('topbar-prefs-changed'));
      window.dispatchEvent(new Event('sidebar-dividers-changed'));
      window.dispatchEvent(new Event('bottom-nav-dividers-changed'));
      window.dispatchEvent(new Event('toast-prefs-changed'));
      window.dispatchEvent(new Event('kill-toast-style-changed'));
    } catch (_) { /* ignore */ }

    const payload = {
      colour_id: colour,
      texture_id: resolvedTexture,
      button_colour_id: p.buttonColourId ?? null,
      accent_line_colour_id: p.accentLineColourId ?? null,
      font_id: font,
      button_style_id: buttonStyle,
      writing_colour_id: writing,
      muted_writing_colour_id: p.mutedWritingColourId ?? null,
      toast_text_colour_id: p.toastTextColourId ?? null,
      text_style_id: textStyle,
      theme_variant: variant,
      mobile_nav_style: mobileNav,
      button_shape_id: buttonShape === 'sharp' || buttonShape === 'pill' ? buttonShape : 'rounded',
      mobile_stats_display: mobileStats,
      sidebar_layout: sidebarLayout,
      top_bar_gap: layout.topBarGap,
      top_bar_size: layout.topBarSize,
      top_bar_chip_width_scale: layout.topBarChipWidthScale,
      top_bar_chip_height_scale: layout.topBarChipHeightScale,
      sidebar_show_dividers: layout.sidebarShowDividers,
      bottom_nav_show_dividers: layout.bottomNavShowDividers,
      sidebar_divider_style: layout.sidebarDividerStyle,
      sidebar_spacing: layout.sidebarSpacing,
      toast_position: layout.toastPosition,
      toast_close_button: layout.toastCloseButton,
      kill_toast_style: layout.killToastStyle,
      theme_platform: getThemeUiPlatform(),
    };
    api.patch('/profile/theme', payload).then(() => {
      try { window.dispatchEvent(new CustomEvent('theme-saved')); } catch (_) {}
    }).catch(() => {});

    return p;
  }, []);

  const value = {
    colourId,
    textureId,
    buttonColourId,
    accentLineColourId,
    setColour,
    setTexture,
    setButtonColour,
    setAccentLineColour,
    resetButtonToDefault,
    resetAccentLineToDefault,
    resetThemeToPreset,
    fontId,
    buttonStyleId,
    setFont,
    setButtonStyle,
    setButtonShape,
    writingColourId,
    setWritingColour,
    mutedWritingColourId,
    setMutedWritingColour,
    toastTextColourId,
    setToastTextColour,
    textStyleId,
    setTextStyle,
    customThemes,
    addCustomTheme,
    removeCustomTheme,
    getResolvedColour: (id) => getResolvedColour(id, customThemes),
    colour: getResolvedColour(colourId, customThemes),
    texture: getThemeTexture(textureId),
    font: getThemeFont(fontId),
    buttonStyle: getThemeButtonStyle(buttonStyleId),
    buttonShapeId,
    writingColour: getThemeWritingColour(writingColourId),
    mutedWritingColour: mutedWritingColourId ? getThemeWritingColour(mutedWritingColourId) : null,
    toastTextColour: toastTextColourId ? getThemeWritingColour(toastTextColourId) : null,
    textStyle: getThemeTextStyle(textStyleId),
    buttonColour: buttonColourId ? getResolvedColour(buttonColourId, customThemes) : null,
    accentLineColour: accentLineColourId ? getResolvedColour(accentLineColourId, customThemes) : null,
    mobileNavStyle,
    setMobileNavStyle,
    themeVariant,
    setThemeVariant,
    modernVisualQuality,
    setModernVisualQuality,
    themeServerHydrated,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
