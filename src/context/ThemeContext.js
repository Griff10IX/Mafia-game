import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getThemeColour, getThemeTexture, DEFAULT_COLOUR_ID, DEFAULT_TEXTURE_ID } from '../constants/themes';

const STORAGE_KEY_COLOUR = 'app_theme_colour';
const STORAGE_KEY_TEXTURE = 'app_theme_texture';
const STORAGE_KEY_BUTTON = 'app_theme_button';
const STORAGE_KEY_ACCENT_LINE = 'app_theme_accent_line';

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

function applyTextureToDocument(textureId) {
  const body = document.body;
  const prev = body.getAttribute('data-texture');
  if (prev) body.removeAttribute('data-texture');
  if (textureId && textureId !== 'none') {
    body.setAttribute('data-texture', textureId);
  }
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
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
      return v === '' ? null : (v || null);
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

  useEffect(() => {
    const colour = getThemeColour(colourId);
    applyColourToDocument(colour);
    const buttonColour = buttonColourId ? getThemeColour(buttonColourId) : colour;
    applyButtonColourToDocument(buttonColour);
    const accentLineColour = accentLineColourId ? getThemeColour(accentLineColourId) : colour;
    applyAccentLineToDocument(accentLineColour);
  }, [colourId, buttonColourId, accentLineColourId]);

  useEffect(() => {
    applyTextureToDocument(textureId);
  }, [textureId]);

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
    colour: getThemeColour(colourId),
    texture: getThemeTexture(textureId),
    buttonColour: buttonColourId ? getThemeColour(buttonColourId) : null,
    accentLineColour: accentLineColourId ? getThemeColour(accentLineColourId) : null,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
