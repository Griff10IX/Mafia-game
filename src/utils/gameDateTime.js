/** Display timestamps in UK (Europe/London); DB and APIs remain UTC. */

export const GAME_TZ = 'Europe/London';
export const GAME_LOCALE = 'en-GB';

const DEFAULT_DISPLAY = {
  timeZone: GAME_TZ,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

/**
 * @param {string|number|Date|null|undefined} iso
 * @param {Intl.DateTimeFormatOptions} [options] merged over defaults (timeZone stays London unless overridden)
 */
export function formatGameDateTime(iso, options) {
  if (iso == null || iso === '') return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return typeof iso === 'string' ? iso : '—';
  return d.toLocaleString(GAME_LOCALE, { ...DEFAULT_DISPLAY, ...options });
}

/** Short date + time (no seconds) for compact UI. */
export function formatGameDateTimeShort(iso) {
  if (iso == null || iso === '') return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return typeof iso === 'string' ? iso : '—';
  return d.toLocaleString(GAME_LOCALE, {
    timeZone: GAME_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Weekday + time (12h), e.g. death screen. */
export function formatGameTimeWeekday(iso) {
  if (iso == null || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(GAME_LOCALE, {
    timeZone: GAME_TZ,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** Calendar date only (no time). */
export function formatGameDateOnly(iso) {
  if (iso == null || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(GAME_LOCALE, {
    timeZone: GAME_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Staff attack logs: London wall time + milliseconds. */
export function formatGameDateTimeWithMilliseconds(iso) {
  if (iso == null || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const ms = d.getMilliseconds();
  const base = d.toLocaleString(GAME_LOCALE, {
    timeZone: GAME_TZ,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${base}.${String(ms).padStart(3, '0')}`;
}
