import { useState, useEffect } from 'react';
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

const PAY_TABLE = [
  { key: 'royal_flush', name: 'Royal Flush', multiplier: 250 },
  { key: 'straight_flush', name: 'Straight Flush', multiplier: 50 },
  { key: 'four_of_a_kind', name: 'Four of a Kind', multiplier: 25 },
  { key: 'full_house', name: 'Full House', multiplier: 9 },
  { key: 'flush', name: 'Flush', multiplier: 6 },
  { key: 'straight', name: 'Straight', multiplier: 4 },
  { key: 'three_of_a_kind', name: 'Three of a Kind', multiplier: 3 },
  { key: 'two_pair', name: 'Two Pair', multiplier: 2 },
  { key: 'jacks_or_better', name: 'Jacks or Better', multiplier: 1 },
];

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

function formatHistoryDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

function outcomeColor(handKey) {
  if (handKey === 'nothing') return '#f87171';
  if (handKey === 'jacks_or_better') return '#a1a1aa';
  return '#34d399';
}

/* ═══════════════════════════════════════════════════════
   Playing Card
   ═══════════════════════════════════════════════════════ */
function PokerCard({ card, held, onToggleHold, canHold, index, dealing, revealed }) {
  const s = SUITS[card?.suit] || { sym: '?', color: '#666' };
  const isRed = card?.suit === 'H' || card?.suit === 'D';

  return (
    <div className="flex flex-col items-center gap-0.5 sm:gap-1.5 min-w-0 w-full sm:w-auto sm:shrink-0">
      <button
        type="button"
        onClick={canHold ? onToggleHold : undefined}
        className={`vp-card-btn relative rounded-md sm:rounded-lg overflow-hidden transition-all ${canHold ? 'cursor-pointer hover:scale-[1.03] active:scale-[0.97]' : 'cursor-default'}`}
        style={{
          boxShadow: held
            ? '0 0 0 3px #d4af37, 0 6px 20px rgba(212,175,55,0.4)'
            : '0 4px 16px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)',
          transform: held ? 'translateY(-6px)' : 'translateY(0)',
          animation: dealing ? `card-deal-vp 0.35s cubic-bezier(0.2, 0.8, 0.3, 1) ${index * 0.1}s backwards` : undefined,
        }}
      >
        {!revealed ? (
          <div
            className="absolute inset-0 rounded-lg"
            style={{ background: 'linear-gradient(135deg, #1a3a7a, #0d2255)', border: '2px solid #2a4a9a' }}
          >
            <div
              className="absolute inset-1 rounded border border-white/10"
              style={{
                backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.03) 4px, rgba(255,255,255,0.03) 8px),
                  repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(255,255,255,0.03) 4px, rgba(255,255,255,0.03) 8px)`,
              }}
            >
              <div className="absolute inset-2 rounded border border-primary/20 flex items-center justify-center">
                <span className="text-primary/40 text-lg">♠</span>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="absolute inset-0 rounded-lg"
            style={{
              background: 'linear-gradient(180deg, #ffffff, #f8f8f8, #f0f0f0)',
              border: `2px solid ${isRed ? '#fca5a5' : '#d4d4d8'}`,
            }}
          >
            <div className="absolute top-0.5 left-1 sm:top-1 sm:left-1.5 leading-none" style={{ color: s.color }}>
              <div className="text-[8px] sm:text-[11px] md:text-xs font-bold">{card.value}</div>
              <div className="text-[7px] sm:text-[10px] md:text-[11px] -mt-0.5">{s.sym}</div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center" style={{ color: s.color }}>
              <span className="text-lg sm:text-2xl md:text-3xl opacity-90" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.1))' }}>{s.sym}</span>
            </div>
            <div className="absolute bottom-0.5 right-1 sm:bottom-1 sm:right-1.5 leading-none rotate-180" style={{ color: s.color }}>
              <div className="text-[8px] sm:text-[11px] md:text-xs font-bold">{card.value}</div>
              <div className="text-[7px] sm:text-[10px] md:text-[11px] -mt-0.5">{s.sym}</div>
            </div>
          </div>
        )}
      </button>
      {canHold && (
        <span
          className={`text-[8px] sm:text-[9px] font-heading font-bold uppercase tracking-wider transition-all truncate w-full text-center ${held ? 'text-primary' : 'text-emerald-200/40'}`}
        >
          {held ? 'HELD' : 'HOLD'}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Win Particles
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
        <span key={p.id} className="absolute animate-vp-particle"
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
export default function VideoPoker() {
  const [config, setConfig] = useState({ max_bet: 50_000_000, claim_cost: 500_000_000 });
  const [ownership, setOwnership] = useState(null);
  const [bet, setBet] = useState('1000000');
  const [game, setGame] = useState(null);
  const [holds, setHolds] = useState([false, false, false, false, false]);
  const [loading, setLoading] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [history, setHistory] = useState([]);
  const [showWin, setShowWin] = useState(false);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [newMaxBet, setNewMaxBet] = useState('');
  const [transferUsername, setTransferUsername] = useState('');
  const [sellPoints, setSellPoints] = useState('');

  const fetchConfigAndOwnership = () => {
    api.get('/casino/videopoker/config').then((r) => setConfig(r.data || { max_bet: 50_000_000 })).catch(() => {});
    api.get('/casino/videopoker/ownership').then((r) => setOwnership(r.data || null)).catch(() => setOwnership(null));
  };

  const fetchHistory = () => {
    api.get('/casino/videopoker/history').then((r) => setHistory(r.data?.history || [])).catch(() => {});
  };

  useEffect(() => {
    fetchConfigAndOwnership();
    fetchHistory();
    api.get('/casino/videopoker/game').then((r) => {
      if (r.data?.active) {
        setGame({ status: r.data.status, bet: r.data.bet, hand: r.data.hand });
        setHolds([false, false, false, false, false]);
      }
    }).catch(() => {});
  }, []);

  const handleClaim = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    setOwnerLoading(true);
    try { await api.post('/casino/videopoker/claim', { city }); toast.success('You now own this table!'); fetchConfigAndOwnership(); refreshUser(); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleRelinquish = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    if (!window.confirm('Give up ownership?')) return;
    setOwnerLoading(true);
    try { await api.post('/casino/videopoker/relinquish', { city }); toast.success('Ownership relinquished.'); fetchConfigAndOwnership(); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleSetMaxBet = async () => {
    const city = ownership?.current_city;
    if (!city) return;
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1_000_000) { toast.error('Min $1,000,000'); return; }
    setOwnerLoading(true);
    try { await api.post('/casino/videopoker/set-max-bet', { city, max_bet: val }); toast.success('Max bet updated'); setNewMaxBet(''); fetchConfigAndOwnership(); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleTransfer = async () => {
    const city = ownership?.current_city;
    if (!city || !transferUsername.trim() || ownerLoading) return;
    if (!window.confirm(`Transfer to ${transferUsername}?`)) return;
    setOwnerLoading(true);
    try { await api.post('/casino/videopoker/send-to-user', { city, target_username: transferUsername.trim() }); toast.success('Transferred'); setTransferUsername(''); fetchConfigAndOwnership(); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleSellOnTrade = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    const points = parseInt(sellPoints);
    if (!points || points <= 0) { toast.error('Enter valid points'); return; }
    setOwnerLoading(true);
    try { await api.post('/casino/videopoker/sell-on-trade', { city, points }); toast.success(`Listed for ${points.toLocaleString()} pts!`); setSellPoints(''); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const maxBet = ownership?.max_bet ?? config.max_bet ?? 50_000_000;
  const canDeal = betNum > 0 && betNum <= maxBet && !loading && !game;
  const isOwner = !!ownership?.is_owner;
  const canClaim = ownership?.is_unclaimed && !ownership?.owner_id;
  const currentCity = ownership?.current_city || '—';
  const isDealPhase = game?.status === 'deal';
  const isDone = game?.status === 'done';

  const deal = async () => {
    if (!canDeal) return;
    setLoading(true); setGame(null); setHolds([false, false, false, false, false]); setShowWin(false);
    try {
      const res = await api.post('/casino/videopoker/deal', { bet: betNum });
      setGame(res.data);
      setDealing(true);
      setTimeout(() => setDealing(false), 600);
      refreshUser();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setLoading(false); }
  };

  const draw = async () => {
    if (!isDealPhase || loading) return;
    setLoading(true);
    const holdIndices = holds.map((h, i) => h ? i : -1).filter((i) => i >= 0);
    try {
      const res = await api.post('/casino/videopoker/draw', { holds: holdIndices });
      const data = res.data || {};
      setDealing(true);
      setTimeout(() => setDealing(false), 600);
      setGame(data);
      const handLabel = data.hand_name || (data.hand_key === 'nothing' ? 'Nothing' : 'Hand');
      if (data.hand_key && data.hand_key !== 'nothing') {
        if (data.multiplier > 1) {
          toast.success(`${handLabel}. Won ${formatMoney(data.payout - data.bet)}`);
          setShowWin(true);
          setTimeout(() => setShowWin(false), 3000);
        } else {
          toast.info(`${handLabel}. Bet returned`);
        }
      } else {
        toast.error(`${handLabel}. Lost ${formatMoney(data.bet)}`);
      }
      refreshUser();
      fetchHistory();
      fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setLoading(false); }
  };

  const toggleHold = (idx) => {
    if (!isDealPhase) return;
    setHolds((prev) => prev.map((h, i) => i === idx ? !h : h));
  };

  const playAgain = () => { setGame(null); setHolds([false, false, false, false, false]); setShowWin(false); };

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="videopoker-page">
      <style>{CG_STYLES}</style>
      <style>{`
        @keyframes card-deal-vp {
          0% { transform: translateY(-30px) rotate(-5deg) scale(0.8); opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes vp-particle {
          0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translateY(500px) rotate(var(--p-rotate, 180deg)) scale(0.3); opacity: 0; }
        }
        @keyframes vp-result-banner {
          0% { transform: scaleX(0); opacity: 0; }
          100% { transform: scaleX(1); opacity: 1; }
        }
        .animate-vp-particle { animation: vp-particle ease-in forwards; }
        .animate-vp-result-banner { animation: vp-result-banner 0.4s cubic-bezier(0.2, 0.8, 0.3, 1) forwards; }
        .vp-card-btn { width: 100%; aspect-ratio: 2/3; max-height: 96px; }
        @media (min-width: 640px) {
          .vp-card-btn { width: clamp(52px, 18vw, 68px); height: clamp(72px, 24vw, 96px); aspect-ratio: auto; max-height: none; }
        }
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

          <div className="p-3 sm:p-5">
            {/* Pay Table */}
            <div className="mb-4 rounded-lg overflow-hidden border border-primary/30" style={{ background: 'rgba(0,0,0,0.35)' }}>
              <div className="px-3 py-1.5 border-b border-primary/20" style={{ background: 'rgba(212,175,55,0.1)' }}>
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">Jacks or Better — Pay Table</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-px p-1">
                {PAY_TABLE.map((row) => (
                  <div
                    key={row.key}
                    className={`flex items-center justify-between px-2 py-1 rounded-sm transition-all ${game?.hand_key === row.key ? 'ring-1 ring-primary' : ''}`}
                    style={{ background: game?.hand_key === row.key ? 'rgba(212,175,55,0.15)' : 'transparent' }}
                  >
                    <span className={`text-[10px] font-heading truncate ${game?.hand_key === row.key ? 'text-primary font-bold' : 'text-emerald-100/70'}`}>
                      {row.name}
                    </span>
                    <span className={`text-[10px] font-heading font-bold ml-2 ${game?.hand_key === row.key ? 'text-primary' : 'text-primary/60'}`}>
                      {row.multiplier}x
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {!game ? (
              /* ── Betting UI ── */
              <div className="flex flex-col items-center gap-5 py-4">
                <div className="text-center">
                  <p
                    className="text-sm sm:text-base font-heading font-bold uppercase tracking-[0.2em]"
                    style={{ background: 'linear-gradient(180deg, #ffd700, #c9a84c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
                  >
                    Video Poker
                  </p>
                  <p className="text-[10px] text-emerald-200/40 font-heading mt-1 uppercase tracking-wider">Jacks or Better</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-primary font-bold text-lg">$</span>
                  <FormattedNumberInput
                    value={bet}
                    onChange={(raw) => setBet(raw)}
                    placeholder="1,000,000"
                    className="w-32 sm:w-36 bg-black/30 border border-emerald-700/30 rounded-lg h-11 px-4 text-white text-base font-heading font-bold text-center focus:border-primary/60 focus:outline-none"
                  />
                </div>

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

                <button
                  onClick={deal}
                  disabled={!canDeal}
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
              <div className="space-y-4">
                {/* Bet info */}
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] font-heading px-1">
                  <span className="text-emerald-200/60">Bet: <span className="text-white font-bold">{formatMoney(game.bet)}</span></span>
                  {isDealPhase && (
                    <span className="text-emerald-200/40 uppercase tracking-wider text-center">Select cards to hold, then draw</span>
                  )}
                </div>

                {/* Cards — grid on mobile (fit 5), centered flex on desktop (fixed card size) */}
                <div className="grid grid-cols-5 gap-1 sm:flex sm:flex-nowrap sm:justify-center sm:gap-3 max-w-full w-full px-1 sm:px-0">
                  {(game.hand || []).map((card, i) => (
                    <PokerCard
                      key={`${card.suit}-${card.value}-${i}`}
                      card={card}
                      held={holds[i]}
                      onToggleHold={() => toggleHold(i)}
                      canHold={isDealPhase}
                      index={i}
                      dealing={dealing}
                      revealed={true}
                    />
                  ))}
                </div>

                {/* Result Banner */}
                {isDone && game.hand_key && (
                  <div className="flex justify-center animate-vp-result-banner">
                    <div
                      className="px-6 py-2 rounded-lg border-2"
                      style={{
                        background: `linear-gradient(180deg, ${outcomeColor(game.hand_key)}22, ${outcomeColor(game.hand_key)}11)`,
                        borderColor: `${outcomeColor(game.hand_key)}66`,
                        boxShadow: `0 0 20px ${outcomeColor(game.hand_key)}22`,
                      }}
                    >
                      <span className="text-lg sm:text-xl font-heading font-black uppercase tracking-wider" style={{ color: outcomeColor(game.hand_key) }}>
                        {game.hand_name}
                      </span>
                      {game.payout > 0 && game.payout !== game.bet && (
                        <span className="ml-3 text-sm font-heading font-bold" style={{ color: outcomeColor(game.hand_key) }}>
                          +{formatMoney(game.payout - game.bet)}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-center gap-3 pt-1">
                  {isDealPhase ? (
                    <button
                      onClick={draw}
                      disabled={loading}
                      className="rounded-lg px-10 py-3 text-sm font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40 active:scale-[0.98] transition-all"
                      style={{
                        background: 'linear-gradient(180deg, #d4af37, #a08020, #8a6e18)',
                        borderColor: '#c9a84c', color: '#1a1200',
                        boxShadow: '0 4px 16px rgba(212,175,55,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
                      }}
                    >
                      {loading ? '...' : 'Draw'}
                    </button>
                  ) : isDone ? (
                    <button
                      onClick={playAgain}
                      className="rounded-lg px-10 py-3 text-sm font-heading font-bold uppercase tracking-wider border-2 active:scale-[0.98] transition-all"
                      style={{
                        background: 'linear-gradient(180deg, #d4af37, #a08020, #8a6e18)',
                        borderColor: '#c9a84c', color: '#1a1200',
                        boxShadow: '0 4px 16px rgba(212,175,55,0.3)',
                      }}
                    >
                      Play Again
                    </button>
                  ) : null}
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
                    <span style={{ color: outcomeColor(item.hand_key) }}>{item.hand_name}</span>
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
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>9/6 Jacks or Better pay table</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>5 cards dealt, choose which to hold</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Discards replaced on draw</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Pair of Jacks or better to win</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
