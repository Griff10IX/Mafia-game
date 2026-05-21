/**
 * 8-ball pool shot controls — aim, power curve, sensitivity presets (mobile + desktop).
 */

export const POOL_CONTROL_STORAGE_KEY = 'pool_8ball_control_preset';

export const CONTROL_PRESETS = {
  gentle: {
    id: 'gentle',
    label: 'Gentle',
    desc: 'Slower pull, finer low power — best on phone',
    maxPullPx: 150,
    pullExponent: 1.15,
    defaultPower: 0.32,
    minPower: 0.04,
    fineAimDeg: 0.2,
    coarseAimDeg: 1,
    pullEnterPx: 14,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    desc: 'Balanced aim and power',
    maxPullPx: 130,
    pullExponent: 0.92,
    defaultPower: 0.42,
    minPower: 0.05,
    fineAimDeg: 0.25,
    coarseAimDeg: 1,
    pullEnterPx: 12,
  },
  firm: {
    id: 'firm',
    label: 'Firm',
    desc: 'Shorter pull for full power — fast play',
    maxPullPx: 100,
    pullExponent: 0.78,
    defaultPower: 0.5,
    minPower: 0.06,
    fineAimDeg: 0.35,
    coarseAimDeg: 1.5,
    pullEnterPx: 10,
  },
};

export function loadControlPresetId() {
  try {
    const v = localStorage.getItem(POOL_CONTROL_STORAGE_KEY);
    return CONTROL_PRESETS[v] ? v : 'gentle';
  } catch {
    return 'gentle';
  }
}

export function saveControlPresetId(id) {
  try {
    localStorage.setItem(POOL_CONTROL_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function getPreset(id) {
  return CONTROL_PRESETS[id] || CONTROL_PRESETS.gentle;
}

/** Aim angle (degrees) from cue ball toward pointer on table. */
export function aimAngleFromPointer(cueCanvasX, cueCanvasY, pointerX, pointerY) {
  const dx = pointerX - cueCanvasX;
  const dy = pointerY - cueCanvasY;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return null;
  return Number(((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2));
}

/**
 * Power 0–1 from pull-back distance along shot line (Temple Run / 8BP style).
 * Pointer behind cue along aim direction = higher power.
 */
export function powerFromPullBack(cueCanvasX, cueCanvasY, pointerX, pointerY, angleDeg, preset) {
  const p = preset || CONTROL_PRESETS.gentle;
  const a = (Number(angleDeg) * Math.PI) / 180;
  const behindX = pointerX - cueCanvasX;
  const behindY = pointerY - cueCanvasY;
  const pullDist = -(behindX * Math.cos(a) + behindY * Math.sin(a));
  if (pullDist <= 0) return p.minPower;
  const normalized = Math.max(0, Math.min(1, pullDist / p.maxPullPx));
  const curved = Math.pow(normalized, p.pullExponent);
  return Number(Math.max(p.minPower, Math.min(1, curved)).toFixed(3));
}

/** Whether pointer is far enough behind cue to enter pull mode. */
export function shouldEnterPullMode(cueCanvasX, cueCanvasY, pointerX, pointerY, angleDeg, preset) {
  const p = preset || CONTROL_PRESETS.gentle;
  const a = (Number(angleDeg) * Math.PI) / 180;
  const behind = -((pointerX - cueCanvasX) * Math.cos(a) + (pointerY - cueCanvasY) * Math.sin(a));
  return behind > p.pullEnterPx;
}

export function clampPower(v, preset) {
  const p = preset || CONTROL_PRESETS.gentle;
  return Math.max(p.minPower, Math.min(1, Number(v) || p.defaultPower));
}

export function nudgeAngleDeg(current, delta) {
  let next = Number(current || 0) + delta;
  while (next > 180) next -= 360;
  while (next <= -180) next += 360;
  return Number(next.toFixed(2));
}

/** Power from vertical rail: 0 = bottom (min), 1 = top (max). */
export function powerFromRailPosition(ratio, preset) {
  const p = preset || CONTROL_PRESETS.gentle;
  const r = Math.max(0, Math.min(1, Number(ratio)));
  const curved = Math.pow(r, p.pullExponent);
  return clampPower(curved, p);
}
