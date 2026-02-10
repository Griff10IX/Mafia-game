const path = require('path');

module.exports = {
  plugins: [
    require('tailwindcss')({ config: path.join(__dirname, 'tailwind.config.js') }),
    // Only Tailwind here; autoprefixer runs via CRA's postcss-preset-env when not using file mode
  ],
};
