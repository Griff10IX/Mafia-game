import {
  TICK_HZ, TILE, FULL_SPEED_PX_PER_TICK, speedsFor, elroyFor, frightFor, wavesFor, penDotLimits,
  PEN_IDLE_SECONDS, GLOBAL_DOT_LIMITS, SCORE, EXTRA_LIFE_AT, START_LIVES, BONUS_AT_SEEDS, BONUS_SECONDS,
  bonusFor, WORLDS, worldIndexForCampaign, worldIndexForEndless, isBossLevel, powerupPool, POWERUP, BOSS,
} from './tuning';
import { MAZES, COLS, ROWS, LANDMARKS } from './mazes';

export const DIRS = {
  up: { x: 0, y: -1, name: 'up' },
  left: { x: -1, y: 0, name: 'left' },
  down: { x: 0, y: 1, name: 'down' },
  right: { x: 1, y: 0, name: 'right' },
};
const NONE = { x: 0, y: 0, name: 'none' };
const TIE_ORDER = [DIRS.up, DIRS.left, DIRS.down, DIRS.right];
const OPPOSITE = { up: DIRS.down, down: DIRS.up, left: DIRS.right, right: DIRS.left, none: NONE };
export const ENEMY_IDS = ['coyote', 'cop', 'mobster', 'rocket'];
const WORLD_W = COLS * TILE;
const CORNER_WINDOW = 3;
const sec = (s) => Math.round(s * TICK_HZ);
const px = (tile) => (tile + 0.5) * TILE;

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function createGame({ mode = 'endless', level = 1, seed = Date.now() } = {}) {
  const g = {
    mode,
    level,
    rng: makeRng(seed),
    score: 0,
    lives: START_LIVES,
    extraLifeGiven: false,
    tick: 0,
    phase: 'ready',
    phaseTicks: sec(2.2),
    events: [],
    popups: [],
    stats: { seeds: 0, bags: 0, enemies: 0, bonusItems: 0, bonusPoints: 0, bossKills: 0, livesLost: 0, levelsCleared: 0, powerups: 0, levelLivesLost: 0, levelBonus: false, levelStartTick: 0 },
    result: null,
  };
  startLevel(g, true);
  return g;
}

function emit(g, type, data) {
  g.events.push({ type, ...data });
}

export function worldIndexFor(g) {
  return g.mode === 'campaign' ? worldIndexForCampaign(g.level) : worldIndexForEndless(g.level);
}

function startLevel(g, first) {
  g.world = WORLDS[worldIndexFor(g)];
  g.boss = isBossLevel(g.level) ? makeBoss(g) : null;
  g.mazeKey = g.boss ? 'boss' : g.world.id;
  g.grid = MAZES[g.mazeKey].map((row) => row.split(''));
  g.seedsTotal = g.grid.flat().filter((c) => c === '.' || c === 'o').length;
  g.seedsLeft = g.seedsTotal;
  g.seedsEatenLevel = 0;
  g.bagSpots = [];
  g.grid.forEach((row, y) => row.forEach((c, x) => { if (c === 'o') g.bagSpots.push({ x, y }); }));
  g.bagRespawns = [];
  g.bonus = null;
  g.bonusSpawned = 0;
  g.powerup = null;
  g.powerupSpawned = false;
  g.effects = { speed: 0, freeze: 0, magnet: 0, double: 0, shield: false, grace: 0, bossPower: 0 };
  g.speeds = speedsFor(g.level);
  g.elroy = elroyFor(g.level);
  g.fright = frightFor(g.level);
  g.waves = wavesFor(g.level).map(sec);
  g.penLimits = penDotLimits(g.level);
  g.useGlobalCounter = false;
  g.globalDots = 0;
  g.mazeVersion = (g.mazeVersion || 0) + 1;
  g.stats.levelLivesLost = 0;
  g.stats.levelBonus = false;
  g.stats.levelStartTick = g.tick;
  resetActors(g);
  g.phase = 'ready';
  g.phaseTicks = sec(first ? 2.2 : 1.6);
  emit(g, 'level', { level: g.level, world: g.world.id, boss: !!g.boss });
}

