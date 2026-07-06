import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../utils/api';
import { getApiErrorMessage } from '../../utils/api';
import {
  fundedGameKindLabel,
  formatTotalWinnings,
  formatFromEntertainerFund,
  fundedGameHref,
} from '../../utils/entertainerFundedGameDisplay';
import { Gift, Megaphone, Mic2, RefreshCw, Trophy } from 'lucide-react';

const BROADCAST_TEMPLATE_DEFAULTS = {
  new_e_games: {
    label: 'New E-Games (dice / gbox / hangman)',
    title: '🎲 New E-Games',
    message: 'Dice, gbox & hangman games are open in the Entertainer Forum — join now!',
  },
  mdg: {
    label: 'MDG starting',
    title: '🃏 MDG starting',
    message: 'A Murder Death Genocide game is live in the Entertainer Forum. Head over to join!',
  },
  mp_poker: {
    label: 'MP Poker table',
    title: '♠️ MP Poker',
    message: 'An MP Poker table is open in the Entertainer Forum — take a seat!',
  },
  word_hunt: {
    label: 'Word hunt',
    title: '🔎 Word hunt',
    message: 'Find the hidden word in the Entertainer Forum for a prize!',
  },
  forum: {
    label: 'Entertainer Forum (general)',
    title: '🎪 Entertainer Forum',
    message: 'Check the Entertainer Forum for games and events!',
  },
  custom: {
    label: 'Custom message',
    title: '',
    message: '',
  },
};

const PERK_LABELS = {
  xp_crimes: 'Crime XP',
  xp_gta: 'GTA XP',
  auto_rank_2h: 'Auto Rank (2h)',
  melt: 'Melt',
  oc_reduced: 'OC Reduced',
  booze: 'Booze',
  racket: 'Racket',
  travel: 'Travel',
  properties: 'Properties',
  jailbust_bonus: 'Jailbust',
};

