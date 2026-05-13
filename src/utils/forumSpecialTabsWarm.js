/**
 * Background warm for Forum special tabs (Entertainer, Designer, Game Ideas, Crew OC):
 * topic lists + tab-specific JSON so first click can render from sessionStorage before refetch.
 */
import api from './api';
import { readSessionJson, writeSessionJson } from './sessionPageCache';

const FORUM_SPECIAL_TABS_WARM_KEY = 'mafia_forum_special_tabs_warm_v1';
/** Must match Forum.js `forum_topics_cache_v1` + `:crew_oc:` */
const FORUM_TOPICS_SESSION_CREW_OC_PREFIX = 'forum_topics_cache_v1:crew_oc:';
const MAX_WARM_AGE_MS = 90_000;

let lastForumWarmAt = 0;

async function safeGet(url, config) {
  try {
    return await api.get(url, config);
  } catch {
    return { data: null };
  }
}

/** @returns {object | null} */
export function readForumSpecialTabsWarm() {
  const row = readSessionJson(FORUM_SPECIAL_TABS_WARM_KEY);
  if (!row || Date.now() - (row.ts || 0) > MAX_WARM_AGE_MS) return null;
  return row;
}

/** Call after Crew OC advertise (or similar) so Forum Crew OC tab is not stuck on warm/sessionStorage. */
export function invalidateForumCrewOcClientCaches() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(FORUM_SPECIAL_TABS_WARM_KEY);
    Object.keys(sessionStorage).forEach((k) => {
      if (k.startsWith(FORUM_TOPICS_SESSION_CREW_OC_PREFIX)) sessionStorage.removeItem(k);
    });
  } catch (_) {
    /* sessionStorage unavailable */
  }
}

/**
 * @param {{ force?: boolean }} [options]
 */
export async function prefetchForumSpecialTabsData(options = {}) {
  const force = options.force !== false;
  const now = Date.now();
  if (!force && now - lastForumWarmAt < 45_000) return;
  lastForumWarmAt = now;
  try {
    const meRes = await api.get('/auth/me');
    const uid = meRes.data?.id;
    if (!uid) return;

    const [
      tEnt,
      tDes,
      tGi,
      tCrew,
      gamesRes,
      histRes,
      prizesRes,
      fwActiveRes,
      fwHistRes,
      activeDesignerRes,
      adminRes,
    ] = await Promise.all([
      safeGet('/forum/topics', { params: { category: 'entertainer', page: 1 } }),
      safeGet('/forum/topics', { params: { category: 'designer', page: 1 } }),
      safeGet('/forum/topics', { params: { category: 'game_ideas', page: 1 } }),
      safeGet('/forum/topics', { params: { category: 'crew_oc', page: 1 } }),
      safeGet('/forum/entertainer/games'),
      safeGet('/forum/entertainer/games/history'),
      safeGet('/forum/entertainer/prizes'),
      safeGet('/forum/entertainer/find-word/active'),
      safeGet('/forum/entertainer/find-word/history', { params: { limit: 8 } }),
      safeGet('/forum/designer/competitions/active'),
      safeGet('/auth/staff-flags'),
    ]);

    const topics = {
      entertainer: {
        topics: tEnt.data?.topics ?? [],
        can_view_page_2: !!tEnt.data?.can_view_page_2,
      },
      designer: {
        topics: tDes.data?.topics ?? [],
        can_view_page_2: !!tDes.data?.can_view_page_2,
      },
      game_ideas: {
        topics: tGi.data?.topics ?? [],
        can_view_page_2: !!tGi.data?.can_view_page_2,
      },
      crew_oc: {
        topics: tCrew.data?.topics ?? [],
        can_view_page_2: !!tCrew.data?.can_view_page_2,
      },
    };

    const defaultCfg = {
      auto_create_enabled: false,
      find_word_auto_enabled: false,
      last_auto_create_at: null,
      next_auto_create_at: null,
      last_find_word_auto_at: null,
    };

    const entertainer = {
      games: gamesRes.data?.games ?? [],
      history: histRes.data?.games ?? [],
      prizes: prizesRes.data ?? null,
      findWordActive: fwActiveRes.data ?? { active: false },
      findWordHistory: fwHistRes.data?.rounds ?? [],
      config: defaultCfg,
    };

    const activeRes = activeDesignerRes.data ?? null;
    const comp = activeRes?.competition ?? null;
    let entriesPack = null;
    if (comp?.id) {
      const er = await safeGet(`/forum/designer/competitions/${comp.id}/entries`);
      entriesPack = {
        entries: er.data?.entries ?? [],
        my_vote_entry_id: er.data?.my_vote_entry_id ?? null,
        can_withdraw_vote: !!er.data?.can_withdraw_vote,
      };
    }

    const designer = {
      activeRes: activeRes
        ? {
            competition: activeRes.competition ?? null,
            my_vote_entry_id: activeRes.my_vote_entry_id ?? null,
            my_entry_comment_id: activeRes.my_entry_comment_id ?? null,
          }
        : null,
      entriesPack,
    };

    const adminCheck = adminRes.data && typeof adminRes.data === 'object'
      ? {
          is_admin: !!adminRes.data.is_admin,
          is_moderator: !!adminRes.data.is_moderator,
          is_help_desk_operator: !!adminRes.data.is_help_desk_operator,
        }
      : null;

    writeSessionJson(FORUM_SPECIAL_TABS_WARM_KEY, {
      userId: uid,
      ts: Date.now(),
      topics,
      entertainer,
      designer,
      adminCheck,
    });
  } catch {
    /* Forum still loads normally */
  }
}
