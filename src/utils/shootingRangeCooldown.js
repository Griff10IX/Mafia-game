import { useState, useEffect } from 'react';

/** Returns "M:SS" remaining until next_train_at, or null when ready / invalid. */
export function formatMasteryTrainCooldownLabel(nextTrainAtIso) {
  if (!nextTrainAtIso) return null;
  const rem = new Date(nextTrainAtIso).getTime() - Date.now();
  if (rem <= 0) return null;
  const m = Math.floor(rem / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Re-render once per second while any weapon has an active mastery cooldown (for countdown UI). */
export function useMasteryCooldownTick(masteryData) {
  const [tick, setTick] = useState(0);
  const hasActive =
    masteryData?.mastery &&
    Object.values(masteryData.mastery).some((m) => {
      const iso = m?.next_train_at;
      if (!iso) return false;
      return new Date(iso).getTime() > Date.now();
    });
  useEffect(() => {
    if (!hasActive) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasActive, masteryData]);
  return tick;
}
