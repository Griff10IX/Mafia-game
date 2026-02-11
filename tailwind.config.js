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
        border: '#3d3520',
        background: '#050505',
        foreground: '#e8e4dc',
        primary: {
          DEFAULT: '#c9a227',
          foreground: '#ffffff',
        },
        mutedForeground: '#a89878',
        /* Noir 1920s–30s: warm brown-blacks for panels/sidebar */
        noir: {
          bg: '#0a0806',
          panel: '#12100c',
          surface: '#1a1612',
          raised: '#252019',
        },
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
