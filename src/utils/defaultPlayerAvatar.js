/** Default portraits for players who have not set a custom avatar. */
export const DEFAULT_PLAYER_AVATARS = [
  '/images/default-avatar-1.png',
  '/images/default-avatar-2.png',
  '/images/default-avatar-3.png',
  '/images/default-avatar-4.png',
];

/** Deterministic pick so the same user always gets the same default. */
export function defaultPlayerAvatarUrl(seed) {
  const list = DEFAULT_PLAYER_AVATARS;
  if (!list.length) return null;
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return list[h % list.length];
}

/** Prefer stored avatar; else robot portrait; else default player portrait. */
export function resolveDisplayAvatarUrl(profile) {
  if (!profile) return null;
  const stored = typeof profile.avatar_url === 'string' ? profile.avatar_url.trim() : '';
  if (stored) return stored;
  if (profile.is_npc && profile.is_bodyguard) {
    // lazy import avoided — callers with robots should pass util themselves if needed
    return null;
  }
  if (profile.is_npc) return null;
  return defaultPlayerAvatarUrl(profile.id || profile.username);
}
