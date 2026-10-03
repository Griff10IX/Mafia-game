import { TILE, POWERUP, BOSS } from './tuning';
import { COLS, ROWS } from './mazes';
import { drawFrame } from './sprites';

export const HUD_TOP = 2.4;
export const HUD_BOTTOM = 2.4;
export const VIEW_ROWS = ROWS + HUD_TOP + HUD_BOTTOM;

const ACCENT = {
  desert: '#f2b263', city: '#7fd3ff', casino: '#ffd54a', docks: '#5fd0c0',
  prison: '#c9c9c9', mansion: '#d98cff', acme: '#ff6b4a', boss: '#ff4a4a',
};
const POWERUP_ICON_ORDER = ['speed', 'freeze', 'magnet', 'double'];

function tileFill(ctx, img, w, h, size) {
  for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) ctx.drawImage(img, x, y, size, size);
}

function buildMazeLayer(grid, tiles, S, dpr, accent) {
  const c = document.createElement('canvas');
  c.width = Math.round(COLS * S * dpr);
  c.height = Math.round(ROWS * S * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = COLS * S; const H = ROWS * S;
  const texSize = S * 4;
  if (tiles) tileFill(ctx, tiles.floor, W, H, texSize);
  else { ctx.fillStyle = '#1b1410'; ctx.fillRect(0, 0, W, H); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, W, H);
  const wall = (x, y) => {
    const ch = grid[y]?.[x];
    return ch === '#';
  };
  const wallPath = () => {
    ctx.beginPath();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (wall(x, y)) ctx.rect(x * S, y * S, S + 0.5, S + 0.5);
  };
  ctx.save();
  ctx.translate(S * 0.18, S * 0.22);
  wallPath();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();
  ctx.restore();
  ctx.save();
  wallPath();
  ctx.clip();
  if (tiles) tileFill(ctx, tiles.wall, W, H, texSize);
  else { ctx.fillStyle = '#5a3d28'; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, S * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!wall(x, y)) continue;
      const x0 = x * S; const y0 = y * S;
      const inset = ctx.lineWidth / 2;
      if (y > 0 && !wall(x, y - 1)) { ctx.moveTo(x0, y0 + inset); ctx.lineTo(x0 + S, y0 + inset); }
      if (y < ROWS - 1 && !wall(x, y + 1)) { ctx.moveTo(x0, y0 + S - inset); ctx.lineTo(x0 + S, y0 + S - inset); }
      if (x > 0 && !wall(x - 1, y)) { ctx.moveTo(x0 + inset, y0); ctx.lineTo(x0 + inset, y0 + S); }
      if (x < COLS - 1 && !wall(x + 1, y)) { ctx.moveTo(x0 + S - inset, y0); ctx.lineTo(x0 + S - inset, y0 + S); }
    }
  }
  ctx.stroke();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = grid[y][x];
      if (ch === 'G') { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x * S, y * S, S, S); }
      if (ch === '-') { ctx.fillStyle = '#ffb3d9'; ctx.fillRect(x * S, y * S + S * 0.4, S, S * 0.22); }
    }
  }
  return c;
}

