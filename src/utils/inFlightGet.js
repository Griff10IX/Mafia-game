/**
 * Coalesce concurrent identical GET requests (same path + params + session) into one in-flight promise.
 */
const inFlight = new Map();

function sessionToken() {
  try {
    return localStorage.getItem('token') || '';
  } catch {
    return '';
  }
}

function requestKey(path, config) {
  const params = config?.params;
  let paramPart = '';
  if (params && typeof params === 'object') {
    const sorted = Object.keys(params)
      .sort()
      .map((k) => `${k}=${String(params[k])}`)
      .join('&');
    paramPart = sorted ? `?${sorted}` : '';
  }
  return `${sessionToken()}|${path}${paramPart}`;
}

/**
 * @param {Function} rawGet — axios instance .get bound (must not re-enter dedupe wrapper)
 * @param {string} path
 * @param {object} [config] axios get config
 */
export function inFlightGet(rawGet, path, config) {
  const key = requestKey(path, config);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = rawGet(path, config).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function clearInFlightGets() {
  inFlight.clear();
}
