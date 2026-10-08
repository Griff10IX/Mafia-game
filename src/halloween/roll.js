export const HALLOWEEN_ODDS = 1 / 20;

export function halloweenRoll() {
  return Math.random() < HALLOWEEN_ODDS;
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
