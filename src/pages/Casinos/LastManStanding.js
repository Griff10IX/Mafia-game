import { useCallback, useEffect, useMemo, useState } from 'react';
import { Skull, Flame, Users, Clock, ChevronDown, ChevronUp, Heart } from 'lucide-react';
import { toast } from 'sonner';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const LMS_CSS = `
  @keyframes lms-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes lms-pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
  .lms-fade { animation: lms-fade .35s ease-out both; }
  @media (prefers-reduced-motion: reduce) { .lms-fade { animation: none; } }
`;

function fmt(n) {
  const v = Number(n || 0);
  return v.toLocaleString();
}

function useCount(n) {
  const [shown, setShown] = useState(n || 0);
  useEffect(() => {
    const target = Number(n || 0);
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(target);
      return undefined;
    }
    const start = shown;
    const diff = target - start;
    if (!diff) return undefined;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / 420);
      setShown(Math.round(start + diff * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return shown;
}

function deadlineLabel(iso) {
  if (!iso) return '—';
  const end = new Date(String(iso).replace('Z', '+00:00'));
  if (Number.isNaN(end.getTime())) return '—';
  const ms = end - Date.now();
  if (ms <= 0) return 'Locked';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function kickoffLabel(iso) {
  if (!iso) return '';
  try {
    const d = new Date(String(iso).replace('Z', '+00:00'));
    return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function RuleBlock({ title, children, open, onToggle }) {
  return (
    <div className="border-b border-zinc-800/80">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 py-2.5 text-left min-h-[44px]"
      >
        <span className="text-[11px] font-heading font-bold uppercase tracking-wider text-primary">{title}</span>
        {open ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
      </button>
      {open && <div className="pb-3 text-[11px] text-zinc-300 font-heading leading-relaxed space-y-1.5">{children}</div>}
    </div>
  );
}

export default function LastManStanding() {
  const [tab, setTab] = useState('play');
  const [data, setData] = useState(null);
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [graveOpen, setGraveOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState('play');
  const [nowTick, setNowTick] = useState(0);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const res = await api.get('/lms/seasons');
    const payload = res.data || null;
    setData(payload);
    const sid = payload?.season?.id;
    if (sid) {
      try {
        const f = await api.get(`/lms/seasons/${sid}/picks-feed`);
        setFeed(f.data || null);
      } catch (_) {
        /* season payload is enough to show join / lives / pick UI */
      }
    }
    return payload;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) toast.error(e.response?.data?.detail || 'Could not load Last Man Standing');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const season = data?.season;
  const entry = data?.entry;
  const gw = data?.gameweek;
  const potShown = useCount(season?.pot || 0);
  const alive = season?.alive ?? season?.alive_count ?? 0;
  const entered = season?.entered ?? season?.entry_count ?? 0;
  const used = new Set(entry?.teams_used || []);
  const fixtures = gw?.fixtures || [];
  const locked = !!data?.picks_locked;
  const myTeam = data?.my_pick?.team_id || null;
  const selectedId = selected || myTeam;
  const status = (entry?.status || '').toLowerCase();
  const canPick = status === 'alive' && !locked && gw?.status === 'picks_open';

  const nextWeekly = data?.next_weekly_preview || 0;
  const streak = intSafe(entry?.correct_streak);
  const lives = entry ? intSafe(entry.lives ?? season?.starting_lives ?? 2) : 0;
  const lifeCost = intSafe(season?.extra_life_cost ?? 2500);

  function applyEntry(entry) {
    if (!entry) return;
    setData((prev) => (prev ? { ...prev, entry, can_join: false } : prev));
  }

  async function reloadQuiet() {
    try {
      return await load();
    } catch (_) {
      return null;
    }
  }

  async function onJoin() {
    if (busy || !season?.id) return;
    setBusy(true);
    try {
      const res = await api.post(`/lms/seasons/${season.id}/join`);
      applyEntry(res.data?.entry);
      toast.success(res.data?.already_joined ? 'You are already in.' : 'You are in.');
      refreshUser().catch(() => {});
      await reloadQuiet();
    } catch (e) {
      const payload = await reloadQuiet();
      if (payload?.entry) {
        toast.success('You are in.');
        refreshUser().catch(() => {});
      } else {
        toast.error(getApiErrorMessage(e) || 'Join failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onBuyLife() {
    if (busy || !season?.id) return;
    setBusy(true);
    try {
      const res = await api.post(`/lms/seasons/${season.id}/extra-life`);
      applyEntry(res.data?.entry);
      toast.success('Extra life bought.');
      refreshUser().catch(() => {});
      await reloadQuiet();
    } catch (e) {
      const payload = await reloadQuiet();
      if (payload?.entry?.extra_life_bought) {
        toast.success('Extra life bought.');
        refreshUser().catch(() => {});
      } else {
        toast.error(getApiErrorMessage(e) || 'Could not buy a life');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmPick() {
    if (busy || !season?.id || !selectedId || !gw) return;
    setBusy(true);
    try {
      await api.post(`/lms/seasons/${season.id}/picks`, { gw: gw.gw, team_id: selectedId });
      toast.success('Pick locked in until you change it.');
      setSelected(selectedId);
      await reloadQuiet();
    } catch (e) {
      const payload = await reloadQuiet();
      const saved = payload?.my_pick?.team_id || null;
      if (saved && saved === selectedId) {
        toast.success('Pick locked in until you change it.');
        setSelected(selectedId);
      } else {
        toast.error(getApiErrorMessage(e) || 'Pick failed');
      }
    } finally {
      setBusy(false);
    }
  }

  const badge = !entry
    ? null
    : status === 'won'
      ? { label: 'WINNER', cls: 'text-amber-300 border-amber-400/40 bg-amber-500/10' }
      : status === 'out'
        ? { label: 'OUT', cls: 'text-rose-300 border-rose-500/30 bg-rose-950/40' }
        : { label: 'ALIVE', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-950/40' };

  const filteredFeed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = feed?.picks || [];
    if (!q) return rows;
    return rows.filter((r) => String(r.username || '').toLowerCase().includes(q) || String(r.team_name || '').toLowerCase().includes(q));
  }, [feed, query]);

  if (loading) {
    return (
      <div className={`space-y-3 ${styles.pageContent} mobile-page-root px-3 pb-[calc(6rem+env(safe-area-inset-bottom))]`} data-testid="lms-page">
        <div className="h-4 w-40 rounded bg-zinc-800/70" />
        <div className="h-24 rounded-lg bg-zinc-900/50 border border-zinc-800" />
      </div>
    );
  }

  if (!season) {
    return (
      <div className={`space-y-3 ${styles.pageContent} mobile-page-root px-3`} data-testid="lms-page">
        <h1 className={`text-base font-heading font-bold ${styles.gmTitle}`}>Last Man Standing</h1>
        <p className="text-[11px] text-zinc-400 font-heading">No Premier League season is open yet.</p>
      </div>
    );
  }

  const seasonStatus =
    season.status === 'settled' ? 'Settled' : season.status === 'open' ? `Open · GW${gw?.gw || 1}` : `Live · GW${gw?.gw || season.current_gameweek || 1}`;

  return (
    <div
      className={`space-y-3 ${styles.pageContent} mobile-page-root px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:pb-8 max-w-3xl mx-auto`}
      data-testid="lms-page"
    >
      <style>{LMS_CSS}</style>

      <header className="lms-fade pt-1">
        <p className="text-[9px] uppercase tracking-[0.22em] text-zinc-500 font-heading">Premier League</p>
        <div className="flex items-end justify-between gap-2">
          <h1 className={`text-lg sm:text-xl font-heading font-bold leading-tight ${styles.gmTitle}`}>Last Man Standing</h1>
          <span className="shrink-0 text-[9px] font-heading uppercase tracking-wider px-2 py-1 rounded border border-primary/35 text-primary">{seasonStatus}</span>
        </div>
        <p className="text-[11px] text-zinc-400 font-heading mt-1">Survive every week. Two lives. No team twice. Last player(s) take the pot.</p>
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-heading">Season pot</div>
          <div className="text-3xl sm:text-4xl font-heading font-bold tabular-nums text-primary leading-none">{fmt(potShown)} <span className="text-sm text-zinc-400">pts</span></div>
          <div className="text-[10px] text-zinc-500 font-heading mt-1">Entry {fmt(season.entry_fee)} pts · seeded {fmt(season.seed_pot)}</div>
        </div>
      </header>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5 lms-fade">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-heading">Still standing</div>
            <div className="text-lg font-heading font-bold tabular-nums">{alive} <span className="text-zinc-500 text-xs">/ {entered} entered</span></div>
          </div>
          {badge && (
            <div className="flex flex-col items-end gap-1">
              <span className={`text-[10px] font-heading font-bold uppercase tracking-wider px-2 py-1 rounded border ${badge.cls}`}>{badge.label}</span>
              {status === 'alive' && (
                <span className="flex items-center gap-0.5 text-rose-300" title={`${lives} ${lives === 1 ? 'life' : 'lives'}`}>
                  {Array.from({ length: Math.max(0, lives) }).map((_, i) => (
                    <Heart key={i} size={12} fill="currentColor" />
                  ))}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full bg-primary/80" style={{ width: `${entered ? Math.max(4, Math.round((alive / entered) * 100)) : 0}%` }} />
        </div>
        {status === 'alive' && !data?.staff_no_prizes && (
          <div className="mt-2 flex items-center gap-2 text-[11px] font-heading text-amber-200/90">
            <Flame size={13} /> Streak ×{streak} · next week {fmt(nextWeekly)} pts
          </div>
        )}
        {status === 'alive' && data?.staff_no_prizes && (
          <div className="mt-2 text-[11px] font-heading text-zinc-400">Staff entry — streak tracked, prizes are 0</div>
        )}
      </div>

      <div className="sticky top-0 z-20 -mx-3 px-3 py-1.5 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800/80">
        <div className="flex gap-1">
          {[
            ['play', 'Play'],
            ['picks', 'Picks'],
            ['rules', 'Rules'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 min-h-[40px] rounded-md text-[10px] font-heading font-bold uppercase tracking-wider border ${
                tab === id ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-zinc-900/40 border-zinc-800 text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'play' && (
        <div className="space-y-3 lms-fade">
          {!entry && data?.can_join && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onJoin}
                className="w-full min-h-[48px] rounded-lg bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm disabled:opacity-50"
              >
                {busy ? 'Joining…' : `Join — ${fmt(season.entry_fee)} pts`}
              </button>
            <p className="text-[10px] text-zinc-500 font-heading text-center">
              {data?.staff_no_prizes
                ? 'Staff entry — you pay the fee but take none of the weekly bonuses or the pot'
                : 'One entry per email · 2 lives · transfers if you die'}
            </p>
            </>
          )}
          {!entry && !data?.can_join && (
            <p className="text-[11px] text-zinc-400 font-heading">Entry is closed, or GW1 fixtures are still loading.</p>
          )}
          {status === 'out' && (
            <p className="text-[12px] text-rose-300/90 font-heading">You went out{entry?.eliminated_gw ? ` in GW${entry.eliminated_gw}` : ''}. Seat stays on this email if you die.</p>
          )}
          {status === 'alive' && data?.can_buy_life && (
            <button
              type="button"
              disabled={busy}
              onClick={onBuyLife}
              className="w-full min-h-[44px] rounded-lg border border-rose-500/40 bg-rose-950/30 text-rose-200 font-heading font-bold text-[12px] disabled:opacity-50"
            >
              {busy ? 'Buying…' : `Buy extra life — ${fmt(lifeCost)} pts`}
            </button>
          )}

          {gw && (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[11px] font-heading font-bold uppercase tracking-wider text-zinc-200">Gameweek {gw.gw}</h2>
                <span className="text-[10px] font-heading text-zinc-400 flex items-center gap-1">
                  <Clock size={12} /> {deadlineLabel(gw.pick_deadline)} <span className="sr-only">{nowTick}</span>
                </span>
              </div>
              {used.size > 0 && (
                <div className="flex flex-wrap gap-1">
                  {fixtures.flatMap((f) => [f.home, f.away]).filter(Boolean).length >= 0 &&
                    (entry.teams_used || []).map((tid) => {
                      const fx = fixtures.find((f) => f.home_team_id === tid || f.away_team_id === tid);
                      const name = fx ? (fx.home_team_id === tid ? fx.home : fx.away) : tid;
                      return (
                        <span key={tid} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 line-through font-heading">
                          {name}
                        </span>
                      );
                    })}
                </div>
              )}
              <div className="space-y-2">
                {fixtures.map((f) => {
                  const homeUsed = used.has(f.home_team_id) && f.home_team_id !== myTeam;
                  const awayUsed = used.has(f.away_team_id) && f.away_team_id !== myTeam;
                  return (
                    <div key={f.external_event_id || `${f.home}-${f.away}`} className="rounded-lg border border-zinc-800 bg-zinc-950/50 overflow-hidden">
                      <div className="px-2 py-1 text-[9px] text-zinc-500 font-heading">{kickoffLabel(f.kickoff)}</div>
                      <div className="grid grid-cols-2 gap-px bg-zinc-800">
                        <TeamBtn
                          name={f.home}
                          disabled={!canPick || homeUsed}
                          selected={selectedId === f.home_team_id}
                          onClick={() => canPick && !homeUsed && setSelected(f.home_team_id)}
                        />
                        <TeamBtn
                          name={f.away}
                          disabled={!canPick || awayUsed}
                          selected={selectedId === f.away_team_id}
                          onClick={() => canPick && !awayUsed && setSelected(f.away_team_id)}
                        />
                      </div>
                      {f.result && (
                        <div className="px-2 py-1 text-[9px] text-zinc-500 font-heading">
                          {f.result === 'postponed' ? 'Postponed' : f.result === 'draw' ? 'Draw' : f.result === 'home' ? `${f.home} win` : `${f.away} win`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div>
            <button type="button" onClick={() => setGraveOpen((v) => !v)} className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-zinc-500 min-h-[36px]">
              <Users size={12} /> Still standing ({data?.standing?.length || 0}) {graveOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {graveOpen && (
              <ul className="text-[11px] font-heading text-zinc-300 columns-2 gap-3">
                {(data?.standing || []).map((p) => (
                  <li key={p.username}>{p.username}</li>
                ))}
              </ul>
            )}
          </div>
          <details className="text-[11px] font-heading text-zinc-500">
            <summary className="cursor-pointer min-h-[36px] flex items-center gap-1"><Skull size={12} /> Fallen</summary>
            <ul className="mt-1 space-y-0.5">
              {(data?.fallen || []).map((p) => (
                <li key={p.username}>{p.username}{p.eliminated_gw ? ` · GW${p.eliminated_gw}` : ''}</li>
              ))}
              {!(data?.fallen || []).length && <li>None yet</li>}
            </ul>
          </details>
        </div>
      )}

      {tab === 'picks' && (
        <div className="space-y-3 lms-fade">
          <div className="sticky top-12 z-10 py-1 bg-zinc-950/95 text-[11px] font-heading flex gap-3">
            <span>Entered <b className="text-foreground">{feed?.entered ?? entered}</b></span>
            <span>Alive <b className="text-emerald-300">{feed?.alive ?? alive}</b></span>
            <span>Out <b className="text-rose-300">{feed?.out ?? season.out ?? 0}</b></span>
          </div>
          {feed?.hidden && (
            <p className="text-[11px] text-zinc-400 font-heading">
              Other players’ picks stay hidden until the deadline.
              {feed?.my_pick ? ` Your pick: ${feed.my_pick.team_name}.` : ''}
            </p>
          )}
          {!feed?.hidden && (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search player or team"
                className="w-full min-h-[40px] rounded-md bg-zinc-900 border border-zinc-700 px-2 text-xs text-foreground"
              />
              <div className="space-y-2">
                {(feed?.grouped || []).map((g) => (
                  <div key={g.team} className="text-[11px] font-heading">
                    <div className="text-primary font-bold">{g.team} — {g.count}</div>
                    <div className="text-zinc-400">{g.usernames.join(', ')}</div>
                  </div>
                ))}
              </div>
              {query && (
                <ul className="text-[11px] font-heading space-y-1">
                  {filteredFeed.map((r) => (
                    <li key={`${r.username}-${r.team_id}`}>{r.username} → {r.team_name}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {(feed?.history || []).map((h) => (
            <details key={h.gw} className="text-[11px] font-heading">
              <summary className="cursor-pointer min-h-[36px]">GW{h.gw}</summary>
              <ul className="mt-1 space-y-0.5 text-zinc-400">
                {(h.picks || []).map((p) => (
                  <li key={`${h.gw}-${p.username}`}>{p.username} · {p.team_name} · {p.result}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}

      {tab === 'rules' && (
        <div className="lms-fade rounded-lg border border-zinc-800 px-3 bg-zinc-950/40">
          <RuleBlock title="How to play" open={ruleOpen === 'play'} onToggle={() => setRuleOpen(ruleOpen === 'play' ? '' : 'play')}>
            <p>Pick one Premier League team to win each gameweek. You start with <b>2 lives</b>. A draw, loss, or missed deadline costs one life. At 0 lives you are out.</p>
            <p>You can buy <b>one</b> extra life for {fmt(season.extra_life_cost || 2500)} pts while you are still alive (not added to the pot).</p>
            <p>You cannot reuse a team you already picked this season. Anyone can pick the same team as you.</p>
            <p>GW1 lists the full Premier League slate — all 10 matches / 20 clubs.</p>
            <p>You can change your pick until the first kickoff of that week.</p>
          </RuleBlock>
          <RuleBlock title="Prizes" open={ruleOpen === 'prizes'} onToggle={() => setRuleOpen(ruleOpen === 'prizes' ? '' : 'prizes')}>
            <p>Season pot starts at {fmt(season.seed_pot)} pts. Each entry adds {fmt(season.entry_fee)} pts.</p>
            <p>Correct pick while alive: {fmt(season.weekly_correct_bonus)} pts. Streak bonus: {fmt(season.weekly_streak_bonus)} × streak length. Weekly prizes are paid by the house, not taken from the pot.</p>
            <p>Last eligible player standing wins the pot. If several remain after GW38 they split it. If a week wipes everyone, players who were alive at the start of that week split it.</p>
            <p>Admins and mods can join and play. They still pay the entry fee into the pot, but they get none of the weekly bonuses and none of the season pot.</p>
          </RuleBlock>
          <RuleBlock title="One entry / Dead → Alive" open={ruleOpen === 'death'} onToggle={() => setRuleOpen(ruleOpen === 'death' ? '' : 'death')}>
            <p>One seat per email. A second character does not get a fresh entry.</p>
            <p>If you die, your LMS seat — alive or out, burned teams, picks, streak — moves to your next character on the same email. You do not pay again.</p>
          </RuleBlock>
          <RuleBlock title="Postponed & visibility" open={ruleOpen === 'extra'} onToggle={() => setRuleOpen(ruleOpen === 'extra' ? '' : 'extra')}>
            <p>If your pick’s match is postponed you get a free pass that week: no weekly bonus, streak unchanged, team still burned.</p>
            <p>Other players’ current-week picks stay hidden until the deadline.</p>
            <p>Gambling self-exclusion blocks joining and picking.</p>
          </RuleBlock>
        </div>
      )}

      {tab === 'play' && canPick && selectedId && (
        <div className="fixed left-0 right-0 z-30 px-3 md:hidden" style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }}>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirmPick}
            className="w-full min-h-[48px] rounded-lg bg-primary text-black font-heading font-bold text-sm shadow-lg disabled:opacity-50"
          >
            {busy ? 'Saving…' : myTeam === selectedId ? 'Pick saved' : 'Confirm pick'}
          </button>
        </div>
      )}
      {tab === 'play' && canPick && selectedId && (
        <div className="hidden md:block">
          <button type="button" disabled={busy} onClick={onConfirmPick} className="w-full min-h-[44px] rounded-lg bg-primary/20 border border-primary/50 text-primary font-heading font-bold">
            {busy ? 'Saving…' : 'Confirm pick'}
          </button>
        </div>
      )}
    </div>
  );
}

function intSafe(n) {
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : 0;
}

function TeamBtn({ name, selected, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[48px] px-2 text-[12px] font-heading font-bold ${
        selected ? 'bg-primary/25 text-primary' : 'bg-zinc-900 text-zinc-200'
      } disabled:opacity-40 disabled:text-zinc-500`}
    >
      {name}
    </button>
  );
}
