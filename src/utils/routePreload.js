/**
 * Preload lazy route chunks on nav hover/focus and on route change so Suspense "Loading..." is brief.
 * Keys must match pathname (no trailing slash).
 */
import { prefetchTravelPageData } from './travelPageWarm';
import { prefetchStatsAndObjectivesData } from './statsObjectivesWarm';
import { prefetchMissionsPageData } from './missionsPageWarm';
import { prefetchUsersOnlineData } from './usersOnlineWarm';
import { prefetchJailPageData } from './jailPageWarm';

const ROUTE_PRELOADERS = {
  '/account/dashboard': () => import('../pages/Account/Dashboard'),
  '/account/settings': () => import('../pages/Account/IPRules'),
  '/account/prestige': () => import('../pages/Account/Prestige'),
  '/account/stats': () =>
    Promise.all([
      import('../pages/Account/MyStats'),
      prefetchStatsAndObjectivesData({ force: false }),
    ]),
  '/account/game-events': () => import('../pages/Account/GameEvents'),
  '/account/inventory': () => import('../pages/Account/MyInventory'),
  '/account/profile': () => import('../pages/Account/Profile'),
  '/account/objectives': () =>
    Promise.all([
      import('../pages/Account/Objectives'),
      prefetchStatsAndObjectivesData({ force: false }).catch(() => null),
    ]),
  '/account/missions': () =>
    Promise.all([
      import('../pages/Account/Missions'),
      prefetchMissionsPageData({ force: false }).catch(() => null),
    ]),
  '/account/referral': () => import('../pages/Account/Referral'),
  '/account/autorank': () => import('../pages/Account/AutoRank'),
  '/kill/armour-weapons': () => import('../pages/Kill/ArmourWeapons'),
  '/kill/bodyguards': () => import('../pages/Kill/Bodyguards'),
  '/kill/attack': () => import('../pages/Kill/Attack'),
  '/kill/combat-timeline': () => import('../pages/Kill/CombatTimeline'),
  '/kill/hitlist': () => import('../pages/Kill/HitlistPage'),
  '/kill/hitman': () => import('../pages/Kill/HitmanForHire'),
  '/organised-crime': () => import('../pages/Crime/OrganisedCrime'),
  '/crime/crimes': () => import('../pages/Crime/Crimes'),
  '/crime/gta': () => import('../pages/Crime/GTA'),
  '/crime/jail': () =>
    Promise.all([
      import('../pages/Crime/Jail'),
      prefetchJailPageData({ force: false }).catch(() => null),
    ]),
  '/social/image-host': () => import('../pages/Social/ImageHost'),
  '/social/inbox': () => import('../pages/Social/Inbox'),
  '/social/forum': () => import('../pages/Social/Forum'),
  '/game/store': () => import('../pages/Game/Store'),
  '/game/states': () => import('../pages/Game/States'),
  '/game/travel': () => import('../pages/Game/Travel').then(() => prefetchTravelPageData({ force: false })),
  '/game/ranking': () => import('../pages/Game/Ranking'),
  '/game/leaderboard': () => import('../pages/Game/Leaderboard'),
  '/game/family/list': () => import('../pages/Game/FamilyPage'),
  '/money/bank': () => import('../pages/Money/Bank'),
  '/money/racket': () => import('../pages/Money/IllegalBusiness'),
  '/money/distillery': () => import('../pages/Money/Distillery'),
  '/money/booze-run': () => import('../pages/Money/BoozeRun'),
  '/money/loot-box': () => import('../pages/Money/LootBox'),
  '/money/property': () => import('../pages/Money/Properties'),
  '/money/quick-trade': () => import('../pages/Money/QuickTrade'),
  '/money/lottery': () => import('../pages/Money/Lottery'),
  '/money/stocks': () => import('../pages/Money/StockMarket'),
  '/money/crack-safe': () => import('../pages/Money/CrackSafe'),
  '/money/grave-robber': () => import('../pages/Money/GraveRobber'),
  '/money/weed-empire': () => import('../pages/Money/WeedEmpire'),
  '/my-properties': () => import('../pages/Money/MyProperties'),
  '/tjjeujr3wa': () => import('../pages/StaffRole/AdminShell'),
  '/tjjeujr3wa/overview': () => import('../pages/StaffRole/AdminShell'),
  '/cars/garage': () => import('../pages/Cars/Garage'),
  '/cars/buy': () => import('../pages/Cars/BuyCars'),
  '/cars/sell': () => import('../pages/Cars/SellCars'),
  '/cars/view': () => import('../pages/Cars/ViewCar'),
  '/view-car': () => import('../pages/Cars/ViewCar'),
  '/game/stats': () => import('../pages/Game/Stats'),
  '/game/users-online': () =>
    Promise.all([
      import('../pages/Game/UsersOnline'),
      prefetchUsersOnlineData({ force: false }).catch(() => null),
    ]),
  '/game/help-desk': () => import('../pages/Game/HelpDesk'),
  '/game/guide': () => import('../pages/Game/GameGuideChat'),
  '/game/dead-alive': () => import('../pages/Game/DeadAlive'),
  '/game/daily-rewards': () => import('../pages/Game/DailyRewards'),
  '/game/entertainer': () => import('../pages/Game/EntertainerHub'),
  '/game/help-desk-hub': () => import('../pages/Game/HelpDeskHub'),
  '/game/ranking/badges': () => import('../pages/Game/RankingBadges'),
  '/kill/attemps': () => import('../pages/Kill/Attemps'),
  '/casino': () => import('../pages/Casinos/Casino'),
  '/casino/dice': () => import('../pages/Casinos/Dice'),
  '/casino/rlt': () => import('../pages/Casinos/Rlt'),
  '/casino/blackjack': () => import('../pages/Casinos/BlackjackPage'),
  '/casino/horseracing': () => import('../pages/Casinos/HorseRacingPage'),
  '/casino/keno': () => import('../pages/Casinos/KenoPage'),
  '/casino/coin-flip': () => import('../pages/Casinos/CoinFlipPage'),
  '/casino/videopoker': () => import('../pages/Casinos/VideoPokerPage'),
  '/casino/mdg': () => import('../pages/Casinos/MDGPage'),
  '/casino/mp-blackjack': () => import('../pages/Casinos/MPBlackjackPage'),
  '/casino/mp-poker': () => import('../pages/Casinos/MPPokerPage'),
  '/sports-betting': () => import('../pages/Casinos/SportsBetting'),
};

const started = new Set();
const debounceTimers = new Map();

function normalizePath(path) {
  if (!path || typeof path !== 'string') return '';
  const base = path.split('?')[0].replace(/\/+$/, '') || '/';
  return base;
}

/** @param {string} pathOrTo — pathname or react-router `to` string
 *  @param {{ force?: boolean }} [opts] — force=true retries after a failed/wake preload
 */
export function preloadRoute(pathOrTo, opts = {}) {
  const path = normalizePath(pathOrTo);
  if (!path) return;
  if (!opts.force && started.has(path)) return;
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
    /** Mobile: start chunk download before click navigation. */
    onPointerDown: () => preloadRoute(path),
    onTouchStart: () => preloadRoute(path),
  };
}
