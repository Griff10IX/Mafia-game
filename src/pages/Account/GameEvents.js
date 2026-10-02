import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, Clock, Gift, Trophy, Medal, History } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import styles from '../../styles/noir.module.css';

const PAGE_STYLES = `
  @keyframes ge-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .ge-fade-in { animation: ge-fade-in 0.35s ease-out both; }
`;

const TABS = [
  { id: 'active', label: 'Active', icon: Trophy },
  { id: 'mine', label: 'My Wins', icon: Medal },
  { id: 'previous', label: 'Previous', icon: History },
  { id: 'world', label: 'World Buffs', icon: Zap },
];

const SCORE_HINTS = {
  crime: 'Successful crimes',
  gta: 'Successful GTAs',
  crime_gta: 'Crimes + GTAs (1 each)',
  melt: 'Bullets from melting',
  jailbust: 'Successful busts',
  booze: 'Booze sold',
  racket: 'Racket collects',
  oc: 'OC / Crew OC completions',
  hitlist: 'Hitlist NPC kills',
  mission: 'Missions completed',
  property: 'Property collects',
  grave: 'Grave Robber digs',
};

const MULTIPLIER_LABELS = {
  rank_points: 'Rank points',
  kill_cash: 'Kill / loot cash',
  gta_success: 'GTA success',
  bodyguard_cost: 'Bodyguard cost',
  racket_cooldown: 'Racket cooldown',
  racket_payout: 'Racket / OC payout',
  armour_weapon_cost: 'Armour & weapons',
};

const MULTIPLIER_KEYS = Object.keys(MULTIPLIER_LABELS);

function formatCountdown(expiresAt) {
  if (!expiresAt) return '';
  const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  if (diff <= 0) return 'Rotating soon';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function formatMult(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 1) return null;
  if (n < 1) return `×${n}`;
  return `×${n}`;
}

