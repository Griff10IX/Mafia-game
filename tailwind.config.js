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
        // Base theme colors - dark zinc palette
        border: 'hsl(240 3.7% 15.9%)', // zinc-800
        background: 'hsl(240 10% 3.9%)', // zinc-950
        foreground: 'hsl(0 0% 98%)', // zinc-50
        card: 'hsl(240 5.9% 10%)', // zinc-900
        input: 'hsl(240 4.8% 12%)', // zinc-900/lighter
        secondary: 'hsl(240 4.8% 20%)', // zinc-800
        
        // Primary - Yellow/Gold theme (original)
        primary: {
          DEFAULT: '#eab308', // yellow-500
          foreground: '#000000', // black text on yellow
        },
        
        // Muted text
        mutedForeground: '#a1a1aa', // zinc-400
        
        // Status colors
        profit: '#22c55e', // green-500
        destructive: '#ef4444', // red-500
        
        /* Noir palette - layered blacks and golds */
        noir: {
          bg: '#09090b', // zinc-950
          panel: '#18181b', // zinc-900
          content: '#27272a', // zinc-800
          surface: '#3f3f46', // zinc-700
          raised: '#52525b', // zinc-600
          gold: '#eab308', // yellow-500
          amber: '#f59e0b', // amber-500
        },
      },
      
      fontFamily: {
        heading: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      
      // Animations for dice and interactive elements
      keyframes: {
        'dice-roll': {
          '0%, 100%': { transform: 'rotate(0deg) scale(1)' },
          '25%': { transform: 'rotate(90deg) scale(1.1)' },
          '50%': { transform: 'rotate(180deg) scale(1)' },
          '75%': { transform: 'rotate(270deg) scale(1.1)' },
        },
        'dice-win': {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '50%': { transform: 'scale(1.1)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'dice-lose': {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '50%': { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      
      animation: {
        'dice-roll': 'dice-roll 1s linear infinite',
        'dice-win': 'dice-win 0.5s ease-out',
        'dice-lose': 'dice-lose 0.5s ease-out',
        'pulse-slow': 'pulse-slow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      
      // Box shadows with yellow/gold theme
      boxShadow: {
        'glow-yellow': '0 0 20px rgba(234, 179, 8, 0.3)',
        'glow-yellow-lg': '0 0 30px rgba(234, 179, 8, 0.4)',
        'glow-emerald': '0 0 20px rgba(16, 185, 129, 0.3)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.3)',
      },
    },
  },
  plugins: [],
};
