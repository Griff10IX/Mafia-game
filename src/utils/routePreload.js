/**
 * Preload lazy route chunks on nav hover/focus and on route change so Suspense "Loading..." is brief.
 * Keys must match pathname (no trailing slash).
 */
import { prefetchTravelPageData } from './travelPageWarm';

const ROUTE_PRELOADERS = {
  '/account/dashboard': () => import('../pages/Account/Dashboard'),
  '/account/settings': () => import('../pages/Account/IPRules'),
  '/account/prestige': () => import('../pages/Account/Prestige'),
  '/account/stats': () => import('../pages/Account/MyStats'),
  '/account/inventory': () => import('../pages/Account/MyInventory'),
  '/account/profile': () => import('../pages/Account/Profile'),
  '/account/objectives': () => import('../pages/Account/Objectives'),
  '/kill/armour-weapons': () => import('../pages/Kill/ArmourWeapons'),
  '/kill/bodyguards': () => import('../pages/Kill/Bodyguards'),
  '/kill/attack': () => import('../pages/Kill/Attack'),
  '/kill/hitlist': () => import('../pages/Kill/HitlistPage'),
  '/organised-crime': () => import('../pages/Crime/OrganisedCrime'),
  '/crime/crimes': () => import('../pages/Crime/Crimes'),
  '/crime/gta': () => import('../pages/Crime/GTA'),
  '/crime/jail': () => import('../pages/Crime/Jail'),
  '/social/image-host': () => import('../pages/Social/ImageHost'),
  '/social/inbox': () => import('../pages/Social/Inbox'),
  '/social/forum': () => import('../pages/Social/Forum'),
  '/game/store': () => import('../pages/Game/Store'),
  '/game/states': () => import('../pages/Game/States'),
  '/game/travel': () => import('../pages/Game/Travel').then(() => prefetchTravelPageData({ force: false })),
  '/game/ranking': () => import('../pages/Game/Ranking'),
  '/game/leaderboard': () => import('../pages/Game/Leaderboard'),
  '/game/family/list': () => import('../pages/Game/FamilyPage'),
  '/game/world-cup': () => import('../pages/Game/WorldCup'),
  '/money/bank': () => import('../pages/Money/Bank'),
  '/money/racket': () => import('../pages/Money/IllegalBusiness'),
  '/my-properties': () => import('../pages/Money/MyProperties'),
  '/casino': () => import('../pages/Casinos/Casino'),
  '/sports-betting': () => import('../pages/Casinos/SportsBetting'),
};

const started = new Set();
const debounceTimers = new Map();

function normalizePath(path) {
  if (!path || typeof path !== 'string') return '';
  const base = path.split('?')[0].replace(/\/+$/, '') || '/';
  return base;
}

/** @param {string} pathOrTo — pathname or react-router `to` string */
export function preloadRoute(pathOrTo) {
  const path = normalizePath(pathOrTo);
  if (!path || started.has(path)) return;
  const fn = ROUTE_PRELOADERS[path];
  if (!fn) return;
  started.add(path);
  fn().catch(() => {
    started.delete(path);
  });
}

export function preloadRouteDebounced(pathOrTo, ms = 120) {
  const path = normalizePath(pathOrTo);
  if (!path) return;
  const existing = debounceTimers.get(path);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    path,
    setTimeout(() => {
      debounceTimers.delete(path);
      preloadRoute(path);
    }, ms),
  );
}

export function preloadRouteHandlers(pathOrTo) {
  const path = normalizePath(pathOrTo);
  return {
    onMouseEnter: () => preloadRouteDebounced(path),
    onFocus: () => preloadRouteDebounced(path),
  };
}
