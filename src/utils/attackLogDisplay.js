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
