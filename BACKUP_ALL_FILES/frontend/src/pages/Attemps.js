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
      <div className="px-4 py-3 border-t border-border bg-background/30 hover:bg-background/50 transition-smooth">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <DirIcon size={14} className={outgoingRow ? 'text-primary' : 'text-mutedForeground'} />
              <Link
                to={`/profile/${encodeURIComponent(otherUser || '')}`}
                className="font-semibold text-foreground truncate hover:underline hover:text-primary transition-smooth"
              >
                {otherUser}
              </Link>
              <span
                className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-bold ${
                  a.outcome === 'killed' ? 'bg-primary text-primaryForeground' : 'bg-secondary text-mutedForeground'
                }`}
              >
                <ResultIcon size={12} />
                {outgoingRow ? result : a.outcome === 'failed' ? 'Failed on you' : result}
              </span>
            </div>

            {a.death_message ? (
              <div className="text-xs text-mutedForeground truncate mt-1">"{a.death_message}"</div>
            ) : a.message ? (
              <div className="text-xs text-mutedForeground truncate mt-1">{a.message}</div>
            ) : null}

            {rewardMoney != null ? (
              <div className="text-xs text-mutedForeground mt-1">Rewards: {money(rewardMoney)}</div>
            ) : null}
          </div>

          <div className="shrink-0 text-right">
            <div className="text-sm font-mono text-mutedForeground">{bulletsText}</div>
            <div className="text-[11px] text-mutedForeground mt-1 inline-flex items-center gap-1 justify-end">
              <Clock size={12} />
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
    <div className="space-y-6" data-testid="attempts-page">
      <div className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Attack</div>
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mt-2">Attempts</h1>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <div className="px-4 py-3 bg-secondary/40 flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-mutedForeground">My attempts</div>
                <div className="text-xs text-mutedForeground">({outgoing.length})</div>
              </div>
              {outgoing.length === 0 ? (
                <div className="px-4 py-10 text-center text-mutedForeground text-sm">No attempts to show</div>
              ) : (
                outgoing.slice(0, 50).map((a) => <AttemptRow key={a.id} a={a} />)
              )}
            </div>

            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <div className="px-4 py-3 bg-secondary/40 flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-mutedForeground">Attempts against me</div>
                <div className="text-xs text-mutedForeground">({incoming.length})</div>
              </div>
              {incoming.length === 0 ? (
                <div className="px-4 py-10 text-center text-mutedForeground text-sm">No attempts to show</div>
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

