import { ADMIN_TIME_ZONE } from './adminDateTime';

export function formatAttackLogTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const ms = d.getMilliseconds();
  const base = d.toLocaleString('en-GB', {
    timeZone: ADMIN_TIME_ZONE,
    hour12: false,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${base}.${String(ms).padStart(3, '0')}`;
}

export function parseAttackLogUA(ua) {
  if (!ua || typeof ua !== 'string') return { device: '—', bot: null };
  const s = ua.toLowerCase();
  let bot = null;
  if (/\b(bot|crawler|spider|scraper)\b/i.test(ua)) bot = 'Bot';
  else if (/python|requests|urllib|aiohttp/i.test(ua)) bot = 'Python';
  else if (/selenium|webdriver|headless/i.test(ua)) bot = 'Selenium';
  else if (/curl|wget|libwww|axios\//i.test(ua)) bot = 'curl/wget';
  else if (/postman|insomnia/i.test(ua)) bot = 'API client';
  let device = 'PC';
  if (/ipad|tablet(?!.*mobile)/i.test(ua) || (s.includes('tablet') && !s.includes('mobile'))) device = 'Tablet';
  else if (/iphone|ipod/i.test(ua)) device = 'iPhone';
  else if (/android/i.test(ua)) device = /mobile/i.test(ua) && !/tablet/i.test(ua) ? 'Android' : 'Android (tablet)';
  else if (/mobile|opera mini|blackberry|windows phone/i.test(ua)) device = 'Mobile';
  return { device, bot };
}

/** Long tooltip for staff: why automation/script/suspicious/browser was classified (and soft risk). */
export function formatAttackLogBotRationale(row) {
  if (!row || typeof row !== 'object') return '';
  const parts = [];
  const sig = row.attacker_client_signal;
  if (sig) parts.push(`Client signal: ${sig}`);
  if (row.integrity_violation === 'execute_token' || row.integrity_violation === 'search_code') {
    const reason = String(
      row.token_failure_reason
        || (row.integrity_violation === 'search_code' ? 'search_code_invalid' : 'execute_token_invalid')
    ).replace(/_/g, ' ');
    parts.push(`Integrity signal: ${reason}`);
  }
  const det = String(row.attacker_client_signal_detail || '').replace(/_/g, ' ').trim();
  if (det) parts.push(`Signal detail: ${det}`);
  if (row.attacker_bot_label) parts.push(`Bot label: ${row.attacker_bot_label}`);
  if (Array.isArray(row.client_anomaly_flags) && row.client_anomaly_flags.length > 0) {
    parts.push(`Anomaly flags: ${row.client_anomaly_flags.join(', ')}`);
  }
  if (row.client_risk_score != null && row.client_risk_score !== '') {
    const n = Number(row.client_risk_score);
    if (!Number.isNaN(n)) parts.push(`Client risk (soft): ${n}`);
  }
  const { bot: uaBot } = parseAttackLogUA(row.user_agent || '');
  if (uaBot && sig !== 'automation' && sig !== 'script') {
    parts.push(`UA substring hint (not tiered signal): ${uaBot}`);
  }
  if (row.attacker_is_bot === true && sig !== 'automation' && sig !== 'script') {
    parts.push('Legacy field: attacker_is_bot true');
  }
  return parts.join(' · ');
}

/** Staff attack logs: tiered client signal from API + legacy rows (UA hints only). */
export function formatAttackLogBotCell(row) {
  if (!row || typeof row !== 'object') {
    return { text: '—', className: 'text-mutedForeground', title: '' };
  }
  const rationale = formatAttackLogBotRationale(row);
  const pickTitle = (short) => (rationale && rationale.length > 0 ? rationale : short || '');
  const { bot: uaBot } = parseAttackLogUA(row.user_agent || '');
  const sig = row.attacker_client_signal;
  if (sig === 'automation' || sig === 'script') {
    const label = row.attacker_bot_label ? `Yes · ${row.attacker_bot_label}` : 'Yes';
    return { text: label, className: 'text-amber-400 font-medium', title: pickTitle(label) };
  }
  if (sig === 'suspicious') {
    const detail = (row.attacker_client_signal_detail || '').replace(/_/g, ' ');
    const short = detail ? `Suspicious — ${detail}` : 'Weak browser fingerprint (not a confirmed bot)';
    return { text: 'Suspicious', className: 'text-amber-500 font-medium', title: pickTitle(short) };
  }
  if (row.integrity_violation === 'execute_token') {
    return {
      text: 'Suspicious',
      className: 'text-amber-500 font-medium',
      title: pickTitle('Attack execute failed the server-issued session token check'),
    };
  }
  if (row.integrity_violation === 'search_code') {
    return {
      text: 'Suspicious',
      className: 'text-amber-500 font-medium',
      title: pickTitle('Attack search failed the server-issued hidden search code check'),
    };
  }
  if (sig === 'browser') {
    return { text: 'No', className: 'text-mutedForeground', title: pickTitle('Classified as normal browser request') };
  }
  if (row.attacker_is_bot === true) {
    const label = row.attacker_bot_label ? `Yes · ${row.attacker_bot_label}` : 'Yes';
    return { text: label, className: 'text-amber-400 font-medium', title: pickTitle(label) };
  }
  if (row.attacker_is_bot === false) {
    return { text: 'No', className: 'text-mutedForeground', title: pickTitle('Classified as human (legacy flag)') };
  }
  if (uaBot) {
    const short = `UA hint only: ${uaBot}`;
    return { text: uaBot, className: 'text-amber-400 font-medium', title: pickTitle(short) };
  }
  return { text: '—', className: 'text-mutedForeground', title: pickTitle('') };
}

/** Staff: anti-bot / integrity flags stored on attack_attempts (e.g. execute_token mismatch). */
export function formatAttackLogIntegrityCell(row) {
  if (!row || typeof row !== 'object') {
    return { text: '—', className: 'text-mutedForeground', title: '' };
  }
  const v = row.integrity_violation;
  if (v === 'execute_token') {
    const reason = String(row.token_failure_reason || '').replace(/_/g, ' ');
    return {
      text: 'Token fail',
      className: 'text-red-400 font-bold',
      title: reason
        ? `POST /attack/execute failed session token check: ${reason}. Staff were notified (throttled).`
        : 'POST /attack/execute without valid session token (anti-bot). Staff were notified (throttled).',
    };
  }
  if (v === 'search_code') {
    const reason = String(row.token_failure_reason || '').replace(/_/g, ' ');
    return {
      text: 'Search code fail',
      className: 'text-red-400 font-bold',
      title: reason
        ? `POST /attack/search failed hidden search code check: ${reason}. Staff were notified (throttled).`
        : 'POST /attack/search without valid hidden search code (anti-bot). Staff were notified (throttled).',
    };
  }
  if (v) {
    return {
      text: String(v).replace(/_/g, ' '),
      className: 'text-amber-400 font-medium',
      title: String(v),
    };
  }
  return { text: '—', className: 'text-mutedForeground', title: '' };
}

/** Blocking guard username for outcome=bodyguard (enriched API or legacy first_bodyguard). */
export function formatBlockingBodyguard(row) {
  if (!row || typeof row !== 'object') return '—';
  const top = (row.blocking_bodyguard_username || '').trim();
  if (top) return top;
  const fb = row.first_bodyguard;
  if (fb && typeof fb === 'object') {
    const u = (fb.search_username || fb.display_name || '').trim();
    if (u) return u;
  }
  return '—';
}

/** Hire API / legacy rows may store slot as number, string, or { slot, is_robot, cost, name }. */
export function normalizeBodyguardSlotValue(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    const n = parseInt(t, 10);
    return Number.isNaN(n) ? t : n;
  }
  if (typeof raw === 'object') {
    if (raw.slot != null) return normalizeBodyguardSlotValue(raw.slot);
    if (raw.slot_number != null) return normalizeBodyguardSlotValue(raw.slot_number);
  }
  return null;
}

/** Safe string for UI (never returns a raw hire payload object). */
export function formatSlotDisplay(raw) {
  const slot = normalizeBodyguardSlotValue(raw);
  if (slot == null) return '';
  return String(slot);
}

/** activity_log.details / legacy blobs from bodyguard hire. */
export function formatBodyguardHireDetail(details) {
  if (details == null || details === '') return '';
  if (typeof details === 'string') return details;
  if (typeof details !== 'object') return String(details);
  const slot = normalizeBodyguardSlotValue(details);
  const parts = [];
  if (slot != null) parts.push(`slot ${slot}`);
  if (details.is_robot === true) parts.push('robot');
  else if (details.is_robot === false) parts.push('human');
  if (details.name) parts.push(String(details.name));
  if (details.cost != null && details.cost !== '') {
    const c = Number(details.cost);
    parts.push(`${Number.isNaN(c) ? details.cost : c.toLocaleString()} pts`);
  }
  return parts.length ? parts.join(' · ') : '';
}

export function formatBodyguardSlot(row) {
  if (!row || typeof row !== 'object') return '—';
  const fb = row.first_bodyguard;
  const slot =
    normalizeBodyguardSlotValue(row.bodyguard_slot) ??
    normalizeBodyguardSlotValue(fb?.slot_number) ??
    normalizeBodyguardSlotValue(fb?.slot);
  if (slot == null) return '—';
  return String(slot);
}

/** Protectee on block rows; guard owner on bodyguard kill rows. */
export function formatAttackLogProtecteeOrOwner(row) {
  if (!row || typeof row !== 'object') return '—';
  if (row.outcome === 'bodyguard') {
    return (row.protected_username || row.target_username || '—').trim() || '—';
  }
  if (row.is_bodyguard_kill && row.bodyguard_owner_username) {
    return row.bodyguard_owner_username;
  }
  return '—';
}

export function formatBodyguardBlockSummary(row) {
  if (!row || typeof row !== 'object' || row.outcome !== 'bodyguard') return '';
  const protectee = row.protected_username || row.target_username || '?';
  const guard = formatBlockingBodyguard(row);
  const slot = formatBodyguardSlot(row);
  const attacker = row.attacker_username || '?';
  const parts = [`${attacker} blocked by ${guard} protecting ${protectee}`];
  if (slot !== '—') parts.push(`slot ${slot}`);
  return parts.join(' · ');
}

export function formatAttackLogBodyguardCell(row) {
  if (!row || typeof row !== 'object') {
    return { text: '—', className: 'text-mutedForeground', title: '' };
  }
  if (row.is_bodyguard_kill) {
    return { text: 'Killed', className: 'text-red-400 font-medium', title: 'Victim was a bodyguard NPC/player' };
  }
  if (row.outcome === 'bodyguard') {
    return {
      text: 'Blocked',
      className: 'text-amber-500 font-medium',
      title: formatBodyguardBlockSummary(row) || 'Attack stopped by bodyguard',
    };
  }
  return { text: '—', className: 'text-mutedForeground', title: '' };
}

/** Stable key for collapsing repeated attack rows (same attacker/target/outcome/guard). */
export function attackLogEncounterKey(row) {
  if (!row || typeof row !== 'object') return '';
  const guard = formatBlockingBodyguard(row);
  const protectee = formatAttackLogProtecteeOrOwner(row);
  return [
    row.attacker_username ?? '',
    row.target_username ?? '',
    row.outcome ?? '',
    guard !== '—' ? guard : '',
    protectee !== '—' ? protectee : '',
  ].join('\0');
}

/** Collapse duplicate log rows; newest row in each group is representative. */
export function groupAttackLogsByEncounter(logs) {
  const order = [];
  const map = new Map();
  for (const row of logs || []) {
    const key = attackLogEncounterKey(row);
    let group = map.get(key);
    if (!group) {
      group = { key, rows: [] };
      map.set(key, group);
      order.push(key);
    }
    group.rows.push(row);
  }
  return order.map((key) => {
    const group = map.get(key);
    const sorted = [...group.rows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return {
      key,
      rows: sorted,
      count: sorted.length,
      representative: sorted[0],
      first_at: sorted[sorted.length - 1]?.created_at ?? null,
      last_at: sorted[0]?.created_at ?? null,
    };
  });
}
