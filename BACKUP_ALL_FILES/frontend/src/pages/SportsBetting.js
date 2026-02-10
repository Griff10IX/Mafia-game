import { useState, useEffect, useCallback } from 'react';
import { Trophy, Target, TrendingUp, Clock, Shield, Plus, Circle, CheckCircle, ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { refreshUser } from '../utils/api';

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
        className="bg-primary/15 hover:bg-primary/25 text-primary border border-primary/40 px-2 py-1 rounded-sm text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {opt.name} @ {Number(opt.odds)}
      </button>
    );
  }
  const isCancelling = cancellingEventId === ev.id;
  return (
    <tr className="hover:bg-background/50">
      <td className="py-3 px-4">
        {ev.is_special ? (
          <Trophy size={18} className="text-primary" title="Special game" />
        ) : (
          <StatusIcon status={ev.status} />
        )}
      </td>
      <td className="py-3 px-4 font-medium text-foreground">{ev.name}</td>
      <td className="py-3 px-4 text-mutedForeground">{ev.category}</td>
      <td className="py-3 px-4 text-mutedForeground font-mono text-xs">{ev.start_time_display || ev.start_time}</td>
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
              className="text-xs font-semibold text-amber-600 hover:text-amber-500 border border-amber-500/50 hover:bg-amber-500/10 px-2 py-1 rounded-sm"
            >
              Settle
            </button>
            <button
              type="button"
              onClick={() => onCancelEvent(ev)}
              disabled={isCancelling}
              className="text-xs font-semibold text-red-600 hover:text-red-500 border border-red-500/50 hover:bg-red-500/10 px-2 py-1 rounded-sm disabled:opacity-50"
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden />
        <p className="text-mutedForeground text-sm font-medium">Loading sports betting…</p>
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
    <div className="space-y-6" data-testid="sports-betting-page">
      <header className="border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-mutedForeground">Casino</p>
            <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground mt-1 flex items-center gap-2">
              <Target size={24} className="text-primary" />
              Sports Betting
            </h1>
            <p className="text-sm text-mutedForeground mt-1">
              Bet on live games. Betting closes 10 minutes before start; winners are paid automatically when the event is settled.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchAll()}
            className="flex items-center gap-1.5 text-xs text-mutedForeground hover:text-foreground border border-border hover:border-primary/40 rounded-sm px-3 py-2 transition-colors"
            title="Refresh events and bets"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-border/60">
          <span className="text-xs text-mutedForeground">
            <strong className="text-foreground font-semibold">{events.length}</strong> open events
          </span>
          <span className="text-xs text-mutedForeground">
            <strong className="text-foreground font-semibold">{myBets.open.length}</strong> open bets
          </span>
          {stats && (
            <span className={`text-xs font-semibold ${(stats.profit_loss ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              P/L {formatMoney(stats.profit_loss)}
            </span>
          )}
        </div>
      </header>

      {/* Admin: collapsible live events panel */}
      {isAdmin && (
        <>
          {adminPanelHidden ? (
            <div className="bg-card border border-border rounded-sm overflow-hidden" data-testid="sports-betting-admin">
              <button
                type="button"
                onClick={() => toggleAdminPanel(false)}
                className="w-full px-4 py-2.5 flex items-center justify-center gap-2 text-sm text-mutedForeground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <Shield size={16} className="text-primary" />
                <span>Show live events (admin)</span>
                <ChevronDown size={16} />
              </button>
            </div>
          ) : (
            <section className="bg-card border border-border rounded-sm overflow-hidden" data-testid="sports-betting-admin">
              <div className="px-4 py-2.5 bg-secondary/40 border-b border-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Shield size={18} className="text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Add live event</h2>
                </div>
                <button
                  type="button"
                  onClick={() => toggleAdminPanel(true)}
                  className="flex items-center gap-1 text-xs text-mutedForeground hover:text-foreground px-2 py-1 rounded-sm border border-transparent hover:border-border transition-colors"
                  title="Hide this panel"
                >
                  <ChevronUp size={14} />
                  Hide
                </button>
              </div>
              <div className="p-4">
                <p className="text-xs text-mutedForeground mb-3">Select a category, then add an event. Events load on demand to save API quota.</p>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <button
                    type="button"
                    onClick={checkForEvents}
                    disabled={checkingEvents}
                    className="inline-flex items-center gap-2 bg-primary text-primaryForeground px-3 py-1.5 rounded-sm text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                    data-testid="check-for-events"
                  >
                    {checkingEvents ? 'Checking…' : 'Check for events'}
                  </button>
                  {!checkingEvents && templates.categories.length > 0 && (() => {
                    const total = (templates.templates?.Football?.length || 0) + (templates.templates?.UFC?.length || 0) + (templates.templates?.Boxing?.length || 0) + (templates.templates?.['Formula 1']?.length || 0);
                    if (total === 0) return <span className="text-xs text-mutedForeground">No events in cache — click to load</span>;
                    return <span className="text-xs text-mutedForeground">{total} events loaded</span>;
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
                          className={`px-3 py-1.5 rounded-sm text-sm font-medium transition-colors ${adminCategory === c ? 'bg-primary text-primaryForeground' : 'bg-secondary text-foreground hover:bg-secondary/80'}`}
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
                        <p className="text-sm text-mutedForeground italic py-6 text-center">
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
                        <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-border last:border-0">
                          <div>
                            <span className="text-sm font-medium text-foreground">{t.name}</span>
                            <span className="text-xs text-mutedForeground ml-2">({(t.options || []).length} options)</span>
                            {t.start_time_display || t.start_time ? (
                              <span className="text-xs text-mutedForeground ml-2 block mt-0.5">{t.start_time_display || formatDateTime(t.start_time)}</span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => addEventFromTemplate(t.id)}
                            disabled={addingTemplateId !== null}
                            className="inline-flex items-center gap-1 bg-primary text-primaryForeground px-3 py-1.5 rounded-sm text-sm font-semibold hover:opacity-90 disabled:opacity-50"
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
              </div>
            </section>
          )}
        </>
      )}

      {/* Open events */}
      <section className="bg-card border border-border rounded-sm overflow-hidden">
        <div className="px-4 py-2.5 bg-secondary/40 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Open events</h2>
          <p className="text-xs text-mutedForeground mt-0.5">
            Current games you can bet on. <span className="text-mutedForeground/80">Status: clock = upcoming, green = in play, check = finished.</span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                <th className="text-left py-3 px-4 w-10 text-mutedForeground" aria-label="Status" title="Status: upcoming / in play / finished">Status</th>
                <th className="text-left py-3 px-4 font-semibold text-foreground">Event</th>
                <th className="text-left py-3 px-4 font-semibold text-foreground">Category</th>
                <th className="text-left py-3 px-4 font-semibold text-foreground">Start time</th>
                <th className="text-right py-3 px-4 font-semibold text-foreground">Options</th>
                {isAdmin ? <th className="text-right py-3 px-4 font-semibold text-foreground">Admin</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="py-10 text-center text-mutedForeground">
                    <p className="font-medium">No open events right now.</p>
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
          <div className="bg-card border border-border rounded-sm p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-heading font-semibold text-foreground">Settle event</h3>
            <p className="text-sm text-mutedForeground mt-1">{settleEvent.name}</p>
            <p className="text-xs text-mutedForeground mt-2">Select winning outcome (winners will be paid automatically):</p>
            <div className="mt-3 space-y-2">
              {(() => {
                const opts = settleEvent.options || [];
                const out = [];
                for (let i = 0; i < opts.length; i++) {
                  const o = opts[i];
                  out.push(
                    <label key={o.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="settleWinner"
                        checked={settleWinningId === o.id}
                        onChange={() => setSettleWinningId(o.id)}
                        className="rounded-sm border-border"
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
                className="flex-1 bg-amber-600 text-white py-2 rounded-sm font-semibold hover:bg-amber-500 disabled:opacity-50"
              >
                {settling ? 'Settling…' : 'Settle & pay winners'}
              </button>
              <button
                type="button"
                onClick={() => { setSettleEvent(null); setSettleWinningId(''); }}
                className="px-4 py-2 border border-border rounded-sm text-foreground hover:bg-secondary"
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
          <div className="bg-card border border-border rounded-sm p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-heading font-semibold text-foreground">Place bet</h3>
            <p className="text-sm text-mutedForeground mt-1">{selectedEvent.name} · {selectedOption.name} @ {Number(selectedOption.odds)}</p>
            <div className="mt-4">
              <label className="block text-xs text-mutedForeground mb-1">Stake ($)</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {STAKE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setStake(String(preset))}
                    className="px-3 py-1.5 text-xs font-mono bg-secondary hover:bg-primary/20 text-foreground border border-border rounded-sm transition-colors"
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
                className="w-full bg-background border border-border rounded-sm px-3 py-2 font-mono text-foreground"
              />
              {(() => {
                const s = parseInt(stake, 10);
                if (Number.isNaN(s) || s <= 0) return null;
                const totalReturn = Math.floor(s * Number(selectedOption.odds));
                return (
                  <p className="text-sm text-primary font-semibold mt-2">Potential winnings: {formatMoney(totalReturn)}</p>
                );
              })()}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={placeBet}
                disabled={placing}
                className="flex-1 bg-primary text-primaryForeground py-2 rounded-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {placing ? 'Placing…' : 'Place bet'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 border border-border rounded-sm text-foreground hover:bg-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Open bets */}
        <section className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-secondary/40 border-b border-border flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Open bets</h2>
              <p className="text-xs text-mutedForeground mt-0.5">
                Your active bets.
                {myBets.open.length > 0 && (
                  <span className="block mt-1 font-mono text-foreground/90">
                    At risk: {formatMoney(openBetsTotalStake)} · Potential return: {formatMoney(openBetsPotentialReturn)}
                  </span>
                )}
              </p>
            </div>
            {myBets.open.length > 0 && (
              <button
                type="button"
                onClick={cancelAllBets}
                disabled={cancellingAll}
                className="text-xs font-semibold text-red-600 hover:text-red-500 border border-red-500/50 hover:bg-red-500/10 px-2 py-1.5 rounded-sm disabled:opacity-50"
              >
                {cancellingAll ? 'Cancelling…' : 'Cancel all'}
              </button>
            )}
          </div>
          <div className="p-4 min-h-[120px]">
            {myBets.open.length === 0 ? (
              <p className="text-sm text-mutedForeground italic py-6 text-center">You have no open bets. Pick an outcome above to place a bet.</p>
            ) : (
              <ul className="space-y-2">
                {(() => {
                  const items = [];
                  const list = myBets.open;
                  for (let i = 0; i < list.length; i++) {
                    const b = list[i];
                    const stakeNum = Number(b.stake || 0);
                    const returnNum = Math.floor(stakeNum * Number(b.odds || 1));
                    const isCancelling = cancellingBetId === b.id;
                    items.push(
                      <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-border last:border-0 text-sm">
                        <span className="text-foreground flex-1 min-w-0">{b.event_name} · {b.option_name} @ {Number(b.odds)}</span>
                        <span className="font-mono text-primary text-right shrink-0">
                          Bet: {formatMoney(b.stake)} · Return: {formatMoney(returnNum)}
                        </span>
                        <button
                          type="button"
                          onClick={() => cancelBet(b.id)}
                          disabled={isCancelling || cancellingAll}
                          className="shrink-0 text-red-600 hover:text-red-500 p-1 rounded-sm border border-transparent hover:border-red-500/40 disabled:opacity-50"
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
        <section className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-secondary/40 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Closed bets</h2>
            <p className="text-xs text-mutedForeground mt-0.5">Your settled bets.</p>
          </div>
          <div className="p-4 min-h-[120px]">
            {myBets.closed.length === 0 ? (
              <p className="text-sm text-mutedForeground italic py-6 text-center">You have no closed bets.</p>
            ) : (
              <ul className="space-y-2">
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
                      <li key={b.id} className="flex justify-between items-center py-2 border-b border-border last:border-0 text-sm gap-2">
                        <span className="text-foreground truncate">{b.event_name} · {b.option_name}</span>
                        <span className={`shrink-0 font-mono font-semibold ${b.status === 'won' ? 'text-emerald-500' : 'text-mutedForeground'}`}>
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
        <section className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-secondary/40 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp size={16} className="text-primary" /> Betting statistics
            </h2>
            <p className="text-xs text-mutedForeground mt-0.5">Your personal stats.</p>
          </div>
          <div className="divide-y divide-border">
            {(() => {
              const statRows = [
                { label: 'Total bets placed', value: stats?.total_bets_placed ?? 0 },
                { label: 'Total bets won', value: `${stats?.total_bets_won ?? 0} (${stats?.win_pct ?? 0}%)` },
                { label: 'Total bets lost', value: stats?.total_bets_lost ?? 0 },
                { label: 'Profit / loss', value: formatMoney(stats?.profit_loss), valueClass: (stats?.profit_loss ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500' },
              ];
              const out = [];
              for (let i = 0; i < statRows.length; i++) {
                const r = statRows[i];
                out.push(
                  <div key={r.label} className="grid grid-cols-12 px-4 py-3 text-sm">
                    <div className="col-span-7 text-mutedForeground">{r.label}</div>
                    <div className={`col-span-5 text-right font-mono font-semibold ${r.valueClass || 'text-foreground'}`}>{r.value}</div>
                  </div>
                );
              }
              return out;
            })()}
          </div>
        </section>

        {/* Recent results */}
        <section className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-secondary/40 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Clock size={16} className="text-primary" /> Recent results
            </h2>
            <p className="text-xs text-mutedForeground mt-0.5">Last 25 settled bets.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/20">
                  <th className="w-1 shrink" aria-label="Result" />
                  <th className="text-left py-2 px-4 font-semibold text-foreground">Option</th>
                  <th className="text-left py-2 px-4 font-semibold text-foreground">Odds</th>
                  <th className="text-left py-2 px-4 font-semibold text-foreground">Result</th>
                  <th className="text-right py-2 px-4 font-semibold text-foreground">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentResults.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-mutedForeground text-sm">No results yet.</td>
                  </tr>
                ) : (
                  (() => {
                    const rows = [];
                    for (let i = 0; i < recentResults.length; i++) {
                      const r = recentResults[i];
                      rows.push(
                        <tr key={i} className="hover:bg-background/30">
                          <td className="w-1 shrink py-2">
                            <span className={`block w-1 h-10 rounded-full ${r.result === 'won' ? 'bg-emerald-500' : 'bg-red-500/80'}`} />
                          </td>
                          <td className="py-2 px-4 text-foreground">{r.betting_option}</td>
                          <td className="py-2 px-4 font-mono text-mutedForeground">{Number(r.odds)}</td>
                          <td className="py-2 px-4">
                            <span className={r.result === 'won' ? 'text-emerald-500 font-semibold' : 'text-mutedForeground'}>{r.result === 'won' ? 'Win' : 'Lose'}</span>
                          </td>
                          <td className="py-2 px-4 text-right text-mutedForeground text-xs">{formatDateTime(r.date)}</td>
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
