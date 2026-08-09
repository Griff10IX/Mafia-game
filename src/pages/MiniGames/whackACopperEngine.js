/**
 * Whack-A-Copper — game logic (fixed-timestep, seeded waves for server re-sim).
 */

export const STORAGE_KEY = 'whack_a_copper_settings_v2';
export const FIXED_DT = 1000 / 60;
export const COUNTDOWN_MS = 3000;
export const HIT_GRACE_MS = 80;

export const DIFF_PRESETS = {
  easy: {
    id: 'easy',
    label: 'Easy',
    stayMs: 2100,
    stayMinMs: 1300,
    stayDecayPerTier: 35,
    waveMs: 1450,
    waveMinMs: 950,
    waveDecayPerTier: 25,
    maxUp: 2,
    warningPct: 0.32,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    stayMs: 1650,
    stayMinMs: 950,
    stayDecayPerTier: 45,
    waveMs: 1150,
    waveMinMs: 720,
    waveDecayPerTier: 35,
    maxUp: 3,
    warningPct: 0.28,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    stayMs: 1150,
    stayMinMs: 650,
    stayDecayPerTier: 55,
    waveMs: 780,
    waveMinMs: 480,
    waveDecayPerTier: 45,
    maxUp: 4,
    warningPct: 0.24,
  },
};

export const DEFAULT_SETTINGS = {
  diff: 'medium',
  duration: 30,
  gridSize: 9,
  livesMode: 3,
  shakeEnabled: true,
  fxEnabled: true,
  ptsEnabled: true,
  panicEnabled: true,
};

