const CRIMES_PREFETCH_MAX_AGE_MS = 30000;

let crimesPrefetch = null;

export function getCrimesPrefetch() {
  if (!crimesPrefetch?.data) return null;
  const age = Date.now() - (crimesPrefetch.timestamp || 0);
  if (age > CRIMES_PREFETCH_MAX_AGE_MS) {
    crimesPrefetch = null;
    return null;
  }
  return crimesPrefetch.data;
}

export function setCrimesPrefetch(data) {
  crimesPrefetch = { data, timestamp: Date.now() };
}

export function clearCrimesPrefetch() {
  crimesPrefetch = null;
}
