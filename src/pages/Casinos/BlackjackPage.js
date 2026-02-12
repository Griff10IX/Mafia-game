import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const SUITS = { H: { sym: '♥', red: true }, D: { sym: '♦', red: true }, C: { sym: '♣', red: false }, S: { sym: '♠', red: false } };

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || x.loc?.join('.')).join('; ') || fallback;
  return fallback;
}

function Card({ card, hidden, index = 0, flip }) {
  if (hidden) {
    return (
      <div
        className="w-12 h-16 sm:w-14 sm:h-20 md:w-16 md:h-24 rounded-sm border-2 border-primary/50 bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center shadow-lg"
        style={{ animationDelay: `${index * 0.08}s` }}
      >
        <span className="text-primary/60 font-heading text-base">◆</span>
      </div>
    );
  }
  const s = SUITS[card.suit] || { sym: '?', red: false };
  return (
    <div
      className={`w-12 h-16 sm:w-14 sm:h-20 md:w-16 md:h-24 rounded-sm border border-primary/30 ${styles.surface} flex flex-col items-center justify-center shadow-lg ${s.red ? 'text-red-400' : 'text-foreground'}`}
      style={{ animationDelay: flip ? '0s' : `${index * 0.08}s` }}
    >
      <span className="text-sm sm:text-base font-heading font-bold leading-none">{card.value}</span>
      <span className="text-lg leading-none">{s.sym}</span>
    </div>
  );
}

function outcomeLabel(result) {
  const map = { win: 'Win', lose: 'Lose', push: 'Push', bust: 'Bust', blackjack: 'Blackjack', dealer_bust: 'Dealer bust' };
  return map[result] || result;
}

function outcomeClass(result) {
  if (result === 'win' || result === 'blackjack' || result === 'dealer_bust') return 'text-emerald-400';
  if (result === 'lose' || result === 'bust') return 'text-red-400';
  return 'text-mutedForeground';
}

function handToStr(hand) {
  if (!Array.isArray(hand) || !hand.length) return '—';
  return hand.map((c) => (c && c.value) || '?').join(', ');
}

function handTotal(hand) {
  if (!Array.isArray(hand) || !hand.length) return null;
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    const v = c?.value;
    if (v === 'A') { aces += 1; total += 11; }
    else if (v === 'K' || v === 'Q' || v === 'J') total += 10;
    else total += parseInt(v, 10) || 0;
  }
  while (total > 21 && aces) { total -= 10; aces -= 1; }
  return total;
}

function formatHistoryDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function Blackjack() {
  const [config, setConfig] = useState({ max_bet: 50_000_000, claim_cost: 500_000_000 });
  const [ownership, setOwnership] = useState(null);
  const [bet, setBet] = useState('1000');
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dealerRevealed, setDealerRevealed] = useState(false);
  const [history, setHistory] = useState([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [newMaxBet, setNewMaxBet] = useState('');
  const [transferUsername, setTransferUsername] = useState('');

  const fetchConfigAndOwnership = () => {
    api.get('/casino/blackjack/config').then((r) => setConfig(r.data || { max_bet: 50_000_000 })).catch(() => {});
    api.get('/casino/blackjack/ownership').then((r) => setOwnership(r.data || null)).catch(() => setOwnership(null));
  };

  const fetchHistory = () => {
    api.get('/casino/blackjack/history').then((r) => setHistory(r.data?.history || [])).catch(() => {});
  };

  useEffect(() => {
    fetchConfigAndOwnership();
    fetchHistory();
  }, []);

  const handleClaim = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/blackjack/claim', { city });
      toast.success('You now own the blackjack table here!');
      fetchConfigAndOwnership();
      refreshUser();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to claim'));
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleRelinquish = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    if (!window.confirm('Give up ownership of this table?')) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/blackjack/relinquish', { city });
      toast.success('Ownership relinquished.');
      fetchConfigAndOwnership();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed'));
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleSetMaxBet = async () => {
    const city = ownership?.current_city;
    if (!city) return;
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1_000_000) {
      toast.error('Min max bet is $1,000,000');
      return;
    }
    setOwnerLoading(true);
    try {
      await api.post('/casino/blackjack/set-max-bet', { city, max_bet: val });
      toast.success('Max bet updated');
      setNewMaxBet('');
      fetchConfigAndOwnership();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed'));
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleTransfer = async () => {
    const city = ownership?.current_city;
    if (!city || !transferUsername.trim() || ownerLoading) return;
    if (!window.confirm(`Transfer ownership to ${transferUsername}?`)) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/blackjack/send-to-user', { city, target_username: transferUsername.trim() });
      toast.success('Ownership transferred');
      setTransferUsername('');
      fetchConfigAndOwnership();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed'));
    } finally {
      setOwnerLoading(false);
    }
  };

  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const maxBet = ownership?.max_bet ?? config.max_bet ?? 50_000_000;
  const canPlay = betNum > 0 && betNum <= maxBet && !loading && !game;
  const isOwner = !!ownership?.is_owner;
  const canClaim = ownership?.is_unclaimed && !ownership?.owner_id;
  const currentCity = ownership?.current_city || '—';

  const startGame = async () => {
    if (!canPlay) return;
    setLoading(true);
    setGame(null);
    setDealerRevealed(false);
    try {
      const res = await api.post('/casino/blackjack/start', { bet: betNum });
      setGame(res.data);
      if (res.data?.new_balance != null) refreshUser();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to start game'));
    } finally {
      setLoading(false);
    }
  };

  const hit = async () => {
    if (!game?.can_hit || loading) return;
    setLoading(true);
    try {
      const res = await api.post('/casino/blackjack/hit');
      const data = res.data || {};
      if (data.status === 'player_bust') {
        setGame({ ...game, ...data, can_hit: false, can_stand: false });
        toast.error(`Bust! You lost ${formatMoney(game.bet)}.`);
        refreshUser(data.new_balance);
        fetchHistory();
      } else {
        setGame({ ...game, ...data });
      }
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to hit'));
    } finally {
      setLoading(false);
    }
  };

  const stand = async () => {
    if (!game?.can_stand || loading) return;
    setLoading(true);
    setDealerRevealed(true);
    try {
      const res = await api.post('/casino/blackjack/stand');
      const data = res.data || {};
      setGame({ ...game, ...data, can_hit: false, can_stand: false });
      if (data.result === 'blackjack') toast.success(`Blackjack! You won ${formatMoney(data.payout - game.bet)}.`);
      else if (data.result === 'win' || data.result === 'dealer_bust') toast.success(`You won ${formatMoney(data.payout - game.bet)}!`);
      else if (data.result === 'push') toast.info('Push. Bet returned.');
      else toast.error(`Dealer wins. You lost ${formatMoney(game.bet)}.`);
      refreshUser(data.new_balance);
      fetchHistory();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to stand'));
    } finally {
      setLoading(false);
    }
  };

  const playAgain = () => {
    setGame(null);
    setDealerRevealed(false);
  };

  const showDealerTotal = game?.status === 'done' || dealerRevealed;
  const dealerTotal = showDealerTotal ? (game?.dealer_total ?? '?') : (game?.dealer_visible_total != null ? game.dealer_visible_total : '??');

  return (
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="blackjack-page">
      {/* Header - same style as RLT/Dice */}
      <div>
        <div className="flex items-center gap-2 sm:gap-4 mb-2">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-xl sm:text-3xl md:text-4xl font-heading font-bold text-primary tracking-wider uppercase">Blackjack</h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-sm text-mutedForeground font-heading tracking-wide">Playing in <span className="text-primary">{currentCity}</span></p>
        {ownership && (
          <div className={`mt-3 p-3 ${styles.panel} rounded-sm border border-primary/20 text-sm`}>
            {isOwner ? (
              <p className="text-foreground font-heading">You own this table — you profit when players lose; house pays when they win.</p>
            ) : ownership?.owner_name ? (
              <p className="text-mutedForeground">Owned by <span className="text-foreground font-medium">{ownership.owner_name}</span>. Losses go to the owner.</p>
            ) : (
              <p className="text-mutedForeground">No owner. Wins and losses are against the house.</p>
            )}
            <div className="flex gap-2 mt-2">
              {canClaim && (
                <button type="button" onClick={handleClaim} disabled={ownerLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-wider disabled:opacity-50 border border-yellow-600/50">
                  {ownerLoading ? '...' : `Claim ownership (${formatMoney(config.claim_cost)})`}
                </button>
              )}
              {isOwner && (
                <button type="button" onClick={handleRelinquish} disabled={ownerLoading} className="bg-zinc-800 border border-primary/30 text-foreground hover:bg-zinc-700 rounded-sm px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-wider disabled:opacity-50">
                  {ownerLoading ? '...' : 'Relinquish'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Owner panel - like RLT */}
      {isOwner && (
        <div className={`${styles.panel} border-2 border-primary/50 rounded-md overflow-hidden`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Owner Controls</h3>
            <p className="text-xs text-mutedForeground mt-0.5">Manage your blackjack table in {currentCity}</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-secondary/30 rounded-sm p-3">
                <p className="text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Total Earnings</p>
                <p className="text-xl font-heading font-bold text-primary">{formatMoney(ownership?.total_earnings || 0)}</p>
              </div>
              <div className="bg-secondary/30 rounded-sm p-3">
                <p className="text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Current Max Bet</p>
                <p className="text-xl font-heading font-bold text-foreground">{formatMoney(ownership?.max_bet || maxBet)}</p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-heading uppercase tracking-wider text-mutedForeground mb-2">Set Max Bet</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. 100000000"
                  value={newMaxBet}
                  onChange={(e) => setNewMaxBet(e.target.value)}
                  className={`flex-1 ${styles.input} h-10 px-3 text-sm`}
                />
                <button onClick={handleSetMaxBet} disabled={ownerLoading} className="bg-primary text-primaryForeground px-4 rounded-sm font-heading font-bold text-sm hover:opacity-90 disabled:opacity-50">
                  Set
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-heading uppercase tracking-wider text-mutedForeground mb-2">Transfer Ownership</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Username"
                  value={transferUsername}
                  onChange={(e) => setTransferUsername(e.target.value)}
                  className={`flex-1 ${styles.input} h-10 px-3 text-sm`}
                />
                <button onClick={handleTransfer} disabled={ownerLoading || !transferUsername.trim()} className="bg-secondary text-foreground px-4 rounded-sm font-heading font-bold text-sm hover:opacity-90 disabled:opacity-50 border border-border">
                  Transfer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Game + Info - only show when not owner */}
      {!isOwner && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
            <div className="px-3 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">The Table</h3>
                <div className="flex-1 h-px bg-primary/50" />
              </div>
              <p className="text-xs text-mutedForeground mt-0.5">Beat the dealer to 21. Blackjack pays 3:2.</p>
            </div>
            <div className="p-4 space-y-4">
              {!game ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="text-primary/80 font-heading">$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={bet}
                      onChange={(e) => setBet(e.target.value)}
                      className={`w-28 sm:w-32 ${styles.input} h-10 px-3 text-sm`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={startGame}
                    disabled={!canPlay}
                    className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-2.5 px-6 border border-yellow-600/50 transition-smooth disabled:opacity-50"
                  >
                    Deal
                  </button>
                </div>
              ) : (
                <>
                  <div className="border-b border-primary/20 pb-3">
                    <p className="text-xs font-heading text-mutedForeground uppercase tracking-wider mb-1">Dealer</p>
                    <p className="text-xs text-mutedForeground mb-2">
                      Total: <span className="text-primary font-mono font-bold">{showDealerTotal ? dealerTotal : '??'}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {game.dealer_hand?.map((c, i) => (
                        <Card
                          key={i}
                          card={c}
                          hidden={game.status === 'playing' && game.dealer_hidden_count > 0 && i >= game.dealer_hand.length - game.dealer_hidden_count}
                          index={i}
                          flip={showDealerTotal && i === 1}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="border-b border-primary/20 pb-3">
                    <p className="text-xs font-heading text-mutedForeground uppercase tracking-wider mb-1">You</p>
                    <p className="text-xs text-mutedForeground mb-2">
                      Total: <span className="text-primary font-mono font-bold">{game.player_total ?? '??'}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {game.player_hand?.map((c, i) => (
                        <Card key={i} card={c} index={i} />
                      ))}
                    </div>
                  </div>
                  {game.status === 'playing' && (
                    <div className="flex gap-2">
                      <button type="button" onClick={hit} disabled={loading} className="flex-1 bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-2.5 transition-smooth disabled:opacity-50 border border-yellow-600/50">
                        Hit
                      </button>
                      <button type="button" onClick={stand} disabled={loading} className="flex-1 bg-zinc-800 border border-primary/40 text-foreground hover:bg-zinc-700 rounded-sm font-heading font-bold uppercase tracking-widest py-2.5 transition-smooth disabled:opacity-50">
                        Stand
                      </button>
                    </div>
                  )}
                  {(game.status === 'player_bust' || game.status === 'done') && (
                    <button type="button" onClick={playAgain} className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-2.5 border border-yellow-600/50 transition-smooth">
                      Play Again
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
              <div className="px-3 py-2 bg-secondary/40 border-b border-primary/20">
                <h3 className="text-sm font-heading font-semibold text-foreground uppercase tracking-wider">Info</h3>
              </div>
              <div className="p-3 space-y-1 text-xs text-mutedForeground font-heading">
                <p><span className="text-foreground font-medium">Max bet:</span> {formatMoney(maxBet)}</p>
                <p>Dealer stands on 17. Blackjack pays 3:2.</p>
                <p>Get closer to 21 than the dealer without going over.</p>
              </div>
            </div>
            <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
              <div className="px-3 py-2 bg-secondary/40 border-b border-primary/20">
                <h3 className="text-sm font-heading font-semibold text-foreground uppercase tracking-wider">Last 10 results</h3>
              </div>
              <div className="p-3 max-h-[260px] overflow-y-auto">
                {history.length === 0 ? (
                  <p className="text-xs text-mutedForeground font-heading">No results yet. Place a bet to start.</p>
                ) : (
                  <ul className="space-y-2 text-xs font-heading">
                    {history.map((item, i) => {
                      const profit = (item.payout || 0) - (item.bet || 0);
                      const profitStr = profit >= 0 ? `+${formatMoney(profit)}` : formatMoney(profit);
                      const playerTotal = item.player_total != null ? item.player_total : handTotal(item.player_hand);
                      const dealerTotalVal = item.dealer_total != null ? item.dealer_total : handTotal(item.dealer_hand);
                      return (
                        <li key={i} className="py-1.5 border-b border-primary/10 last:border-0 space-y-0.5">
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <span className="text-mutedForeground">{formatHistoryDate(item.created_at)}</span>
                            <span className={`font-mono ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{profitStr}</span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <span className="text-mutedForeground">Bet {formatMoney(item.bet)}</span>
                            <span className={outcomeClass(item.result)}>{outcomeLabel(item.result)}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-mutedForeground">
                            <span>You: <span className="text-foreground font-mono">{handToStr(item.player_hand)}{playerTotal != null ? ` (${playerTotal})` : ''}</span></span>
                            <span>Dealer: <span className="text-foreground font-mono">{handToStr(item.dealer_hand)}{dealerTotalVal != null ? ` (${dealerTotalVal})` : ''}</span></span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isOwner && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/30 p-4 text-center`}>
          <p className="text-mutedForeground font-heading">You cannot play at your own table. Manage it above or travel to another city to play.</p>
        </div>
      )}
    </div>
  );
}
