import { useCallback, useEffect, useMemo, useState } from 'react';
import { Skull, Shovel, Clock3, Coins, Sparkles, Gem, AlertTriangle, ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const GR_STYLES = `
  @keyframes gr-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes gr-dig { 0%, 100% { transform: translateY(0) rotate(0deg); } 25% { transform: translateY(-2px) rotate(-1deg); } 50% { transform: translateY(1px) rotate(1deg); } 75% { transform: translateY(-1px) rotate(-0.5deg); } }
  @keyframes gr-fog { 0% { transform: translateX(-6%); opacity: 0.18; } 100% { transform: translateX(6%); opacity: 0.3; } }
  @keyframes gr-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(var(--noir-primary-rgb), 0.35); } 50% { box-shadow: 0 0 0 5px rgba(var(--noir-primary-rgb), 0); } }
  @keyframes gr-shake { 0%,100% { transform: translateX(0) rotate(0); } 15% { transform: translateX(-4px) rotate(-1.5deg); } 30% { transform: translateX(4px) rotate(1.5deg); } 45% { transform: translateX(-3px) rotate(-1deg); } 60% { transform: translateX(3px) rotate(1deg); } 75% { transform: translateX(-2px); } }
  @keyframes gr-dirt { 0% { opacity: 1; transform: translate(0, 0) scale(1) rotate(0deg); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.3) rotate(var(--rot)); } }
  @keyframes gr-unearthed { 0% { opacity: 0; transform: translateY(12px) scale(0.85); } 60% { transform: translateY(-3px) scale(1.03); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes gr-moon-pulse { 0%,100% { opacity: 0.85; } 50% { opacity: 1; filter: drop-shadow(0 0 12px rgba(180,180,220,0.5)); } }
  @keyframes gr-shovel-dig { 0% { transform: rotate(0deg); } 20% { transform: rotate(-28deg); } 50% { transform: rotate(6deg); } 70% { transform: rotate(-10deg); } 100% { transform: rotate(0deg); } }
  @keyframes gr-star-twinkle { 0%,100% { opacity: 0.25; } 50% { opacity: 0.85; } }
  @keyframes gr-hand-rise { 0% { transform: translateY(10px) rotate(-15deg); opacity: 0; } 100% { transform: translateY(0) rotate(0deg); opacity: 0.5; } }
  @keyframes gr-reward-glow { 0%,100% { box-shadow: 0 0 8px rgba(var(--noir-primary-rgb), 0.2); } 50% { box-shadow: 0 0 20px rgba(var(--noir-primary-rgb), 0.5), 0 0 40px rgba(var(--noir-primary-rgb), 0.15); } }
  .gr-fade-in { animation: gr-fade-in .35s ease-out both; }
  .gr-dig { animation: gr-dig .55s ease-in-out infinite; }
  .gr-fog { animation: gr-fog 7s ease-in-out infinite alternate; }
  .gr-glow { animation: gr-glow 1.7s ease-in-out infinite; }
  .gr-shake { animation: gr-shake 0.5s ease-in-out; }
  .gr-unearthed { animation: gr-unearthed 0.5s ease-out both; }
  .gr-moon-pulse { animation: gr-moon-pulse 4s ease-in-out infinite; }
  .gr-reward-glow { animation: gr-reward-glow 1.5s ease-in-out infinite; }
  .gr-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatCountdown(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}h ${m}m ${r}s`;
}

function rewardText(reward) {
  const r = reward || {};
  if (r.kind === 'nothing') return 'Empty grave. Nothing found.';
  if (r.kind === 'cash') return `Found stash: ${formatMoney(r.money)}`;
  if (r.kind === 'bullets') return `Found ammo: ${Number(r.bullets || 0).toLocaleString()} bullets`;
  if (r.kind === 'points') return `Found intel: ${Number(r.points || 0).toLocaleString()} points`;
  if (r.kind === 'tokens') {
    const parts = (r.tokens || []).map((t) => `${Number(t.amount || 0)} ${String(t.token_type || '').replace(/_/g, ' ')}`);
    return parts.length ? `Found token bundle: ${parts.join(', ')}` : 'Found tokens.';
  }
  if (r.kind === 'car' && r.car) return `You found the keys to "${r.car.name}"`;
  return 'The grave gave up something.';
}

