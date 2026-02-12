import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skull, Crosshair, ArrowUpRight, ArrowDownLeft, Clock, Shield } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy}, ${hh}:${mi}`;
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
    const killed = a.outcome === 'killed';
    const DirIcon = outgoingRow ? ArrowUpRight : ArrowDownLeft;
    const otherUser = outgoingRow ? a.target_username : a.attacker_username;
    const rewardMoney = a.rewards?.money;
    const isBodyguardKill = a.is_bodyguard_kill;
    const bgOwner = a.bodyguard_owner_username;

    return (
      <div className={`px-3 py-2.5 border-b border-primary/10 transition-smooth ${killed ? 'bg-primary/5 hover:bg-primary/10' : 'bg-transparent hover:bg-zinc-800/30'}`}>
        <div className="flex items-center justify-between gap-2">
          {/* Left side */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <DirIcon size={12} className={outgoingRow ? 'text-primary shrink-0' : 'text-mutedForeground shrink-0'} />
              <Link
                to={`/profile/${encodeURIComponent(otherUser || '')}`}
                className="font-heading font-bold text-foreground truncate hover:text-primary transition-smooth text-xs sm:text-sm"
              >
                {otherUser}
              </Link>
              <span
                className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wider font-heading font-bold ${
                  killed
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : `${styles.surface} text-mutedForeground border border-primary/10`
                }`}
              >
                {killed ? <Skull size={9} /> : <Crosshair size={9} />}
                {killed ? 'Killed' : 'Failed'}
              </span>
              {isBodyguardKill && (
                <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wider font-heading font-bold bg-zinc-800 text-mutedForeground border border-primary/10">
                  <Shield size={9} /> BG
                </span>
              )}
            </div>

            {isBodyguardKill && bgOwner && (
              <div className="text-[10px] text-mutedForeground mt-1 font-heading flex items-center gap-1">
                <Shield size={9} className="text-primary/60" />
                Bodyguard of{' '}
                <Link to={`/profile/${encodeURIComponent(bgOwner)}`} className="text-primary hover:underline font-bold">
                  {bgOwner}
                </Link>
              </div>
            )}

            {a.death_message && (
              <div className="text-[10px] text-mutedForeground truncate mt-1 font-heading italic">&quot;{a.death_message}&quot;</div>
            )}

            <div className="flex items-center gap-3 mt-1">
              {rewardMoney != null && (
                <span className="text-[10px] font-heading text-primary font-bold">{money(rewardMoney)}</span>
              )}
              <span className="text-[10px] text-mutedForeground font-heading inline-flex items-center gap-1">
                <Clock size={9} />
                {formatDateTime(a.created_at)}
              </span>
            </div>
          </div>

          {/* Right side - bullets */}
          <div className="shrink-0 text-right">
            <div className="text-xs font-heading text-primary font-bold tabular-nums">
              {Number(a.bullets_used || 0).toLocaleString()}
            </div>
            {!killed && a.bullets_required && (
              <div className="text-[9px] text-mutedForeground font-heading">
                / {Number(a.bullets_required || 0).toLocaleString()}
              </div>
            )}
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
    <div className={`space-y-5 ${styles.pageContent}`} data-testid="attempts-page">
      <div>
        <div className="flex items-center gap-2 sm:gap-4 mb-2 sm:mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-xl sm:text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-2 sm:gap-3">
            <Crosshair size={20} className="text-primary/80 sm:w-6 sm:h-6" />
            Attempts
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-[11px] sm:text-xs text-mutedForeground font-heading tracking-wide uppercase">Attack history</p>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* My Attempts */}
            <div className={`${styles.panel} rounded-sm overflow-hidden`}>
              <div className="px-3 py-2 sm:px-4 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-4 sm:w-6 h-px bg-primary/50" />
                  <span className="text-[11px] sm:text-xs font-heading font-bold text-primary uppercase tracking-widest">My Attempts</span>
                  <div className="w-4 sm:w-6 h-px bg-primary/50" />
                </div>
                <span className="text-[11px] sm:text-xs text-primary font-heading font-bold">({outgoing.length})</span>
              </div>
              <div className="max-h-[70vh] overflow-y-auto">
                {outgoing.length === 0 ? (
                  <div className="px-4 py-10 text-center text-mutedForeground text-xs font-heading italic">No attempts yet</div>
                ) : (
                  outgoing.slice(0, 50).map((a) => <AttemptRow key={a.id} a={a} />)
                )}
              </div>
            </div>

            {/* Against Me */}
            <div className={`${styles.panel} rounded-sm overflow-hidden`}>
              <div className="px-3 py-2 sm:px-4 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-4 sm:w-6 h-px bg-primary/50" />
                  <span className="text-[11px] sm:text-xs font-heading font-bold text-primary uppercase tracking-widest">Against Me</span>
                  <div className="w-4 sm:w-6 h-px bg-primary/50" />
                </div>
                <span className="text-[11px] sm:text-xs text-primary font-heading font-bold">({incoming.length})</span>
              </div>
              <div className="max-h-[70vh] overflow-y-auto">
                {incoming.length === 0 ? (
                  <div className="px-4 py-10 text-center text-mutedForeground text-xs font-heading italic">No attacks against you</div>
                ) : (
                  incoming.slice(0, 50).map((a) => <AttemptRow key={a.id} a={a} />)
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
