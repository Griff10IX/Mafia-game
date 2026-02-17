import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../utils/api';
import { Building2, Users, TrendingUp, ArrowLeft, Crosshair, Clock, DollarSign, Shield } from 'lucide-react';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

const ROLE_CONFIG = {
  boss: { label: 'Boss', icon: '👑', color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/40' },
  underboss: { label: 'Underboss', icon: '⭐', color: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/40' },
  consigliere: { label: 'Consigliere', icon: '🎭', color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500/40' },
  capo: { label: 'Capo', icon: '🎖️', color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/40' },
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
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-sm font-heading uppercase tracking-widest">Loading...</span>
        </div>
      </div>
    );
  }

  if (!family) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-2 text-zinc-500 hover:text-primary text-xs font-heading uppercase tracking-wider transition-colors">
          <ArrowLeft size={14} /> Back to families
        </button>
        <div className="text-center py-16 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(30,30,28,0.6), rgba(20,20,18,0.7))', border: '1px solid #3a3a38' }}>
          <Building2 size={32} className="mx-auto text-zinc-600 mb-2" />
          <p className="text-zinc-500 font-heading">Family not found.</p>
        </div>
      </div>
    );
  }

  const members = family.members || [];
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
      {/* Back button */}
      <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-1.5 text-zinc-500 hover:text-primary text-[10px] font-heading uppercase tracking-wider transition-colors">
        <ArrowLeft size={12} /> Back to families
      </button>

      {/* ── Family Banner ── */}
      <div className="relative rounded-xl overflow-hidden" style={{
        background: 'linear-gradient(135deg, #1a1a1a 0%, #1e1e1c 50%, #141414 100%)',
        border: '2px solid rgba(212,175,55,0.2)',
      }}>
        <div className="h-1" style={{ background: 'linear-gradient(90deg, transparent, #d4af37, transparent)' }} />
        <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl pointer-events-none" />

        <div className="px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 size={20} className="text-primary" />
                <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">{family.name}</h1>
                <span className="text-sm text-primary/50 font-mono">[{family.tag}]</span>
              </div>
              {family.my_role && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-heading font-bold ${getRoleConfig(family.my_role).bg} ${getRoleConfig(family.my_role).color} ${getRoleConfig(family.my_role).border} border`}>
                  {getRoleConfig(family.my_role).icon} {getRoleConfig(family.my_role).label}
                </span>
              )}
            </div>

            {/* Stats badges */}
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-[9px] text-zinc-500 font-heading uppercase">Treasury</div>
                <div className="text-sm font-heading font-bold text-primary">{formatMoney(family.treasury)}</div>
              </div>
              <div className="text-center">
                <div className="text-[9px] text-zinc-500 font-heading uppercase">Members</div>
                <div className="text-sm font-heading font-bold text-foreground">{family.member_count}</div>
              </div>
              <div className="text-center">
                <div className="text-[9px] text-zinc-500 font-heading uppercase">Rackets</div>
                <div className="text-sm font-heading font-bold text-foreground">{rackets.length}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,175,55,0.15), transparent)' }} />
      </div>

      {/* ── Crew OC ── */}
      <div className="rounded-xl overflow-hidden" style={{
        background: 'linear-gradient(135deg, #1a1a1a, #0f0f0f)',
        border: '1px solid #3a3a38',
      }}>
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid #3a3a38' }}>
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
      <div className="rounded-xl overflow-hidden" style={{
        background: 'linear-gradient(135deg, #1a1a1a, #0f0f0f)',
        border: '1px solid #3a3a38',
      }}>
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid #3a3a38' }}>
          <TrendingUp size={13} className="text-primary" />
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">Rackets</h3>
          <span className="text-[10px] text-zinc-500 font-heading ml-auto">{rackets.filter(r => r.level > 0).length}/{rackets.length} active</span>
        </div>
        <div className="p-4">
          {rackets.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {rackets.map((r) => {
                const locked = r.locked || r.level <= 0;
                return (
                  <div key={r.id} className="rounded-lg p-2.5 transition-all" style={{
                    background: locked
                      ? 'linear-gradient(135deg, rgba(20,20,18,0.4), rgba(15,15,13,0.5))'
                      : 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
                    border: locked ? '1px dashed #333' : '1px solid #3a3a38',
                    opacity: locked ? 0.5 : 1,
                  }}>
                    <p className={`font-heading font-bold text-[11px] truncate ${locked ? 'text-zinc-500' : 'text-foreground'}`}>{r.name}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-[10px] font-heading font-bold ${locked ? 'text-zinc-600' : 'text-primary'}`}>
                        {locked ? 'Locked' : `Lv ${r.level}`}
                      </span>
                      {!locked && (
                        <div className="w-8 h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(r.level / 5) * 100}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6">
              <TrendingUp size={20} className="mx-auto text-zinc-600 mb-1" />
              <p className="text-[10px] text-zinc-500 font-heading italic">No rackets yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Members ── */}
      <div className="rounded-xl overflow-hidden" style={{
        background: 'linear-gradient(135deg, #1a1a1a, #0f0f0f)',
        border: '1px solid #3a3a38',
      }}>
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid #3a3a38' }}>
          <Users size={13} className="text-primary" />
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">Members</h3>
          <span className="text-[10px] text-zinc-500 font-heading ml-auto">{members.length}</span>
        </div>
        <div className="p-3">
          {members.length === 0 ? (
            <div className="text-center py-6">
              <Users size={20} className="mx-auto text-zinc-600 mb-1" />
              <p className="text-[10px] text-zinc-500 font-heading italic">No members.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sortedMembers.map((m) => {
                const cfg = getRoleConfig(m.role);
                const isBoss = m.role === 'boss';
                return (
                  <div key={m.user_id} className="flex items-center justify-between px-3 py-2 rounded-lg transition-all" style={{
                    background: isBoss
                      ? 'linear-gradient(135deg, rgba(212,175,55,0.06), rgba(30,30,28,0.8))'
                      : 'linear-gradient(135deg, rgba(30,30,28,0.6), rgba(20,20,18,0.7))',
                    border: isBoss ? '1px solid rgba(212,175,55,0.2)' : '1px solid #2a2a28',
                  }}>
                    <div className="min-w-0">
                      <Link to={`/profile/${encodeURIComponent(m.username)}`} className="font-heading font-bold text-foreground text-xs hover:text-primary transition-colors block truncate">
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
      </div>
    </div>
  );
}