function rewardIcon(reward) {
  const k = reward?.kind;
  if (k === 'cash') return <Coins size={14} className="text-emerald-400" />;
  if (k === 'bullets') return <Sparkles size={14} className="text-amber-400" />;
  if (k === 'points') return <Gem size={14} className="text-sky-400" />;
  if (k === 'tokens') return <Sparkles size={14} className="text-primary" />;
  if (k === 'car') return <Gem size={14} className="text-violet-400" />;
  return <Skull size={14} className="text-zinc-500" />;
}

function formatRecentAttemptLine(row) {
  const attemptNo = Number(row?.attempt_number || 0);
  const result = rewardText(row?.reward);
  const cost = formatMoney(row?.attempt_cost);
  const at = row?.attempted_at ? new Date(row.attempted_at).toLocaleString() : '—';
  return `#${attemptNo} · ${result} · Cost ${cost} · ${at}`;
}

const STARS = [
  { x: 30, y: 12, r: 1 }, { x: 85, y: 8, r: 0.7 }, { x: 140, y: 18, r: 1.1 },
  { x: 200, y: 6, r: 0.8 }, { x: 250, y: 22, r: 0.6 }, { x: 310, y: 10, r: 0.9 },
  { x: 355, y: 16, r: 0.7 }, { x: 170, y: 28, r: 0.5 }, { x: 380, y: 5, r: 0.8 },
  { x: 60, y: 25, r: 0.6 }, { x: 120, y: 5, r: 0.9 }, { x: 270, y: 14, r: 0.7 },
];

function GraveyardScene() {
  return (
    <div className="w-full h-28 overflow-hidden pointer-events-none select-none" aria-hidden>
      <svg viewBox="0 0 400 110" className="w-full h-full" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="gr-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06060e" />
            <stop offset="60%" stopColor="#0a0a16" />
            <stop offset="100%" stopColor="#0e0e1a" />
          </linearGradient>
          <radialGradient id="gr-moongl" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="rgba(180,180,220,0.12)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <linearGradient id="gr-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#141420" />
            <stop offset="100%" stopColor="#0e0e18" />
          </linearGradient>
        </defs>
        <rect width="400" height="110" fill="url(#gr-sky)" />
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="rgba(255,255,255,0.5)"
            style={{ animation: `gr-star-twinkle ${2 + (i % 3)}s ${(i * 0.7) % 3}s ease-in-out infinite` }} />
        ))}
        <circle cx="340" cy="22" r="35" fill="url(#gr-moongl)" className="gr-moon-pulse" />
        <circle cx="340" cy="22" r="10" fill="#b8b8d8" opacity="0.85" />
        <circle cx="345" cy="19" r="9" fill="#06060e" />
        <g stroke="#1a1a28" fill="none" strokeLinecap="round" strokeWidth="2.5">
          <line x1="55" y1="95" x2="55" y2="45" />
          <line x1="55" y1="55" x2="38" y2="30" />
          <line x1="55" y1="50" x2="68" y2="28" />
          <line x1="55" y1="65" x2="42" y2="48" />
          <line x1="55" y1="70" x2="70" y2="52" />
        </g>
        <path d="M0 88 Q40 80 80 86 Q120 92 160 84 Q200 78 240 85 Q280 90 320 82 Q360 78 400 84 L400 110 L0 110 Z" fill="url(#gr-ground)" />
        <g fill="#181824" stroke="#1e1e2c" strokeWidth="0.5">
          <path d="M120 88 L120 65 Q120 55 130 55 Q140 55 140 65 L140 88 Z" />
          <rect x="115" y="86" width="30" height="3" rx="1" />
        </g>
        <g fill="#181824" stroke="#1e1e2c" strokeWidth="0.5">
          <rect x="155" y="62" width="4" height="26" rx="0.5" />
          <rect x="150" y="67" width="14" height="3" rx="0.5" />
          <rect x="149" y="86" width="16" height="3" rx="1" />
        </g>
        <g fill="#181824" stroke="#1e1e2c" strokeWidth="0.5">
          <path d="M195 84 L195 60 Q195 50 203 50 Q211 50 211 60 L211 84 Z" />
          <rect x="191" y="82" width="24" height="3" rx="1" />
        </g>
        <g fill="#181824" stroke="#1e1e2c" strokeWidth="0.5" transform="rotate(-8, 240, 85)">
          <path d="M235 85 L235 72 Q235 65 240 65 Q245 65 245 72 L245 85 Z" />
        </g>
        <g fill="#181824" stroke="#1e1e2c" strokeWidth="0.5">
          <path d="M275 86 L275 68 Q275 60 282 60 Q289 60 289 68 L289 86 Z" />
          <rect x="271" y="84" width="22" height="3" rx="1" />
        </g>
        <ellipse cx="100" cy="95" rx="120" ry="10" fill="rgba(120,120,150,0.06)" className="gr-fog" />
        <ellipse cx="300" cy="98" rx="100" ry="8" fill="rgba(120,120,150,0.04)" className="gr-fog" style={{ animationDelay: '3.5s' }} />
      </svg>
    </div>
  );
}

