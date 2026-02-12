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
        className="w-14 h-20 md:w-16 md:h-24 rounded-sm border-2 border-amber-600/50 bg-gradient-to-br from-amber-900/90 to-amber-800 flex items-center justify-center shadow-lg animate-card-deal"
        style={{ animationDelay: `${index * 0.08}s` }}
      >
        <span className="text-amber-500/80 font-heading text-lg">◆</span>
      </div>
    );
  }
  const s = SUITS[card.suit] || { sym: '?', red: false };
  return (
    <div
      className={`w-14 h-20 md:w-16 md:h-24 rounded-sm border border-border bg-card flex flex-col items-center justify-center shadow-lg ${flip ? 'animate-card-flip' : 'animate-card-deal'} ${s.red ? 'text-red-500' : 'text-foreground'}`}
      style={{ animationDelay: flip ? '0s' : `${index * 0.08}s` }}
    >
      <span className="text-lg font-bold leading-none">{card.value}</span>
      <span className="text-xl leading-none">{s.sym}</span>
    </div>
  );
}

function outcomeLabel(result) {
  const map = { win: 'Win', lose: 'Lose', push: 'Push', bust: 'Bust', blackjack: 'Blackjack', dealer_bust: 'Dealer bust' };
  return map[result] || result;
}

function outcomeClass(result) {
  if (result === 'win' || result === 'blackjack' || result === 'dealer_bust') return 'text-green-600 dark:text-green-400';
  if (result === 'lose' || result === 'bust') return 'text-red-600 dark:text-red-400';
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
  const [config, setConfig] = useState({ max_bet: 50_000_000 });
  const [bet, setBet] = useState('1000');
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dealerRevealed, setDealerRevealed] = useState(false);
  const [history, setHistory] = useState([]);

  const fetchHistory = () => {
    api.get('/casino/blackjack/history').then((r) => setHistory(r.data?.history || [])).catch(() => {});
  };

  useEffect(() => {
    api.get('/casino/blackjack/config').then((r) => setConfig(r.data || { max_bet: 50_000_000 })).catch(() => {});
    fetchHistory();
  }, []);

  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const canPlay = betNum > 0 && betNum <= (config.max_bet || 0) && !loading && !game;

  const startGame = async () => {
    if (!canPlay) return;
    setLoading(true);
    setGame(null);
    setDealerRevealed(false);
    try {
      const res = await api.post('/casino/blackjack/start', { bet: betNum });
      setGame(res.data);
      if (res.data?.new_balance != null) refreshUser(res.data.new_balance);
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
    <div className={`space-y-8 ${styles.pageContent}`} data-testid="blackjack-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Blackjack</h1>
        <p className="text-mutedForeground">Enter your bet</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-4 py-3 bg-secondary/40 border-b border-border">
            <h3 className="text-lg font-heading font-semibold text-foreground">Blackjack</h3>
            <p className="text-sm text-mutedForeground">Beat the dealer to 21</p>
          </div>
          <div className="p-4 space-y-6">
            {!game ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-mutedForeground">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={bet}
                    onChange={(e) => setBet(e.target.value)}
                    className="w-32 bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground"
                  />
                </div>
                <button
                  type="button"
                  onClick={startGame}
                  disabled={!canPlay}
                  className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-2.5 px-6 transition-smooth disabled:opacity-50"
                >
                  Play
                </button>
              </div>
            ) : (
              <>
                <div className="border-b border-border pb-4">
                  <p className="text-sm font-medium text-foreground mb-2">Dealer</p>
                  <p className="text-xs text-mutedForeground mb-2">
                    Total: <span className="text-primary font-mono">{showDealerTotal ? dealerTotal : '??'}</span>
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
                <div className="border-b border-border pb-4">
                  <p className="text-sm font-medium text-foreground mb-2">You</p>
                  <p className="text-xs text-mutedForeground mb-2">
                    Total: <span className="text-primary font-mono">{game.player_total ?? '??'}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {game.player_hand?.map((c, i) => (
                      <Card key={i} card={c} index={i} />
                    ))}
                  </div>
                </div>
                {game.status === 'playing' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={hit}
                      disabled={loading}
                      className="flex-1 bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50"
                    >
                      Hit
                    </button>
                    <button
                      type="button"
                      onClick={stand}
                      disabled={loading}
                      className="flex-1 bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50"
                    >
                      Stand
                    </button>
                  </div>
                )}
                {game.status === 'player_bust' && (
                  <button type="button" onClick={playAgain} className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth">
                    Play Again
                  </button>
                )}
                {game.status === 'done' && (
                  <button type="button" onClick={playAgain} className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth">
                    Play Again
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className={`${styles.panel} rounded-md overflow-hidden`}>
            <div className="px-3 py-2 bg-secondary/40 border-b border-border">
              <h3 className="text-base font-heading font-semibold text-foreground">Information</h3>
              <p className="text-xs text-mutedForeground">See information about this casino.</p>
            </div>
            <div className="p-3 space-y-1 text-xs text-mutedForeground">
              <p><span className="text-foreground font-medium">Max bet:</span> {formatMoney(config.max_bet)}</p>
              <p>Dealer stands on 17. Blackjack pays 3:2.</p>
              <p>Get closer to 21 than the dealer without going over.</p>
            </div>
          </div>
          <div className={`${styles.panel} rounded-md overflow-hidden`}>
            <div className="px-3 py-2 bg-secondary/40 border-b border-border">
              <h3 className="text-base font-heading font-semibold text-foreground">Last 10 results</h3>
              <p className="text-xs text-mutedForeground">Your most recent bets and outcomes.</p>
            </div>
            <div className="p-3 max-h-[280px] overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-xs text-mutedForeground">No results yet. Place a bet to start.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {history.map((item, i) => {
                    const profit = (item.payout || 0) - (item.bet || 0);
                    const profitStr = profit >= 0 ? `+${formatMoney(profit)}` : formatMoney(profit);
                    const playerTotal = item.player_total != null ? item.player_total : handTotal(item.player_hand);
                    const dealerTotal = item.dealer_total != null ? item.dealer_total : handTotal(item.dealer_hand);
                    return (
                      <li key={i} className="py-1.5 border-b border-border last:border-0 space-y-0.5">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-mutedForeground">{formatHistoryDate(item.created_at)}</span>
                          <span className={`font-mono ${profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{profitStr}</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-mutedForeground">Bet {formatMoney(item.bet)}</span>
                          <span className={outcomeClass(item.result)}>{outcomeLabel(item.result)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-mutedForeground">
                          <span>You: <span className="text-foreground font-mono">{handToStr(item.player_hand)}{playerTotal != null ? ` (${playerTotal})` : ''}</span></span>
                          <span>Dealer: <span className="text-foreground font-mono">{handToStr(item.dealer_hand)}{dealerTotal != null ? ` (${dealerTotal})` : ''}</span></span>
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
    </div>
  );
}
