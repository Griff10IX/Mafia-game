const fs = require('fs');
const path = require('path');

const rawPath = path.join(
  process.env.USERPROFILE || '',
  '.cursor/projects/c-Users-jakeg-Desktop-Game-files-mafia/agent-tools/ddc61738-5923-4e19-8cd4-1ec3312d9047.txt'
);
const raw = fs.readFileSync(rawPath, 'utf8');
const words = raw
  .split(/\r?\n/)
  .map((w) => w.trim().toLowerCase())
  .filter((w) => w && w !== 'words');
const extra = ['n1gger', 'n1gga', 'n1gg3r', 'nigg3r', 'nigg4', 'g00k', 'ch1nk', 'k1ke', 'r-tard'];
const all = [...new Set([...words, ...extra])].sort();

console.log('Total count:', all.length);

function jsEsc(w) {
  return "'" + w.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}
function pyEsc(w) {
  return '"' + w.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const jsLines = all.map((w) => '  ' + jsEsc(w)).join(',\n');
const pyLines = all.map((w) => '    ' + pyEsc(w)).join(',\n');

const jsListDecl = 'const PROFANITY_LIST = [\n' + jsLines + '\n];';
const pySetDecl = '_PROFANITY = frozenset({\n' + pyLines + '\n})';

fs.writeFileSync('profanity_js.txt', jsListDecl);
fs.writeFileSync('profanity_py.txt', pySetDecl);

// Patch src/utils/profanityFilter.js
const filterPath = path.join(__dirname, 'src', 'utils', 'profanityFilter.js');
let filterJs = fs.readFileSync(filterPath, 'utf8');
const insertMarker = '\n/**\n * Censor a single word';
if (filterJs.includes(insertMarker) && !filterJs.includes("'abbo'")) {
  filterJs = filterJs.replace(/(\*\/)\s*\n(\s*\n)(\/\*\*\n \* Censor a single word)/, '$1\n\n' + jsListDecl + '\n$3');
  fs.writeFileSync(filterPath, filterJs);
  console.log('Patched src/utils/profanityFilter.js');
}

// Patch backend/utils/profanity.py
const pyPath = path.join(__dirname, 'backend', 'utils', 'profanity.py');
let pySrc = fs.readFileSync(pyPath, 'utf8');
const pyReplace = pySetDecl + '\n\n';
const pyPattern = /_PROFANITY = frozenset\(\{[\s\S]*?\}\)\n\n/;
if (pyPattern.test(pySrc)) {
  pySrc = fs.readFileSync(pyPath, 'utf8');
  pySrc = pySrc.replace(pyPattern, pyReplace);
  fs.writeFileSync(pyPath, pySrc);
  console.log('Patched backend/utils/profanity.py');
} else {
  const idx = pySrc.indexOf('_PROFANITY = frozenset');
  const endIdx = pySrc.indexOf('def contains_profanity');
  if (idx !== -1 && endIdx !== -1) {
    pySrc = pySrc.slice(0, idx) + pyReplace + pySrc.slice(endIdx);
    fs.writeFileSync(pyPath, pySrc);
    console.log('Patched backend/utils/profanity.py');
  }
}

console.log('Wrote profanity_js.txt and profanity_py.txt');
