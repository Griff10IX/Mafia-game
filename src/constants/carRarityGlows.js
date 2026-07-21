// Shared car rarity glow colours — same palette as the Garage and GTA pages.
export const RARITY_GLOW_HEX = {
  common: '#9ca3af',
  uncommon: '#4ade80',
  rare: '#60a5fa',
  ultra_rare: '#c084fc',
  legendary: '#facc15',
  custom: '#fb923c',
  exclusive: '#f87171',
  loot_exclusive: '#fbbf24',
  vip_exclusive: '#06b6d4',
};

/** Inline row style (tinted border + soft glow) for a car's rarity; Garage-style intensity. */
export function rarityRowStyle(rarity) {
  const hex = RARITY_GLOW_HEX[rarity] || RARITY_GLOW_HEX.common;
  return {
    borderColor: `${hex}66`,
    boxShadow: `0 0 8px ${hex}44, inset 0 0 6px ${hex}1f`,
  };
}
