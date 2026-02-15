import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Spade, Heart, Diamond, Club } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const SUITS = {
  H: { sym: '♥', color: 'text-red-500', Icon: Heart },
  D: { sym: '♦', color: 'text-red-500', Icon: Diamond },
  C: { sym: '♣', color: 'text-foreground', Icon: Club },
  S: { sym: '♠', color: 'text-foreground', Icon: Spade }
};

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

// Improved card component
function Card({ card, hidden, index = 0 }) {
  if (hidden) {
    return (
      <div
        className="w-14 h-20 sm:w-16 sm:h-24 rounded-lg border-2 border-primary/50 bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-900 flex items-center justify-center shadow-lg"
        style={{ animationDelay: `${index * 0.08}s` }}
      >
        <div className="w-10 h-14 sm:w-12 sm:h-16 rounded border border-primary/30 bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
          <span className="text-primary/50 text-xl">♦</span>
        </div>
      </div>
    );
  }
  
  const s = SUITS[card.suit] || { sym: '?', color: 'text-foreground' };
  const isRed = card.suit === 'H' || card.suit === 'D';
  const textColor = isRed ? 'text-red-500' : 'text-gray-800';
  
  return (
    <div
      className={`w-14 h-20 sm:w-16 sm:h-24 rounded-lg border-2 bg-white shadow-lg flex flex-col justify-between p-1 sm:p-1.5 relative ${
        isRed ? 'border-red-200' : 'border-gray-300'
      }`}
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      {/* Top left */}
      <div className={`${textColor} leading-tight`}>
        <div className="text-xs sm:text-sm font-bold">{card.value}</div>
        <div className="text-xs sm:text-sm -mt-1">{s.sym}</div>
      </div>
      
      {/* Center suit - absolute so it doesn't affect layout */}
      <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${textColor}`}>
        <span className="text-2xl sm:text-3xl opacity-90">{s.sym}</span>
      </div>
      
      {/* Bottom right */}
      <div className={`${textColor} leading-tight self-end rotate-180`}>
        <div className="text-xs sm:text-sm font-bold">{card.value}</div>
        <div className="text-xs sm:text-sm -mt-1">{s.sym}</div>
      </div>
    </div>
  );
}

function outcomeLabel(result) {
  const map = { win: 'Win', lose: 'Lose', push: 'Push', bust: 'Bust', blackjack: 'Blackjack!', dealer_bust: 'Dealer Bust' };
  return map[result] || result;
}

function outcomeClass(result) {
  if (result === 'win' || result === 'blackjack' || result === 'dealer_bust') return 'text-emerald-400';
  if (result === 'lose' || result === 'bust') return 'text-red-400';
  return 'text-mutedForeground';
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
  } catch { return iso; }
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
  const [sellPoints, setSellPoints] = useState('');
  const [buyBackOffer, setBuyBackOffer] = useState(null);
  const [buyBackSecondsLeft, setBuyBackSecondsLeft] = useState(null);
  const [buyBackActionLoading, setBuyBackActionLoading] = useState(false);
  const navigate = useNavigate();

  const fetchConfigAndOwnership = () => {
    api.get('/casino/blackjack/config').then((r) => setConfig(r.data || { max_bet: 50_000_000 })).catch(() => {});
    api.get('/casino/blackjack/ownership').then((r) => {
      const data = r.data || null;
      setOwnership(data);
      if (data?.buy_back_offer) {
        setBuyBackOffer({ ...data.buy_back_offer, offer_id: data.buy_back_offer.offer_id || data.buy_back_offer.id });
      } else {
        setBuyBackOffer(null);
      }
    }).catch(() => setOwnership(null));
  };

  useEffect(() => {
    if (!buyBackOffer?.expires_at) { setBuyBackSecondsLeft(null); return; }
    const update = () => {
      const exp = new Date(buyBackOffer.expires_at).getTime();
      const left = Math.max(0, Math.ceil((exp - Date.now()) / 1000));
      setBuyBackSecondsLeft(left);
      if (left <= 0) setBuyBackOffer(null);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [buyBackOffer]);

  const acceptBuyBack = async () => {
    if (!buyBackOffer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      const res = await api.post('/casino/blackjack/buy-back/accept', { offer_id: buyBackOffer.offer_id });
      toast.success(res.data?.message || 'Accepted!');
      setBuyBackOffer(null);
      refreshUser();
      fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setBuyBackActionLoading(false); }
  };

  const rejectBuyBack = async () => {
    if (!buyBackOffer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      await api.post('/casino/blackjack/buy-back/reject', { offer_id: buyBackOffer.offer_id });
      toast.success('You kept the casino!');
      setBuyBackOffer(null);
      fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setBuyBackActionLoading(false); }
  };

  const fetchHistory = () => {
    api.get('/casino/blackjack/history').then((r) => setHistory(r.data?.history || [])).catch(() => {});
  };

  useEffect(() => { fetchConfigAndOwnership(); fetchHistory(); }, []);

  const handleClaim = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/blackjack/claim', { city });
      toast.success('You now own this table!');
      fetchConfigAndOwnership();
      refreshUser();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleRelinquish = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    if (!window.confirm('Give up ownership?')) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/blackjack/relinquish', { city });
      toast.success('Ownership relinquished.');
      fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleSetMaxBet = async () => {
    const city = ownership?.current_city;
    if (!city) return;
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1_000_000) { toast.error('Min $1,000,000'); return; }
    setOwnerLoading(true);
    try {
      await api.post('/casino/blackjack/set-max-bet', { city, max_bet: val });
      toast.success('Max bet updated');
      setNewMaxBet('');
      fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleTransfer = async () => {
    const city = ownership?.current_city;
    if (!city || !transferUsername.trim() || ownerLoading) return;
    if (!window.confirm(`Transfer to ${transferUsername}?`)) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/blackjack/send-to-user', { city, target_username: transferUsername.trim() });
      toast.success('Transferred');
      setTransferUsername('');
      fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleSellOnTrade = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    const points = parseInt(sellPoints);
    if (!points || points <= 0) { toast.error('Enter valid points'); return; }
    setOwnerLoading(true);
    try {
      await api.post('/casino/blackjack/sell-on-trade', { city, points });
      toast.success(`Listed for ${points.toLocaleString()} pts!`);
      setSellPoints('');
      setTimeout(() => navigate('/quick-trade'), 1500);
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
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
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setLoading(false); }
  };

  const hit = async () => {
    if (!game?.can_hit || loading) return;
    setLoading(true);
    try {
      const res = await api.post('/casino/blackjack/hit');
      const data = res.data || {};
      if (data.status === 'player_bust') {
        setGame({ ...game, ...data, can_hit: false, can_stand: false });
        toast.error(`Bust! Lost ${formatMoney(game.bet)}`);
        refreshUser(data.new_balance);
        fetchHistory();
      } else {
        setGame({ ...game, ...data });
      }
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setLoading(false); }
  };

  const stand = async () => {
    if (!game?.can_stand || loading) return;
    setLoading(true);
    setDealerRevealed(true);
    try {
      const res = await api.post('/casino/blackjack/stand');
      const data = res.data || {};
      setGame({ ...game, ...data, can_hit: false, can_stand: false });
      if (data.result === 'blackjack') toast.success(`Blackjack! Won ${formatMoney(data.payout - game.bet)}`);
      else if (data.result === 'win' || data.result === 'dealer_bust') toast.success(`Won ${formatMoney(data.payout - game.bet)}!`);
      else if (data.result === 'push') toast.info('Push. Bet returned.');
      else toast.error(`Dealer wins. Lost ${formatMoney(game.bet)}`);
      if (data.ownership_transferred) toast.success('🎰 You won the casino!');
      if (data.buy_back_offer) setBuyBackOffer(data.buy_back_offer);
      refreshUser(data.new_balance);
      fetchHistory();
      fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setLoading(false); }
  };

  const playAgain = () => { setGame(null); setDealerRevealed(false); };

  const showDealerTotal = game?.status === 'done' || dealerRevealed;
  const dealerTotal = showDealerTotal ? (game?.dealer_total ?? '?') : (game?.dealer_visible_total ?? '??');

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="blackjack-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
            🃏 Blackjack
          </h1>
          <p className="text-xs text-mutedForeground">
            Playing in <span className="text-primary font-bold">{currentCity}</span>
            {ownership?.owner_name && !isOwner && (
              <span> · Owned by <span className="text-foreground">{ownership.owner_name}</span></span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-heading">
          <span className="text-mutedForeground">Max: <span className="text-primary font-bold">{formatMoney(maxBet)}</span></span>
          {canClaim && (
            <button onClick={handleClaim} disabled={ownerLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50">
              Claim ({formatMoney(config.claim_cost)})
            </button>
          )}
        </div>
      </div>

      {/* Buy-back offer */}
      {buyBackOffer && (
        <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-heading font-bold text-primary">Buy-Back Offer</span>
              <p className="text-[10px] text-mutedForeground">
                Accept for {(buyBackOffer.points_offered || 0).toLocaleString()} pts or reject to keep table
              </p>
            </div>
            <div className="flex items-center gap-2">
              {buyBackSecondsLeft !== null && (
                <span className="text-xs font-heading text-primary tabular-nums">
                  {Math.floor(buyBackSecondsLeft / 60)}:{String(buyBackSecondsLeft % 60).padStart(2, '0')}
                </span>
              )}
              <button onClick={acceptBuyBack} disabled={buyBackActionLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50">
                Accept
              </button>
              <button onClick={rejectBuyBack} disabled={buyBackActionLoading} className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 disabled:opacity-50">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Owner Controls */}
      {isOwner && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/30`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">👑 Owner Controls</span>
            <span className={`text-xs font-heading font-bold ${(ownership?.profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              P/L: {formatMoney(ownership?.profit ?? ownership?.total_earnings ?? 0)}
            </span>
          </div>
          <div className="p-3 space-y-2">
            {/* Max Bet */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Max Bet</span>
              <input type="text" placeholder="e.g. 100000000" value={newMaxBet} onChange={(e) => setNewMaxBet(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSetMaxBet} disabled={ownerLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50">Set</button>
            </div>
            {/* Transfer */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Transfer</span>
              <input type="text" placeholder="Username" value={transferUsername} onChange={(e) => setTransferUsername(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleTransfer} disabled={ownerLoading || !transferUsername.trim()} className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 disabled:opacity-50">Send</button>
            </div>
            {/* Sell */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Sell (pts)</span>
              <input type="text" inputMode="numeric" placeholder="10000" value={sellPoints} onChange={(e) => setSellPoints(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSellOnTrade} disabled={ownerLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50">List</button>
            </div>
            {/* Relinquish */}
            <div className="flex justify-end">
              <button onClick={handleRelinquish} disabled={ownerLoading} className="text-[10px] text-red-400 hover:text-red-300 font-heading">
                Relinquish Ownership
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Area */}
      {!isOwner && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🎴 The Table</span>
          </div>
          
          <div className="p-4">
            {!game ? (
              /* Betting UI */
              <div className="flex flex-wrap items-center justify-center gap-3 py-6">
                <div className="flex items-center gap-1">
                  <span className="text-primary font-heading text-lg">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="1000"
                    value={bet}
                    onChange={(e) => setBet(e.target.value)}
                    className="w-32 bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-base text-foreground text-center focus:border-primary/50 focus:outline-none font-heading"
                  />
                </div>
                <button
                  onClick={startGame}
                  disabled={!canPlay}
                  className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded-lg px-8 py-2.5 text-sm font-heading font-bold uppercase tracking-wide border border-yellow-600/50 shadow-lg shadow-primary/20 disabled:opacity-50 transition-all touch-manipulation"
                >
                  Deal
                </button>
              </div>
            ) : (
              /* Active Game */
              <div className="space-y-6">
                {/* Dealer Hand */}
                <div className="text-center">
                  <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 bg-zinc-800/50 rounded-full">
                    <span className="text-xs text-mutedForeground uppercase tracking-wider font-heading">Dealer</span>
                    <span className={`text-base font-heading font-bold ${showDealerTotal && game?.dealer_total > 21 ? 'text-red-400' : 'text-primary'}`}>
                      {showDealerTotal ? dealerTotal : '??'}
                    </span>
                  </div>
                  <div className="flex justify-center gap-2">
                    {game.dealer_hand?.map((c, i) => (
                      <Card
                        key={i}
                        card={c}
                        hidden={game.status === 'playing' && game.dealer_hidden_count > 0 && i >= game.dealer_hand.length - game.dealer_hidden_count}
                        index={i}
                      />
                    ))}
                  </div>
                </div>

                {/* Result Banner */}
                {(game.status === 'player_bust' || game.status === 'done') && (
                  <div className={`text-center py-2 px-4 rounded-lg ${
                    game.result === 'win' || game.result === 'blackjack' || game.result === 'dealer_bust'
                      ? 'bg-emerald-500/20 border border-emerald-500/30'
                      : game.result === 'push'
                      ? 'bg-zinc-500/20 border border-zinc-500/30'
                      : 'bg-red-500/20 border border-red-500/30'
                  }`}>
                    <span className={`text-lg font-heading font-bold ${outcomeClass(game.result)}`}>
                      {outcomeLabel(game.result)}
                    </span>
                  </div>
                )}

                {/* Player Hand */}
                <div className="text-center">
                  <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 bg-zinc-800/50 rounded-full">
                    <span className="text-xs text-mutedForeground uppercase tracking-wider font-heading">You</span>
                    <span className={`text-base font-heading font-bold ${game?.player_total > 21 ? 'text-red-400' : 'text-primary'}`}>
                      {game.player_total ?? '??'}
                    </span>
                  </div>
                  <div className="flex justify-center gap-2">
                    {game.player_hand?.map((c, i) => (
                      <Card key={i} card={c} index={i} />
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-center gap-3 pt-2">
                  {game.status === 'playing' ? (
                    <>
                      <button onClick={hit} disabled={loading} className="w-28 sm:w-36 bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded-lg px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide border border-yellow-600/50 shadow-lg shadow-primary/20 disabled:opacity-50 touch-manipulation">
                        Hit
                      </button>
                      <button onClick={stand} disabled={loading} className="w-28 sm:w-36 bg-zinc-700/80 hover:bg-zinc-600/80 text-foreground rounded-lg px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide border border-zinc-600/50 disabled:opacity-50 touch-manipulation">
                        Stand
                      </button>
                    </>
                  ) : (
                    <button onClick={playAgain} className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded-lg px-8 py-3 text-sm font-heading font-bold uppercase tracking-wide border border-yellow-600/50 shadow-lg shadow-primary/20 touch-manipulation">
                      Play Again
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isOwner && (
        <div className="px-3 py-4 bg-zinc-800/30 border border-zinc-700/30 rounded-md text-center">
          <p className="text-xs text-mutedForeground">You cannot play at your own table. Travel to another city to play.</p>
        </div>
      )}

      {/* History */}
      {!isOwner && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">📜 History</span>
            <span className="text-[10px] text-mutedForeground">{history.length} games</span>
          </div>
          {history.length === 0 ? (
            <div className="p-4 text-center text-xs text-mutedForeground">No games yet</div>
          ) : (
            <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
              {history.map((item, i) => {
                const profit = (item.payout || 0) - (item.bet || 0);
                return (
                  <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-zinc-800/30 text-xs font-heading">
                    <span className="text-mutedForeground truncate">{formatHistoryDate(item.created_at)}</span>
                    <span className={outcomeClass(item.result)}>{outcomeLabel(item.result)}</span>
                    <span className="text-mutedForeground">{formatMoney(item.bet)}</span>
                    <span className={`font-bold tabular-nums ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {profit >= 0 ? '+' : ''}{formatMoney(profit)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">ℹ️ Rules</span>
        </div>
        <div className="p-3">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Get closer to 21 than the dealer</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Blackjack pays 3:2</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Dealer stands on 17</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Going over 21 = bust</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
