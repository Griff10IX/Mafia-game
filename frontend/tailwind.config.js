/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
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
