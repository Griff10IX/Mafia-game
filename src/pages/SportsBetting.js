import { useState, useEffect, useCallback } from 'react';
import { Trophy, Target, TrendingUp, Clock, Shield, Plus, ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { refreshUser } from '../utils/api';
import styles from '../styles/noir.module.css';

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
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (d == null) return fallback;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length > 0) return d.map((x) => x.msg || String(x)).join(' ');
  return fallback;
}

const STAKE_CHIPS = [
  { label: '10K', value: 10_000, color: '#e4e4e7', ring: '#a1a1aa' },
  { label: '100K', value: 100_000, color: '#dc2626', ring: '#991b1b' },
  { label: '1M', value: 1_000_000, color: '#16a34a', ring: '#166534' },
  { label: '5M', value: 5_000_000, color: '#18181b', ring: '#52525b' },
  { label: '10M', value: 10_000_000, color: '#7c3aed', ring: '#5b21b6' },
];

const CATEGORY_ICONS = { Football: '⚽', UFC: '🥊', Boxing: '🥊', 'Formula 1': '🏎️' };

function StatusDot({ status }) {
  if (status === 'in_play') return <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] inline-block" title="In play" />;
  if (status === 'finished') return <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" title="Finished" />;
  return <span className="w-2 h-2 rounded-full bg-amber-400/70 inline-block" title="Upcoming" />;
}

/* ═══════════════════════════════════════════════════════
   Event Card — themed panel
   ═══════════════════════════════════════════════════════ */
