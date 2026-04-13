/**
 * Background warm for /account/profile: chunk + profile doc + own-profile edit APIs.
 */
import api from './api';
import { setProfilePrefetch } from './prefetchCache';
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

    const [profRes, prefRes, telRes, spotRes, censRes] = await Promise.all([
      api.get(`/users/${encodeURIComponent(u)}/profile`),
      api.get('/profile/preferences').catch(() => ({ data: null })),
      api.get('/profile/telegram').catch(() => ({ data: null })),
      api.get('/profile/spotify/status').catch(() => ({ data: null })),
      api.get('/profile/censor-profanity').catch(() => ({ data: null })),
    ]);

    setProfilePrefetch(u, profRes.data);

    writeSessionJson(PROFILE_EDIT_WARM_KEY, {
      userId: uid,
      ts: Date.now(),
      notification_preferences: prefRes.data?.notification_preferences ?? null,
      telegram_chat_id: telRes.data?.telegram_chat_id ?? '',
      telegram_bot_token: telRes.data?.telegram_bot_token ?? '',
      spotifyStatus: spotRes.data || null,
      spotify_url: spotRes.data?.spotify_url || '',
      censor_profanity: censRes.data?.censor_profanity === true,
      profile_autoplay_video: meRes.data?.profile_autoplay_video !== false,
      hide_kills_on_profile: profRes.data?.hide_kills_on_profile === true,
      hide_jailbusts_on_profile: profRes.data?.hide_jailbusts_on_profile === true,
      show_country_flag_on_profile: profRes.data?.show_country_flag_on_profile === true,
    });
  } catch {
    /* Profile page loads normally */
  }
}
