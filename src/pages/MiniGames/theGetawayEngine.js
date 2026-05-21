/**
 * The Getaway — Temple Run-style runner engine (pure logic + draw helpers).
 */

export const W = 480;
export const H = 640;
export const LANE_COUNT = 3;
export const TILE_H = 72;
export const HORIZON_Y = H * 0.28;
export const ROAD_TOP_W = W * 0.2;
export const ROAD_BOTTOM_W = W * 0.88;
export const PLAYER_Y = H - 128;
export const STORAGE_SPEED_KEY = 'the_getaway_speed_preset';

export const SPEED_PRESETS = {
  relaxed: {
    id: 'relaxed',
    label: 'Relaxed',
    desc: 'Easier to read — good for learning',
    base: 2.1,
    max: 5.8,
    rampDivisor: 720,
    scrollMult: 0.68,
    worldMult: 0.75,
    spawnBase: 118,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    desc: 'Balanced Temple Run pace',
    base: 3.0,
    max: 8.2,
    rampDivisor: 520,
    scrollMult: 0.78,
    worldMult: 0.86,
    spawnBase: 98,
  },
  fast: {
    id: 'fast',
    label: 'Fast',
    desc: 'High speed chase',
    base: 4.2,
    max: 11.5,
    rampDivisor: 380,
    scrollMult: 0.88,
    worldMult: 0.95,
    spawnBase: 82,
  },
};