function TombstoneArt({ digging }) {
  return (
    <div className={`relative mx-auto ${digging ? 'gr-shake' : ''}`} style={{ width: 140, height: 130 }}>
      <svg viewBox="0 0 140 130" className="w-full h-full">
        <defs>
          <linearGradient id="gr-stone" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#35354a" />
            <stop offset="100%" stopColor="#25253a" />
          </linearGradient>
          <linearGradient id="gr-dirt-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a1a24" />
            <stop offset="100%" stopColor="#121218" />
          </linearGradient>
        </defs>
        <ellipse cx="70" cy="115" rx="65" ry="12" fill="url(#gr-dirt-g)" />
        <ellipse cx="70" cy="113" rx="55" ry="6" fill="#1e1e28" />
        <path d="M40 110 L40 45 Q40 22 70 22 Q100 22 100 45 L100 110 Z" fill="url(#gr-stone)" stroke="#3a3a50" strokeWidth="1" />
        <path d="M48 105 L48 50 Q48 32 70 32 Q92 32 92 50 L92 105 Z" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        <text x="70" y="56" textAnchor="middle" fontSize="11" fontWeight="bold" fill="rgba(180,180,200,0.35)" fontFamily="serif" letterSpacing="2">R.I.P.</text>
        <line x1="52" y1="65" x2="88" y2="65" stroke="rgba(180,180,200,0.15)" strokeWidth="0.5" />
        <circle cx="70" cy="78" r="6" fill="none" stroke="rgba(180,180,200,0.15)" strokeWidth="0.7" />
        <circle cx="67" cy="77" r="1.2" fill="rgba(180,180,200,0.12)" />
        <circle cx="73" cy="77" r="1.2" fill="rgba(180,180,200,0.12)" />
        <path d="M68 81 L70 83 L72 81" stroke="rgba(180,180,200,0.1)" strokeWidth="0.5" fill="none" />
        <path d="M62 70 L58 82 L60 88 L56 100" stroke="rgba(0,0,0,0.25)" strokeWidth="0.6" fill="none" />
        <path d="M80 75 L83 88 L81 95" stroke="rgba(0,0,0,0.2)" strokeWidth="0.5" fill="none" />
        <g stroke="#1a3a1a" strokeWidth="1" fill="none" strokeLinecap="round">
          <path d="M25 112 Q22 104 20 108" />
          <path d="M30 111 Q28 103 27 107" />
          <path d="M108 111 Q111 103 113 107" />
          <path d="M114 112 Q117 105 115 109" />
        </g>
        <g style={{ transformOrigin: '115px 85px', animation: digging ? 'gr-shovel-dig 0.55s ease-in-out infinite' : undefined }}>
          <line x1="115" y1="50" x2="115" y2="112" stroke="#8B7355" strokeWidth="2" strokeLinecap="round" />
          <path d="M109 44 L115 30 L121 44 Q115 48 109 44 Z" fill="#555" stroke="#666" strokeWidth="0.5" />
          <line x1="110" y1="108" x2="120" y2="108" stroke="#8B7355" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>
      {digging && <DirtBurst />}
    </div>
  );
}

