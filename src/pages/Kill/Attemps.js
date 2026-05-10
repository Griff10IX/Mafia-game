import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skull, Crosshair, ArrowUpRight, ArrowDownLeft, Clock, Shield, DollarSign, History, List, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { copyTextToClipboard } from '../../utils/copyToClipboard';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import { formatGameDateTime as formatDateTime } from '../../utils/gameDateTime';

const ATTEMPTS_CACHE_KEY = 'kill_attempts_cache_v1';
const ATTEMPTS_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const WHOAMI_CACHE_KEY = 'kill_attempts_whoami_v1';
const WHOAMI_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

function readSessionCache(key, maxAgeMs) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - Number(parsed.ts || 0) > maxAgeMs) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

function writeSessionCache(key, data) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* sessionStorage may be full or unavailable; ignore */
  }
}

const ATTEMPTS_STYLES = `
  @keyframes atmp-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .atmp-fade-in { animation: atmp-fade-in 0.4s ease-out both; }
  @keyframes atmp-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .atmp-scale-in { animation: atmp-scale-in 0.35s ease-out both; }
  @keyframes atmp-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .atmp-glow { animation: atmp-glow 4s ease-in-out infinite; }
  .atmp-card { transition: all 0.3s ease; }
  .atmp-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .atmp-row { transition: all 0.2s ease; }
  .atmp-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .atmp-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function money(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString()}`;
}

function buildAttemptCopySummary(attempt) {
  const outgoingRow = attempt.direction === 'outgoing';
  const killed = attempt.outcome === 'killed';
  const incomingKilled = !outgoingRow && killed;
  const otherUser = (outgoingRow ? attempt.target_username : attempt.attacker_username) ?? '?';
  const statusLabel = incomingKilled
    ? `Killed by ${attempt.attacker_username ?? '?'}`
    : killed
      ? 'Killed'
      : 'Failed';
  const bu = Number(attempt.bullets_used || 0).toLocaleString();
  const parts = [
    outgoingRow ? `Outgoing vs ${otherUser}` : `Incoming from ${otherUser}`,
    statusLabel,
    `${bu} bullets`,
  ];
  if (!killed && attempt.bullets_required) {
    parts.push(`required ${Number(attempt.bullets_required).toLocaleString()}`);
  }
  if (attempt.rewards?.money != null) parts.push(`reward ${money(attempt.rewards.money)}`);
  if (attempt.is_bodyguard_kill && attempt.bodyguard_owner_username) {
    parts.push(`bodyguard for ${attempt.bodyguard_owner_username}`);
  }
  if (attempt.death_message) parts.push(`"${String(attempt.death_message).slice(0, 200)}"`);
  if (attempt.created_at) parts.push(formatDateTime(attempt.created_at));
  return parts.join(' · ');
}

