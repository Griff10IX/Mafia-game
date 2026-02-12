import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Building2, Users, DollarSign, TrendingUp, ArrowLeft } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

const ROLE_LABELS = { boss: 'Boss', underboss: 'Underboss', consigliere: 'Consigliere', capo: 'Capo', soldier: 'Soldier', associate: 'Associate' };

export default function FamilyProfilePage() {
  const { familyId } = useParams();
  const navigate = useNavigate();
  const [family, setFamily] = useState(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className={`space-y-5 ${styles.pageContent}`}>
      <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-2 text-mutedForeground hover:text-primary text-xs font-heading uppercase tracking-wider">
        <ArrowLeft size={14} /> Back to families
      </button>

      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-3">
            <Building2 size={24} className="text-primary/80" />
            {family.name}
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
      </div>

      {/* Family Info Card */}
      <div className={`${styles.panel} border border-primary/40 rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
        <div className="px-4 py-3 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-heading font-bold text-primary tracking-wide">{family.name} <span className="text-primary/70">[{family.tag}]</span></h2>
              {family.my_role && (
                <p className="text-xs text-mutedForeground font-heading">Your role: <span className="text-primary font-bold uppercase tracking-wider">{ROLE_LABELS[family.my_role] || family.my_role}</span></p>
              )}
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-xs text-mutedForeground font-heading uppercase tracking-wider">Treasury</p>
                <p className="text-lg font-heading font-bold text-primary">{formatMoney(family.treasury)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-mutedForeground font-heading uppercase tracking-wider">Members</p>
                <p className="text-lg font-heading font-bold text-foreground">{family.member_count}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rackets */}
      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
              <TrendingUp size={16} /> Rackets
            </h3>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-4">
          {rackets.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {rackets.map((r) => (
                <div key={r.id} className={`${styles.surfaceMuted} border border-primary/20 rounded-sm p-3`}>
                  <p className="font-heading font-bold text-foreground text-sm">{r.name}</p>
                  <p className="text-xs text-primary font-heading">Level {r.level}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-mutedForeground font-heading italic">No rackets yet.</p>
          )}
        </div>
      </div>

      {/* Members */}
      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
              <Users size={16} /> Members
            </h3>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={`border-b border-primary/20 ${styles.surfaceMuted}`}>
                  <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Member</th>
                  <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Role</th>
                  <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Rank</th>
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr><td colSpan={3} className="py-4 text-center text-mutedForeground font-heading italic">No members.</td></tr>
                ) : (
                  members.map((m) => (
                    <tr key={m.user_id} className="border-b border-primary/10 last:border-0 hover:bg-zinc-800/30 transition-smooth">
                      <td className="py-2 px-2">
                        <Link to={`/profile/${encodeURIComponent(m.username)}`} className="font-heading font-medium text-foreground hover:text-primary">
                          {m.username}
                        </Link>
                      </td>
                      <td className="py-2 px-2">
                        <span className={m.role === 'boss' ? 'text-primary font-heading font-bold' : 'text-mutedForeground font-heading'}>
                          {ROLE_LABELS[m.role] || m.role}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-mutedForeground font-heading">{m.rank_name}</td>
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
