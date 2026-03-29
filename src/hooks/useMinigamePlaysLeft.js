import { useState, useEffect, useCallback, useRef } from "react";
import { getMinigamePlaysLeft } from "../utils/minigameRunSession";

/**
 * Track remaining plays for a minigame (server rate-limit window, typically 10 per 2h UTC).
 * Fetches on mount; use `refresh` for GET /minigames/plays-left, `updateFromStart` after
 * POST .../run-session/start (or equivalent) to reserve one play in the UI, and
 * `applyPlaysLeftPayload` after submit/claim responses that include plays_left.
 */
export default function useMinigamePlaysLeft(game) {
  const [playsLeft, setPlaysLeft] = useState(null);
  const [maxPlays, setMaxPlays] = useState(null);
  const [resetsAt, setResetsAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const applyPlaysLeftPayload = useCallback((data) => {
    if (!data || typeof data !== "object") return;
    if (data.plays_left != null) setPlaysLeft(data.plays_left);
    if (data.max_plays != null) setMaxPlays(data.max_plays);
    if (data.resets_at != null) setResetsAt(data.resets_at);
  }, []);

  const refresh = useCallback(async () => {
    if (!game) return;
    try {
      const data = await getMinigamePlaysLeft(game);
      applyPlaysLeftPayload(data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [game, applyPlaysLeftPayload]);

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

  return { playsLeft, maxPlays, resetsAt, loading, canPlay, refresh, updateFromStart, applyPlaysLeftPayload };
}