function buildTimelineEventCopySummary(ev) {
  const when = ev.occurred_at ? formatDateTime(ev.occurred_at) : '';
  const parts = [
    when,
    ev.event_type ? String(ev.event_type).replace(/_/g, ' ') : '',
    ev.direction,
    ev.other_username && ev.other_username !== '—' ? ev.other_username : '',
    ev.summary ? String(ev.summary).slice(0, 500) : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

const AttemptRow = ({ attempt }) => {
  const outgoingRow = attempt.direction === 'outgoing';
  const killed = attempt.outcome === 'killed';
  const incomingKilled = !outgoingRow && killed;
  const DirIcon = outgoingRow ? ArrowUpRight : ArrowDownLeft;
  const otherUser = (outgoingRow ? attempt.target_username : attempt.attacker_username) ?? '?';
  const rewardMoney = attempt.rewards?.money;
  const isBodyguardKill = attempt.is_bodyguard_kill;
  const bgOwner = attempt.bodyguard_owner_username;

  const statusLabel = incomingKilled
    ? `Killed by ${attempt.attacker_username ?? '?'}`
    : killed
      ? 'Killed'
      : 'Failed';

  const onCopyAttempt = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyTextToClipboard(buildAttemptCopySummary(attempt));
    if (ok) toast.success('Copied to clipboard');
    else toast.error('Could not copy');
  };

  return (
    <div className="atmp-row px-2 py-1.5 border-b border-zinc-700/30">
      <div className="flex items-start md:items-center justify-between gap-2">
        {/* Left side - Main info */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className={`p-0.5 rounded ${outgoingRow ? 'bg-primary/20' : 'bg-secondary'}`}>
              <DirIcon size={10} className={outgoingRow ? 'text-primary' : 'text-mutedForeground'} />
            </div>
            
            <Link
              to={`/profile/${encodeURIComponent(otherUser ?? '')}`}
              className="font-heading font-bold text-foreground hover:text-primary transition-colors text-[11px] truncate"
            >
              {otherUser}
            </Link>
            
            <span className={`shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-heading font-bold uppercase ${
              killed
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'bg-secondary text-mutedForeground border border-border'
            }`}>
              {killed ? <Skull size={9} /> : <Crosshair size={9} />}
              {statusLabel}
            </span>
            
            {isBodyguardKill && (
              <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-heading font-bold uppercase bg-secondary text-mutedForeground border border-border">
                <Shield size={9} />
                Bodyguard
              </span>
            )}
          </div>

          {isBodyguardKill && bgOwner && (
            <div className="text-[9px] text-mutedForeground font-heading flex items-center gap-1 pl-5">
              <Shield size={9} className="text-primary" />
              <span>Bodyguard for</span>
              <Link 
                to={`/profile/${encodeURIComponent(bgOwner)}`} 
                className="text-primary hover:text-primary/80 font-bold transition-colors"
              >
                {bgOwner}
              </Link>
            </div>
          )}

          {attempt.death_message && (
            <div className="text-[9px] text-mutedForeground font-heading italic pl-5">
              &quot;{attempt.death_message}&quot;
            </div>
          )}

          <div className="flex items-center gap-3 text-[9px] pl-5">
            {rewardMoney != null && (
              <div className="flex items-center gap-1 text-emerald-400 font-heading font-bold">
                <DollarSign size={9} />
                {money(rewardMoney)}
              </div>
            )}
            <div className="flex items-center gap-1 text-mutedForeground font-heading">
              <Clock size={9} />
              {formatDateTime(attempt.created_at)}
            </div>
          </div>
        </div>

        {/* Right side - copy + bullets */}
        <div className="shrink-0 flex items-start gap-1">
          <button
            type="button"
            onClick={onCopyAttempt}
            className="p-1 rounded-md border border-transparent text-mutedForeground hover:text-primary hover:bg-primary/15 hover:border-primary/25 transition-colors touch-manipulation mt-0.5"
            title="Copy attempt details"
            aria-label="Copy attempt details"
          >
            <Copy size={14} />
          </button>
          <div className="text-right">
            <div className="text-sm font-heading font-bold text-primary tabular-nums">
              {Number(attempt.bullets_used || 0).toLocaleString()}
            </div>
            <div className="text-[9px] text-mutedForeground font-heading">
              bullets
            </div>
            {!killed && attempt.bullets_required && (
              <div className="text-[9px] text-mutedForeground font-heading mt-0.5">
                / {Number(attempt.bullets_required || 0).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function timelineBadgeClass(et) {
  if (et === 'killed' || et === 'attack_kill') return 'bg-primary/20 text-primary border-primary/30';
  if (et === 'failed') return 'bg-secondary text-mutedForeground border-border';
  if (et === 'bodyguard') return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
  if (et === 'error') return 'bg-destructive/15 text-destructive border-destructive/30';
  if (et === 'attack_travel') return 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25';
  if (et === 'active_found' || et === 'active_search') return 'bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/25';
  return 'bg-secondary text-mutedForeground border-border';
}

const TimelineEventRow = ({ ev, expanded, onToggle, canViewPayload }) => {
  const et = ev.event_type || '';
  const badgeClass = timelineBadgeClass(et);
  const onCopyTimeline = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    let text = buildTimelineEventCopySummary(ev);
    if (canViewPayload && ev.payload && expanded) {
      try {
        text += `\n\n${JSON.stringify(ev.payload, null, 2)}`;
      } catch {
        /* ignore */
      }
    }
    const ok = await copyTextToClipboard(text);
    if (ok) toast.success(expanded && canViewPayload && ev.payload ? 'Copied (including payload)' : 'Copied to clipboard');
    else toast.error('Could not copy');
  };
  return (
    <div className="atmp-row border-b border-zinc-700/30">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggle(ev.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(ev.id);
          }
        }}
        className="w-full px-2 py-1.5 flex items-start gap-2 text-left cursor-pointer hover:bg-primary/[0.04]"
      >
        <span className="shrink-0 mt-0.5 text-mutedForeground">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] text-mutedForeground font-heading tabular-nums shrink-0">{formatDateTime(ev.occurred_at)}</span>
            <span className={`shrink-0 inline-flex px-1.5 py-0.5 rounded text-[8px] font-heading font-bold uppercase border ${badgeClass}`}>
              {String(et).replace(/_/g, ' ')}
            </span>
            <span className="text-[8px] text-zinc-500 font-heading uppercase">{ev.direction}</span>
            {ev.other_username && ev.other_username !== '—' && (
              <Link
                to={`/profile/${encodeURIComponent(ev.other_username)}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] font-heading font-bold text-foreground hover:text-primary truncate max-w-[160px]"
              >
                {ev.other_username}
              </Link>
            )}
          </div>
          <p className="text-[10px] text-mutedForeground font-heading leading-snug line-clamp-3">{ev.summary}</p>
        </div>
        <button
          type="button"
          onClick={onCopyTimeline}
          className="shrink-0 p-1 rounded-md border border-transparent text-mutedForeground hover:text-primary hover:bg-primary/15 hover:border-primary/25 transition-colors touch-manipulation mt-0.5"
          title={expanded && canViewPayload && ev.payload ? 'Copy summary + payload' : 'Copy event details'}
          aria-label="Copy timeline event"
        >
          <Copy size={14} />
        </button>
      </div>
      {expanded && canViewPayload && ev.payload && (
        <pre className="mx-2 mb-2 p-2 rounded bg-black/30 border border-border/50 text-[9px] text-zinc-400 overflow-x-auto font-mono whitespace-pre-wrap break-words">
          {JSON.stringify(ev.payload, null, 2)}
        </pre>
      )}
    </div>
  );
};

const AttemptsCard = ({ title, attempts, icon: Icon, emptyMessage, delay = 0 }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 atmp-card atmp-fade-in mobile-panel`} style={{ animationDelay: `${delay}s` }}>
    <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none atmp-glow" />
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
        <Icon size={12} />
        {title}
      </h2>
      <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-heading font-bold border border-primary/30">
        {attempts.length}
      </span>
    </div>

    <div className="max-h-[480px] overflow-y-auto">
      {attempts.length === 0 ? (
        <div className="py-8 text-center">
          <Icon size={28} className="mx-auto text-primary/30 mb-2" />
          <p className="text-[10px] text-mutedForeground font-heading">
            {emptyMessage}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-700/30">
          {attempts.slice(0, 50).map((attempt, idx) => (
            <AttemptRow key={attempt.id ?? `attempt-${idx}`} attempt={attempt} />
          ))}
        </div>
      )}
    </div>
    <div className="atmp-art-line text-primary mx-2.5" />
  </div>
);

// Main component
export default function Attempts() {
  const cachedAttempts = readSessionCache(ATTEMPTS_CACHE_KEY, ATTEMPTS_CACHE_MAX_AGE_MS);
  const cachedWhoami = readSessionCache(WHOAMI_CACHE_KEY, WHOAMI_CACHE_MAX_AGE_MS);

  const [tab, setTab] = useState('summary');
  const [summaryLoading, setSummaryLoading] = useState(false);
  /** True on first paint so default 'Everything' tab shows spinner until GET /attack/timeline returns. */
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [attempts, setAttempts] = useState(Array.isArray(cachedAttempts) ? cachedAttempts : []);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [timelineErr, setTimelineErr] = useState(null);
  const [timelineExpanded, setTimelineExpanded] = useState({});
  const [canViewPayload, setCanViewPayload] = useState(Boolean(cachedWhoami?.canViewPayload));
  const [canViewEverything, setCanViewEverything] = useState(Boolean(cachedWhoami?.canViewEverything));
  const [timelineSubjectUsername, setTimelineSubjectUsername] = useState(null);
  const [adminTargetInput, setAdminTargetInput] = useState('');
  const [adminTargetApplied, setAdminTargetApplied] = useState('');

  const fetchAttempts = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await api.get('/attack/attempts');
      const list = res.data.attempts || [];
      setAttempts(list);
      writeSessionCache(ATTEMPTS_CACHE_KEY, list);
    } catch (e) {
      toast.error('Failed to load attempts');
      console.error('Error fetching attempts:', e);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const fetchTimeline = useCallback(async () => {
    setTimelineLoading(true);
    setTimelineErr(null);
    try {
      const target = (adminTargetApplied || '').trim();
      const res = await api.get('/attack/timeline', {
        params: target ? { target_username: target } : undefined,
      });
      setTimelineEvents(res.data?.events || []);
      setTimelineSubjectUsername(res.data?.subject_username || null);
    } catch (e) {
      setTimelineErr(getApiErrorMessage(e));
      setTimelineEvents([]);
      setTimelineSubjectUsername(null);
    } finally {
      setTimelineLoading(false);
    }
  }, [adminTargetApplied]);

  const fetchViewerRole = useCallback(async () => {
    try {
      const res = await api.get('/admin/whoami');
      const d = res?.data || {};
      const staffCanViewEverything = Boolean(d.is_admin || d.is_moderator || d.has_admin_email);
      setCanViewEverything(staffCanViewEverything);
      setCanViewPayload(staffCanViewEverything);
      writeSessionCache(WHOAMI_CACHE_KEY, {
        canViewEverything: staffCanViewEverything,
        canViewPayload: staffCanViewEverything,
      });
    } catch {
      setCanViewEverything(false);
      setCanViewPayload(false);
    }
  }, []);

  useEffect(() => {
    void fetchViewerRole();
  }, [fetchViewerRole]);

  useEffect(() => {
    if (!canViewEverything && tab === 'everything') {
      setTab('summary');
    }
  }, [canViewEverything, tab]);

  useEffect(() => {
    if (tab === 'summary') {
      void fetchAttempts();
    } else {
      void fetchTimeline();
    }
  }, [tab, fetchAttempts, fetchTimeline]);

  const outgoing = useMemo(() => (attempts || []).filter((a) => a.direction === 'outgoing'), [attempts]);
  const incoming = useMemo(() => (attempts || []).filter((a) => a.direction === 'incoming'), [attempts]);

  const toggleTimelineRow = (id) => {
    setTimelineExpanded((m) => ({ ...m, [id]: !m[id] }));
  };

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="attempts-page">
      <style>{ATTEMPTS_STYLES}</style>

      <div className="relative atmp-fade-in flex flex-col gap-2">
        <p className="text-[9px] text-zinc-500 font-heading italic">
          Full combat history or a short summary of kills and damage only.
        </p>
        {canViewPayload && tab === 'everything' && (
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-md border border-primary/20 bg-primary/5">
            <input
              type="text"
              value={adminTargetInput}
              onChange={(e) => setAdminTargetInput(e.target.value)}
              placeholder="Admin: search username for timeline"
              className="min-w-[180px] flex-1 px-2 py-1 rounded border border-zinc-700/60 bg-black/30 text-[10px] text-foreground font-heading"
            />
            <button
              type="button"
              onClick={() => setAdminTargetApplied((adminTargetInput || '').trim())}
              className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border border-primary/40 text-primary hover:bg-primary/15"
            >
              Load User
            </button>
            <button
              type="button"
              onClick={() => {
                setAdminTargetInput('');
                setAdminTargetApplied('');
              }}
              className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border border-zinc-700/60 text-mutedForeground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-1 p-0.5 rounded-md border border-primary/20 bg-primary/5">
          {canViewEverything && (
            <button
              type="button"
              onClick={() => setTab('everything')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-heading font-bold uppercase tracking-wider transition-colors ${
                tab === 'everything' ? 'bg-primary/25 text-primary border border-primary/40' : 'text-mutedForeground hover:text-foreground border border-transparent'
              }`}
            >
              <History size={11} />
              Everything
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab('summary')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-heading font-bold uppercase tracking-wider transition-colors ${
              tab === 'summary' ? 'bg-primary/25 text-primary border border-primary/40' : 'text-mutedForeground hover:text-foreground border border-transparent'
            }`}
          >
            <List size={11} />
            Summary
          </button>
        </div>
      </div>

      {canViewEverything && tab === 'everything' && (
        <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 atmp-card atmp-fade-in mobile-panel`}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
              <History size={12} />
              Combat timeline
            </h2>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-heading font-bold border border-primary/30">
                {timelineEvents.length}
              </span>
              <button
                type="button"
                onClick={() => void fetchTimeline()}
                disabled={timelineLoading}
                className="text-[9px] font-heading font-bold text-mutedForeground hover:text-primary disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>
          <p className="px-2.5 pt-2 text-[9px] text-mutedForeground font-heading">
            Bodyguard blocks, errors, travel, active searches, and kill logs — merged newest first.
          </p>
          {canViewPayload && timelineSubjectUsername && (
            <p className="px-2.5 text-[9px] text-primary font-heading">
              Viewing timeline for: {timelineSubjectUsername}
            </p>
          )}
          {timelineErr && <p className="px-2.5 text-[10px] text-destructive font-heading">{timelineErr}</p>}
          {timelineLoading && timelineEvents.length === 0 && !timelineErr ? (
            <div className="py-8" />
          ) : timelineErr && timelineEvents.length === 0 ? null : timelineEvents.length === 0 ? (
            <div className="py-8 text-center">
              <History size={28} className="mx-auto text-primary/30 mb-2" />
              <p className="text-[10px] text-mutedForeground font-heading">No combat events yet.</p>
            </div>
          ) : (
            <div className="max-h-[min(70vh,520px)] overflow-y-auto mt-2">
              {timelineEvents.map((ev) => (
                <TimelineEventRow
                  key={ev.id}
                  ev={ev}
                  expanded={!!timelineExpanded[ev.id]}
                  onToggle={toggleTimelineRow}
                  canViewPayload={canViewPayload}
                />
              ))}
            </div>
          )}
          <div className="atmp-art-line text-primary mx-2.5 mt-2" />
        </div>
      )}

      {tab === 'summary' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 md:gap-3">
          <AttemptsCard
            title="My Attempts"
            attempts={outgoing}
            icon={ArrowUpRight}
            emptyMessage="No attacks made yet"
            delay={0}
          />
          <AttemptsCard
            title="Against Me (health loss only)"
            attempts={incoming}
            icon={ArrowDownLeft}
            emptyMessage="No damaging attacks against you"
            delay={0.05}
          />
        </div>
      )}
    </div>
  );
}
