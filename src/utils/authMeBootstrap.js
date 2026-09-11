/**
 * PERF #4: Shared GET /auth/me bootstrap.
 * Coalesces the login/layout/dashboard stampede into one in-flight request
 * and a short fresh cache so duplicate callers reuse the same response.
 * See docs/PERF_OPS_CHANGES.md
 */
import { apiGetWithResumeRetries } from './api';

/** Reuse a successful /auth/me for this long (ms) across Layout + prefetch + pages. */
const AUTH_ME_FRESH_MS = 2500;

let _inflight = null;
let _cache = null; // { at: number, response: AxiosResponse }

/**
 * @param {{ force?: boolean }} [options] force=true skips the short TTL cache (still shares in-flight).
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export function fetchAuthMe(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && _cache && now - _cache.at < AUTH_ME_FRESH_MS) {
    return Promise.resolve(_cache.response);
  }
  if (_inflight) return _inflight;
  _inflight = apiGetWithResumeRetries('/auth/me')
    .then((res) => {
      _cache = { at: Date.now(), response: res };
      return res;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

export function invalidateAuthMeBootstrap() {
  _cache = null;
  _inflight = null;
}

/** Test helpers */
export function _authMeBootstrapTestState() {
  return {
    hasInflight: Boolean(_inflight),
    hasCache: Boolean(_cache),
    cacheAgeMs: _cache ? Date.now() - _cache.at : null,
    freshMs: AUTH_ME_FRESH_MS,
  };
}
