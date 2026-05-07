/** Staff portal JWT for X-Staff-Portal-Token (backend STAFF_PORTAL_PASSWORD). Prefers sessionStorage; falls back to localStorage when sessionStorage is unavailable (e.g. some iOS Private modes). */

const KEY = 'staff_portal_token';

function _ssGet() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(KEY) : null;
  } catch {
    return null;
  }
}

function _lsGet() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  } catch {
    return null;
  }
}

export function getStaffPortalToken() {
  if (typeof window === 'undefined') return '';
  return (_ssGet() || _lsGet() || '').trim();
}

export function setStaffPortalToken(token) {
  if (typeof window === 'undefined') return;
  const v = token ? String(token).trim() : '';
  if (!v) {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    sessionStorage.setItem(KEY, v);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  } catch {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
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
