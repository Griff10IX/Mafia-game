import { useState, useEffect, useCallback, useMemo } from 'react';
import { Trophy, Target, TrendingUp, Clock, Shield, Plus, ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';
import { getSportsBettingPrefetch, setSportsBettingPrefetch } from '../../utils/prefetchCache';

const SB_STYLES = `
  .sb-fade-in { animation: sb-fade-in 0.4s ease-out both; }
  @keyframes sb-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .sb-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Do not mix dateStyle/timeStyle with timeZoneName — ECMA-402 throws RangeError ("Invalid option : option").
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/** For `<input type="datetime-local" />` in the user's local timezone. */
function isoToDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse template kickoff; null if missing/invalid. */
function parseTemplateStart(t) {
  const iso = t?.start_time;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** True if template start matches admin date filter (local calendar). */
function templateMatchesDateFilter(t, preset, specificYmd) {
  const kickoff = parseTemplateStart(t);
  if (!kickoff) return false;
  if (specificYmd && /^\d{4}-\d{2}-\d{2}$/.test(specificYmd)) {
    const [yy, mm, dd] = specificYmd.split('-').map(Number);
    const picked = startOfLocalDay(new Date(yy, mm - 1, dd));
    return startOfLocalDay(kickoff).getTime() === picked.getTime();
  }
  if (!preset) return true;
  const now = new Date();
  const today0 = startOfLocalDay(now);
  const kick0 = startOfLocalDay(kickoff).getTime();
  if (preset === 'today') return kick0 === today0.getTime();
  if (preset === 'tomorrow') {
    const tom = new Date(today0);
    tom.setDate(tom.getDate() + 1);
    return kick0 === tom.getTime();
  }
  if (preset === '7d') {
    const end = new Date(today0);
    end.setDate(end.getDate() + 7);
    return kickoff >= today0 && kickoff < end;
  }
  return true;
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (d == null) return fallback;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length > 0) return d.map((x) => x.msg || String(x)).join(' ');
  return fallback;
}

/** Max total $ locked across all open sports bets (matches backend SPORTS_BET_MAX_TOTAL_OPEN_STAKE). */
const SPORTS_MAX_TOTAL_OPEN_STAKE = 25_000_000;

const STAKE_CHIPS = [
  { label: '10K', value: 10_000, color: '#e4e4e7', ring: '#a1a1aa' },
  { label: '100K', value: 100_000, color: '#dc2626', ring: '#991b1b' },
  { label: '1M', value: 1_000_000, color: '#16a34a', ring: '#166534' },
  { label: '5M', value: 5_000_000, color: '#18181b', ring: '#52525b' },
  { label: '10M', value: 10_000_000, color: '#7c3aed', ring: '#5b21b6' },
  { label: '25M', value: 25_000_000, color: '#6d28d9', ring: '#4c1d95' },
];

const CATEGORY_ICONS = { Football: '⚽', UFC: '🥊', Boxing: '🥊', 'Formula 1': '🏎️' };

const DEFAULT_MY_BETS = {
  open: [],
  closed: [],
  max_total_open_stake: SPORTS_MAX_TOTAL_OPEN_STAKE,
  open_stake_total: 0,
  open_stake_remaining: SPORTS_MAX_TOTAL_OPEN_STAKE,
};

const DEFAULT_PUBLIC_LIBRARY = {
  categories: [],
  templates: {},
  on_board_template_ids: [],
  requests_per_day_limit: 3,
  football_league_filter_options: null,
};

const DEFAULT_REQUEST_INFO = {
  used_today: 0,
  limit: 3,
  remaining: 3,
  recent_requests: [],
};

function StatusDot({ status }) {
  if (status === 'in_play') return <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] inline-block" title="In play" />;
  if (status === 'finished') return <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" title="Finished" />;
  return <span className="w-2 h-2 rounded-full bg-amber-400/70 inline-block" title="Upcoming" />;
}

/* ═══════════════════════════════════════════════════════
   Event Card — themed panel
   ═══════════════════════════════════════════════════════ */
function EventCard({ event, onPlaceBet, isAdmin, onSettle, onCancelEvent, onEditBetWindow, cancellingEventId }) {
  const options = event.options || [];
  const bettingOpen = event.betting_open !== false;
  const icon = CATEGORY_ICONS[event.category] || '🎲';
  const opensAt = event.betting_opens_at ? new Date(event.betting_opens_at).getTime() : null;
  const nowTs = Date.now();
  const beforeScheduledOpen = opensAt != null && !Number.isNaN(opensAt) && nowTs < opensAt;

  return (
    <div className="relative rounded-lg border border-primary/20 overflow-hidden transition-all hover:border-primary/40 group bg-zinc-900/50">
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      {/* Header */}
      <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
        <span className="text-sm">{icon}</span>
        <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">{event.category}</span>
        <div className="flex-1" />
        <StatusDot status={event.status} />
        <span className="text-[9px] font-heading text-zinc-500">{event.start_time_display || formatDateTime(event.start_time)}</span>
      </div>

      {/* Event name */}
      <div className="px-3 pt-2.5 pb-1.5">
        <p className="text-sm font-heading font-bold text-foreground leading-snug">{event.name}</p>
        {event.league_label ? (
          <p className="text-[9px] font-heading text-primary/80 mt-0.5 truncate" title={event.league_label}>{event.league_label}</p>
        ) : null}
      </div>

      {bettingOpen && event.betting_deadline_at ? (
        <p className="text-[9px] text-zinc-500 font-heading px-3 -mt-1 pb-1">
          Betting closes {formatDateTime(event.betting_deadline_at)}
        </p>
      ) : null}
      {!bettingOpen ? (
        <p className="text-[9px] text-amber-500/90 font-heading px-3 -mt-1 pb-1">
          {beforeScheduledOpen
            ? `Betting opens ${formatDateTime(event.betting_opens_at)}`
            : event.betting_deadline_at
              ? `Betting closed (closed ${formatDateTime(event.betting_deadline_at)})`
              : 'Betting closed'}
        </p>
      ) : null}

      {/* Odds buttons */}
      <div className="px-3 pb-3 flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => bettingOpen && onPlaceBet(event, opt)}
            disabled={!bettingOpen}
            className={`flex-1 min-w-[80px] relative rounded py-2 px-2 text-center transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] group/opt border ${
              bettingOpen ? 'bg-primary/10 border-primary/20 hover:bg-primary/15' : 'bg-zinc-800/50 border-zinc-700/50'
            }`}
          >
            <span className="block text-[10px] font-heading text-zinc-400 truncate">{opt.name}</span>
            <span className="block text-sm font-heading font-black text-primary mt-0.5">{Number(opt.odds).toFixed(2)}</span>
          </button>
        ))}
      </div>

      {/* Admin row */}
      {isAdmin && (
        <div className="px-3 pb-2 pt-1 flex flex-wrap gap-1.5 justify-end border-t border-primary/10">
          <button type="button" onClick={() => onEditBetWindow?.(event)} className="text-[9px] font-heading font-bold text-sky-400 border border-sky-500/30 hover:bg-sky-500/10 px-2 py-1 rounded transition-all">
            Betting window
          </button>
          <button type="button" onClick={() => onSettle(event)} className="text-[9px] font-heading font-bold text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 px-2 py-1 rounded transition-all">
            Settle
          </button>
          <button
            type="button"
            onClick={() => onCancelEvent(event)}
            disabled={cancellingEventId === event.id}
            className="text-[9px] font-heading font-bold text-red-400 border border-red-500/30 hover:bg-red-500/10 px-2 py-1 rounded transition-all disabled:opacity-50"
          >
            {cancellingEventId === event.id ? '…' : 'Cancel'}
          </button>
        </div>
      )}
      <div className="sb-art-line text-primary mx-3" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Chip button
   ═══════════════════════════════════════════════════════ */
function Chip({ label, color, ring, selected, onClick, size = 36 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-full flex items-center justify-center font-bold transition-all ${selected ? 'scale-110 z-10' : 'hover:scale-105'}`}
      style={{
        width: size, height: size,
        background: `radial-gradient(circle at 40% 35%, ${color}, ${ring})`,
        border: `2px dashed ${ring}`,
        boxShadow: selected ? '0 0 0 2px var(--noir-primary), 0 4px 12px rgba(0,0,0,0.4)' : '0 2px 6px rgba(0,0,0,0.3)',
        color: color === '#e4e4e7' || color === '#16a34a' ? '#000' : '#fff',
        fontSize: Math.max(8, size * 0.24),
      }}
    >
      <span className="relative z-10 drop-shadow-sm">{label}</span>
      <div
        className="absolute rounded-full pointer-events-none"
        style={{ inset: 4, border: `1.5px solid ${selected ? 'var(--noir-primary)' : 'rgba(255,255,255,0.2)'}` }}
      />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════ */
