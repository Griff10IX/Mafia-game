import { isHalloweenActive } from './active';
import { HW_SHEET_VARS, HW_SPRITES } from './Decor';
import { halloweenRoll, prefersReducedMotion } from './roll';
import './halloween.css';

function fire(name, detail) {
  if (typeof window === 'undefined') return false;
  if (prefersReducedMotion()) return false;
  window.dispatchEvent(new CustomEvent(name, { detail }));
  return true;
}

export function requestHalloweenScare(kind) {
  return fire('halloween-scare', { kind: kind || null });
}

export function requestHalloweenRunner(dir) {
  return fire('halloween-runner', { dir: dir || null });
}

export function requestHalloweenLurk(killer, side) {
  return fire('halloween-lurk', { killer: killer || null, side: side || null });
}

export function requestHalloweenStalk(killer, dir) {
  return fire('halloween-stalk', { killer: killer || null, dir: dir || null });
}

export function requestHalloweenKill(killer) {
  return fire('halloween-kill', { killer: killer || null });
}

export function maybeHalloweenScare() {
  if (!isHalloweenActive()) return false;
  if (prefersReducedMotion()) return false;
  if (!halloweenRoll()) return false;
  return requestHalloweenScare(null);
}

export function showButtonWeb(el) {
  if (!el || typeof document === 'undefined') return;
  if (prefersReducedMotion()) return;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const node = document.createElement('div');
  node.className = 'hw-btn-web';
  node.setAttribute('aria-hidden', 'true');
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
  node.style.setProperty('--hw-w', `${Math.round(rect.width)}px`);
  Object.entries(HW_SHEET_VARS).forEach(([k, v]) => node.style.setProperty(k, v));
  const web = document.createElement('img');
  web.src = HW_SPRITES.web;
  web.alt = '';
  web.draggable = false;
  const spider = document.createElement('i');
  node.appendChild(web);
  node.appendChild(spider);
  document.body.appendChild(node);
  window.setTimeout(() => {
    try { node.remove(); } catch (_) {}
  }, 1650);
}
