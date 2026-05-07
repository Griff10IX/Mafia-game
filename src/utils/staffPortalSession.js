/** Session-bound staff portal JWT (second factor for /api/.../admin/... when server sets STAFF_PORTAL_PASSWORD). */

const KEY = 'staff_portal_token';

export function getStaffPortalToken() {
  try {
    if (typeof sessionStorage === 'undefined') return '';
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function setStaffPortalToken(token) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (token) sessionStorage.setItem(KEY, String(token));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function clearStaffPortalToken() {
  setStaffPortalToken('');
}

function _jwtExpMs(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (b64.length % 4)) % 4;
    const padded = b64 + '='.repeat(pad);
    const json = JSON.parse(atob(padded));
    const exp = json.exp;
    if (typeof exp !== 'number') return null;
    return exp * 1000;
  } catch {
    return null;
  }
}

/** True if token exists and is not past exp (small client skew). Server always verifies. */
export function isStaffPortalTokenValid(token) {
  const t = token || getStaffPortalToken();
  if (!t) return false;
  const exp = _jwtExpMs(t);
  if (!exp) return false;
  return Date.now() < exp - 5000;
}