export default function SportsBetting() {
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [events, setEvents] = useState([]);
  const [myBets, setMyBets] = useState(DEFAULT_MY_BETS);
  const [stats, setStats] = useState(null);
  const [recentResults, setRecentResults] = useState([]);
  const [placing, setPlacing] = useState(null);
  const [stake, setStake] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [templates, setTemplates] = useState({
    categories: [],
    templates: {},
    odds_api_configured: null,
    templates_total: null,
    template_source: null,
    football_league_filter_options: null,
  });
  const [loadingDbTemplates, setLoadingDbTemplates] = useState(false);
  const [adminCategory, setAdminCategory] = useState('Football');
  const [addingTemplateId, setAddingTemplateId] = useState(null);
  const [checkingEvents, setCheckingEvents] = useState(false);
  const [autoSettling, setAutoSettling] = useState(false);
  const [settleEvent, setSettleEvent] = useState(null);
  const [settleWinningId, setSettleWinningId] = useState('');
  const [settling, setSettling] = useState(false);
  const [adminPanelHidden, setAdminPanelHidden] = useState(() => {
    try { return localStorage.getItem('sports-betting-admin-hidden') === '1'; } catch { return false; }
  });
  const [cancellingBetId, setCancellingBetId] = useState(null);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [cancellingEventId, setCancellingEventId] = useState(null);
  const [customEventName, setCustomEventName] = useState('');
  const [customEventCategory, setCustomEventCategory] = useState('Football');
  const [customEventOptions, setCustomEventOptions] = useState([{ name: '', odds: 2 }, { name: '', odds: 2 }]);
  const [customEventStartTime, setCustomEventStartTime] = useState('');
  const [customBettingOpensAt, setCustomBettingOpensAt] = useState('');
  const [customBettingClosesAt, setCustomBettingClosesAt] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);
  const [betWindowEvent, setBetWindowEvent] = useState(null);
  const [betWindowOpensLocal, setBetWindowOpensLocal] = useState('');
  const [betWindowClosesLocal, setBetWindowClosesLocal] = useState('');
  const [savingBetWindow, setSavingBetWindow] = useState(false);
  const [activeTab, setActiveTab] = useState('events');
  const [publicLibrary, setPublicLibrary] = useState(DEFAULT_PUBLIC_LIBRARY);
  const [requestInfo, setRequestInfo] = useState(DEFAULT_REQUEST_INFO);
  const [pendingPlayerRequests, setPendingPlayerRequests] = useState([]);
  const [browseCategory, setBrowseCategory] = useState('Football');
  const [browseLeagueFilter, setBrowseLeagueFilter] = useState('');
  const [browseSearchQuery, setBrowseSearchQuery] = useState('');
  const [browseDatePreset, setBrowseDatePreset] = useState('');
  const [browseDateSpecific, setBrowseDateSpecific] = useState('');
  const [requestingTemplateId, setRequestingTemplateId] = useState(null);
  const [processingPlayerRequestId, setProcessingPlayerRequestId] = useState(null);
  const [templateLeagueFilter, setTemplateLeagueFilter] = useState('');
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [templateDatePreset, setTemplateDatePreset] = useState('');
  const [templateDateSpecific, setTemplateDateSpecific] = useState('');

  useEffect(() => {
    setTemplateLeagueFilter('');
  }, [adminCategory]);

  useEffect(() => {
    setBrowseLeagueFilter('');
  }, [browseCategory]);

  const fetchPendingPlayerRequests = useCallback(async () => {
    try {
      const pr = await api.get('/admin/sports-betting/event-requests');
      setPendingPlayerRequests(pr.data?.requests ?? []);
    } catch {
      setPendingPlayerRequests([]);
    }
  }, []);

  useEffect(() => {
    const cached = getSportsBettingPrefetch();
    if (!cached) return;
    setEvents(cached.events ?? []);
    setMyBets(cached.myBets ?? DEFAULT_MY_BETS);
    setStats(cached.stats ?? null);
    setRecentResults(cached.recentResults ?? []);
    setPublicLibrary(cached.publicLibrary ?? DEFAULT_PUBLIC_LIBRARY);
    setRequestInfo(cached.requestInfo ?? DEFAULT_REQUEST_INFO);
    setHasLoaded(true);
  }, []);

  const fetchAll = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      let nextEvents = [];
      let nextMyBets = DEFAULT_MY_BETS;
      let nextStats = null;
      let nextRecentResults = [];
      let nextPublicLibrary = DEFAULT_PUBLIC_LIBRARY;
      let nextRequestInfo = DEFAULT_REQUEST_INFO;

      const [eventsRes, betsRes, statsRes, resultsRes, libRes, reqRes] = await Promise.all([
        api.get('/sports-betting/events'),
        api.get('/sports-betting/my-bets'),
        api.get('/sports-betting/stats'),
        api.get('/sports-betting/recent-results'),
        api.get('/sports-betting/template-library').catch(() => ({ data: null })),
        api.get('/sports-betting/my-event-requests').catch(() => ({ data: null })),
      ]);
      nextEvents = eventsRes.data?.events ?? [];
      nextMyBets = {
        open: betsRes.data?.open ?? [],
        closed: betsRes.data?.closed ?? [],
        max_total_open_stake: betsRes.data?.max_total_open_stake ?? SPORTS_MAX_TOTAL_OPEN_STAKE,
        open_stake_total: betsRes.data?.open_stake_total ?? 0,
        open_stake_remaining: betsRes.data?.open_stake_remaining ?? SPORTS_MAX_TOTAL_OPEN_STAKE,
      };
      nextStats = statsRes.data ?? null;
      nextRecentResults = resultsRes.data?.results ?? [];

      setEvents(nextEvents);
      setMyBets(nextMyBets);
      setStats(nextStats);
      setRecentResults(nextRecentResults);
      if (libRes?.data) {
        nextPublicLibrary = {
          categories: libRes.data.categories ?? [],
          templates: libRes.data.templates ?? {},
          on_board_template_ids: libRes.data.on_board_template_ids ?? [],
          requests_per_day_limit: libRes.data.requests_per_day_limit ?? 3,
          football_league_filter_options: libRes.data.football_league_filter_options ?? null,
        };
        setPublicLibrary(nextPublicLibrary);
      }
      if (reqRes?.data) {
        nextRequestInfo = {
          used_today: reqRes.data.used_today ?? 0,
          limit: reqRes.data.limit ?? 3,
          remaining: reqRes.data.remaining ?? 0,
          recent_requests: reqRes.data.recent_requests ?? [],
        };
        setRequestInfo(nextRequestInfo);
      }
      setSportsBettingPrefetch({
        events: nextEvents,
        myBets: nextMyBets,
        stats: nextStats,
        recentResults: nextRecentResults,
        publicLibrary: nextPublicLibrary,
        requestInfo: nextRequestInfo,
      });
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to load'));
      setEvents([]);
      setMyBets(DEFAULT_MY_BETS);
      setStats(null);
      setRecentResults([]);
    } finally {
      if (!silent) setLoading(false);
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    const cached = getSportsBettingPrefetch();
    fetchAll({ silent: !!cached });
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/admin/check');
        if (cancelled) return;
        if (res.data?.is_admin) {
          setIsAdmin(true);
          const tRes = await api.get('/admin/sports-betting/templates');
          if (!cancelled) {
            setTemplates({
              categories: tRes.data?.categories ?? [],
              templates: tRes.data?.templates ?? {},
              odds_api_configured: tRes.data?.odds_api_configured ?? null,
              templates_total: tRes.data?.templates_total ?? null,
              template_source: tRes.data?.template_source ?? null,
              football_league_filter_options: tRes.data?.football_league_filter_options ?? null,
            });
          }
          try {
            const pr = await api.get('/admin/sports-betting/event-requests');
            if (!cancelled) setPendingPlayerRequests(pr.data?.requests ?? []);
          } catch {
            if (!cancelled) setPendingPlayerRequests([]);
          }
        }
      } catch { if (!cancelled) setIsAdmin(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const placeBet = async () => {
    if (!selectedEvent || !selectedOption) return;
    const amount = parseInt(String(stake || '').replace(/\D/g, ''), 10);
    if (!amount || amount <= 0) { toast.error('Enter a valid stake'); return; }
    const cap = Number(myBets.max_total_open_stake ?? SPORTS_MAX_TOTAL_OPEN_STAKE);
    const listed = (myBets.open || []).reduce((s, b) => s + Number(b.stake || 0), 0);
    const atRisk = Number.isFinite(myBets.open_stake_total) ? Number(myBets.open_stake_total) : listed;
    const left = Number.isFinite(myBets.open_stake_remaining)
      ? Number(myBets.open_stake_remaining)
      : Math.max(0, cap - atRisk);
    if (amount > left) {
      toast.error(
        `Open stakes are capped at ${formatMoney(cap)} total across all bets. You can add at most ${formatMoney(left)} more.`,
      );
      return;
    }
    setPlacing(true);
    try {
      await api.post('/sports-betting/bet', { event_id: selectedEvent.id, option_id: selectedOption.id, stake: amount });
      toast.success(`Bet placed: ${formatMoney(amount)} on ${selectedOption.name}`);
      setStake(''); setSelectedEvent(null); setSelectedOption(null);
      refreshUser(); await fetchAll();
    } catch (e) { toast.error(apiErrorDetail(e, 'Bet failed')); }
    finally { setPlacing(false); }
  };

  const openBetModal = (event, option) => { setSelectedEvent(event); setSelectedOption(option); setStake(''); };

  const checkForEvents = async () => {
    setCheckingEvents(true);
    try {
      const res = await api.post('/admin/sports-betting/refresh');
      setTemplates({
        categories: res.data?.categories ?? [],
        templates: res.data?.templates ?? {},
        odds_api_configured: res.data?.odds_api_configured ?? null,
        templates_total: res.data?.templates_total ?? null,
        template_source: res.data?.template_source ?? 'merged',
        football_league_filter_options: res.data?.football_league_filter_options ?? null,
      });
      const n = res.data?.templates_persisted;
      toast.success(typeof n === 'number' ? `Events loaded — ${n} saved to template library` : 'Events loaded');
      await fetchPendingPlayerRequests();
      const as = res.data?.auto_settle;
      if (as && typeof as === 'object') {
        if (as.error) {
          toast.error(`Auto-settle after refresh failed: ${as.error}`);
        } else if (typeof as.settled === 'number') {
          toast.info(
            `Auto-settle: ${as.settled} event(s) settled (skipped match ${as.skipped_no_match ?? 0}, no winner ${as.skipped_no_winner ?? 0})`,
          );
        }
      }
      try {
        const libRef = await api.get('/sports-betting/template-library');
        if (libRef?.data) {
          setPublicLibrary({
            categories: libRef.data.categories ?? [],
            templates: libRef.data.templates ?? {},
            on_board_template_ids: libRef.data.on_board_template_ids ?? [],
            requests_per_day_limit: libRef.data.requests_per_day_limit ?? 3,
            football_league_filter_options: libRef.data.football_league_filter_options ?? null,
          });
        }
      } catch { /* ignore */ }
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setCheckingEvents(false); }
  };

  const runAutoSettle = async () => {
    setAutoSettling(true);
    try {
      const res = await api.post('/admin/sports-betting/auto-settle-run');
      const d = res.data || {};
      if (d.message && typeof d.message === 'string') {
        toast.error(d.message);
        return;
      }
      const settled = Number(d.settled ?? 0);
      toast.success(
        `Auto-settle done: ${settled} settled · skipped (no board match) ${d.skipped_no_match ?? 0} · skipped (no winner) ${d.skipped_no_winner ?? 0}`,
      );
      await fetchAll();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Auto-settle failed'));
    } finally {
      setAutoSettling(false);
    }
  };

  const loadTemplatesFromDb = async () => {
    setLoadingDbTemplates(true);
    try {
      const res = await api.post('/admin/sports-betting/templates/load-db');
      setTemplates({
        categories: res.data?.categories ?? [],
        templates: res.data?.templates ?? {},
        odds_api_configured: res.data?.odds_api_configured ?? null,
        templates_total: res.data?.templates_total ?? null,
        template_source: res.data?.template_source ?? 'database',
        football_league_filter_options: res.data?.football_league_filter_options ?? null,
      });
      const n = res.data?.templates_total;
      toast.success(typeof n === 'number' ? `Loaded ${n} saved template(s) from database` : 'Saved templates loaded');
      try {
        const libRef = await api.get('/sports-betting/template-library');
        if (libRef?.data) {
          setPublicLibrary({
            categories: libRef.data.categories ?? [],
            templates: libRef.data.templates ?? {},
            on_board_template_ids: libRef.data.on_board_template_ids ?? [],
            requests_per_day_limit: libRef.data.requests_per_day_limit ?? 3,
            football_league_filter_options: libRef.data.football_league_filter_options ?? null,
          });
        }
      } catch { /* ignore */ }
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setLoadingDbTemplates(false); }
  };

  const runSettle = async () => {
    if (!settleEvent || !settleWinningId) { toast.error('Select the winning option'); return; }
    setSettling(true);
    try {
      await api.post('/admin/sports-betting/settle', { event_id: settleEvent.id, winning_option_id: settleWinningId });
      toast.success('Event settled'); setSettleEvent(null); setSettleWinningId(''); await fetchAll();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setSettling(false); }
  };

  const cancelBet = async (betId) => {
    setCancellingBetId(betId);
    try {
      const res = await api.post('/sports-betting/cancel-bet', { bet_id: betId });
      toast.success(res.data?.message || 'Cancelled'); refreshUser(); await fetchAll();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setCancellingBetId(null); }
  };

  const cancelAllBets = async () => {
    if (myBets.open.length === 0) return;
    if (!window.confirm(`Cancel all ${myBets.open.length} open bet(s)?`)) return;
    setCancellingAll(true);
    try {
      const res = await api.post('/sports-betting/cancel-all-bets');
      toast.success(res.data?.message || 'All cancelled'); refreshUser(); await fetchAll();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setCancellingAll(false); }
  };

  const cancelEvent = async (ev) => {
    if (!ev?.id || !window.confirm(`Cancel "${ev.name}"? All bets refunded.`)) return;
    setCancellingEventId(ev.id);
    try {
      const res = await api.post('/admin/sports-betting/cancel-event', { event_id: ev.id });
      toast.success(res.data?.message || 'Cancelled'); await fetchAll();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setCancellingEventId(null); }
  };

  const addEventFromTemplate = async (templateId) => {
    setAddingTemplateId(templateId);
    try {
      await api.post('/admin/sports-betting/events', { template_id: templateId });
      toast.success('Event added');
      await fetchAll();
      await fetchPendingPlayerRequests();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setAddingTemplateId(null); }
  };

  const requestGameFromLibrary = async (templateId) => {
    setRequestingTemplateId(templateId);
    try {
      const res = await api.post('/sports-betting/request-event', { template_id: templateId });
      toast.success(res.data?.message || 'Request sent');
      setRequestInfo((prev) => ({
        ...prev,
        used_today: res.data?.used_today ?? prev.used_today,
        remaining: res.data?.remaining ?? prev.remaining,
      }));
      const r2 = await api.get('/sports-betting/my-event-requests').catch(() => ({ data: null }));
      if (r2?.data) {
        setRequestInfo({
          used_today: r2.data.used_today ?? 0,
          limit: r2.data.limit ?? 3,
          remaining: r2.data.remaining ?? 0,
          recent_requests: r2.data.recent_requests ?? [],
        });
      }
      const lib = await api.get('/sports-betting/template-library').catch(() => ({ data: null }));
      if (lib?.data) {
        setPublicLibrary({
          categories: lib.data.categories ?? [],
          templates: lib.data.templates ?? {},
          on_board_template_ids: lib.data.on_board_template_ids ?? [],
          requests_per_day_limit: lib.data.requests_per_day_limit ?? 3,
          football_league_filter_options: lib.data.football_league_filter_options ?? null,
        });
      }
    } catch (e) { toast.error(apiErrorDetail(e, 'Request failed')); }
    finally { setRequestingTemplateId(null); }
  };

  const approvePlayerRequest = async (requestId) => {
    setProcessingPlayerRequestId(requestId);
    try {
      await api.post('/admin/sports-betting/event-requests/approve', { request_id: requestId });
      toast.success('Approved — event added');
      await fetchAll();
      await fetchPendingPlayerRequests();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setProcessingPlayerRequestId(null); }
  };

  const denyPlayerRequest = async (requestId) => {
    const reason = window.prompt('Deny reason (optional — shown to the player):');
    if (reason === null) return;
    setProcessingPlayerRequestId(requestId);
    try {
      await api.post('/admin/sports-betting/event-requests/deny', {
        request_id: requestId,
        reason: (reason || '').trim() || undefined,
      });
      toast.success('Request denied');
      await fetchPendingPlayerRequests();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setProcessingPlayerRequestId(null); }
  };

  const addCustomEvent = async () => {
    const name = (customEventName || '').trim();
    if (!name) { toast.error('Enter event name'); return; }
    const opts = customEventOptions.map((o) => ({ name: (o.name || '').trim(), odds: Number(o.odds) || 2 })).filter((o) => o.name);
    if (opts.length < 2) { toast.error('Need at least 2 options'); return; }
    setAddingCustom(true);
    try {
      const body = { name, category: customEventCategory, options: opts };
      if (customEventStartTime.trim()) body.start_time = new Date(customEventStartTime).toISOString();
      if (customBettingOpensAt.trim()) body.betting_opens_at = new Date(customBettingOpensAt).toISOString();
      if (customBettingClosesAt.trim()) body.betting_closes_at = new Date(customBettingClosesAt).toISOString();
      await api.post('/admin/sports-betting/custom-event', body);
      toast.success('Custom event added');
      setCustomEventName('');
      setCustomEventOptions([{ name: '', odds: 2 }, { name: '', odds: 2 }]);
      setCustomEventStartTime('');
      setCustomBettingOpensAt('');
      setCustomBettingClosesAt('');
      await fetchAll();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setAddingCustom(false); }
  };

  const setCustomOption = (index, field, value) => {
    setCustomEventOptions((prev) => { const next = [...prev]; if (!next[index]) next[index] = { name: '', odds: 2 }; next[index] = { ...next[index], [field]: value }; return next; });
  };

  const toggleAdminPanel = (hide) => {
    setAdminPanelHidden(hide);
    try { if (hide) localStorage.setItem('sports-betting-admin-hidden', '1'); else localStorage.removeItem('sports-betting-admin-hidden'); } catch {}
  };

  const openBetsListedStake = (myBets.open || []).reduce((s, b) => s + Number(b.stake || 0), 0);
  const openBetsTotalStake = Number.isFinite(myBets.open_stake_total) ? Number(myBets.open_stake_total) : openBetsListedStake;
  const sportsOpenCap = Number(myBets.max_total_open_stake ?? SPORTS_MAX_TOTAL_OPEN_STAKE);
  const openStakeRemaining = Number.isFinite(myBets.open_stake_remaining)
    ? Number(myBets.open_stake_remaining)
    : Math.max(0, sportsOpenCap - openBetsTotalStake);
  const openBetsPotentialReturn = (myBets.open || []).reduce((s, b) => s + Math.floor(Number(b.stake || 0) * Number(b.odds || 1)), 0);

  const stakeInputAmount = parseInt(String(stake).replace(/\D/g, ''), 10);
  const stakeExceedsOpenCap = !stakeInputAmount || stakeInputAmount > openStakeRemaining;

  const templateMap = templates.templates || {};
  const templateTotal = (templates.categories || []).reduce((s, c) => s + (templateMap[c]?.length || 0), 0);
  const onBoardTemplateSet = useMemo(
    () => new Set((publicLibrary.on_board_template_ids || []).map((id) => String(id))),
    [publicLibrary.on_board_template_ids],
  );

  const templatesInAdminTabEligible = useMemo(() => {
    let list = templateMap[adminCategory] || [];
    if (adminCategory === 'Football' && templateLeagueFilter) {
      list = list.filter((t) => t.external_sport_key === templateLeagueFilter);
    }
    return list.filter((t) => !onBoardTemplateSet.has(String(t.id ?? ''))).length;
  }, [templateMap, adminCategory, templateLeagueFilter, onBoardTemplateSet]);

  const footballLeagueOptions = useMemo(() => {
    const staticOpts = templates.football_league_filter_options;
    if (Array.isArray(staticOpts) && staticOpts.length > 0) {
      return staticOpts.map((o) => [o.key, o.label]).sort((a, b) => a[1].localeCompare(b[1]));
    }
    const list = templateMap.Football || [];
    const m = new Map();
    list.forEach((t) => {
      const k = t.external_sport_key;
      if (!k) return;
      const lab = t.league_label || k;
      if (!m.has(k)) m.set(k, lab);
    });
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [templates.football_league_filter_options, templateMap]);

  const filteredAdminTemplates = useMemo(() => {
    let list = templateMap[adminCategory] || [];
    if (adminCategory === 'Football' && templateLeagueFilter) {
      list = list.filter((t) => t.external_sport_key === templateLeagueFilter);
    }
    list = list.filter((t) => !onBoardTemplateSet.has(String(t.id ?? '')));
    const q = (templateSearchQuery || '').trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          (t.name || '').toLowerCase().includes(q) ||
          (t.id || '').toLowerCase().includes(q) ||
          (t.external_sport_key || '').toLowerCase().includes(q) ||
          (t.league_label || '').toLowerCase().includes(q),
      );
    }
    if (templateDateSpecific || templateDatePreset) {
      list = list.filter((t) => templateMatchesDateFilter(t, templateDatePreset, templateDateSpecific));
    }
    return list;
  }, [templateMap, adminCategory, templateLeagueFilter, templateSearchQuery, templateDatePreset, templateDateSpecific, onBoardTemplateSet]);

  const shownInCategory = filteredAdminTemplates.length;

  const publicBrowseMap = publicLibrary.templates || {};
  const browseLibraryTotal = (publicLibrary.categories || []).reduce(
    (s, c) => s + (publicBrowseMap[c]?.length || 0),
    0,
  );

  const footballLeagueBrowseOptions = useMemo(() => {
    const staticOpts = publicLibrary.football_league_filter_options;
    if (Array.isArray(staticOpts) && staticOpts.length > 0) {
      return staticOpts.map((o) => [o.key, o.label]).sort((a, b) => a[1].localeCompare(b[1]));
    }
    const list = publicBrowseMap.Football || [];
    const m = new Map();
    list.forEach((t) => {
      const k = t.external_sport_key;
      if (!k) return;
      const lab = t.league_label || k;
      if (!m.has(k)) m.set(k, lab);
    });
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [publicLibrary.football_league_filter_options, publicBrowseMap]);

  const filteredBrowseTemplates = useMemo(() => {
    let list = publicBrowseMap[browseCategory] || [];
    if (browseCategory === 'Football' && browseLeagueFilter) {
      list = list.filter((t) => t.external_sport_key === browseLeagueFilter);
    }
    const q = (browseSearchQuery || '').trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          (t.name || '').toLowerCase().includes(q) ||
          (t.id || '').toLowerCase().includes(q) ||
          (t.external_sport_key || '').toLowerCase().includes(q) ||
          (t.league_label || '').toLowerCase().includes(q),
      );
    }
    if (browseDateSpecific || browseDatePreset) {
      list = list.filter((t) => templateMatchesDateFilter(t, browseDatePreset, browseDateSpecific));
    }
    return list;
  }, [
    publicBrowseMap,
    browseCategory,
    browseLeagueFilter,
    browseSearchQuery,
    browseDatePreset,
    browseDateSpecific,
  ]);

  const shownBrowseCount = filteredBrowseTemplates.length;

  if (!hasLoaded) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="sports-betting-page"><style>{SB_STYLES}</style></div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="sports-betting-page">
      <style>{SB_STYLES}</style>
      <style>{`
        @keyframes sb-slide-up { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes sb-pulse-gold { 0%, 100% { box-shadow: 0 0 8px rgba(212,175,55,0.15); } 50% { box-shadow: 0 0 20px rgba(212,175,55,0.35); } }
        .animate-sb-fade-in { animation: sb-fade-in 0.3s ease-out backwards; }
        .animate-sb-slide-up { animation: sb-slide-up 0.4s cubic-bezier(0.2, 0.8, 0.3, 1) forwards; }
        .animate-sb-pulse-gold { animation: sb-pulse-gold 2s ease-in-out infinite; }
      `}</style>

      {/* Page header */}
      <div className="relative sb-fade-in space-y-0.5">
        <p className="text-[10px] text-zinc-500 font-heading italic">
          Underground — closes 10 min before start. Max {formatMoney(sportsOpenCap)} total staked across all your open bets.
        </p>
        <p className="text-[10px] text-zinc-600 font-heading italic">Winnings are paid to your Swiss bank (can exceed your normal Swiss deposit limit). Stakes come from cash on hand.</p>
      </div>

      {/* ═══ Stats bar ═══ */}
      <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-primary/20 bg-primary/5 overflow-hidden">
        <div className="h-0.5 absolute top-0 left-0 right-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] font-heading uppercase tracking-wider">
          <span className="text-zinc-500">{events.length} <span className="text-zinc-600">events</span></span>
          <span className="text-zinc-500">{myBets.open.length} <span className="text-zinc-600">open bets</span></span>
          {stats && (
            <span className={`font-bold ${(stats.profit_loss ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`} title="Your net on settled bets">
              You P/L {formatMoney(stats.profit_loss)}
            </span>
          )}
          {stats?.global_book && (
            <>
              <span className="text-zinc-500 border-l border-zinc-700/80 pl-4" title="Every sports bet ever placed (including open and cancelled)">
                {(stats.global_book.total_bets_all_time ?? 0).toLocaleString()} <span className="text-zinc-600">book bets</span>
              </span>
              <span
                className={`font-bold ${(stats.global_book.aggregate_player_profit_loss ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                title="Combined net for all players on settled won/lost bets (payouts minus stakes)"
              >
                All players net {formatMoney(stats.global_book.aggregate_player_profit_loss)}
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => fetchAll()}
          className="flex items-center gap-1.5 text-[10px] font-heading text-zinc-500 hover:text-primary transition-all"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* ═══ Tab navigation ═══ */}
      <div className="relative flex gap-1 p-1 rounded-lg border border-primary/20 bg-primary/5 overflow-hidden">
        <div className="h-0.5 absolute top-0 left-0 right-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent rounded-t-lg pointer-events-none" aria-hidden />
        {[
          { id: 'events', label: 'Events', count: events.length },
          { id: 'browse', label: 'Browse / Request', count: browseLibraryTotal },
          { id: 'bets', label: 'My Bets', count: myBets.open.length },
          { id: 'stats', label: 'Record' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 px-3 rounded-md text-[10px] font-heading font-bold uppercase tracking-wider transition-all border ${
              activeTab === tab.id
                ? 'text-primary bg-primary/10 border-primary/20'
                : 'text-zinc-500 hover:text-zinc-300 border-transparent'
            }`}
          >
            {tab.label}
            {tab.count != null && <span className="ml-1 text-primary/60">({tab.count})</span>}
          </button>
        ))}
      </div>

      {/* ═══ Admin panel ═══ */}
      {isAdmin && (
        adminPanelHidden ? (
          <button onClick={() => toggleAdminPanel(false)} className="relative w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-primary/20 bg-primary/5 text-[10px] font-heading text-zinc-500 hover:text-primary transition-all">
            <span className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent rounded-t-lg" aria-hidden />
            <Shield size={12} /> Show admin panel <ChevronDown size={12} />
          </button>
        ) : (
          <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20 sb-fade-in`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-primary" />
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Admin — Add Events</span>
              </div>
              <button onClick={() => toggleAdminPanel(true)} className="text-[10px] font-heading text-zinc-500 hover:text-primary flex items-center gap-1"><ChevronUp size={12} /> Hide</button>
            </div>
            <div className="p-3 space-y-3">
              {pendingPlayerRequests.length > 0 ? (
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5 space-y-2">
                  <div className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-wider">
                    Pending player requests ({pendingPlayerRequests.length})
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {pendingPlayerRequests.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center gap-2 py-2 border-b border-zinc-800/60 last:border-0 text-[10px] font-heading"
                      >
                        <div className="flex-1 min-w-[140px]">
                          <div className="text-foreground font-bold truncate">{r.template_name || '—'}</div>
                          <div className="text-zinc-500">
                            {(r.template_category || '—')} · requested by {r.username || '?'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => approvePlayerRequest(r.id)}
                          disabled={processingPlayerRequestId === r.id}
                          className="bg-emerald-500/20 text-emerald-400 rounded px-2 py-1 text-[9px] font-bold uppercase border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-50"
                        >
                          {processingPlayerRequestId === r.id ? '…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => denyPlayerRequest(r.id)}
                          disabled={processingPlayerRequestId === r.id}
                          className="bg-red-500/15 text-red-400 rounded px-2 py-1 text-[9px] font-bold uppercase border border-red-500/35 hover:bg-red-500/25 disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={checkForEvents} disabled={checkingEvents || loadingDbTemplates || autoSettling} className="bg-primary/20 text-primary rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50">
                  {checkingEvents ? 'Checking...' : 'Check for events'}
                </button>
                <button
                  type="button"
                  onClick={runAutoSettle}
                  disabled={autoSettling || checkingEvents || loadingDbTemplates}
                  className="bg-emerald-500/15 text-emerald-400 rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-50"
                  title="Poll Odds API scores and settle matching board events (same as cron)"
                >
                  {autoSettling ? 'Settling...' : 'Auto-settle now'}
                </button>
                <button
                  type="button"
                  onClick={loadTemplatesFromDb}
                  disabled={loadingDbTemplates || checkingEvents || autoSettling}
                  className="bg-zinc-800/80 text-zinc-200 rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase border border-zinc-600/50 hover:bg-zinc-700/80 hover:border-zinc-500/50 disabled:opacity-50"
                  title="No API quota — lists templates last saved from Check for events"
                >
                  {loadingDbTemplates ? 'Loading...' : 'Load saved (DB)'}
                </button>
                {templateTotal > 0 ? (
                  <span
                    className="text-[10px] text-zinc-500 font-heading"
                    title={templates.template_source === 'database' ? 'Showing database snapshot only.' : 'Merged: last API refresh + database.'}
                  >
                    {templateTotal} templates total ·{' '}
                    {shownInCategory === templatesInAdminTabEligible
                      ? `${shownInCategory} in ${adminCategory}`
                      : `${shownInCategory} of ${templatesInAdminTabEligible} in ${adminCategory}`}
                    {templates.template_source === 'database' ? (
                      <span className="text-zinc-600"> · DB</span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <p className="text-[9px] text-zinc-600 font-heading leading-snug">
                <span className="font-bold text-zinc-500">Check for events</span> — fetch from the API, save to DB, show list (uses quota).{' '}
                <span className="font-bold text-zinc-500">Load saved (DB)</span> — reload the list from the database only (no API).{' '}
                Games already on the open board are hidden here.
              </p>

              {templates.odds_api_configured === false ? (
                <p className="text-[9px] text-amber-500/90 font-heading">
                  THE_ODDS_API_KEY is not set on the API server — Football/UFC/Boxing use fallbacks; set the key and restart, then Check for events again.
                </p>
              ) : null}

              {/* Category tabs */}
              <div className="flex flex-wrap gap-1">
                {(templates.categories || []).map((c) => {
                  const n = (templateMap[c] || []).filter((t) => !onBoardTemplateSet.has(String(t.id ?? ''))).length;
                  return (
                    <button key={c} onClick={() => setAdminCategory(c)} className={`px-2 py-1 rounded text-[10px] font-heading font-bold transition-all ${adminCategory === c ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-zinc-800/50 text-zinc-500 border border-zinc-700/30 hover:text-zinc-300'}`}>
                      {c} ({n})
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-2">
                <input
                  type="search"
                  value={templateSearchQuery}
                  onChange={(e) => setTemplateSearchQuery(e.target.value)}
                  placeholder="Filter by match name, league, or id…"
                  className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none placeholder:text-zinc-600"
                />
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <select
                    value={templateDatePreset}
                    onChange={(e) => {
                      setTemplateDatePreset(e.target.value);
                      if (e.target.value) setTemplateDateSpecific('');
                    }}
                    className="w-full sm:flex-1 bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none"
                  >
                    <option value="">All dates</option>
                    <option value="today">Today (local)</option>
                    <option value="tomorrow">Tomorrow</option>
                    <option value="7d">Next 7 days</option>
                  </select>
                  <label className="flex items-center gap-1.5 w-full sm:w-auto sm:min-w-[11rem] text-[10px] text-zinc-500 font-heading shrink-0">
                    <span className="whitespace-nowrap">On date</span>
                    <input
                      type="date"
                      value={templateDateSpecific}
                      onChange={(e) => {
                        setTemplateDateSpecific(e.target.value);
                        if (e.target.value) setTemplateDatePreset('');
                      }}
                      className="flex-1 min-w-0 bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none [color-scheme:dark]"
                    />
                  </label>
                </div>
                {adminCategory === 'Football' && footballLeagueOptions.length > 0 ? (
                  <select
                    value={templateLeagueFilter}
                    onChange={(e) => setTemplateLeagueFilter(e.target.value)}
                    className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none"
                  >
                    <option value="">All leagues</option>
                    {footballLeagueOptions.map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                ) : null}
              </div>

              {/* Template list */}
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {(templateMap[adminCategory] || []).length === 0 ? (
                  <p className="text-[10px] text-zinc-600 font-heading py-4 text-center">No events — click Check for events</p>
                ) : shownInCategory === 0 ? (
                  <p className="text-[10px] text-zinc-600 font-heading py-4 text-center">
                    {(templateMap[adminCategory] || []).length > 0 && templatesInAdminTabEligible === 0
                      ? 'Every game in this list is already on the board — open Events to manage them.'
                      : 'No matches — try another filter'}
                  </p>
                ) : (
                  filteredAdminTemplates.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-zinc-800/50 last:border-0">
                    <div className="min-w-0 flex-1">
                      <span className="text-[11px] font-heading text-foreground truncate block">{t.name}</span>
                      {t.league_label ? (
                        <span className="text-[9px] font-heading text-primary/80 truncate block">{t.league_label}</span>
                      ) : null}
                      {(t.start_time_display || t.start_time) && <span className="text-[9px] text-zinc-600 font-heading">{t.start_time_display || formatDateTime(t.start_time)}</span>}
                    </div>
                    <button onClick={() => addEventFromTemplate(t.id)} disabled={addingTemplateId !== null} className="bg-primary/20 text-primary rounded px-2 py-1 text-[9px] font-heading font-bold border border-primary/40 hover:bg-primary/30 disabled:opacity-50 flex items-center gap-1 shrink-0">
                      <Plus size={10} /> {addingTemplateId === t.id ? '...' : 'Add'}
                    </button>
                  </div>
                  ))
                )}
              </div>

              {/* Custom event */}
              <div className="pt-2 border-t border-zinc-800/50 space-y-2">
                <span className="text-[9px] font-heading text-primary uppercase tracking-widest font-bold">Custom event</span>
                <input type="text" value={customEventName} onChange={(e) => setCustomEventName(e.target.value)} placeholder="Event name" className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none" />
                <select value={customEventCategory} onChange={(e) => setCustomEventCategory(e.target.value)} className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none">
                  {['Football', 'UFC', 'Boxing', 'Formula 1'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[9px] text-zinc-500 font-heading">Event start</span>
                    <input type="datetime-local" value={customEventStartTime} onChange={(e) => setCustomEventStartTime(e.target.value)} className="w-full min-w-0 bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none [color-scheme:dark]" />
                    <span className="text-[8px] text-zinc-600 font-heading leading-tight">Default: 2h from now</span>
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[9px] text-zinc-500 font-heading">Betting opens</span>
                    <input type="datetime-local" value={customBettingOpensAt} onChange={(e) => setCustomBettingOpensAt(e.target.value)} className="w-full min-w-0 bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none [color-scheme:dark]" />
                    <span className="text-[8px] text-zinc-600 font-heading leading-tight">Default: immediately</span>
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[9px] text-zinc-500 font-heading">Betting closes</span>
                    <input type="datetime-local" value={customBettingClosesAt} onChange={(e) => setCustomBettingClosesAt(e.target.value)} className="w-full min-w-0 bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none [color-scheme:dark]" />
                    <span className="text-[8px] text-zinc-600 font-heading leading-tight">Default: 10 min before start</span>
                  </label>
                </div>
                {customEventOptions.map((opt, idx) => (
                  <div key={idx} className="flex gap-1.5">
                    <input type="text" value={opt.name} onChange={(e) => setCustomOption(idx, 'name', e.target.value)} placeholder="Option name" className="flex-1 bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none" />
                    <input type="number" min={1.01} max={100} step={0.01} value={opt.odds} onChange={(e) => setCustomOption(idx, 'odds', e.target.value)} className="w-16 bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none" />
                    {customEventOptions.length > 2 && <button onClick={() => setCustomEventOptions((p) => p.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 px-1 text-sm">×</button>}
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <button onClick={() => setCustomEventOptions((p) => [...p, { name: '', odds: 2 }])} className="text-[9px] font-heading text-primary hover:underline">+ Option</button>
                  <div className="flex-1" />
                  <button onClick={addCustomEvent} disabled={addingCustom} className="bg-primary/20 text-primary rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50">
                    {addingCustom ? '...' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
            <div className="sb-art-line text-primary mx-3" />
          </div>
        )
      )}

      {/* ═══ BROWSE / REQUEST TAB ═══ */}
      {activeTab === 'browse' && (
        <div className="space-y-3">
          <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 space-y-1">
              <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Browse saved games</p>
              <p className="text-[9px] text-zinc-500 font-heading leading-relaxed">
                This list is the house database (same source as after staff runs &quot;Check for events&quot;). If a game is not on the board yet, you can request it — staff are notified in their inbox.
                {' '}
                <span className="text-zinc-400">
                  {requestInfo.remaining ?? 0} of {requestInfo.limit ?? 3} request{requestInfo.limit === 1 ? '' : 's'} left today (resets midnight UTC).
                </span>
              </p>
            </div>
            <div className="p-3 space-y-3">
              <div className="flex flex-wrap gap-1">
                {(publicLibrary.categories || []).map((c) => {
                  const n = publicBrowseMap[c]?.length || 0;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setBrowseCategory(c)}
                      className={`px-2 py-1 rounded text-[10px] font-heading font-bold transition-all ${
                        browseCategory === c
                          ? 'bg-primary/20 text-primary border border-primary/40'
                          : 'bg-zinc-800/50 text-zinc-500 border border-zinc-700/30 hover:text-zinc-300'
                      }`}
                    >
                      {c} ({n})
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  type="search"
                  value={browseSearchQuery}
                  onChange={(e) => setBrowseSearchQuery(e.target.value)}
                  placeholder="Filter by match name, league, or id…"
                  className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none placeholder:text-zinc-600"
                />
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <select
                    value={browseDatePreset}
                    onChange={(e) => {
                      setBrowseDatePreset(e.target.value);
                      if (e.target.value) setBrowseDateSpecific('');
                    }}
                    className="w-full sm:flex-1 bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none"
                  >
                    <option value="">All dates</option>
                    <option value="today">Today (local)</option>
                    <option value="tomorrow">Tomorrow</option>
                    <option value="7d">Next 7 days</option>
                  </select>
                  <label className="flex items-center gap-1.5 w-full sm:w-auto sm:min-w-[11rem] text-[10px] text-zinc-500 font-heading shrink-0">
                    <span className="whitespace-nowrap">On date</span>
                    <input
                      type="date"
                      value={browseDateSpecific}
                      onChange={(e) => {
                        setBrowseDateSpecific(e.target.value);
                        if (e.target.value) setBrowseDatePreset('');
                      }}
                      className="flex-1 min-w-0 bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none [color-scheme:dark]"
                    />
                  </label>
                </div>
                {browseCategory === 'Football' && footballLeagueBrowseOptions.length > 0 ? (
                  <select
                    value={browseLeagueFilter}
                    onChange={(e) => setBrowseLeagueFilter(e.target.value)}
                    className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none"
                  >
                    <option value="">All leagues</option>
                    {footballLeagueBrowseOptions.map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                ) : null}
              </div>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {browseLibraryTotal === 0 ? (
                  <p className="text-[10px] text-zinc-600 font-heading py-6 text-center">
                    No saved games in the database yet. Ask staff to run &quot;Check for events&quot; or &quot;Load saved (DB)&quot; in the admin panel.
                  </p>
                ) : shownBrowseCount === 0 ? (
                  <p className="text-[10px] text-zinc-600 font-heading py-6 text-center">No matches — try another filter or category.</p>
                ) : (
                  filteredBrowseTemplates.map((t) => {
                    const onBoard = onBoardTemplateSet.has(String(t.id ?? ''));
                    const canRequest = !onBoard && (requestInfo.remaining ?? 0) > 0;
                    return (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-zinc-800/50 last:border-0"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-[11px] font-heading text-foreground block truncate">{t.name}</span>
                          {t.league_label ? (
                            <span className="text-[9px] font-heading text-primary/80 truncate block">{t.league_label}</span>
                          ) : null}
                          {t.start_time ? (
                            <span className="text-[9px] text-zinc-600 font-heading">{formatDateTime(t.start_time)}</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {onBoard ? (
                            <span className="text-[9px] font-heading font-bold text-emerald-400/90 uppercase border border-emerald-500/30 rounded px-2 py-1">
                              On board
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => requestGameFromLibrary(t.id)}
                              disabled={!canRequest || requestingTemplateId === t.id}
                              title={
                                (requestInfo.remaining ?? 0) <= 0
                                  ? 'Daily request limit reached (UTC midnight reset)'
                                  : 'Ask staff to add this game'
                              }
                              className="bg-primary/20 text-primary rounded px-2 py-1 text-[9px] font-heading font-bold border border-primary/40 hover:bg-primary/30 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {requestingTemplateId === t.id ? '…' : 'Request'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {(requestInfo.recent_requests || []).length > 0 ? (
                <div className="pt-2 border-t border-zinc-800/50 space-y-1">
                  <p className="text-[9px] font-heading font-bold text-zinc-500 uppercase tracking-wider">Your recent requests</p>
                  <ul className="space-y-1 max-h-32 overflow-y-auto">
                    {(requestInfo.recent_requests || []).map((r) => (
                      <li key={r.id} className="text-[10px] font-heading text-zinc-400 flex justify-between gap-2">
                        <span className="truncate">{r.template_name}</span>
                        <span className="shrink-0 text-zinc-500 capitalize">{r.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div className="sb-art-line text-primary mx-3" />
          </div>
        </div>
      )}

      {/* ═══ EVENTS TAB ═══ */}
      {activeTab === 'events' && (
        <div className="space-y-3">
          {events.length === 0 ? (
            <div className="relative text-center py-12 rounded-lg border border-primary/20 bg-primary/5 overflow-hidden">
              <div className="h-0.5 absolute top-0 left-0 right-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <p className="text-sm font-heading font-bold text-zinc-500 uppercase tracking-wider">No events on the board</p>
              <p className="text-[10px] font-heading text-zinc-600 mt-1">Check back later — new games added by the house.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {events.map((ev, i) => (
                <div key={ev.id} className="animate-sb-fade-in" style={{ animationDelay: `${i * 0.05}s` }}>
                  <EventCard
                    event={ev}
                    onPlaceBet={openBetModal}
                    isAdmin={isAdmin}
                    onSettle={(e) => { setSettleEvent(e); setSettleWinningId((e.options?.[0])?.id || ''); }}
                    onCancelEvent={cancelEvent}
                    onEditBetWindow={(e) => {
                      setBetWindowEvent(e);
                      setBetWindowOpensLocal(isoToDatetimeLocal(e.betting_opens_at));
                      setBetWindowClosesLocal(isoToDatetimeLocal(e.betting_closes_at));
                    }}
                    cancellingEventId={cancellingEventId}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ BETS TAB ═══ */}
      {activeTab === 'bets' && (
        <div className="space-y-4">
          {/* Open bets */}
          <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Open Bets</span>
                {myBets.open.length > 0 && (
                  <span className="text-[9px] font-heading text-zinc-500 ml-2">
                    Risk: {formatMoney(openBetsTotalStake)} / cap {formatMoney(sportsOpenCap)} · {formatMoney(openStakeRemaining)} left · Return: {formatMoney(openBetsPotentialReturn)}
                  </span>
                )}
              </div>
              {myBets.open.length > 0 && (
                <button onClick={cancelAllBets} disabled={cancellingAll} className="text-[9px] font-heading font-bold text-red-400 border border-red-500/30 hover:bg-red-500/10 px-2 py-1 rounded disabled:opacity-50 transition-all">
                  {cancellingAll ? '...' : 'Cancel all'}
                </button>
              )}
            </div>
            <div className="p-2">
              {myBets.open.length === 0 ? (
                <p className="text-[11px] text-zinc-600 font-heading py-6 text-center">No open bets — pick an event to place one.</p>
              ) : myBets.open.map((b) => {
                const ret = Math.floor(Number(b.stake || 0) * Number(b.odds || 1));
                return (
                  <div key={b.id} className="flex items-center gap-2 px-2 py-2 rounded bg-zinc-800/20 mb-1 last:mb-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-heading font-bold text-foreground truncate">{b.event_name}</p>
                      <p className="text-[9px] font-heading text-zinc-500">{b.option_name} @ {Number(b.odds)} · Stake: {formatMoney(b.stake)} · Returns: {formatMoney(ret)}</p>
                    </div>
                    <button onClick={() => cancelBet(b.id)} disabled={cancellingBetId === b.id || cancellingAll} className="text-red-400 hover:bg-red-500/10 p-1 rounded border border-transparent hover:border-red-500/30 disabled:opacity-50 transition-all shrink-0">
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="sb-art-line text-primary mx-3" />
          </div>

          {/* Settled bets */}
          <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Settled Bets</span>
            </div>
            <div className="p-2">
              {myBets.closed.length === 0 ? (
                <p className="text-[11px] text-zinc-600 font-heading py-6 text-center">No settled bets yet.</p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {myBets.closed.map((b) => {
                    const stk = Number(b.stake || 0);
                    const profit = b.status === 'won' ? Math.floor(stk * Number(b.odds || 1)) - stk : -stk;
                    return (
                      <div key={b.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-zinc-800/20">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${b.status === 'won' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          <span className="text-[10px] font-heading text-foreground truncate">{b.event_name} · {b.option_name}</span>
                        </div>
                        <span className={`text-[10px] font-heading font-bold shrink-0 ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {profit >= 0 ? '+' : ''}{formatMoney(profit)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="sb-art-line text-primary mx-3" />
          </div>
        </div>
      )}

      {/* ═══ STATS TAB ═══ */}
      {activeTab === 'stats' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <TrendingUp size={14} className="text-primary" />
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Betting Record</span>
            </div>
            <div className="divide-y divide-zinc-800/50">
              {[
                { label: 'Bets placed', value: stats?.total_bets_placed ?? 0 },
                { label: 'Won', value: `${stats?.total_bets_won ?? 0} (${stats?.win_pct ?? 0}%)`, cls: 'text-emerald-400' },
                { label: 'Lost', value: stats?.total_bets_lost ?? 0, cls: 'text-red-400' },
                { label: 'Profit / Loss', value: formatMoney(stats?.profit_loss), cls: (stats?.profit_loss ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
              ].map((r) => (
                <div key={r.label} className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] font-heading text-zinc-500">{r.label}</span>
                  <span className={`text-[11px] font-heading font-bold ${r.cls || 'text-foreground'}`}>{r.value}</span>
                </div>
              ))}
              {stats?.global_book && (
                <>
                  <div className="px-3 py-2 bg-zinc-900/50 border-t border-zinc-800/60">
                    <span className="text-[9px] font-heading font-bold text-zinc-500 uppercase tracking-wider">Whole game (all players)</span>
                    <p className="text-[9px] text-zinc-600 font-heading mt-0.5">Net on settled bets = total payouts minus stakes lost (won/lost only).</p>
                  </div>
                  {[
                    { label: 'Total bets placed (book)', value: (stats.global_book.total_bets_all_time ?? 0).toLocaleString() },
                    { label: 'Settled bets (book)', value: (stats.global_book.settled_bets_count ?? 0).toLocaleString() },
                    {
                      label: 'Open stake (all players)',
                      value: formatMoney(stats.global_book.open_stake_all_players),
                      cls: 'text-amber-400/90',
                    },
                    {
                      label: 'All players net P/L',
                      value: formatMoney(stats.global_book.aggregate_player_profit_loss),
                      cls: (stats.global_book.aggregate_player_profit_loss ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400',
                    },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-[11px] font-heading text-zinc-500">{r.label}</span>
                      <span className={`text-[11px] font-heading font-bold ${r.cls || 'text-foreground'}`}>{r.value}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="sb-art-line text-primary mx-3" />
          </div>

          {/* Recent results */}
          <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-primary" />
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Recent Results</span>
              </div>
              <span className="text-[9px] text-zinc-600 font-heading">Last 25</span>
            </div>
            <div className="p-2 max-h-64 overflow-y-auto">
              {recentResults.length === 0 ? (
                <p className="text-[11px] text-zinc-600 font-heading py-6 text-center">No results yet.</p>
              ) : recentResults.map((r, i) => (
                <div key={r.date || i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-zinc-800/20 mb-1 last:mb-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.result === 'won' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-[10px] font-heading text-foreground truncate">{r.betting_option}</span>
                    <span className="text-[9px] font-heading text-zinc-600">@ {Number(r.odds)}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-heading font-bold ${r.result === 'won' ? 'text-emerald-400' : 'text-zinc-600'}`}>
                      {r.result === 'won' ? 'Win' : 'Loss'}
                    </span>
                    <span className="text-[9px] font-heading text-zinc-700">{formatDateTime(r.date)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="sb-art-line text-primary mx-3" />
          </div>
        </div>
      )}

      {/* ═══ Betting window (admin) ═══ */}
      {betWindowEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => { if (!savingBetWindow) { setBetWindowEvent(null); setBetWindowOpensLocal(''); setBetWindowClosesLocal(''); } }}
        >
          <div className={`${styles.panel} rounded-lg p-5 w-full max-w-md shadow-2xl border border-primary/30 animate-sb-slide-up`} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Betting window</h3>
            <p className="text-sm text-foreground font-heading mt-2 font-bold">{betWindowEvent.name}</p>
            <p className="text-[10px] text-zinc-500 font-heading mt-1 leading-relaxed">
              Leave a field empty to use the default (opens: immediately; closes: 10 minutes before event start). Times use your device timezone and are stored in UTC.
            </p>
            <div className="mt-3 space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-[9px] text-zinc-500 font-heading">Betting opens</span>
                <input
                  type="datetime-local"
                  value={betWindowOpensLocal}
                  onChange={(e) => setBetWindowOpensLocal(e.target.value)}
                  className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none [color-scheme:dark]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] text-zinc-500 font-heading">Betting closes</span>
                <input
                  type="datetime-local"
                  value={betWindowClosesLocal}
                  onChange={(e) => setBetWindowClosesLocal(e.target.value)}
                  className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none [color-scheme:dark]"
                />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!betWindowEvent) return;
                  setSavingBetWindow(true);
                  try {
                    await api.patch('/admin/sports-betting/events/betting-window', {
                      event_id: betWindowEvent.id,
                      betting_opens_at: betWindowOpensLocal.trim() ? new Date(betWindowOpensLocal).toISOString() : null,
                      betting_closes_at: betWindowClosesLocal.trim() ? new Date(betWindowClosesLocal).toISOString() : null,
                    });
                    toast.success('Betting window updated');
                    setBetWindowEvent(null);
                    setBetWindowOpensLocal('');
                    setBetWindowClosesLocal('');
                    await fetchAll();
                  } catch (e) {
                    toast.error(apiErrorDetail(e, 'Failed'));
                  } finally {
                    setSavingBetWindow(false);
                  }
                }}
                disabled={savingBetWindow}
                className="flex-1 bg-primary/20 text-primary py-2.5 rounded font-heading font-bold text-sm uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-40"
              >
                {savingBetWindow ? '...' : 'Save'}
              </button>
              <button
                type="button"
                disabled={savingBetWindow}
                onClick={() => { setBetWindowEvent(null); setBetWindowOpensLocal(''); setBetWindowClosesLocal(''); }}
                className="px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded text-foreground font-heading text-sm hover:bg-zinc-700 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Settle modal ═══ */}
      {settleEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => { setSettleEvent(null); setSettleWinningId(''); }}>
          <div className={`${styles.panel} rounded-lg p-5 w-full max-w-sm shadow-2xl border border-primary/30 animate-sb-slide-up`} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Settle Event</h3>
            <p className="text-sm text-foreground font-heading mt-2 font-bold">{settleEvent.name}</p>
            <p className="text-[10px] text-zinc-500 font-heading mt-1">Select the winning outcome:</p>
            <div className="mt-3 space-y-1.5">
              {(settleEvent.options || []).map((o) => (
                <label key={o.id} className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all ${settleWinningId === o.id ? 'bg-primary/10 border border-primary/30' : 'bg-zinc-800/30 border border-transparent hover:bg-zinc-800/50'}`}>
                  <input type="radio" name="settleWinner" checked={settleWinningId === o.id} onChange={() => setSettleWinningId(o.id)} className="accent-primary" />
                  <span className="text-sm font-heading text-foreground">{o.name}</span>
                  <span className="text-[10px] font-heading text-primary ml-auto">@ {Number(o.odds)}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={runSettle} disabled={settling || !settleWinningId} className="flex-1 bg-primary/20 text-primary py-2.5 rounded font-heading font-bold text-sm uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-40">
                {settling ? '...' : 'Settle & Pay'}
              </button>
              <button onClick={() => { setSettleEvent(null); setSettleWinningId(''); }} className="px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded text-foreground font-heading text-sm hover:bg-zinc-700">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Place bet modal ═══ */}
      {selectedEvent && selectedOption && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setSelectedEvent(null)}>
          <div
            className="w-full max-w-sm rounded-xl overflow-hidden shadow-2xl animate-sb-slide-up border-2 border-primary/20 bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Slip header */}
            <div className="px-4 py-3 text-center border-b border-primary/20 bg-primary/8">
              <p className="text-[9px] font-heading text-primary/80 uppercase tracking-[0.2em]">Betting Slip</p>
            </div>

            <div className="p-4 space-y-4">
              {/* Event info */}
              <div className="text-center">
                <p className="text-xs font-heading text-zinc-500">{selectedEvent.category}</p>
                <p className="text-sm font-heading font-bold text-foreground mt-0.5">{selectedEvent.name}</p>
                <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded bg-primary/10 border border-primary/20">
                  <span className="text-[10px] font-heading text-zinc-400">{selectedOption.name}</span>
                  <span className="text-lg font-heading font-black text-primary">{Number(selectedOption.odds).toFixed(2)}</span>
                </div>
              </div>

              {/* Stake input */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-primary font-bold text-lg">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={stake}
                    onChange={(e) => setStake(e.target.value.replace(/\D/g, ''))}
                    placeholder="0"
                    autoFocus
                    className="flex-1 bg-black/30 border border-primary/20 rounded-lg h-11 px-4 text-white text-base font-heading font-bold text-center focus:border-primary/50 focus:outline-none"
                  />
                </div>

                {/* Chips */}
                <div className="flex gap-1.5 justify-center">
                  {STAKE_CHIPS.map((c) => (
                    <Chip
                      key={c.value}
                      label={c.label}
                      color={c.color}
                      ring={c.ring}
                      selected={stake === String(c.value)}
                      onClick={() => setStake(String(c.value))}
                      size={34}
                    />
                  ))}
                </div>
                <p className="text-[9px] text-zinc-500 font-heading text-center mt-2">
                  Open cap {formatMoney(sportsOpenCap)} total · up to {formatMoney(openStakeRemaining)} more on this slip
                </p>
              </div>

              {/* Returns */}
              {(() => {
                const s = parseInt(stake, 10);
                if (Number.isNaN(s) || s <= 0) return null;
                const totalReturn = Math.floor(s * Number(selectedOption.odds));
                const profit = totalReturn - s;
                return (
                  <div className="text-center py-2 rounded bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[9px] font-heading text-zinc-500 uppercase tracking-wider">Potential Return</p>
                    <p className="text-lg font-heading font-black text-emerald-400">{formatMoney(totalReturn)}</p>
                    <p className="text-[10px] font-heading text-emerald-400/60">Profit: {formatMoney(profit)}</p>
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={placeBet}
                  disabled={placing || stakeExceedsOpenCap}
                  className="flex-1 rounded-lg py-3 text-sm font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-40 active:scale-[0.98] transition-all"
                >
                  {placing ? '...' : 'Place Bet'}
                </button>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="px-5 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-foreground font-heading text-sm font-bold uppercase hover:bg-zinc-700 transition-all"
                >
                  Back
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
