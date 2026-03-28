import { useState, useEffect, useCallback, useRef } from "react";
import { getMinigamePlaysLeft } from "../utils/minigameRunSession";

/**
 * Hook to track remaining hourly plays for a minigame.
 * Fetches on mount, and exposes `refresh` + `updateFromStart` to keep in sync.
 *
 * @param {string} game - Game identifier (e.g. "snake", "gauntlet")
 * @returns {{ playsLeft: number|null, maxPlays: number|null, resetsAt: string|null, loading: boolean, canPlay: boolean, refresh: () => void, updateFromStart: (data: object) => void }}
 */
export default function useMinigamePlaysLeft(game) {
  const [playsLeft, setPlaysLeft] = useState(null);
  const [maxPlays, setMaxPlays] = useState(null);
  const [resetsAt, setResetsAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const apply = useCallback((data) => {
    if (data.plays_left != null) setPlaysLeft(data.plays_left);
    if (data.max_plays != null) setMaxPlays(data.max_plays);
    if (data.resets_at != null) setResetsAt(data.resets_at);
  }, []);

  const refresh = useCallback(async () => {
    if (!game) return;
    try {
      const data = await getMinigamePlaysLeft(game);
      apply(data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [game, apply]);

  useEffect(() => {
    refresh();
    return () => clearTimeout(timerRef.current);
  }, [refresh]);

  useEffect(() => {
    if (!resetsAt) return;
    const ms = new Date(resetsAt).getTime() - Date.now();
    if (ms <= 0 || ms > 3700_000) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => refresh(), ms + 500);
    return () => clearTimeout(timerRef.current);
  }, [resetsAt, refresh]);

  const updateFromStart = useCallback((startResp) => {
    if (!startResp) return;
    const left = startResp.plays_left;
    if (left != null) setPlaysLeft(Math.max(0, left - 1));
    if (startResp.max_plays != null) setMaxPlays(startResp.max_plays);
    if (startResp.resets_at != null) setResetsAt(startResp.resets_at);
  }, []);

  const canPlay = playsLeft === null ? true : playsLeft > 0;

  return { playsLeft, maxPlays, resetsAt, loading, canPlay, refresh, updateFromStart };
}
