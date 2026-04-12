import api from './api';

/**
 * Clear casino buy-back (same as set-buy-back-reward with amount 0). Returns held points to the owner.
 * @param {'dice'|'roulette'|'blackjack'|'horseracing'|'videopoker'|'slots'} type
 * @param {{ city?: string, state?: string }} loc - use `state` for slots only; `city` for all other types
 */
export async function removeCasinoBuyBack(type, loc) {
  if (type === 'slots') {
    const state = loc?.state;
    if (!state) throw new Error('removeCasinoBuyBack(slots): missing state');
    await api.post('/casino/slots/set-buy-back-reward', { state, amount: 0 });
    return;
  }
  const city = loc?.city;
  if (!city) throw new Error('removeCasinoBuyBack: missing city');
  await api.post(`/casino/${type}/set-buy-back-reward`, { city, amount: 0 });
}
