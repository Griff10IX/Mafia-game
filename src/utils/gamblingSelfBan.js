/** Client helpers for gambling_self_ban_until from /auth/me. */

export function parseGamblingSelfBanUntil(user) {
  const raw = user?.gambling_self_ban_until;
  if (!raw) return null;
  try {
    const dt = new Date(String(raw).replace('Z', '+00:00'));
    return Number.isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}

export function isGamblingSelfBanned(user, now = new Date()) {
  const until = parseGamblingSelfBanUntil(user);
  if (!until) return false;
  return now.getTime() < until.getTime();
}

export function gamblingSelfBanRemainingSeconds(user, now = new Date()) {
  const until = parseGamblingSelfBanUntil(user);
  if (!until) return 0;
  return Math.max(0, Math.floor((until.getTime() - now.getTime()) / 1000));
}

export function formatGamblingSelfBanRemaining(user, now = new Date()) {
  const remaining = gamblingSelfBanRemainingSeconds(user, now);
  if (remaining <= 0) return null;
  const hours = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
}
