/**
 * Visual-only sector speed multiplier along lap fraction T (0..1).
 * Straights ≈1, corners <1. Matches backend-style 3-sector templates where defined.
 */

const SECTOR_BANDS = {
  // [startT, endT, kind] kind 's' straight 'c' corner
  chicago: [
    [0, 0.38, "s"], [0.38, 0.72, "c"], [0.72, 1, "s"],
  ],
  monza: [
    [0, 0.48, "s"], [0.48, 0.70, "c"], [0.70, 1, "s"],
  ],
  default: [
    [0, 0.35, "s"], [0.35, 0.68, "c"], [0.68, 1, "s"],
  ],
};

function multForKind(kind) {
  return kind === "c" ? 0.88 : 1.0;
}

export function sectorSpeedVisualMult(trackId, T) {
  const t = ((T % 1) + 1) % 1;
  const bands = SECTOR_BANDS[trackId] || SECTOR_BANDS.default;
  for (const [a, b, k] of bands) {
    const wrap = b < a;
    const inside = wrap ? (t >= a || t < b) : (t >= a && t < b);
    if (inside) return multForKind(k);
  }
  return 1.0;
}