function resetActors(g) {
  const s = LANDMARKS.playerStart;
  g.player = { x: px(s.x), y: px(s.y), dir: DIRS.left, face: DIRS.left, want: DIRS.left, pause: 0, anim: 0, eatFlash: 0 };
  g.enemies = g.boss ? [] : ENEMY_IDS.map((id, i) => {
    const slot = LANDMARKS.penSlots[i];
    return {
      id, i, x: px(slot.x), y: px(slot.y),
      dir: i === 0 ? DIRS.left : (i === 1 ? DIRS.down : DIRS.up),
      state: i === 0 ? 'active' : 'pen',
      frightTicks: 0, flash: false, dots: 0, reverse: false, anim: 0,
    };
  });
  g.waveIndex = 0;
  g.waveTicks = g.waves[0];
  g.frightTicks = 0;
  g.frightEaten = 0;
  g.idleTicks = 0;
  g.freezeAll = 0;
  if (g.boss) {
    g.boss.x = px(13.5); g.boss.y = px(4);
    g.boss.dir = DIRS.left; g.boss.stun = 0; g.boss.attackTicks = sec(BOSS.attackEverySeconds);
    g.boss.missiles = []; g.boss.stomp = null;
  }
}

function makeBoss(g) {
  return { hp: BOSS.hp, x: 0, y: 0, dir: DIRS.left, stun: 0, attackTicks: 0, missiles: [], stomp: null, anim: 0, attackAnim: 0, nextAttack: 'missile' };
}

// ---------- grid helpers ----------
function cell(g, tx, ty) {
  if (ty < 0 || ty >= ROWS) return '#';
  if (tx < 0 || tx >= COLS) return ty === LANDMARKS.tunnelRow ? 'T' : '#';
  return g.grid[ty][tx];
}
const isWall = (c) => c === '#' || c === 'G' || c === '-';
const tileOf = (v) => Math.floor(v / TILE);
const isTunnel = (g, e) => cell(g, tileOf(e.x), tileOf(e.y)) === 'T';

function wrap(e) {
  if (e.x < -TILE) e.x += WORLD_W + 2 * TILE;
  else if (e.x >= WORLD_W + TILE) e.x -= WORLD_W + 2 * TILE;
}

function openFrom(g, e, d) {
  return !isWall(cell(g, tileOf(e.x) + d.x, tileOf(e.y) + d.y));
}

// Moves along the grid, calling onCenter whenever a tile centre is reached.
function advance(g, e, dist, onCenter) {
  let guard = 0;
  while (dist > 1e-6 && guard++ < 6) {
    if (e.dir === NONE) {
      onCenter(e);
      if (e.dir === NONE) return;
    }
    const d = e.dir;
    const cx = px(tileOf(e.x));
    const cy = px(tileOf(e.y));
    const along = (cx - e.x) * d.x + (cy - e.y) * d.y;
    const toCenter = along > 1e-6 ? along : along + TILE;
    if (dist >= toCenter) {
      e.x += d.x * toCenter;
      e.y += d.y * toCenter;
      if (d.x) e.x = Math.round(e.x * 1000) / 1000;
      if (d.y) e.y = Math.round(e.y * 1000) / 1000;
      dist -= toCenter;
      wrap(e);
      onCenter(e);
    } else {
      e.x += d.x * dist;
      e.y += d.y * dist;
      dist = 0;
      wrap(e);
    }
  }
}

// ---------- player ----------
function playerSpeed(g) {
  let pct = g.frightTicks > 0 || g.effects.bossPower > 0 ? g.speeds.playerFright : g.speeds.player;
  if (g.effects.speed > 0) pct *= POWERUP.speed.mult;
  return pct * FULL_SPEED_PX_PER_TICK;
}

