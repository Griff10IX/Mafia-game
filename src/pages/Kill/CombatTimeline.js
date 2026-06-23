import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { getApiErrorMessage } from '../../utils/api';
import styles from '../../styles/noir.module.css';
import { formatGameDateTimeShort as formatDateTime } from '../../utils/gameDateTime';

export default function CombatTimeline() {
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState(null);
  const [expanded, setExpanded] = useState({});

  const loadCombatTimeline = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.get('/attack/timeline');
      setEvents(res.data?.events || []);
    } catch (e) {
      setErr(getApiErrorMessage(e));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCombatTimeline();
  }, [loadCombatTimeline]);

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="combat-timeline-page">
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[11px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1.5">
              <History size={14} />
              Combat timeline
            </h1>
            <p className="text-[9px] text-mutedForeground font-heading leading-relaxed mt-1">
              Bodyguard blocks, failed attacks, validation errors, travel, kill log entries, and active searches.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/kill/attack"
              className="text-[9px] font-heading font-bold text-mutedForeground hover:text-primary underline-offset-2 hover:underline"
            >
              Back to attack
            </Link>
            <Link
              to="/kill/attempts"
              className="text-[9px] font-heading font-bold text-primary underline-offset-2 hover:underline"
            >
              Full history
            </Link>
            <button
              type="button"
              onClick={() => void loadCombatTimeline()}
              disabled={loading}
              className="text-[9px] font-heading font-bold text-mutedForeground hover:text-primary disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="p-2.5 space-y-2">
          {err && (
            <p className="text-[10px] text-destructive font-heading">{err}</p>
          )}
          {loading && events.length === 0 && !err ? (
            <div className="flex items-center gap-2 py-10 justify-center text-mutedForeground">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-[9px] font-heading uppercase tracking-wider">Loading timeline...</span>
            </div>
          ) : events.length === 0 ? (
            <p className="text-[10px] text-mutedForeground font-heading py-8 text-center">No combat events yet.</p>
          ) : (
            <div className="rounded border border-border/60 divide-y divide-zinc-700/30">
              {events.map((ev) => {
                const et = ev.event_type || '';
                const badgeClass =
                  et === 'killed' || et === 'attack_kill'
                    ? 'bg-primary/20 text-primary border-primary/30'
                    : et === 'failed'
                      ? 'bg-secondary text-mutedForeground border-border'
                      : et === 'bodyguard'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                        : et === 'error'
                          ? 'bg-destructive/15 text-destructive border-destructive/30'
                          : et === 'attack_travel'
                            ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25'
                            : et === 'active_found' || et === 'active_search'
                              ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/25'
                              : 'bg-secondary text-mutedForeground border-border';
                const isExpanded = !!expanded[ev.id];
                return (
                  <div key={ev.id} className="atk-row">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpanded((m) => ({ ...m, [ev.id]: !m[ev.id] }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpanded((m) => ({ ...m, [ev.id]: !m[ev.id] }));
                        }
                      }}
                      className="w-full px-2 py-1.5 flex items-start gap-2 text-left cursor-pointer hover:bg-primary/[0.04]"
                    >
                      <span className="shrink-0 mt-0.5 text-mutedForeground">{isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[9px] text-mutedForeground font-heading tabular-nums shrink-0">{formatDateTime(ev.occurred_at)}</span>
                          <span className={`shrink-0 inline-flex px-1.5 py-0.5 rounded text-[8px] font-heading font-bold uppercase border ${badgeClass}`}>
                            {String(et).replace(/_/g, ' ')}
                          </span>
                          <span className="text-[8px] text-zinc-500 font-heading uppercase">{ev.direction}</span>
                          {ev.other_username && ev.other_username !== '-' && ev.other_username !== '—' && (
                            <Link
                              to={`/profile/${encodeURIComponent(ev.other_username)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] font-heading font-bold text-foreground hover:text-primary truncate max-w-[140px]"
                            >
                              {ev.other_username}
                            </Link>
                          )}
                        </div>
                        <p className="text-[10px] text-mutedForeground font-heading leading-snug pl-0 line-clamp-2">{ev.summary}</p>
                      </div>
                    </div>
                    {isExpanded && ev.payload && (
                      <pre className="mx-2 mb-2 p-2 rounded bg-black/30 border border-border/50 text-[9px] text-zinc-400 overflow-x-auto font-mono whitespace-pre-wrap break-words">
                        {JSON.stringify(ev.payload, null, 2)}
                      </pre>
                    )}
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
