import { publicAsset } from '../../../utils/publicAssets';
import { WORLDS } from './tuning';

const BASE = '/images/rr-pacman/atlas';
export const ATLAS_VERSION = 1;
const url = (p) => publicAsset(`${BASE}/${p}?v=${ATLAS_VERSION}`);

// 64px frames are plenty when a tile is small on screen (phones) or memory is tight.
export function pickAtlasSize() {
  if (typeof window === 'undefined') return 128;
  const mem = navigator.deviceMemory;
  if (mem && mem <= 2) return 64;
  const tileCss = Math.min(window.innerWidth / 28, window.innerHeight / 35);
  const need = tileCss * 1.8 * Math.min(window.devicePixelRatio || 1, 2);
  return need <= 72 ? 64 : 128;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

const cache = new Map();
function once(key, fn) {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}

async function loadAtlas(size, name) {
  return once(`${size}/${name}`, async () => {
    const [img, map] = await Promise.all([
      loadImage(url(`${size}/${name}.webp`)),
      fetch(url(`${size}/${name}.json`)).then((r) => r.json()),
    ]);
    return { img, frame: map.frame, anims: map.anims };
  });
}

export function loadCore(size) {
  return loadAtlas(size, 'core');
}

export function loadBoss(size) {
  return loadAtlas(size, 'boss');
}

export function loadSkin(size, skin) {
  if (!skin || skin === 'classic') return Promise.resolve(null);
  return loadAtlas(size, `skin-${skin}`);
}

export function loadTiles(worldId) {
  return once(`tiles/${worldId}`, async () => {
    const [floor, wall] = await Promise.all([
      loadImage(url(`tiles/${worldId}-floor.webp`)),
      loadImage(url(`tiles/${worldId}-wall.webp`)),
    ]);
    return { floor, wall };
  });
}

export const BANNERS = ['banner_ready', 'banner_level_clear', 'banner_game_over', 'banner_boss_stage'];
export function loadBanners() {
  return once('banners', async () => {
    const imgs = await Promise.all(BANNERS.map((b) => loadImage(url(`ui/${b}.webp`))));
    return Object.fromEntries(BANNERS.map((b, i) => [b, imgs[i]]));
  });
}

export const LOGO_URL = url('ui/logo.webp');

export function preloadWorldTiles() {
  WORLDS.forEach((w) => { loadTiles(w.id).catch(() => {}); });
}

export function drawFrame(ctx, atlas, key, frameIndex, cx, cy, size, flip = false) {
  const frames = atlas?.anims[key];
  if (!frames) return;
  const [sx, sy] = frames[((frameIndex % frames.length) + frames.length) % frames.length];
  const f = atlas.frame;
  if (flip) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.drawImage(atlas.img, sx, sy, f, f, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    ctx.drawImage(atlas.img, sx, sy, f, f, cx - size / 2, cy - size / 2, size, size);
  }
}
