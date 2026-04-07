const CRIMES_PREFETCH_MAX_AGE_MS = 30000;
const PROFILE_PREFETCH_MAX_AGE_MS = 60000;

let crimesPrefetch = null;
let profilePrefetch = {};

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

export function getProfilePrefetch(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return null;
  const row = profilePrefetch[key];
  if (!row?.data) return null;
  const age = Date.now() - (row.timestamp || 0);
  if (age > PROFILE_PREFETCH_MAX_AGE_MS) {
    delete profilePrefetch[key];
    return null;
  }
  return row.data;
}

export function setProfilePrefetch(username, data) {
  const key = String(username || '').trim().toLowerCase();
  if (!key || !data) return;
  profilePrefetch[key] = { data, timestamp: Date.now() };
}

export function clearProfilePrefetch(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return;
  delete profilePrefetch[key];
}
