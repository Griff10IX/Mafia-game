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
        background: '#1a1a1a',
        foreground: '#f5f5f5',
        primary: {
          DEFAULT: '#d4af37',
          foreground: '#ffffff',
        },
        mutedForeground: '#a1a1aa',
        profit: '#5cb85c',
        /* Noir: match reference – layered blacks, gold */
        noir: {
          bg: '#000000',
          panel: '#0d0d0d',
          content: '#1a1a1a',
          surface: '#282828',
          raised: '#333333',
        },
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
