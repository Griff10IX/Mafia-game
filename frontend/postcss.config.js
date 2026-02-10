const path = require('path');

module.exports = {
  plugins: {
    // Always load Tailwind from frontend/tailwind.config.js so it works from any cwd (local or Emergent)
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
