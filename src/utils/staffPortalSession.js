/** Staff portal JWT (X-Staff-Portal-Token) + stable device id (X-Staff-Portal-Device-Id) bound in JWT on server. */

const KEY = 'staff_portal_token';
const DEVICE_KEY = 'staff_portal_device_id';

/** In-memory copy when storage is unavailable (same tab only). */
let _portalTokenMem = '';

function _mobileUa() {
  try {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
}

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
  const mobile = _mobileUa();
  if (mobile) {
    return (_ssGet() || _portalTokenMem || '').trim();
  }
  return (_ssGet() || _lsGet() || _portalTokenMem || '').trim();
}

export function setStaffPortalToken(token) {
  if (typeof window === 'undefined') return;
  const v = token ? String(token).trim() : '';
  _portalTokenMem = v;
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
  const mobile = _mobileUa();
  if (mobile) {
    try {
      sessionStorage.setItem(KEY, v);
    } catch {
      /* memory only */
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
      /* memory only */
    }
  }
}

export function clearStaffPortalToken() {
  _portalTokenMem = '';
  setStaffPortalToken('');
}

/** Opaque id sent with unlock + every admin request; stored per browser profile (desktop) or session (mobile). */
export function getOrCreateStaffPortalDeviceId() {
  if (typeof window === 'undefined') return '';
  const mobile = _mobileUa();
  const read = () => {
    try {
      if (mobile) return sessionStorage.getItem(DEVICE_KEY);
      return localStorage.getItem(DEVICE_KEY);
    } catch {
      return null;
    }
  };
  let id = (read() || '').trim();
  if (id.length >= 8 && id.length <= 80) return id.slice(0, 80);
  try {
    id = (globalThis.crypto?.randomUUID?.() || `sp${Date.now()}-${Math.random().toString(36).slice(2, 14)}`).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
  } catch {
    id = `sp${Date.now()}-${Math.random().toString(36).slice(2, 14)}`.slice(0, 80);
  }
  if (id.length < 8) {
    id = `${id}xxxxxxxx`.slice(0, 16);
  }
  try {
    if (mobile) sessionStorage.setItem(DEVICE_KEY, id);
    else localStorage.setItem(DEVICE_KEY, id);
  } catch {
    try {
      if (!mobile) sessionStorage.setItem(DEVICE_KEY, id);
    } catch {
      /* ignore */
    }
  }
  return id.slice(0, 80);
}

export function clearStaffPortalDeviceId() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(DEVICE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* ignore */
  }
}

/** Logout / full sign-out: drop portal token and device binding so another account or machine is clean. */
export function clearStaffPortalSession() {
  clearStaffPortalToken();
  clearStaffPortalDeviceId();
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