function DirtBurst() {
  const particles = Array.from({ length: 14 }, (_, i) => {
    const angle = -30 - Math.random() * 120;
    const dist = 25 + Math.random() * 45;
    const dx = `${Math.cos((angle * Math.PI) / 180) * dist}px`;
    const dy = `${Math.sin((angle * Math.PI) / 180) * dist}px`;
    const rot = `${Math.random() * 360}deg`;
    const colors = ['#4a3a2a', '#3a2a1a', '#5a4a3a', '#2a2a1a', '#6a5a4a'];
    return { dx, dy, rot, delay: Math.random() * 0.15, size: 3 + Math.random() * 5, color: colors[i % 5] };
  });
  return (
    <div style={{ position: 'absolute', bottom: '18%', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }} aria-hidden>
      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute', width: p.size, height: p.size,
          borderRadius: i % 2 === 0 ? '50%' : '2px',
          background: p.color,
          '--dx': p.dx, '--dy': p.dy, '--rot': p.rot,
          animation: `gr-dirt 0.6s ${p.delay}s ease-out forwards`, opacity: 0,
        }} />
      ))}
    </div>
  );
}

export default function GraveRobber() {
  const [status, setStatus] = useState(null);
  const [starting, setStarting] = useState(false);
  const [digging, setDigging] = useState(false);
  const [latest, setLatest] = useState(null);

  const fetchStatus = useCallback(async (silent = false) => {
    try {
      const res = await api.get('/grave-robber/status');
      setStatus(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load Grave Robber');
      setStatus(null);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (!status?.cooldown_active || !status?.cooldown_remaining_seconds) return undefined;
    const id = setInterval(() => {
      setStatus((prev) => {
        if (!prev?.cooldown_active) return prev;
        const next = Math.max(0, Number(prev.cooldown_remaining_seconds || 0) - 1);
        return {
          ...prev,
          cooldown_remaining_seconds: next,
          cooldown_active: next > 0,
          cooldown_until: next > 0 ? prev.cooldown_until : null,
        };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [status?.cooldown_active, status?.cooldown_remaining_seconds]);

  const attemptsUsed = Number(status?.attempts_used || 0);
  const attemptsTotal = Number(status?.attempts_total || 50);
  const attemptsRemaining = Number(status?.attempts_remaining || 0);
  const progressPct = attemptsTotal > 0 ? Math.min(100, (attemptsUsed / attemptsTotal) * 100) : 0;
  const canStart = !status?.cooldown_active && !status?.run_started;
  const canDig = !!status?.run_started && attemptsRemaining > 0 && !status?.cooldown_active;
  const totalSpent = Number(status?.total_spent || 0);
  const totalRewardsCash = Number(status?.total_rewards_cash || 0);
  const totalNetCash = Number(status?.total_net_cash || (totalRewardsCash - totalSpent));
  const globalSpent = Number(status?.global_cash_spent || 0);
  const globalCashWon = Number(status?.global_cash_won || 0);
  const globalNetCash = Number(status?.global_net_cash || (globalCashWon - globalSpent));

  const tierChips = useMemo(() => {
    const list = [];
    const tiers = Number(status?.tier_count || 20);
    const activeTier = Number(status?.tier_index || 0);
    for (let i = 0; i < tiers; i += 1) list.push({ i, active: i === activeTier, done: i < activeTier });
    return list;
  }, [status?.tier_count, status?.tier_index]);

  const onStartRun = async () => {
    setStarting(true);
    try {
      const res = await api.post('/grave-robber/start-run');
      toast.success(res.data?.message || 'Run started');
      setLatest(null);
      await fetchStatus(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start run');
    } finally {
      setStarting(false);
    }
  };

  const onDig = async () => {
    setDigging(true);
    try {
      const res = await api.post('/grave-robber/attempt');
      setLatest(res.data?.attempt || null);
      if (res.data?.hitlist_event?.bounty_cash) {
        toast.warning(`You were spotted and added to hitlist for ${formatMoney(res.data.hitlist_event.bounty_cash)}.`);
      }
      refreshUser();
      await fetchStatus(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Dig failed');
    } finally {
      setDigging(false);
    }
  };

  const onCopyRecent = async (row) => {
    const line = formatRecentAttemptLine(row);
    try {
      await navigator.clipboard.writeText(line);
      toast.success('Copied line to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  };

  if (!status) {
    return (
      <div className={`space-y-3 ${styles.pageContent} mobile-page-root`}>
        <style>{GR_STYLES}</style>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="grave-robber-page">
      <style>{GR_STYLES}</style>

      <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <GraveyardScene />
        <div className="absolute inset-0 pointer-events-none opacity-40 gr-fog bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_65%)]" />
        <div className="px-4 py-3 relative">
          <div className="flex items-center gap-2">
            <Skull size={16} className="text-primary/80" />
            <h1 className="text-[11px] font-heading font-bold uppercase tracking-[0.2em] text-primary">Grave Robber</h1>
          </div>
          <p className="text-[10px] text-zinc-500 font-heading italic mt-1">
            Disturb the fallen gangsters. Some graves are empty. Some are loaded.
          </p>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-heading">
            <div className="rounded border border-primary/15 bg-black/20 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Run</p>
              <p className="text-foreground font-bold tabular-nums">{attemptsUsed}/{attemptsTotal}</p>
            </div>
            <div className="rounded border border-primary/15 bg-black/20 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Current cost</p>
              <p className="text-primary font-bold tabular-nums">{formatMoney(status?.current_attempt_cost || 0)}</p>
            </div>
            <div className="rounded border border-primary/15 bg-black/20 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Next cost</p>
              <p className="text-amber-400 font-bold tabular-nums">{formatMoney(status?.next_attempt_cost || 0)}</p>
            </div>
          </div>

          <div className="mt-2">
            <div className="h-2 rounded bg-zinc-900/70 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-zinc-600 via-primary to-amber-400 transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-1 text-[9px] text-zinc-500 font-heading">
              Progress {progressPct.toFixed(1)}% · Cost scales +{Math.round((Number(status?.tier_multiplier || 1.15) - 1) * 100)}% every {status?.tier_step_percent || 5}%.
            </p>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {tierChips.map((t) => (
              <span
                key={t.i}
                className={`h-2 w-2 rounded-full border ${
                  t.active ? 'bg-primary border-primary/80 gr-glow' : t.done ? 'bg-amber-500/70 border-amber-500/80' : 'bg-zinc-700 border-zinc-600'
                }`}
                title={`Tier ${t.i + 1}`}
              />
            ))}
          </div>

          {status?.cooldown_active && (
            <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 flex items-center gap-2 text-[10px] font-heading text-amber-300">
              <Clock3 size={12} className="shrink-0" />
              Cooldown active: {formatCountdown(status.cooldown_remaining_seconds)}
            </div>
          )}

          <div className="mt-3 rounded border border-primary/20 bg-primary/5 px-2.5 py-2">
            <p className="text-[9px] font-heading font-bold uppercase tracking-[0.14em] text-primary mb-1">How it works</p>
            <ul className="space-y-0.5 text-[9px] text-zinc-500 font-heading">
              <li>Run = 50 digs. Start at {formatMoney(status?.base_attempt_cost || 1_000_000)} per dig.</li>
              <li>Cost rises by +{Math.round((Number(status?.tier_multiplier || 1.15) - 1) * 100)}% every {status?.tier_step_percent || 5}% progress.</li>
              <li>After dig #50, cooldown is {status?.cooldown_hours || 24}h before a new run.</li>
              <li>Possible outcomes: nothing, cash, bullets, points, tokens, or a non-exclusive car.</li>
              <li>
                Heat: about {Math.round(Number(status?.jail_chance_per_dig ?? 0.04) * 100)}% chance per dig of
                {' '}{Number(status?.jail_seconds_on_caught ?? 60)}s jail (unbreakable for that term).
              </li>
              <li>Profit/Loss below tracks cash only (other rewards are extra value).</li>
            </ul>
          </div>
        </div>
        <div className="gr-art-line text-primary mx-3 mb-1" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">Dig Site</p>
            <TombstoneArt digging={digging} />
            <p className="text-[10px] text-zinc-500 font-heading text-center">
              Spend cash to crack open tombs. Misses happen. Big hits do too.
            </p>
            <div className="flex items-center gap-2">
              {canStart ? (
                <button
                  type="button"
                  onClick={onStartRun}
                  disabled={starting}
                  className="flex-1 py-2 rounded border border-primary/40 bg-primary/15 text-primary font-heading font-bold uppercase tracking-wider text-[10px] hover:bg-primary/25 disabled:opacity-50"
                >
                  {starting ? 'Starting...' : 'Start Run (50 Graves)'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onDig}
                  disabled={!canDig || digging}
                  className="flex-1 py-2 rounded border border-primary/40 bg-primary/15 text-primary font-heading font-bold uppercase tracking-wider text-[10px] hover:bg-primary/25 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Shovel size={12} className={digging ? 'gr-dig' : ''} />
                  {digging ? 'Digging...' : 'Dig Next Grave'}
                </button>
              )}
            </div>
            {!canStart && !canDig && !status?.cooldown_active && (
              <div className="text-[10px] text-zinc-500 font-heading rounded border border-zinc-700/40 bg-zinc-800/20 px-2 py-1.5">
                Run is complete. Wait out cooldown to start again.
              </div>
            )}
          </div>
          <div className="gr-art-line text-primary mx-3 mb-1" />
        </div>

        <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">Last Dig</p>
            {latest ? (
              <div className={`rounded border px-2.5 py-2 gr-unearthed ${latest.reward?.kind === 'nothing' ? 'border-zinc-700/60 bg-zinc-800/30' : 'border-primary/30 bg-primary/10 gr-reward-glow'}`}>
                <div className="flex items-center gap-1.5">
                  {rewardIcon(latest.reward)}
                  <p className="text-[10px] font-heading font-bold text-foreground">Attempt #{latest.attempt_number}</p>
                </div>
                <p className={`text-[10px] font-heading mt-1 ${latest.reward?.kind === 'nothing' ? 'text-zinc-500' : 'text-zinc-300'}`}>{rewardText(latest.reward)}</p>
                <p className="text-[9px] text-zinc-500 font-heading mt-1">
                  Spent {formatMoney(latest.attempt_cost)} this dig.
                </p>
              </div>
            ) : (
              <div className="rounded border border-zinc-700/50 bg-zinc-800/20 px-2.5 py-2 text-[10px] text-zinc-500 font-heading">
                No dig yet in this session.
              </div>
            )}
          </div>
          <div className="gr-art-line text-primary mx-3 mb-1" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`} style={{ animationDelay: '0.06s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2 border-b border-primary/15">
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">What You Can Win</p>
            <p className="text-[9px] text-zinc-500 font-heading">Values below use your current dig cost.</p>
          </div>
          <div className="p-2.5 space-y-1.5">
            {(status?.possible_wins || []).map((w, idx) => (
              <div key={`${w.kind}-${idx}`} className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5 flex items-center gap-2">
                <div className="shrink-0">{rewardIcon({ kind: w.kind })}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-heading text-foreground">
                    {w.label} <span className="text-zinc-500">({Number(w.chance_pct || 0)}%)</span>
                  </p>
                  {typeof w.details === 'string' ? (
                    <p className="text-[9px] text-zinc-500 font-heading">{w.details}</p>
                  ) : (
                    <p className="text-[9px] text-zinc-500 font-heading">
                      {w.kind === 'cash' && `Range ${formatMoney(w.details?.min)} - ${formatMoney(w.details?.max)}`}
                      {w.kind === 'bullets' && `Range ${Number(w.details?.min || 0).toLocaleString()} - ${Number(w.details?.max || 0).toLocaleString()} bullets`}
                      {w.kind === 'points' && `Range ${Number(w.details?.min || 0).toLocaleString()} - ${Number(w.details?.max || 0).toLocaleString()} points (cap ${Number(w.details?.max_cap || 100)})`}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="gr-art-line text-primary mx-3 mb-1" />
        </div>

        <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`} style={{ animationDelay: '0.07s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2 border-b border-primary/15">
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">Profit / Loss</p>
            <p className="text-[9px] text-zinc-500 font-heading">Cash-only run tracker.</p>
          </div>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-heading">
            <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Spent</p>
              <p className="text-rose-400 font-bold tabular-nums">{formatMoney(totalSpent)}</p>
            </div>
            <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Cash won</p>
              <p className="text-emerald-400 font-bold tabular-nums">{formatMoney(totalRewardsCash)}</p>
            </div>
            <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Net</p>
              <p className={`font-bold tabular-nums ${totalNetCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {totalNetCash >= 0 ? '+' : '-'}{formatMoney(Math.abs(totalNetCash))}
              </p>
            </div>
          </div>
          <div className="px-3 pb-2">
            <p className="text-[9px] text-zinc-600 font-heading">
              Net uses cash in vs cash out only. Bullets, points, tokens, and cars are extra value not included in this line.
            </p>
          </div>
          <div className="gr-art-line text-primary mx-3 mb-1" />
        </div>
      </div>

      <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`} style={{ animationDelay: '0.075s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2 border-b border-primary/15">
          <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">Game-Wide Profit / Loss</p>
          <p className="text-[9px] text-zinc-500 font-heading">All players combined (cash-only).</p>
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-heading">
          <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
            <p className="text-zinc-500 uppercase tracking-wider">Spent</p>
            <p className="text-rose-400 font-bold tabular-nums">{formatMoney(globalSpent)}</p>
          </div>
          <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
            <p className="text-zinc-500 uppercase tracking-wider">Cash won</p>
            <p className="text-emerald-400 font-bold tabular-nums">{formatMoney(globalCashWon)}</p>
          </div>
          <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
            <p className="text-zinc-500 uppercase tracking-wider">Net</p>
            <p className={`font-bold tabular-nums ${globalNetCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {globalNetCash >= 0 ? '+' : '-'}{formatMoney(Math.abs(globalNetCash))}
            </p>
          </div>
        </div>
        <div className="px-3 pb-2">
          <p className="text-[9px] text-zinc-600 font-heading">
            Same scope as personal P/L: cash only. Bullets, points, tokens, and cars are excluded from this net line.
          </p>
        </div>
        <div className="gr-art-line text-primary mx-3 mb-1" />
      </div>

      <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`} style={{ animationDelay: '0.08s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2 border-b border-primary/15 flex items-center justify-between">
          <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">Recent Digs</p>
          <p className="text-[9px] text-zinc-600 font-heading">Latest {Array.isArray(status?.recent_attempts) ? status.recent_attempts.length : 0}</p>
        </div>
        <div className="p-2.5 space-y-1.5 max-h-80 overflow-y-auto">
          {Array.isArray(status?.recent_attempts) && status.recent_attempts.length > 0 ? (
            status.recent_attempts.map((row) => (
              <div key={row.id} className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5 flex items-center gap-2">
                <div className="shrink-0">{rewardIcon(row.reward)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-heading text-foreground truncate">
                    #{row.attempt_number} · {rewardText(row.reward)}
                  </p>
                  <p className="text-[9px] font-heading text-zinc-600">
                    Cost {formatMoney(row.attempt_cost)} · {row.attempted_at ? new Date(row.attempted_at).toLocaleString() : '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onCopyRecent(row)}
                  className="inline-flex items-center justify-center w-5 h-5 rounded border border-zinc-600/60 text-zinc-400 hover:text-primary hover:border-primary/50 transition-colors shrink-0"
                  title="Copy this line"
                  aria-label="Copy this line"
                >
                  <Copy size={11} />
                </button>
                <ChevronRight size={12} className="text-zinc-600 shrink-0" />
              </div>
            ))
          ) : (
            <div className="rounded border border-zinc-700/40 bg-zinc-900/30 px-2.5 py-2 text-[10px] text-zinc-500 font-heading flex items-center gap-1.5">
              <AlertTriangle size={11} className="text-zinc-600" />
              No attempt history yet.
            </div>
          )}
        </div>
        <div className="gr-art-line text-primary mx-3 mb-1" />
      </div>
    </div>
  );
}
