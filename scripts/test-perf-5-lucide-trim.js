#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const layout = fs.readFileSync(path.join(root, 'src/components/Layout.js'), 'utf8');
const icons = fs.readFileSync(path.join(root, 'src/components/layoutLucideIcons.js'), 'utf8');
const fails = [];
if (/from ['"]lucide-react['"]/.test(layout)) fails.push('Layout still imports from lucide-react barrel');
if (!/from ['"]\.\/layoutLucideIcons['"]/.test(layout)) fails.push('Layout missing layoutLucideIcons import');
if (!icons.includes("lucide-react/dist/esm/icons/")) fails.push('layoutLucideIcons not using per-file paths');
if (icons.includes('as Bell') || icons.includes('as Flame') || icons.includes('as Settings')) {
  fails.push('unused Bell/Flame/Settings still exported');
}
const exportCount = (icons.match(/export \{ default as /g) || []).length;
if (exportCount < 60) fails.push(`too few icon exports: ${exportCount}`);
// every named import in Layout must be exported
const m = layout.match(/import \{([^}]+)\} from '\.\/layoutLucideIcons'/);
if (!m) fails.push('cannot parse Layout icon import');
else {
  const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    if (!icons.includes(`export { default as ${n} }`)) fails.push(`Layout imports ${n} but icons module lacks it`);
  }
}
if (fails.length) {
  console.error('FAIL:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log(`PASS: PERF #5 lucide trim (${exportCount} per-file icons)`);
