export const GAME_CHAT_VISIBLE_KEY = 'game_chat_visible';
export const GAME_CHAT_VISIBILITY_EVENT = 'game-chat-visibility-changed';

export function getGameChatVisible() {
  try {
    return localStorage.getItem(GAME_CHAT_VISIBLE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setGameChatVisible(visible) {
  const next = visible !== false;
  try {
    localStorage.setItem(GAME_CHAT_VISIBLE_KEY, next ? 'true' : 'false');
  } catch (_) {}
  window.dispatchEvent(new Event(GAME_CHAT_VISIBILITY_EVENT));
  return next;
}
