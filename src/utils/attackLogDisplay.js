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
  if (row.integrity_violation === 'execute_token') {
    const reason = String(row.token_failure_reason || 'execute_token_invalid').replace(/_/g, ' ');
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
  if (v) {
    return {
      text: String(v).replace(/_/g, ' '),
      className: 'text-amber-400 font-medium',
      title: String(v),
    };
  }
  return { text: '—', className: 'text-mutedForeground', title: '' };
}
