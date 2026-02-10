/**
 * Remove nested ajv 8.x and ensure top-level ajv is 6.12.6 (fixes ajv-keywords require('ajv/dist/compile/codegen')).
 * Run after npm install on Vercel.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..', 'node_modules');
const topLevelAjv = path.join(root, 'ajv');

function ensureTopLevelAjv6() {
  if (!fs.existsSync(topLevelAjv)) return;
  try {
    const topPkg = JSON.parse(fs.readFileSync(path.join(topLevelAjv, 'package.json'), 'utf8'));
    if (topPkg.version.startsWith('8')) {
      console.log('postinstall-ajv: top-level ajv is 8.x, removing so override can apply');
      fs.rmSync(topLevelAjv, { recursive: true, force: true });
      execSync('npm install ajv@6.12.6 --no-save --legacy-peer-deps', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
    }
  } catch (e) {
    console.warn('postinstall-ajv:', e.message);
  }
}

function findAndRemoveNestedAjv(dir, depth) {
  if (depth > 15) return;
  try {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name === 'ajv') {
        const pkgPath = path.join(full, 'package.json');
        if (fs.existsSync(pkgPath)) {
          try {
            const v = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
            if (v.startsWith('8')) {
              fs.rmSync(full, { recursive: true, force: true });
              console.log('postinstall-ajv: removed nested ajv@' + v + ' at', full);
            }
          } catch (_) {}
        }
        continue;
      }
      if (e.name.startsWith('@')) {
        findAndRemoveNestedAjv(full, depth + 1);
      } else {
        findAndRemoveNestedAjv(full, depth + 1);
      }
    }
  } catch (err) {
    // ignore
  }
}

ensureTopLevelAjv6();
findAndRemoveNestedAjv(root, 0);
console.log('postinstall-ajv: done');
