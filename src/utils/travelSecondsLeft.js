/** Whole seconds left until travel_arrives_at. Floor so a 3s leg never paints as 4s. */
export function travelSecondsLeft(arrivesMs, nowMs = Date.now()) {
  const ms = Number(arrivesMs) - Number(nowMs);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.floor(ms / 1000));
}
