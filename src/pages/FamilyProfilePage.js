import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../utils/api';
import { Building2, Users, TrendingUp, ArrowLeft, Crosshair, Clock, Skull } from 'lucide-react';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

const ROLE_CONFIG = {
  boss:        { label: 'Don',         title: 'Capo di tutti Capi', icon: '👑', color: 'text-yellow-400',  dotColor: '#eab308', rank: 0 },
  underboss:   { label: 'Underboss',   title: 'Second in Command',  icon: '⭐', color: 'text-purple-400',  dotColor: '#a855f7', rank: 1 },
  consigliere: { label: 'Consigliere', title: 'Advisor',            icon: '🎭', color: 'text-blue-400',    dotColor: '#3b82f6', rank: 2 },
  capo:        { label: 'Caporegime',  title: 'Officer',            icon: '🎖️', color: 'text-emerald-400', dotColor: '#10b981', rank: 3 },
  soldier:     { label: 'Soldier',     title: 'Made Man',           icon: '🔫', color: 'text-zinc-300',    dotColor: '#71717a', rank: 4 },
  associate:   { label: 'Associate',   title: 'Crew Member',        icon: '👤', color: 'text-zinc-400',    dotColor: '#52525b', rank: 5 },
};
const getRoleConfig = (role) => ROLE_CONFIG[role?.toLowerCase()] || ROLE_CONFIG.associate;

