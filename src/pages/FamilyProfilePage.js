import { useState, useEffect } from 'react';
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
  boss: { label: 'Don', icon: '👑', color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/40' },
  underboss: { label: 'Underboss', icon: '⭐', color: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/40' },
  consigliere: { label: 'Consigliere', icon: '🎭', color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500/40' },
  capo: { label: 'Caporegime', icon: '🎖️', color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/40' },
  soldier: { label: 'Soldier', icon: '🔫', color: 'text-zinc-300', bg: 'bg-zinc-500/20', border: 'border-zinc-500/40' },
  associate: { label: 'Associate', icon: '👤', color: 'text-zinc-400', bg: 'bg-zinc-500/20', border: 'border-zinc-500/40' },
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

const profileStyles = `
  @keyframes fp-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .fp-fade-in { animation: fp-fade-in 0.4s ease-out both; }
  @keyframes fp-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .fp-scale-in { animation: fp-scale-in 0.35s ease-out both; }
  @keyframes fp-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .fp-glow { animation: fp-glow 4s ease-in-out infinite; }
  .fp-corner::before, .fp-corner::after { content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none; }
  .fp-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .fp-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .fp-member-row { transition: all 0.2s ease; }
  .fp-member-row:hover { transform: translateX(3px); background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .fp-stat-card { transition: all 0.3s ease; }
  .fp-stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.25); }
  @keyframes fp-shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  .fp-shimmer {
    background: linear-gradient(90deg, rgba(var(--noir-primary-rgb),0.6) 0%, rgba(var(--noir-primary-rgb),1) 50%, rgba(var(--noir-primary-rgb),0.6) 100%);
    background-size: 200% auto;
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    animation: fp-shimmer 3s linear infinite;
  }
`;

export default function FamilyProfilePage() {
  const { familyId } = useParams();
  const navigate = useNavigate();
  const [family, setFamily] = useState(null);
  const [loading, setLoading] = useState(true);
  const [crewOCApplyLoading, setCrewOCApplyLoading] = useState(false);

  useEffect(() => {
    const id = (familyId && String(familyId).trim()) || '';
    if (!id || id === 'undefined' || id === 'null') {
      setFamily(null);
      setLoading(false);
      return;
    }
    const run = async () => {
      setLoading(true);
      try {
        const res = await api.get('/families/lookup', { params: { tag: id } });
        setFamily(res.data);
      } catch (e) {
        const detail = e.response?.data?.detail ?? e.message ?? 'Family not found';
        const status = e.response?.status;
        if (status === 404) {
          console.warn('Family not found. Requested id:', id, 'Response:', e.response?.data);
        }
        toast.error(detail);
        setFamily(null);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [familyId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Gathering intel...</span>
      </div>
    );
  }

  if (!family) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-2 text-zinc-500 hover:text-primary text-xs font-heading uppercase tracking-wider transition-colors">
          <ArrowLeft size={14} /> Back to families
        </button>
        <div className="text-center py-16 bg-zinc-800/20 rounded-xl border border-dashed border-zinc-700/40">
          <Building2 size={36} className="mx-auto text-zinc-700 mb-3" />
          <p className="text-zinc-500 font-heading tracking-wider uppercase text-sm">Family not found</p>
          <p className="text-[9px] text-zinc-600 font-heading mt-1 italic">This outfit doesn't exist... or someone made them disappear</p>
        </div>
      </div>
    );
  }

  const members = family.members || [];
  const fallen = family.fallen || [];
  const rackets = family.rackets || [];
  const isMyFamily = !!family.my_role;
  const crewOCFee = family.crew_oc_join_fee ?? 0;
  const crewOCCooldown = family.crew_oc_cooldown_until;
  const crewOCAvailable = !crewOCCooldown || formatTimeLeft(crewOCCooldown) === 'Ready';
  const crewOCApp = family.crew_oc_application;

  const handleApplyCrewOC = async () => {
    setCrewOCApplyLoading(true);
    try {
      const res = await api.post('/families/crew-oc/apply', { family_id: family.id });
      toast.success(res.data?.message || 'Applied.');
      const r = await api.get('/families/lookup', { params: { tag: family.tag } });
      setFamily(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to apply');
    } finally {
      setCrewOCApplyLoading(false);
    }
  };

  const sortedMembers = [...members].sort((a, b) => (getRoleConfig(a.role).rank ?? 5) - (getRoleConfig(b.role).rank ?? 5));

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      <style>{profileStyles}</style>
      {/* Back button */}
      <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-1.5 text-zinc-500 hover:text-primary text-[10px] font-heading uppercase tracking-[0.15em] transition-colors group">
        <ArrowLeft size={12} className="group-hover:-translate-x-0.5 transition-transform" /> Back to families
      </button>

      {/* ── Family Banner ── */}
      <div className={`relative ${styles.panel} rounded-xl overflow-hidden border-2 border-primary/25 fp-scale-in fp-corner`}>
        <div className="h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="absolute top-0 left-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none fp-glow" />
        <div className="absolute top-0 right-0 w-24 h-24 bg-primary/3 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent" />

        <div className="px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1.5">Crime Family Dossier</p>
              <div className="flex items-center gap-2 mb-1.5">
                <Building2 size={20} className="text-primary" />
                <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">{family.name}</h1>
                <span className="text-sm text-primary/30 font-mono">[{family.tag}]</span>
              </div>
              {family.my_role && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-heading font-bold ${getRoleConfig(family.my_role).bg} ${getRoleConfig(family.my_role).color} ${getRoleConfig(family.my_role).border} border`}>
                  {getRoleConfig(family.my_role).icon} {getRoleConfig(family.my_role).label}
                </span>
              )}
            </div>

            {/* Stats badges */}
            <div className="flex items-center gap-5">
              <div className="text-center fp-stat-card rounded-lg px-2 py-1">
                <div className="text-[8px] text-zinc-500 font-heading uppercase tracking-[0.15em]">Vault</div>
                <div className="text-sm font-heading font-bold fp-shimmer">{formatMoney(family.treasury)}</div>
              </div>
              <div className="text-center fp-stat-card rounded-lg px-2 py-1">
                <div className="text-[8px] text-zinc-500 font-heading uppercase tracking-[0.15em]">Made Men</div>
                <div className="text-sm font-heading font-bold text-foreground">
                  {family.member_count}
                  {fallen.length > 0 && <span className="text-[10px] text-zinc-600 ml-1">+{fallen.length}†</span>}
                </div>
              </div>
              <div className="text-center fp-stat-card rounded-lg px-2 py-1">
                <div className="text-[8px] text-zinc-500 font-heading uppercase tracking-[0.15em]">Rackets</div>
                <div className="text-sm font-heading font-bold text-foreground">{rackets.length}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="h-px mx-4" style={{ background: 'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(var(--noir-primary-rgb), 0.15) 4px, rgba(var(--noir-primary-rgb), 0.15) 8px, transparent 8px, transparent 16px)' }} />
      </div>

      {/* ── Crew OC ── */}
      <div className={`${styles.panel} rounded-xl overflow-hidden fp-fade-in`} style={{ animationDelay: '0.1s' }}>
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-primary/20">
          <div className="flex items-center gap-2">
            <Crosshair size={13} className="text-primary" />
            <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">Crew OC</h3>
          </div>
          <span className={`text-[10px] font-heading font-bold px-2 py-0.5 rounded-md ${
            crewOCAvailable ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
          }`}>
            {crewOCAvailable ? '● Available' : formatTimeLeft(crewOCCooldown)}
          </span>
        </div>
        <div className="p-4 space-y-3">
          {(family.crew_oc_crew?.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {family.crew_oc_crew.map((c, i) => (
                <span
                  key={`${c.username}-${i}`}
                  className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-heading transition-all ${
                    c.is_family_member
                      ? 'bg-primary/15 text-primary border border-primary/25'
                      : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/40'
                  }`}
                >
                  <Link to={`/profile/${encodeURIComponent(c.username)}`} className="hover:underline">{c.username}</Link>
                  {!c.is_family_member && <span className="ml-1 opacity-70 text-[9px]">(ext)</span>}
                </span>
              ))}
            </div>
          )}
          {!isMyFamily && (
            <div>
              {crewOCApp ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Clock size={12} className="text-primary" />
                  <p className="text-[11px] font-heading text-primary">Applied: <span className="font-bold uppercase">{crewOCApp.status}</span></p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleApplyCrewOC}
                  disabled={crewOCApplyLoading}
                  className="w-full py-2.5 font-heading font-bold uppercase tracking-wider text-xs rounded-lg border-2 bg-gradient-to-b from-primary/25 to-primary/10 border-primary/40 text-primary hover:from-primary/35 hover:shadow-lg hover:shadow-primary/10 disabled:opacity-50 transition-all"
                >
                  {crewOCApplyLoading ? 'Applying...' : crewOCFee > 0 ? `Apply — $${crewOCFee.toLocaleString()}` : 'Apply (free)'}
                </button>
              )}
            </div>
          )}
          {family.crew_oc_forum_topic_id && (
            <Link to={`/forum/topic/${family.crew_oc_forum_topic_id}`} className="inline-flex items-center gap-1.5 text-[11px] font-heading text-primary hover:underline transition-colors">
              <Clock size={11} /> View Crew OC topic
            </Link>
          )}
        </div>
      </div>

      {/* ── Rackets ── */}
      <div className={`${styles.panel} rounded-xl overflow-hidden fp-fade-in`} style={{ animationDelay: '0.15s' }}>
        <div className="px-4 py-2.5 flex items-center gap-2 border-b border-primary/20">
          <TrendingUp size={13} className="text-primary" />
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.2em]">Rackets</h3>
          <span className="text-[10px] text-zinc-500 font-heading ml-auto">{rackets.filter(r => r.level > 0).length}/{rackets.length} running</span>
        </div>
        <div className="p-4">
          {rackets.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {rackets.map((r, idx) => {
                const locked = r.locked || r.level <= 0;
                const isMax = r.level >= 5;
                return (
                  <div key={r.id} className={`relative rounded-lg p-2.5 transition-all bg-zinc-800/30 border fp-scale-in ${
                    locked ? 'border-dashed border-zinc-700/30 opacity-40' : isMax ? 'border-primary/25' : 'border-zinc-700/30 hover:border-zinc-600/50'
                  }`} style={{ animationDelay: `${idx * 0.03}s`, transition: 'all 0.2s ease' }}>
                    {isMax && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />}
                    <p className={`font-heading font-bold text-[11px] truncate tracking-wide ${locked ? 'text-zinc-500' : 'text-foreground'}`}>{r.name}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className={`text-[10px] font-heading font-bold ${locked ? 'text-zinc-600' : isMax ? 'text-primary' : 'text-primary/80'}`}>
                        {locked ? 'Locked' : isMax ? 'MAX' : `Lv ${r.level}`}
                      </span>
                      {!locked && (
                        <div className="w-8 h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${isMax ? 'bg-gradient-to-r from-primary to-amber-400' : 'bg-primary'}`} style={{ width: `${(r.level / 5) * 100}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <TrendingUp size={24} className="mx-auto text-zinc-700 mb-2" />
              <p className="text-[10px] text-zinc-500 font-heading italic">No rackets established yet</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Members ── */}
      <div className={`${styles.panel} rounded-xl overflow-hidden fp-fade-in`} style={{ animationDelay: '0.2s' }}>
        <div className="px-4 py-2.5 flex items-center gap-2 border-b border-primary/20">
          <Users size={13} className="text-primary" />
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.2em]">Made Men & Associates</h3>
          <span className="text-[10px] text-zinc-500 font-heading ml-auto">{members.length} sworn</span>
          {fallen.length > 0 && (
            <span className="text-[10px] text-zinc-600 font-heading flex items-center gap-1">
              <Skull size={9} /> {fallen.length} fallen
            </span>
          )}
        </div>
        <div className="p-3">
          {members.length === 0 ? (
            <div className="text-center py-8">
              <Users size={24} className="mx-auto text-zinc-700 mb-2" />
              <p className="text-[10px] text-zinc-500 font-heading italic">No made men</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sortedMembers.map((m, idx) => {
                const cfg = getRoleConfig(m.role);
                const isBoss = m.role === 'boss';
                const isHighRank = ['boss', 'underboss', 'consigliere'].includes(m.role);
                return (
                  <div key={m.user_id} className={`relative flex items-center justify-between px-3 py-2.5 rounded-lg fp-member-row fp-fade-in overflow-hidden ${
                    isBoss ? 'bg-gradient-to-r from-primary/8 to-primary/3 border-2 border-primary/25' : isHighRank ? 'bg-zinc-800/40 border border-zinc-700/40' : 'bg-zinc-800/30 border border-zinc-700/30'
                  }`} style={{ animationDelay: `${idx * 0.03}s` }}>
                    {isBoss && <>
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                      <div className="absolute -top-4 -left-4 w-14 h-14 bg-primary/5 rounded-full blur-xl pointer-events-none" />
                    </>}
                    <div className="min-w-0">
                      <Link to={`/profile/${encodeURIComponent(m.username)}`} className={`font-heading font-bold text-xs hover:text-primary transition-colors block truncate ${isBoss ? 'text-primary' : 'text-foreground'}`}>
                        {m.username}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`inline-flex items-center gap-0.5 text-[9px] font-heading font-bold ${cfg.color}`}>
                          {cfg.icon} {cfg.label}
                        </span>
                        {m.rank_name && <span className="text-[9px] text-zinc-500">· {m.rank_name}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Graveyard ── */}
        {fallen.length > 0 && (
          <div className="px-3 pb-3 pt-0 border-t border-zinc-700/30 mt-0">
            <div className="flex items-center gap-2 py-2.5">
              <Skull size={11} className="text-zinc-600" />
              <p className="text-[9px] text-zinc-600 font-heading uppercase tracking-[0.2em]">Graveyard — {fallen.length} fallen</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {fallen.map((m, idx) => {
                const cfg = getRoleConfig(m.role);
                const deadDate = m.dead_at
                  ? new Date(m.dead_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })
                  : null;
                return (
                  <div
                    key={m.user_id}
                    className="relative flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50 opacity-55 fp-fade-in"
                    style={{ animationDelay: `${idx * 0.04}s` }}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-700/40 rounded-l-lg" />
                    <div className="min-w-0 flex items-center gap-2">
                      <Skull size={10} className="text-zinc-600 shrink-0" />
                      <div className="min-w-0">
                        <Link
                          to={`/profile/${encodeURIComponent(m.username)}`}
                          className="font-heading font-bold text-xs text-zinc-500 hover:text-zinc-300 transition-colors block truncate line-through decoration-zinc-700"
                        >
                          {m.username}
                        </Link>
                        <span className={`inline-flex items-center gap-0.5 text-[9px] font-heading ${cfg.color} opacity-60`}>
                          {cfg.icon} {cfg.label}
                          {m.rank_name && <span className="text-zinc-600 ml-1">· {m.rank_name}</span>}
                        </span>
                      </div>
                    </div>
                    {deadDate && (
                      <span className="text-[8px] text-zinc-700 font-heading shrink-0 ml-2">†&nbsp;{deadDate}</span>
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