function updatePlayer(g) {
  const p = g.player;
  if (p.pause > 0) { p.pause -= 1; return; }
  const want = p.want;
  if (want !== p.dir && want === OPPOSITE[p.dir.name] && p.dir !== NONE) {
    p.dir = want;
  } else if (want !== p.dir && p.dir !== NONE && (want.x !== 0) !== (p.dir.x !== 0)) {
    const tx = tileOf(p.x); const ty = tileOf(p.y);
    const off = p.dir.x ? Math.abs(px(tx) - p.x) : Math.abs(px(ty) - p.y);
    if (off <= CORNER_WINDOW && !isWall(cell(g, tx + want.x, ty + want.y))) p.dir = want;
  }
  let dist = playerSpeed(g);
  // Cornering: pull the off-axis coordinate back to the lane centre while moving.
  if (p.dir.x) {
    const cy = px(tileOf(p.y)); const off = cy - p.y;
    if (Math.abs(off) > 1e-6) p.y += Math.sign(off) * Math.min(Math.abs(off), dist);
  } else if (p.dir.y) {
    const cx = px(tileOf(p.x)); const off = cx - p.x;
    if (Math.abs(off) > 1e-6) p.x += Math.sign(off) * Math.min(Math.abs(off), dist);
  }
  const before = p.x + p.y;
  advance(g, p, dist, (e) => {
    if (e.want !== NONE && openFrom(g, e, e.want)) e.dir = e.want;
    else if (e.dir !== NONE && !openFrom(g, e, e.dir)) e.dir = NONE;
  });
  if (p.dir !== NONE) p.face = p.dir;
  if (p.x + p.y !== before) p.anim += 1;
  eatAt(g, tileOf(p.x), tileOf(p.y));
  if (g.effects.magnet > 0) magnetPull(g);
}

function magnetPull(g) {
  const r = POWERUP.magnet.radius;
  const tx = tileOf(g.player.x); const ty = tileOf(g.player.y);
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      if ((x - tx) ** 2 + (y - ty) ** 2 <= r * r && cell(g, x, y) === '.') eatAt(g, x, y, true);
    }
  }
}

function addScore(g, pts, x, y) {
  const value = pts * (g.effects.double > 0 ? 2 : 1);
  g.score += value;
  if (!g.extraLifeGiven && g.score >= EXTRA_LIFE_AT) {
    g.extraLifeGiven = true;
    g.lives += 1;
    emit(g, 'extralife');
  }
  if (x != null) g.popups.push({ x, y, text: String(value), ttl: sec(1) });
  return value;
}

function eatAt(g, tx, ty, magnet = false) {
  const c = cell(g, tx, ty);
  if (c !== '.' && c !== 'o') return;
  g.grid[ty][tx] = ' ';
  g.mazeVersion += 1;
  g.seedsLeft -= 1;
  g.seedsEatenLevel += 1;
  g.idleTicks = 0;
  countPenDot(g);
  if (c === '.') {
    g.stats.seeds += 1;
    addScore(g, SCORE.seed);
    if (!magnet) g.player.pause = 1;
    emit(g, 'seed');
  } else {
    g.stats.bags += 1;
    addScore(g, SCORE.bag);
    g.player.pause = 3;
    g.player.eatFlash = sec(0.4);
    if (g.boss) {
      g.effects.bossPower = sec(BOSS.powerSeconds);
      g.bagRespawns.push({ x: tx, y: ty, ticks: sec(BOSS.bagRespawnSeconds) });
    } else {
      startFright(g);
    }
    emit(g, 'bag');
  }
  const eaten = g.seedsTotal - g.seedsLeft;
  if (!g.boss && BONUS_AT_SEEDS[g.bonusSpawned] === eaten) {
    g.bonusSpawned += 1;
    const b = bonusFor(g.level);
    g.bonus = { ...b, x: px(LANDMARKS.bonus.x), y: px(LANDMARKS.bonus.y), ticks: sec(BONUS_SECONDS + g.rng() * 0.5) };
  }
  if (!g.powerupSpawned && eaten >= g.seedsTotal * POWERUP.spawnAtSeedFraction) spawnPowerup(g);
  if (!g.boss && g.seedsLeft === 0) levelClear(g);
}

