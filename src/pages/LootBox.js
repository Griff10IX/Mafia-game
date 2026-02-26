import { useState, useEffect, useRef } from 'react';
import { Gift, X, Package, Swords, Car, Shield, Building2, Coins, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

const CAP = 3;

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
    <div style={{
      width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: isExclusive
        ? 'linear-gradient(135deg, #78350f, #d97706, #78350f)'
        : 'rgba(234,179,8,0.12)',
      border: isExclusive ? '1px solid #f59e0b' : '1px solid rgba(234,179,8,0.25)',
      flexShrink: 0,
      animation: isExclusive ? 'goldPulse 2s ease-in-out infinite' : undefined,
    }}>
      <Icon size={16} color={isExclusive ? '#fde68a' : '#eab308'} />
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
  const cfg = {
    loot_exclusive: { bg: 'linear-gradient(90deg,#92400e,#d97706,#92400e)', color: '#fef3c7', shimmer: true },
    exclusive:      { bg: 'linear-gradient(90deg,#4c1d95,#7c3aed,#4c1d95)', color: '#ede9fe', shimmer: true },
    ultra_rare:     { bg: 'linear-gradient(90deg,#5b21b6,#8b5cf6)', color: '#ede9fe' },
    rare:           { bg: 'linear-gradient(90deg,#1e3a8a,#3b82f6)', color: '#dbeafe' },
    uncommon:       { bg: 'linear-gradient(90deg,#14532d,#22c55e)', color: '#dcfce7' },
    common:         { bg: 'rgba(255,255,255,0.06)', color: '#9ca3af' },
    standard:       { bg: 'rgba(255,255,255,0.06)', color: '#9ca3af' },
  };
  const s = cfg[rarity] ?? cfg.common;
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 9,
      padding: '2px 6px',
      borderRadius: 4,
      background: s.shimmer
        ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%), ' + s.bg
        : s.bg,
      backgroundSize: s.shimmer ? '200% 100%, auto' : 'auto',
      animation: s.shimmer ? 'shimmer 2.5s linear infinite' : undefined,
      color: s.color,
      textTransform: 'capitalize',
      fontFamily: "'Cinzel', serif",
      letterSpacing: '0.05em',
      verticalAlign: 'middle',
    }}>
      {rarity.replace(/_/g, ' ')}
    </span>
  );
}

/* ─── Progress bar ─── */
function PiecesBar({ pieces }) {
  const pct = Math.min((pieces / 100) * 100, 100);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        height: 6, borderRadius: 99,
        background: 'rgba(255,255,255,0.07)',
        overflow: 'hidden',
        border: '1px solid rgba(234,179,8,0.15)',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #92400e, #eab308, #fbbf24)',
          borderRadius: 99,
          transition: 'width 1s cubic-bezier(0.22,1,0.36,1)',
          boxShadow: '0 0 10px rgba(234,179,8,0.5)',
        }} />
      </div>
    </div>
  );
}

/* ─── Chest icon ─── */
function ChestIcon({ shaking, exploding }) {
  return (
    <div style={{
      position: 'relative',
      width: 80, height: 80,
      margin: '0 auto 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: exploding
        ? 'boxExplode 0.6s ease-out forwards'
        : shaking
        ? 'boxShake 0.5s ease-in-out infinite'
        : undefined,
    }}>
      <Particles active={exploding} />
      {/* Chest body */}
      <div style={{
        width: 64, height: 52, borderRadius: '4px 4px 8px 8px',
        background: 'linear-gradient(180deg, #78350f 0%, #451a03 100%)',
        border: '2px solid #d97706',
        position: 'relative', overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.6), inset 0 2px 4px rgba(234,179,8,0.2)',
      }}>
        {/* lock */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 14, height: 14, borderRadius: '50%',
          background: 'radial-gradient(circle, #fbbf24, #92400e)',
          border: '1px solid #f59e0b',
          animation: shaking || exploding ? 'goldPulse 0.4s ease-in-out infinite' : 'goldPulse 2s ease-in-out infinite',
        }} />
        {/* bands */}
        <div style={{ position: 'absolute', top: '30%', left: 0, right: 0, height: 2, background: 'rgba(234,179,8,0.5)' }} />
        <div style={{ position: 'absolute', top: '65%', left: 0, right: 0, height: 2, background: 'rgba(234,179,8,0.5)' }} />
      </div>
      {/* lid */}
      <div style={{
        position: 'absolute', top: 0, left: 8, right: 8, height: 24,
        borderRadius: '6px 6px 0 0',
        background: 'linear-gradient(180deg, #92400e 0%, #78350f 100%)',
        border: '2px solid #d97706',
        borderBottom: 'none',
        boxShadow: '0 -2px 8px rgba(234,179,8,0.2)',
        animation: exploding ? 'chestLidOpen 0.4s 0.1s ease-out forwards' : undefined,
        transformOrigin: 'top center',
      }} />
    </div>
  );
}

