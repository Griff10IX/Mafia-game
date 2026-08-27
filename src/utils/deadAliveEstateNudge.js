/** Session flag: check Dead > Alive unclaimed estate once after this login, not on every refresh. */
const PENDING_KEY = 'da_estate_nudge_pending';

export function markDeadAliveEstateNudgePending() {
  try {
    sessionStorage.setItem(PENDING_KEY, '1');
  } catch (_) { /* ignore */ }
}

export function isDeadAliveEstateNudgePending() {
  try {
    return sessionStorage.getItem(PENDING_KEY) === '1';
  } catch (_) {
    return false;
  }
}

export function clearDeadAliveEstateNudgePending() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch (_) { /* ignore */ }
}
