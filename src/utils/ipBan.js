const IP_BAN_DETAIL = 'Your IP has been banned from this server.';

function detailLooksLikeIpBan(detail) {
  if (typeof detail === 'string') {
    return /IP has been banned|banned from this server/i.test(detail);
  }
  if (detail && typeof detail === 'object') {
    if (detail.code === 'ip_banned') return true;
    const inner = typeof detail.detail === 'string' ? detail.detail : '';
    return /IP has been banned|banned from this server/i.test(inner);
  }
  return false;
}

/**
 * Parse a 403 axios error into a public IP-ban payload, or null.
 * Accepts middleware `{ detail, code, reason }` and FastAPI `{ detail: { detail, code, reason } }`.
 */
export function parseIpBanFromError(error) {
  if (!error || error.response?.status !== 403) return null;
  const data = error.response?.data;
  if (!data || typeof data !== 'object') return null;

  const nested = data.detail && typeof data.detail === 'object' && !Array.isArray(data.detail)
    ? data.detail
    : null;
  const code = data.code || nested?.code;
  const reasonRaw = data.reason || nested?.reason;
  const expiresAt = data.expires_at || nested?.expires_at || null;
  const detailStr =
    typeof data.detail === 'string'
      ? data.detail
      : typeof nested?.detail === 'string'
        ? nested.detail
        : '';

  if (code !== 'ip_banned' && !detailLooksLikeIpBan(data.detail) && !detailLooksLikeIpBan(detailStr)) {
    return null;
  }

  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';
  return {
    detail: detailStr || IP_BAN_DETAIL,
    reason: reason || '',
    expires_at: expiresAt || null,
  };
}

export function isIpBanError(error) {
  return parseIpBanFromError(error) != null;
}
