import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const CG_STYLES = `
  .cg-fade-in { animation: cg-fade-in 0.4s ease-out both; }
  @keyframes cg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .cg-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const RACE_DURATION_MS = 5000;
const GATE_DELAY_MS = 900;
const HORSE_COLORS = ['#1a5c2a','#dc2626','#2563eb','#16a34a','#6b7280','#ec4899','#18181b'];
const COMMENTARY_LINES = [
  'They\'re off!', 'And they\'re racing!', 'Thundering down the track!',
  'Coming into the stretch!', 'It\'s neck and neck!', 'Digging deep!',
  'Closing fast!', 'At the wire!', 'What a finish!',
];

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function oddsLabel(odds) {
  if (odds === 1) return 'Evens';
  return `${odds}:1`;
}

function formatHistoryDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || x.loc?.join('.')).join('; ') || fallback;
  return fallback;
}

/* ═══════════════════════════════════════════════════════
   Race Track with lanes, fences, finish line, sky, crowd, boards
   ═══════════════════════════════════════════════════════ */
function RaceTrack({
  lanes,
  racing,
  raceStarted,
  gatesOpen,
  winnerId,
  selectedHorseId,
  liveCommentary,
  livePositions,
  showGates,
}) {
  const skyGradient = 'linear-gradient(180deg, #87ceeb 0%, #b0d4e8 25%, #c9e0ed 60%, #2d5a12 85%, #1a3a0a 100%)';
  return (
    <div className="relative rounded-lg overflow-hidden" style={{ background: '#1a3a0a' }}>
      {/* Sky strip + crowd silhouettes */}
      <div className="relative" style={{ height: 28, background: skyGradient }}>
        <div className="absolute inset-0 flex items-end justify-around px-2 pt-1 opacity-40">
          {Array.from({ length: 12 }, (_, i) => (
            <div
              key={i}
              className="w-4 h-3 rounded-t"
              style={{
                background: `linear-gradient(180deg, #1a1a1a 0%, #2a2a2a 100%)`,
                transform: `scale(${0.7 + (i % 3) * 0.15})`,
                marginBottom: 2,
              }}
            />
          ))}
        </div>
        {/* Sponsor boards */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 gap-1">
          <div className="px-2 py-0.5 rounded-sm text-[8px] font-heading font-bold uppercase tracking-wider opacity-70" style={{ background: 'rgba(0,0,0,0.4)', color: '#d4af37' }}>Official Partner</div>
          <div className="px-2 py-0.5 rounded-sm text-[8px] font-heading font-bold uppercase tracking-wider opacity-70" style={{ background: 'rgba(0,0,0,0.4)', color: '#d4af37' }}>Live Odds</div>
        </div>
      </div>

      {/* Top grass + rail / fence */}
      <div style={{ height: 10, background: 'linear-gradient(180deg, #2d5a12, #1a3a0a)' }}>
        <div className="flex items-end h-full px-1">
          {Array.from({ length: 30 }, (_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center">
              <div className="w-px h-2 bg-white/40" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.2)' }} />
              {i % 3 === 0 && <div className="w-2 h-px bg-white/30" />}
            </div>
          ))}
        </div>
      </div>

      {/* Dirt track with patch variation */}
      <div
        className="relative"
        style={{
          background: `
            linear-gradient(180deg, #5a3e1b, #7a5a2e 20%, #6b4e24 50%, #7a5a2e 80%, #5a3e1b),
            radial-gradient(ellipse 80% 50% at 20% 30%, rgba(90,60,25,0.4), transparent),
            radial-gradient(ellipse 60% 40% at 70% 70%, rgba(100,70,30,0.3), transparent)
          `,
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.3), inset 0 -2px 6px rgba(0,0,0,0.3)',
        }}
      >
        {/* Starting gates (closed until "They're off!") */}
        {showGates && !gatesOpen && (
          <div className="absolute left-0 top-0 bottom-0 w-14 sm:w-16 z-20 flex" style={{ background: 'linear-gradient(90deg, rgba(40,30,20,0.95), rgba(50,35,22,0.9))' }}>
            {[0,1,2,3,4,5,6].map((i) => (
              <div key={i} className="flex-1 border-r border-amber-900/80 flex items-center justify-center">
                <div className="w-1 h-full bg-amber-800/60 rounded-sm" />
              </div>
            ))}
          </div>
        )}
        {/* Starting gate line (when gates open) */}
        <div className="absolute left-8 sm:left-12 top-0 bottom-0 w-px z-10" style={{ background: 'repeating-linear-gradient(180deg, #fff 0, #fff 4px, transparent 4px, transparent 8px)', opacity: 0.35 }} />

        {/* Finish line (checkered) */}
        <div className="absolute right-3 sm:right-4 top-0 bottom-0 w-3 sm:w-4 z-10 opacity-60"
          style={{
            backgroundImage: `
              linear-gradient(45deg, #fff 25%, transparent 25%),
              linear-gradient(-45deg, #fff 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #fff 75%),
              linear-gradient(-45deg, transparent 75%, #fff 75%)
            `,
            backgroundSize: '6px 6px',
            backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
          }}
        />

        {/* Lanes */}
        <div className="py-1">
          {lanes.map((lane, idx) => {
            const color = HORSE_COLORS[idx % HORSE_COLORS.length];
            const isWinner = lane.horse.id === winnerId;
            const isSelected = lane.horse.id === selectedHorseId;

            return (
              <div key={lane.horse.id} className="flex items-center px-1 sm:px-2" style={{ height: 40 }}>
                {/* Horse name badge */}
                <div
                  className={`w-14 sm:w-20 shrink-0 flex items-center gap-1 px-1 py-0.5 rounded-sm text-[9px] sm:text-[10px] font-heading truncate ${isSelected ? 'font-bold' : ''}`}
                  style={{
                    background: 'rgba(0,0,0,0.3)',
                    borderLeft: `3px solid ${color}`,
                    color: isSelected ? '#d4af37' : '#ccc',
                  }}
                >
                  {lane.horse.name}
                </div>

                {/* Lane track */}
                <div className="flex-1 relative mx-1 h-8 rounded-sm overflow-hidden" style={{ background: 'rgba(0,0,0,0.15)' }}>
                  {/* Lane divider (top) */}
                  <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.15) 0, rgba(255,255,255,0.15) 8px, transparent 8px, transparent 16px)' }} />
                  {/* Lane divider (bottom) */}
                  <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.15) 0, rgba(255,255,255,0.15) 8px, transparent 8px, transparent 16px)' }} />

                  {/* Horse runner — only advance when gates open + race started */}
                  <div
                    className={`absolute top-0 h-full flex items-center ${racing && raceStarted && gatesOpen ? 'horse-lean' : ''}`}
                    style={{
                      left: (raceStarted && gatesOpen) ? `calc(${lane.finishPct}% - 28px)` : '2px',
                      transition: (raceStarted && gatesOpen)
                        ? `left ${RACE_DURATION_MS}ms cubic-bezier(0.22, 0.35, 0.35, 1)` : 'none',
                      transitionDelay: (raceStarted && gatesOpen) ? `${lane.animationDelayMs ?? 0}ms` : '0ms',
                    }}
                  >
                    {/* Dust trail when racing */}
                    {racing && raceStarted && gatesOpen && (
                      <div className="absolute -left-3 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-50">
                        {[0, 1, 2, 3].map((d) => (
                          <div
                            key={d}
                            className="w-1.5 h-1.5 rounded-full animate-dust"
                            style={{
                              background: '#a08060',
                              animationDelay: `${d * 0.12}s`,
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {/* Jockey circle with silks (stripes) */}
                    <div
                      className={`relative w-7 h-7 rounded-full flex items-center justify-center text-sm shadow-lg overflow-hidden ${racing && raceStarted && gatesOpen ? 'animate-horse-bounce' : ''} ${isWinner && !racing ? 'ring-2 ring-yellow-400' : ''}`}
                      style={{
                        background: `repeating-linear-gradient(45deg, ${color}, ${color} 3px, rgba(255,255,255,0.15) 3px, rgba(255,255,255,0.15) 5px)`,
                        border: '2px solid rgba(255,255,255,0.3)',
                        boxShadow: `0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.2), 0 0 0 ${isWinner && !racing ? '2px #eab308' : '0 transparent'}`,
                      }}
                    >
                      <span className="relative z-10 drop-shadow-sm" style={{ fontSize: 14 }}>🏇</span>
                    </div>
                    {/* Position badge only after race (during race would spoil winner from predetermined order) */}
                    {!racing && result?.finishOrder && (() => {
                      const pos = result.finishOrder.indexOf(lane.horse.id) + 1;
                      return pos ? (
                        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black bg-primary text-black shadow" style={{ border: '1px solid rgba(0,0,0,0.3)' }}>
                          {pos}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>

                {/* Odds badge */}
                <div className="w-10 sm:w-12 shrink-0 text-center text-[9px] font-heading font-bold text-primary/70">
                  {oddsLabel(lane.horse.odds)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom grass + rail */}
      <div style={{ height: 10, background: 'linear-gradient(0deg, #2d5a12, #1a3a0a)' }}>
        <div className="flex items-start h-full px-1">
          {Array.from({ length: 30 }, (_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center">
              {i % 3 === 0 && <div className="w-1.5 h-px bg-white/20" />}
              <div className="w-px h-1.5 bg-white/30" />
            </div>
          ))}
        </div>
      </div>

      {/* Race status / commentary overlay */}
      {racing && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-0.5">
          {!gatesOpen && showGates && (
            <span className="px-3 py-1.5 rounded-full text-[11px] font-heading font-black uppercase tracking-wider animate-pulse"
              style={{ background: 'rgba(0,0,0,0.7)', color: '#fbbf24', border: '2px solid rgba(251,191,36,0.5)' }}
            >
              They're off!
            </span>
          )}
          {gatesOpen && (
            <span className="px-3 py-1 rounded-full text-[10px] font-heading font-bold uppercase tracking-wider animate-pulse"
              style={{ background: 'rgba(0,0,0,0.6)', color: '#d4af37', border: '1px solid rgba(212,175,55,0.3)' }}
            >
              {liveCommentary || 'Race in progress'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Win celebration
   ═══════════════════════════════════════════════════════ */
function WinCelebration({ active }) {
  const [particles] = useState(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: 5 + Math.random() * 90,
      delay: Math.random() * 0.6,
      duration: 1.0 + Math.random() * 0.6,
      rotate: Math.random() * 540 - 270,
      emoji: ['🏆', '🪙', '✨', '🎉'][i % 4],
      size: 14 + Math.random() * 10,
    }))
  );
  if (!active) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-50" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute animate-race-particle"
          style={{
            left: `${p.left}%`,
            top: '-5%',
            fontSize: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--p-rotate': `${p.rotate}deg`,
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Quick bet chips
   ═══════════════════════════════════════════════════════ */
const QUICK_BETS = [
  { label: '100K', value: 100_000, color: '#e4e4e7', text: '#000' },
  { label: '1M', value: 1_000_000, color: '#dc2626', text: '#fff' },
  { label: '5M', value: 5_000_000, color: '#16a34a', text: '#fff' },
  { label: '10M', value: 10_000_000, color: '#18181b', text: '#fff' },
];

export default function HorseRacingPage() {
  const [config, setConfig] = useState({ horses: [], max_bet: 10_000_000, claim_cost: 500_000_000 });
  const [ownership, setOwnership] = useState(null);
  const [selectedHorseId, setSelectedHorseId] = useState(null);
  const [bet, setBet] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [racing, setRacing] = useState(false);
  const [result, setResult] = useState(null);
  const [raceProgress, setRaceProgress] = useState(null);
  const [raceStarted, setRaceStarted] = useState(false);
  const [history, setHistory] = useState([]);
  const [showWin, setShowWin] = useState(false);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [newMaxBet, setNewMaxBet] = useState('');
  const [transferUsername, setTransferUsername] = useState('');
  const [sellPoints, setSellPoints] = useState('');
  const [skipAnimation, setSkipAnimation] = useState(false);
  const [skipReplay, setSkipReplay] = useState(false);
  const [gatesOpen, setGatesOpen] = useState(false);
  const [liveCommentary, setLiveCommentary] = useState('');
  const [livePositions, setLivePositions] = useState(null);
  const [photoFinishRevealed, setPhotoFinishRevealed] = useState(false);
  const raceEndRef = useRef(null);
  const gateTimeoutRef = useRef(null);
  const raceStartTimeRef = useRef(null);
  const liveIntervalRef = useRef(null);
  const commentaryIntervalRef = useRef(null);
  const lastRaceForReplayRef = useRef(null);
  const trackContainerRef = useRef(null);

  const fetchHistory = useCallback(() => {
    api.get('/casino/horseracing/history').then((r) => setHistory(r.data?.history || [])).catch(() => {});
  }, []);

  const fetchConfigAndOwnership = useCallback(() => {
    api.get('/casino/horseracing/config').then((r) => {
      const data = r.data || {};
      setConfig({
        horses: data.horses || [],
        max_bet: data.max_bet || 10_000_000,
        house_edge: data.house_edge ?? 0.05,
        claim_cost: data.claim_cost ?? 500_000_000,
      });
      setSelectedHorseId((prev) => {
        if (prev) return prev;
        const horses = data.horses || [];
        return horses.length ? horses[0].id : null;
      });
    }).catch(() => {});
    api.get('/casino/horseracing/ownership').then((r) => setOwnership(r.data || null)).catch(() => setOwnership(null));
  }, []);

  useEffect(() => { fetchConfigAndOwnership(); fetchHistory(); }, [fetchConfigAndOwnership, fetchHistory]);
  useEffect(() => () => {
    if (raceEndRef.current) clearTimeout(raceEndRef.current);
    if (gateTimeoutRef.current) clearTimeout(gateTimeoutRef.current);
    if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
    if (commentaryIntervalRef.current) clearInterval(commentaryIntervalRef.current);
  }, []);

  const handleClaim = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/claim', { city });
      toast.success('You now own the track!');
      fetchConfigAndOwnership(); refreshUser();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleRelinquish = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    if (!window.confirm('Give up ownership?')) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/relinquish', { city });
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
      await api.post('/casino/horseracing/set-max-bet', { city, max_bet: val });
      toast.success('Max bet updated');
      setNewMaxBet(''); fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleTransfer = async () => {
    const city = ownership?.current_city;
    if (!city || !transferUsername.trim() || ownerLoading) return;
    if (!window.confirm(`Transfer to ${transferUsername}?`)) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/send-to-user', { city, target_username: transferUsername.trim() });
      toast.success('Transferred');
      setTransferUsername(''); fetchConfigAndOwnership();
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
      await api.post('/casino/horseracing/sell-on-trade', { city, points });
      toast.success(`Listed for ${points.toLocaleString()} pts!`);
      setSellPoints('');
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const horses = config.horses || [];
  const selectedHorse = horses.find((h) => h.id === selectedHorseId);
  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const maxBet = ownership?.max_bet ?? config.max_bet ?? 10_000_000;
  const returnsAmount = selectedHorse && betNum > 0
    ? Math.floor(betNum * (1 + selectedHorse.odds) * (1 - (config.house_edge || 0.05)))
    : 0;
  const isOwner = !!ownership?.is_owner;
  const canClaim = ownership?.is_unclaimed && !ownership?.owner_id;
  const currentCity = ownership?.current_city || '—';
  const canPlaceSameBet = selectedHorseId != null && betNum > 0 && betNum <= maxBet && !loading && !racing;
  const canBet = !isOwner && canPlaceSameBet && !result;

  const placeBet = async (sameBet = false) => {
    const allowed = sameBet ? (!isOwner && canPlaceSameBet) : canBet;
    if (!allowed) return;
    setLoading(true);
    setResult(null);
    setRaceProgress(null);
    setShowWin(false);
    try {
      const res = await api.post('/casino/horseracing/race', { horse_id: selectedHorseId, bet: betNum });
      const data = res.data || {};
      setLoading(false);
      setRacing(true);
      setRaceStarted(false);

      const winnerId = data.winner_id;
      const horsesList = data.horses || horses;
      const finishPcts = Array.isArray(data.finish_pcts) && data.finish_pcts.length === horsesList.length
        ? data.finish_pcts
        : horsesList.map((h) => (h.id === winnerId ? 100 : 55 + Math.random() * 40));
      const animationDelays = horsesList.map(() => Math.floor(Math.random() * 120));
      const finishOrder = Array.isArray(data.finish_order) ? data.finish_order : null;
      const photoFinish = !!data.photo_finish;

      setGatesOpen(false);
      setPhotoFinishRevealed(false);
      setLivePositions(null);
      setLiveCommentary(COMMENTARY_LINES[0]);

      const durationMs = skipAnimation ? 0 : RACE_DURATION_MS;
      const gateDelay = skipAnimation ? 0 : GATE_DELAY_MS;
      const totalDuration = gateDelay + durationMs;

      setRaceProgress({
        winnerId,
        finishPcts,
        horses: horsesList,
        finishOrder,
        photoFinish,
        won: data.won,
        payout: data.payout || 0,
        animationDelays,
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          trackContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });

      if (!skipAnimation) {
        requestAnimationFrame(() => { requestAnimationFrame(() => setRaceStarted(true)); });
        gateTimeoutRef.current = setTimeout(() => {
          setGatesOpen(true);
          raceStartTimeRef.current = Date.now();
          let commentaryIdx = 0;
          commentaryIntervalRef.current = setInterval(() => {
            commentaryIdx = (commentaryIdx + 1) % COMMENTARY_LINES.length;
            setLiveCommentary(COMMENTARY_LINES[commentaryIdx]);
          }, 1300);
          liveIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - raceStartTimeRef.current;
            const pct = Math.min(1, elapsed / RACE_DURATION_MS);
            const currentPcts = horsesList.map((h, idx) => pct * finishPcts[idx]);
            const order = horsesList.map((h, idx) => ({ id: h.id, pct: currentPcts[idx] })).sort((a, b) => b.pct - a.pct);
            const positions = {};
            order.forEach((o, rank) => { positions[o.id] = rank + 1; });
            setLivePositions(positions);
          }, 180);
        }, gateDelay);
      } else {
        setGatesOpen(true);
        setRaceStarted(true);
      }

      raceEndRef.current = setTimeout(() => {
        if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
        if (commentaryIntervalRef.current) { clearInterval(commentaryIntervalRef.current); commentaryIntervalRef.current = null; }
        setLivePositions(null);
        setRacing(false);
        setRaceStarted(false);
        const resultPayload = {
          won: data.won,
          payout: data.payout || 0,
          winner_name: data.winner_name,
          new_balance: data.new_balance,
          finishOrder: finishOrder || (horsesList.map((h, i) => ({ id: h.id, name: h.name, pct: finishPcts[i] })).sort((a, b) => b.pct - a.pct).map((o) => o.id)),
          finishPcts,
          horses: horsesList,
          photoFinish,
        };
        lastRaceForReplayRef.current = { winnerId, finishPcts, horses: horsesList, animationDelays, finishOrder, photoFinish };
        if (photoFinish) {
          setResult({ ...resultPayload, photoFinishPending: true });
          setPhotoFinishRevealed(false);
          setTimeout(() => {
            setPhotoFinishRevealed(true);
            setResult((prev) => prev ? { ...prev, photoFinishPending: false } : prev);
          }, 1400);
        } else {
          setResult(resultPayload);
        }
        setRaceProgress(null);
        if (data.won) {
          toast.success(`${data.winner_name} wins! +${formatMoney(data.payout - betNum)}`);
          setShowWin(true);
          setTimeout(() => setShowWin(false), 3000);
        } else {
          toast.error(`${data.winner_name} won. Lost ${formatMoney(betNum)}`);
        }
        if (data.new_balance != null) refreshUser(data.new_balance);
        fetchHistory();
      }, totalDuration);
    } catch (e) {
      setLoading(false);
      toast.error(apiErrorDetail(e, 'Failed'));
    }
  };

  const playAgain = () => { setResult(null); setRaceProgress(null); setRaceStarted(false); setGatesOpen(false); };

  const replayRace = () => {
    const last = lastRaceForReplayRef.current;
    if (!last) return;
    if (skipReplay) return;
    if (gateTimeoutRef.current) clearTimeout(gateTimeoutRef.current);
    if (raceEndRef.current) clearTimeout(raceEndRef.current);
    if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
    if (commentaryIntervalRef.current) clearInterval(commentaryIntervalRef.current);
    setResult(null);
    setPhotoFinishRevealed(false);
    setLiveCommentary(COMMENTARY_LINES[0]);
    setLivePositions(null);
    setGatesOpen(false);
    setRaceProgress({
      winnerId: last.winnerId,
      finishPcts: last.finishPcts,
      horses: last.horses,
      finishOrder: last.finishOrder,
      photoFinish: last.photoFinish,
      animationDelays: last.animationDelays,
    });
    setRacing(true);
    setRaceStarted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        trackContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    gateTimeoutRef.current = setTimeout(() => {
        setGatesOpen(true);
        raceStartTimeRef.current = Date.now();
        let commentaryIdx = 0;
        commentaryIntervalRef.current = setInterval(() => {
          commentaryIdx = (commentaryIdx + 1) % COMMENTARY_LINES.length;
          setLiveCommentary(COMMENTARY_LINES[commentaryIdx]);
        }, 1300);
        const horsesList = last.horses;
        const finishPcts = last.finishPcts;
        liveIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - raceStartTimeRef.current;
          const pct = Math.min(1, elapsed / RACE_DURATION_MS);
          const currentPcts = horsesList.map((h, idx) => pct * finishPcts[idx]);
          const order = horsesList.map((h, idx) => ({ id: h.id, pct: currentPcts[idx] })).sort((a, b) => b.pct - a.pct);
          const positions = {};
          order.forEach((o, rank) => { positions[o.id] = rank + 1; });
          setLivePositions(positions);
        }, 180);
      }, GATE_DELAY_MS);
      raceEndRef.current = setTimeout(() => {
        if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
        if (commentaryIntervalRef.current) { clearInterval(commentaryIntervalRef.current); commentaryIntervalRef.current = null; }
        setLivePositions(null);
        setRacing(false);
        setRaceStarted(false);
        setRaceProgress(null);
    }, GATE_DELAY_MS + RACE_DURATION_MS);
  };

  const raceLanes = raceProgress
    ? raceProgress.horses.map((h, idx) => ({
        horse: h,
        finishPct: raceProgress.finishPcts[idx],
        animationDelayMs: (raceProgress.animationDelays || [])[idx] ?? 0,
      }))
    : horses.map((h) => ({ horse: h, finishPct: 0, animationDelayMs: 0 }));

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="horse-racing-page">
      <style>{CG_STYLES}</style>
      <style>{`
        @keyframes horse-bounce {
          0%, 100% { transform: translateY(0) rotate(-0.5deg); }
          18% { transform: translateY(-2px) rotate(0.5deg); }
          36% { transform: translateY(0) rotate(-0.3deg); }
          54% { transform: translateY(-3px) rotate(0.8deg); }
          72% { transform: translateY(-1px) rotate(0deg); }
        }
        @keyframes dust {
          0% { opacity: 0.6; transform: translateX(0) scale(1); }
          100% { opacity: 0; transform: translateX(-14px) scale(0.2); }
        }
        @keyframes race-particle {
          0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translateY(500px) rotate(var(--p-rotate, 180deg)) scale(0.3); opacity: 0; }
        }
        @keyframes result-pop {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes trophy-glow {
          0%, 100% { text-shadow: 0 0 10px rgba(234,179,8,0.3); }
          50% { text-shadow: 0 0 25px rgba(234,179,8,0.7), 0 0 50px rgba(234,179,8,0.3); }
        }
        @keyframes horse-lean {
          0%, 85% { transform: translateX(0); }
          100% { transform: translateX(3px); }
        }
        .horse-lean { animation: horse-lean 5s ease-out forwards; }
        .animate-horse-bounce { animation: horse-bounce 0.25s ease-in-out infinite; }
        .animate-dust { animation: dust 0.6s ease-out infinite; }
        .animate-race-particle { animation: race-particle ease-in forwards; }
        .animate-result-pop { animation: result-pop 0.5s cubic-bezier(0.2, 0.8, 0.3, 1.1) forwards; }
        .animate-trophy-glow { animation: trophy-glow 1.5s ease-in-out infinite; }
      `}</style>

      <WinCelebration active={showWin} />

      {/* Page header */}
      <div className="relative cg-fade-in flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Casino</p>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 tracking-wider uppercase">Horse Racing</h1>
          <p className="text-[10px] text-zinc-500 font-heading italic">
            Playing in <span className="text-primary font-bold">{currentCity}</span>
            {ownership?.owner_name && !isOwner && <span> · Owned by <span className="text-foreground">{ownership.owner_name}</span></span>}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-heading">
          <span className="text-mutedForeground">Max: <span className="text-primary font-bold">{formatMoney(maxBet)}</span></span>
          {canClaim && (
            <button onClick={handleClaim} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">
              Buy ({formatMoney(config.claim_cost)})
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
              <input type="text" placeholder="e.g. 10000000" value={newMaxBet} onChange={(e) => setNewMaxBet(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSetMaxBet} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">Set</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Transfer</span>
              <input type="text" placeholder="Username" value={transferUsername} onChange={(e) => setTransferUsername(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleTransfer} disabled={ownerLoading || !transferUsername.trim()} className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 disabled:opacity-50">Send</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Sell (pts)</span>
              <input type="text" inputMode="numeric" placeholder="10000" value={sellPoints} onChange={(e) => setSellPoints(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSellOnTrade} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">List</button>
            </div>
            <div className="flex justify-end">
              <button onClick={handleRelinquish} disabled={ownerLoading} className="text-[10px] text-red-400 hover:text-red-300 font-heading">Relinquish</button>
            </div>
          </div>
          <div className="cg-art-line text-primary mx-3" />
        </div>
      )}

      {/* ═══ Game Area ═══ */}
      {!isOwner ? (
        <div className="space-y-4">
          {/* Track — scroll target when race starts (mobile) */}
          <div
            ref={trackContainerRef}
            className="rounded-xl overflow-hidden border-2 scroll-mt-4"
            style={{
              borderColor: '#5a3e1b',
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            }}
          >
            {/* Scoreboard bar */}
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{
                background: 'linear-gradient(180deg, #1a1612, #0f0d0a)',
                borderBottom: '2px solid #5a3e1b',
              }}
            >
              <span className="text-[10px] font-heading text-primary uppercase tracking-[0.2em]">Race Track</span>
              {selectedHorse && !racing && !result && (
                <span className="text-[10px] font-heading text-mutedForeground">
                  Pick: <span className="text-white font-bold">{selectedHorse.name}</span>
                  <span className="text-primary ml-1">({oddsLabel(selectedHorse.odds)})</span>
                </span>
              )}
              {racing && (
                <span className="text-[10px] font-heading text-primary animate-pulse">LIVE</span>
              )}
            </div>

            <RaceTrack
              lanes={raceLanes}
              racing={racing}
              raceStarted={raceStarted}
              gatesOpen={gatesOpen}
              winnerId={raceProgress?.winnerId}
              selectedHorseId={selectedHorseId}
              liveCommentary={liveCommentary}
              livePositions={livePositions}
              showGates={!skipAnimation && !!raceProgress}
            />

            {/* Bottom scoreboard */}
            <div
              className="px-3 py-1.5"
              style={{
                background: 'linear-gradient(0deg, #1a1612, #0f0d0a)',
                borderTop: '2px solid #5a3e1b',
              }}
            >
              {result ? (
                <div className="space-y-2">
                  {result.photoFinishPending && !photoFinishRevealed && (
                    <div className="flex items-center justify-center gap-2 py-2 animate-pulse">
                      <span className="text-lg">📷</span>
                      <span className="text-sm font-heading font-bold text-primary">Photo finish! Reviewing...</span>
                    </div>
                  )}
                  {(photoFinishRevealed || !result.photoFinishPending) && (
                    <>
                      <div className="flex items-center justify-center gap-3 animate-result-pop">
                        <span className={`text-2xl ${result.won ? 'animate-trophy-glow' : ''}`}>
                          {result.won ? '🏆' : '💀'}
                        </span>
                        <div className="text-center">
                          <span className={`text-sm font-heading font-bold ${result.won ? 'text-emerald-400' : 'text-red-400'}`}>
                            {result.won ? 'Winner!' : 'Better luck next time'}
                          </span>
                          <span className="text-[10px] text-mutedForeground ml-2">
                            {result.winner_name}
                          </span>
                        </div>
                        <span className={`text-sm font-heading font-bold ${result.won ? 'text-emerald-400' : 'text-red-400'}`}>
                          {result.won ? `+${formatMoney(result.payout - betNum)}` : `-${formatMoney(betNum)}`}
                        </span>
                      </div>
                      {/* Full finishing order */}
                      {result.finishOrder && result.horses && result.finishPcts && (
                        <div className="mt-2 pt-2 border-t border-white/10">
                          <p className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Finishing order</p>
                          <div className="flex flex-wrap justify-center gap-x-4 gap-y-0.5 text-[10px] font-heading">
                            {(result.finishOrder || []).map((horseId, idx) => {
                              const horse = (result.horses || []).find((h) => h.id === horseId);
                              const pctIdx = (result.horses || []).findIndex((h) => h.id === horseId);
                              const pct = (result.finishPcts || [])[pctIdx];
                              const lengthsBehind = idx === 0 ? '' : ` (${(100 - pct).toFixed(1)}L)`;
                              return (
                                <span key={horseId} className={idx === 0 ? 'text-primary font-bold' : 'text-mutedForeground'}>
                                  {idx + 1}. {horse?.name || horseId}{lengthsBehind}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {lastRaceForReplayRef.current && (
                        <button
                          type="button"
                          onClick={replayRace}
                          className="mt-2 w-full py-1.5 rounded text-[10px] font-heading font-bold uppercase border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
                        >
                          Watch again
                        </button>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-[10px] text-mutedForeground font-heading">
                  <span>5% house edge</span>
                  <span className="text-primary/30">|</span>
                  <span>Max: {formatMoney(maxBet)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Betting panel (below track) */}
          {!racing && !result && (
            <div
              className="rounded-xl overflow-hidden border-2"
              style={{
                borderColor: '#5a3e1b',
                background: 'linear-gradient(180deg, #0c3d1a 0%, #0a5e2a 50%, #0c3d1a 100%)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.4), inset 0 0 40px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ height: 3, background: 'linear-gradient(90deg, #5a3e1b, #c9a84c, #8b6914, #c9a84c, #5a3e1b)' }} />

              <div className="p-4 space-y-4">
                {/* Horse selection */}
                <div>
                  <p className="text-[10px] font-heading text-emerald-200/60 uppercase tracking-wider mb-2">Select Horse</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {horses.map((h, idx) => {
                      const color = HORSE_COLORS[idx % HORSE_COLORS.length];
                      const isSelected = selectedHorseId === h.id;
                      return (
                        <button
                          key={h.id}
                          onClick={() => setSelectedHorseId(h.id)}
                          className={`relative flex items-center gap-2 py-2.5 px-2.5 rounded-lg border-2 transition-all text-left ${
                            isSelected
                              ? 'border-primary/70 shadow-lg'
                              : 'border-white/10 hover:border-white/20'
                          }`}
                          style={{
                            background: isSelected
                              ? 'rgba(212,175,55,0.1)'
                              : 'rgba(0,0,0,0.2)',
                          }}
                        >
                          {/* Silk color */}
                          <div
                            className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] shadow-inner"
                            style={{
                              background: `radial-gradient(circle at 40% 35%, ${color}, ${color}aa)`,
                              border: '1.5px solid rgba(255,255,255,0.2)',
                            }}
                          >
                            🏇
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs font-heading truncate ${isSelected ? 'text-primary font-bold' : 'text-white'}`}>
                              {h.name}
                            </p>
                            <p className="text-[9px] text-emerald-200/40 font-heading">{oddsLabel(h.odds)}</p>
                          </div>
                          {isSelected && (
                            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary shadow-sm" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Bet + Race */}
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[140px]">
                    <p className="text-[10px] font-heading text-emerald-200/60 uppercase tracking-wider mb-1.5">Stake</p>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary font-bold text-sm">$</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={bet}
                        onChange={(e) => setBet(e.target.value)}
                        className="w-full bg-black/30 border border-emerald-700/30 rounded-lg h-10 pl-7 pr-3 text-white text-sm font-heading font-bold focus:border-primary/60 focus:outline-none"
                      />
                    </div>
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {QUICK_BETS.map((qb) => (
                        <button
                          key={qb.value}
                          onClick={() => setBet(String(qb.value))}
                          className="w-8 h-8 rounded-full text-[8px] font-bold transition-all hover:scale-105 active:scale-95"
                          style={{
                            background: `radial-gradient(circle at 40% 35%, ${qb.color}, ${qb.color}dd)`,
                            border: `2px dashed ${qb.color}88`,
                            color: qb.text,
                            boxShadow: bet === String(qb.value) ? '0 0 0 2px #d4af37' : '0 2px 4px rgba(0,0,0,0.3)',
                          }}
                        >
                          {qb.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="text-right pb-1">
                    <p className="text-[10px] font-heading text-emerald-200/40 uppercase tracking-wider">Returns</p>
                    <p className="text-lg font-heading font-bold text-primary">{formatMoney(returnsAmount)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={skipAnimation} onChange={(e) => setSkipAnimation(e.target.checked)} className="w-3.5 h-3.5 rounded accent-primary" />
                    <span className="text-[10px] text-emerald-200/50 font-heading">Skip animation</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={skipReplay} onChange={(e) => setSkipReplay(e.target.checked)} className="w-3.5 h-3.5 rounded accent-primary" />
                    <span className="text-[10px] text-emerald-200/50 font-heading">Skip replay</span>
                  </label>
                </div>

                <button
                  onClick={() => placeBet(false)}
                  disabled={!canBet}
                  className="w-full rounded-lg py-3 text-sm font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
                  style={{
                    background: 'linear-gradient(180deg, #d4af37, #a08020, #8a6e18)',
                    borderColor: '#c9a84c',
                    color: '#1a1200',
                    boxShadow: '0 4px 16px rgba(212,175,55,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
                  }}
                >
                  Place Bet & Race
                </button>
              </div>

              <div style={{ height: 3, background: 'linear-gradient(90deg, #5a3e1b, #c9a84c, #8b6914, #c9a84c, #5a3e1b)' }} />
            </div>
          )}

          {/* Play again buttons */}
          {result && !racing && (
            <div className="flex gap-2">
              <button
                onClick={() => { playAgain(); setTimeout(() => placeBet(true), 0); }}
                disabled={!canPlaceSameBet}
                className="flex-1 rounded-lg py-3 text-sm font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40 active:scale-[0.98] transition-all"
                style={{
                  background: 'linear-gradient(180deg, #d4af37, #a08020, #8a6e18)',
                  borderColor: '#c9a84c',
                  color: '#1a1200',
                  boxShadow: '0 4px 16px rgba(212,175,55,0.3)',
                }}
              >
                Same Bet
              </button>
              <button
                onClick={playAgain}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-foreground rounded-lg py-3 text-sm font-heading font-bold uppercase border border-zinc-600 transition-all active:scale-[0.98]"
              >
                Change Bet
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-4 bg-zinc-800/30 border border-zinc-700/30 rounded-md text-center">
          <p className="text-xs text-mutedForeground">You cannot bet at your own track. Travel to another city to play.</p>
        </div>
      )}

      {/* History */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">History</span>
          <span className="text-[10px] text-mutedForeground">{history.length} races</span>
        </div>
        {history.length === 0 ? (
          <div className="p-4 text-center text-xs text-mutedForeground">No races yet</div>
        ) : (
          <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
            {history.map((item, i) => {
              const profit = (item.payout || 0) - (item.bet || 0);
              return (
                <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-zinc-800/30 text-xs font-heading">
                  <span className="text-mutedForeground truncate">{formatHistoryDate(item.created_at)}</span>
                  <span className="text-foreground truncate">{item.horse_name}</span>
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

      {/* Rules */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Rules</span>
        </div>
        <div className="p-3">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Pick a horse and place your bet</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Lower odds = more likely to win</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Higher odds = bigger payout</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>5% house edge on winnings</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
