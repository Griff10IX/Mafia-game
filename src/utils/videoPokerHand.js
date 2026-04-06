/**
 * Jacks-or-better 5-card hand rank — mirrors backend routers/casinos/video_poker._evaluate_hand
 * (rank detection only; multiplier comes from pay table on the client).
 */
const VALUE_RANK = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function countMap(nums) {
  const m = new Map();
  for (const n of nums) m.set(n, (m.get(n) || 0) + 1);
  return m;
}

/**
 * @param {Array<{ suit: string, value: string }>|null|undefined} hand
 * @returns {string} hand_key matching backend (e.g. 'jacks_or_better', 'nothing')
 */
export function getVideoPokerHandKey(hand) {
  if (!hand || hand.length !== 5) return 'nothing';

  const nums = hand
    .map((c) => VALUE_RANK[c?.value])
    .filter((n) => n != null)
    .sort((a, b) => a - b);
  if (nums.length !== 5) return 'nothing';

  const suits = hand.map((c) => c?.suit);
  const counts = countMap(nums);
  const countVals = [...counts.values()].sort((a, b) => b - a);

  const isFlush = new Set(suits).size === 1;
  let isStraight = false;
  if (new Set(nums).size === 5) {
    if (nums[4] - nums[0] === 4) isStraight = true;
    else if (nums[0] === 2 && nums[1] === 3 && nums[2] === 4 && nums[3] === 5 && nums[4] === 14) isStraight = true;
  }

  if (isFlush && isStraight) {
    const rs = new Set(nums);
    if (rs.size === 5 && rs.has(10) && rs.has(11) && rs.has(12) && rs.has(13) && rs.has(14)) {
      return 'royal_flush';
    }
    return 'straight_flush';
  }
  if (countVals[0] === 4 && countVals[1] === 1) return 'four_of_a_kind';
  if (countVals[0] === 3 && countVals[1] === 2) return 'full_house';
  if (isFlush) return 'flush';
  if (isStraight) return 'straight';
  if (countVals[0] === 3) return 'three_of_a_kind';
  if (countVals[0] === 2 && countVals[1] === 2) return 'two_pair';
  if (countVals[0] === 2) {
    const pairValue = [...counts.entries()].find(([, c]) => c === 2)?.[0];
    if (pairValue >= 11) return 'jacks_or_better';
    return 'nothing';
  }
  return 'nothing';
}

/**
 * @param {string} key
 * @param {Record<string, string>} handNames
 */
export function handNameForKey(key, handNames) {
  return (handNames && handNames[key]) || (key === 'nothing' ? 'Nothing' : key);
}