export function loadSpeedPresetId() {
  try {
    const v = localStorage.getItem(STORAGE_SPEED_KEY);
    return SPEED_PRESETS[v] ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveSpeedPresetId(id) {
  try {
    localStorage.setItem(STORAGE_SPEED_KEY, id);
  } catch {
    /* ignore */
  }
}

export function roadT(y) {
  return Math.max(0, Math.min(1, (y - HORIZON_Y) / (H - HORIZON_Y)));
}

export function roadWidthAtY(y) {
  const t = roadT(y);
  return ROAD_TOP_W + (ROAD_BOTTOM_W - ROAD_TOP_W) * (t * t * 0.7 + t * 0.3);
}

export function laneScreenX(lane, y) {
  const w = roadWidthAtY(y);
  return W / 2 - w / 2 + ((lane + 0.5) / LANE_COUNT) * w;
}

export function perspScale(y) {
  const t = Math.max(0, Math.min(1, (y - HORIZON_Y) / (H - HORIZON_Y - 48)));
  return 0.2 + 0.88 * (t * t * 0.6 + t * 0.4);
}

function loadHighScore() {
  try {
    return Number(localStorage.getItem('the_getaway_high_score')) || 0;
  } catch {
    return 0;
  }
}

export function saveHighScore(n) {
  try {
    localStorage.setItem('the_getaway_high_score', String(Math.floor(n)));
  } catch {
    /* ignore */
  }
}

export function createGameState(presetId = 'normal') {
  const preset = SPEED_PRESETS[presetId] || SPEED_PRESETS.normal;
  return {
    state: 'title',
    score: 0,
    coins: 0,
    lives: 3,
    highScore: loadHighScore(),
    frame: 0,
    speed: preset.base,
    speedPresetId: preset.id,
    player: {
      lane: 1,
      targetLane: 1,
      laneT: 1,
      x: W / 2,
      w: 34,
      h: 52,
      vy: 0,
      jumping: false,
      sliding: false,
      slideTimer: 0,
      invincible: 0,
      runFrame: 0,
      runTick: 0,
    },
    obstacles: [],
    coinItems: [],
    particles: [],
    pathTiles: [],
    buildings: [],
    clouds: [],
    streaks: [],
    shake: 0,
    gameStartTime: null,
    spawnCooldown: 0,
  };
}

export function resetWorldEntities(s) {
  const preset = SPEED_PRESETS[s.speedPresetId] || SPEED_PRESETS.normal;
  s.score = 0;
  s.coins = 0;
  s.lives = 3;
  s.frame = 0;
  s.speed = preset.base;
  s.spawnCooldown = 0;
  const p = s.player;
  p.lane = 1;
  p.targetLane = 1;
  p.laneT = 1;
  p.x = laneScreenX(1, PLAYER_Y);
  p.jumping = false;
  p.sliding = false;
  p.slideTimer = 0;
  p.invincible = 120;
  p.vy = 0;
  p.runFrame = 0;
  p.runTick = 0;
  s.obstacles = [];
  s.coinItems = [];
  s.particles = [];
  s.pathTiles = [];
  s.buildings = [];
  s.clouds = [];
  s.streaks = [];
  s.shake = 0;
  s.gameStartTime = Date.now();

  for (let i = 0; i < 14; i++) {
    s.pathTiles.push({ y: PLAYER_Y - 40 - i * TILE_H, stripe: i % 2 });
  }
  for (let i = 0; i < 10; i++) {
    s.buildings.push({
      side: i % 2 === 0 ? 'left' : 'right',
      y: HORIZON_Y + (i / 10) * (H - HORIZON_Y - 80),
      w: 36 + (i % 4) * 14,
      h: 70 + (i % 5) * 28,
      neonColor: ['#ff6b9d', '#5ec8ff', '#ffd166', '#ff8c42'][i % 4],
    });
  }
  for (let i = 0; i < 14; i++) {
    s.streaks.push({
      side: i % 2 === 0 ? -1 : 1,
      y: HORIZON_Y + Math.random() * (H - HORIZON_Y),
      len: 14 + Math.random() * 28,
      alpha: 0.12 + Math.random() * 0.22,
    });
  }
  for (let i = 0; i < 4; i++) {
    s.clouds.push({ x: (i * 110) % W, y: 36 + i * 18, w: 44 + i * 12 });
  }
}

export function getPreset(s) {
  return SPEED_PRESETS[s.speedPresetId] || SPEED_PRESETS.normal;
}

export function applySpeedRamp(s) {
  const preset = getPreset(s);
  s.speed = preset.base + Math.min(preset.max - preset.base, s.score / preset.rampDivisor);
  if (s.speed > preset.max) s.speed = preset.max;
}

export function mphDisplay(speed) {
  return Math.round(speed * 11);
}

/** Move world entities — call once per frame before drawing. */
export function updateWorld(s) {
  const preset = getPreset(s);
  const roadScroll = s.speed * preset.scrollMult;
  const worldScroll = s.speed * preset.worldMult;

  s.pathTiles.forEach((tile) => {
    tile.y += roadScroll;
  });
  while (s.pathTiles.length > 0 && s.pathTiles[0].y > H + TILE_H) {
    s.pathTiles.shift();
  }
  while (s.pathTiles.length < 16) {
    const last = s.pathTiles[s.pathTiles.length - 1];
    s.pathTiles.push({ y: last.y - TILE_H, stripe: (last.stripe + 1) % 2 });
  }

  s.streaks.forEach((st) => {
    const t = roadT(st.y);
    st.y += worldScroll * (0.38 + t * 0.72);
    if (st.y > H + 50) {
      st.y = HORIZON_Y - 20 + Math.random() * 40;
      st.side = Math.random() < 0.5 ? -1 : 1;
    }
  });

  s.buildings.forEach((b) => {
    const t = roadT(b.y);
    b.y += Math.max(0.35, worldScroll * (0.06 + t * 0.12));
    if (b.y > H + 60) {
      b.y = HORIZON_Y - 30 + Math.random() * 50;
      b.side = Math.random() < 0.5 ? 'left' : 'right';
    }
  });

  s.clouds.forEach((c) => {
    c.x += 0.08;
    if (c.x > W + c.w) c.x = -c.w;
  });

  s.obstacles.forEach((o) => {
    const sc = perspScale(o.y);
    o.y += worldScroll * (0.78 + sc * 0.14);
  });

  s.coinItems.forEach((c) => {
    if (c.collected) return;
    const sc = perspScale(c.y);
    c.y += worldScroll * (0.8 + sc * 0.1);
  });
}

export function updatePlayer(s) {
  const p = s.player;
  if (p.targetLane !== p.lane) {
    p.laneT += 0.14;
    if (p.laneT >= 1) {
      p.lane = p.targetLane;
      p.laneT = 1;
    }
  } else {
    p.laneT = 1;
  }
  const t = p.lane === p.targetLane ? 1 : Math.min(1, p.laneT);
  const lerpLane = p.lane + (p.targetLane - p.lane) * (1 - Math.pow(1 - t, 2));
  const targetX = laneScreenX(lerpLane, PLAYER_Y);
  p.x += (targetX - p.x) * 0.24;

  if (p.jumping) {
    p.vy += 0.65;
    if (p.vy >= 0) {
      p.jumping = false;
      p.vy = 0;
    }
  }
  if (p.sliding) {
    p.slideTimer--;
    if (p.slideTimer <= 0) p.sliding = false;
  }
  if (p.invincible > 0) p.invincible--;

  p.runTick++;
  if (p.runTick % 7 === 0) p.runFrame = (p.runFrame + 1) % 4;
}

function lanesBlocked(s, spawnY) {
  const blocked = new Set();
  for (const o of s.obstacles) {
    if (Math.abs(o.y - spawnY) < 90 && !o.dead) blocked.add(o.lane);
  }
  return blocked;
}

export function spawnObstacle(s) {
  const spawnY = HORIZON_Y - 55;
  const blocked = lanesBlocked(s, spawnY);
  const free = [0, 1, 2].filter((l) => !blocked.has(l));
  if (free.length === 0) return;

  const roll = Math.random();
  if (roll < 0.22 && free.length >= 2) {
    const l1 = free[Math.floor(Math.random() * free.length)];
    const rest = free.filter((l) => l !== l1);
    const l2 = rest[Math.floor(Math.random() * rest.length)];
    s.obstacles.push({ lane: l1, y: spawnY, w: 48, h: 50, type: 'cop', dead: false });
    s.obstacles.push({ lane: l2, y: spawnY, w: 52, h: 40, type: 'barrier', dead: false });
    return;
  }

  const lane = free[Math.floor(Math.random() * free.length)];
  const t = Math.random();
  if (t < 0.34) {
    s.obstacles.push({ lane, y: spawnY, w: 48, h: 50, type: 'cop', dead: false });
  } else if (t < 0.62) {
    s.obstacles.push({ lane, y: spawnY, w: 52, h: 40, type: 'barrier', dead: false });
  } else {
    s.obstacles.push({ lane, y: spawnY, w: 64, h: 28, type: 'lowbar', dead: false });
  }
}

export function spawnCoins(s) {
  const lane = Math.floor(Math.random() * 3);
  const count = 4 + Math.floor(Math.random() * 3);
  const baseY = HORIZON_Y - 45;
  for (let i = 0; i < count; i++) {
    s.coinItems.push({
      lane,
      y: baseY - i * 42,
      r: 11,
      collected: false,
      spin: Math.random() * Math.PI * 2,
    });
  }
}

export function addParticles(s, x, y, color, n = 6) {
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = 1.5 + Math.random() * 3;
    s.particles.push({
      x,
      y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 2,
      life: 1,
      color,
      r: 2 + Math.random() * 3,
    });
  }
}

export function updateParticles(s) {
  s.particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.18;
    p.life -= 0.045;
  });
  s.particles = s.particles.filter((p) => p.life > 0);
}

