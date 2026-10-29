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
import { Gift, Megaphone, Mic2, Palette, PiggyBank, RefreshCw, Trophy, Wallet } from 'lucide-react';
import styles from '../../styles/noir.module.css';
import './entertainerHub.css';

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

// Session cache so revisiting the hub shows content instantly (silent refresh in background).
let _cachedDash = null;

export default function EntertainerHub() {
  const [dash, setDash] = useState(_cachedDash);
  /** True until the first dashboard fetch settles (never blanks the page). */
  const [bootSettled, setBootSettled] = useState(!!_cachedDash?.username);
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
  const collectInFlightRef = useRef(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const res = await api.get('/entertainer/dashboard');
      _cachedDash = res.data;
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
      setBootSettled(true);
    }
  }, [dash?.username]);

  useEffect(() => {
    load();
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

  // Only after first fetch — never blank the page while waiting.
  if (bootSettled && !dash?.username) {
    return (
      <div className={`ent-hub p-4 ${styles.pageContent} mobile-page-root`}>
        <div className="ent-error ent-card">
          <div className="ent-card-body">
            <span className="ent-hero-icon mx-auto"><Mic2 size={22} /></span>
            <p className="text-base font-bold">
              {loadErr?.status === 403
                ? 'You do not have Entertainer access.'
                : 'Connection problem — the Entertainer dashboard could not be loaded.'}
            </p>
            {loadErr?.msg && loadErr?.status !== 403 ? <p className="ent-note">{loadErr.msg}</p> : null}
            <div className="flex flex-wrap gap-3 items-center justify-center">
              <button type="button" onClick={() => load()} className="ent-btn ent-btn-primary inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
              <Link to="/account/dashboard" className="ent-btn ent-btn-ghost inline-flex items-center">Back to dashboard</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const recent = dash?.recent_funded_games || [];
  const perkTypes = dash?.perk_token_types?.length ? dash.perk_token_types : Object.keys(PERK_LABELS);
  const remTotal = Number(dash?.perk_tokens_remaining_today ?? 10);
  const remAuto = Number(dash?.perk_auto_rank_remaining_today ?? 2);
  const broadcastsRemaining = Number(dash?.broadcasts_remaining_today ?? 5);
  const broadcastDailyCap = Number(dash?.broadcast_daily_cap ?? 5);
  const broadcastTemplates = (dash?.broadcast_templates?.length
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
      const mwp = Number(d.moved_wallet_points || 0);
      if (d.nothing_moved && !d.had_pending_before) {
        toast.message('No pending pay to collect.');
      } else if (d.nothing_moved && d.had_pending_before) {
        const pc = Number(d.entertainer_pending_fund_cash || 0);
        const pp = Number(d.entertainer_pending_fund_points || 0);
        const pbonus = Number(d.entertainer_pending_completion_bonus_points || 0);
        const parts = [];
        if (pc > 0 || pp > 0) {
          parts.push(
            `$${Math.trunc(pc).toLocaleString()} cash and ${pp.toLocaleString()} fund points stay in pending until you spend fund room`,
          );
        }
        if (pbonus > 0) {
          parts.push(`${pbonus.toLocaleString()} completion bonus points still pending`);
        }
        toast.message(parts.length ? parts.join('. ') + '.' : 'Nothing moved right now.');
      } else if (mc > 0 || mp > 0 || mwp > 0) {
        const parts = [];
        if (mc > 0) parts.push(`$${Math.trunc(mc).toLocaleString()} cash`);
        if (mp > 0) parts.push(`${mp.toLocaleString()} fund points`);
        if (mwp > 0) parts.push(`${mwp.toLocaleString()} wallet points`);
        toast.success(`Collected ${parts.join(', ')}.`);
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
    <div className={`ent-hub p-3 md:p-6 max-w-6xl mx-auto ${styles.pageContent} mobile-page-root`}>
      <header className="ent-hero">
        <div className="ent-hero-top">
          <span className="ent-hero-icon"><Mic2 size={22} /></span>
          <div className="min-w-0">
            <h1>Entertainer Hub</h1>
            <p>Run games, rally the streets and reward players{dash?.username ? `, ${dash.username}` : ''}.</p>
          </div>
          <button type="button" onClick={() => load()} className="ent-ghost-btn ml-auto" aria-label="Refresh">
            <RefreshCw size={14} /> <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
        <div className="ent-stats">
          <Stat label="Fund cash" value={`$${fmtShort(dash?.entertainer_fund_cash)}`} full={`$${fmt(dash?.entertainer_fund_cash)}`} tone="emerald" />
          <Stat label="Fund points" value={fmtShort(dash?.entertainer_fund_points)} full={fmt(dash?.entertainer_fund_points)} tone="sky" />
          <Stat label="Broadcasts left" value={`${broadcastsRemaining}/${broadcastDailyCap}`} tone="violet" />
          <Stat label="Perk tokens left" value={`${remTotal}/10`} tone="amber" />
        </div>
      </header>

      <div className="ent-grid">
        <div className="ent-col">
          <Card icon={Wallet} title="Pay day" tone="amber" subtitle="Daily allowance and completion bonuses wait here until you collect. Leave it to stack across days.">
            <div className="ent-tiles ent-tiles-3">
              <Tile label="Pending cash" value={`$${fmt(dash?.entertainer_pending_fund_cash)}`} tone="amber" />
              <Tile label="Pending fund points" value={fmt(dash?.entertainer_pending_fund_points)} tone="amber" />
              <Tile
                label="Completion bonus"
                value={fmt(dash?.entertainer_pending_completion_bonus_points)}
                tone="emerald"
                hint={`Today: ${fmt(dash?.completion_bonus_points_today)} pts from ${fmt(dash?.funded_completions_today)} games`}
              />
            </div>
            <button type="button" onClick={collectPending} disabled={collecting} className="ent-btn ent-btn-amber w-full">
              {collecting ? 'Collecting…' : 'Collect pay'}
            </button>
            <p className="ent-note">Allowance moves into your spendable fund (up to its cap). Bonuses go straight to your main wallet.</p>
          </Card>

          <Card icon={PiggyBank} title="Your fund" tone="emerald" subtitle="Spent when you create MDG games or MP Poker tables as an Entertainer. Your own wallet isn't touched.">
            <div className="ent-tiles ent-tiles-2">
              <Tile label="Spendable cash" value={`$${fmt(dash?.entertainer_fund_cash)}`} tone="emerald" big />
              <Tile label="Spendable points" value={fmt(dash?.entertainer_fund_points)} tone="sky" big />
            </div>
            <dl className="ent-rows">
              <Row label="Funded games today" value={fmt(dash?.funded_games_today_count)} />
              <Row label="Lifetime bonus points paid" value={fmt(dash?.lifetime_bonus_points_paid)} />
              <Row label="Lifetime fund cash granted" value={`$${fmt(dash?.lifetime_fund_cash_granted)}`} />
              <Row label="Lifetime fund points granted" value={fmt(dash?.lifetime_fund_points_granted)} />
            </dl>
          </Card>

          <Card icon={Trophy} title="Sponsored games" subtitle="MDG and MP Poker games you funded. Each completed one pays +100 main-wallet points.">
            <div className="ent-tiles ent-tiles-4">
              <Tile label="Open" value={fmt(dash?.funded_ledger_open_count)} tone="amber" />
              <Tile label="Completed" value={fmt(dash?.funded_ledger_completed_count)} tone="emerald" />
              <Tile label="Paid out pts" value={fmtShort(dash?.funded_ledger_paid_out_points_total)} full={fmt(dash?.funded_ledger_paid_out_points_total)} tone="sky" />
              <Tile label="Paid out cash" value={`$${fmtShort(dash?.funded_ledger_paid_out_cash_total)}`} full={`$${fmt(dash?.funded_ledger_paid_out_cash_total)}`} tone="emerald" />
            </div>
            {recent.length === 0 ? (
              <p className="ent-empty">No funded games yet. Create an MDG or MP Poker game using your Entertainer fund.</p>
            ) : (
              <ul className="ent-games">
                {recent.map((row) => {
                  const href = fundedGameHref(row);
                  const kind = fundedGameKindLabel(row);
                  const done = !!row.completed_at;
                  return (
                    <li key={row.id}>
                      <div className="ent-game-head">
                        {href ? <Link to={href} className="ent-game-kind">{kind}</Link> : <span className="ent-game-kind">{kind}</span>}
                        <span className={`ent-chip ${done ? 'ent-chip-done' : 'ent-chip-open'}`}>{done ? 'Completed' : 'Open'}</span>
                        <span className="ent-game-day">{row.utc_day}</span>
                      </div>
                      {done && (
                        <div className="ent-game-meta">
                          <span>Winner <b>{(row.winner_username || '').trim() || '—'}</b></span>
                          <span>Paid out <b className="text-sky-300">{formatTotalWinnings(row)}</b></span>
                          <span>From your fund <b className="text-violet-300">{formatFromEntertainerFund(row)}</b></span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="ent-col">
          <Card icon={Megaphone} title="Announce to everyone" tone="violet" subtitle="Sends an inbox message to every player, linking to the Entertainer Forum. Players who switched off E-Games notifications won't get it.">
            <div className="ent-chips" role="radiogroup" aria-label="Template">
              {broadcastTemplates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={broadcastTemplate === t.id}
                  className={`ent-pick ${broadcastTemplate === t.id ? 'is-on' : ''}`}
                  onClick={() => applyBroadcastTemplate(t.id)}
                  disabled={broadcastsRemaining <= 0}
                >
                  {t.label || t.id}
                </button>
              ))}
            </div>
            <label className="ent-field">
              <span>Title</span>
              <input type="text" value={broadcastTitle} onChange={(e) => setBroadcastTitle(e.target.value)} maxLength={120} placeholder="Inbox title" disabled={broadcastsRemaining <= 0} />
            </label>
            <label className="ent-field">
              <span>Message <em>{broadcastMessage.length}/500</em></span>
              <textarea value={broadcastMessage} onChange={(e) => setBroadcastMessage(e.target.value)} maxLength={500} rows={3} placeholder="What players will see in their inbox" disabled={broadcastsRemaining <= 0} />
            </label>
            {(broadcastTitle.trim() || broadcastMessage.trim()) && (
              <div className="ent-preview" aria-label="Inbox preview">
                <span className="ent-preview-tag">Inbox preview</span>
                <b>{broadcastTitle.trim() || 'Untitled'}</b>
                <p>{broadcastMessage.trim() || '…'}</p>
              </div>
            )}
            <button type="button" onClick={() => submitBroadcast()} disabled={broadcastSubmitting || broadcastsRemaining <= 0} className="ent-btn ent-btn-violet w-full">
              {broadcastSubmitting ? 'Sending…' : broadcastsRemaining <= 0 ? 'No broadcasts left today' : `Send to everyone · ${broadcastsRemaining} left today`}
            </button>
          </Card>

          <Card icon={Gift} title="Reward a player" subtitle="Grant armoury skill tokens. Daily limits reset at midnight UTC. Game Pass isn't included.">
            <label className="ent-field">
              <span>Player username</span>
              <input type="text" value={perkTarget} onChange={(e) => setPerkTarget(e.target.value)} placeholder="Exact username" autoCapitalize="none" spellCheck={false} disabled={remTotal <= 0} />
            </label>
            <div className="ent-field">
              <span>Perk</span>
              <div className="ent-chips ent-chips-grid" role="radiogroup" aria-label="Perk type">
                {perkTypes.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={perkType === k}
                    className={`ent-pick ${perkType === k ? 'is-on' : ''}`}
                    onClick={() => setPerkType(k)}
                    disabled={remTotal <= 0}
                  >
                    {PERK_LABELS[k] || k}
                  </button>
                ))}
              </div>
            </div>
            <div className="ent-perk-foot">
              <div className="ent-field">
                <span>Amount</span>
                <div className="ent-stepper">
                  <button type="button" onClick={() => setPerkAmt((a) => Math.max(1, (parseInt(a, 10) || 1) - 1))} disabled={remTotal <= 0 || perkAmt <= 1} aria-label="Less">−</button>
                  <input type="number" min={1} max={maxPerkAmt || 1} value={perkAmt} onChange={(e) => setPerkAmt(Number(e.target.value))} disabled={remTotal <= 0 || maxPerkAmt <= 0} />
                  <button type="button" onClick={() => setPerkAmt((a) => Math.min(maxPerkAmt || 1, (parseInt(a, 10) || 1) + 1))} disabled={remTotal <= 0 || perkAmt >= maxPerkAmt} aria-label="More">+</button>
                </div>
              </div>
              <div className="ent-limits">
                <span><b>{remTotal}</b>/10 tokens left</span>
                <span><b>{remAuto}</b>/2 Auto Rank left</span>
              </div>
            </div>
            <button type="button" onClick={() => submitPerk()} disabled={perkSubmitting || remTotal <= 0 || maxPerkAmt <= 0} className="ent-btn ent-btn-primary w-full">
              {perkSubmitting ? 'Sending…' : `Grant ${perkAmt}× ${PERK_LABELS[perkType] || perkType}${perkTarget.trim() ? ` to ${perkTarget.trim()}` : ''}`}
            </button>
          </Card>

          <Card icon={Palette} title="Your name colour" subtitle="How your name shows on Users Online, like moderators have.">
            <div className="ent-color">
              <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(entColor) ? entColor : '#7c3aed'} onChange={(e) => setEntColor(e.target.value)} aria-label="Entertainer colour" />
              <input type="text" value={entColor} onChange={(e) => setEntColor(e.target.value)} className="ent-hex" aria-label="Hex colour" />
              <span className="ent-name-preview" style={{ color: entColor }}>{dash?.username || 'Your name'}</span>
            </div>
            <button type="button" onClick={saveColor} disabled={colorSaving} className="ent-btn ent-btn-ghost w-full">
              {colorSaving ? 'Saving…' : 'Save colour'}
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function fmt(v) {
  return Math.trunc(Number(v || 0)).toLocaleString();
}

function fmtShort(v) {
  const n = Math.trunc(Number(v || 0));
  if (Math.abs(n) >= 1e12) return `${+(n / 1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e5) return `${Math.round(n / 1e3)}K`;
  return n.toLocaleString();
}

function Stat({ label, value, full, tone }) {
  return (
    <div className={`ent-stat ent-tone-${tone}`}>
      <span>{label}</span>
      <b title={full || undefined}>{value}</b>
    </div>
  );
}

function Tile({ label, value, full, tone = 'default', hint, big }) {
  return (
    <div className={`ent-tile ent-tone-${tone} ${big ? 'is-big' : ''}`}>
      <span>{label}</span>
      <b title={full || undefined}>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="ent-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Card({ icon: Icon, title, subtitle, tone = 'default', children }) {
  return (
    <section className={`ent-card ent-card-${tone}`}>
      <header>
        {Icon && <span className="ent-card-icon"><Icon size={16} /></span>}
        <div className="min-w-0">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </header>
      <div className="ent-card-body">{children}</div>
    </section>
  );
}