function buildSeedLayer(grid, core, S, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.round(COLS * S * dpr);
  c.height = Math.round(ROWS * S * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const size = S * 0.8;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x] !== '.') continue;
      if (core) drawFrame(ctx, core, 'item.seed', 0, (x + 0.5) * S, (y + 0.5) * S, size);
      else { ctx.fillStyle = '#ffe9a8'; ctx.fillRect((x + 0.4) * S, (y + 0.4) * S, S * 0.2, S * 0.2); }
    }
  }
  return c;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const state = { S: 16, dpr: 1, mazeKey: null, mazeLayer: null, seedVersion: -1, seedLayer: null, cssW: 0, cssH: 0, low: false };

  function resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = Math.max(6, Math.floor(Math.min(cssW / COLS, cssH / VIEW_ROWS) * 4) / 4);
    state.S = S; state.dpr = dpr;
    state.cssW = COLS * S; state.cssH = VIEW_ROWS * S;
    canvas.width = Math.round(state.cssW * dpr);
    canvas.height = Math.round(state.cssH * dpr);
    canvas.style.width = `${state.cssW}px`;
    canvas.style.height = `${state.cssH}px`;
    state.mazeKey = null;
    state.seedVersion = -1;
  }

  function draw(g, assets, ui) {
    const { S, dpr } = state;
    const toS = (v) => (v / TILE) * S;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0806';
    ctx.fillRect(0, 0, state.cssW, state.cssH);
    const core = assets.core;
    const accent = ACCENT[g.boss ? 'boss' : g.world.id] || '#f2b263';
    const tiles = assets.tiles?.[g.world.id];
    const key = `${g.mazeKey}|${g.world.id}|${S}|${dpr}|${tiles ? 1 : 0}|${g.level}`;
    if (state.mazeKey !== key) {
      state.mazeLayer = buildMazeLayer(g.grid, tiles, S, dpr, accent);
      state.mazeKey = key;
      state.seedVersion = -1;
    }
    if (state.seedVersion !== g.mazeVersion) {
      state.seedLayer = buildSeedLayer(g.grid, core, S, dpr);
      state.seedVersion = g.mazeVersion;
    }

    drawHud(g, ui, core, accent);

    ctx.save();
    ctx.translate(0, HUD_TOP * S);
    ctx.beginPath();
    ctx.rect(0, 0, COLS * S, ROWS * S);
    ctx.clip();
    ctx.drawImage(state.mazeLayer, 0, 0, COLS * S, ROWS * S);
    if (g.phase === 'clear' && Math.floor(g.tick / 12) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0, 0, COLS * S, ROWS * S);
    }
    ctx.drawImage(state.seedLayer, 0, 0, COLS * S, ROWS * S);

    const pulse = 1 + Math.sin(g.tick * 0.2) * 0.12;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (g.grid[y][x] === 'o') drawFrame(ctx, core, 'item.power_bag', 0, (x + 0.5) * S, (y + 0.5) * S, S * 1.35 * pulse);
      }
    }
    if (g.bonus) {
      const bob = Math.sin(g.tick * 0.12) * S * 0.12;
      drawFrame(ctx, core, `item.${g.bonus.item}`, 0, toS(g.bonus.x), toS(g.bonus.y) + bob, S * 1.7);
    }
    if (g.powerup && !(g.powerup.ticks < 120 && Math.floor(g.tick / 8) % 2 === 0)) {
      drawFrame(ctx, core, `pu.${g.powerup.type}`, 0, toS(g.powerup.x), toS(g.powerup.y), S * 1.7 * pulse);
    }

    if (g.boss) drawBoss(g, assets, toS);
    g.enemies.forEach((e) => drawEnemy(g, e, core, toS));
    drawPlayer(g, assets, toS);

    g.popups.forEach((p) => {
      if (p.boom) {
        drawFrame(ctx, core, 'fx.boom', 3 - Math.floor(p.ttl / 8), toS(p.x), toS(p.y), S * 3);
        return;
      }
      ctx.font = `900 ${Math.round(S * 0.9)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, S * 0.18);
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#7fe8ff';
      const y = toS(p.y) - (60 - p.ttl) * 0.15;
      ctx.strokeText(p.text, toS(p.x), y);
      ctx.fillText(p.text, toS(p.x), y);
    });

    drawBanner(g, assets, ui);
    ctx.restore();
    drawBottom(g, core);
  }

  function drawPlayer(g, assets, toS) {
    const { S } = state;
    const p = g.player;
    const skin = assets.skin;
    const x = toS(p.x); const y = toS(p.y);
    const size = S * 2;
    const e = g.effects;
    const frame = Math.floor(p.anim / 5);
    if (!state.low) {
      if (e.speed > 0) drawFrame(ctx, assets.core, 'fx.aura_speed', Math.floor(g.tick / 4), x, y, size * 1.25, p.face.name === 'left');
      if (e.magnet > 0) drawFrame(ctx, assets.core, 'fx.aura_magnet', Math.floor(g.tick / 5), x, y, size * 1.4);
    }
    let key; let flip = p.face.name === 'left'; let fi = frame;
    if (g.phase === 'dying') {
      key = g.phaseTicks > 84 ? 'rr.hit' : 'rr.ko';
      fi = Math.floor((120 - g.phaseTicks) / 8);
      if (key === 'rr.ko') fi = Math.min(3, Math.floor((84 - g.phaseTicks) / 10));
    } else if (g.phase === 'clear' || (g.phase === 'over' && g.result?.cleared)) {
      key = 'rr.win'; fi = Math.floor(g.tick / 8); flip = false;
    } else if (g.phase === 'ready') {
      key = 'rr.idle'; fi = Math.floor(g.tick / 10);
    } else if (p.eatFlash > 0) {
      key = 'rr.eat'; fi = Math.floor(g.tick / 4);
    } else if (p.dir.name === 'none') {
      key = 'rr.idle'; fi = Math.floor(g.tick / 10);
    } else if (p.face.name === 'up') {
      key = 'rr.up'; flip = false;
    } else if (p.face.name === 'down') {
      key = 'rr.down'; flip = false;
    } else {
      key = 'rr.run';
    }
    if (g.effects.grace > 0 && Math.floor(g.tick / 4) % 2 === 0) ctx.globalAlpha = 0.45;
    const atlas = skin?.anims[key] ? skin : assets.core;
    drawFrame(ctx, atlas, key, fi, x, y - S * 0.15, size, flip);
    ctx.globalAlpha = 1;
    if (e.shield && !state.low) drawFrame(ctx, assets.core, 'fx.aura_shield', Math.floor(g.tick / 5), x, y, size * 1.3);
  }

  function drawEnemy(g, e, core, toS) {
    const { S } = state;
    const x = toS(e.x); const y = toS(e.y);
    const size = S * 2;
    const frame = Math.floor(e.anim / 6);
    if (e.state === 'eyes' || e.state === 'entering') {
      drawFrame(ctx, core, `eyes.${e.dir.name === 'none' ? 'left' : e.dir.name}`, 0, x, y, size * 0.9);
      return;
    }
    let key; let flip = false;
    if (e.frightTicks > 0) key = `en.${e.id}.scared`;
    else if (e.dir.name === 'up') key = `en.${e.id}.up`;
    else if (e.dir.name === 'down') key = `en.${e.id}.down`;
    else { key = `en.${e.id}.side`; flip = e.dir.name === 'left'; }
    const bounce = state.low ? 0 : Math.abs(Math.sin(e.anim * 0.25)) * S * 0.12;
    if (e.flash) ctx.globalAlpha = 0.4;
    drawFrame(ctx, core, key, frame, x, y - S * 0.1 - bounce, size, flip);
    ctx.globalAlpha = 1;
    if (g.effects.freeze > 0) drawFrame(ctx, core, 'fx.aura_freeze', Math.floor(g.tick / 6), x, y, size * 1.1);
  }

  function drawBoss(g, assets, toS) {
    const { S } = state;
    const b = g.boss;
    const core = assets.core;
    b.missiles.forEach((m) => {
      const t = 1 - m.ticks / m.total;
      drawFrame(ctx, core, 'bossfx.target', Math.floor(g.tick / 5), toS(m.x), toS(m.y), S * 2.2);
      const mx = toS(m.fromX + (m.x - m.fromX) * t);
      const my = toS(m.fromY + (m.y - m.fromY) * t) - Math.sin(t * Math.PI) * S * 5;
      drawFrame(ctx, core, 'bossfx.missile', Math.floor(g.tick / 3), mx, my, S * 1.6, m.x < m.fromX);
    });
    if (b.stomp) {
      const t = 1 - b.stomp.ticks / b.stomp.total;
      drawFrame(ctx, core, 'bossfx.shockwave', Math.floor(t * 4), toS(b.stomp.x), toS(b.stomp.y), S * BOSS.stompRangeTiles * 2 * Math.max(0.2, t));
    }
    if (!assets.boss) return;
    let key = 'boss.side';
    if (b.stun > 0) key = 'boss.damaged';
    else if (b.attackAnim > 0 || b.stomp) key = 'boss.attack';
    else if (b.dir.name === 'down' || b.dir.name === 'up') key = 'boss.down';
    const flip = key === 'boss.side' && b.dir.name === 'left';
    if (g.effects.bossPower > 0 && Math.floor(g.tick / 6) % 2 === 0) ctx.globalAlpha = 0.6;
    drawFrame(ctx, assets.boss, key, Math.floor(b.anim / 8), toS(b.x), toS(b.y) - S * 0.6, S * 3.6, flip);
    ctx.globalAlpha = 1;
  }

  function drawHud(g, ui, core, accent) {
    const { S } = state;
    const W = COLS * S;
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(S * 0.7)}px system-ui, sans-serif`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'left';
    ctx.fillText('SCORE', S * 0.6, S * 0.7);
    ctx.textAlign = 'center';
    ctx.fillText(ui.mode === 'campaign' ? 'STAGE' : 'BEST', W / 2, S * 0.7);
    ctx.textAlign = 'right';
    ctx.fillText(g.boss ? 'BOSS' : g.world.name.toUpperCase(), W - S * 0.6, S * 0.7);
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${Math.round(S * 1)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(g.score.toLocaleString(), S * 0.6, S * 1.65);
    ctx.textAlign = 'center';
    ctx.fillText(ui.mode === 'campaign' ? `${g.level}` : Math.max(ui.best || 0, g.score).toLocaleString(), W / 2, S * 1.65);
    ctx.textAlign = 'right';
    if (g.boss) {
      for (let i = 0; i < BOSS.hp; i++) {
        ctx.fillStyle = i < g.boss.hp ? '#ff4a4a' : 'rgba(255,255,255,0.2)';
        ctx.fillRect(W - S * 0.6 - (i + 1) * S * 1.1, S * 1.25, S * 0.9, S * 0.8);
      }
    } else {
      ctx.fillText(`LV ${g.level}`, W - S * 0.6, S * 1.65);
    }
  }

  function drawBottom(g, core) {
    const { S } = state;
    const y = (HUD_TOP + ROWS) * S + S * 1.2;
    for (let i = 0; i < Math.min(g.lives - 1, 6); i++) drawFrame(ctx, core, 'ui.life', 0, S * (1.3 + i * 1.9), y, S * 1.8);
    const e = g.effects;
    let x = COLS * S - S * 1.2;
    const icon = (key, frac) => {
      drawFrame(ctx, core, key, 0, x, y - S * 0.15, S * 1.6);
      if (frac != null) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x - S * 0.7, y + S * 0.75, S * 1.4, S * 0.18);
        ctx.fillStyle = '#7fe8ff';
        ctx.fillRect(x - S * 0.7, y + S * 0.75, S * 1.4 * frac, S * 0.18);
      }
      x -= S * 2;
    };
    POWERUP_ICON_ORDER.forEach((k) => { if (e[k] > 0) icon(`pu.${k}`, e[k] / (POWERUP[k].seconds * 60)); });
    if (e.shield) icon('pu.shield', null);
    if (e.bossPower > 0) icon('item.power_bag', e.bossPower / (BOSS.powerSeconds * 60));
  }

  function drawBanner(g, assets, ui) {
    const { S } = state;
    const banners = assets.banners;
    if (!banners) return;
    let img = null;
    if (g.phase === 'ready') img = g.boss ? banners.banner_boss_stage : banners.banner_ready;
    else if (g.phase === 'clear') img = banners.banner_level_clear;
    else if (g.phase === 'over' && !g.result?.cleared) img = banners.banner_game_over;
    if (!img) return;
    const w = Math.min(COLS * S * 0.62, img.width);
    const h = (img.height / img.width) * w;
    ctx.drawImage(img, (COLS * S - w) / 2, 17.5 * S - h / 2, w, h);
  }

  return {
    resize,
    draw,
    setLowQuality: (v) => { state.low = !!v; },
    get size() { return { w: state.cssW, h: state.cssH, S: state.S }; },
  };
}
