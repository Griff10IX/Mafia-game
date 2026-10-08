import { isHalloweenActive } from './active';
import { halloweenRoll, prefersReducedMotion } from './roll';
import './halloween.css';

export function requestHalloweenScare(kind) {
  if (typeof window === 'undefined') return false;
  if (prefersReducedMotion()) return false;
  window.dispatchEvent(new CustomEvent('halloween-scare', { detail: { kind: kind || null } }));
  return true;
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
  node.innerHTML = buttonWebSvg();
  document.body.appendChild(node);
  window.setTimeout(() => {
    try { node.remove(); } catch (_) {}
  }, 1300);
}

export function buttonWebSvg() {
  const spokes = [];
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    spokes.push(`M50 50 L${(50 + Math.cos(a) * 80).toFixed(1)} ${(50 + Math.sin(a) * 80).toFixed(1)}`);
  }
  const rings = [10, 20, 30, 42].map((r) => `<ellipse cx="50" cy="50" rx="${r}" ry="${r * 0.7}" />`).join('');
  return (
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
    `<g fill="none" stroke="#f6ecd4" stroke-width="0.9" opacity="0.9">` +
    `<path d="${spokes.join(' ')}" />${rings}` +
    `</g>` +
    `<g transform="translate(50 50)"><ellipse cx="0" cy="-3" rx="3.5" ry="3" fill="#0a070c" /><ellipse cx="0" cy="3" rx="5" ry="4.5" fill="#120c14" />` +
    `<path d="M-3 -2 L-10 -8 M-4 1 L-12 1 M-3 4 L-9 10 M3 -2 L10 -8 M4 1 L12 1 M3 4 L9 10" stroke="#0a070c" stroke-width="1.4" stroke-linecap="round" fill="none" />` +
    `<circle cx="-1.3" cy="-4" r="0.8" fill="#ff9a2a" /><circle cx="1.3" cy="-4" r="0.8" fill="#ff9a2a" /></g>` +
    `</svg>`
  );
}
