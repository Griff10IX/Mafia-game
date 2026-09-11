#!/usr/bin/env node
/** Local smoke test for PERF #3 theme lazy load (no React). */
(async () => {
  // Use dynamic import of the source via a tiny transform isn't available;
  // instead verify file contracts.
  const fs = require('fs');
  const path = require('path');
  const themesPath = path.join(__dirname, '..', 'src', 'constants', 'themes.js');
  const t = fs.readFileSync(themesPath, 'utf8');
  const fails = [];
  if (/from\s+['"]\.\/themes-expanded/.test(t)) fails.push('static import of themes-expanded still present');
  if (!t.includes('ensureExpandedThemesLoaded')) fails.push('ensureExpandedThemesLoaded missing');
  if (!t.includes('storedThemeNeedsExpandedCatalog')) fails.push('storedThemeNeedsExpandedCatalog missing');
  if (t.includes('...EXPANDED_QUICK_PRESETS') || t.includes('...EXPANDED_FULL_PRESETS')) {
    fails.push('static expanded preset spreads still present');
  }
  if (t.includes('...EXPANDED_THEME_COLOURS')) fails.push('static EXPANDED_THEME_COLOURS spread still present');
  const layout = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'Layout.js'), 'utf8');
  if (!/lazy\(\(\)\s*=>\s*import\('\.\/ThemePicker'\)\)/.test(layout)) fails.push('Layout ThemePicker not lazy');
  if (/import ThemePicker from '\.\/ThemePicker'/.test(layout)) fails.push('Layout still static-imports ThemePicker');
  const picker = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ThemePicker.js'), 'utf8');
  if (!picker.includes('ensureExpandedThemesLoaded')) fails.push('ThemePicker missing ensureExpandedThemesLoaded');
  const ctx = fs.readFileSync(path.join(__dirname, '..', 'src', 'context', 'ThemeContext.js'), 'utf8');
  if (!ctx.includes('restoreThemeBootSnapshot')) fails.push('ThemeContext missing boot snapshot restore');
  if (!ctx.includes('ensureExpandedThemesLoaded')) fails.push('ThemeContext missing ensureExpandedThemesLoaded');
  if (fails.length) {
    console.error('FAIL:\n- ' + fails.join('\n- '));
    process.exit(1);
  }
  console.log('PASS: PERF #3 file contracts ok');
})();
