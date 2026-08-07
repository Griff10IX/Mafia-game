/** Default dossier / UI portraits for robot bodyguards (stable per id). */
export const ROBOT_BODYGUARD_AVATARS = [
  '/images/robot-bodyguard.png',
  '/images/robot-bodyguard-2.png',
  '/images/robot-bodyguard-3.png',
];

/** Deterministic pick so the same robot always gets the same portrait. */
export function robotBodyguardAvatarUrl(seed) {
  const list = ROBOT_BODYGUARD_AVATARS;
  if (!list.length) return null;
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return list[h % list.length];
}
