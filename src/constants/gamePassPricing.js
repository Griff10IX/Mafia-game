/**
 * Game Pass cash + points purchase — keep in sync with:
 * - backend/server.py POINT_PACKAGES["rank_xp_pass_499"]
 * - backend/routers/money/payments.py GAME_PASS_POINTS_PRICE
 * Silver pack (comparison copy) — POINT_PACKAGES["silver"]
 */
export const GAME_PASS_PACKAGE_ID = 'rank_xp_pass_499';
export const GAME_PASS_PRICE_GBP = '9.99';
export const GAME_PASS_POINTS_PRICE = 8_000;
export const SILVER_PACK_POINTS = 10_000;
export const SILVER_PACK_PRICE_GBP = '21.99';

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

const MS_PER_DAY = 86400000;

/**
 * When non-null, Stripe/points Game Pass purchase should be disabled (server enforces too).
 * Block inside final N days before rank_xp_pass_token_expires_at (server-enforced).
 */
export function gamePassPurchaseBlockedFinalWindowMessage(user, nowMs = Date.now()) {
  if (!user) return null;
  const raw = user.rank_xp_pass_token_expires_at;
  if (!raw) return null;
  const end = new Date(raw).getTime();
  if (Number.isNaN(end) || end <= nowMs) return null;
  const remainingMs = end - nowMs;
  if (remainingMs > GAME_PASS_PURCHASE_FINAL_DAYS_BLOCK * MS_PER_DAY) return null;
  const hasToken = Number(user.rank_xp_pass_tokens ?? 0) > 0;
  const vip = user.rank_xp_pass_rewards_granted === true;
  if (!hasToken && !vip) return null;
  return `Game Pass is not available for purchase in the final ${GAME_PASS_PURCHASE_FINAL_DAYS_BLOCK} days before your current pass ends. You can buy again after it expires.`;
}
