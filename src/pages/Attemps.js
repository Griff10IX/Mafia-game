import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skull, Crosshair, ArrowUpRight, ArrowDownLeft, Clock, Shield, DollarSign } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = () => (
  <div>
    <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2 flex items-center gap-3">
      <Crosshair className="w-8 h-8 md:w-10 md:h-10" />
      Attempts
    </h1>
    <p className="text-sm text-mutedForeground">
      Attack history · Successful kills & failed attempts
    </p>
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
    <div className="px-4 py-3 border-b border-border hover:bg-secondary/30 transition-colors">
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

const AttemptsCard = ({ title, attempts, icon: Icon, emptyMessage }) => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
      <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
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
        <div className="divide-y divide-border">
          {attempts.slice(0, 50).map((attempt) => (
            <AttemptRow key={attempt.id} attempt={attempt} />
          ))}
        </div>
      )}
    </div>
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
      console.error('Error fetching attempts:', error);
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
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="attempts-page">
      <PageHeader />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <AttemptsCard
          title="My Attempts"
          attempts={outgoing}
          icon={ArrowUpRight}
          emptyMessage="No attacks made yet"
        />
        
        <AttemptsCard
          title="Against Me"
          attempts={incoming}
          icon={ArrowDownLeft}
          emptyMessage="No attacks against you"
        />
      </div>
    </div>
  );
}