function spawnPowerup(g) {
  g.powerupSpawned = true;
  const pool = powerupPool(worldIndexFor(g));
  const type = pool[Math.floor(g.rng() * pool.length)];
  const p = g.player;
  const spots = [];
  g.grid.forEach((row, y) => row.forEach((c, x) => {
    if ((c === ' ' || c === '.') && y !== LANDMARKS.tunnelRow && Math.abs(x - tileOf(p.x)) + Math.abs(y - tileOf(p.y)) > 8 && !(y >= 11 && y <= 17 && x >= 9 && x <= 18)) spots.push({ x, y });
  }));
  if (!spots.length) return;
  const s = spots[Math.floor(g.rng() * spots.length)];
  g.powerup = { type, x: px(s.x), y: px(s.y), ticks: sec(POWERUP.lifetimeSeconds) };
  emit(g, 'powerup_spawn', { kind: type });
}

function applyPowerup(g, type) {
  g.stats.powerups += 1;
  const e = g.effects;
  if (type === 'speed') e.speed = sec(POWERUP.speed.seconds);
  else if (type === 'freeze') e.freeze = sec(POWERUP.freeze.seconds);
  else if (type === 'magnet') e.magnet = sec(POWERUP.magnet.seconds);
  else if (type === 'shield') e.shield = true;
  else if (type === 'double') e.double = sec(POWERUP.double.seconds);
  else if (type === 'extra_life') g.lives += 1;
  emit(g, 'powerup', { kind: type });
}

// ---------- enemies ----------
function startFright(g) {
  g.frightEaten = 0;
  const ticks = sec(g.fright.seconds);
  g.frightTicks = ticks;
  g.enemies.forEach((e) => {
    if (e.state === 'eyes' || e.state === 'entering') return;
    if (e.state === 'active') e.reverse = true;
    e.frightTicks = ticks;
  });
}

function currentWaveMode(g) {
  return g.waveIndex % 2 === 0 ? 'scatter' : 'chase';
}

function elroyLevel(g) {
  const rocketHome = g.enemies[3] && g.enemies[3].state === 'pen';
  if (g.useGlobalCounter && rocketHome) return 0;
  if (g.seedsLeft <= g.elroy.dots2) return 2;
  if (g.seedsLeft <= g.elroy.dots1) return 1;
  return 0;
}

function targetFor(g, e) {
  if (e.state === 'eyes') return { x: 13, y: LANDMARKS.penDoor.y };
  const p = g.player;
  const ptx = tileOf(p.x); const pty = tileOf(p.y);
  const scatter = LANDMARKS.scatter[e.i];
  const mode = currentWaveMode(g);
  if (mode === 'scatter' && !(e.i === 0 && elroyLevel(g) > 0)) return scatter;
  const f = p.face;
  if (e.i === 0) return { x: ptx, y: pty };
  if (e.i === 1) return { x: ptx + f.x * 4 - (f === DIRS.up ? 4 : 0), y: pty + f.y * 4 };
  if (e.i === 2) {
    const piv = { x: ptx + f.x * 2 - (f === DIRS.up ? 2 : 0), y: pty + f.y * 2 };
    const b = g.enemies[0];
    return { x: piv.x * 2 - tileOf(b.x), y: piv.y * 2 - tileOf(b.y) };
  }
  const dx = tileOf(e.x) - ptx; const dy = tileOf(e.y) - pty;
  return dx * dx + dy * dy > 64 ? { x: ptx, y: pty } : scatter;
}

function chooseDir(g, e) {
  if (e.reverse) {
    e.reverse = false;
    const back = OPPOSITE[e.dir.name];
    if (openFrom(g, e, back)) { e.dir = back; return; }
  }
  const tx = tileOf(e.x); const ty = tileOf(e.y);
  const options = TIE_ORDER.filter((d) => d !== OPPOSITE[e.dir.name] && !isWall(cell(g, tx + d.x, ty + d.y)));
  if (!options.length) { e.dir = OPPOSITE[e.dir.name]; return; }
  if (e.frightTicks > 0 && e.state === 'active') {
    e.dir = options[Math.floor(g.rng() * options.length)];
    return;
  }
  const t = targetFor(g, e);
  let best = options[0]; let bestD = Infinity;
  options.forEach((d) => {
    const dd = (tx + d.x - t.x) ** 2 + (ty + d.y - t.y) ** 2;
    if (dd < bestD) { bestD = dd; best = d; }
  });
  e.dir = best;
}

