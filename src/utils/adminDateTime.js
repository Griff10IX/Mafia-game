/**
 * Admin/staff UI timestamps: UK local time (GMT in winter, BST in summer).
 * Uses IANA zone Europe/London so DST is applied correctly.
 */
export const ADMIN_TIME_ZONE = 'Europe/London';

const TZ = { timeZone: ADMIN_TIME_ZONE, hour12: false };

/**
 * @param {string|number|Date|null|undefined} iso
 * @param {{ empty?: string }} [opts]
 */
export function formatAdminDateTime(iso, opts = {}) {
  const empty = opts.empty !== undefined ? opts.empty : '—';
  if (iso == null || iso === '') return empty;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', {
    ...TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatAdminDateOnly(iso, empty = '—') {
  if (iso == null || iso === '') return empty;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', {
    ...TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatAdminTimeOnly(iso, empty = '—') {
  if (iso == null || iso === '') return empty;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString('en-GB', {
    ...TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
