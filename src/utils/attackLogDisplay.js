export function formatAttackLogTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const ms = d.getMilliseconds();
  return d.toLocaleString() + '.' + String(ms).padStart(3, '0');
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

/** Staff attack logs: tiered client signal from API + legacy rows (UA hints only). */
export function formatAttackLogBotCell(row) {
  if (!row || typeof row !== 'object') {
    return { text: '—', className: 'text-mutedForeground', title: '' };
  }
  if (row.execute_token_fail === true) {
    return {
      text: 'Token fail',
      className: 'text-red-400 font-semibold',
      title: 'Missing or invalid attack session token; staff were notified (possible bot)',
    };
  }
  const { bot: uaBot } = parseAttackLogUA(row.user_agent || '');
  const sig = row.attacker_client_signal;
  if (sig === 'automation' || sig === 'script') {
    const label = row.attacker_bot_label ? `Yes · ${row.attacker_bot_label}` : 'Yes';
    return { text: label, className: 'text-amber-400 font-medium', title: label };
  }
  if (sig === 'suspicious') {
    const detail = (row.attacker_client_signal_detail || '').replace(/_/g, ' ');
    const title = detail ? `Suspicious — ${detail}` : 'Weak browser fingerprint (not a confirmed bot)';
    return { text: 'Suspicious', className: 'text-amber-500 font-medium', title };
  }
  if (sig === 'browser') {
    return { text: 'No', className: 'text-mutedForeground', title: '' };
  }
  if (row.attacker_is_bot === true) {
    const label = row.attacker_bot_label ? `Yes · ${row.attacker_bot_label}` : 'Yes';
    return { text: label, className: 'text-amber-400 font-medium', title: label };
  }
  if (row.attacker_is_bot === false) {
    return { text: 'No', className: 'text-mutedForeground', title: '' };
  }
  if (uaBot) {
    return { text: uaBot, className: 'text-amber-400 font-medium', title: `UA hint only: ${uaBot}` };
  }
  return { text: '—', className: 'text-mutedForeground', title: '' };
}
