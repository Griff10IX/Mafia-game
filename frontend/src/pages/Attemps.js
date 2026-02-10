import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skull, Crosshair, ArrowUpRight, ArrowDownLeft, Clock } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function money(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString()}`;
}

export default function Attemps() {
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState([]);

  const fetchAttempts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/attack/attempts');
      setAttempts(res.data.attempts || []);
    } catch (e) {
      toast.error('Failed to load attempts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttempts();
  }, []);

  const outgoing = useMemo(() => (attempts || []).filter((a) => a.direction === 'outgoing'), [attempts]);
  const incoming = useMemo(() => (attempts || []).filter((a) => a.direction === 'incoming'), [attempts]);

  const AttemptRow = ({ a }) => {
    const outgoingRow = a.direction === 'outgoing';
    const result = a.outcome === 'killed' ? 'Killed' : 'Failed';
    const ResultIcon = a.outcome === 'killed' ? Skull : Crosshair;
    const DirIcon = outgoingRow ? ArrowUpRight : ArrowDownLeft;
    const otherUser = outgoingRow ? a.target_username : a.attacker_username;
    const rewardMoney = a.rewards?.money;
    const bulletsText =
      a.outcome === 'killed'
        ? `${Number(a.bullets_used || 0).toLocaleString()}`
        : `${Number(a.bullets_used || 0).toLocaleString()} / ${Number(a.bullets_required || 0).toLocaleString()}`;

    return (
      <div className="px-4 py-2.5 border-b border-primary/10 bg-transparent hover:bg-zinc-800/30 transition-smooth">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <DirIcon size={12} className={outgoingRow ? 'text-primary' : 'text-mutedForeground'} />
              <Link
                to={`/profile/${encodeURIComponent(otherUser || '')}`}
                className="font-heading font-bold text-foreground truncate hover:text-primary transition-smooth text-sm"
              >
                {otherUser}
              </Link>
              <span
                className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-heading font-bold ${
                  a.outcome === 'killed'
                    ? 'bg-gradient-to-r from-primary/20 to-transparent text-primary border border-primary/30'
                    : 'bg-zinc-800/80 text-mutedForeground border border-primary/10'
                }`}
              >
                <ResultIcon size={10} />
                {outgoingRow ? result : a.outcome === 'failed' ? 'Failed on you' : result}
              </span>
            </div>

            {a.death_message ? (
              <div className="text-xs text-mutedForeground truncate mt-1 font-heading italic">&quot;{a.death_message}&quot;</div>
            ) : a.message ? (
              <div className="text-xs text-mutedForeground truncate mt-1 font-heading">{a.message}</div>
            ) : null}

            {rewardMoney != null ? (
              <div className="text-xs text-primary mt-1 font-heading">Rewards: {money(rewardMoney)}</div>
            ) : null}
          </div>

          <div className="shrink-0 text-right">
            <div className="text-xs font-heading text-primary">{bulletsText}</div>
            <div className="text-[10px] text-mutedForeground mt-1 inline-flex items-center gap-1 justify-end font-heading">
              <Clock size={10} />
              {formatDateTime(a.created_at)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="attempts-page">
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-3">
            <Crosshair size={24} className="text-primary/80" />
            Attempts
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-sm text-mutedForeground font-heading tracking-wide">Attack history — outgoing and incoming</p>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5">
              <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-px bg-primary/50" />
                  <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">My Attempts</span>
                  <div className="w-6 h-px bg-primary/50" />
                </div>
                <span className="text-xs text-primary font-heading font-bold">({outgoing.length})</span>
              </div>
              {outgoing.length === 0 ? (
                <div className="px-4 py-10 text-center text-mutedForeground text-xs font-heading italic">No attempts to show</div>
              ) : (
                outgoing.slice(0, 50).map((a) => <AttemptRow key={a.id} a={a} />)
              )}
            </div>

            <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5">
              <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-px bg-primary/50" />
                  <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Against Me</span>
                  <div className="w-6 h-px bg-primary/50" />
                </div>
                <span className="text-xs text-primary font-heading font-bold">({incoming.length})</span>
              </div>
              {incoming.length === 0 ? (
                <div className="px-4 py-10 text-center text-mutedForeground text-xs font-heading italic">No attempts to show</div>
              ) : (
                incoming.slice(0, 50).map((a) => <AttemptRow key={a.id} a={a} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

