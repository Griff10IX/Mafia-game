/** Must match backend/utils/loot_piece_store.py — GBP card only. */
export const LOOT_PIECE_PACKS = [
  { packageId: 'loot_pieces_1000', pieces: 1000, priceGbp: 7, wheelSpins: 2 },
  { packageId: 'loot_pieces_2000', pieces: 2000, priceGbp: 13.5, wheelSpins: 4 },
  { packageId: 'loot_pieces_3000', pieces: 3000, priceGbp: 19.5, wheelSpins: 6 },
  { packageId: 'loot_pieces_4000', pieces: 4000, priceGbp: 25, wheelSpins: 8 },
  { packageId: 'loot_pieces_5000', pieces: 5000, priceGbp: 30, wheelSpins: 10 },
];

export function formatLootPackGbp(priceGbp) {
  return Number(priceGbp).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
}