function EventCard({ event, onPlaceBet, isAdmin, onSettle, onCancelEvent, cancellingEventId }) {
  const options = event.options || [];
  const bettingOpen = event.betting_open !== false;
  const icon = CATEGORY_ICONS[event.category] || '🎲';

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
      </div>

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
        <div className="px-3 pb-2 pt-1 flex gap-1.5 justify-end border-t border-primary/10">
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
        boxShadow: selected ? '0 0 0 2px #d4af37, 0 4px 12px rgba(0,0,0,0.4)' : '0 2px 6px rgba(0,0,0,0.3)',
        color: color === '#e4e4e7' || color === '#16a34a' ? '#000' : '#fff',
        fontSize: Math.max(8, size * 0.24),
      }}
    >
      <span className="relative z-10 drop-shadow-sm">{label}</span>
      <div
        className="absolute rounded-full pointer-events-none"
        style={{ inset: 4, border: `1.5px solid ${selected ? '#d4af37' : 'rgba(255,255,255,0.2)'}` }}
      />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════ */
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
    try { return localStorage.getItem('sports-betting-admin-hidden') === '1'; } catch { return false; }
  });
  const [cancellingBetId, setCancellingBetId] = useState(null);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [cancellingEventId, setCancellingEventId] = useState(null);
  const [customEventName, setCustomEventName] = useState('');
  const [customEventCategory, setCustomEventCategory] = useState('Football');
  const [customEventOptions, setCustomEventOptions] = useState([{ name: '', odds: 2 }, { name: '', odds: 2 }]);
  const [addingCustom, setAddingCustom] = useState(false);
  const [activeTab, setActiveTab] = useState('events');

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
      toast.error(apiErrorDetail(e, 'Failed to load'));
      setEvents([]); setMyBets({ open: [], closed: [] }); setStats(null); setRecentResults([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

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
      } catch { if (!cancelled) setIsAdmin(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const placeBet = async () => {
    if (!selectedEvent || !selectedOption) return;
    const amount = parseInt(String(stake || '').replace(/\D/g, ''), 10);
    if (!amount || amount <= 0) { toast.error('Enter a valid stake'); return; }
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
      setTemplates({ categories: res.data?.categories ?? [], templates: res.data?.templates ?? {} });
      toast.success('Events loaded');
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setCheckingEvents(false); }
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
    try { await api.post('/admin/sports-betting/events', { template_id: templateId }); toast.success('Event added'); await fetchAll(); }
    catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setAddingTemplateId(null); }
  };

  const addCustomEvent = async () => {
    const name = (customEventName || '').trim();
    if (!name) { toast.error('Enter event name'); return; }
    const opts = customEventOptions.map((o) => ({ name: (o.name || '').trim(), odds: Number(o.odds) || 2 })).filter((o) => o.name);
    if (opts.length < 2) { toast.error('Need at least 2 options'); return; }
    setAddingCustom(true);
    try {
      await api.post('/admin/sports-betting/custom-event', { name, category: customEventCategory, options: opts });
      toast.success('Custom event added'); setCustomEventName(''); setCustomEventOptions([{ name: '', odds: 2 }, { name: '', odds: 2 }]); await fetchAll();
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

  const openBetsTotalStake = (myBets.open || []).reduce((s, b) => s + Number(b.stake || 0), 0);
  const openBetsPotentialReturn = (myBets.open || []).reduce((s, b) => s + Math.floor(Number(b.stake || 0) * Number(b.odds || 1)), 0);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Trophy size={28} className="text-primary/40 animate-pulse" />
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading the book...</span>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="sports-betting-page">
      <style>{SB_STYLES}</style>
      <style>{`
        @keyframes sb-slide-up { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes sb-pulse-gold { 0%, 100% { box-shadow: 0 0 8px rgba(212,175,55,0.15); } 50% { box-shadow: 0 0 20px rgba(212,175,55,0.35); } }
        .animate-sb-fade-in { animation: sb-fade-in 0.3s ease-out backwards; }
        .animate-sb-slide-up { animation: sb-slide-up 0.4s cubic-bezier(0.2, 0.8, 0.3, 1) forwards; }
        .animate-sb-pulse-gold { animation: sb-pulse-gold 2s ease-in-out infinite; }
      `}</style>

      {/* Page header */}
      <div className="relative sb-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Sports</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">The Book</h1>
        <p className="text-[10px] text-zinc-500 font-heading italic">Underground — closes 10 min before start</p>
      </div>

      {/* ═══ Stats bar ═══ */}
      <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-primary/20 bg-primary/5 overflow-hidden">
        <div className="h-0.5 absolute top-0 left-0 right-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="flex flex-wrap items-center gap-4 text-[10px] font-heading uppercase tracking-wider">
          <span className="text-zinc-500">{events.length} <span className="text-zinc-600">events</span></span>
          <span className="text-zinc-500">{myBets.open.length} <span className="text-zinc-600">open bets</span></span>
          {stats && (
            <span className={`font-bold ${(stats.profit_loss ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              P/L {formatMoney(stats.profit_loss)}
            </span>
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
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 sb-fade-in`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-primary" />
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Admin — Add Events</span>
              </div>
              <button onClick={() => toggleAdminPanel(true)} className="text-[10px] font-heading text-zinc-500 hover:text-primary flex items-center gap-1"><ChevronUp size={12} /> Hide</button>
            </div>
            <div className="p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={checkForEvents} disabled={checkingEvents} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase border border-yellow-600/50 disabled:opacity-50">
                  {checkingEvents ? 'Checking...' : 'Check for events'}
                </button>
                {(() => { const total = Object.values(templates.templates || {}).reduce((s, arr) => s + (arr?.length || 0), 0); return total > 0 ? <span className="text-[10px] text-zinc-500 font-heading">{total} loaded</span> : null; })()}
              </div>

              {/* Category tabs */}
              <div className="flex flex-wrap gap-1">
                {(templates.categories || []).map((c) => (
                  <button key={c} onClick={() => setAdminCategory(c)} className={`px-2 py-1 rounded text-[10px] font-heading font-bold transition-all ${adminCategory === c ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-zinc-800/50 text-zinc-500 border border-zinc-700/30 hover:text-zinc-300'}`}>
                    {c}
                  </button>
                ))}
              </div>

              {/* Template list */}
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(templates.templates?.[adminCategory] || []).length === 0 ? (
                  <p className="text-[10px] text-zinc-600 font-heading py-4 text-center">No events — click Check for events</p>
                ) : (templates.templates[adminCategory] || []).map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-zinc-800/50 last:border-0">
                    <div className="min-w-0 flex-1">
                      <span className="text-[11px] font-heading text-foreground truncate block">{t.name}</span>
                      {(t.start_time_display || t.start_time) && <span className="text-[9px] text-zinc-600 font-heading">{t.start_time_display || formatDateTime(t.start_time)}</span>}
                    </div>
                    <button onClick={() => addEventFromTemplate(t.id)} disabled={addingTemplateId !== null} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[9px] font-heading font-bold border border-yellow-600/50 disabled:opacity-50 flex items-center gap-1">
                      <Plus size={10} /> {addingTemplateId === t.id ? '...' : 'Add'}
                    </button>
                  </div>
                ))}
              </div>

              {/* Custom event */}
              <div className="pt-2 border-t border-zinc-800/50 space-y-2">
                <span className="text-[9px] font-heading text-primary uppercase tracking-widest font-bold">Custom event</span>
                <input type="text" value={customEventName} onChange={(e) => setCustomEventName(e.target.value)} placeholder="Event name" className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none" />
                <select value={customEventCategory} onChange={(e) => setCustomEventCategory(e.target.value)} className="w-full bg-zinc-900/50 border border-zinc-700/30 rounded px-2 py-1.5 text-[11px] text-foreground font-heading focus:border-primary/50 focus:outline-none">
                  {['Football', 'UFC', 'Boxing', 'Formula 1'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
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
                  <button onClick={addCustomEvent} disabled={addingCustom} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase border border-yellow-600/50 disabled:opacity-50">
                    {addingCustom ? '...' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
            <div className="sb-art-line text-primary mx-3" />
          </div>
        )
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
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Open Bets</span>
                {myBets.open.length > 0 && (
                  <span className="text-[9px] font-heading text-zinc-500 ml-2">
                    Risk: {formatMoney(openBetsTotalStake)} · Return: {formatMoney(openBetsPotentialReturn)}
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
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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
            </div>
            <div className="sb-art-line text-primary mx-3" />
          </div>

          {/* Recent results */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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
                <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-zinc-800/20 mb-1 last:mb-0">
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
              <button onClick={runSettle} disabled={settling || !settleWinningId} className="flex-1 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground py-2.5 rounded font-heading font-bold text-sm uppercase border border-yellow-600/50 disabled:opacity-40">
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
                  disabled={placing}
                  className="flex-1 rounded-lg py-3 text-sm font-heading font-bold uppercase tracking-wider border-2 border-primary bg-primary text-primaryForeground hover:opacity-90 disabled:opacity-40 active:scale-[0.98] transition-all"
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
