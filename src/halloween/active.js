let accountOn = false;
let previewOn = false;
const listeners = new Set();

function syncAttr() {
  if (typeof document === 'undefined') return;
  if (accountOn || previewOn) document.documentElement.setAttribute('data-halloween', 'on');
  else document.documentElement.removeAttribute('data-halloween');
}

function emit() {
  listeners.forEach((fn) => {
    try { fn(); } catch (_) {}
  });
}

export function setHalloweenAccount(on) {
  accountOn = !!on;
  syncAttr();
  emit();
}

export function setHalloweenPreview(on) {
  previewOn = !!on;
  syncAttr();
  emit();
}

export function isHalloweenActive() {
  return accountOn || previewOn;
}

export function subscribeHalloween(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
