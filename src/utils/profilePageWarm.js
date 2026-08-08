/**
 * Background warm for /account/profile: chunk + profile doc + own-profile edit APIs.
 */
import api from './api';
import { getProfilePrefetch, setProfilePrefetch, setProfileSessionLastMeUsername } from './prefetchCache';
import { readSessionJson, writeSessionJson } from './sessionPageCache';

const PROFILE_EDIT_WARM_KEY = 'mafia_profile_edit_warm_v1';
const MAX_WARM_AGE_MS = 60_000;

let lastProfileWarmAt = 0;

/** Stale-while-revalidate session payload for Profile "edit" panel (own user only). */
export function getProfileEditWarm(meUserId) {
  if (meUserId == null || meUserId === '') return null;
  const row = readSessionJson(PROFILE_EDIT_WARM_KEY);
  if (!row || String(row.userId) !== String(meUserId)) return null;
  if (Date.now() - (row.ts || 0) > MAX_WARM_AGE_MS) return null;
  return row;
}

/**
 * @param {{ force?: boolean }} [options]
 */
export async function prefetchProfilePageData(options = {}) {
  const force = options.force !== false;
  const now = Date.now();
  if (!force && now - lastProfileWarmAt < 45_000) return;
  lastProfileWarmAt = now;
  try {
    const meRes = await api.get('/auth/me');
    const uid = meRes.data?.id;
    const u = String(meRes.data?.username || '').trim();
    if (!uid || !u) return;

    setProfileSessionLastMeUsername(u);

    const [profRes, honRes] = await Promise.all([
      api.get(`/users/${encodeURIComponent(u)}/profile`, { params: { include_honours: false } }),
      api.get(`/users/${encodeURIComponent(u)}/profile/honours`).catch(() => ({ data: { honours: [] } })),
    ]);

    setProfilePrefetch(u, {
      ...profRes.data,
      honours: honRes.data?.honours ?? [],
      _honoursLoaded: true,
    });
  } catch {
    /* Profile page loads normally */
  }
}
