import api from './api';

/**
 * Start a server-timed minigame run. Submit endpoints require session_id from the response.
 * @param {string} game - snake | family_run | the_getaway | minesweeper | battleships | whack_a_copper | mafia_rpg | shooting_range
 */
export async function startMinigameRun(game) {
  const r = await api.post('/minigames/run-session/start', { game });
  const sid = r.data?.session_id;
  if (!sid) throw new Error('No run session from server');
  return sid;
}
