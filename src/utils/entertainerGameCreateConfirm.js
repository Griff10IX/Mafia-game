/**
 * Matches backend `create_game` in `routers/game/entertainer.py`:
 * non-admins always use manual_roll (creator-funded rewards required).
 * Confirm whenever pot + reserved rewards would deduct cash or points.
 */
export function confirmEntertainerGameCreatorDeduction({
  isAdmin,
  isEntertainer,
  manualRoll,
  parsedPot,
  rewardMoney,
  rewardPoints,
  gameType,
}) {
  const effectiveManual = isAdmin ? !!manualRoll : true;
  if (effectiveManual && rewardMoney <= 0 && rewardPoints <= 0) {
    return { allowed: false, toastMessage: 'Set reward cash, points, or both for manual games.' };
  }
  const reserveMoney = effectiveManual ? rewardMoney : 0;
  const reservePoints = effectiveManual ? rewardPoints : 0;
  const totalMoney = parsedPot + reserveMoney;
  if (totalMoney > 0 || reservePoints > 0) {
    const rewardNote =
      gameType === 'gbox'
        ? '\nGbox: reward cash and points are total pools split randomly among everyone who joined.'
        : '\nDice: winner receives the full reward cash and points reserved above.';
    const src = isEntertainer ? 'Entertainer fund' : 'your account';
    const cashLine = isEntertainer
      ? `Fund cash: $${totalMoney.toLocaleString()} (${parsedPot.toLocaleString()} pot + ${reserveMoney.toLocaleString()} rewards)`
      : `Cash: $${totalMoney.toLocaleString()} (${parsedPot.toLocaleString()} pot + ${reserveMoney.toLocaleString()} rewards)`;
    const ptsLine = isEntertainer
      ? `Fund points: ${reservePoints.toLocaleString()}`
      : `Points: ${reservePoints.toLocaleString()}`;
    const ok = window.confirm(
      `Create game and deduct now?\n\n` +
        `From ${src}:\n` +
        `- ${cashLine}\n` +
        `- ${ptsLine}\n` +
        `${rewardNote}`
    );
    if (!ok) return { allowed: false };
  }
  return { allowed: true };
}
