/**
 * Game Pass cash + points purchase — keep in sync with:
 * - backend/server.py POINT_PACKAGES["rank_xp_pass_499"]
 * - Game Pass is card-only (points purchase removed from backend).
 * Silver pack (comparison copy) — POINT_PACKAGES["silver"]
 */
export const GAME_PASS_PACKAGE_ID = 'rank_xp_pass_499';
export const GAME_PASS_PRICE_GBP = '15.00';
export const SILVER_PACK_POINTS = 10_000;
export const SILVER_PACK_PRICE_GBP = '21.99';

/** Keep in sync with backend POINT_PACKAGES["game_pass_prestige_10"] + game_pass_prestige.py */
export const GAME_PASS_PRESTIGE_PACKAGE_ID = 'game_pass_prestige_10';
export const GAME_PASS_PRESTIGE_PRICE_GBP = '10.00';
export const GAME_PASS_PRESTIGE_BONUS_PERCENT = 50;
export const GAME_PASS_PRESTIGE_EXTRA_LOOT_PIECES = 500;

/** Fine print: death + Dead > Alive retrieve (see backend dead_alive.py). */
export const GAME_PASS_DEAD_ALIVE_FINE_PRINT =
  'Game Pass rank-tier progress is not wiped when you die. If you use Dead > Alive to move a dead account’s estate to a new account, your Game Pass state carries over so you can keep progressing.';

/** Matches backend `payments.py` token window: `_add_months(now, 1)`. */
export const GAME_PASS_DURATION_LABEL = '1 month';

/** Shown on the Game Pass page so players know the subscription window. */
export const GAME_PASS_DURATION_FINE_PRINT =
  'Each Game Pass lasts 1 calendar month from purchase (when your token is granted). Activate it before that time or the token expires. While VIP is active, tier rewards run until that same end date and time.';

/** Must match backend `payments.GAME_PASS_PURCHASE_CLOSE_WINDOW_DAYS`. */
export const GAME_PASS_PURCHASE_FINAL_DAYS_BLOCK = 7;
/** Fallback when API season end unavailable (00:00 UK on the 1st). Live value from GET /payments/game-pass-season. */
export const GAME_PASS_SEASON_END_AT_ISO = '2026-09-30T23:00:00+00:00';

const MS_PER_DAY = 86400000;

/**
 * When non-null, Stripe/points Game Pass purchase should be disabled (server enforces too).
 * Block inside final N days before the global Game Pass season end timestamp.
 */
export function gamePassPurchaseBlockedFinalWindowMessage(
  user,
  nowMs = Date.now(),
  seasonEndAtIso = GAME_PASS_SEASON_END_AT_ISO,
  closeWindowDays = GAME_PASS_PURCHASE_FINAL_DAYS_BLOCK,
) {
  const end = new Date(seasonEndAtIso).getTime();
  if (Number.isNaN(end) || end <= nowMs) return null;
  const remainingMs = end - nowMs;
  if (remainingMs > closeWindowDays * MS_PER_DAY) return null;
  return `Game Pass is not available for purchase in the final ${closeWindowDays} days before this season ends. You can buy again when the new season releases.`;
}