function enemySpeed(g, e) {
  if (g.effects.freeze > 0 && e.state !== 'eyes' && e.state !== 'entering') return 0;
  if (e.state === 'eyes' || e.state === 'entering') return 1.6 * FULL_SPEED_PX_PER_TICK;
  if (e.state === 'pen' || e.state === 'leaving') return 0.5 * FULL_SPEED_PX_PER_TICK;
  if (isTunnel(g, e)) return g.speeds.enemyTunnel * FULL_SPEED_PX_PER_TICK;
  if (e.frightTicks > 0) return g.speeds.enemyFright * FULL_SPEED_PX_PER_TICK;
  if (e.i === 0) {
    const lv = elroyLevel(g);
    if (lv === 2) return g.elroy.speed2 * FULL_SPEED_PX_PER_TICK;
    if (lv === 1) return g.elroy.speed1 * FULL_SPEED_PX_PER_TICK;
  }
  return g.speeds.enemy * FULL_SPEED_PX_PER_TICK;
}

function moveToward(e, tx, ty, dist) {
  const dx = tx - e.x; const dy = ty - e.y;
  if (Math.abs(dx) > 1e-6) {
    const s = Math.min(Math.abs(dx), dist);
    e.x += Math.sign(dx) * s; dist -= s;
    e.dir = dx > 0 ? DIRS.right : DIRS.left;
  }
  if (dist > 0 && Math.abs(dy) > 1e-6) {
    const s = Math.min(Math.abs(dy), dist);
    e.y += Math.sign(dy) * s;
    e.dir = dy > 0 ? DIRS.down : DIRS.up;
  }
  return Math.abs(tx - e.x) < 1e-6 && Math.abs(ty - e.y) < 1e-6;
}

function updateEnemy(g, e) {
  const dist = enemySpeed(g, e);
  if (dist <= 0) return;
  e.anim += 1;
  const doorX = px(LANDMARKS.penDoor.x); const doorY = px(LANDMARKS.penDoor.y);
  const homeY = px(LANDMARKS.penCenter.y);
  if (e.state === 'pen') {
    const top = homeY - 4; const bottom = homeY + 4;
    e.y += (e.dir === DIRS.up ? -1 : 1) * dist;
    if (e.y <= top) { e.y = top; e.dir = DIRS.down; }
    if (e.y >= bottom) { e.y = bottom; e.dir = DIRS.up; }
    return;
  }
  if (e.state === 'leaving') {
    const atX = Math.abs(e.x - doorX) < 1e-6;
    if (!atX) { moveToward(e, doorX, e.y, dist); return; }
    if (moveToward(e, doorX, doorY, dist)) {
      e.state = 'active';
      e.dir = DIRS.left;
      e.reverse = false;
    }
    return;
  }
  if (e.state === 'entering') {
    const slotX = px(LANDMARKS.penSlots[e.i === 0 ? 1 : e.i].x);
    if (e.y < homeY - 1e-6) { moveToward(e, doorX, homeY, dist); return; }
    if (moveToward(e, slotX, homeY, dist)) {
      e.state = 'leaving';
      e.frightTicks = 0;
    }
    return;
  }
  if (e.state === 'eyes') {
    const nearDoor = Math.abs(e.y - doorY) < 1e-6 && Math.abs(e.x - doorX) <= TILE / 2 + 1e-6;
    if (nearDoor) {
      if (moveToward(e, doorX, doorY, dist)) e.state = 'entering';
      return;
    }
  }
  advance(g, e, dist, (en) => chooseDir(g, en));
}

