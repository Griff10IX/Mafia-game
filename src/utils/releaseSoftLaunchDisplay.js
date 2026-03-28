/**
 * Shared UK + UTC display for release unlock ISO strings (Game Pass / points / PvP schedule).
 * @param {string|undefined|null} iso
 * @returns {{ line: string } | null}
 */
export function formatReleaseUnlockLine(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { line: String(iso) };
  }
  const uk = d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
    timeZoneName: 'short',
  });
  const utc = d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  return { line: `${uk} (${utc})` };
}
