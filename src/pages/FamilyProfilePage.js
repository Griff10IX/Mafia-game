import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../utils/api';
import { Building2, Users, TrendingUp, ArrowLeft, Crosshair, Clock, Skull, Shield, Star, Crown } from 'lucide-react';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

const ROLE_CONFIG = {
  boss:        { label: 'Don',          subLabel: 'Capo di tutti Capi', icon: '👑', color: 'text-yellow-400',  bg: 'bg-yellow-500/10',  border: 'border-yellow-500/40', rank: 0 },
  underboss:   { label: 'Underboss',    subLabel: 'Second in Command',  icon: '⭐', color: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/40', rank: 1 },
  consigliere: { label: 'Consigliere',  subLabel: 'Advisor',            icon: '🎭', color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/40',   rank: 2 },
  capo:        { label: 'Caporegime',   subLabel: 'Officer',            icon: '🎖️', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/40',rank: 3 },
  soldier:     { label: 'Soldier',      subLabel: 'Made Man',           icon: '🔫', color: 'text-zinc-300',    bg: 'bg-zinc-500/10',    border: 'border-zinc-600/40',   rank: 4 },
  associate:   { label: 'Associate',    subLabel: 'Crew Member',        icon: '👤', color: 'text-zinc-400',    bg: 'bg-zinc-500/10',    border: 'border-zinc-700/40',   rank: 5 },
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

const fpStyles = `
  @keyframes fp-in   { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fp-glow { 0%,100%{ opacity:.25; } 50%{ opacity:.6; } }
  @keyframes fp-flicker { 0%,100%{ opacity:.7; } 45%{ opacity:.4; } 50%{ opacity:.9; } 55%{ opacity:.5; } }
  @keyframes fp-scan  { from { transform: translateY(-100%); } to { transform: translateY(400%); } }
  .fp-in      { animation: fp-in 0.45s ease-out both; }
  .fp-glow    { animation: fp-glow 4s ease-in-out infinite; }
  .fp-flicker { animation: fp-flicker 3.5s ease-in-out infinite; }
  .fp-hover   { transition: all 0.2s ease; }
  .fp-hover:hover { transform: translateX(3px); background-color: rgba(var(--noir-primary-rgb),0.04); }
  .fp-shimmer {
    background: linear-gradient(90deg, rgba(var(--noir-primary-rgb),.6) 0%, rgba(var(--noir-primary-rgb),1) 50%, rgba(var(--noir-primary-rgb),.6) 100%);
    background-size: 200% auto;
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    animation: fp-shimmer 3s linear infinite;
  }
  @keyframes fp-shimmer { 0%{ background-position:-200% center; } 100%{ background-position:200% center; } }
  .fp-stamp {
    position: relative; display: inline-block;
    border: 2px solid rgba(var(--noir-primary-rgb),.35);
    color: rgba(var(--noir-primary-rgb),.6);
    font-family: var(--font-heading); font-weight:900; letter-spacing:.15em;
    padding: 2px 8px; border-radius:4px;
    transform: rotate(-2deg);
  }
  .fp-stamp::before {
    content:''; position:absolute; inset:0;
    background: rgba(var(--noir-primary-rgb),.04); border-radius:2px;
  }
  .fp-divider { height:1px; background: repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(var(--noir-primary-rgb),.12) 4px, rgba(var(--noir-primary-rgb),.12) 8px); }
  .fp-scanline { position:absolute; left:0; right:0; height:2px; background: linear-gradient(transparent, rgba(var(--noir-primary-rgb),.06), transparent); animation: fp-scan 6s linear infinite; pointer-events:none; }
`;

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

  const sorted = [...members].sort((a, b) => (getRoleConfig(a.role).rank ?? 5) - (getRoleConfig(b.role).rank ?? 5));
  const boss         = sorted.find(m => m.role === 'boss');
  const highCommand  = sorted.filter(m => ['underboss','consigliere'].includes(m.role));
  const officers     = sorted.filter(m => m.role === 'capo');
  const rankAndFile  = sorted.filter(m => ['soldier','associate'].includes(m.role));

  return (
    <div className={`space-y-3 ${styles.pageContent}`}>
      <style>{fpStyles}</style>

      {/* Back */}
      <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-1.5 text-zinc-500 hover:text-primary text-[10px] font-heading uppercase tracking-[0.15em] transition-colors group">
        <ArrowLeft size={11} className="group-hover:-translate-x-0.5 transition-transform" /> Back to families
      </button>

      {/* ══ DOSSIER HEADER ══ */}
      <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 fp-in`} style={{ animationDelay: '0s' }}>
        {/* scanline */}
        <div className="fp-scanline" />
        {/* top accent */}
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        {/* ambient glow */}
        <div className="absolute -top-8 -left-8 w-48 h-48 bg-primary/5 rounded-full blur-3xl pointer-events-none fp-glow" />
        <div className="absolute -top-4 right-0 w-32 h-32 bg-primary/3 rounded-full blur-2xl pointer-events-none" />

        <div className="px-5 pt-4 pb-5">
          {/* Dossier label row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1 h-3 bg-primary/50 rounded-full" />
              <span className="text-[8px] text-primary/40 font-heading uppercase tracking-[0.4em]">Crime Family Dossier</span>
            </div>
            <span className="fp-stamp text-[9px]">{family.tag}</span>
          </div>

          {/* Name + my role badge */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-heading font-black text-primary tracking-widest uppercase leading-none">
                {family.name}
              </h1>
              {family.my_role && (
                <span className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded text-[9px] font-heading font-bold
                  ${getRoleConfig(family.my_role).bg} ${getRoleConfig(family.my_role).color} ${getRoleConfig(family.my_role).border} border`}>
                  {getRoleConfig(family.my_role).icon} {getRoleConfig(family.my_role).label} — Your rank
                </span>
              )}
            </div>

            {/* Intel stats */}
            <div className="flex items-stretch gap-0 rounded-lg overflow-hidden border border-primary/15 bg-zinc-900/60 divide-x divide-primary/10">
              {[
                { label: 'Vault',     value: formatMoney(family.treasury), gold: true },
                { label: 'Made Men',  value: members.length + (fallen.length > 0 ? ` +${fallen.length}†` : '') },
                { label: 'Rackets',   value: rackets.length },
              ].map(({ label, value, gold }) => (
                <div key={label} className="flex flex-col items-center justify-center px-4 py-2.5 min-w-[64px]">
                  <span className="text-[7px] text-zinc-500 font-heading uppercase tracking-[0.2em] mb-0.5">{label}</span>
                  <span className={`text-sm font-heading font-black leading-none ${gold ? 'fp-shimmer' : 'text-foreground'}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="fp-divider mx-5 mb-0" />
      </div>

      {/* ══ CREW OC ══ */}
      <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/15 fp-in`} style={{ animationDelay: '0.08s' }}>
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-primary/10">
          <div className="flex items-center gap-2">
            <Crosshair size={11} className="text-primary/70" />
            <span className="text-[10px] font-heading font-bold text-primary/80 uppercase tracking-[0.2em]">Crew OC</span>
          </div>
          <span className={`text-[9px] font-heading font-bold px-2 py-0.5 rounded ${
            crewOCAvailable
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/25'
          }`}>
            {crewOCAvailable ? '● Available' : formatTimeLeft(crewOCCooldown)}
          </span>
        </div>
        <div className="p-3 space-y-2.5">
          {(family.crew_oc_crew?.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {family.crew_oc_crew.map((c, i) => (
                <span key={`${c.username}-${i}`} className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-heading ${
                  c.is_family_member
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/40'
                }`}>
                  <Link to={`/profile/${encodeURIComponent(c.username)}`} className="hover:underline">{c.username}</Link>
                  {!c.is_family_member && <span className="ml-1 opacity-60 text-[8px]">(ext)</span>}
                </span>
              ))}
            </div>
          )}
          {!isMyFamily && (
            crewOCApp ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/15">
                <Clock size={11} className="text-primary/70" />
                <p className="text-[10px] font-heading text-primary">Applied: <span className="font-bold uppercase">{crewOCApp.status}</span></p>
              </div>
            ) : (
              <button
                type="button" onClick={handleApplyCrewOC} disabled={crewOCApplyLoading}
                className="w-full py-2 font-heading font-bold uppercase tracking-wider text-[11px] rounded-lg border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
              >
                {crewOCApplyLoading ? 'Applying...' : crewOCFee > 0 ? `Apply — $${crewOCFee.toLocaleString()}` : 'Apply (free)'}
              </button>
            )
          )}
          {family.crew_oc_forum_topic_id && (
            <Link to={`/forum/topic/${family.crew_oc_forum_topic_id}`} className="inline-flex items-center gap-1.5 text-[10px] font-heading text-primary/70 hover:text-primary transition-colors">
              <Clock size={10} /> View Crew OC topic
            </Link>
          )}
        </div>
      </div>

      {/* ══ RACKETS ══ */}
      {rackets.length > 0 && (
        <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/15 fp-in`} style={{ animationDelay: '0.12s' }}>
          <div className="px-4 py-2.5 flex items-center gap-2 border-b border-primary/10">
            <TrendingUp size={11} className="text-primary/70" />
            <span className="text-[10px] font-heading font-bold text-primary/80 uppercase tracking-[0.2em]">Rackets</span>
            <span className="text-[9px] text-zinc-600 font-heading ml-auto">{rackets.filter(r => r.level > 0).length} active</span>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {rackets.map((r, idx) => {
                const isMax = r.level >= 5;
                return (
                  <div key={r.id} className={`relative rounded-lg p-2.5 border fp-in ${
                    isMax ? 'border-primary/25 bg-primary/5' : 'border-zinc-700/30 bg-zinc-800/30 hover:border-zinc-600/50'
                  }`} style={{ animationDelay: `${0.12 + idx * 0.03}s`, transition: 'all 0.2s ease' }}>
                    {isMax && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />}
                    <p className="font-heading font-bold text-[10px] truncate text-foreground/80">{r.name}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className={`text-[9px] font-heading font-bold ${isMax ? 'text-primary' : 'text-primary/70'}`}>
                        {isMax ? 'MAX' : `Lv ${r.level}`}
                      </span>
                      <div className="w-8 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${isMax ? 'bg-gradient-to-r from-primary to-amber-400' : 'bg-primary/70'}`} style={{ width: `${(r.level / 5) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ HIERARCHY ══ */}
      <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/15 fp-in`} style={{ animationDelay: '0.18s' }}>
        {/* Header */}
        <div className="px-4 py-2.5 flex items-center gap-2 border-b border-primary/10">
          <Users size={11} className="text-primary/70" />
          <span className="text-[10px] font-heading font-bold text-primary/80 uppercase tracking-[0.2em]">The Family</span>
          <span className="text-[9px] text-zinc-600 font-heading ml-auto">{members.length} active</span>
        </div>

        <div className="p-3 space-y-3">

          {/* The Don — full-width feature card */}
          {boss && (() => {
            const cfg = getRoleConfig(boss.role);
            return (
              <div className="relative rounded-xl overflow-hidden border-2 border-yellow-500/30 bg-gradient-to-br from-yellow-500/8 via-primary/5 to-transparent fp-in" style={{ animationDelay: '0.2s' }}>
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-yellow-400/50 to-transparent" />
                <div className="absolute -top-6 -left-6 w-20 h-20 bg-yellow-500/8 rounded-full blur-2xl pointer-events-none fp-glow" />
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center text-sm shrink-0">
                      👑
                    </div>
                    <div>
                      <Link to={`/profile/${encodeURIComponent(boss.username)}`} className="font-heading font-black text-sm text-yellow-400 hover:text-yellow-300 transition-colors block leading-tight">
                        {boss.username}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] font-heading font-bold text-yellow-500/80 uppercase tracking-widest">Don</span>
                        {boss.rank_name && <span className="text-[9px] text-zinc-500">· {boss.rank_name}</span>}
                      </div>
                    </div>
                  </div>
                  <span className="text-[8px] text-yellow-500/40 font-heading uppercase tracking-[0.2em] text-right leading-tight hidden sm:block">
                    Capo di<br />tutti Capi
                  </span>
                </div>
              </div>
            );
          })()}

          {/* High Command — Underboss / Consigliere */}
          {highCommand.length > 0 && (
            <div>
              <p className="text-[8px] text-zinc-600 font-heading uppercase tracking-[0.25em] mb-1.5 px-0.5">High Command</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {highCommand.map((m, idx) => {
                  const cfg = getRoleConfig(m.role);
                  return (
                    <div key={m.user_id} className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg border fp-hover fp-in ${cfg.bg} ${cfg.border}`} style={{ animationDelay: `${0.22 + idx * 0.04}s` }}>
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-lg" style={{ background: `currentColor`, opacity: 0.3 }} />
                      <span className="text-base shrink-0">{cfg.icon}</span>
                      <div className="min-w-0">
                        <Link to={`/profile/${encodeURIComponent(m.username)}`} className={`font-heading font-bold text-xs ${cfg.color} hover:opacity-80 transition-opacity block truncate`}>
                          {m.username}
                        </Link>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-[9px] font-heading font-bold ${cfg.color} opacity-80`}>{cfg.label}</span>
                          {m.rank_name && <span className="text-[9px] text-zinc-600">· {m.rank_name}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Officers */}
          {officers.length > 0 && (
            <div>
              <p className="text-[8px] text-zinc-600 font-heading uppercase tracking-[0.25em] mb-1.5 px-0.5">Officers</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {officers.map((m, idx) => {
                  const cfg = getRoleConfig(m.role);
                  return (
                    <div key={m.user_id} className="relative flex items-center gap-2.5 px-3 py-2 rounded-lg bg-zinc-800/40 border border-emerald-500/15 fp-hover fp-in" style={{ animationDelay: `${0.28 + idx * 0.04}s` }}>
                      <span className="text-sm shrink-0">{cfg.icon}</span>
                      <div className="min-w-0">
                        <Link to={`/profile/${encodeURIComponent(m.username)}`} className="font-heading font-bold text-xs text-emerald-400 hover:text-emerald-300 transition-colors block truncate">
                          {m.username}
                        </Link>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[9px] font-heading text-emerald-500/70">Caporegime</span>
                          {m.rank_name && <span className="text-[9px] text-zinc-600">· {m.rank_name}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rank & File */}
          {rankAndFile.length > 0 && (
            <div>
              <p className="text-[8px] text-zinc-600 font-heading uppercase tracking-[0.25em] mb-1.5 px-0.5">Rank & File</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {rankAndFile.map((m, idx) => {
                  const cfg = getRoleConfig(m.role);
                  const isSoldier = m.role === 'soldier';
                  return (
                    <div key={m.user_id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/25 border border-zinc-700/20 fp-hover fp-in" style={{ animationDelay: `${0.32 + idx * 0.03}s` }}>
                      <span className="text-xs shrink-0 opacity-70">{cfg.icon}</span>
                      <div className="min-w-0 flex items-center gap-2 flex-1">
                        <Link to={`/profile/${encodeURIComponent(m.username)}`} className={`font-heading font-bold text-[11px] ${isSoldier ? 'text-zinc-300' : 'text-zinc-400'} hover:text-primary transition-colors truncate`}>
                          {m.username}
                        </Link>
                        {m.rank_name && <span className="text-[9px] text-zinc-600 shrink-0">{m.rank_name}</span>}
                      </div>
                      <span className={`text-[8px] font-heading shrink-0 ${cfg.color} opacity-60`}>{cfg.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {members.length === 0 && (
            <div className="text-center py-8">
              <Users size={24} className="mx-auto text-zinc-700 mb-2" />
              <p className="text-[10px] text-zinc-500 font-heading italic">No made men — family is ghost</p>
            </div>
          )}
        </div>

        {/* ── GRAVEYARD ── */}
        {fallen.length > 0 && (
          <div className="border-t border-zinc-800/60 bg-zinc-950/40">
            <div className="px-4 pt-3 pb-1 flex items-center gap-2">
              <Skull size={11} className="text-zinc-600 fp-flicker" />
              <p className="text-[9px] text-zinc-600 font-heading uppercase tracking-[0.3em]">In Memoriam — {fallen.length} fallen</p>
              <div className="flex-1 h-px bg-zinc-800/60 ml-2" />
            </div>
            <div className="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {fallen.map((m, idx) => {
                const cfg = getRoleConfig(m.role);
                const deadDate = m.dead_at
                  ? new Date(m.dead_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })
                  : null;
                return (
                  <div
                    key={m.user_id}
                    className="relative flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/40 opacity-60 fp-in"
                    style={{ animationDelay: `${0.35 + idx * 0.04}s` }}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-700/50 rounded-l-lg" />
                    <div className="min-w-0 flex items-center gap-2">
                      <Skull size={9} className="text-zinc-700 shrink-0 fp-flicker" style={{ animationDelay: `${idx * 0.6}s` }} />
                      <div className="min-w-0">
                        <Link
                          to={`/profile/${encodeURIComponent(m.username)}`}
                          className="font-heading font-bold text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors block truncate line-through decoration-zinc-700/60"
                        >
                          {m.username}
                        </Link>
                        <span className={`text-[8px] font-heading ${cfg.color} opacity-50`}>
                          {cfg.icon} {cfg.label}
                          {m.rank_name && <span className="text-zinc-700 ml-1">· {m.rank_name}</span>}
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
    </div>
  );
}