function releaseCheck(g) {
  const inPen = g.enemies.filter((e) => e.state === 'pen');
  if (!inPen.length) { g.useGlobalCounter = false; return; }
  const next = inPen.sort((a, b) => a.i - b.i)[0];
  if (g.useGlobalCounter) {
    if (g.globalDots >= GLOBAL_DOT_LIMITS[next.i]) release(g, next);
  } else if (next.dots >= g.penLimits[next.i]) {
    release(g, next);
  }
  if (g.idleTicks >= sec(PEN_IDLE_SECONDS(g.level))) {
    g.idleTicks = 0;
    release(g, next);
  }
}

function release(g, e) {
  if (e.state === 'pen') e.state = 'leaving';
}

function countPenDot(g) {
  if (g.useGlobalCounter) { g.globalDots += 1; return; }
  const next = g.enemies.filter((e) => e.state === 'pen').sort((a, b) => a.i - b.i)[0];
  if (next) next.dots += 1;
}

function updateWaves(g) {
  if (g.frightTicks > 0) return;
  if (g.waveTicks === Infinity) return;
  g.waveTicks -= 1;
  if (g.waveTicks <= 0) {
    g.waveIndex = Math.min(g.waveIndex + 1, g.waves.length - 1);
    g.waveTicks = g.waves[g.waveIndex];
    g.enemies.forEach((e) => { if (e.state === 'active') e.reverse = true; });
  }
}

// ---------- boss ----------
function updateBoss(g) {
  const b = g.boss;
  b.anim += 1;
  if (b.attackAnim > 0) b.attackAnim -= 1;
  if (b.stun > 0) { b.stun -= 1; return; }
  if (g.effects.freeze > 0) return;
  if (b.stomp) {
    b.stomp.ticks -= 1;
    if (b.stomp.ticks <= 0) {
      const p = g.player;
      const d = Math.hypot(p.x - b.stomp.x, p.y - b.stomp.y) / TILE;
      b.stomp = null;
      emit(g, 'stomp');
      if (d < BOSS.stompRangeTiles) playerHit(g, null);
    }
    return;
  }
  b.attackTicks -= 1;
  if (b.attackTicks <= 0) {
    b.attackTicks = sec(BOSS.attackEverySeconds);
    b.attackAnim = sec(0.5);
    const p = g.player;
    const near = Math.hypot(p.x - b.x, p.y - b.y) / TILE < BOSS.stompRangeTiles + 1;
    if (near) {
      b.stomp = { x: b.x, y: b.y, ticks: sec(BOSS.stompSeconds), total: sec(BOSS.stompSeconds) };
      return;
    }
    const ptx = tileOf(p.x); const pty = tileOf(p.y);
    const targets = [{ x: ptx, y: pty }];
    for (let tries = 0; targets.length < 3 && tries < 40; tries++) {
      const x = ptx + Math.floor(g.rng() * 9) - 4; const y = pty + Math.floor(g.rng() * 9) - 4;
      if (!isWall(cell(g, x, y)) && !targets.some((t) => t.x === x && t.y === y)) targets.push({ x, y });
    }
    const warn = sec(BOSS.missileWarnSeconds);
    targets.forEach((t) => b.missiles.push({ fromX: b.x, fromY: b.y - TILE, x: px(t.x), y: px(t.y), ticks: warn, total: warn }));
    emit(g, 'missile');
  }
  const pct = BOSS.speed * FULL_SPEED_PX_PER_TICK;
  advance(g, b, pct, (e) => {
    const tx = tileOf(e.x); const ty = tileOf(e.y);
    const options = TIE_ORDER.filter((d) => d !== OPPOSITE[e.dir.name] && !isWall(cell(g, tx + d.x, ty + d.y)));
    if (!options.length) { e.dir = OPPOSITE[e.dir.name]; return; }
    const p = g.player;
    const flee = g.effects.bossPower > 0;
    const t = flee ? { x: tileOf(p.x) < 14 ? 26 : 1, y: tileOf(p.y) < 15 ? 29 : 1 } : { x: tileOf(p.x), y: tileOf(p.y) };
    let best = options[0]; let bestD = Infinity;
    options.forEach((d) => {
      const dd = (tx + d.x - t.x) ** 2 + (ty + d.y - t.y) ** 2;
      if (dd < bestD) { bestD = dd; best = d; }
    });
    e.dir = best;
  });
}