function formatPerkRemaining(ar) {
  if (ar?.attempts_remaining != null) {
    return `${ar.attempts_remaining} attempts left`;
  }
  if (!ar?.expires_at) return '';
  try {
    const until = new Date(String(ar.expires_at).replace('Z', 'Z'));
    const ms = until - new Date();
    if (ms <= 0) return 'Expired';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m left`;
  } catch {
    return '';
  }
}

function multiplierChips(ev) {
  if (!ev) return [];
  const chips = [];
  MULTIPLIER_KEYS.forEach((key) => {
    const raw = Number(ev[key] ?? 1);
    if (!Number.isFinite(raw) || raw === 1) return;
    const label = MULTIPLIER_LABELS[key] || key;
    const isDiscount = raw < 1 && (key.includes('cost') || key === 'racket_cooldown');
    chips.push({
      label,
      value: formatMult(raw),
      cls: isDiscount || raw > 1 ? (raw > 1 ? 'text-emerald-300' : 'text-sky-300') : 'text-foreground',
    });
  });
  return chips;
}

function StatChipGrid({ chips }) {
  if (!chips?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      {chips.map((c) => (
        <div key={c.label} className="rounded-md border border-zinc-700/40 bg-zinc-950/40 px-2.5 py-2 min-w-0">
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground truncate">{c.label}</div>
          <div className={`text-[11px] font-heading font-bold truncate ${c.cls || 'text-foreground'}`}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function prizeLabelFor(ev, row) {
  const stored = String(row?.prize_label || '').trim();
  if (stored) return stored;
  const match = (ev?.prize_table || []).find((p) => Number(p.rank) === Number(row?.rank));
  return String(match?.label || '').trim();
}

function PrizeTable({ rows }) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider px-0.5">Prizes</div>
      <ul className="list-none m-0 space-y-0.5">
        {rows.map((r) => (
          <li
            key={r.rank}
            className="flex items-baseline gap-2 text-[10px] font-heading rounded border border-zinc-700/30 bg-zinc-950/30 px-2 py-1"
          >
            <span className="text-amber-300 font-bold shrink-0 w-6">#{r.rank}</span>
            <span className="text-mutedForeground min-w-0 break-words">{r.label || '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const REFRESH_MS = 60_000;

export default function GameEvents() {
  const [tab, setTab] = useState('active');
  const [contest, setContest] = useState(null);
  const [wins, setWins] = useState([]);
  const [previous, setPrevious] = useState([]);
  const [eventData, setEventData] = useState(null);
  const [myPerks, setMyPerks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState('');
  const [worldCountdown, setWorldCountdown] = useState('');

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);

    const contestReq = api.get('/contests/active')
      .then((res) => setContest(res?.data || null))
      .catch(() => {
        if (!silent) {
          setContest(null);
          toast.error('Failed to load contest');
        }
      });

    const mineReq = api.get('/contests/mine')
      .then((res) => setWins(Array.isArray(res?.data?.wins) ? res.data.wins : []))
      .catch(() => {
        if (!silent) setWins([]);
      });

    const prevReq = api.get('/contests/previous')
      .then((res) => setPrevious(Array.isArray(res?.data?.events) ? res.data.events : []))
      .catch(() => {
        if (!silent) setPrevious([]);
      });

    const eventsReq = api.get('/events/active')
      .then((evRes) => setEventData(evRes?.data || null))
      .catch(() => {
        if (!silent) setEventData(null);
      });

    const perksReq = api.get('/loot-box/status')
      .then((lootRes) => {
        const rewards = Array.isArray(lootRes?.data?.active_rewards) ? lootRes.data.active_rewards : [];
        setMyPerks(rewards);
      })
      .catch(() => {
        if (!silent) setMyPerks([]);
      });

    return Promise.all([contestReq, mineReq, prevReq, eventsReq, perksReq]).finally(() => {
      if (!silent) setLoading(false);
    });
  }, []);

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const tick = () => setCountdown(formatCountdown(contest?.ends_at));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [contest?.ends_at]);

  useEffect(() => {
    const tick = () => setWorldCountdown(formatCountdown(eventData?.expires_at));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [eventData?.expires_at]);

  const activeEvents = useMemo(() => {
    if (Array.isArray(eventData?.active_events) && eventData.active_events.length) {
      return eventData.active_events;
    }
    const ids = eventData?.active_event_ids || [];
    const names = eventData?.active_event_names || [];
    return ids.map((id, i) => ({
      id,
      name: names[i] || id,
      message: '',
    }));
  }, [eventData]);

  const hasWorldEvents =
    !!eventData?.events_enabled
    && eventData?.event
    && eventData.event.id !== 'none'
    && activeEvents.length > 0;

  const combinedChips = multiplierChips(eventData?.event);
  const myGains = eventData?.my_gains || {};
  const combinedEv = eventData?.event || {};
  const n = (v) => Number(v || 0);
  const mult = (key) => Number(combinedEv[key] ?? 1);
  const formatCooldownSaved = (sec) => {
    const s = Math.max(0, Math.floor(n(sec)));
    if (s <= 0) return '0h';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };
  const gainsChips = [
    {
      label: 'Extra RP from events',
      value: `+${n(myGains.bonus_rp).toLocaleString()} RP`,
      cls: 'text-violet-300',
    },
    {
      label: 'Extra cash from events',
      value: `+$${n(myGains.bonus_cash).toLocaleString()}`,
      cls: 'text-emerald-300',
    },
  ];
  if (n(myGains.saved_cash) > 0 || mult('armour_weapon_cost') < 1 || mult('bodyguard_cost') < 1) {
    gainsChips.push({
      label: 'Cash saved on discounts',
      value: `$${n(myGains.saved_cash).toLocaleString()}`,
      cls: 'text-sky-300',
    });
  }
  if (n(myGains.saved_points) > 0 || mult('armour_weapon_cost') < 1 || mult('bodyguard_cost') < 1) {
    gainsChips.push({
      label: 'Points saved on discounts',
      value: n(myGains.saved_points).toLocaleString(),
      cls: 'text-sky-300',
    });
  }
  if (n(myGains.gta_boosted) > 0 || mult('gta_success') > 1) {
    gainsChips.push({
      label: 'Boosted GTA successes',
      value: n(myGains.gta_boosted).toLocaleString(),
      cls: 'text-amber-300',
    });
  }
  if (n(myGains.cooldown_seconds_saved) > 0 || (mult('racket_cooldown') > 0 && mult('racket_cooldown') < 1)) {
    gainsChips.push({
      label: 'Racket cooldown saved',
      value: formatCooldownSaved(myGains.cooldown_seconds_saved),
      cls: 'text-cyan-300',
    });
  }
  gainsChips.push({
    label: 'Boosted actions',
    value: n(myGains.uses).toLocaleString(),
    cls: 'text-foreground',
  });

  const scoreHint = SCORE_HINTS[contest?.score_key] || SCORE_HINTS[contest?.type_id] || 'Compete for ranked prizes';
  const durationLabel = contest?.duration_hours === 48 ? '48h window' : `${contest?.duration_hours || 6}h window`;

  return (
    <div className={`${styles.pageContent} p-3 sm:p-4 mobile-page-root`}>
      <style>{PAGE_STYLES}</style>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-lg sm:text-xl font-heading font-bold text-primary flex items-center gap-2">
            <Trophy size={22} />
            Events
          </h1>
        </div>
        <p className="text-[10px] sm:text-xs text-mutedForeground font-heading">
          Rotating contests with ranked prizes, plus world buff multipliers. One contest at a time (usually 6h; Mission Marathon is 48h).
        </p>
        <AutoRefreshNote seconds={60} />

        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${
                  on
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-zinc-700/40 bg-zinc-950/40 text-mutedForeground hover:text-foreground'
                }`}
              >
                <Icon size={12} />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'active' && (
          <section className="space-y-2 ge-fade-in">
            {loading && !contest ? (
              <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-[10px] text-mutedForeground font-heading mobile-panel`}>
                Loading…
              </div>
            ) : !contest?.id ? (
              <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-[10px] text-mutedForeground font-heading mobile-panel`}>
                No active contest right now. Check back soon.
              </div>
            ) : (
              <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel p-2.5 space-y-3`}>
                <div className="flex items-start gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
                    <Trophy size={14} className="text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-[12px] font-heading font-bold text-foreground truncate">{contest.name}</div>
                      {countdown ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-heading font-bold text-emerald-300">
                          <Clock size={9} />
                          {countdown}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[9px] text-mutedForeground font-heading mt-0.5">
                      {scoreHint} · {durationLabel}
                    </p>
                    {contest.me ? (
                      <p className="text-[10px] font-heading text-foreground mt-1">
                        Your score: <span className="text-primary font-bold">{Number(contest.me.score || 0).toLocaleString()}</span>
                        {contest.me.rank != null ? (
                          <> · Rank <span className="text-amber-300 font-bold">#{contest.me.rank}</span></>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider px-0.5 mb-1">Leaderboard</div>
                  <ul className="list-none m-0 space-y-0.5">
                    {Array.from({ length: 10 }, (_, i) => {
                      const row = contest.leaderboard?.[i];
                      const empty = !row;
                      return (
                        <li
                          key={row ? `${row.user_id}-${row.rank}` : `open-${i + 1}`}
                          className="flex items-center gap-2 text-[10px] font-heading rounded border border-zinc-700/30 bg-zinc-950/30 px-2 py-1.5"
                        >
                          <span className="text-amber-300 font-bold w-6 shrink-0">#{i + 1}</span>
                          <span className={`min-w-0 flex-1 truncate ${empty ? 'text-mutedForeground' : 'text-foreground'}`}>
                            {empty ? 'Open' : row.username}
                          </span>
                          <span className="text-mutedForeground shrink-0">
                            {empty ? '—' : Number(row.score || 0).toLocaleString()}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <PrizeTable rows={contest.prize_table} />
              </div>
            )}
          </section>
        )}

        {tab === 'mine' && (
          <section className="space-y-2 ge-fade-in">
            {!wins.length ? (
              <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-[10px] text-mutedForeground font-heading mobile-panel`}>
                No contest placements yet. Place top 10 to see wins here.
              </div>
            ) : (
              <ul className="list-none m-0 space-y-1.5">
                {wins.map((w) => (
                  <li
                    key={w.id}
                    className={`${styles.panel} rounded-md border border-amber-500/25 bg-amber-500/5 mobile-panel p-2.5 space-y-1`}
                  >
                    <div className="flex items-center gap-2">
                      <Medal size={14} className="text-amber-400 shrink-0" />
                      <span className="text-[11px] font-heading font-bold text-foreground truncate flex-1">{w.name}</span>
                      <span className="text-[10px] font-heading font-bold text-amber-300">#{w.rank}</span>
                    </div>
                    <p className="text-[9px] text-mutedForeground font-heading">
                      Score {Number(w.score || 0).toLocaleString()}
                      {w.ends_at ? ` · ended ${new Date(w.ends_at).toLocaleString()}` : ''}
                    </p>
                    {w.prize_label ? (
                      <p className="text-[10px] font-heading text-emerald-300">{w.prize_label}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'previous' && (
          <section className="space-y-2 ge-fade-in">
            {!previous.length ? (
              <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-[10px] text-mutedForeground font-heading mobile-panel`}>
                No finished contests yet.
              </div>
            ) : (
              <ul className="list-none m-0 space-y-2">
                {previous.map((ev) => (
                  <li
                    key={ev.id}
                    className={`${styles.panel} rounded-md border border-primary/20 mobile-panel p-2.5 space-y-2`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <History size={12} className="text-mutedForeground shrink-0" />
                      <span className="text-[11px] font-heading font-bold text-foreground">{ev.name}</span>
                      {ev.ends_at ? (
                        <span className="text-[9px] text-mutedForeground font-heading ml-auto">
                          {new Date(ev.ends_at).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                    {ev.results?.length ? (
                      <ul className="list-none m-0 space-y-0.5">
                        {ev.results.slice(0, 10).map((r) => {
                          const prize = prizeLabelFor(ev, r);
                          return (
                            <li
                              key={`${ev.id}-${r.rank}-${r.user_id}`}
                              className="rounded border border-zinc-700/30 bg-zinc-950/30 px-2 py-1"
                            >
                              <div className="flex items-center gap-2 text-[10px] font-heading">
                                <span className="text-amber-300 font-bold w-6 shrink-0">#{r.rank}</span>
                                <span className="min-w-0 flex-1 truncate">{r.username || r.user_id}</span>
                                <span className="text-mutedForeground shrink-0">{Number(r.score || 0).toLocaleString()}</span>
                              </div>
                              {prize ? (
                                <p className="text-[9px] font-heading text-emerald-300 pl-8 mt-0.5 break-words">{prize}</p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-[9px] text-mutedForeground font-heading">No placers.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'world' && (
          <>
            <section className="space-y-2 ge-fade-in">
              <div className="flex items-center gap-2 px-0.5">
                <Gift size={12} className="text-amber-400" />
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">My game events perks</h2>
              </div>
              {myPerks.length === 0 ? (
                <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-[10px] text-mutedForeground font-heading mobile-panel`}>
                  No personal loot perks active. Open a loot box or check{' '}
                  <Link to="/account/inventory" className="text-primary hover:underline">Inventory → In use</Link>
                  {' '}for armoury tokens.
                </div>
              ) : (
                <ul className={`${styles.panel} rounded-md border border-amber-500/25 bg-amber-500/5 mobile-panel p-2 list-none m-0 space-y-1.5`}>
                  {myPerks.map((ar, i) => {
                    const left = formatPerkRemaining(ar);
                    return (
                      <li
                        key={`${ar.type || ar.name || 'perk'}-${i}`}
                        className="flex items-center gap-2 text-[10px] font-heading text-foreground rounded border border-amber-500/20 bg-zinc-950/40 px-2.5 py-2"
                      >
                        <Zap size={12} className="text-amber-400 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{ar.name || ar.type || 'Perk'}</span>
                        {left ? <span className="text-[9px] text-mutedForeground shrink-0">{left}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="space-y-2 ge-fade-in" style={{ animationDelay: '0.04s' }}>
              <div className="flex items-center gap-2 px-0.5">
                <Zap size={12} className="text-primary" />
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Active world events</h2>
                {worldCountdown && hasWorldEvents ? (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-heading font-bold text-emerald-300">
                    <Clock size={9} />
                    {worldCountdown}
                  </span>
                ) : null}
              </div>

              {loading && !eventData ? (
                <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-[10px] text-mutedForeground font-heading mobile-panel`}>
                  Loading…
                </div>
              ) : !hasWorldEvents ? (
                <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-[10px] text-mutedForeground font-heading mobile-panel`}>
                  No active world events right now. Check back when the next rotation starts.
                </div>
              ) : (
                <div className="space-y-2">
                  {activeEvents.map((ev, idx) => {
                    const chips = multiplierChips(ev);
                    return (
                      <div
                        key={ev.id || idx}
                        className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel p-2.5 space-y-2 ge-fade-in`}
                        style={{ animationDelay: `${idx * 0.04}s` }}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
                            <Zap size={14} className="text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-heading font-bold text-foreground truncate">{ev.name}</div>
                            {ev.message ? (
                              <p className="text-[9px] text-mutedForeground font-heading mt-0.5 leading-relaxed">{ev.message}</p>
                            ) : null}
                          </div>
                        </div>
                        <StatChipGrid chips={chips} />
                      </div>
                    );
                  })}
                  {activeEvents.length > 1 && combinedChips.length > 0 && (
                    <div className={`${styles.panel} rounded-md border border-primary/25 bg-primary/5 mobile-panel p-2.5 space-y-2`}>
                      <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Combined effect</div>
                      <p className="text-[10px] font-heading text-foreground">{eventData.event?.name}</p>
                      <StatChipGrid chips={combinedChips} />
                    </div>
                  )}
                  {eventData.expires_at && (
                    <p className="text-[9px] text-mutedForeground font-heading px-0.5">
                      Rotates at {new Date(eventData.expires_at).toLocaleString(undefined, { timeZone: 'UTC' })} UTC
                    </p>
                  )}
                </div>
              )}

              {!loading && (
                <div className={`${styles.panel} rounded-md border border-violet-500/25 bg-violet-500/5 mobile-panel p-2.5 space-y-2`}>
                  <div className="text-[10px] font-heading font-bold text-violet-300 uppercase tracking-wider">Your event gains</div>
                  <p className="text-[9px] text-mutedForeground font-heading leading-relaxed">
                    Lifetime extras from world events: RP, cash, discount savings, boosted GTAs, and racket cooldown time.
                  </p>
                  <StatChipGrid chips={gainsChips} />
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
