import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Building2, Users, DollarSign, TrendingUp, ArrowLeft } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

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
      <div className="space-y-4">
        <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-2 text-mutedForeground hover:text-foreground text-sm">
          <ArrowLeft size={16} /> Back to families
        </button>
        <p className="text-mutedForeground">Family not found.</p>
      </div>
    );
  }

  const members = family.members || [];

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => navigate('/families')} className="flex items-center gap-2 text-mutedForeground hover:text-foreground text-sm">
        <ArrowLeft size={16} /> Back to families
      </button>

      <div className="bg-card border border-primary rounded-sm p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Building2 className="text-primary" size={32} />
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">{family.name} [{family.tag}]</h1>
              {family.my_role && (
                <p className="text-sm text-mutedForeground">Your role: <span className="text-primary font-semibold">{ROLE_LABELS[family.my_role] || family.my_role}</span></p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs text-mutedForeground">Treasury</p>
              <p className="text-lg font-mono font-bold text-primary">{formatMoney(family.treasury)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-mutedForeground">Members</p>
              <p className="text-lg font-mono font-bold text-foreground">{family.member_count}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-sm p-4">
        <h3 className="text-sm font-heading font-semibold text-foreground mb-3 flex items-center gap-2">
          <TrendingUp size={18} /> Rackets
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(family.rackets || []).map((r) => (
            <div key={r.id} className="bg-background/50 border border-border rounded-sm p-3">
              <p className="font-medium text-foreground text-sm">{r.name}</p>
              <p className="text-xs text-mutedForeground">Level {r.level}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-sm p-4">
        <h3 className="text-sm font-heading font-semibold text-foreground mb-3 flex items-center gap-2">
          <Users size={18} /> Members
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left py-2 px-2 font-semibold text-foreground">Member</th>
                <th className="text-left py-2 px-2 font-semibold text-foreground">Role</th>
                <th className="text-left py-2 px-2 font-semibold text-foreground">Rank</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr><td colSpan={3} className="py-4 text-center text-mutedForeground">No members.</td></tr>
              ) : (
                members.map((m) => (
                  <tr key={m.user_id} className="border-b border-border last:border-0">
                    <td className="py-2 px-2">
                      <Link to={`/profile/${encodeURIComponent(m.username)}`} className="font-medium text-foreground hover:text-primary hover:underline">
                        {m.username}
                      </Link>
                    </td>
                    <td className="py-2 px-2">
                      <span className={m.role === 'boss' ? 'text-primary font-semibold' : 'text-mutedForeground'}>
                        {ROLE_LABELS[m.role] || m.role}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-mutedForeground">{m.rank_name}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
