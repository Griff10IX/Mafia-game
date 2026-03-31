/**
 * Game Pass cash + points purchase — keep in sync with:
 * - backend/server.py POINT_PACKAGES["rank_xp_pass_499"]
 * - backend/routers/money/payments.py GAME_PASS_POINTS_PRICE
 * Silver pack (comparison copy) — POINT_PACKAGES["silver"]
 */
export const GAME_PASS_PACKAGE_ID = 'rank_xp_pass_499';
export const GAME_PASS_PRICE_GBP = '9.99';
export const GAME_PASS_POINTS_PRICE = 10_000;
export const SILVER_PACK_POINTS = 10_000;
export const SILVER_PACK_PRICE_GBP = '21.99';

/** Fine print: death + Dead > Alive retrieve (see backend dead_alive.py). */
export const GAME_PASS_DEAD_ALIVE_FINE_PRINT =
  'Game Pass rank-tier progress is not wiped when you die. If you use Dead > Alive to move a dead account’s estate to a new account, your Game Pass state carries over so you can keep progressing.';
