/**
 * Coalesce concurrent identical GET requests (same path + params) into one in-flight promise.
 */
const inFlight = new Map();

function requestKey(path, config) {
  const params = config?.params;
  if (!params || typeof params !== 'object') return path;
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('&');
  return sorted ? `${path}?${sorted}` : path;
}

/**
 * @param {import('axios').AxiosInstance} api
 * @param {string} path
 * @param {object} [config] axios get config
 */
export function inFlightGet(api, path, config) {
  const key = requestKey(path, config);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = api.get(path, config).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
