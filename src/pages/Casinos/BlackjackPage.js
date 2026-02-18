import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const CG_STYLES = `
  .cg-fade-in { animation: cg-fade-in 0.4s ease-out both; }
  @keyframes cg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .cg-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const SUITS = {
  H: { sym: '♥', color: '#dc2626' },
  D: { sym: '♦', color: '#dc2626' },
  C: { sym: '♣', color: '#1c1c1c' },
  S: { sym: '♠', color: '#1c1c1c' },
};

const QUICK_BETS = [
  { label: '100K', value: 100_000, color: '#e4e4e7', text: '#000' },
  { label: '1M', value: 1_000_000, color: '#dc2626', text: '#fff' },
  { label: '5M', value: 5_000_000, color: '#16a34a', text: '#fff' },
  { label: '10M', value: 10_000_000, color: '#18181b', text: '#fff' },
  { label: '50M', value: 50_000_000, color: '#7c3aed', text: '#fff' },
];

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

function outcomeLabel(result) {
  const map = { win: 'Win', lose: 'Lose', push: 'Push', bust: 'Bust', blackjack: 'Blackjack!', dealer_bust: 'Dealer Bust' };
  return map[result] || result;
}

function outcomeColor(result) {
  if (result === 'win' || result === 'blackjack' || result === 'dealer_bust') return '#34d399';
  if (result === 'lose' || result === 'bust') return '#f87171';
  return '#a1a1aa';
}

function formatHistoryDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

/* ═══════════════════════════════════════════════════════
   Playing Card — realistic with shadow, suit, value
   ═══════════════════════════════════════════════════════ */
function PlayingCard({ card, hidden, index = 0, total }) {
  const fan = total > 1 ? (index - (total - 1) / 2) * 3 : 0;
  const offsetX = total > 1 ? (index - (total - 1) / 2) * 2 : 0;

  if (hidden) {
    return (
      <div
        className="relative w-[56px] h-[80px] sm:w-[64px] sm:h-[92px] rounded-lg overflow-hidden animate-card-deal"
        style={{
          transform: `rotate(${fan}deg) translateX(${offsetX}px)`,
          animationDelay: `${index * 0.1}s`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)',
        }}
      >
        <div
          className="absolute inset-0 rounded-lg"
          style={{
            background: 'linear-gradient(135deg, #1a3a7a, #0d2255)',
            border: '2px solid #2a4a9a',
          }}
        >
          <div
            className="absolute inset-1 rounded border border-white/10"
            style={{
              backgroundImage: `
                repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.03) 4px, rgba(255,255,255,0.03) 8px),
                repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(255,255,255,0.03) 4px, rgba(255,255,255,0.03) 8px)
              `,
            }}
          >
            <div className="absolute inset-2 rounded border border-primary/20 flex items-center justify-center">
              <span className="text-primary/40 text-lg">♠</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const s = SUITS[card.suit] || { sym: '?', color: '#666' };
  const isRed = card.suit === 'H' || card.suit === 'D';

  return (
    <div
      className="relative w-[56px] h-[80px] sm:w-[64px] sm:h-[92px] rounded-lg overflow-hidden animate-card-deal"
      style={{
        transform: `rotate(${fan}deg) translateX(${offsetX}px)`,
        animationDelay: `${index * 0.1}s`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)',
      }}
    >
      <div
        className="absolute inset-0 rounded-lg"
        style={{
          background: 'linear-gradient(180deg, #ffffff, #f8f8f8, #f0f0f0)',
          border: `2px solid ${isRed ? '#fca5a5' : '#d4d4d8'}`,
        }}
      >
        {/* Top-left corner */}
        <div className="absolute top-1 left-1.5 leading-none" style={{ color: s.color }}>
          <div className="text-[11px] sm:text-xs font-bold">{card.value}</div>
          <div className="text-[10px] sm:text-[11px] -mt-0.5">{s.sym}</div>
        </div>
        {/* Center suit */}
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: s.color }}>
          <span className="text-2xl sm:text-3xl opacity-90" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.1))' }}>{s.sym}</span>
        </div>
        {/* Bottom-right corner (rotated) */}
        <div className="absolute bottom-1 right-1.5 leading-none rotate-180" style={{ color: s.color }}>
          <div className="text-[11px] sm:text-xs font-bold">{card.value}</div>
          <div className="text-[10px] sm:text-[11px] -mt-0.5">{s.sym}</div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Win particles
   ═══════════════════════════════════════════════════════ */
function WinParticles({ active }) {
  const [particles] = useState(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i, left: 5 + Math.random() * 90,
      delay: Math.random() * 0.6, duration: 1.0 + Math.random() * 0.6,
      rotate: Math.random() * 540 - 270,
      emoji: ['🪙', '✨', '🃏', '💰'][i % 4], size: 14 + Math.random() * 10,
    }))
  );
  if (!active) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-50" aria-hidden>
      {particles.map((p) => (
        <span key={p.id} className="absolute animate-bj-particle"
          style={{ left: `${p.left}%`, top: '-5%', fontSize: p.size,
            animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
            '--p-rotate': `${p.rotate}deg` }}
        >{p.emoji}</span>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════ */
export default function Blackjack() {
  const [config, setConfig] = useState({ max_bet: 50_000_000, claim_cost: 500_000_000 });
  const [ownership, setOwnership] = useState(null);
  const [bet, setBet] = useState('1000');
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dealerRevealed, setDealerRevealed] = useState(false);
  const [history, setHistory] = useState([]);
  const [showWin, setShowWin] = useState(false);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [newMaxBet, setNewMaxBet] = useState('');
  const [transferUsername, setTransferUsername] = useState('');
  const [sellPoints, setSellPoints] = useState('');
  const [ownerBuyBack, setOwnerBuyBack] = useState('');
  const [buyBackOffer, setBuyBackOffer] = useState(null);
  const [buyBackSecondsLeft, setBuyBackSecondsLeft] = useState(null);
  const [buyBackActionLoading, setBuyBackActionLoading] = useState(false);
  const navigate = useNavigate();

  const fetchConfigAndOwnership = () => {
    api.get('/casino/blackjack/config').then((r) => setConfig(r.data || { max_bet: 50_000_000 })).catch(() => {});
    api.get('/casino/blackjack/ownership').then((r) => {
      const data = r.data || null;
      setOwnership(data);
      if (data?.buy_back_reward != null) setOwnerBuyBack(String(data.buy_back_reward));
      if (data?.buy_back_offer) {
        setBuyBackOffer({ ...data.buy_back_offer, offer_id: data.buy_back_offer.offer_id || data.buy_back_offer.id });
      } else { setBuyBackOffer(null); }
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
      setBuyBackOffer(null); refreshUser(); fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setBuyBackActionLoading(false); }
  };

  const rejectBuyBack = async () => {
    if (!buyBackOffer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      await api.post('/casino/blackjack/buy-back/reject', { offer_id: buyBackOffer.offer_id });
      toast.success('You kept the casino!');
      setBuyBackOffer(null); fetchConfigAndOwnership();
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
    try { await api.post('/casino/blackjack/claim', { city }); toast.success('You now own this table!'); fetchConfigAndOwnership(); refreshUser(); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleRelinquish = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    if (!window.confirm('Give up ownership?')) return;
    setOwnerLoading(true);
    try { await api.post('/casino/blackjack/relinquish', { city }); toast.success('Ownership relinquished.'); fetchConfigAndOwnership(); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleSetMaxBet = async () => {
    const city = ownership?.current_city;
    if (!city) return;
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1_000_000) { toast.error('Min $1,000,000'); return; }
    setOwnerLoading(true);
    try { await api.post('/casino/blackjack/set-max-bet', { city, max_bet: val }); toast.success('Max bet updated'); setNewMaxBet(''); fetchConfigAndOwnership(); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleSetBuyBackReward = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    const amount = parseInt(String(ownerBuyBack).replace(/\D/g, ''), 10);
    if (Number.isNaN(amount) || amount < 0) { toast.error('Enter 0 or more points'); return; }
    setOwnerLoading(true);
    try { await api.post('/casino/blackjack/set-buy-back-reward', { city, amount }); toast.success('Buy-back reward updated'); fetchConfigAndOwnership(); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleTransfer = async () => {
    const city = ownership?.current_city;
    if (!city || !transferUsername.trim() || ownerLoading) return;
    if (!window.confirm(`Transfer to ${transferUsername}?`)) return;
    setOwnerLoading(true);
    try { await api.post('/casino/blackjack/send-to-user', { city, target_username: transferUsername.trim() }); toast.success('Transferred'); setTransferUsername(''); fetchConfigAndOwnership(); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleSellOnTrade = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    const points = parseInt(sellPoints);
    if (!points || points <= 0) { toast.error('Enter valid points'); return; }
    setOwnerLoading(true);
    try { await api.post('/casino/blackjack/sell-on-trade', { city, points }); toast.success(`Listed for ${points.toLocaleString()} pts!`); setSellPoints(''); setTimeout(() => navigate('/quick-trade'), 1500); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
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
    setLoading(true); setGame(null); setDealerRevealed(false); setShowWin(false);
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
        refreshUser(data.new_balance); fetchHistory();
      } else { setGame({ ...game, ...data }); }
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setLoading(false); }
  };

  const stand = async () => {
    if (!game?.can_stand || loading) return;
    setLoading(true); setDealerRevealed(true);
    try {
      const res = await api.post('/casino/blackjack/stand');
      const data = res.data || {};
      setGame({ ...game, ...data, can_hit: false, can_stand: false });
      const isWin = data.result === 'blackjack' || data.result === 'win' || data.result === 'dealer_bust';
      if (data.result === 'blackjack') toast.success(`Blackjack! Won ${formatMoney(data.payout - game.bet)}`);
      else if (isWin) toast.success(`Won ${formatMoney(data.payout - game.bet)}!`);
      else if (data.result === 'push') toast.info('Push. Bet returned.');
      else toast.error(`Dealer wins. Lost ${formatMoney(game.bet)}`);
      if (isWin) { setShowWin(true); setTimeout(() => setShowWin(false), 3000); }
      if (data.ownership_transferred) toast.success('You won the casino!');
      if (data.buy_back_offer) setBuyBackOffer(data.buy_back_offer);
      refreshUser(data.new_balance); fetchHistory(); fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setLoading(false); }
  };

  const playAgain = () => { setGame(null); setDealerRevealed(false); setShowWin(false); };

  const showDealerTotal = game?.status === 'done' || dealerRevealed;
  const dealerTotal = showDealerTotal ? (game?.dealer_total ?? '?') : (game?.dealer_visible_total ?? '??');
  const gameResult = game?.result;
  const isWinResult = gameResult === 'win' || gameResult === 'blackjack' || gameResult === 'dealer_bust';
  const isDone = game?.status === 'player_bust' || game?.status === 'done';

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="blackjack-page">
      <style>{CG_STYLES}</style>
      <style>{`
        @keyframes card-deal {
          0% { transform: translateY(-30px) rotate(-5deg) scale(0.8); opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes bj-particle {
          0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translateY(500px) rotate(var(--p-rotate, 180deg)) scale(0.3); opacity: 0; }
        }
        @keyframes result-banner {
          0% { transform: scaleX(0); opacity: 0; }
          100% { transform: scaleX(1); opacity: 1; }
        }
        @keyframes result-glow {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .animate-card-deal { animation: card-deal 0.35s cubic-bezier(0.2, 0.8, 0.3, 1) backwards; }
        .animate-bj-particle { animation: bj-particle ease-in forwards; }
        .animate-result-banner { animation: result-banner 0.4s cubic-bezier(0.2, 0.8, 0.3, 1) forwards; }
      `}</style>

      <WinParticles active={showWin} />

      {/* Page header */}
      <div className="relative cg-fade-in flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] text-zinc-500 font-heading italic">
            Playing in <span className="text-primary font-bold">{currentCity}</span>
            {ownership?.owner_name && !isOwner && <span> · Owned by <span className="text-foreground">{ownership.owner_name}</span></span>}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-heading">
          <span className="text-mutedForeground">Max: <span className="text-primary font-bold">{formatMoney(maxBet)}</span></span>
          {canClaim && (
            <button onClick={handleClaim} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">
              Claim ({formatMoney(config.claim_cost)})
            </button>
          )}
        </div>
      </div>

      {/* Buy-back offer */}
      {buyBackOffer && (
        <div className="p-4 rounded-lg border-2 space-y-3" style={{ borderColor: '#c9a84c', background: 'linear-gradient(135deg, rgba(212,175,55,0.1), rgba(212,175,55,0.03))' }}>
          <h3 className="font-heading font-bold text-primary uppercase tracking-wider text-sm">Buy-Back Offer</h3>
          <p className="text-xs text-mutedForeground">Accept for {(buyBackOffer.points_offered || 0).toLocaleString()} pts or reject to keep table</p>
          <div className="flex flex-wrap items-center gap-2">
            {buyBackSecondsLeft !== null && (
              <span className="text-sm font-heading font-medium text-primary tabular-nums">
                {Math.floor(buyBackSecondsLeft / 60)}:{String(buyBackSecondsLeft % 60).padStart(2, '0')}
              </span>
            )}
            <button onClick={acceptBuyBack} disabled={buyBackActionLoading}
              className="rounded-lg px-5 py-2 text-xs font-heading font-bold uppercase border-2 disabled:opacity-40"
              style={{ background: 'linear-gradient(180deg, #d4af37, #8a6e18)', borderColor: '#c9a84c', color: '#1a1200' }}
            >Accept</button>
            <button onClick={rejectBuyBack} disabled={buyBackActionLoading}
              className="bg-zinc-800 border border-zinc-600 text-foreground px-5 py-2 rounded-lg text-xs font-heading font-bold uppercase disabled:opacity-40"
            >Reject</button>
          </div>
        </div>
      )}

      {/* Owner Controls */}
      {isOwner && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 cg-fade-in`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Owner Controls</span>
            <span className={`text-xs font-heading font-bold ${(ownership?.profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              P/L: {formatMoney(ownership?.profit ?? ownership?.total_earnings ?? 0)}
            </span>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Max Bet</span>
              <input type="text" placeholder="e.g. 100000000" value={newMaxBet} onChange={(e) => setNewMaxBet(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSetMaxBet} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">Set</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Buy-back</span>
              <FormattedNumberInput value={ownerBuyBack} onChange={setOwnerBuyBack} placeholder="0" className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSetBuyBackReward} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">Set</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Transfer</span>
              <input type="text" placeholder="Username" value={transferUsername} onChange={(e) => setTransferUsername(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleTransfer} disabled={ownerLoading || !transferUsername.trim()} className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 disabled:opacity-50">Send</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Sell (pts)</span>
              <FormattedNumberInput value={sellPoints} onChange={setSellPoints} placeholder="10,000" className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSellOnTrade} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">List</button>
            </div>
            <div className="flex justify-end">
              <button onClick={handleRelinquish} disabled={ownerLoading} className="text-[10px] text-red-400 hover:text-red-300 font-heading">Relinquish</button>
            </div>
          </div>
          <div className="cg-art-line text-primary mx-3" />
        </div>
      )}

      {/* ═══ Game Table ═══ */}
      {!isOwner && (
        <div
          className="rounded-xl overflow-hidden border-2"
          style={{
            borderColor: '#5a3e1b',
            background: 'linear-gradient(180deg, #0c3d1a 0%, #0a5e2a 20%, #0d7a35 50%, #0a5e2a 80%, #0c3d1a 100%)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5), inset 0 0 60px rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ height: 3, background: 'linear-gradient(90deg, #5a3e1b, #c9a84c, #8b6914, #c9a84c, #5a3e1b)' }} />

          <div className="p-4 sm:p-6">
            {!game ? (
              /* ── Betting UI ── */
              <div className="flex flex-col items-center gap-5 py-6">
                {/* Table text */}
                <div className="text-center">
                  <p
                    className="text-sm sm:text-base font-heading font-bold uppercase tracking-[0.2em]"
                    style={{
                      background: 'linear-gradient(180deg, #ffd700, #c9a84c)',
                      WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    }}
                  >
                    Blackjack pays 3 to 2
                  </p>
                  <p className="text-[10px] text-emerald-200/40 font-heading mt-1 uppercase tracking-wider">Dealer stands on 17</p>
                </div>

                {/* Bet input */}
                <div className="flex items-center gap-2">
                  <span className="text-primary font-bold text-lg">$</span>
                  <FormattedNumberInput
                    value={bet}
                    onChange={(raw) => setBet(raw)}
                    placeholder="1,000"
                    className="w-32 sm:w-36 bg-black/30 border border-emerald-700/30 rounded-lg h-11 px-4 text-white text-base font-heading font-bold text-center focus:border-primary/60 focus:outline-none"
                  />
                </div>

                {/* Quick bet chips */}
                <div className="flex gap-2 flex-wrap justify-center">
                  {QUICK_BETS.map((qb) => (
                    <button
                      key={qb.value}
                      onClick={() => setBet(String(qb.value))}
                      className="w-10 h-10 rounded-full text-[9px] font-bold transition-all hover:scale-110 active:scale-95"
                      style={{
                        background: `radial-gradient(circle at 40% 35%, ${qb.color}, ${qb.color}dd)`,
                        border: `2px dashed ${qb.color}88`,
                        color: qb.text,
                        boxShadow: bet === String(qb.value) ? '0 0 0 2px #d4af37, 0 3px 8px rgba(0,0,0,0.3)' : '0 2px 6px rgba(0,0,0,0.3)',
                      }}
                    >{qb.label}</button>
                  ))}
                </div>

                {/* Deal button */}
                <button
                  onClick={startGame}
                  disabled={!canPlay}
                  className="rounded-lg px-10 py-3 text-sm font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
                  style={{
                    background: 'linear-gradient(180deg, #d4af37, #a08020, #8a6e18)',
                    borderColor: '#c9a84c', color: '#1a1200',
                    boxShadow: '0 4px 16px rgba(212,175,55,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
                  }}
                >
                  {loading ? '...' : 'Deal'}
                </button>
              </div>
            ) : (
              /* ── Active Game ── */
              <div className="space-y-5">
                {/* Dealer */}
                <div className="text-center">
                  <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <span className="text-[10px] text-emerald-200/60 uppercase tracking-wider font-heading">Dealer</span>
                    <span className={`text-sm font-heading font-bold ${showDealerTotal && game?.dealer_total > 21 ? 'text-red-400' : 'text-primary'}`}>
                      {showDealerTotal ? dealerTotal : '??'}
                    </span>
                  </div>
                  <div className="flex justify-center gap-1.5 sm:gap-2">
                    {game.dealer_hand?.map((c, i) => (
                      <PlayingCard
                        key={i}
                        card={c}
                        hidden={game.status === 'playing' && game.dealer_hidden_count > 0 && i >= game.dealer_hand.length - game.dealer_hidden_count}
                        index={i}
                        total={game.dealer_hand.length}
                      />
                    ))}
                  </div>
                </div>

                {/* Result Banner */}
                {isDone && (
                  <div className="flex justify-center animate-result-banner">
                    <div
                      className="px-6 py-2 rounded-lg border-2"
                      style={{
                        background: `linear-gradient(180deg, ${outcomeColor(gameResult)}22, ${outcomeColor(gameResult)}11)`,
                        borderColor: `${outcomeColor(gameResult)}66`,
                        boxShadow: `0 0 20px ${outcomeColor(gameResult)}22`,
                      }}
                    >
                      <span className="text-lg sm:text-xl font-heading font-black uppercase tracking-wider" style={{ color: outcomeColor(gameResult) }}>
                        {outcomeLabel(gameResult)}
                      </span>
                      {game.payout > 0 && (
                        <span className="ml-3 text-sm font-heading font-bold" style={{ color: outcomeColor(gameResult) }}>
                          {isWinResult ? `+${formatMoney(game.payout - game.bet)}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Player */}
                <div className="text-center">
                  <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <span className="text-[10px] text-emerald-200/60 uppercase tracking-wider font-heading">You</span>
                    <span className={`text-sm font-heading font-bold ${game?.player_total > 21 ? 'text-red-400' : 'text-primary'}`}>
                      {game.player_total ?? '??'}
                    </span>
                  </div>
                  <div className="flex justify-center gap-1.5 sm:gap-2">
                    {game.player_hand?.map((c, i) => (
                      <PlayingCard key={i} card={c} index={i} total={game.player_hand.length} />
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-center gap-3 pt-2">
                  {game.status === 'playing' ? (
                    <>
                      <button onClick={hit} disabled={loading}
                        className="w-28 sm:w-36 rounded-lg py-3 text-sm font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40 active:scale-[0.98] transition-all"
                        style={{ background: 'linear-gradient(180deg, #d4af37, #a08020)', borderColor: '#c9a84c', color: '#1a1200', boxShadow: '0 4px 12px rgba(212,175,55,0.2)' }}
                      >Hit</button>
                      <button onClick={stand} disabled={loading}
                        className="w-28 sm:w-36 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg py-3 text-sm font-heading font-bold uppercase tracking-wider border border-zinc-600 disabled:opacity-40 active:scale-[0.98] transition-all"
                      >Stand</button>
                    </>
                  ) : (
                    <button onClick={playAgain}
                      className="rounded-lg px-10 py-3 text-sm font-heading font-bold uppercase tracking-wider border-2 active:scale-[0.98] transition-all"
                      style={{ background: 'linear-gradient(180deg, #d4af37, #a08020)', borderColor: '#c9a84c', color: '#1a1200', boxShadow: '0 4px 16px rgba(212,175,55,0.3)' }}
                    >Play Again</button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{ height: 3, background: 'linear-gradient(90deg, #5a3e1b, #c9a84c, #8b6914, #c9a84c, #5a3e1b)' }} />
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
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">History</span>
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
                    <span style={{ color: outcomeColor(item.result) }}>{outcomeLabel(item.result)}</span>
                    <span className="text-mutedForeground">{formatMoney(item.bet)}</span>
                    <span className="font-bold tabular-nums" style={{ color: profit >= 0 ? '#34d399' : '#f87171' }}>
                      {profit >= 0 ? '+' : ''}{formatMoney(profit)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Rules */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Rules</span>
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
