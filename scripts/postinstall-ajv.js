/**
 * Fix build: ajv-keywords requires 'ajv/dist/compile/codegen'. ajv 6 uses lib/, not dist/.
 * Ensure root has ajv 6, remove nested ajv 8, add dist/ shim to every ajv that has lib/compile/codegen.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..', 'node_modules');
const topLevelAjv = path.join(root, 'ajv');

function ensureTopLevelAjv6() {
  let needInstall = false;
  if (!fs.existsSync(topLevelAjv)) {
    needInstall = true;
  } else {
    try {
      const topPkg = JSON.parse(fs.readFileSync(path.join(topLevelAjv, 'package.json'), 'utf8'));
      if (topPkg.version.startsWith('8')) {
        fs.rmSync(topLevelAjv, { recursive: true, force: true });
        needInstall = true;
      }
    } catch (_) {}
  }
  if (needInstall) {
    console.log('postinstall-ajv: installing ajv@6.12.6 at root');
    execSync('npm install ajv@6.12.6 --no-save --legacy-peer-deps', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
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

function hasLibCodegen(ajvDir) {
  const asFile = path.join(ajvDir, 'lib', 'compile', 'codegen.js');
  const asDir = path.join(ajvDir, 'lib', 'compile', 'codegen', 'index.js');
  return fs.existsSync(asFile) || fs.existsSync(asDir);
}

function addDistShim(ajvDir) {
  if (!hasLibCodegen(ajvDir)) return;
  const distCompile = path.join(ajvDir, 'dist', 'compile');
  fs.mkdirSync(distCompile, { recursive: true });
  const shimPath = path.join(distCompile, 'codegen.js');
  fs.writeFileSync(shimPath, "module.exports = require('../../lib/compile/codegen');\n");
}

function addShimToAllAjv6(dir, depth) {
  if (depth > 15) return;
  try {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name === 'ajv') {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(full, 'package.json'), 'utf8'));
          if (pkg.version.startsWith('6') && hasLibCodegen(full)) {
            const shimPath = path.join(full, 'dist', 'compile', 'codegen.js');
            if (!fs.existsSync(shimPath)) {
              addDistShim(full);
              console.log('postinstall-ajv: added dist/compile/codegen.js shim');
            }
          }
        } catch (_) {}
        continue;
      }
      addShimToAllAjv6(full, depth + 1);
    }
  } catch (_) {}
}

ensureTopLevelAjv6();
findAndRemoveNestedAjv(root, 0);
addShimToAllAjv6(root, 0);
console.log('postinstall-ajv: done');
