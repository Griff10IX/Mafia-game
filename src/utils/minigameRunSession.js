import api from './api';

/**
 * Start a server-timed minigame run. Submit endpoints require session_id from the response.
 * @param {string} game - snake | family_run | the_getaway | minesweeper | battleships | whack_a_copper | mafia_rpg | shooting_range
 * @returns {{ session_id: string, plays_left?: number, max_plays?: number, resets_at?: string }}
 */
export async function startMinigameRun(game) {
  const r = await api.post('/minigames/run-session/start', { game });
  const sid = r.data?.session_id;
  if (!sid) throw new Error('No run session from server');
  return {
    session_id: sid,
    plays_left: r.data?.plays_left,
    max_plays: r.data?.max_plays,
    resets_at: r.data?.resets_at,
  };
}

/**
 * Check remaining hourly plays for a minigame.
 * @param {string} game
 * @returns {{ plays_left: number, max_plays: number, resets_at: string }}
 */
export async function getMinigamePlaysLeft(game) {
  const r = await api.get('/minigames/plays-left', { params: { game } });
  return r.data;
}
