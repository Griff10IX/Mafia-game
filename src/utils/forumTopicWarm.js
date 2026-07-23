/**
 * Warm forum topic detail into sessionStorage so opening a thread can paint from cache.
 */
import api from './api';
import { readSessionJson, writeSessionJson } from './sessionPageCache';

const inflight = new Map();

export function forumTopicCacheKey(topicId) {
  return `mafia_forum_topic_${topicId}`;
}

export function readForumTopicCache(topicId) {
  if (!topicId) return null;
  const row = readSessionJson(forumTopicCacheKey(topicId));
  if (!row?.topic) return null;
  return row;
}

/** Prefetch topic+comments (and lazy ForumTopic chunk) on hover / pointer down. */
export function prefetchForumTopic(topicId) {
  if (!topicId) return Promise.resolve();
  // Kick off the lazy page chunk early so Suspense rarely shows.
  import('../pages/Social/ForumTopic').catch(() => {});
  const existing = readForumTopicCache(topicId);
  if (existing?.topic) return Promise.resolve(existing);
  if (inflight.has(topicId)) return inflight.get(topicId);

  const p = api
    .get(`/forum/topics/${topicId}`)
    .then((res) => {
      const topic = res.data?.topic ?? null;
      const comments = res.data?.comments ?? [];
      if (topic) {
        const row = { topic, comments };
        writeSessionJson(forumTopicCacheKey(topicId), row);
        return row;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(topicId);
    });

  inflight.set(topicId, p);
  return p;
}
