/**
 * Human-readable remaining time for civilian protection badges.
 * Examples: "1 day 2 hrs", "12 hrs 47 mins", "3 mins 12 secs", "47 secs"
 */
export function formatProtectionRemaining(endsAtIso, nowMs = Date.now()) {
  if (!endsAtIso) return '';
  const end = new Date(endsAtIso).getTime();
  if (!Number.isFinite(end)) return '';
  const ms = Math.max(0, end - nowMs);
  const totalSec = Math.floor(ms / 1000);
  if (totalSec <= 0) return 'ended';

  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (days > 0) {
    const dayPart = `${days} day${days === 1 ? '' : 's'}`;
    return hours > 0 ? `${dayPart} ${hours} hrs` : dayPart;
  }
  if (hours > 0) {
    // Prefer mins; when under an hour of residual, surface seconds like "12 hrs 47 secs".
    if (mins > 0) return `${hours} hrs ${mins} mins`;
    if (secs > 0) return `${hours} hrs ${secs} secs`;
    return `${hours} hrs`;
  }
  if (mins > 0) {
    return secs > 0 ? `${mins} mins ${secs} secs` : `${mins} mins`;
  }
  return `${secs} secs`;
}

export function protectionRemainingMs(endsAtIso, nowMs = Date.now()) {
  if (!endsAtIso) return 0;
  const end = new Date(endsAtIso).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, end - nowMs);
}
