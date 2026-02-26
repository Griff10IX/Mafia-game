import { useState, useEffect, useRef } from 'react';
import { Gift, X, Package, Swords, Car, Shield, Building2, Coins, Zap, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const CAP = 3;

const LOOT_BOX_STYLES = `
  @keyframes lb-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .lb-fade-in { animation: lb-fade-in 0.4s ease-out both; }
  .lb-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

/* GTA-style rarity text colors for cars */
const RARITY_COLORS = {
  common: 'text-gray-400',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  ultra_rare: 'text-purple-400',
  legendary: 'text-yellow-400',
  custom: 'text-orange-400',
  exclusive: 'text-red-400',
  loot_exclusive: 'text-amber-400',
};
function getRarityColor(rarity) {
  return RARITY_COLORS[rarity] || 'text-gray-400';
}

/* ─── Inline styles & keyframes ─── */
const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');

  @keyframes emberFloat {
    0%   { transform: translateY(0) scale(1); opacity: 0.8; }
    50%  { transform: translateY(-60px) scale(0.7) translateX(10px); opacity: 0.5; }
    100% { transform: translateY(-120px) scale(0.3) translateX(-6px); opacity: 0; }
  }
  @keyframes boxShake {
    0%,100% { transform: rotate(0deg) scale(1); }
    15%  { transform: rotate(-4deg) scale(1.04); }
    30%  { transform: rotate(4deg) scale(1.06); }
    45%  { transform: rotate(-3deg) scale(1.04); }
    60%  { transform: rotate(3deg) scale(1.07); }
    75%  { transform: rotate(-2deg) scale(1.05); }
  }
  @keyframes boxExplode {
    0%   { transform: scale(1); opacity: 1; filter: brightness(1); }
    40%  { transform: scale(1.35); opacity: 1; filter: brightness(2.5); }
    70%  { transform: scale(0.9); opacity: 0.6; filter: brightness(1); }
    100% { transform: scale(1); opacity: 1; filter: brightness(1); }
  }
  @keyframes goldPulse {
    0%,100% { box-shadow: 0 0 8px rgba(234,179,8,0.3); }
    50%      { box-shadow: 0 0 28px rgba(234,179,8,0.7), 0 0 60px rgba(234,179,8,0.2); }
  }
  @keyframes shimmer {
    0%   { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes rewardPop {
    0%   { opacity: 0; transform: scale(0.6) translateY(12px); }
    60%  { transform: scale(1.06) translateY(-2px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes overlayIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.85) translateY(24px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes progressFill {
    from { width: 0; }
    to   { width: var(--prog-width); }
  }
  @keyframes crownSpin {
    0%   { transform: rotateY(0deg); }
    100% { transform: rotateY(360deg); }
  }
  @keyframes particleBurst {
    0%   { opacity: 1; transform: translate(0,0) scale(1); }
    100% { opacity: 0; transform: translate(var(--px), var(--py)) scale(0); }
  }
  @keyframes textGlow {
    0%,100% { text-shadow: 0 0 4px rgba(234,179,8,0.4); }
    50%      { text-shadow: 0 0 16px rgba(234,179,8,0.9), 0 0 32px rgba(234,179,8,0.4); }
  }
  @keyframes borderMarch {
    0%   { border-color: rgba(234,179,8,0.3); }
    50%  { border-color: rgba(234,179,8,0.85); }
    100% { border-color: rgba(234,179,8,0.3); }
  }
  @keyframes chestLidOpen {
    0%   { transform: perspective(300px) rotateX(0deg); transform-origin: top center; }
    100% { transform: perspective(300px) rotateX(-110deg); transform-origin: top center; }
  }
  @keyframes tickerBlink {
    0%,100% { opacity: 1; }
    50%      { opacity: 0.35; }
  }
`;

/* ─── Particle burst overlay ─── */
function Particles({ active }) {
  if (!active) return null;
  const particles = Array.from({ length: 20 }, (_, i) => {
    const angle = (i / 20) * 360;
    const dist = 60 + Math.random() * 80;
    const px = `${Math.cos((angle * Math.PI) / 180) * dist}px`;
    const py = `${Math.sin((angle * Math.PI) / 180) * dist}px`;
    const colors = ['#eab308', '#f59e0b', '#fcd34d', '#fff7ed', '#dc2626'];
    return { px, py, color: colors[i % colors.length], delay: Math.random() * 0.2 };
  });
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: p.color,
            '--px': p.px,
            '--py': p.py,
            animation: `particleBurst 0.8s ${p.delay}s ease-out forwards`,
            opacity: 0,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Floating embers background ─── */
function Embers() {
  const embers = Array.from({ length: 10 }, (_, i) => ({
    left: `${8 + i * 9}%`,
    delay: `${i * 0.6}s`,
    duration: `${2.5 + (i % 4) * 0.8}s`,
    size: 3 + (i % 3) * 2,
  }));
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {embers.map((e, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            bottom: '10%',
            left: e.left,
            width: e.size,
            height: e.size,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #fbbf24, #92400e)',
            animation: `emberFloat ${e.duration} ${e.delay} ease-in infinite`,
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Reward Icon ─── */
function RewardIcon({ type, rarity }) {
  const isExclusive = rarity === 'exclusive' || rarity === 'loot_exclusive' || rarity === 'ultra_rare';
  const iconMap = {
    weapon: Swords, car: Car, armour: Shield,
    property: Building2, cash: Coins,
    points: Zap, rank_points: Zap, perk: Zap,
    bullets: Package, cars: Car,
  };
  const Icon = iconMap[type] || Gift;
  return (
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${isExclusive ? 'bg-primary/30 border-primary' : 'bg-primary/10 border-primary/30'}`}>
      <Icon size={16} className={isExclusive ? 'text-primary' : 'text-primary/90'} />
    </div>
  );
}

function rewardLabel(reward) {
  if (!reward) return '—';
  switch (reward.type) {
    case 'weapon':    return reward.name || 'Exclusive weapon';
    case 'car':       return reward.name || 'Exclusive car';
    case 'armour':    return reward.name || 'Exclusive armour';
    case 'property':  return reward.name || 'Speakeasy';
    case 'points':    return `${reward.amount ?? 0} points`;
    case 'rank_points': return `${reward.amount ?? 0} rank points`;
    case 'cash':      return `$${Number(reward.amount ?? 0).toLocaleString()}`;
    case 'cars':
      if (reward.items?.length) return reward.items.map((it) => `${it.name} (${it.rarity ?? 'common'})`).join(', ');
      return `${reward.count ?? 0} cars`;
    case 'bullets':   return `${reward.amount ?? 0} bullets`;
    case 'perk':      return reward.name || 'Perk';
    default:          return JSON.stringify(reward);
  }
}

function RarityBadge({ rarity }) {
  if (!rarity) return null;
  const classes = {
    loot_exclusive: 'bg-primary/25 text-primary border border-primary/40',
    exclusive:      'bg-purple-500/25 text-purple-200 border border-purple-400/40',
    ultra_rare:     'bg-purple-500/20 text-purple-200 border border-purple-400/30',
    rare:           'bg-blue-500/20 text-blue-200 border border-blue-400/30',
    uncommon:       'bg-green-500/20 text-green-200 border border-green-400/30',
    common:         'bg-zinc-600/30 text-mutedForeground border border-zinc-500/30',
    standard:       'bg-zinc-600/30 text-mutedForeground border border-zinc-500/30',
  };
  const c = classes[rarity] ?? classes.standard;
  return (
    <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded capitalize font-heading tracking-wider ${c}`}>
      {rarity.replace(/_/g, ' ')}
    </span>
  );
}

/* ─── Progress bar ─── */
function PiecesBar({ pieces }) {
  const pct = Math.min((pieces / 100) * 100, 100);
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden border border-primary/20">
        <div className="h-full bg-primary/80 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─── Chest icon ─── */
function ChestIcon({ shaking, exploding }) {
  return (
    <div
      className="relative w-20 h-20 mx-auto mb-4 flex items-center justify-center"
      style={{
        animation: exploding ? 'boxExplode 0.6s ease-out forwards' : shaking ? 'boxShake 0.5s ease-in-out infinite' : undefined,
      }}
    >
      <Particles active={exploding} />
      <div className="w-14 h-11 rounded-b border-2 border-primary bg-gradient-to-b from-primary/40 to-primary/10 relative overflow-hidden shadow-lg">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-primary border border-primary/80 shadow-inner" />
        <div className="absolute top-[30%] left-0 right-0 h-0.5 bg-primary/50" />
        <div className="absolute top-[65%] left-0 right-0 h-0.5 bg-primary/50" />
      </div>
      <div
        className="absolute top-0 left-2 right-2 h-6 rounded-t border-2 border-b-0 border-primary bg-gradient-to-b from-primary/50 to-primary/20 shadow-sm"
        style={{ animation: exploding ? 'chestLidOpen 0.4s 0.1s ease-out forwards' : undefined, transformOrigin: 'top center' }}
      />
    </div>
  );
}

/* ─── Scarcity row ─── */
function ScarcityRow({ icon: Icon, label, claimed, cap }) {
  const full = claimed >= cap;
  return (
    <li className={`flex items-center gap-2 py-1.5 px-2 rounded border ${full ? 'bg-red-500/10 border-red-500/25' : 'bg-primary/5 border-primary/15'}`}>
      <Icon size={12} className={full ? 'text-red-400 shrink-0' : 'text-primary shrink-0'} />
      <span className="flex-1 text-[10px] font-heading text-foreground">{label}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: cap }, (_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full border ${i < claimed ? (full ? 'bg-red-400 border-red-400' : 'bg-primary border-primary') : 'bg-zinc-600 border-zinc-500'}`} />
        ))}
      </div>
      <span className={`text-[9px] font-heading min-w-[2rem] text-right ${full ? 'text-red-400' : 'text-mutedForeground'}`}>{claimed}/{cap}</span>
    </li>
  );
}

/* ─── Result modal ─── */
function ResultModal({ result, onClose }) {
  const rewards = result.rewards || (result.reward ? [result.reward] : []);
  const quality = result.box_quality;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      style={{ animation: 'overlayIn 0.25s ease-out' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${styles.panel} rounded-lg border border-primary/30 max-w-md w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl`}
        style={{ animation: 'modalIn 0.35s cubic-bezier(0.22,1,0.36,1)' }}
      >
        <div className="h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="px-4 pt-4 pb-2 flex justify-between items-start">
          <div>
            <h3 className="text-lg font-heading font-bold text-primary">The Envelope, Please</h3>
            {quality && (
              <p className="text-[11px] text-mutedForeground font-heading italic mt-0.5 capitalize">
                {quality} box — {rewards.length} prize{rewards.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded border border-primary/20 bg-primary/5 text-mutedForeground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="h-px bg-primary/20 mx-4" />
        <ul className="list-none p-0 m-0 overflow-y-auto flex-1 flex flex-col gap-2 p-4">
          {rewards.map((r, i) => (
            <li
              key={i}
              className="flex items-center gap-2 p-2 rounded border border-primary/15 bg-primary/5"
              style={{ animation: `rewardPop 0.45s ${i * 0.12}s cubic-bezier(0.22,1,0.36,1) both` }}
            >
              <RewardIcon type={r.type} rarity={r.rarity} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-heading text-foreground leading-snug">
                  {r.type === 'cars' && r.items?.length ? (
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5 items-baseline">
                      {r.items.map((it, idx) => {
                        const rarity = (it.rarity ?? 'common').replace(/_/g, ' ');
                        const colorClass = getRarityColor(it.rarity ?? 'common');
                        return (
                          <span key={idx}>
                            {it.name}{' '}
                            <span className={`font-bold uppercase tracking-wider ${colorClass}`}>({rarity})</span>
                            {idx < r.items.length - 1 ? ', ' : null}
                          </span>
                        );
                      })}
                    </span>
                  ) : (
                    rewardLabel(r)
                  )}
                </div>
                {r.rarity && <div className="mt-1"><RarityBadge rarity={r.rarity} /></div>}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-3 px-4 pb-4 border-t border-primary/20 flex justify-between items-center">
          <span className="text-[11px] text-mutedForeground font-heading italic">Pieces remaining</span>
          <span className="text-sm font-heading font-bold text-primary">{result.new_pieces ?? 0}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Main component ─── */
export default function LootBox() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState('idle'); // idle | shaking | exploding | done
  const [result, setResult] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rarityConfig, setRarityConfig] = useState(null);
  const [rarityForm, setRarityForm] = useState({ exclusive_chance_pct: 2, common_pct: 55, uncommon_pct: 32, rare_pct: 13 });
  const [raritySaving, setRaritySaving] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await api.get('/loot-box/status');
      setStatus(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load loot box status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const adminRes = await api.get('/admin/check');
        if (!cancelled && adminRes.data?.is_admin) {
          setIsAdmin(true);
          const rRes = await api.get('/loot-box/admin/rarity');
          if (!cancelled && rRes.data) {
            setRarityConfig(rRes.data);
            const c = rRes.data.common_pct ?? 0;
            const u = rRes.data.uncommon_pct ?? 0;
            const r = rRes.data.rare_pct ?? 0;
            const sum = c + u + r;
            const box = sum > 0 ? { common_pct: c, uncommon_pct: u, rare_pct: r } : { common_pct: 55, uncommon_pct: 32, rare_pct: 13 };
            setRarityForm({
              exclusive_chance_pct: Math.max(0, Math.min(100, Number(rRes.data.exclusive_chance_pct) ?? 2)),
              ...box,
            });
          }
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveRarity = async () => {
    setRaritySaving(true);
    try {
      const c = Math.max(0, Math.min(100, rarityForm.common_pct ?? 0));
      const u = Math.max(0, Math.min(100, rarityForm.uncommon_pct ?? 0));
      const r = Math.max(0, Math.min(100, rarityForm.rare_pct ?? 0));
      const sum = c + u + r;
      const payload = {
        exclusive_chance_pct: Math.max(0, Math.min(100, Number(rarityForm.exclusive_chance_pct) ?? 2)),
        common_pct: sum > 0 ? c : 55,
        uncommon_pct: sum > 0 ? u : 32,
        rare_pct: sum > 0 ? r : 13,
      };
      if (sum > 0 && sum !== 100) {
        const scale = 100 / sum;
        payload.common_pct = Math.round(c * scale);
        payload.uncommon_pct = Math.round(u * scale);
        payload.rare_pct = 100 - payload.common_pct - payload.uncommon_pct;
      }
      const res = await api.post('/loot-box/admin/rarity', payload);
      setRarityConfig(res.data);
      setRarityForm({
        exclusive_chance_pct: res.data.exclusive_chance_pct ?? payload.exclusive_chance_pct,
        common_pct: res.data.common_pct ?? payload.common_pct,
        uncommon_pct: res.data.uncommon_pct ?? payload.uncommon_pct,
        rare_pct: res.data.rare_pct ?? payload.rare_pct,
      });
      toast.success(res.data?.message ?? 'Rarity updated');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save rarity');
    } finally {
      setRaritySaving(false);
    }
  };

  // Auto-fill box quality % so Common + Uncommon + Rare = 100 when one is edited
  const updateBoxQuality = (field, value) => {
    const n = Math.max(0, Math.min(100, parseInt(String(value), 10) || 0));
    setRarityForm((f) => {
      const rest = 100 - n;
      const half = Math.floor(rest / 2);
      if (field === 'common_pct') return { ...f, common_pct: n, uncommon_pct: half, rare_pct: rest - half };
      if (field === 'uncommon_pct') return { ...f, uncommon_pct: n, common_pct: half, rare_pct: rest - half };
      if (field === 'rare_pct') return { ...f, rare_pct: n, common_pct: half, uncommon_pct: rest - half };
      return { ...f, [field]: n };
    });
  };

  const handleOpen = async () => {
    const pieces = status?.loot_box_pieces ?? 0;
    if (pieces < 100) return;
    setResult(null);
    setPhase('shaking');
    try {
      const [res] = await Promise.all([
        api.post('/loot-box/open', { tier: 'standard' }),
        new Promise((r) => setTimeout(r, 900)),
      ]);
      setPhase('exploding');
      await new Promise((r) => setTimeout(r, 600));
      setPhase('done');
      setResult(res.data);
      await refreshUser();
      await loadStatus();
      toast.success('The don smiles upon you.');
    } catch (e) {
      setPhase('idle');
      toast.error(e.response?.data?.detail || 'Failed to open loot box');
    }
  };

  const closeModal = () => { setResult(null); setPhase('idle'); };

  const pieces = status?.loot_box_pieces ?? 0;
  const claimed = status?.claimed_counts ?? { weapon: 0, car: 0, armour: 0, property: 0 };
  const canOpen = pieces >= 100 && phase === 'idle';

  if (loading) {
    return (
      <div className={`space-y-2 ${styles.pageContent}`}>
        <style>{LOOT_BOX_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Gift size={24} className="text-primary/50 animate-pulse" />
          <span className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider">Loading the vault…</span>
        </div>
      </div>
    );
  }

  const last10 = status?.last_10_wins ?? [];

  return (
    <>
      <style>{globalStyles}</style>
      <style>{LOOT_BOX_STYLES}</style>

      <div className={`space-y-1.5 ${styles.pageContent}`} data-testid="lootbox-page">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
          {/* ── Main column ── */}
          <div className="space-y-1.5 min-w-0">
            {/* Header */}
            <div className="relative lb-fade-in">
              <p className="text-[9px] text-zinc-500 font-heading italic">Earn pieces from <Link to="/missions" className="text-primary underline">the Consigliere's Ledger</Link>. One hundred pieces open a box. Exclusives are scarce.</p>
            </div>

            {/* Chest card */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lb-fade-in ${canOpen ? 'ring-1 ring-primary/30' : ''}`} style={{ animationDelay: '0.03s' }}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
                <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">The Vault</span>
              </div>
              <div className="p-3 relative">
                <Embers />
                <ChestIcon shaking={phase === 'shaking'} exploding={phase === 'exploding'} />
                <div className="text-center mb-2">
                  <div className="flex items-baseline justify-center gap-1.5">
                    <span className="text-2xl font-heading font-bold text-primary">{pieces}</span>
                    <span className="text-[10px] text-mutedForeground font-heading">/100</span>
                  </div>
                  <p className="text-[9px] text-mutedForeground font-heading italic mt-0.5">pieces collected</p>
                </div>
                <PiecesBar pieces={pieces} />
                <button
                  type="button"
                  onClick={handleOpen}
                  disabled={!canOpen}
                  className={`w-full mt-2 py-1.5 px-2.5 rounded font-heading font-bold uppercase tracking-wider text-[10px] border flex items-center justify-center gap-2 transition-all ${
                    canOpen
                      ? 'bg-primary/20 text-primary border-primary/40 hover:bg-primary/30'
                      : 'bg-zinc-800/50 text-zinc-500 border-zinc-600/50 cursor-not-allowed'
                  }`}
                >
                  <Package size={14} />
                  {phase === 'shaking' ? 'RATTLING THE LOCK…' : phase === 'exploding' ? 'THE VAULT OPENS…' : canOpen ? 'CRACK THE VAULT' : `${100 - pieces} PIECES NEEDED`}
                </button>
              </div>
              <div className="lb-art-line text-primary mx-2.5" />
            </div>

            {/* Scarcity card */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lb-fade-in`} style={{ animationDelay: '0.05s' }}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
                <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Exclusive Scarcity</span>
              </div>
              <div className="p-1.5">
                <p className="text-[9px] text-mutedForeground font-heading italic text-center mb-1">Each exclusive may only be claimed by {CAP} made men across the family.</p>
                <ul className="list-none p-0 m-0 flex flex-col gap-0.5">
                  <ScarcityRow icon={Swords} label="Exclusive Weapon" claimed={claimed.weapon} cap={CAP} />
                  <ScarcityRow icon={Car} label="Exclusive Vehicle" claimed={claimed.car} cap={CAP} />
                  <ScarcityRow icon={Shield} label="Exclusive Armour" claimed={claimed.armour} cap={CAP} />
                  <ScarcityRow icon={Building2} label="Speakeasy" claimed={claimed.property} cap={CAP} />
                </ul>
              </div>
              <div className="lb-art-line text-primary mx-2.5" />
            </div>

            {/* Admin: Loot box rarity */}
            {isAdmin && (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/30 border-dashed lb-fade-in`} style={{ animationDelay: '0.06s' }}>
                <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="px-2 py-1 bg-primary/10 border-b border-primary/20 flex items-center gap-1.5">
                  <Shield size={12} className="text-primary shrink-0" />
                  <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Admin — Rarity %</span>
                </div>
                <div className="p-2 space-y-1.5">
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-heading">
                    <label className="flex items-center gap-1.5">
                      <span className="text-mutedForeground w-24">Exclusive %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={rarityForm.exclusive_chance_pct}
                        onChange={(e) => setRarityForm((f) => ({ ...f, exclusive_chance_pct: parseFloat(e.target.value) || 0 }))}
                        className="w-14 px-1.5 py-0.5 rounded border border-primary/30 bg-background text-foreground text-right"
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <span className="text-mutedForeground w-24">Common %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={rarityForm.common_pct}
                        onChange={(e) => updateBoxQuality('common_pct', e.target.value)}
                        className="w-14 px-1.5 py-0.5 rounded border border-primary/30 bg-background text-foreground text-right"
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <span className="text-mutedForeground w-24">Uncommon %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={rarityForm.uncommon_pct}
                        onChange={(e) => updateBoxQuality('uncommon_pct', e.target.value)}
                        className="w-14 px-1.5 py-0.5 rounded border border-primary/30 bg-background text-foreground text-right"
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <span className="text-mutedForeground w-24">Rare %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={rarityForm.rare_pct}
                        onChange={(e) => updateBoxQuality('rare_pct', e.target.value)}
                        className="w-14 px-1.5 py-0.5 rounded border border-primary/30 bg-background text-foreground text-right"
                      />
                    </label>
                  </div>
                  <p className="text-[8px] text-mutedForeground italic leading-tight">Exclusive % = chance per prize. Box quality: set one, other two auto-fill to 100.</p>
                  <button
                    type="button"
                    onClick={saveRarity}
                    disabled={raritySaving}
                    className="w-full py-1 px-1.5 rounded border border-primary/40 bg-primary/15 text-primary font-heading text-[9px] uppercase tracking-wider flex items-center justify-center gap-1 hover:bg-primary/25 disabled:opacity-50"
                  >
                    <Save size={12} />
                    {raritySaving ? 'Saving…' : 'Save rarity'}
                  </button>
                </div>
                <div className="lb-art-line text-primary mx-2.5" />
              </div>
            )}

            {/* Active rewards */}
            {(status?.active_rewards?.length > 0) && (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lb-fade-in`} style={{ animationDelay: '0.07s' }}>
                <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
                  <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Active rewards</span>
                </div>
                <ul className="p-1.5 list-none m-0 flex flex-col gap-0.5">
                  {status.active_rewards.map((ar, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-[9px] font-heading text-foreground bg-primary/5 border border-primary/15 rounded px-1.5 py-1">
                      <Zap size={12} className="text-primary shrink-0" />
                      <span>
                        {ar.name}
                        {ar.expires_at && (() => {
                          try {
                            const until = new Date(ar.expires_at.replace('Z', 'Z'));
                            const ms = until - new Date();
                            if (ms <= 0) return null;
                            const h = Math.floor(ms / 3600000);
                            const m = Math.floor((ms % 3600000) / 60000);
                            return <span className="text-mutedForeground italic ml-1">({h}h {m}m left)</span>;
                          } catch { return null; }
                        })()}
                        {ar.attempts_remaining != null && <span className="text-mutedForeground italic ml-1">({ar.attempts_remaining} attempts left)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="lb-art-line text-primary mx-2.5" />
              </div>
            )}
          </div>

          {/* ── Side: Last 10 wins (compact) ── */}
          <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lb-fade-in h-fit`} style={{ animationDelay: '0.05s' }}>
            <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
              <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Last 10 wins</span>
            </div>
            <div className="p-1.5 max-h-[50vh] overflow-y-auto">
              {last10.length === 0 ? (
                <p className="text-[9px] text-mutedForeground font-heading italic py-0.5">No opens yet.</p>
              ) : (
                <ul className="list-none p-0 m-0 space-y-1">
                  {last10.map((win, i) => (
                    <li key={i} className="text-[8px] font-heading border-b border-primary/10 pb-1 last:border-0 last:pb-0 leading-tight">
                      <div className="flex items-center justify-between gap-0.5 text-mutedForeground uppercase tracking-wider">
                        <span>{win.box_quality ?? '—'} · {win.prizes_count ?? 0}</span>
                        <span>{win.opened_at ? new Date(win.opened_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</span>
                      </div>
                      <ul className="mt-0.5 space-y-0.5 text-foreground">
                        {(win.rewards || []).slice(0, 4).map((r, j) => (
                          <li key={j} className="truncate">{rewardLabel(r)}</li>
                        ))}
                        {(win.rewards?.length ?? 0) > 4 && <li className="text-mutedForeground text-[7px]">+{(win.rewards?.length ?? 0) - 4}</li>}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="lb-art-line text-primary mx-2.5" />
          </div>
        </div>

        {result && <ResultModal result={result} onClose={closeModal} />}
      </div>
    </>
  );
}
