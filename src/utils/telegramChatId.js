/** Telegram numeric chat id (user or group). Rejects @username / handles. */
export function isValidTelegramChatId(value) {
  const s = String(value || '').trim();
  return /^-?[1-9]\d{0,19}$/.test(s);
}
