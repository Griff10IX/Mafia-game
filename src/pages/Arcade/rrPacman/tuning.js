// Arcade Pac-Man timing tables (1980 Namco) mapped onto Road Runner.
export const TICK_HZ = 60;
export const TILE = 8;
// 100% speed in the arcade = 75.75757625 px/s on 8px tiles.
export const FULL_SPEED_PX_PER_TICK = 75.75757625 / TICK_HZ;

const SPEED_ROWS = [
  // [maxLevel, player, playerFright, enemy, enemyFright, enemyTunnel]
  // Levels 1–2 are eased so a new run can clear the first maze. Later rows climb back to arcade speed.
  [1, 0.9, 1.0, 0.55, 0.35, 0.3],
  [2, 0.9, 0.95, 0.65, 0.4, 0.35],
  [4, 0.9, 0.95, 0.75, 0.5, 0.4],
  [8, 0.95, 0.95, 0.85, 0.55, 0.45],
  [20, 1.0, 1.0, 0.95, 0.6, 0.5],
  [Infinity, 0.9, 0.9, 0.95, 0.6, 0.5],
];

export function speedsFor(level) {
  const row = SPEED_ROWS.find((r) => level <= r[0]);
  return { player: row[1], playerFright: row[2], enemy: row[3], enemyFright: row[4], enemyTunnel: row[5] };
}

const ELROY_ROWS = [
  // [maxLevel, dotsLeft1, dotsLeft2]
  [1, 10, 5], [2, 18, 8], [5, 30, 15], [8, 40, 20], [11, 60, 30], [14, 80, 40], [18, 100, 50], [Infinity, 120, 60],
];

export function elroyFor(level) {
  const row = ELROY_ROWS.find((r) => level <= r[0]);
  const base = speedsFor(level).enemy;
  return { dots1: row[1], dots2: row[2], speed1: base + 0.05, speed2: base + 0.1 };
}

const FRIGHT_SECONDS = [10, 8, 7, 5, 4, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0, 1];
const FRIGHT_FLASHES = [5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 5, 3, 3, 5, 3, 3, 0, 3];

export function frightFor(level) {
  const i = level - 1;
  return { seconds: FRIGHT_SECONDS[i] ?? 0, flashes: FRIGHT_FLASHES[i] ?? 0 };
}

// Scatter/chase waves in seconds (last chase is indefinite).
export function wavesFor(level) {
  if (level === 1) return [10, 12, 8, 14, 7, 14, 6, Infinity];
  if (level === 2) return [8, 16, 7, 18, 5, 20, 5, Infinity];
  if (level <= 4) return [7, 20, 7, 20, 5, 1033, 1 / 60, Infinity];
  return [5, 20, 5, 20, 5, 1037, 1 / 60, Infinity];
}

// Pen release dot limits per enemy index [coyote, cop, mobster, rocket].
export function penDotLimits(level) {
  if (level === 1) return [0, 25, 55, 90];
  if (level === 2) return [0, 8, 30, 55];
  if (level <= 4) return [0, 0, 15, 40];
  return [0, 0, 0, 0];
}

export const PEN_IDLE_SECONDS = (level) => (level === 1 ? 8 : level <= 4 ? 5 : 3);
export const GLOBAL_DOT_LIMITS = [0, 7, 17, 32];

export const SCORE = { seed: 10, bag: 50, enemies: [200, 400, 800, 1600] };
export const EXTRA_LIFE_AT = 10000;
export const START_LIVES = 4;
export const BONUS_AT_SEEDS = [70, 170];
export const BONUS_SECONDS = 9.5;

const BONUS_ITEMS = [
  [1, 'acme_crate', 100], [2, 'anvil', 300], [4, 'money_bag', 500], [6, 'dynamite', 700],
  [8, 'gold_bar', 1000], [10, 'diamond', 2000], [12, 'fedora', 3000], [14, 'tommy_gun', 5000],
  [16, 'cash_stack', 7000], [Infinity, 'trophy', 10000],
];

export function bonusFor(level) {
  const row = BONUS_ITEMS.find((r) => level <= r[0]);
  return { item: row[1], points: row[2] };
}

export const WORLDS = [
  { id: 'desert', name: 'Desert', powerup: null },
  { id: 'city', name: 'City', powerup: 'freeze' },
  { id: 'casino', name: 'Casino', powerup: 'magnet' },
  { id: 'docks', name: 'Docks', powerup: 'shield' },
  { id: 'prison', name: 'Prison', powerup: 'double' },
  { id: 'mansion', name: 'Mansion', powerup: 'extra_life' },
  { id: 'acme', name: 'ACME', powerup: null },
];
export const LEVELS_PER_WORLD = 5;
export const CAMPAIGN_LEVELS = WORLDS.length * LEVELS_PER_WORLD;

export function worldIndexForCampaign(level) {
  return Math.min(WORLDS.length - 1, Math.floor((level - 1) / LEVELS_PER_WORLD));
}

export function worldIndexForEndless(level) {
  return Math.floor((level - 1) / 3) % WORLDS.length;
}

export const isBossLevel = (level) => level % 5 === 0;

// Power-ups: speed always available, others unlock with the world that introduces them.
export function powerupPool(worldIndex) {
  const pool = ['speed'];
  WORLDS.slice(0, worldIndex + 1).forEach((w) => { if (w.powerup) pool.push(w.powerup); });
  return pool;
}

export const POWERUP = {
  spawnAtSeedFraction: 0.4,
  lifetimeSeconds: 8,
  speed: { seconds: 8, mult: 1.5 },
  freeze: { seconds: 5 },
  magnet: { seconds: 10, radius: 3 },
  shield: { graceSeconds: 1.5 },
  double: { seconds: 15 },
};

export const BOSS = {
  hp: 3,
  speed: 0.7,
  attackEverySeconds: 4,
  missileWarnSeconds: 1.2,
  missileBlastTiles: 1.2,
  stompRangeTiles: 3,
  stompSeconds: 0.6,
  stunSeconds: 1.5,
  powerSeconds: 6,
  bagRespawnSeconds: 8,
  pointsPerWorld: 5000,
};