function updateMissiles(g) {
  const b = g.boss;
  b.missiles = b.missiles.filter((m) => {
    m.ticks -= 1;
    if (m.ticks > 0) return true;
    g.popups.push({ x: m.x, y: m.y, boom: true, ttl: sec(0.5) });
    emit(g, 'blast');
    const p = g.player;
    if (Math.hypot(p.x - m.x, p.y - m.y) / TILE < BOSS.missileBlastTiles) playerHit(g, null);
    return false;
  });
}

function bossCollision(g) {
  const b = g.boss;
  const p = g.player;
  if (Math.hypot(p.x - b.x, p.y - b.y) > TILE * 1.4) return;
  if (b.stun > 0) return;
  if (g.effects.bossPower > 0) {
    b.hp -= 1;
    b.stun = sec(BOSS.stunSeconds);
    b.missiles = []; b.stomp = null;
    g.effects.bossPower = 0;
    addScore(g, 1000, b.x, b.y - TILE);
    emit(g, 'bosshit', { hp: b.hp });
    if (b.hp <= 0) {
      g.stats.bossKills += 1;
      addScore(g, BOSS.pointsPerWorld * (worldIndexFor(g) + 1), b.x, b.y);
      emit(g, 'bossdead');
      levelClear(g);
    }
  } else {
    playerHit(g, null);
  }
}

// ---------- collisions & flow ----------
function collideEnemies(g) {
  const p = g.player;
  const ptx = tileOf(p.x); const pty = tileOf(p.y);
  for (const e of g.enemies) {
    if (e.state !== 'active') continue;
    if (tileOf(e.x) !== ptx || tileOf(e.y) !== pty) continue;
    if (e.frightTicks > 0) {
      e.state = 'eyes';
      e.frightTicks = 0;
      const pts = SCORE.enemies[Math.min(g.frightEaten, 3)];
      g.frightEaten += 1;
      g.stats.enemies += 1;
      addScore(g, pts, e.x, e.y);
      g.freezeAll = sec(1);
      emit(g, 'enemy', { id: e.id });
    } else if (g.effects.freeze <= 0) {
      playerHit(g, e);
    }
    if (g.phase !== 'play') return;
  }
}

function playerHit(g, enemy) {
  if (g.phase !== 'play' || g.effects.grace > 0) return;
  if (g.effects.shield) {
    g.effects.shield = false;
    g.effects.grace = sec(POWERUP.shield.graceSeconds);
    if (enemy) { enemy.state = 'eyes'; enemy.frightTicks = 0; }
    emit(g, 'shield_pop');
    return;
  }
  g.phase = 'dying';
  g.phaseTicks = sec(2);
  g.stats.livesLost += 1;
  g.stats.levelLivesLost += 1;
  emit(g, 'death');
}

function levelClear(g) {
  g.phase = 'clear';
  g.phaseTicks = sec(2.2);
  g.stats.levelsCleared += 1;
  emit(g, 'clear', { level: g.level });
}

function campaignStars(g) {
  if (g.stats.levelLivesLost > 0) return 1;
  if (g.boss) return (g.tick - g.stats.levelStartTick) <= sec(90) ? 3 : 2;
  return g.stats.levelBonus ? 3 : 2;
}

function finishPhase(g) {
  if (g.phase === 'ready') {
    g.phase = 'play';
    return;
  }
  if (g.phase === 'dying') {
    g.lives -= 1;
    if (g.lives <= 0) {
      g.phase = 'over';
      g.result = { cleared: false, stars: 0 };
      emit(g, 'gameover');
      return;
    }
    resetActors(g);
    g.useGlobalCounter = true;
    g.globalDots = 0;
    g.effects.speed = 0; g.effects.freeze = 0; g.effects.magnet = 0; g.effects.bossPower = 0; g.effects.grace = 0;
    g.phase = 'ready';
    g.phaseTicks = sec(1.6);
    return;
  }
  if (g.phase === 'clear') {
    if (g.mode === 'campaign') {
      g.phase = 'over';
      g.result = { cleared: true, stars: campaignStars(g) };
      emit(g, 'won');
      return;
    }
    g.level += 1;
    startLevel(g, false);
  }
}

