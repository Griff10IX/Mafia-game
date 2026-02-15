import { useState, useEffect, useCallback } from 'react';
import { Trophy, Target, TrendingUp, Clock, Shield, Plus, Circle, CheckCircle, ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { refreshUser } from '../utils/api';
import styles from '../styles/noir.module.css';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (d == null) return fallback;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length > 0) return d.map((x) => x.msg || String(x)).join(' ');
  return fallback;
}

function StatusIcon({ status }) {
  const title = status === 'upcoming' ? 'Upcoming' : status === 'in_play' ? 'In play' : 'Finished';
  if (status === 'in_play') return <Circle size={16} className="text-green-500 fill-green-500 shrink-0" title={title} aria-label={title} />;
  if (status === 'finished') return <CheckCircle size={16} className="text-mutedForeground shrink-0" title={title} aria-label={title} />;
  return <Clock size={16} className="text-mutedForeground shrink-0" title={title} aria-label={title} />;
}

function EventRow({ event, onPlaceBet, isAdmin, onSettle, onCancelEvent, cancellingEventId }) {
  const ev = event;
  const options = ev.options || [];
  const bettingOpen = ev.betting_open !== false;
  const buttons = [];
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    buttons.push(
      <button
        key={opt.id}
        type="button"
        onClick={() => bettingOpen && onPlaceBet(ev, opt)}
        disabled={!bettingOpen}
        className="bg-gradient-to-b from-primary/30 to-primary/10 hover:from-primary/40 hover:to-primary/20 text-primary border border-primary/50 px-2 py-1 rounded-sm text-xs font-heading font-bold transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {opt.name} @ {Number(opt.odds)}
      </button>
    );
  }
  const isCancelling = cancellingEventId === ev.id;
  return (
    <tr className="border-b border-primary/10 hover:bg-zinc-800/30 transition-smooth">
      <td className="py-3 px-4">
        {ev.is_special ? (
          <Trophy size={18} className="text-primary" title="Special game" />
        ) : (
          <StatusIcon status={ev.status} />
        )}
      </td>
      <td className="py-3 px-4 font-heading font-bold text-foreground">{ev.name}</td>
      <td className="py-3 px-4 text-mutedForeground font-heading">{ev.category}</td>
      <td className="py-3 px-4 text-mutedForeground font-heading text-xs">{ev.start_time_display || ev.start_time}</td>
      <td className="py-3 px-4 text-right">
        <div className="flex flex-wrap gap-2 justify-end">
          {buttons}
        </div>
      </td>
      {isAdmin ? (
        <td className="py-3 px-4 text-right">
          <div className="flex flex-wrap gap-1.5 justify-end">
            <button
              type="button"
              onClick={() => onSettle(ev)}
              className="text-xs font-heading font-bold text-amber-400 border border-amber-500/50 hover:bg-amber-500/20 px-2 py-1 rounded-sm transition-smooth"
            >
              Settle
            </button>
            <button
              type="button"
              onClick={() => onCancelEvent(ev)}
              disabled={isCancelling}
              className="text-xs font-heading font-bold text-red-400 border border-red-500/50 hover:bg-red-500/20 px-2 py-1 rounded-sm disabled:opacity-50 transition-smooth"
              title="Cancel event and refund all bets"
            >
              {isCancelling ? '…' : 'Cancel event'}
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

export default function SportsBetting() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [myBets, setMyBets] = useState({ open: [], closed: [] });
  const [stats, setStats] = useState(null);
  const [recentResults, setRecentResults] = useState([]);
  const [placing, setPlacing] = useState(null);
  const [stake, setStake] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [templates, setTemplates] = useState({ categories: [], templates: {} });
  const [adminCategory, setAdminCategory] = useState('Football');
  const [addingTemplateId, setAddingTemplateId] = useState(null);
  const [checkingEvents, setCheckingEvents] = useState(false);
  const [settleEvent, setSettleEvent] = useState(null);
  const [settleWinningId, setSettleWinningId] = useState('');
  const [settling, setSettling] = useState(false);
  const [adminPanelHidden, setAdminPanelHidden] = useState(() => {
    try {
      return localStorage.getItem('sports-betting-admin-hidden') === '1';
    } catch {
      return false;
    }
  });
  const [cancellingBetId, setCancellingBetId] = useState(null);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [cancellingEventId, setCancellingEventId] = useState(null);
  const [customEventName, setCustomEventName] = useState('');
  const [customEventCategory, setCustomEventCategory] = useState('Football');
  const [customEventOptions, setCustomEventOptions] = useState([{ name: '', odds: 2 }, { name: '', odds: 2 }]);
  const [addingCustom, setAddingCustom] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [eventsRes, betsRes, statsRes, resultsRes] = await Promise.all([
        api.get('/sports-betting/events'),
        api.get('/sports-betting/my-bets'),
        api.get('/sports-betting/stats'),
        api.get('/sports-betting/recent-results'),
      ]);
      setEvents(eventsRes.data?.events ?? []);
      setMyBets({ open: betsRes.data?.open ?? [], closed: betsRes.data?.closed ?? [] });
      setStats(statsRes.data ?? null);
      setRecentResults(resultsRes.data?.results ?? []);
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to load sports betting'));
      setEvents([]);
      setMyBets({ open: [], closed: [] });
      setStats(null);
      setRecentResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
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
          if (!cancelled) setTemplates({ categories: tRes.data?.categories ?? [], templates: tRes.data?.templates ?? {} });
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const placeBet = async () => {
    if (!selectedEvent || !selectedOption) return;
    const amount = parseInt(String(stake || '').replace(/\D/g, ''), 10);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid stake');
      return;
    }
    setPlacing(true);
    try {
      await api.post('/sports-betting/bet', {
        event_id: selectedEvent.id,
        option_id: selectedOption.id,
        stake: amount,
      });
      toast.success(`Bet placed: ${formatMoney(amount)} on ${selectedOption.name}`);
      setStake('');
      setSelectedEvent(null);
      setSelectedOption(null);
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Bet failed'));
    } finally {
      setPlacing(false);
    }
  };

  const openBetModal = (event, option) => {
    setSelectedEvent(event);
    setSelectedOption(option);
    setStake('');
  };

  const checkForEvents = async () => {
    setCheckingEvents(true);
    try {
      const res = await api.post('/admin/sports-betting/refresh');
      setTemplates({ categories: res.data?.categories ?? [], templates: res.data?.templates ?? {} });
      toast.success('Events loaded');
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to load events'));
    } finally {
      setCheckingEvents(false);
    }
  };

  const runSettle = async () => {
    if (!settleEvent || !settleWinningId) {
      toast.error('Select the winning option');
      return;
    }
    setSettling(true);
    try {
      await api.post('/admin/sports-betting/settle', { event_id: settleEvent.id, winning_option_id: settleWinningId });
      toast.success('Event settled. Winners paid out.');
      setSettleEvent(null);
      setSettleWinningId('');
      await fetchAll();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to settle'));
    } finally {
      setSettling(false);
    }
  };

  const cancelBet = async (betId) => {
    setCancellingBetId(betId);
    try {
      const res = await api.post('/sports-betting/cancel-bet', { bet_id: betId });
      toast.success(res.data?.message || 'Bet cancelled and refunded');
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to cancel bet'));
    } finally {
      setCancellingBetId(null);
    }
  };

  const cancelAllBets = async () => {
    if (myBets.open.length === 0) return;
    if (!window.confirm(`Cancel all ${myBets.open.length} open bet(s)? Your stakes will be refunded.`)) return;
    setCancellingAll(true);
    try {
      const res = await api.post('/sports-betting/cancel-all-bets');
      toast.success(res.data?.message || 'All bets cancelled and refunded');
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to cancel bets'));
    } finally {
      setCancellingAll(false);
    }
  };

  const cancelEvent = async (ev) => {
    if (!ev || !ev.id) return;
    if (!window.confirm(`Cancel event "${ev.name}"? All bets on this event will be refunded and the event removed.`)) return;
    setCancellingEventId(ev.id);
    try {
      const res = await api.post('/admin/sports-betting/cancel-event', { event_id: ev.id });
      toast.success(res.data?.message || 'Event cancelled, bets refunded');
      await fetchAll();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to cancel event'));
    } finally {
      setCancellingEventId(null);
    }
  };

  const addEventFromTemplate = async (templateId) => {
    setAddingTemplateId(templateId);
    try {
      await api.post('/admin/sports-betting/events', { template_id: templateId });
      toast.success('Live event added');
      await fetchAll();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to add event'));
    } finally {
      setAddingTemplateId(null);
    }
  };

  const addCustomEvent = async () => {
    const name = (customEventName || '').trim();
    if (!name) {
      toast.error('Enter event name');
      return;
    }
    const opts = customEventOptions.map((o) => ({ name: (o.name || '').trim(), odds: Number(o.odds) || 2 })).filter((o) => o.name);
    if (opts.length < 2) {
      toast.error('Add at least 2 options with names');
      return;
    }
    setAddingCustom(true);
    try {
      await api.post('/admin/sports-betting/custom-event', {
        name,
        category: customEventCategory,
        options: opts,
      });
      toast.success('Custom event added');
      setCustomEventName('');
      setCustomEventOptions([{ name: '', odds: 2 }, { name: '', odds: 2 }]);
      await fetchAll();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to add custom event'));
    } finally {
      setAddingCustom(false);
    }
  };

  const setCustomOption = (index, field, value) => {
    setCustomEventOptions((prev) => {
      const next = [...prev];
      if (!next[index]) next[index] = { name: '', odds: 2 };
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addCustomOptionRow = () => {
    setCustomEventOptions((prev) => [...prev, { name: '', odds: 2 }]);
  };

  const removeCustomOptionRow = (index) => {
    setCustomEventOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden />
        <p className="text-mutedForeground text-sm font-heading font-bold">Loading sports betting…</p>
      </div>
    );
  }

  const toggleAdminPanel = (hide) => {
    setAdminPanelHidden(hide);
    try {
      if (hide) localStorage.setItem('sports-betting-admin-hidden', '1');
      else localStorage.removeItem('sports-betting-admin-hidden');
    } catch (_) {}
  };

  const openBetsTotalStake = (() => {
    let n = 0;
    const list = myBets.open || [];
    for (let i = 0; i < list.length; i++) n += Number(list[i].stake || 0);
    return n;
  })();
  const openBetsPotentialReturn = (() => {
    let n = 0;
    const list = myBets.open || [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      n += Math.floor(Number(b.stake || 0) * Number(b.odds || 1));
    }
    return n;
  })();
  const STAKE_PRESETS = [10, 50, 100, 250, 500];

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="sports-betting-page">
      <header>
        <div className="flex items-center justify-center flex-col gap-2 text-center mb-4">
          <div className="flex items-center gap-3 w-full justify-center">
            <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-r from-transparent to-primary/60" />
            <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
              <Target size={24} className="text-primary" />
              Sports Betting
            </h1>
            <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-l from-transparent to-primary/60" />
          </div>
          <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest max-w-xl">
            Bet on live games. Closes 10 min before start; winners paid when settled.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs font-heading text-mutedForeground">
              <span className="text-primary font-bold">{events.length}</span> open events
            </span>
            <span className="text-xs font-heading text-mutedForeground">
              <span className="text-primary font-bold">{myBets.open.length}</span> open bets
            </span>
            {stats && (
              <span className={`text-xs font-heading font-bold ${(stats.profit_loss ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                P/L {formatMoney(stats.profit_loss)}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => fetchAll()}
            className="flex items-center gap-1.5 text-xs font-heading font-bold text-mutedForeground hover:text-primary border border-primary/30 hover:border-primary/50 rounded-sm px-3 py-2 transition-smooth bg-zinc-800/50"
            title="Refresh events and bets"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </header>

      {/* Admin: collapsible live events panel */}
      {isAdmin && (
        <>
          {adminPanelHidden ? (
            <div className={`${styles.panel} rounded-md overflow-hidden`} data-testid="sports-betting-admin">
              <button
                type="button"
                onClick={() => toggleAdminPanel(false)}
                className="w-full px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-heading text-mutedForeground hover:text-primary border-b border-transparent hover:bg-zinc-800/30 transition-smooth"
              >
                <Shield size={16} className="text-primary" />
                <span>Show live events (admin)</span>
                <ChevronDown size={16} />
              </button>
            </div>
          ) : (
            <section className={`${styles.panel} rounded-md overflow-hidden`} data-testid="sports-betting-admin">
              <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Shield size={18} className="text-primary" />
                  <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Add live event</h2>
                </div>
                <button
                  type="button"
                  onClick={() => toggleAdminPanel(true)}
                  className="flex items-center gap-1 text-xs font-heading text-mutedForeground hover:text-primary px-2 py-1 rounded-sm border border-primary/20 hover:border-primary/40 transition-smooth"
                  title="Hide this panel"
                >
                  <ChevronUp size={14} />
                  Hide
                </button>
              </div>
              <div className="p-4">
                <p className="text-xs text-mutedForeground font-heading mb-3">Select a category, then add an event. Events load on demand.</p>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <button
                    type="button"
                    onClick={checkForEvents}
                    disabled={checkingEvents}
                    className="inline-flex items-center gap-2 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-3 py-1.5 rounded-sm text-sm font-heading font-bold border border-yellow-600/50 hover:opacity-90 disabled:opacity-50"
                    data-testid="check-for-events"
                  >
                    {checkingEvents ? 'Checking…' : 'Check for events'}
                  </button>
                  {!checkingEvents && templates.categories.length > 0 && (() => {
                    const total = (templates.templates?.Football?.length || 0) + (templates.templates?.UFC?.length || 0) + (templates.templates?.Boxing?.length || 0) + (templates.templates?.['Formula 1']?.length || 0);
                    if (total === 0) return <span className="text-xs text-mutedForeground font-heading">No events in cache — click to load</span>;
                    return <span className="text-xs text-mutedForeground font-heading">{total} events loaded</span>;
                  })()}
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {(() => {
                    const cats = templates.categories || [];
                    const out = [];
                    for (let i = 0; i < cats.length; i++) {
                      const c = cats[i];
                      out.push(
                        <button
                          key={c}
                          type="button"
                          onClick={() => setAdminCategory(c)}
                          className={`px-3 py-1.5 rounded-sm text-sm font-heading font-bold transition-smooth border ${adminCategory === c ? 'bg-primary/20 text-primary border-primary/50' : 'bg-zinc-800 text-mutedForeground border-primary/20 hover:bg-zinc-700 hover:text-foreground'}`}
                        >
                          {c}
                        </button>
                      );
                    }
                    return out;
                  })()}
                </div>
                <div className="space-y-2">
                  {(() => {
                    const list = templates.templates[adminCategory] || [];
                    if (list.length === 0) {
                      return (
                        <p className="text-sm text-mutedForeground font-heading italic py-6 text-center">
                          {templates.categories.length === 0
                            ? "Click 'Check for events' to load Football, UFC, Boxing (uses free-tier quota)."
                            : `No events in ${adminCategory}. Click 'Check for events' to refresh.`}
                        </p>
                      );
                    }
                    const out = [];
                    for (let i = 0; i < list.length; i++) {
                      const t = list[i];
                      out.push(
                        <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-primary/10 last:border-0">
                          <div>
                            <span className="text-sm font-heading font-bold text-foreground">{t.name}</span>
                            <span className="text-xs text-mutedForeground font-heading ml-2">({(t.options || []).length} options)</span>
                            {t.start_time_display || t.start_time ? (
                              <span className="text-xs text-mutedForeground font-heading ml-2 block mt-0.5">{t.start_time_display || formatDateTime(t.start_time)}</span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => addEventFromTemplate(t.id)}
                            disabled={addingTemplateId !== null}
                            className="inline-flex items-center gap-1 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-3 py-1.5 rounded-sm text-sm font-heading font-bold border border-yellow-600/50 hover:opacity-90 disabled:opacity-50"
                          >
                            <Plus size={14} />
                            {addingTemplateId === t.id ? 'Adding…' : 'Add'}
                          </button>
                        </div>
                      );
                    }
                    return out;
                  })()}
                </div>
                <div className="mt-4 pt-4 border-t border-primary/20">
                  <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest mb-3">Add custom game</h3>
                  <p className="text-xs text-mutedForeground font-heading mb-3">Create a manual event (e.g. football match) when the API has no games.</p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-heading text-mutedForeground mb-1">Event name</label>
                      <input
                        type="text"
                        value={customEventName}
                        onChange={(e) => setCustomEventName(e.target.value)}
                        placeholder="e.g. Team A vs Team B"
                        className="w-full bg-zinc-800 border border-primary/30 rounded-sm px-2 py-1.5 text-sm font-heading text-foreground placeholder:text-mutedForeground"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-heading text-mutedForeground mb-1">Category</label>
                      <select
                        value={customEventCategory}
                        onChange={(e) => setCustomEventCategory(e.target.value)}
                        className="w-full bg-zinc-800 border border-primary/30 rounded-sm px-2 py-1.5 text-sm font-heading text-foreground"
                      >
                        <option value="Football">Football</option>
                        <option value="UFC">UFC</option>
                        <option value="Boxing">Boxing</option>
                        <option value="Formula 1">Formula 1</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-heading text-mutedForeground mb-1">Options (min 2)</label>
                      {customEventOptions.map((opt, idx) => (
                        <div key={idx} className="flex gap-2 mb-2">
                          <input
                            type="text"
                            value={opt.name}
                            onChange={(e) => setCustomOption(idx, 'name', e.target.value)}
                            placeholder="Option name"
                            className="flex-1 bg-zinc-800 border border-primary/30 rounded-sm px-2 py-1.5 text-sm font-heading text-foreground placeholder:text-mutedForeground"
                          />
                          <input
                            type="number"
                            min={1.01}
                            max={100}
                            step={0.01}
                            value={opt.odds}
                            onChange={(e) => setCustomOption(idx, 'odds', e.target.value)}
                            className="w-20 bg-zinc-800 border border-primary/30 rounded-sm px-2 py-1.5 text-sm font-heading text-foreground"
                          />
                          {customEventOptions.length > 2 ? (
                            <button type="button" onClick={() => removeCustomOptionRow(idx)} className="text-red-400 hover:text-red-300 px-1" title="Remove option">×</button>
                          ) : null}
                        </div>
                      ))}
                      <button type="button" onClick={addCustomOptionRow} className="text-xs font-heading text-primary hover:underline">+ Add option</button>
                    </div>
                    <button
                      type="button"
                      onClick={addCustomEvent}
                      disabled={addingCustom}
                      className="inline-flex items-center gap-2 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-3 py-1.5 rounded-sm text-sm font-heading font-bold border border-yellow-600/50 hover:opacity-90 disabled:opacity-50"
                    >
                      {addingCustom ? 'Adding…' : 'Create custom event'}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* Open events */}
      <section className={`${styles.panel} rounded-md overflow-hidden`}>
        <div className="px-4 py-2 bg-zinc-800/50 border-b border-primary/20">
          <h2 className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">Open events</h2>
          <p className="text-xs text-mutedForeground font-heading mt-0.5">
            Current games you can bet on. <span className="text-mutedForeground/80">Clock = upcoming, green = in play, check = finished.</span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-800/50 text-primary/80">
                <th className="text-left py-2.5 px-4 w-10 text-xs font-heading font-bold uppercase tracking-wider" aria-label="Status" title="Status: upcoming / in play / finished">Status</th>
                <th className="text-left py-2.5 px-4 font-heading font-bold uppercase tracking-wider">Event</th>
                <th className="text-left py-2.5 px-4 font-heading font-bold uppercase tracking-wider">Category</th>
                <th className="text-left py-2.5 px-4 font-heading font-bold uppercase tracking-wider">Start time</th>
                <th className="text-right py-2.5 px-4 font-heading font-bold uppercase tracking-wider">Options</th>
                {isAdmin ? <th className="text-right py-2.5 px-4 font-heading font-bold uppercase tracking-wider">Admin</th> : null}
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="py-10 text-center text-mutedForeground font-heading">
                    <p className="font-bold">No open events right now.</p>
                    <p className="text-xs mt-1">New events are added by staff. Check back later or refresh the page.</p>
                  </td>
                </tr>
              ) : (
                (() => {
                  const rows = [];
                  for (let i = 0; i < events.length; i++) {
                    const ev = events[i];
                    rows.push(
                      <EventRow
                        key={ev.id}
                        event={ev}
                        onPlaceBet={openBetModal}
                        isAdmin={isAdmin}
                        onSettle={(e) => {
                          setSettleEvent(e);
                          const first = (e.options && e.options[0]) ? e.options[0].id : '';
                          setSettleWinningId(first);
                        }}
                        onCancelEvent={cancelEvent}
                        cancellingEventId={cancellingEventId}
                      />
                    );
                  }
                  return rows;
                })()
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Admin: Settle event modal */}
      {settleEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => { setSettleEvent(null); setSettleWinningId(''); }}>
          <div className={`${styles.panel} rounded-md p-6 w-full max-w-sm shadow-xl`} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Settle event</h3>
            <p className="text-sm text-mutedForeground font-heading mt-1">{settleEvent.name}</p>
            <p className="text-xs text-mutedForeground font-heading mt-2">Select winning outcome (winners paid automatically):</p>
            <div className="mt-3 space-y-2">
              {(() => {
                const opts = settleEvent.options || [];
                const out = [];
                for (let i = 0; i < opts.length; i++) {
                  const o = opts[i];
                  out.push(
                    <label key={o.id} className="flex items-center gap-2 cursor-pointer font-heading">
                      <input
                        type="radio"
                        name="settleWinner"
                        checked={settleWinningId === o.id}
                        onChange={() => setSettleWinningId(o.id)}
                        className="rounded-sm border-primary/30 accent-primary"
                      />
                      <span className="text-sm text-foreground">{o.name} @ {Number(o.odds)}</span>
                    </label>
                  );
                }
                return out;
              })()}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={runSettle}
                disabled={settling || !settleWinningId}
                className="flex-1 bg-amber-600/90 text-white py-2 rounded-sm font-heading font-bold hover:bg-amber-500 disabled:opacity-50 border border-amber-500/50"
              >
                {settling ? 'Settling…' : 'Settle & pay winners'}
              </button>
              <button
                type="button"
                onClick={() => { setSettleEvent(null); setSettleWinningId(''); }}
                className="px-4 py-2 bg-zinc-800 border border-primary/30 rounded-sm text-foreground font-heading hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Place bet modal */}
      {selectedEvent && selectedOption && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedEvent(null)}>
          <div className={`${styles.panel} rounded-md p-6 w-full max-w-sm shadow-xl`} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Place bet</h3>
            <p className="text-sm text-mutedForeground font-heading mt-1">{selectedEvent.name} · {selectedOption.name} @ {Number(selectedOption.odds)}</p>
            <div className="mt-4">
              <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1">Stake ($)</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {STAKE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setStake(String(preset))}
                    className="px-3 py-1.5 text-xs font-heading font-bold bg-zinc-800 hover:bg-primary/20 text-foreground border border-primary/30 rounded-sm transition-smooth"
                  >
                    ${preset}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={stake}
                onChange={(e) => setStake(e.target.value.replace(/\D/g, ''))}
                placeholder="0"
                className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm px-3 py-2 font-heading text-foreground focus:border-primary/50 focus:outline-none placeholder:text-mutedForeground"
              />
              {(() => {
                const s = parseInt(stake, 10);
                if (Number.isNaN(s) || s <= 0) return null;
                const totalReturn = Math.floor(s * Number(selectedOption.odds));
                return (
                  <p className="text-sm text-primary font-heading font-bold mt-2">Potential winnings: {formatMoney(totalReturn)}</p>
                );
              })()}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={placeBet}
                disabled={placing}
                className="flex-1 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground py-2 rounded-sm font-heading font-bold border border-yellow-600/50 hover:opacity-90 disabled:opacity-50"
              >
                {placing ? 'Placing…' : 'Place bet'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 bg-zinc-800 border border-primary/30 rounded-sm text-foreground font-heading hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Open bets */}
        <section className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-4 py-2 bg-zinc-800/50 border-b border-primary/20 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">Open bets</h2>
              <p className="text-xs text-mutedForeground font-heading mt-0.5">
                Your active bets.
                {myBets.open.length > 0 && (
                  <span className="block mt-1 font-heading font-bold text-foreground">
                    At risk: {formatMoney(openBetsTotalStake)} · Return: {formatMoney(openBetsPotentialReturn)}
                  </span>
                )}
              </p>
            </div>
            {myBets.open.length > 0 && (
              <button
                type="button"
                onClick={cancelAllBets}
                disabled={cancellingAll}
                className="text-xs font-heading font-bold text-red-400 border border-red-500/50 hover:bg-red-500/20 px-2 py-1.5 rounded-sm disabled:opacity-50 transition-smooth"
              >
                {cancellingAll ? 'Cancelling…' : 'Cancel all'}
              </button>
            )}
          </div>
          <div className="p-4 min-h-[120px]">
            {myBets.open.length === 0 ? (
              <p className="text-sm text-mutedForeground font-heading italic py-6 text-center">You have no open bets. Pick an outcome above to place a bet.</p>
            ) : (
              <ul className="space-y-0">
                {(() => {
                  const items = [];
                  const list = myBets.open;
                  for (let i = 0; i < list.length; i++) {
                    const b = list[i];
                    const stakeNum = Number(b.stake || 0);
                    const returnNum = Math.floor(stakeNum * Number(b.odds || 1));
                    const isCancelling = cancellingBetId === b.id;
                    items.push(
                      <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 border-b border-primary/10 last:border-0 text-sm font-heading">
                        <span className="text-foreground flex-1 min-w-0 font-bold">{b.event_name} · {b.option_name} @ {Number(b.odds)}</span>
                        <span className="text-primary font-bold text-right shrink-0">
                          Bet: {formatMoney(b.stake)} · Return: {formatMoney(returnNum)}
                        </span>
                        <button
                          type="button"
                          onClick={() => cancelBet(b.id)}
                          disabled={isCancelling || cancellingAll}
                          className="shrink-0 text-red-400 hover:bg-red-500/20 p-1 rounded-sm border border-transparent hover:border-red-500/40 disabled:opacity-50 transition-smooth"
                          title="Cancel bet and get refund"
                        >
                          <X size={14} />
                        </button>
                      </li>
                    );
                  }
                  return items;
                })()}
              </ul>
            )}
          </div>
        </section>

        {/* Closed bets */}
        <section className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-4 py-2 bg-zinc-800/50 border-b border-primary/20">
            <h2 className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">Closed bets</h2>
            <p className="text-xs text-mutedForeground font-heading mt-0.5">Your settled bets.</p>
          </div>
          <div className="p-4 min-h-[120px]">
            {myBets.closed.length === 0 ? (
              <p className="text-sm text-mutedForeground font-heading italic py-6 text-center">You have no closed bets.</p>
            ) : (
              <ul className="space-y-0">
                {(() => {
                  const items = [];
                  const list = myBets.closed;
                  for (let i = 0; i < list.length; i++) {
                    const b = list[i];
                    const stakeNum = Number(b.stake || 0);
                    const oddsNum = Number(b.odds || 1);
                    const payout = b.status === 'won' ? Math.floor(stakeNum * oddsNum) : 0;
                    const profit = b.status === 'won' ? payout - stakeNum : -stakeNum;
                    items.push(
                      <li key={b.id} className="flex justify-between items-center py-2.5 border-b border-primary/10 last:border-0 text-sm font-heading gap-2">
                        <span className="text-foreground truncate font-bold">{b.event_name} · {b.option_name}</span>
                        <span className={`shrink-0 font-bold ${b.status === 'won' ? 'text-emerald-400' : 'text-mutedForeground'}`}>
                          {b.status === 'won' ? `+${formatMoney(profit)}` : `-${formatMoney(stakeNum)}`}
                        </span>
                      </li>
                    );
                  }
                  return items;
                })()}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Stats */}
        <section className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center gap-2">
            <TrendingUp size={16} className="text-primary" />
            <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Betting statistics</h2>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
          <div className="divide-y divide-primary/10">
            {(() => {
              const statRows = [
                { label: 'Total bets placed', value: stats?.total_bets_placed ?? 0 },
                { label: 'Total bets won', value: `${stats?.total_bets_won ?? 0} (${stats?.win_pct ?? 0}%)` },
                { label: 'Total bets lost', value: stats?.total_bets_lost ?? 0 },
                { label: 'Profit / loss', value: formatMoney(stats?.profit_loss), valueClass: (stats?.profit_loss ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
              ];
              const out = [];
              for (let i = 0; i < statRows.length; i++) {
                const r = statRows[i];
                out.push(
                  <div key={r.label} className="grid grid-cols-12 px-4 py-2.5 text-sm font-heading hover:bg-zinc-800/30 transition-smooth">
                    <div className="col-span-7 text-mutedForeground">{r.label}</div>
                    <div className={`col-span-5 text-right font-bold ${r.valueClass || 'text-foreground'}`}>{r.value}</div>
                  </div>
                );
              }
              return out;
            })()}
          </div>
        </section>

        {/* Recent results */}
        <section className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-4 py-2 bg-zinc-800/50 border-b border-primary/20 flex items-center gap-2">
            <Clock size={16} className="text-primary" />
            <h2 className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">Recent results</h2>
            <p className="text-xs text-mutedForeground font-heading ml-auto">Last 25 settled</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-800/50 text-primary/80">
                  <th className="w-1 shrink py-2" aria-label="Result" />
                  <th className="text-left py-2 px-4 font-heading font-bold uppercase tracking-wider">Option</th>
                  <th className="text-left py-2 px-4 font-heading font-bold uppercase tracking-wider">Odds</th>
                  <th className="text-left py-2 px-4 font-heading font-bold uppercase tracking-wider">Result</th>
                  <th className="text-right py-2 px-4 font-heading font-bold uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentResults.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-mutedForeground text-sm font-heading">No results yet.</td>
                  </tr>
                ) : (
                  (() => {
                    const rows = [];
                    for (let i = 0; i < recentResults.length; i++) {
                      const r = recentResults[i];
                      rows.push(
                        <tr key={i} className="border-b border-primary/10 hover:bg-zinc-800/30 transition-smooth">
                          <td className="w-1 shrink py-2">
                            <span className={`block w-1 h-10 rounded-full ${r.result === 'won' ? 'bg-emerald-500' : 'bg-red-500/80'}`} />
                          </td>
                          <td className="py-2 px-4 text-foreground font-heading font-bold">{r.betting_option}</td>
                          <td className="py-2 px-4 font-heading text-mutedForeground">{Number(r.odds)}</td>
                          <td className="py-2 px-4">
                            <span className={r.result === 'won' ? 'text-emerald-400 font-heading font-bold' : 'text-mutedForeground font-heading'}>{r.result === 'won' ? 'Win' : 'Lose'}</span>
                          </td>
                          <td className="py-2 px-4 text-right text-mutedForeground text-xs font-heading">{formatDateTime(r.date)}</td>
                        </tr>
                      );
                    }
                    return rows;
                  })()
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
