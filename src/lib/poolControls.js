/**
 * 8-ball pool shot controls — aim, power curve, sensitivity presets (mobile + desktop).
 */

export const POOL_CONTROL_STORAGE_KEY = 'pool_8ball_control_preset';
export const POOL_DRAG_PULL_STORAGE_KEY = 'pool_8ball_drag_pull';
/** Logical canvas width used for pull thresholds (matches EightBallPool canvas). */
export const POOL_LOGICAL_W = 900;

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
    pullExitPx: 6,
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
    pullExitPx: 5,
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
    pullExitPx: 4,
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

export function loadDragPullEnabled() {
  try {
    const v = localStorage.getItem(POOL_DRAG_PULL_STORAGE_KEY);
    if (v === null || v === undefined) return false; // mobile-friendly default: aim-only on table
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

export function saveDragPullEnabled(on) {
  try {
    localStorage.setItem(POOL_DRAG_PULL_STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function getPreset(id) {
  return CONTROL_PRESETS[id] || CONTROL_PRESETS.gentle;
}

/**
 * Scale pull thresholds from logical canvas px into current CSS display px.
 * @param {object} preset
 * @param {number} cssWidth - canvas getBoundingClientRect().width
 */
export function scalePresetForDisplay(preset, cssWidth) {
  const p = preset || CONTROL_PRESETS.gentle;
  const scale = Math.max(0.35, Math.min(2.5, (Number(cssWidth) || POOL_LOGICAL_W) / POOL_LOGICAL_W));
  return {
    ...p,
    maxPullPx: p.maxPullPx * scale,
    pullEnterPx: Math.max(18, p.pullEnterPx * scale * 1.35),
    pullExitPx: Math.max(8, (p.pullExitPx || p.pullEnterPx * 0.45) * scale),
  };
}

/** Aim angle (degrees) from cue ball toward pointer on table. */
export function aimAngleFromPointer(cueCanvasX, cueCanvasY, pointerX, pointerY) {
  const dx = pointerX - cueCanvasX;
  const dy = pointerY - cueCanvasY;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return null;
  return Number(((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2));
}

function pullBehindDist(cueCanvasX, cueCanvasY, pointerX, pointerY, angleDeg) {
  const a = (Number(angleDeg) * Math.PI) / 180;
  return -((pointerX - cueCanvasX) * Math.cos(a) + (pointerY - cueCanvasY) * Math.sin(a));
}

/**
 * Power 0–1 from pull-back distance along shot line (Temple Run / 8BP style).
 * Pointer behind cue along aim direction = higher power.
 */
export function powerFromPullBack(cueCanvasX, cueCanvasY, pointerX, pointerY, angleDeg, preset) {
  const p = preset || CONTROL_PRESETS.gentle;
  const pullDist = pullBehindDist(cueCanvasX, cueCanvasY, pointerX, pointerY, angleDeg);
  if (pullDist <= 0) return p.minPower;
  const normalized = Math.max(0, Math.min(1, pullDist / p.maxPullPx));
  const curved = Math.pow(normalized, p.pullExponent);
  return Number(Math.max(p.minPower, Math.min(1, curved)).toFixed(3));
}

/** Whether pointer is far enough behind cue to enter pull mode. */
export function shouldEnterPullMode(cueCanvasX, cueCanvasY, pointerX, pointerY, angleDeg, preset) {
  const p = preset || CONTROL_PRESETS.gentle;
  return pullBehindDist(cueCanvasX, cueCanvasY, pointerX, pointerY, angleDeg) > p.pullEnterPx;
}

/** Hysteresis: leave pull only when forward of a smaller exit threshold. */
export function shouldExitPullMode(cueCanvasX, cueCanvasY, pointerX, pointerY, angleDeg, preset) {
  const p = preset || CONTROL_PRESETS.gentle;
  const exitPx = p.pullExitPx != null ? p.pullExitPx : p.pullEnterPx * 0.45;
  return pullBehindDist(cueCanvasX, cueCanvasY, pointerX, pointerY, angleDeg) < exitPx;
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
