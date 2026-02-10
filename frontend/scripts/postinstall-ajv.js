/**
 * Fix ajv-keywords for ajv 6: it requires 'ajv/dist/compile/codegen' but ajv 6 uses 'lib/' not 'dist/'.
 * Also ensure top-level ajv is 6.x and remove nested ajv 8.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..', 'node_modules');
const topLevelAjv = path.join(root, 'ajv');
const ajvKeywords = path.join(root, 'ajv-keywords');

function ensureTopLevelAjv6() {
  if (!fs.existsSync(topLevelAjv)) return;
  try {
    const topPkg = JSON.parse(fs.readFileSync(path.join(topLevelAjv, 'package.json'), 'utf8'));
    if (topPkg.version.startsWith('8')) {
      console.log('postinstall-ajv: top-level ajv is 8.x, reinstalling 6.12.6');
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
              console.log('postinstall-ajv: removed nested ajv@' + v);
            }
          } catch (_) {}
        }
        continue;
      }
      findAndRemoveNestedAjv(full, depth + 1);
    }
  } catch (_) {}
}

// ajv 6 has lib/compile/codegen, ajv-keywords requires dist/compile/codegen - patch it
function patchAjvKeywords() {
  if (!fs.existsSync(ajvKeywords)) return;
  const distDir = path.join(ajvKeywords, 'dist');
  if (!fs.existsSync(distDir)) return;
  try {
    function scan(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          scan(full);
          continue;
        }
        if (!e.name.endsWith('.js')) continue;
        let content = fs.readFileSync(full, 'utf8');
        if (!content.includes("ajv/dist/compile/codegen")) continue;
        content = content.replace(/ajv\/dist\/compile\/codegen/g, 'ajv/lib/compile/codegen');
        fs.writeFileSync(full, content);
        console.log('postinstall-ajv: patched', path.relative(distDir, full));
      }
    }
    scan(distDir);
  } catch (e) {
    console.warn('postinstall-ajv: patch', e.message);
  }
}

ensureTopLevelAjv6();
findAndRemoveNestedAjv(root, 0);
patchAjvKeywords();
console.log('postinstall-ajv: done');
