const path = require('path');

// Use forward slashes so glob works on Windows when config is loaded from different cwd
const root = __dirname.split(path.sep).join('/');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    `${root}/src/**/*.{js,jsx,ts,tsx}`,
    `${root}/public/index.html`,
  ],
  theme: {
    extend: {
      colors: {
        border: '#2d2d2d',
        background: '#050505',
        foreground: '#f5f5f5',
        primary: {
          DEFAULT: '#d4af37',
          foreground: '#ffffff',
        },
        mutedForeground: '#a1a1aa',
        /* Noir: rich gold on neutral black (no brown) */
        noir: {
          bg: '#050505',
          panel: '#0d0d0d',
          surface: '#1a1a1a',
          raised: '#262626',
        },
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