/** Mulberry32 — must match backend/utils/whack_a_copper_sim.py / gauntlet_sim.py */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedToU32(seed) {
  const s = String(seed || '').trim().toLowerCase();
  if (!s) return 1;
  const hex = parseInt(s.slice(0, 8), 16);
  if (Number.isFinite(hex) && hex > 0) return hex >>> 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function gridLayout(gridSize) {
  if (gridSize === 6) return { cols: 3, rows: 2 };
  if (gridSize === 12) return { cols: 3, rows: 4 };
  return { cols: 3, rows: 3 };
}

function emptyHole() {
  return {
    up: false,
    bonked: false,
    warning: false,
    flash: null,
    escaped: false,
    upUntil: 0,
    warningAt: 0,
    bonkedUntil: 0,
    flashUntil: 0,
    escapedUntil: 0,
    hitPulseUntil: 0,
    duckUntil: 0,
  };
}

function fisherYates(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    let j = Math.floor(rng() * (i + 1));
    if (j > i) j = i;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

/** True while copper is up and hittable (grace after upUntil on sim clock). */
export function canWhackHole(engine, index) {
  if (engine.phase !== 'playing') return false;
  const h = engine.holes[index];
  if (!h || h.bonked) return false;
  if (!engine.holesUp[index]) return false;
  const now = engine.clockMs;
  return !!h.upUntil && now <= h.upUntil + HIT_GRACE_MS;
}

export function createEngine(settings, seed = null) {
  const gridSize = settings.gridSize || 9;
  const rng = seed != null ? mulberry32(seedToU32(seed)) : mulberry32(1);
  return {
    phase: 'idle',
    settings: { ...settings },
    gridSize,
    seed: seed || null,
    rng,
    score: 0,
    combo: 1,
    maxCombo: 1,
    missCount: 0,
    lives: settings.livesMode || 3,
    timeLeftMs: (settings.duration || 30) * 1000,
    durationMs: (settings.duration || 30) * 1000,
    holes: Array.from({ length: gridSize }, emptyHole),
    waveCooldownMs: 0,
    countdownMs: 0,
    clockMs: 0,
    playingMs: 0,
    particles: [],
    nextParticleId: 1,
    running: false,
    panic: false,
    holesUp: Array(gridSize).fill(false),
  };
}

function tier(score) {
  return Math.floor(score / 100);
}

function stayMs(engine) {
  const d = DIFF_PRESETS[engine.settings.diff] || DIFF_PRESETS.medium;
  const t = tier(engine.score);
  return Math.max(d.stayMinMs, d.stayMs - t * d.stayDecayPerTier);
}

function waveMs(engine) {
  const d = DIFF_PRESETS[engine.settings.diff] || DIFF_PRESETS.medium;
  const t = tier(engine.score);
  return Math.max(d.waveMinMs, d.waveMs - t * d.waveDecayPerTier);
}

function maxConcurrent(engine) {
  const d = DIFF_PRESETS[engine.settings.diff] || DIFF_PRESETS.medium;
  const t = tier(engine.score);
  return Math.min(d.maxUp, 1 + Math.min(2, Math.floor(t / 2)));
}

export function startEngine(engine, settingsOverride, seed = null) {
  const s = settingsOverride || engine.settings;
  engine.settings = { ...s };
  engine.gridSize = s.gridSize || 9;
  if (seed != null) {
    engine.seed = seed;
    engine.rng = mulberry32(seedToU32(seed));
  } else if (!engine.rng) {
    engine.rng = mulberry32(1);
  }
  engine.phase = 'countdown';
  engine.countdownMs = COUNTDOWN_MS;
  engine.clockMs = 0;
  engine.playingMs = 0;
  engine.score = 0;
  engine.combo = 1;
  engine.maxCombo = 1;
  engine.missCount = 0;
  engine.lives = s.livesMode > 0 ? s.livesMode : 999;
  engine.durationMs = (s.duration || 30) * 1000;
  engine.timeLeftMs = engine.durationMs;
  engine.holes = Array.from({ length: engine.gridSize }, emptyHole);
  engine.holesUp = Array(engine.gridSize).fill(false);
  engine.waveCooldownMs = 600;
  engine.particles = [];
  engine.panic = false;
  engine.running = true;
}

export function stopEngine(engine) {
  engine.running = false;
  engine.phase = 'over';
  engine.holes.forEach((_, i) => {
    engine.holesUp[i] = false;
    engine.holes[i] = emptyHole();
  });
}

function popHole(engine, index) {
  if (!engine.running || engine.holesUp[index]) return;
  const d = DIFF_PRESETS[engine.settings.diff] || DIFF_PRESETS.medium;
  const stay = stayMs(engine);
  const now = engine.clockMs;
  engine.holesUp[index] = true;
  const h = engine.holes[index];
  h.up = true;
  h.bonked = false;
  h.warning = false;
  h.escaped = false;
  h.flash = null;
  h.upUntil = now + stay;
  h.warningAt = now + stay * (1 - d.warningPct);
  h.bonkedUntil = 0;
  h.hitPulseUntil = 0;
  h.duckUntil = 0;
}

export function syncFromEngine(engine) {
  const now = engine.clockMs;
  return {
    phase: engine.phase,
    score: engine.score,
    combo: engine.combo,
    maxCombo: engine.maxCombo,
    missCount: engine.missCount,
    lives: engine.lives,
    timeLeft: Math.ceil(engine.timeLeftMs / 1000),
    panic: engine.panic,
    countdown: Math.ceil(engine.countdownMs / 1000),
    holes: engine.holes.map((h, i) => {
      const bonkActive = h.bonked && (h.bonkedUntil || 0) > now;
      return {
        up: h.up || bonkActive,
        bonked: bonkActive,
        warning: h.warning && h.up,
        flash: h.flash,
        escaped: h.escaped,
        hitBurst: (h.hitPulseUntil || 0) > now,
        ducking: (h.duckUntil || 0) > now && !h.bonked,
        hittable: canWhackHole(engine, i),
      };
    }),
    particles: [...engine.particles],
  };
}

function duckHole(engine, index, missed) {
  if (!engine.holesUp[index]) return;
  const now = engine.clockMs;
  engine.holesUp[index] = false;
  const h = engine.holes[index];
  h.up = false;
  h.warning = false;
  h.upUntil = 0;
  if (missed) {
    h.flash = 'miss';
    h.flashUntil = now + 500;
    h.duckUntil = now + 320;
    h.escaped = true;
    h.escapedUntil = now + 950;
    engine.missCount += 1;
    engine.combo = 1;
    if (engine.settings.livesMode > 0) {
      engine.lives = Math.max(0, engine.lives - 1);
      if (engine.lives <= 0) stopEngine(engine);
    }
    return { missed: true, index };
  }
  return null;
}

function scheduleWave(engine) {
  const size = engine.gridSize;
  const upCount = engine.holesUp.filter(Boolean).length;
  const maxUp = maxConcurrent(engine);
  const slots = maxUp - upCount;
  if (slots <= 0) return;

  const avail = [];
  for (let i = 0; i < size; i++) {
    if (!engine.holesUp[i]) avail.push(i);
  }
  if (!avail.length) return;

  const rng = engine.rng || (() => Math.random());
  fisherYates(avail, rng);
  const count = Math.min(
    slots,
    avail.length,
    Math.max(1, Math.floor(rng() * 2) + (tier(engine.score) > 2 ? 1 : 0))
  );
  for (let n = 0; n < count; n++) {
    popHole(engine, avail[n]);
  }
  engine.waveCooldownMs = waveMs(engine);
}

export function whack(engine, index) {
  if (!canWhackHole(engine, index)) return null;

  const now = engine.clockMs;
  engine.holesUp[index] = false;
  const h = engine.holes[index];
  h.up = false;
  h.warning = false;
  h.warningAt = 0;
  h.upUntil = 0;
  h.escaped = false;
  h.escapedUntil = 0;
  h.bonked = true;
  h.bonkedUntil = now + 420;
  h.flash = 'hit';
  h.flashUntil = now + 450;
  h.hitPulseUntil = now + 380;
  h.duckUntil = 0;

  const pts = 10 * engine.combo;
  engine.score += pts;
  const nextCombo = Math.min(engine.combo + 1, 12);
  engine.maxCombo = Math.max(engine.maxCombo, nextCombo);
  engine.combo = nextCombo;

  const id = engine.nextParticleId++;
  engine.particles.push({
    id,
    holeIndex: index,
    kind: 'hit',
    pts: engine.settings.ptsEnabled ? pts : null,
    combo: engine.combo,
    until: now + 850,
  });

  return {
    pts,
    combo: engine.combo,
    bigHit: engine.combo >= 5,
    index,
    t_ms: Math.floor(engine.playingMs),
  };
}

/** Advance one fixed physics step. */
export function tick(engine, dtMs = FIXED_DT) {
  if (!engine.running) return { ended: engine.phase === 'over' };

  engine.clockMs += dtMs;

  if (engine.phase === 'countdown') {
    engine.countdownMs -= dtMs;
    if (engine.countdownMs <= 0) {
      engine.phase = 'playing';
      engine.waveCooldownMs = 400;
    }
    return { ended: false };
  }

  if (engine.phase !== 'playing') return { ended: engine.phase === 'over' };

  engine.playingMs += dtMs;
  engine.timeLeftMs -= dtMs;
  if (engine.settings.panicEnabled && engine.timeLeftMs <= 10000) {
    engine.panic = true;
  }
  if (engine.timeLeftMs <= 0) {
    stopEngine(engine);
    return { ended: true };
  }

  engine.waveCooldownMs -= dtMs;
  if (engine.waveCooldownMs <= 0) {
    scheduleWave(engine);
  }

  const now = engine.clockMs;
  let missEvent = null;
  for (let i = 0; i < engine.gridSize; i++) {
    const h = engine.holes[i];
    if (h.up && h.warningAt && now >= h.warningAt && !h.warning) {
      h.warning = true;
    }
    if (h.up && h.upUntil && now >= h.upUntil) {
      missEvent = duckHole(engine, i, true) || missEvent;
    }
    if (h.bonkedUntil && now >= h.bonkedUntil) h.bonked = false;
    if (h.flashUntil && now >= h.flashUntil) h.flash = null;
    if (h.escapedUntil && now >= h.escapedUntil) h.escaped = false;
  }

  engine.particles = engine.particles.filter((p) => p.until > now);

  return { ended: engine.phase === 'over', miss: missEvent };
}

export const GRADE_MAP = {
  S: { min: 500, color: '#d4a820', label: 'Outstanding, boss.' },
  A: { min: 350, color: '#22aa55', label: 'Sharp work.' },
  B: { min: 200, color: '#4488ee', label: 'Not bad, not bad.' },
  C: { min: 100, color: '#cc8800', label: 'Could do better.' },
  D: { min: 0, color: '#cc3333', label: 'They nearly got away.' },
};

export function getGrade(score) {
  for (const [g, v] of Object.entries(GRADE_MAP)) {
    if (score >= v.min) return { grade: g, ...v };
  }
  return { grade: 'D', ...GRADE_MAP.D };
}