function formatTimeLeft(isoUntil) {
  if (!isoUntil) return null;
  try {
    const sec = Math.max(0, Math.floor((new Date(isoUntil) - new Date()) / 1000));
    if (sec <= 0) return 'Ready';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch { return null; }
}

// Ember positions defined outside component to avoid recalculation on re-render
const EMBERS = [
  { id: 0, left: '7%',  delay: 0,   dur: 7   },
  { id: 1, left: '19%', delay: 1.4, dur: 5.5 },
  { id: 2, left: '33%', delay: 0.7, dur: 8   },
  { id: 3, left: '48%', delay: 2.2, dur: 6.5 },
  { id: 4, left: '63%', delay: 0.4, dur: 7.5 },
  { id: 5, left: '77%', delay: 1.9, dur: 5   },
  { id: 6, left: '89%', delay: 3.1, dur: 9   },
  { id: 7, left: '41%', delay: 4.2, dur: 6   },
];

// 3D perspective tilt hook
function useTilt(strength = 5) {
  const ref = useRef(null);
  const onMouseMove = useCallback((e) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rx = ((e.clientY - cy) / (rect.height / 2)) * strength;
    const ry = ((e.clientX - cx) / (rect.width / 2)) * -strength;
    ref.current.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(8px)`;
    ref.current.style.transition = 'transform 0.08s linear';
  }, [strength]);
  const onMouseLeave = useCallback(() => {
    if (!ref.current) return;
    ref.current.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) translateZ(0)';
    ref.current.style.transition = 'transform 0.5s ease-out';
  }, []);
  return { ref, onMouseMove, onMouseLeave };
}

const fpStyles = `
  @keyframes fp-in      { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fp-scale   { from { opacity:0; transform:scale(.96); } to { opacity:1; transform:scale(1); } }
  @keyframes fp-glow    { 0%,100%{ opacity:.2; } 50%{ opacity:.55; } }
  @keyframes fp-flicker { 0%,100%{ opacity:.65; } 43%{ opacity:.35; } 48%{ opacity:.9; } 53%{ opacity:.4; } }
  @keyframes fp-shimmer { 0%{ background-position:-200% center; } 100%{ background-position:200% center; } }
  @keyframes fp-spine   { from{ transform:scaleY(0); transform-origin:top; } to{ transform:scaleY(1); transform-origin:top; } }
  @keyframes fp-hline   { from{ transform:scaleX(0); transform-origin:left; } to{ transform:scaleX(1); transform-origin:left; } }
  @keyframes fp-dot-in  { from{ transform:translateX(-50%) scale(0); } to{ transform:translateX(-50%) scale(1); } }
  @keyframes fp-ember {
    0%   { transform:translateY(0) scale(1); opacity:0; }
    8%   { opacity:.9; }
    75%  { opacity:.5; }
    100% { transform:translateY(-180px) scale(.2) translateX(10px); opacity:0; }
  }
  @keyframes fp-pulse { 0%,100%{ box-shadow:0 0 0 0 rgba(var(--noir-primary-rgb),.4); } 50%{ box-shadow:0 0 0 5px rgba(var(--noir-primary-rgb),0); } }

  .fp-in      { animation: fp-in 0.45s ease-out both; }
  .fp-scale   { animation: fp-scale 0.35s ease-out both; }
  .fp-shimmer {
    background: linear-gradient(90deg,rgba(var(--noir-primary-rgb),.5) 0%,rgba(var(--noir-primary-rgb),1) 50%,rgba(var(--noir-primary-rgb),.5) 100%);
    background-size: 200% auto;
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
    animation: fp-shimmer 3s linear infinite;
  }
  .fp-tilt { will-change:transform; }
  .fp-stamp {
    display:inline-block;
    border:2px solid rgba(var(--noir-primary-rgb),.3);
    color:rgba(var(--noir-primary-rgb),.55);
    font-family:var(--font-heading); font-weight:900; letter-spacing:.12em;
    padding:1px 8px; border-radius:3px; transform:rotate(-1.5deg);
  }
  .fp-grain {
    position:fixed; inset:0; z-index:9999; pointer-events:none;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='.03'/%3E%3C/svg%3E");
  }
  .fp-member-card { transition:box-shadow 0.3s ease; }
  .fp-member-card:hover { box-shadow:0 6px 24px rgba(0,0,0,.4); }
`;

// Spine dot marker
function SpineDot({ color = 'rgba(var(--noir-primary-rgb),.5)', delay = 0 }) {
  return (
    <div style={{
      position: 'absolute', left: '24px', top: '12px',
      width: '10px', height: '10px', borderRadius: '50%',
      background: color, border: `1px solid ${color}`,
      transform: 'translateX(-50%)', zIndex: 10,
      boxShadow: `0 0 6px ${color}`,
      animation: `fp-dot-in 0.3s ease-out ${delay}s both`,
    }} />
  );
}

// Horizontal connector between spine and branch cards
function BranchLine({ delay = 0 }) {
  return (
    <div style={{ position: 'relative', height: '20px', marginLeft: '24px' }}>
      <div style={{
        position: 'absolute', left: '0', top: '0', bottom: '0', width: '1px',
        background: 'rgba(var(--noir-primary-rgb),.2)',
        animation: `fp-spine ${0.4}s ease-out ${delay}s both`,
      }} />
    </div>
  );
}

// Single member card used for High Command and Officers — with tilt
function MemberCard({ member, accentColor, delay = 0 }) {
  const cfg = getRoleConfig(member.role);
  const tilt = useTilt(4);
  return (
    <div
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className={`fp-tilt fp-member-card fp-in relative rounded-lg overflow-hidden border`}
      style={{
        animationDelay: `${delay}s`,
        borderColor: `${accentColor}25`,
        background: `linear-gradient(135deg, ${accentColor}08, transparent)`,
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '2px', background: accentColor, opacity: 0.5 }} />
      <div className="px-3 py-2.5 pl-4 flex items-center gap-2.5">
        <span className="text-sm shrink-0">{cfg.icon}</span>
        <div className="min-w-0">
          <Link
            to={`/profile/${encodeURIComponent(member.username)}`}
            className={`font-heading font-bold text-xs ${cfg.color} hover:opacity-75 transition-opacity block truncate leading-tight`}
          >
            {member.username}
          </Link>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-[9px] font-heading ${cfg.color} opacity-70`}>{cfg.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FamilyProfilePage() {
  const { familyId } = useParams();
  const navigate = useNavigate();
  const [family, setFamily] = useState(null);
  const [loading, setLoading] = useState(true);
  const [crewOCApplyLoading, setCrewOCApplyLoading] = useState(false);

  useEffect(() => {
    const id = (familyId && String(familyId).trim()) || '';
    if (!id || id === 'undefined' || id === 'null') { setFamily(null); setLoading(false); return; }
    const run = async () => {
      setLoading(true);
      try {
        const res = await api.get('/families/lookup', { params: { tag: id } });
        setFamily(res.data);
      } catch (e) {
        toast.error(e.response?.data?.detail ?? e.message ?? 'Family not found');
        setFamily(null);
      } finally { setLoading(false); }
    };
    run();
  }, [familyId]);

  // Don card tilt (stronger effect for the feature card)
  const donTilt = useTilt(7);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Pulling the file...</span>
      </div>
    );
  }

  if (!family) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-2 text-zinc-500 hover:text-primary text-xs font-heading uppercase tracking-wider transition-colors">
          <ArrowLeft size={13} /> Back to families
        </button>
        <div className="text-center py-16 bg-zinc-900/40 rounded-xl border border-dashed border-zinc-700/40">
          <Building2 size={32} className="mx-auto text-zinc-700 mb-3" />
          <p className="text-zinc-500 font-heading tracking-wider uppercase text-sm">File not found</p>
          <p className="text-[9px] text-zinc-600 font-heading mt-1 italic">This outfit doesn't exist — or someone made them disappear.</p>
        </div>
      </div>
    );
  }

  const members     = family.members || [];
  const fallen      = family.fallen  || [];
  const rackets     = family.rackets || [];
  const isMyFamily  = !!family.my_role;
  const crewOCFee   = family.crew_oc_join_fee ?? 0;
  const crewOCCooldown  = family.crew_oc_cooldown_until;
  const crewOCAvailable = !crewOCCooldown || formatTimeLeft(crewOCCooldown) === 'Ready';
  const crewOCApp   = family.crew_oc_application;

  const handleApplyCrewOC = async () => {
    setCrewOCApplyLoading(true);
    try {
      const res = await api.post('/families/crew-oc/apply', { family_id: family.id });
      toast.success(res.data?.message || 'Applied.');
      const r = await api.get('/families/lookup', { params: { tag: family.tag } });
      setFamily(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to apply');
    } finally { setCrewOCApplyLoading(false); }
  };

  const sorted      = [...members].sort((a, b) => (getRoleConfig(a.role).rank ?? 5) - (getRoleConfig(b.role).rank ?? 5));
  const boss        = sorted.find(m => m.role === 'boss');
  const highCommand = sorted.filter(m => ['underboss', 'consigliere'].includes(m.role));
  const officers    = sorted.filter(m => m.role === 'capo');
  const rankAndFile = sorted.filter(m => ['soldier', 'associate'].includes(m.role));

  return (
    <div className={`space-y-3 ${styles.pageContent}`}>
      <style>{fpStyles}</style>
      {/* Film grain overlay */}
      <div className="fp-grain" aria-hidden />

      {/* Back */}
      <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-1.5 text-zinc-500 hover:text-primary text-[10px] font-heading uppercase tracking-[0.15em] transition-colors group">
        <ArrowLeft size={11} className="group-hover:-translate-x-0.5 transition-transform" /> Back to families
      </button>

      {/* ══════════════════════════════════════════
          DOSSIER HEADER
      ══════════════════════════════════════════ */}
      <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 fp-scale`}>
        {/* Ambient glow orbs */}
        <div className="absolute -top-10 -left-10 w-48 h-48 bg-primary/4 rounded-full blur-3xl pointer-events-none" style={{ animation: 'fp-glow 5s ease-in-out infinite' }} />
        <div className="absolute -top-6 right-0 w-28 h-28 bg-primary/3 rounded-full blur-2xl pointer-events-none" />

        {/* Top accent line */}
        <div className="h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

        <div className="px-5 pt-4 pb-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-0.5 h-4 bg-primary/40 rounded-full" />
              <span className="text-[8px] text-primary/35 font-heading uppercase tracking-[0.4em]">Crime Family Dossier</span>
            </div>
            <span className="fp-stamp text-[9px]">{family.tag}</span>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-heading font-black text-primary tracking-widest uppercase leading-none">
                {family.name}
              </h1>
              {family.my_role && (() => {
                const cfg = getRoleConfig(family.my_role);
                return (
                  <span className={`inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded text-[9px] font-heading font-bold ${cfg.color} border`}
                    style={{ background: `${cfg.dotColor}15`, borderColor: `${cfg.dotColor}35` }}>
                    {cfg.icon} {cfg.label} — Your rank
                  </span>
                );
              })()}
            </div>

            {/* Intel stat strip */}
            <div className="flex items-stretch rounded-lg overflow-hidden border border-primary/15 bg-zinc-900/70 divide-x divide-primary/10">
              {[
                { label: 'Vault',    value: formatMoney(family.treasury), gold: true },
                { label: 'Made Men', value: `${members.length}${fallen.length > 0 ? ` +${fallen.length}†` : ''}` },
                { label: 'Rackets',  value: rackets.length },
              ].map(({ label, value, gold }) => (
                <div key={label} className="flex flex-col items-center justify-center px-4 py-2.5 min-w-[60px]">
                  <span className="text-[7px] text-zinc-600 font-heading uppercase tracking-[0.2em] mb-0.5">{label}</span>
                  <span className={`text-sm font-heading font-black leading-none ${gold ? 'fp-shimmer' : 'text-foreground'}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="h-px mx-5 mb-0" style={{ background: 'repeating-linear-gradient(90deg,transparent,transparent 4px,rgba(var(--noir-primary-rgb),.1) 4px,rgba(var(--noir-primary-rgb),.1) 8px)' }} />
      </div>

      {/* ══════════════════════════════════════════
          HIERARCHY ORG CHART
      ══════════════════════════════════════════ */}
      <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/15 fp-in`} style={{ animationDelay: '0.1s' }}>
        {/* Floating ember particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {EMBERS.map(e => (
            <div key={e.id} style={{
              position: 'absolute',
              left: e.left,
              bottom: '10%',
              width: '3px',
              height: '3px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(var(--noir-primary-rgb),.9) 0%, rgba(var(--noir-primary-rgb),.3) 70%, transparent 100%)',
              animation: `fp-ember ${e.dur}s ease-in ${e.delay}s infinite`,
            }} />
          ))}
        </div>

        {/* Section header */}
        <div className="px-4 py-2.5 flex items-center gap-2 border-b border-primary/10 relative z-10">
          <Users size={11} className="text-primary/60" />
          <span className="text-[10px] font-heading font-bold text-primary/70 uppercase tracking-[0.2em]">Chain of Command</span>
          <span className="text-[9px] text-zinc-700 font-heading ml-auto">{members.length} active</span>
        </div>

        {/* ── Spine tree ── */}
        <div className="relative py-4 px-4">
          {/* Continuous vertical spine line */}
          <div style={{
            position: 'absolute',
            left: '36px',   // 16px (px-4) + 20px offset into content
            top: '24px',
            bottom: fallen.length > 0 ? '0' : '24px',
            width: '1px',
            background: 'linear-gradient(to bottom, rgba(var(--noir-primary-rgb),.3), rgba(var(--noir-primary-rgb),.08))',
            animation: 'fp-spine 0.8s ease-out 0.15s both',
          }} />

          {/* ── TIER: The Don ── */}
          {boss && (() => {
            const cfg = getRoleConfig(boss.role);
            return (
              <div className="relative mb-4" style={{ paddingLeft: '32px' }}>
                {/* Dot */}
                <div style={{
                  position: 'absolute', left: '20px', top: '14px',
                  width: '12px', height: '12px', borderRadius: '50%',
                  background: '#eab308', border: '2px solid #eab30870',
                  transform: 'translateX(-50%)', zIndex: 10,
                  boxShadow: '0 0 8px rgba(234,179,8,.5)',
                  animation: 'fp-dot-in 0.3s ease-out 0.25s both',
                }} />
                {/* Horizontal tick from spine to tier label */}
                <div style={{
                  position: 'absolute', left: '20px', top: '19px',
                  width: '10px', height: '1px',
                  background: 'rgba(234,179,8,.3)',
                  animation: 'fp-hline 0.3s ease-out 0.35s both',
                }} />
                {/* Tier label */}
                <p className="text-[8px] font-heading uppercase tracking-[0.3em] text-yellow-600/60 mb-2">The Don</p>
                {/* Don card */}
                <div
                  ref={donTilt.ref}
                  onMouseMove={donTilt.onMouseMove}
                  onMouseLeave={donTilt.onMouseLeave}
                  className="fp-tilt fp-member-card fp-in relative rounded-xl overflow-hidden"
                  style={{
                    animationDelay: '0.3s',
                    border: '2px solid rgba(234,179,8,.25)',
                    background: 'linear-gradient(135deg, rgba(234,179,8,.07), rgba(234,179,8,.02), transparent)',
                  }}
                >
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg,transparent,rgba(234,179,8,.4),transparent)' }} />
                  <div style={{ position: 'absolute', top: '-20px', left: '-20px', width: '80px', height: '80px', background: 'rgba(234,179,8,.05)', borderRadius: '50%', filter: 'blur(20px)', animation: 'fp-glow 4s ease-in-out infinite' }} />
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0"
                        style={{ background: 'rgba(234,179,8,.12)', border: '1px solid rgba(234,179,8,.3)', boxShadow: '0 0 12px rgba(234,179,8,.15)' }}>
                        👑
                      </div>
                      <div>
                        <Link to={`/profile/${encodeURIComponent(boss.username)}`}
                          className="font-heading font-black text-sm text-yellow-400 hover:text-yellow-300 transition-colors block leading-tight">
                          {boss.username}
                        </Link>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] font-heading font-bold text-yellow-500/70 uppercase tracking-widest">Don</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-[8px] text-yellow-600/35 font-heading uppercase tracking-[0.15em] text-right leading-tight hidden sm:block">
                      Capo di<br />tutti Capi
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── TIER: High Command ── */}
          {highCommand.length > 0 && (
            <div className="relative mb-4" style={{ paddingLeft: '32px' }}>
              <div style={{
                position: 'absolute', left: '20px', top: '14px',
                width: '10px', height: '1px',
                background: 'rgba(var(--noir-primary-rgb),.2)',
                animation: 'fp-hline 0.3s ease-out 0.5s both',
              }} />
              <div style={{
                position: 'absolute', left: '20px', top: '14px',
                width: '10px', height: '10px', borderRadius: '50%',
                background: 'rgba(168,85,247,.35)', border: '1px solid rgba(168,85,247,.5)',
                transform: 'translateX(-50%)', zIndex: 10,
                boxShadow: '0 0 6px rgba(168,85,247,.3)',
                animation: 'fp-dot-in 0.3s ease-out 0.45s both',
              }} />
              <p className="text-[8px] font-heading uppercase tracking-[0.3em] text-purple-600/60 mb-2">High Command</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {highCommand.map((m, idx) => (
                  <MemberCard key={m.user_id} member={m} accentColor={getRoleConfig(m.role).dotColor} delay={0.55 + idx * 0.08} />
                ))}
              </div>
            </div>
          )}

          {/* ── TIER: Officers ── */}
          {officers.length > 0 && (
            <div className="relative mb-4" style={{ paddingLeft: '32px' }}>
              <div style={{
                position: 'absolute', left: '20px', top: '14px',
                width: '10px', height: '10px', borderRadius: '50%',
                background: 'rgba(16,185,129,.3)', border: '1px solid rgba(16,185,129,.45)',
                transform: 'translateX(-50%)', zIndex: 10,
                boxShadow: '0 0 6px rgba(16,185,129,.25)',
                animation: 'fp-dot-in 0.3s ease-out 0.7s both',
              }} />
              <div style={{
                position: 'absolute', left: '20px', top: '18px',
                width: '10px', height: '1px',
                background: 'rgba(16,185,129,.2)',
                animation: 'fp-hline 0.3s ease-out 0.75s both',
              }} />
              <p className="text-[8px] font-heading uppercase tracking-[0.3em] text-emerald-700/60 mb-2">Officers</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {officers.map((m, idx) => (
                  <MemberCard key={m.user_id} member={m} accentColor="#10b981" delay={0.78 + idx * 0.06} />
                ))}
              </div>
            </div>
          )}

          {/* ── TIER: Rank & File ── */}
          {rankAndFile.length > 0 && (
            <div className="relative" style={{ paddingLeft: '32px' }}>
              <div style={{
                position: 'absolute', left: '20px', top: '14px',
                width: '10px', height: '10px', borderRadius: '50%',
                background: 'rgba(113,113,122,.25)', border: '1px solid rgba(113,113,122,.35)',
                transform: 'translateX(-50%)', zIndex: 10,
                animation: 'fp-dot-in 0.3s ease-out 0.9s both',
              }} />
              <div style={{
                position: 'absolute', left: '20px', top: '18px',
                width: '10px', height: '1px',
                background: 'rgba(113,113,122,.18)',
                animation: 'fp-hline 0.3s ease-out 0.95s both',
              }} />
              <p className="text-[8px] font-heading uppercase tracking-[0.3em] text-zinc-700 mb-2">Rank & File</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {rankAndFile.map((m, idx) => {
                  const cfg = getRoleConfig(m.role);
                  return (
                    <div key={m.user_id} className="fp-in flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800/30 bg-zinc-800/20 hover:border-zinc-700/40 transition-colors"
                      style={{ animationDelay: `${0.98 + idx * 0.03}s` }}>
                      <span className="text-[11px] opacity-60 shrink-0">{cfg.icon}</span>
                      <div className="min-w-0 flex items-center gap-2 flex-1">
                        <Link to={`/profile/${encodeURIComponent(m.username)}`}
                          className={`font-heading font-bold text-[11px] ${m.role === 'soldier' ? 'text-zinc-300' : 'text-zinc-400'} hover:text-primary transition-colors truncate`}>
                          {m.username}
                        </Link>
                      </div>
                      <span className={`text-[8px] font-heading shrink-0 ${cfg.color} opacity-50`}>{cfg.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {members.length === 0 && (
            <div className="text-center py-10 relative z-10">
              <Users size={24} className="mx-auto text-zinc-700 mb-2" />
              <p className="text-[10px] text-zinc-600 font-heading italic">No made men — family is ghost</p>
            </div>
          )}
        </div>

        {/* ── GRAVEYARD ── */}
        {fallen.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,.04)', background: 'rgba(0,0,0,.35)' }}>
            <div className="px-4 pt-3 pb-1.5 flex items-center gap-2.5">
              <Skull size={11} className="text-zinc-600 fp-in" style={{ animationDelay: '0.2s', animation: 'fp-flicker 3.5s ease-in-out infinite' }} />
              <span className="text-[9px] font-heading uppercase tracking-[0.35em] text-zinc-600">In Memoriam</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,.05)', marginLeft: '4px' }} />
              <span className="text-[9px] text-zinc-700 font-heading">{fallen.length} fallen</span>
            </div>
            <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {fallen.map((m, idx) => {
                const cfg = getRoleConfig(m.role);
                const deadDate = m.dead_at
                  ? new Date(m.dead_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })
                  : null;
                return (
                  <div key={m.user_id} className="fp-in relative flex items-center justify-between px-3 py-2 rounded-lg"
                    style={{
                      animationDelay: `${0.15 + idx * 0.05}s`,
                      background: 'rgba(0,0,0,.3)',
                      border: '1px solid rgba(255,255,255,.04)',
                      opacity: 0.55,
                    }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '2px', borderRadius: '4px 0 0 4px', background: 'rgba(113,113,122,.3)' }} />
                    <div className="min-w-0 flex items-center gap-2">
                      <Skull size={9} className="text-zinc-700 shrink-0" style={{ animation: `fp-flicker 3.5s ease-in-out ${idx * 0.6}s infinite` }} />
                      <div className="min-w-0">
                        <Link to={`/profile/${encodeURIComponent(m.username)}`}
                          className="font-heading font-bold text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors block truncate line-through"
                          style={{ textDecorationColor: 'rgba(113,113,122,.5)' }}>
                          {m.username}
                        </Link>
                        <span className={`text-[8px] font-heading ${cfg.color} opacity-40`}>
                          {cfg.icon} {cfg.label}
                        </span>
                      </div>
                    </div>
                    {deadDate && (
                      <span className="text-[8px] text-zinc-700 font-heading font-bold shrink-0 ml-2 tabular-nums">†&nbsp;{deadDate}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════
          OPERATIONS (Rackets + Crew OC)
      ══════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* Rackets */}
        {rackets.length > 0 && (
          <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/15 fp-in`} style={{ animationDelay: '0.25s' }}>
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-primary/10">
              <TrendingUp size={11} className="text-primary/60" />
              <span className="text-[10px] font-heading font-bold text-primary/70 uppercase tracking-[0.2em]">Rackets</span>
              <span className="text-[9px] text-zinc-700 font-heading ml-auto">{rackets.filter(r => r.level > 0).length} running</span>
            </div>
            <div className="p-3 space-y-1.5">
              {rackets.map((r) => {
                const isMax = r.level >= 5;
                return (
                  <div key={r.id} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-zinc-800/25 border border-zinc-700/20"
                    style={isMax ? { borderColor: 'rgba(var(--noir-primary-rgb),.2)' } : {}}>
                    {isMax && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg,transparent,rgba(var(--noir-primary-rgb),.3),transparent)' }} />}
                    <p className="font-heading font-bold text-[10px] text-foreground/70 flex-1 truncate">{r.name}</p>
                    <span className={`text-[9px] font-heading font-bold shrink-0 ${isMax ? 'text-primary' : 'text-primary/60'}`}>
                      {isMax ? 'MAX' : `Lv ${r.level}`}
                    </span>
                    <div className="w-10 h-1 bg-zinc-800 rounded-full overflow-hidden shrink-0">
                      <div className={`h-full rounded-full transition-all duration-500 ${isMax ? 'bg-gradient-to-r from-primary to-amber-400' : 'bg-primary/60'}`}
                        style={{ width: `${(r.level / 5) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Crew OC */}
        <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/15 fp-in`} style={{ animationDelay: '0.3s' }}>
          <div className="px-4 py-2.5 flex items-center justify-between border-b border-primary/10">
            <div className="flex items-center gap-2">
              <Crosshair size={11} className="text-primary/60" />
              <span className="text-[10px] font-heading font-bold text-primary/70 uppercase tracking-[0.2em]">Crew OC</span>
            </div>
            <span className={`text-[9px] font-heading font-bold px-2 py-0.5 rounded ${
              crewOCAvailable
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              {crewOCAvailable ? '● Available' : formatTimeLeft(crewOCCooldown)}
            </span>
          </div>
          <div className="p-3 space-y-2.5">
            {(family.crew_oc_crew?.length > 0) && (
              <div className="flex flex-wrap gap-1">
                {family.crew_oc_crew.map((c, i) => (
                  <span key={`${c.username}-${i}`} className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-heading ${
                    c.is_family_member
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'bg-zinc-800/60 text-zinc-500 border border-zinc-700/30'
                  }`}>
                    <Link to={`/profile/${encodeURIComponent(c.username)}`} className="hover:underline">{c.username}</Link>
                    {!c.is_family_member && <span className="ml-1 opacity-50 text-[8px]">(ext)</span>}
                  </span>
                ))}
              </div>
            )}
            {!isMyFamily && (
              crewOCApp ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/15">
                  <Clock size={11} className="text-primary/60" />
                  <p className="text-[10px] font-heading text-primary">Applied: <span className="font-bold uppercase">{crewOCApp.status}</span></p>
                </div>
              ) : (
                <button type="button" onClick={handleApplyCrewOC} disabled={crewOCApplyLoading}
                  className="w-full py-2 font-heading font-bold uppercase tracking-wider text-[11px] rounded-lg border border-primary/30 bg-primary/8 text-primary hover:bg-primary/15 disabled:opacity-50 transition-all">
                  {crewOCApplyLoading ? 'Applying...' : crewOCFee > 0 ? `Apply — $${crewOCFee.toLocaleString()}` : 'Apply (free)'}
                </button>
              )
            )}
            {family.crew_oc_forum_topic_id && (
              <Link to={`/forum/topic/${family.crew_oc_forum_topic_id}`}
                className="inline-flex items-center gap-1.5 text-[10px] font-heading text-primary/60 hover:text-primary transition-colors">
                <Clock size={10} /> View Crew OC topic
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
