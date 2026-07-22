/**
 * Per-page Sonner toast mutes (Edit Profile → Page toast alerts).
 * Keep page ids in sync with backend TOAST_MUTEABLE_PAGE_IDS.
 */

export const TOAST_MUTEABLE_PAGES = [
  { id: 'hitlist', label: 'Hitlist', match: (p) => p === '/kill/hitlist' || p.startsWith('/kill/hitlist/') },
  { id: 'attack', label: 'Attack', match: (p) => p === '/kill/attack' || p.startsWith('/kill/attack/') },
  {
    id: 'witness_statements',
    label: 'Witness statements',
    match: (p) => p === '/kill/witness-statements' || p.startsWith('/kill/witness-statements/'),
  },
  { id: 'attempts', label: 'Attempts', match: (p) => p === '/kill/attempts' || p.startsWith('/kill/attempts/') },
  { id: 'hitman', label: 'Hitman for Hire', match: (p) => p === '/kill/hitman' || p.startsWith('/kill/hitman/') },
  { id: 'bodyguards', label: 'Bodyguards', match: (p) => p === '/kill/bodyguards' || p.startsWith('/kill/bodyguards/') },
  {
    id: 'armoury',
    label: 'Armoury',
    match: (p) =>
      p === '/kill/armour-weapons' ||
      p.startsWith('/kill/armour-weapons/') ||
      p === '/kill/armour' ||
      p.startsWith('/kill/armour/'),
  },
  { id: 'crimes', label: 'Crimes', match: (p) => p === '/crime/crimes' || p.startsWith('/crime/crimes/') },
  { id: 'gta', label: 'GTA', match: (p) => p === '/crime/gta' || p.startsWith('/crime/gta/') },
  { id: 'jail', label: 'Jailbust', match: (p) => p === '/crime/jail' || p.startsWith('/crime/jail/') },
  {
    id: 'organised_crime',
    label: 'Organised Crime',
    match: (p) => p === '/organised-crime' || p.startsWith('/organised-crime/'),
  },
  {
    id: 'booze_run',
    label: 'Booze Run',
    match: (p) => p === '/money/booze-run' || p.startsWith('/money/booze-run/') || p === '/booze-run' || p.startsWith('/booze-run/'),
  },
  { id: 'store', label: 'Store', match: (p) => p === '/game/store' || p.startsWith('/game/store/') },
  {
    id: 'properties',
    label: 'Properties',
    match: (p) =>
      p === '/money/property' ||
      p.startsWith('/money/property/') ||
      p === '/my-properties' ||
      p.startsWith('/my-properties/'),
  },
  {
    id: 'quick_trade',
    label: 'Quick Trade',
    match: (p) => p === '/money/quick-trade' || p.startsWith('/money/quick-trade/'),
  },
];

const ALLOWED_IDS = new Set(TOAST_MUTEABLE_PAGES.map((p) => p.id));

let _muted = new Set();

export function normalizeToastMutedPages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const x of raw) {
    const k = String(x || '').trim().toLowerCase();
    if (ALLOWED_IDS.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

export function setToastMutedPages(ids) {
  _muted = new Set(normalizeToastMutedPages(ids));
}

export function getToastMutedPages() {
  return Array.from(_muted);
}

export function pageIdForPath(pathname) {
  const p = String(pathname || '').replace(/\/+/g, '/') || '/';
  for (const page of TOAST_MUTEABLE_PAGES) {
    if (page.match(p)) return page.id;
  }
  return null;
}

export function isPathToastMuted(pathname) {
  const id = pageIdForPath(pathname);
  return !!(id && _muted.has(id));
}

export function isCurrentPageToastMuted() {
  if (typeof window === 'undefined') return false;
  return isPathToastMuted(window.location?.pathname || '');
}
