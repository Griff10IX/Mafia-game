import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../utils/api';
import { Building2, Users, TrendingUp, ArrowLeft, Crosshair, Clock } from 'lucide-react';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

const ROLE_LABELS = { boss: 'Boss', underboss: 'Underboss', consigliere: 'Consigliere', capo: 'Capo', soldier: 'Soldier', associate: 'Associate' };

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
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  if (!family) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-2 text-mutedForeground hover:text-primary text-xs font-heading uppercase tracking-wider">
          <ArrowLeft size={14} /> Back to families
        </button>
        <p className="text-mutedForeground font-heading">Family not found.</p>
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

  return (
    <div className={`space-y-3 ${styles.pageContent}`}>
      <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-1.5 text-mutedForeground hover:text-primary text-[10px] font-heading uppercase tracking-wider">
        <ArrowLeft size={12} /> Back to families
      </button>

      {/* Compact header + family strip */}
      <div className="flex items-center gap-2 mb-1">
        <Building2 size={18} className="text-primary/80 shrink-0" />
        <h1 className="text-lg font-heading font-bold text-primary tracking-wider uppercase truncate">{family.name}</h1>
      </div>

      {/* Family info – single compact row */}
      <div className={`${styles.panel} border border-primary/30 rounded overflow-hidden`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/20 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-heading font-bold text-foreground text-sm truncate">{family.name} <span className="text-primary/80">[{family.tag}]</span></span>
            {family.my_role && (
              <span className="text-[10px] text-mutedForeground font-heading shrink-0">Role: <span className="text-primary font-bold uppercase">{ROLE_LABELS[family.my_role] || family.my_role}</span></span>
            )}
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-baseline gap-1">
              <span className="text-[10px] text-mutedForeground font-heading uppercase">Treasury</span>
              <span className="text-sm font-heading font-bold text-primary tabular-nums">{formatMoney(family.treasury)}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[10px] text-mutedForeground font-heading uppercase">Members</span>
              <span className="text-sm font-heading font-bold text-foreground tabular-nums">{family.member_count}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Crew OC – compact */}
      <div className={`${styles.panel} rounded overflow-hidden`}>
        <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/20 flex items-center gap-2">
          <Crosshair size={12} className="text-primary shrink-0" />
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">Crew OC</h3>
          <span className={`ml-auto text-[10px] font-heading font-bold ${crewOCAvailable ? 'text-emerald-400' : 'text-amber-400'}`}>
            {crewOCAvailable ? 'Available' : formatTimeLeft(crewOCCooldown)}
          </span>
        </div>
        <div className="p-3 space-y-2">
          {(family.crew_oc_crew?.length > 0) && (
            <div className="flex flex-wrap gap-1">
              {family.crew_oc_crew.map((c, i) => (
                <span
                  key={`${c.username}-${i}`}
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-heading ${
                    c.is_family_member ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-zinc-700/50 text-mutedForeground border border-zinc-600/50'
                  }`}
                >
                  {c.username}
                  {!c.is_family_member && <span className="ml-0.5 opacity-80">(crew)</span>}
                </span>
              ))}
            </div>
          )}
          {!isMyFamily && (
            <div>
              {crewOCApp ? (
                <p className="text-[10px] font-heading text-primary">Applied: {crewOCApp.status}</p>
              ) : (
                <button
                  type="button"
                  onClick={handleApplyCrewOC}
                  disabled={crewOCApplyLoading}
                  className="w-full py-1.5 font-heading font-bold uppercase tracking-wider text-[10px] rounded border bg-primary/20 text-primary border-primary/40 hover:bg-primary/30 disabled:opacity-50"
                >
                  {crewOCApplyLoading ? '...' : crewOCFee > 0 ? `Apply — $${crewOCFee.toLocaleString()}` : 'Apply (free)'}
                </button>
              )}
            </div>
          )}
          {family.crew_oc_forum_topic_id && (
            <Link to={`/forum/topic/${family.crew_oc_forum_topic_id}`} className="inline-flex items-center gap-1 text-[10px] font-heading text-primary hover:underline">
              <Clock size={10} /> Crew OC topic
            </Link>
          )}
        </div>
      </div>

      {/* Rackets – denser grid */}
      <div className={`${styles.panel} rounded overflow-hidden`}>
        <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/20 flex items-center gap-2">
          <TrendingUp size={12} className="text-primary shrink-0" />
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">Rackets</h3>
        </div>
        <div className="p-3">
          {rackets.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {rackets.map((r) => (
                <div key={r.id} className={`${styles.surfaceMuted} border border-primary/20 rounded px-2 py-1.5`}>
                  <p className="font-heading font-bold text-foreground text-[11px] truncate">{r.name}</p>
                  <p className="text-[10px] text-primary font-heading">Lv {r.level}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-mutedForeground font-heading italic">No rackets yet.</p>
          )}
        </div>
      </div>

      {/* Members – compact table */}
      <div className={`${styles.panel} rounded overflow-hidden`}>
        <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/20 flex items-center gap-2">
          <Users size={12} className="text-primary shrink-0" />
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">Members</h3>
        </div>
        <div className="p-2">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className={`border-b border-primary/20 ${styles.surfaceMuted}`}>
                  <th className="text-left py-1.5 px-2 font-heading font-bold text-primary uppercase tracking-wider">Member</th>
                  <th className="text-left py-1.5 px-2 font-heading font-bold text-primary uppercase tracking-wider">Role</th>
                  <th className="text-left py-1.5 px-2 font-heading font-bold text-primary uppercase tracking-wider">Rank</th>
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr><td colSpan={3} className="py-3 text-center text-mutedForeground font-heading italic text-[10px]">No members.</td></tr>
                ) : (
                  members.map((m) => (
                    <tr key={m.user_id} className="border-b border-primary/10 last:border-0 hover:bg-zinc-800/30">
                      <td className="py-1.5 px-2">
                        <Link to={`/profile/${encodeURIComponent(m.username)}`} className="font-heading font-medium text-foreground hover:text-primary">
                          {m.username}
                        </Link>
                      </td>
                      <td className="py-1.5 px-2">
                        <span className={m.role === 'boss' ? 'text-primary font-heading font-bold' : 'text-mutedForeground font-heading'}>
                          {ROLE_LABELS[m.role] || m.role}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-mutedForeground font-heading">{m.rank_name}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
