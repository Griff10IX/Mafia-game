import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getThemeColour, getThemeTexture, DEFAULT_COLOUR_ID, DEFAULT_TEXTURE_ID } from '../constants/themes';

const STORAGE_KEY_COLOUR = 'app_theme_colour';
const STORAGE_KEY_TEXTURE = 'app_theme_texture';

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
  const hsl = hexToHsl(colour.primary);
  root.style.setProperty('--primary', `${hsl.h} ${hsl.s}% ${hsl.l}%`);
  const fgIsWhite = colour.foregroundOnPrimary.toLowerCase() === '#ffffff' || colour.foregroundOnPrimary.toLowerCase() === '#fff';
  root.style.setProperty('--primary-foreground', fgIsWhite ? '0 0% 100%' : '0 0% 0%');
  root.style.setProperty('--noir-primary', colour.primary);
  root.style.setProperty('--noir-primary-bright', colour.primaryBright);
  root.style.setProperty('--noir-primary-dark', colour.primaryDark);
  root.style.setProperty('--noir-primary-foreground', colour.foregroundOnPrimary);
  const rgb = hexToRgb(colour.primary);
  if (rgb) {
    root.style.setProperty('--noir-primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  }
  const brightRgb = hexToRgb(colour.primaryBright);
  if (brightRgb) {
    root.style.setProperty('--noir-primary-bright-rgb', `${brightRgb.r}, ${brightRgb.g}, ${brightRgb.b}`);
  }
  const darkRgb = hexToRgb(colour.primaryDark);
  if (darkRgb) {
    root.style.setProperty('--noir-primary-dark-rgb', `${darkRgb.r}, ${darkRgb.g}, ${darkRgb.b}`);
  }
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

  useEffect(() => {
    const colour = getThemeColour(colourId);
    applyColourToDocument(colour);
  }, [colourId]);

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

  const value = {
    colourId,
    textureId,
    setColour,
    setTexture,
    colour: getThemeColour(colourId),
    texture: getThemeTexture(textureId),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
