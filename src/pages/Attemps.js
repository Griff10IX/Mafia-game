import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skull, Crosshair, ArrowUpRight, ArrowDownLeft, Clock, Shield, DollarSign } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const ATTEMPTS_STYLES = `
  @keyframes atmp-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .atmp-fade-in { animation: atmp-fade-in 0.4s ease-out both; }
  @keyframes atmp-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .atmp-scale-in { animation: atmp-scale-in 0.35s ease-out both; }
  @keyframes atmp-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .atmp-glow { animation: atmp-glow 4s ease-in-out infinite; }
  .atmp-corner::before, .atmp-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .atmp-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .atmp-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .atmp-card { transition: all 0.3s ease; }
  .atmp-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .atmp-row { transition: all 0.2s ease; }
  .atmp-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .atmp-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

function money(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString()}`;
}

// Subcomponents
const LoadingSpinner = () => (
  <div className={`space-y-4 ${styles.pageContent}`}>
    <style>{ATTEMPTS_STYLES}</style>
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <Crosshair size={28} className="text-primary/40 animate-pulse" />
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading attempts...</span>
    </div>
  </div>
);

const AttemptRow = ({ attempt }) => {
  const outgoingRow = attempt.direction === 'outgoing';
  const killed = attempt.outcome === 'killed';
  const DirIcon = outgoingRow ? ArrowUpRight : ArrowDownLeft;
  const otherUser = outgoingRow ? attempt.target_username : attempt.attacker_username;
  const rewardMoney = attempt.rewards?.money;
  const isBodyguardKill = attempt.is_bodyguard_kill;
  const bgOwner = attempt.bodyguard_owner_username;

  return (
    <div className="atmp-row px-4 py-3 border-b border-zinc-700/30">
      <div className="flex items-start md:items-center justify-between gap-3">
        {/* Left side - Main info */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`p-1 rounded ${outgoingRow ? 'bg-primary/20' : 'bg-secondary'}`}>
              <DirIcon size={14} className={outgoingRow ? 'text-primary' : 'text-mutedForeground'} />
            </div>
            
            <Link
              to={`/profile/${encodeURIComponent(otherUser || '')}`}
              className="font-heading font-bold text-foreground hover:text-primary transition-colors text-sm truncate"
            >
              {otherUser}
            </Link>
            
            <span className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-heading font-bold uppercase ${
              killed
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'bg-secondary text-mutedForeground border border-border'
            }`}>
              {killed ? <Skull size={12} /> : <Crosshair size={12} />}
              {killed ? 'Killed' : 'Failed'}
            </span>
            
            {isBodyguardKill && (
              <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-heading font-bold uppercase bg-secondary text-mutedForeground border border-border">
                <Shield size={12} />
                Bodyguard
              </span>
            )}
          </div>

          {isBodyguardKill && bgOwner && (
            <div className="text-xs text-mutedForeground font-heading flex items-center gap-1.5 pl-7">
              <Shield size={12} className="text-primary" />
              <span>Protecting</span>
              <Link 
                to={`/profile/${encodeURIComponent(bgOwner)}`} 
                className="text-primary hover:text-primary/80 font-bold transition-colors"
              >
                {bgOwner}
              </Link>
            </div>
          )}

          {attempt.death_message && (
            <div className="text-xs text-mutedForeground font-heading italic pl-7">
              &quot;{attempt.death_message}&quot;
            </div>
          )}

          <div className="flex items-center gap-4 text-xs pl-7">
            {rewardMoney != null && (
              <div className="flex items-center gap-1.5 text-emerald-400 font-heading font-bold">
                <DollarSign size={12} />
                {money(rewardMoney)}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-mutedForeground font-heading">
              <Clock size={12} />
              {formatDateTime(attempt.created_at)}
            </div>
          </div>
        </div>

        {/* Right side - Bullets */}
        <div className="shrink-0 text-right">
          <div className="text-base font-heading font-bold text-primary tabular-nums">
            {Number(attempt.bullets_used || 0).toLocaleString()}
          </div>
          <div className="text-xs text-mutedForeground font-heading">
            bullets
          </div>
          {!killed && attempt.bullets_required && (
            <div className="text-xs text-mutedForeground font-heading mt-1">
              / {Number(attempt.bullets_required || 0).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const AttemptsCard = ({ title, attempts, icon: Icon, emptyMessage, delay = 0 }) => (
  <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 atmp-card atmp-corner atmp-fade-in`} style={{ animationDelay: `${delay}s` }}>
    <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl pointer-events-none atmp-glow" />
    <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-2">
        <Icon size={16} />
        {title}
      </h2>
      <span className="px-2 py-1 rounded-md bg-primary/20 text-primary text-xs font-heading font-bold border border-primary/30">
        {attempts.length}
      </span>
    </div>

    <div className="max-h-[600px] overflow-y-auto">
      {attempts.length === 0 ? (
        <div className="py-16 text-center">
          <Icon size={48} className="mx-auto text-primary/30 mb-3" />
          <p className="text-sm text-mutedForeground font-heading">
            {emptyMessage}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-700/30">
          {attempts.slice(0, 50).map((attempt) => (
            <AttemptRow key={attempt.id} attempt={attempt} />
          ))}
        </div>
      )}
    </div>
    <div className="atmp-art-line text-primary mx-4" />
  </div>
);

// Main component
export default function Attempts() {
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState([]);

  const fetchAttempts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/attack/attempts');
      setAttempts(res.data.attempts || []);
    } catch (e) {
      toast.error('Failed to load attempts');
      console.error('Error fetching attempts:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttempts();
  }, []);

  const outgoing = useMemo(() => (attempts || []).filter((a) => a.direction === 'outgoing'), [attempts]);
  const incoming = useMemo(() => (attempts || []).filter((a) => a.direction === 'incoming'), [attempts]);

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="attempts-page">
      <style>{ATTEMPTS_STYLES}</style>

      {/* Page header */}
      <div className="relative atmp-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">The Ledger</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">
          Attempts
        </h1>
        <p className="text-[10px] text-zinc-500 font-heading italic mt-1">Outgoing hits and incoming strikes — who lived, who didn&apos;t.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <AttemptsCard
          title="My Attempts"
          attempts={outgoing}
          icon={ArrowUpRight}
          emptyMessage="No attacks made yet"
          delay={0}
        />

        <AttemptsCard
          title="Against Me"
          attempts={incoming}
          icon={ArrowDownLeft}
          emptyMessage="No attacks against you"
          delay={0.05}
        />
      </div>
    </div>
  );
}
