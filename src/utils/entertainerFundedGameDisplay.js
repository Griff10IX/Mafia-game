/** Labels / formatting for `entertainer_funded_games` rows (hub + admin). */

export function fundedGameKindLabel(row) {
  if (!row) return '—';
  if (row.source === 'mdg') return 'MDG';
  if (row.source === 'forum_dice') return 'Forum · dice';
  if (row.source === 'forum_gbox') return 'Forum · gbox';
  if (row.source === 'forum_hangman') return 'Forum · hangman';
  if (row.source === 'forum_game') return 'Forum E-Game';
  if (row.source === 'mp_poker') {
    return row.mp_poker_subkind === 'tournament' ? 'MP Poker · tournament' : 'MP Poker · table';
  }
  return row.source || '—';
}

export function formatTotalWinnings(row) {
  const pts = Number(row?.total_winnings_points ?? 0);
  const cash = Number(row?.total_winnings_cash ?? 0);
  const parts = [];
  if (pts) parts.push(`${Math.trunc(pts).toLocaleString()} pts`);
  if (cash) parts.push(`$${Math.trunc(cash).toLocaleString()}`);
  return parts.length ? parts.join(' + ') : '—';
}

export function formatFromEntertainerFund(row) {
  const pts = Number(row?.from_entertainer_fund_points ?? 0);
  const cash = Number(row?.from_entertainer_fund_cash ?? 0);
  const parts = [];
  if (pts) parts.push(`${Math.trunc(pts).toLocaleString()} pts`);
  if (cash) parts.push(`$${Math.trunc(cash).toLocaleString()}`);
  return parts.length ? parts.join(' + ') : '—';
}

export function fundedGameHref(row) {
  if (!row?.ref_id) return null;
  if (row.source === 'mdg') return `/casino/mdg`;
  if (row.source === 'forum_dice' || row.source === 'forum_gbox' || row.source === 'forum_hangman' || row.source === 'forum_game') {
    return '/social/forum?tab=entertainer';
  }
  if (row.source === 'mp_poker') return `/casino/mp-poker/game/${row.ref_id}`;
  return null;
}
