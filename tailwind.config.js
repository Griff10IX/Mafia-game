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
        foreground: '#e5e5e5',
        primary: {
          DEFAULT: '#c9a227',
          foreground: '#ffffff',
        },
        mutedForeground: '#949494',
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
