/**
 * Background warm for Jail: same GET + session key as `pages/Crime/Jail.js`.
 */
import api, { apiRequestWith429Retry } from './api';

export const JAIL_BOOTSTRAP_CACHE_KEY = 'jail_bootstrap_cache_v1';
export const JAIL_BOOTSTRAP_CACHE_MAX_AGE_MS = 30 * 1000;

let lastWarmAt = 0;
let inFlight = null;
/** In-memory boot shared with Jail page so revisits paint instantly. */
let _memJailBoot = null;

export function readJailBootstrap() {
  if (_memJailBoot) return _memJailBoot;
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(JAIL_BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data) return null;
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > JAIL_BOOTSTRAP_CACHE_MAX_AGE_MS) {
      return null;
    }
    _memJailBoot = parsed.data;
    return parsed.data;
  } catch (_e) {
    return null;
  }
}

export function writeJailBootstrap(data) {
  if (!data) return;
  _memJailBoot = data;
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(
      JAIL_BOOTSTRAP_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), data }),
    );
  } catch (_e) {
    /* storage disabled/quota is non-fatal */
  }
}

export function secondsRemainingFromJailUntil(jailUntil) {
  if (!jailUntil) return 0;
  const t = new Date(jailUntil).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

/** Seed status from auth `/auth/me` when bootstrap cache is cold. */
export function jailStatusFromAuthUser(user) {
  if (!user || !user.in_jail) return { in_jail: false };
  return {
    in_jail: true,
    jail_until: user.jail_until || null,
    seconds_remaining: secondsRemainingFromJailUntil(user.jail_until),
  };
}

/**
 * @param {{ force?: boolean }} [options]
 */
export async function prefetchJailPageData(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && now - lastWarmAt < 15_000) {
    return readJailBootstrap();
  }
  if (inFlight) return inFlight;
  lastWarmAt = now;
  inFlight = (async () => {
    try {
      const bootRes = await apiRequestWith429Retry(() => api.get('/jail/bootstrap'));
      const boot = bootRes?.data || {};
      writeJailBootstrap(boot);
      return boot;
    } catch {
      return readJailBootstrap();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