export function checkCollisions(s, onLifeLost, onCoin) {
  const p = s.player;
  if (p.invincible > 0) return;

  const px = p.x;
  const pY = PLAYER_Y;
  const jumpH = p.jumping ? Math.max(0, -p.vy * 5.5) : 0;
  const actualY = pY - jumpH;
  const ph = p.sliding ? p.h * 0.52 : p.h;
  const pTop = actualY - ph + (p.sliding ? p.h * 0.48 : 0);

  for (const o of s.obstacles) {
    if (o.dead) continue;
    const scale = perspScale(o.y);
    const ox = laneScreenX(o.lane, o.y);
    const ow = o.w * scale * 0.88;
    const oh = o.h * scale * 0.88;
    const oTop = o.y - oh;
    if (Math.abs(px - ox) < 16 + ow / 2 && pTop < o.y - 4 && actualY > oTop) {
      if (o.type === 'lowbar' && p.sliding) continue;
      if (o.type === 'barrier' && p.jumping) continue;
      o.dead = true;
      onLifeLost(ox, o.y, o.type);
      return;
    }
  }

  for (const c of s.coinItems) {
    if (c.collected) continue;
    const scale = perspScale(c.y);
    const cx = laneScreenX(c.lane, c.y);
    const magnet = Math.abs(px - cx) < 52 && Math.abs(actualY - c.y) < 55;
    if (magnet || (Math.abs(px - cx) < 22 && Math.abs(actualY - c.y) < 28)) {
      c.collected = true;
      onCoin(cx, c.y);
    }
  }
}

export function tickPlaying(s) {
  const preset = getPreset(s);
  s.frame++;
  s.score += s.speed * 0.032;
  applySpeedRamp(s);

  s.spawnCooldown--;
  const spawnEvery = Math.max(42, preset.spawnBase - Math.floor(s.score / 120) * 2);
  if (s.spawnCooldown <= 0) {
    spawnObstacle(s);
    s.spawnCooldown = spawnEvery;
  }
  if (s.frame % 110 === 55) spawnCoins(s);

  updateWorld(s);
  updatePlayer(s);
  updateParticles(s);

  s.obstacles = s.obstacles.filter((o) => o.y < H + 80 && !o.dead);
  s.coinItems = s.coinItems.filter((c) => c.y < H + 40);
}