/* ─── Scarcity row ─── */
function ScarcityRow({ icon: Icon, label, claimed, cap }) {
  const full = claimed >= cap;
  return (
    <li style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 10px',
      borderRadius: 6,
      background: full ? 'rgba(239,68,68,0.08)' : 'rgba(234,179,8,0.05)',
      border: `1px solid ${full ? 'rgba(239,68,68,0.25)' : 'rgba(234,179,8,0.1)'}`,
      animation: `fadeUp 0.4s ease-out both`,
    }}>
      <Icon size={13} color={full ? '#f87171' : '#d97706'} />
      <span style={{ flex: 1, fontFamily: "'Crimson Text', serif", fontSize: 13, color: '#d1d5db' }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: cap }, (_, i) => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: '50%',
            background: i < claimed ? (full ? '#ef4444' : '#eab308') : 'rgba(255,255,255,0.1)',
            border: `1px solid ${i < claimed ? (full ? '#ef4444' : '#d97706') : 'rgba(255,255,255,0.15)'}`,
            transition: 'all 0.3s ease',
          }} />
        ))}
      </div>
      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: full ? '#f87171' : '#9ca3af', minWidth: 36, textAlign: 'right' }}>
        {claimed}/{cap}
      </span>
    </li>
  );
}

/* ─── Result modal ─── */
function ResultModal({ result, onClose }) {
  const rewards = result.rewards || (result.reward ? [result.reward] : []);
  const quality = result.box_quality;
  const isGold = quality === 'gold' || quality === 'exclusive';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(4px)',
        animation: 'overlayIn 0.25s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          borderRadius: 12,
          background: 'linear-gradient(160deg, #1c1008 0%, #0f0902 100%)',
          border: `1px solid ${isGold ? '#d97706' : 'rgba(234,179,8,0.3)'}`,
          boxShadow: isGold
            ? '0 0 60px rgba(234,179,8,0.25), 0 24px 80px rgba(0,0,0,0.8)'
            : '0 24px 80px rgba(0,0,0,0.8)',
          padding: '28px 24px 24px',
          maxWidth: 420, width: '100%',
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          animation: 'modalIn 0.35s cubic-bezier(0.22,1,0.36,1)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* header ornament */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: isGold
            ? 'linear-gradient(90deg, transparent, #d97706, #fbbf24, #d97706, transparent)'
            : 'linear-gradient(90deg, transparent, rgba(234,179,8,0.4), transparent)',
        }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <h3 style={{
              fontFamily: "'Cinzel', serif", fontWeight: 700, fontSize: 18,
              color: '#fef3c7',
              animation: isGold ? 'textGlow 2s ease-in-out infinite' : undefined,
            }}>
              {isGold ? '✦ Golden Score ✦' : 'The Envelope, Please'}
            </h3>
            {quality && (
              <p style={{ fontFamily: "'Crimson Text', serif", fontStyle: 'italic', fontSize: 13, color: '#9ca3af', marginTop: 2 }}>
                {quality} box — {rewards.length} prize{rewards.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: 6, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: '#9ca3af',
              transition: 'all 0.15s',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* divider */}
        <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(234,179,8,0.3),transparent)', margin: '12px 0' }} />

        {/* rewards list */}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rewards.map((r, i) => (
            <li
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(234,179,8,0.1)',
                animation: `rewardPop 0.45s ${i * 0.12}s cubic-bezier(0.22,1,0.36,1) both`,
              }}
            >
              <RewardIcon type={r.type} rarity={r.rarity} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: '#e5e7eb', lineHeight: 1.4 }}>
                  {rewardLabel(r)}
                </div>
                {r.rarity && <div style={{ marginTop: 4 }}><RarityBadge rarity={r.rarity} /></div>}
              </div>
            </li>
          ))}
        </ul>

        <div style={{
          marginTop: 16, paddingTop: 12,
          borderTop: '1px solid rgba(234,179,8,0.15)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontFamily: "'Crimson Text', serif", fontStyle: 'italic', fontSize: 12, color: '#6b7280' }}>
            Pieces remaining
          </span>
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: '#eab308', fontWeight: 700 }}>
            {result.new_pieces ?? 0}
          </span>
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
      <div style={{ padding: 24, fontFamily: "'Cinzel', serif", color: '#9ca3af', textAlign: 'center' }}>
        <div style={{ animation: 'tickerBlink 1s ease-in-out infinite' }}>Loading the vault…</div>
      </div>
    );
  }

  return (
    <>
      <style>{globalStyles}</style>

      <div style={{
        padding: '20px 16px',
        maxWidth: 480,
        margin: '0 auto',
        fontFamily: "'Crimson Text', serif",
        position: 'relative',
      }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 20, animation: 'fadeUp 0.5s ease-out' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Gift size={20} color="#d97706" />
            <h1 style={{
              fontFamily: "'Cinzel', serif", fontWeight: 900, fontSize: 20,
              color: '#fef3c7', margin: 0, letterSpacing: '0.04em',
            }}>
              The Vault
            </h1>
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0, fontStyle: 'italic', lineHeight: 1.5 }}>
            Earn pieces from{' '}
            <Link to="/missions" style={{ color: '#d97706', textDecoration: 'none', borderBottom: '1px solid rgba(217,119,6,0.3)' }}>
              the Consigliere's Ledger
            </Link>
            . One hundred pieces open a box. The exclusives are scarce.
          </p>
        </div>

        {/* ── Chest card ── */}
        <div style={{
          borderRadius: 12,
          background: 'linear-gradient(160deg, #1c1008, #0f0902)',
          border: '1px solid rgba(234,179,8,0.2)',
          padding: '24px 20px',
          marginBottom: 12,
          position: 'relative',
          overflow: 'hidden',
          animation: `fadeUp 0.5s 0.1s ease-out both, ${canOpen ? 'borderMarch 3s ease-in-out infinite' : 'none'}`,
        }}>
          <Embers />

          <ChestIcon
            shaking={phase === 'shaking'}
            exploding={phase === 'exploding'}
          />

          {/* pieces counter */}
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
              <span style={{
                fontFamily: "'Cinzel', serif", fontSize: 36, fontWeight: 900,
                color: '#eab308',
                animation: pieces >= 100 ? 'textGlow 2s ease-in-out infinite' : undefined,
                lineHeight: 1,
              }}>
                {pieces}
              </span>
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: '#6b7280' }}>/100</span>
            </div>
            <div style={{ fontFamily: "'Crimson Text', serif", fontStyle: 'italic', fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              pieces collected
            </div>
          </div>

          <PiecesBar pieces={pieces} />

          {/* CTA button */}
          <button
            type="button"
            onClick={handleOpen}
            disabled={!canOpen}
            style={{
              width: '100%',
              marginTop: 16,
              padding: '11px 16px',
              borderRadius: 8,
              border: canOpen ? '1px solid #d97706' : '1px solid rgba(255,255,255,0.06)',
              background: canOpen
                ? 'linear-gradient(135deg, #92400e 0%, #d97706 50%, #92400e 100%)'
                : 'rgba(255,255,255,0.04)',
              backgroundSize: '200% 100%',
              color: canOpen ? '#fef3c7' : '#4b5563',
              fontFamily: "'Cinzel', serif",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: '0.08em',
              cursor: canOpen ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.2s',
              boxShadow: canOpen ? '0 0 20px rgba(217,119,6,0.25)' : 'none',
              animation: canOpen ? 'shimmer 3s linear infinite' : undefined,
            }}
          >
            <Package size={15} />
            {phase === 'shaking' ? 'RATTLING THE LOCK…'
              : phase === 'exploding' ? 'THE VAULT OPENS…'
              : canOpen ? 'CRACK THE VAULT'
              : `${100 - pieces} PIECES NEEDED`}
          </button>
        </div>

        {/* ── Scarcity card ── */}
        <div style={{
          borderRadius: 12,
          background: 'rgba(15,9,2,0.8)',
          border: '1px solid rgba(234,179,8,0.12)',
          padding: '16px',
          animation: 'fadeUp 0.5s 0.25s ease-out both',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          }}>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(234,179,8,0.2), transparent)' }} />
            <span style={{
              fontFamily: "'Cinzel', serif", fontSize: 10, fontWeight: 600,
              color: '#9ca3af', letterSpacing: '0.15em', textTransform: 'uppercase',
            }}>
              Exclusive Scarcity
            </span>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, rgba(234,179,8,0.2))' }} />
          </div>
          <p style={{ fontFamily: "'Crimson Text', serif", fontStyle: 'italic', fontSize: 12, color: '#4b5563', textAlign: 'center', marginBottom: 10 }}>
            Each exclusive may only be claimed by {CAP} made men across the family.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ScarcityRow icon={Swords}    label="Exclusive Weapon"  claimed={claimed.weapon}   cap={CAP} />
            <ScarcityRow icon={Car}       label="Exclusive Vehicle" claimed={claimed.car}      cap={CAP} />
            <ScarcityRow icon={Shield}    label="Exclusive Armour"  claimed={claimed.armour}   cap={CAP} />
            <ScarcityRow icon={Building2} label="Speakeasy"         claimed={claimed.property} cap={CAP} />
          </ul>
        </div>

      </div>

      {/* ── Result Modal ── */}
      {result && <ResultModal result={result} onClose={closeModal} />}
    </>
  );
}
