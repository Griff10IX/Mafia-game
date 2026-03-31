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