export default function EntertainerHub() {
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [entColor, setEntColor] = useState('#7c3aed');
  const [colorSaving, setColorSaving] = useState(false);
  const [perkTarget, setPerkTarget] = useState('');
  const [perkType, setPerkType] = useState('xp_crimes');
  const [perkAmt, setPerkAmt] = useState(1);
  const [perkSubmitting, setPerkSubmitting] = useState(false);
  const [broadcastTemplate, setBroadcastTemplate] = useState('new_e_games');
  const [broadcastTitle, setBroadcastTitle] = useState(BROADCAST_TEMPLATE_DEFAULTS.new_e_games.title);
  const [broadcastMessage, setBroadcastMessage] = useState(BROADCAST_TEMPLATE_DEFAULTS.new_e_games.message);
  const [broadcastSubmitting, setBroadcastSubmitting] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [worldCupEnabled, setWorldCupEnabled] = useState(false);
  const collectInFlightRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await api.get('/entertainer/dashboard');
      setDash(res.data);
    } catch (e) {
      const status = e?.response?.status;
      const msg = getApiErrorMessage(e);
      setLoadErr({ status, msg });
      // Keep last good dashboard (prevents random mobile connection blips from showing "no access")
      setDash((prev) => (prev?.username ? prev : null));
      // Only toast if we don't already have content to show.
      if (!dash?.username) toast.error(msg || 'Could not load Entertainer hub');
    } finally {
      setLoading(false);
    }
  }, [dash?.username]);

  useEffect(() => {
    load();
    api.get('/world-cup/public-status').then((r) => setWorldCupEnabled(!!r.data?.enabled)).catch(() => setWorldCupEnabled(false));
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/auth/me');
        if (!cancelled && r.data?.entertainer_online_color) setEntColor((r.data.entertainer_online_color || '').trim() || '#7c3aed');
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  const saveColor = async () => {
    const hex = (entColor || '').trim() || '#7c3aed';
    if (!/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(hex)) {
      toast.error('Enter a valid hex colour');
      return;
    }
    setColorSaving(true);
    try {
      await api.patch('/profile/entertainer-online-color', { color: hex });
      toast.success('Entertainer online colour saved');
      const r = await api.get('/auth/me');
      if (r.data?.entertainer_online_color) setEntColor((r.data.entertainer_online_color || '').trim() || '#7c3aed');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save');
    } finally {
      setColorSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-mutedForeground font-heading text-sm">Loading Entertainer hub…</div>
    );
  }

  if (!dash?.username) {
    return (
      <div className="p-4 max-w-lg mx-auto space-y-3">
        <p className="text-foreground font-heading">
          {loadErr?.status === 403
            ? 'You do not have Entertainer access.'
            : 'Connection problem — the Entertainer dashboard could not be loaded.'}
        </p>
        {loadErr?.msg && loadErr?.status !== 403 ? (
          <p className="text-xs text-mutedForeground">{loadErr.msg}</p>
        ) : null}
        <div className="flex flex-wrap gap-3 items-center">
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-heading font-bold uppercase rounded bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30"
          >
            <RefreshCw size={14} /> Retry
          </button>
          <Link to="/account/dashboard" className="text-primary underline text-sm font-heading">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const recent = dash.recent_funded_games || [];
  const perkTypes = dash.perk_token_types?.length ? dash.perk_token_types : Object.keys(PERK_LABELS);
  const remTotal = Number(dash.perk_tokens_remaining_today ?? 10);
  const remAuto = Number(dash.perk_auto_rank_remaining_today ?? 2);
  const broadcastsRemaining = Number(dash.broadcasts_remaining_today ?? 5);
  const broadcastDailyCap = Number(dash.broadcast_daily_cap ?? 5);
  const broadcastTemplates = (dash.broadcast_templates?.length
    ? [...dash.broadcast_templates, { id: 'custom', label: 'Custom message', title: '', message: '' }]
    : Object.entries(BROADCAST_TEMPLATE_DEFAULTS).map(([id, v]) => ({ id, ...v })));

  const applyBroadcastTemplate = (templateId) => {
    const fromApi = broadcastTemplates.find((t) => t.id === templateId);
    const fallback = BROADCAST_TEMPLATE_DEFAULTS[templateId] || BROADCAST_TEMPLATE_DEFAULTS.custom;
    const tpl = fromApi || fallback;
    setBroadcastTemplate(templateId);
    setBroadcastTitle(tpl.title || '');
    setBroadcastMessage(tpl.message || '');
  };

  const submitBroadcast = async () => {
    const title = broadcastTitle.trim();
    const message = broadcastMessage.trim();
    if (broadcastTemplate === 'custom' && (!title || !message)) {
      toast.error('Enter a title and message for a custom broadcast');
      return;
    }
    setBroadcastSubmitting(true);
    try {
      const res = await api.post('/entertainer/broadcast', {
        template: broadcastTemplate,
        title: title || undefined,
        message: message || undefined,
      });
      toast.success(res.data?.message || 'Broadcast sent');
      await load();
    } catch (e) {
      const d = e.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Could not send broadcast');
    } finally {
      setBroadcastSubmitting(false);
    }
  };

  const maxPerkAmt =
    perkType === 'auto_rank_2h' ? Math.min(remTotal, remAuto, 10) : Math.min(remTotal, 10);

  const collectPending = async () => {
    if (collectInFlightRef.current) return;
    collectInFlightRef.current = true;
    setCollecting(true);
    try {
      const res = await api.post('/entertainer/collect-pending-fund', {});
      const d = res.data || {};
      const mc = Number(d.moved_cash || 0);
      const mp = Number(d.moved_points || 0);
      if (d.nothing_moved && !d.had_pending_before) {
        toast.message('No pending allowance to collect.');
      } else if (d.nothing_moved && d.had_pending_before) {
        const pc = Number(d.entertainer_pending_fund_cash || 0);
        const pp = Number(d.entertainer_pending_fund_points || 0);
        toast.message(
          `Spendable fund is at the cap. $${Math.trunc(pc).toLocaleString()} cash and ${pp.toLocaleString()} points stay in pending until you spend fund room.`,
        );
      } else if (mc > 0 || mp > 0) {
        const parts = [];
        if (mc > 0) parts.push(`$${Math.trunc(mc).toLocaleString()} cash`);
        if (mp > 0) parts.push(`${mp.toLocaleString()} points`);
        toast.success(`Collected ${parts.join(' and ')} into your entertainer fund.`);
      } else {
        toast.message('Nothing to collect right now.');
      }
      await load();
    } catch (e) {
      const msg = e.response?.data?.detail;
      toast.error(typeof msg === 'string' ? msg : 'Could not collect');
    } finally {
      collectInFlightRef.current = false;
      setCollecting(false);
    }
  };

  const submitPerk = async () => {
    const uname = perkTarget.trim();
    if (!uname) {
      toast.error('Enter a player username');
      return;
    }
    const amt = Math.min(10, Math.max(1, parseInt(perkAmt, 10) || 1));
    if (amt > maxPerkAmt) {
      toast.error(perkType === 'auto_rank_2h'
        ? `Amount exceeds remaining slots (${remTotal} total left today, ${remAuto} Auto Rank left).`
        : `Amount exceeds remaining perk tokens today (${remTotal} left).`);
      return;
    }
    setPerkSubmitting(true);
    try {
      await api.post('/entertainer/reward-perk', {
        target_username: uname,
        token_type: perkType,
        amount: amt,
      });
      toast.success(`Granted ${amt}× ${PERK_LABELS[perkType] || perkType}`);
      setPerkTarget('');
      setPerkAmt(1);
      await load();
    } catch (e) {
      const d = e.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Could not grant perk');
    } finally {
      setPerkSubmitting(false);
    }
  };

  return (
    <div className="p-3 md:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2 border-b border-primary/20 pb-3 flex-wrap">
        <Mic2 className="text-primary shrink-0" size={22} />
        <h1 className="text-lg md:text-xl font-heading font-bold text-primary tracking-wide uppercase">Entertainer Hub</h1>
        {worldCupEnabled && (
          <Link
            to="/game/world-cup/staff"
            className="flex items-center gap-1.5 min-h-[44px] px-3 rounded border border-emerald-500/30 text-emerald-400 text-xs font-heading uppercase"
          >
            <Trophy size={14} /> World Cup
          </Link>
        )}
        <button type="button" onClick={() => load()} className="ml-auto flex items-center gap-1 text-[11px] font-heading text-mutedForeground hover:text-primary min-h-[44px]">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <section className="rounded-lg border border-primary/20 bg-zinc-900/40 p-4 space-y-3">
        <h2 className="text-[11px] font-heading uppercase tracking-widest text-mutedForeground">Users Online colour</h2>
        <p className="text-[11px] text-mutedForeground font-heading">Pick how your name appears on Users Online (same idea as moderators).</p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="color" value={entColor} onChange={(e) => setEntColor(e.target.value)} className="h-9 w-12 rounded border border-input bg-transparent cursor-pointer" aria-label="Entertainer colour" />
          <input type="text" value={entColor} onChange={(e) => setEntColor(e.target.value)} className="w-28 bg-zinc-900/60 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-foreground" />
          <button type="button" onClick={saveColor} disabled={colorSaving} className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-heading font-bold disabled:opacity-50">
            {colorSaving ? 'Saving…' : 'Save colour'}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-violet-500/25 bg-violet-950/15 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Megaphone className="text-violet-300 shrink-0" size={18} />
          <h2 className="text-[11px] font-heading uppercase tracking-widest text-violet-200/90">Game-wide announce</h2>
        </div>
        <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
          Send an inbox message to every player about E-Games or the Entertainer Forum. Players who turned off E-Games notifications in Profile will not receive it. Link goes to the Entertainer Forum tab.
        </p>
        <div className="text-[11px] font-heading text-foreground">
          <span className="text-mutedForeground">Broadcasts left today (UTC):</span>{' '}
          <strong>{broadcastsRemaining}</strong> / {broadcastDailyCap}
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-mutedForeground font-heading uppercase">Template</span>
            <select
              value={broadcastTemplate}
              onChange={(e) => applyBroadcastTemplate(e.target.value)}
              className="bg-zinc-900/60 border border-zinc-700 rounded px-2 py-1.5 text-xs font-heading text-foreground"
              disabled={broadcastsRemaining <= 0}
            >
              {broadcastTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.label || t.id}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-mutedForeground font-heading uppercase">Title</span>
            <input
              type="text"
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              maxLength={120}
              placeholder="Inbox title"
              className="bg-zinc-900/60 border border-zinc-700 rounded px-2 py-1.5 text-xs font-heading text-foreground"
              disabled={broadcastsRemaining <= 0}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-mutedForeground font-heading uppercase">Message</span>
            <textarea
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="What players will see in their inbox"
              className="bg-zinc-900/60 border border-zinc-700 rounded px-2 py-1.5 text-xs font-heading text-foreground resize-y min-h-[88px]"
              disabled={broadcastsRemaining <= 0}
            />
          </label>
          <button
            type="button"
            onClick={() => submitBroadcast()}
            disabled={broadcastSubmitting || broadcastsRemaining <= 0}
            className="w-full sm:w-auto px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-heading font-bold uppercase tracking-wide disabled:opacity-50"
          >
            {broadcastSubmitting ? 'Sending…' : 'Send game-wide message'}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-primary/20 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Gift className="text-primary shrink-0" size={18} />
          <h2 className="text-[11px] font-heading uppercase tracking-widest text-mutedForeground">Reward perks</h2>
        </div>
        <p className="text-[11px] text-mutedForeground font-heading">
          Grant armoury skill tokens to any player (UTC daily limits). Game Pass is not included — staff-only elsewhere.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-heading text-foreground">
          <span>
            <span className="text-mutedForeground">Tokens left today:</span>{' '}
            <strong>{remTotal}</strong> / 10
          </span>
          <span>
            <span className="text-mutedForeground">Auto Rank (2h) left:</span>{' '}
            <strong>{remAuto}</strong> / 2
          </span>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-stretch sm:items-end">
          <label className="flex flex-col gap-1 min-w-[140px] flex-1">
            <span className="text-[10px] text-mutedForeground font-heading uppercase">Player username</span>
            <input
              type="text"
              value={perkTarget}
              onChange={(e) => setPerkTarget(e.target.value)}
              placeholder="Exact username"
              className="bg-zinc-900/60 border border-zinc-700 rounded px-2 py-1.5 text-xs font-heading text-foreground"
              disabled={remTotal <= 0}
            />
          </label>
          <label className="flex flex-col gap-1 min-w-[160px]">
            <span className="text-[10px] text-mutedForeground font-heading uppercase">Perk type</span>
            <select
              value={perkType}
              onChange={(e) => setPerkType(e.target.value)}
              className="bg-zinc-900/60 border border-zinc-700 rounded px-2 py-1.5 text-xs font-heading text-foreground"
              disabled={remTotal <= 0}
            >
              {perkTypes.map((k) => (
                <option key={k} value={k}>
                  {PERK_LABELS[k] || k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 w-24">
            <span className="text-[10px] text-mutedForeground font-heading uppercase">Amount</span>
            <input
              type="number"
              min={1}
              max={maxPerkAmt || 1}
              value={perkAmt}
              onChange={(e) => setPerkAmt(Number(e.target.value))}
              className="bg-zinc-900/60 border border-zinc-700 rounded px-2 py-1.5 text-xs font-heading text-foreground"
              disabled={remTotal <= 0 || maxPerkAmt <= 0}
            />
          </label>
          <button
            type="button"
            onClick={() => submitPerk()}
            disabled={perkSubmitting || remTotal <= 0 || maxPerkAmt <= 0}
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-xs font-heading font-bold disabled:opacity-50 sm:self-end"
          >
            {perkSubmitting ? 'Sending…' : 'Grant perk'}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-amber-500/25 bg-amber-950/15 p-4 space-y-3">
        <h2 className="text-[11px] font-heading uppercase tracking-widest text-amber-200/90">Daily allowance (pending)</h2>
        <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
          Each UTC day the server credits your daily allowance here first. Use <strong className="text-foreground">Collect</strong> to move it into your spendable fund (respecting fund caps). Leave it pending to stack across days.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-amber-500/20 bg-zinc-950/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading mb-1">Pending cash</div>
            <div className="text-lg font-heading font-bold text-amber-300">${Math.trunc(Number(dash.entertainer_pending_fund_cash || 0)).toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-zinc-950/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading mb-1">Pending points</div>
            <div className="text-lg font-heading font-bold text-amber-200/90">{Number(dash.entertainer_pending_fund_points || 0).toLocaleString()}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={collectPending}
          disabled={collecting}
          className="w-full sm:w-auto px-4 py-2 rounded-lg bg-amber-500/90 hover:bg-amber-500 text-zinc-950 text-xs font-heading font-black uppercase tracking-wide disabled:opacity-50"
        >
          {collecting ? 'Collecting…' : 'Collect pay'}
        </button>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-primary/20 bg-zinc-900/50 p-4">
          <div className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading mb-1">Fund cash (spendable)</div>
          <div className="text-xl font-heading font-bold text-emerald-400">${Number(dash.entertainer_fund_cash || 0).toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-primary/20 bg-zinc-900/50 p-4">
          <div className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading mb-1">Fund points (spendable)</div>
          <div className="text-xl font-heading font-bold text-sky-400">{Number(dash.entertainer_fund_points || 0).toLocaleString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm font-heading">
        <div className="rounded border border-zinc-700/50 p-3 bg-zinc-900/30">
          <span className="text-mutedForeground text-[10px] uppercase block mb-1">Funded games today</span>
          <span className="text-foreground text-lg font-bold">{dash.funded_games_today_count ?? 0}</span>
        </div>
        <div className="rounded border border-zinc-700/50 p-3 bg-zinc-900/30">
          <span className="text-mutedForeground text-[10px] uppercase block mb-1">Lifetime bonus points paid</span>
          <span className="text-foreground text-lg font-bold">{(dash.lifetime_bonus_points_paid ?? 0).toLocaleString()}</span>
        </div>
        <div className="rounded border border-zinc-700/50 p-3 bg-zinc-900/30">
          <span className="text-mutedForeground text-[10px] uppercase block mb-1">Lifetime fund cash granted</span>
          <span className="text-foreground">${(dash.lifetime_fund_cash_granted ?? 0).toLocaleString()}</span>
        </div>
        <div className="rounded border border-zinc-700/50 p-3 bg-zinc-900/30">
          <span className="text-mutedForeground text-[10px] uppercase block mb-1">Lifetime fund points granted</span>
          <span className="text-foreground">{(dash.lifetime_fund_points_granted ?? 0).toLocaleString()}</span>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest">Sponsored games (MDG / MP Poker)</h2>
        <p className="text-[10px] text-mutedForeground font-heading leading-snug">
          <strong className="text-zinc-400">Open</strong> = game not finished yet. <strong className="text-zinc-400">Completed</strong> = done. Paid totals are from the ledger (games finished before payout tracking may show 0).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-heading">
          <div className="rounded border border-zinc-700/50 p-2 bg-zinc-900/30 text-center">
            <div className="text-[9px] text-mutedForeground uppercase">Open</div>
            <div className="text-lg font-bold text-amber-400 tabular-nums">{dash.funded_ledger_open_count ?? 0}</div>
          </div>
          <div className="rounded border border-zinc-700/50 p-2 bg-zinc-900/30 text-center">
            <div className="text-[9px] text-mutedForeground uppercase">Completed</div>
            <div className="text-lg font-bold text-emerald-400 tabular-nums">{dash.funded_ledger_completed_count ?? 0}</div>
          </div>
          <div className="rounded border border-zinc-700/50 p-2 bg-zinc-900/30 text-center">
            <div className="text-[9px] text-mutedForeground uppercase">Paid pts</div>
            <div className="text-lg font-bold text-sky-400/90 tabular-nums">{(dash.funded_ledger_paid_out_points_total ?? 0).toLocaleString()}</div>
          </div>
          <div className="rounded border border-zinc-700/50 p-2 bg-zinc-900/30 text-center">
            <div className="text-[9px] text-mutedForeground uppercase">Paid cash</div>
            <div className="text-lg font-bold text-emerald-400 tabular-nums">${Math.trunc(Number(dash.funded_ledger_paid_out_cash_total ?? 0)).toLocaleString()}</div>
          </div>
        </div>
        <h3 className="text-[11px] font-heading font-bold text-mutedForeground uppercase tracking-wider">Recent funded games</h3>
        {recent.length === 0 ? (
          <p className="text-[11px] text-mutedForeground font-heading">No entries yet. Create an MDG or MP Poker game using your entertainer fund.</p>
        ) : (
          <ul className="space-y-2 max-h-[28rem] overflow-y-auto">
            {recent.map((row) => {
              const href = fundedGameHref(row);
              const kind = fundedGameKindLabel(row);
              const winner = (row.winner_username || '').trim() || '—';
              const total = formatTotalWinnings(row);
              const fromFund = formatFromEntertainerFund(row);
              return (
                <li key={row.id} className="text-[11px] font-heading py-2 px-2 rounded bg-zinc-800/50 border border-zinc-700/40 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {href ? (
                      <Link to={href} className="text-primary hover:underline">{kind}</Link>
                    ) : (
                      <span className="text-primary">{kind}</span>
                    )}
                    <span className="text-mutedForeground">{row.utc_day}</span>
                    <span className={row.completed_at ? 'text-emerald-400' : 'text-amber-400'}>{row.completed_at ? 'Completed' : 'Open'}</span>
                  </div>
                  {row.completed_at ? (
                    <div className="text-[10px] text-mutedForeground space-y-0.5 leading-snug">
                      <div>
                        <span className="text-zinc-500">Winner: </span>
                        <span className="text-zinc-200">{winner}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500">Total paid out: </span>
                        <span className="text-sky-400/90">{total}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500">From your fund (seed): </span>
                        <span className="text-violet-300/90">{fromFund}</span>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-[10px] text-mutedForeground font-heading">
        Daily allowance accrues to pending automatically (UTC). Collect when you want it in your spendable fund. Use that fund when creating MDG games or MP Poker tables as an Entertainer — your normal wallet is not charged for those flows.
      </p>
    </div>
  );
}
