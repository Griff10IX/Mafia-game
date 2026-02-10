/**
 * Fix build: ajv-keywords requires 'ajv/dist/compile/codegen'. ajv 6 uses lib/, not dist/.
 * Ensure top-level ajv is 6, remove nested ajv 8, then add dist/ shim so require('ajv/dist/compile/codegen') works.
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

// ajv 6 has lib/compile/codegen; ajv-keywords requires dist/compile/codegen. Add shim so dist path exists.
function addDistShimToAjv6() {
  if (!fs.existsSync(topLevelAjv)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(topLevelAjv, 'package.json'), 'utf8'));
    if (!pkg.version.startsWith('6')) return;
    const libCodegen = path.join(topLevelAjv, 'lib', 'compile', 'codegen.js');
    if (!fs.existsSync(libCodegen)) return;
    const distCompile = path.join(topLevelAjv, 'dist', 'compile');
    fs.mkdirSync(distCompile, { recursive: true });
    const shimPath = path.join(distCompile, 'codegen.js');
    fs.writeFileSync(shimPath, "module.exports = require('../../lib/compile/codegen');\n");
    console.log('postinstall-ajv: added dist/compile/codegen.js shim for ajv 6');
  } catch (e) {
    console.warn('postinstall-ajv: shim', e.message);
  }
}

ensureTopLevelAjv6();
findAndRemoveNestedAjv(root, 0);
addDistShimToAjv6();
console.log('postinstall-ajv: done');
