const CRIMES_PREFETCH_MAX_AGE_MS = 30000;
const PROFILE_PREFETCH_MAX_AGE_MS = 60000;
const FAMILIES_PREFETCH_MAX_AGE_MS = 30000;
const FAMILY_PROFILE_PREFETCH_MAX_AGE_MS = 30000;

let crimesPrefetch = null;
let profilePrefetch = {};
let familiesPrefetch = null;
let familyProfilePrefetch = {};

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

export function getFamiliesPrefetch() {
  if (!familiesPrefetch?.data) return null;
  const age = Date.now() - (familiesPrefetch.timestamp || 0);
  if (age > FAMILIES_PREFETCH_MAX_AGE_MS) {
    familiesPrefetch = null;
    return null;
  }
  return familiesPrefetch.data;
}

export function setFamiliesPrefetch(data) {
  if (!data) return;
  familiesPrefetch = { data, timestamp: Date.now() };
}

export function clearFamiliesPrefetch() {
  familiesPrefetch = null;
}

export function getFamilyProfilePrefetch(familyIdOrTag) {
  const key = String(familyIdOrTag || '').trim().toLowerCase();
  if (!key) return null;
  const row = familyProfilePrefetch[key];
  if (!row?.data) return null;
  const age = Date.now() - (row.timestamp || 0);
  if (age > FAMILY_PROFILE_PREFETCH_MAX_AGE_MS) {
    delete familyProfilePrefetch[key];
    return null;
  }
  return row.data;
}

export function setFamilyProfilePrefetch(familyIdOrTag, data) {
  const key = String(familyIdOrTag || '').trim().toLowerCase();
  if (!key || !data) return;
  familyProfilePrefetch[key] = { data, timestamp: Date.now() };
}

export function clearFamilyProfilePrefetch(familyIdOrTag) {
  const key = String(familyIdOrTag || '').trim().toLowerCase();
  if (!key) return;
  delete familyProfilePrefetch[key];
}