function tickTimers(g) {
  const e = g.effects;
  ['speed', 'freeze', 'magnet', 'double', 'grace', 'bossPower'].forEach((k) => { if (e[k] > 0) e[k] -= 1; });
  if (g.frightTicks > 0) {
    g.frightTicks -= 1;
    const flashTicks = g.fright.flashes * 28;
    g.enemies.forEach((en) => {
      if (en.frightTicks > 0) {
        en.frightTicks = g.frightTicks;
        en.flash = g.frightTicks < flashTicks && Math.floor(g.frightTicks / 14) % 2 === 0;
      }
    });
  }
  if (g.bonus && --g.bonus.ticks <= 0) g.bonus = null;
  if (g.powerup && --g.powerup.ticks <= 0) g.powerup = null;
  g.bagRespawns = g.bagRespawns.filter((r) => {
    r.ticks -= 1;
    if (r.ticks > 0) return true;
    if (g.grid[r.y][r.x] === ' ') { g.grid[r.y][r.x] = 'o'; g.seedsLeft += 1; g.mazeVersion += 1; }
    return false;
  });
  g.idleTicks += 1;
}

function pickups(g) {
  const p = g.player;
  const near = (o) => Math.abs(o.x - p.x) < TILE * 0.75 && Math.abs(o.y - p.y) < TILE * 0.75;
  if (g.bonus && near(g.bonus)) {
    addScore(g, g.bonus.points, g.bonus.x, g.bonus.y);
    g.stats.bonusItems += 1;
    g.stats.bonusPoints += g.bonus.points;
    g.stats.levelBonus = true;
    g.player.eatFlash = sec(0.4);
    emit(g, 'bonus', { item: g.bonus.item });
    g.bonus = null;
  }
  if (g.powerup && near(g.powerup)) {
    applyPowerup(g, g.powerup.type);
    g.powerup = null;
  }
}

export function setWant(g, dirName) {
  const d = DIRS[dirName];
  if (d) g.player.want = d;
}

export function step(g) {
  g.tick += 1;
  g.popups = g.popups.filter((pp) => --pp.ttl > 0);
  if (g.phase === 'over' || g.phase === 'paused') return;
  if (g.phase !== 'play') {
    if (g.phase === 'dying') g.player.anim += 1;
    if (--g.phaseTicks <= 0) finishPhase(g);
    return;
  }
  if (g.freezeAll > 0) {
    g.freezeAll -= 1;
    g.enemies.forEach((e) => { if (e.state === 'eyes' || e.state === 'entering') updateEnemy(g, e); });
    return;
  }
  if (g.player.eatFlash > 0) g.player.eatFlash -= 1;
  tickTimers(g);
  updatePlayer(g);
  if (g.phase !== 'play') return;
  pickups(g);
  if (g.boss) {
    updateBoss(g);
    updateMissiles(g);
    if (g.phase === 'play') bossCollision(g);
    return;
  }
  collideEnemies(g);
  if (g.phase !== 'play') return;
  updateWaves(g);
  releaseCheck(g);
  g.enemies.forEach((e) => updateEnemy(g, e));
  collideEnemies(g);
}

export function summary(g) {
  const s = g.stats;
  return {
    score: g.score,
    level_reached: g.level,
    seeds_eaten: s.seeds,
    bags_eaten: s.bags,
    enemies_eaten: s.enemies,
    bonus_items: s.bonusItems,
    boss_kills: s.bossKills,
    lives_lost: s.livesLost,
    levels_cleared: s.levelsCleared,
    cleared: !!g.result?.cleared,
    stars: g.result?.stars || 0,
  };
}
