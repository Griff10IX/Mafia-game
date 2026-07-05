import { useState, useEffect, useCallback, useMemo } from 'react';
import { Trophy, Users, Grid3X3, Swords, Medal, BarChart3, Info, Minus, Plus, Globe } from 'lucide-react';
import { toast } from 'sonner';
import api, { getApiErrorMessage } from '../../utils/api';
import styles from '../../styles/noir.module.css';
import { formatGameDateTime } from '../../utils/gameDateTime';
import { getWcFlagIso } from '../../utils/worldCupFlags';

const WC_STYLES = `
  .wc-page { --wc-green: #1a4d2e; --wc-green-dark: #0d2818; }
  .wc-fade-in { animation: wc-fade-in 0.35s ease-out both; }
  @keyframes wc-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .wc-fade-in { animation: none; } }
  .wc-tab-scroll { -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none; }
  .wc-tab-scroll::-webkit-scrollbar { display: none; }
  .wc-hero {
    background: linear-gradient(135deg, var(--wc-green) 0%, var(--wc-green-dark) 100%);
    border: 1px solid rgba(212, 175, 55, 0.25);
  }
  .wc-tab-active { border-bottom: 2px solid var(--noir-primary, #d4af37); background: rgba(212, 175, 55, 0.08); }
  .wc-group-card {
    background: linear-gradient(165deg, rgba(26, 77, 46, 0.22) 0%, rgba(13, 40, 24, 0.08) 42%, transparent 100%);
  }
  .wc-group-head {
    border-bottom: 1px solid rgba(212, 175, 55, 0.14);
    padding-bottom: 0.5rem;
    margin-bottom: 0.35rem;
  }
  .wc-team-chip {
    background: linear-gradient(135deg, rgba(26, 77, 46, 0.35) 0%, rgba(13, 40, 24, 0.2) 100%);
  }
`;

const TABS = [
  { id: 'overview', label: 'Overview', short: 'Info', Icon: Info },
  { id: 'teams', label: 'My Teams', short: 'Teams', Icon: Users },
  { id: 'groups', label: 'Groups', short: 'Groups', Icon: Grid3X3 },
  { id: 'matches', label: 'Matches', short: 'Matches', Icon: Swords },
  { id: 'knockout', label: 'Knockout', short: 'Knockout', Icon: Medal },
  { id: 'leaderboard', label: 'Leaderboard', short: 'Board', Icon: BarChart3 },
];

function WcPointsBadge({ pts }) {
  return (
    <span className="text-[9px] font-heading uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded tabular-nums">
      {Number(pts || 0).toLocaleString()} PTS
    </span>
  );
}

function WcEarningsSummary({ earnings, entered, ghostEntry }) {
  if (!entered || ghostEntry) return null;
  const paid = Number(earnings?.points_paid || 0);
  const pending = Number(earnings?.points_pending || 0);
  const total = Number(earnings?.points_earned_total ?? paid + pending);
  const groupPts = Number(earnings?.group_winner_points_paid || 0) + Number(earnings?.group_winner_points_pending || 0);
  return (
    <WcPanel accent className="p-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-[10px] font-heading uppercase tracking-wider text-mutedForeground">Your World Cup earnings</p>
        {groupPts > 0 ? (
          <p className="text-[9px] text-mutedForeground mt-0.5">Group winners: {groupPts.toLocaleString()} pts</p>
        ) : null}
      </div>
      <div className="text-right">
        <p className="text-lg font-heading text-primary tabular-nums">{total.toLocaleString()} pts</p>
        {paid > 0 && pending > 0 ? (
          <p className="text-[10px] text-mutedForeground">{paid.toLocaleString()} received · {pending.toLocaleString()} pending</p>
        ) : pending > 0 ? (
          <p className="text-[10px] text-amber-300">{pending.toLocaleString()} pending staff approval</p>
        ) : paid > 0 ? (
          <p className="text-[10px] text-emerald-400">{paid.toLocaleString()} received</p>
        ) : (
          <p className="text-[10px] text-mutedForeground">Correct picks pay out after staff approval</p>
        )}
      </div>
    </WcPanel>
  );
}

function GroupPickResult({ pred }) {
  if (!pred?.settled) return null;
  const pts = Number(pred.points_awarded || 0);
  if (pts <= 0) {
    return <span className="text-[9px] text-red-400 uppercase font-heading">Wrong</span>;
  }
  if (pred.payout_status === 'pending') {
    return <span className="text-[9px] text-amber-300 uppercase font-heading tabular-nums">+{pts.toLocaleString()} pend</span>;
  }
  if (pred.payout_status === 'ghost') return null;
  return <span className="text-[9px] text-emerald-400 uppercase font-heading tabular-nums">+{pts.toLocaleString()} pts</span>;
}

function WcEnterBanner({ entered, canEnter, lateEntryAvailable, entering, onEnter }) {
  if (entered) return null;
  return (
    <WcPanel className="p-4 space-y-3 border-amber-500/30 bg-amber-950/20">
      <p className="text-sm text-amber-100 font-heading leading-relaxed">
        {canEnter ? (
          lateEntryAvailable ? (
            <>Join the World Cup event to save predictions. The team draft already ran on this account — you can still predict scores and earn points, but you won&apos;t receive drafted nations for the jackpot.</>
          ) : (
            <>Join the World Cup event before you can change scores or save predictions. Each account must enter separately (a new character after death does not carry over your old entry).</>
          )
        ) : (
          <>World Cup entry is closed for new players. Contact staff if you need access on this account.</>
        )}
      </p>
      {canEnter ? (
        <button
          type="button"
          disabled={entering}
          onClick={onEnter}
          className="w-full sm:w-auto min-h-[44px] px-5 rounded-md bg-primary text-primary-foreground font-heading uppercase text-sm tracking-wider hover:opacity-90 disabled:opacity-50"
        >
          {entering ? 'Joining…' : lateEntryAvailable ? 'Join for predictions' : 'Enter World Cup Event'}
        </button>
      ) : null}
    </WcPanel>
  );
}

function WcPanel({ children, className = '', accent = false }) {
  return (
    <div className={`${styles.panel} mobile-panel rounded-lg border border-primary/20 overflow-hidden ${accent ? 'border-t-2 border-t-primary/50' : ''} ${className}`}>
      {children}
    </div>
  );
}

function WcFlag({ team, size = 'md', className = '' }) {
  const [failed, setFailed] = useState(false);
  const iso = getWcFlagIso(team);
  const sizes = {
    sm: { w: 20, h: 15, src: '16x12', src2x: '32x24' },
    md: { w: 28, h: 21, src: '32x24', src2x: '64x48' },
    lg: { w: 40, h: 30, src: '48x36', src2x: '96x72' },
  };
  const { w, h, src, src2x } = sizes[size] || sizes.md;

  useEffect(() => {
    setFailed(false);
  }, [iso]);

  if (!iso || failed) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-[3px] border border-primary/25 bg-primary/5 text-mutedForeground ${className}`}
        style={{ width: w, height: h }}
        aria-hidden
      >
        <Globe size={Math.max(11, Math.round(w * 0.45))} strokeWidth={2} />
      </span>
    );
  }
  return (
    <img
      alt=""
      src={`https://flagcdn.com/${src}/${iso}.png`}
      srcSet={`https://flagcdn.com/${src2x}/${iso}.png 2x`}
      width={w}
      height={h}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-[3px] object-cover border border-black/25 shadow-sm ${className}`}
      style={{ width: w, height: h }}
    />
  );
}

function WcTeamRow({ team, selected, onSelect, disabled }) {
  if (!team) return null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect?.(team.id)}
      className={`w-full flex items-center gap-3 min-h-[44px] px-2.5 py-2 rounded-md text-left transition-all ${
        selected
          ? 'bg-primary/12 border border-primary/35'
          : 'hover:bg-primary/6 border border-transparent'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <WcFlag team={team} size="md" className={selected ? 'ring-2 ring-primary/45 ring-offset-1 ring-offset-transparent' : ''} />
      <span className="text-sm text-foreground flex-1 truncate">{team.name}</span>
      {selected ? (
        <span className="text-[9px] text-primary font-heading uppercase tracking-wider shrink-0">Your pick</span>
      ) : null}
    </button>
  );
}

export default function WorldCup() {
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [endedMessage, setEndedMessage] = useState('');
  const [status, setStatus] = useState(null);
  const [teams, setTeams] = useState([]);
  const [groups, setGroups] = useState([]);
  const [matches, setMatches] = useState([]);
  const [knockoutRounds, setKnockoutRounds] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [earnings, setEarnings] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [draftResults, setDraftResults] = useState(null);
  const [tab, setTab] = useState('overview');
  const [entering, setEntering] = useState(false);
  const [saving, setSaving] = useState(false);

  const points = status?.points || {};
  const pendingPayouts = status?.pending_payouts ?? predictions.filter((p) => p.payout_status === 'pending').length;
  const predsByKey = useMemo(() => {
    const m = {};
    for (const p of predictions) {
      m[`${p.type}:${p.target_id}`] = p;
    }
    return m;
  }, [predictions]);

  const knockoutMatches = useMemo(
    () => matches.filter((m) => m.is_knockout || (m.stage && m.stage !== 'group')),
    [matches],
  );

  const groupMatches = useMemo(
    () => matches.filter((m) => m.stage === 'group' || (!m.is_knockout && m.stage !== 'knockout' && !m.stage)),
    [matches],
  );

  const teamsByGroup = useMemo(() => {
    const m = {};
    for (const t of teams) {
      const g = t.group_id || '?';
      if (!m[g]) m[g] = [];
      m[g].push(t);
    }
    return m;
  }, [teams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, tRes, mRes, pRes] = await Promise.all([
        api.get('/world-cup/status'),
        api.get('/world-cup/teams'),
        api.get('/world-cup/matches'),
        api.get('/world-cup/my-predictions'),
      ]);
      if (st.data?.enabled === false) {
        setDisabled(true);
        setEndedMessage(st.data.ended_message || 'World Cup 2026 has ended.');
        setStatus(null);
        return;
      }
      setDisabled(false);
      setStatus(st.data);
      setTeams(tRes.data?.teams || []);
      setGroups(tRes.data?.groups || []);
      setMatches(mRes.data?.matches || []);
      setKnockoutRounds(mRes.data?.knockout_rounds || []);
      setPredictions(pRes.data?.predictions || []);
      setEarnings(pRes.data?.earnings ?? st.data?.earnings ?? null);
    } catch (e) {
      if (e.response?.status === 403) {
        setDisabled(true);
        setEndedMessage(getApiErrorMessage(e));
      } else {
        toast.error(getApiErrorMessage(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      const r = await api.get('/world-cup/leaderboard');
      setLeaderboard(r.data);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }, []);

  const loadDraftResults = useCallback(async () => {
    try {
      const r = await api.get('/world-cup/draft-results');
      setDraftResults(r.data);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === 'leaderboard' && !disabled) loadLeaderboard();
  }, [tab, disabled, loadLeaderboard]);

  useEffect(() => {
    if (tab === 'teams' && !disabled) loadDraftResults();
  }, [tab, disabled, loadDraftResults, status?.config?.draft_run]);

  const enterEvent = async () => {
    setEntering(true);
    try {
      const res = await api.post('/world-cup/enter');
      toast.success(
        res.data?.late_entry
          ? 'Joined for predictions — match picks are unlocked (no draft nations on this account).'
          : 'You joined the World Cup predictions event!'
      );
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setEntering(false);
    }
  };

  const enterGhostEvent = async () => {
    setEntering(true);
    try {
      await api.post('/world-cup/enter-ghost');
      toast.success('Ghost entry active — test the event without affecting the real raffle pool.');
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setEntering(false);
    }
  };

  const tournamentPicksLocked = status?.tournament_picks_locked === true
    || status?.tournament_started === true
    || (status?.tournament_start_at ? new Date(status.tournament_start_at).getTime() <= Date.now() : false);

  const canEnter = status?.can_enter === true
    || (!status?.entered && status?.config?.entry_open !== false && status?.enabled !== false);
  const lateEntryAvailable = status?.late_entry_available === true;

  const savePrediction = async (type, target_id, value) => {
    const lockEarlyTypes = ['group_winner', 'second_place', 'third_place'];
    if (tournamentPicksLocked && lockEarlyTypes.includes(type)) {
      toast.error('Tournament has started — these picks are locked');
      return;
    }
    setSaving(true);
    try {
      await api.post('/world-cup/predictions', { type, target_id, value });
      toast.success('Prediction saved');
      const pRes = await api.get('/world-cup/my-predictions');
      setPredictions(pRes.data?.predictions || []);
      setEarnings(pRes.data?.earnings ?? null);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const groupLocked = (gid) => {
    if (tournamentPicksLocked) return true;
    const lock = status?.group_locks?.[gid];
    if (!lock) return false;
    return new Date(lock).getTime() <= Date.now();
  };

  if (loading) {
    return (
      <div className={`wc-page space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(10rem+env(safe-area-inset-bottom))]`}>
        <style>{WC_STYLES}</style>
        <p className="text-sm text-mutedForeground p-4">Loading World Cup…</p>
      </div>
    );
  }

  if (disabled) {
    return (
      <div className={`wc-page space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(10rem+env(safe-area-inset-bottom))]`} data-testid="world-cup-ended">
        <style>{WC_STYLES}</style>
        <WcPanel className="p-8 text-center wc-fade-in">
          <Trophy className="mx-auto text-primary mb-4" size={40} />
          <h1 className="text-lg font-heading font-bold text-primary uppercase tracking-[0.12em] mb-2">World Cup 2026</h1>
          <p className="text-sm text-mutedForeground">{endedMessage}</p>
        </WcPanel>
      </div>
    );
  }

  return (
    <div className={`wc-page space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(10rem+env(safe-area-inset-bottom))]`} data-testid="world-cup-page">
      <style>{WC_STYLES}</style>

      <div className="wc-hero rounded-lg p-4 wc-fade-in">
        <div className="flex items-start gap-3">
          <Trophy className="text-amber-300 shrink-0 mt-0.5" size={28} />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-heading font-bold text-white uppercase tracking-[0.12em]">World Cup 2026</h1>
            <p className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wider mt-1">USA · Canada · Mexico</p>
            <div className="flex flex-wrap gap-3 mt-3">
              {[
                { iso: 'us', label: 'USA' },
                { iso: 'ca', label: 'Canada' },
                { iso: 'mx', label: 'Mexico' },
              ].map(({ iso, label }) => (
                <span key={iso} className="inline-flex items-center gap-1.5 text-[10px] text-white/90 font-heading uppercase tracking-wider">
                  <img
                    alt=""
                    src={`https://flagcdn.com/32x24/${iso}.png`}
                    srcSet={`https://flagcdn.com/64x48/${iso}.png 2x`}
                    width={20}
                    height={15}
                    className="rounded-[2px] border border-white/20 object-cover"
                  />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {status?.entered ? (
        <WcEarningsSummary earnings={earnings} entered={status?.entered} ghostEntry={status?.ghost_entry} />
      ) : null}

      <div className="wc-tab-scroll flex gap-1 p-1 rounded-lg border border-primary/20 bg-primary/5 overflow-x-auto snap-x snap-mandatory">
        {TABS.map(({ id, label, short, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`snap-start shrink-0 flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-md text-[10px] sm:text-xs font-heading uppercase tracking-wider transition-colors ${
              tab === id ? 'wc-tab-active text-primary' : 'text-mutedForeground hover:text-foreground'
            }`}
          >
            <Icon size={14} className="shrink-0" />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{short}</span>
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-3 wc-fade-in">
          <WcPanel accent className="p-4 space-y-3">
            <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">How it works</h2>
            <ul className="space-y-2 text-sm text-mutedForeground">
              <li className="flex gap-2"><span className="text-primary">1.</span> Join free — enter before the team draft (auto-runs 24 hours before kickoff).</li>
              <li className="flex gap-2"><span className="text-primary">2.</span> Every entrant gets assigned nation(s) — all 48 teams are distributed (more teams per player if fewer entrants).</li>
              <li className="flex gap-2"><span className="text-primary">3.</span> If any assigned nation wins the World Cup, earn <WcPointsBadge pts={points.jackpot_points} />.</li>
              <li className="flex gap-2"><span className="text-primary">4.</span> Predict group winners — <WcPointsBadge pts={points.group_winner_points} /> each.</li>
              <li className="flex gap-2"><span className="text-primary">5.</span> Knockout tab — pick match winners and exact scores; 2nd &amp; 3rd place picks too.</li>
            </ul>
            {!status?.entered ? (
              <div className="space-y-2">
                {canEnter ? (
                  <>
                    <button
                      type="button"
                      disabled={entering}
                      onClick={enterEvent}
                      className="w-full min-h-[44px] rounded-md bg-primary text-primary-foreground font-heading uppercase text-sm tracking-wider hover:opacity-90 disabled:opacity-50"
                    >
                      {entering ? 'Joining…' : lateEntryAvailable ? 'Join for predictions' : 'Enter World Cup Event'}
                    </button>
                    {lateEntryAvailable ? (
                      <p className="text-[10px] text-amber-300/90 font-heading uppercase tracking-wider">
                        Team draft already ran — match and knockout predictions still earn points; no jackpot nations.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-amber-300 font-heading">Entry is closed for new accounts.</p>
                )}
                {status?.can_ghost_enter ? (
                  <button
                    type="button"
                    disabled={entering}
                    onClick={enterGhostEvent}
                    className="w-full min-h-[44px] rounded-md border border-amber-500/40 bg-amber-950/30 text-amber-200 font-heading uppercase text-xs tracking-wider hover:opacity-90 disabled:opacity-50"
                  >
                    {entering ? 'Joining…' : 'Ghost enter (admin test)'}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-sm text-emerald-400 font-heading">
                  ✓ You&apos;re entered{status?.config?.draft_run ? ' — draft complete' : status?.draft_scheduled_at ? ' — draft auto-runs 24h before kickoff' : ' — awaiting fixtures for draft schedule'}.
                </p>
                {status?.ghost_entry ? (
                  <p className="text-[10px] text-amber-300/90 font-heading uppercase tracking-wider">
                    Ghost entry — your teams don&apos;t affect the real raffle; no points are awarded.
                  </p>
                ) : null}
                {!status?.ghost_entry && pendingPayouts > 0 ? (
                  <p className="text-[10px] text-amber-300/90 font-heading uppercase tracking-wider">
                    {pendingPayouts} correct prediction{pendingPayouts === 1 ? '' : 's'} awaiting staff approval before points are sent.
                  </p>
                ) : null}
              </div>
            )}
          </WcPanel>
        </div>
      )}

      {tab === 'teams' && (
        <div className="space-y-3 wc-fade-in">
          <WcPanel className="p-4">
            <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider mb-2">Your drafted teams</h2>
            {!status?.config?.draft_run ? (
              <div className="space-y-2">
                <p className="text-sm text-mutedForeground">
                  The team draft runs automatically <strong className="text-foreground">24 hours before</strong> the first World Cup match.
                  {status?.draft_scheduled_at ? (
                    <> Scheduled: {formatGameDateTime(status.draft_scheduled_at)}.</>
                  ) : (
                    <> Sync fixtures in admin to set the kickoff time.</>
                  )}
                </p>
                {status?.draft_scheduled_at && (
                  <p className="text-[10px] text-amber-300/90 font-heading uppercase tracking-wider">
                    {formatDraftCountdown(status.draft_scheduled_at)}
                  </p>
                )}
              </div>
            ) : (status?.drafted_teams || []).length === 0 ? (
              <p className="text-sm text-mutedForeground">You did not enter before the draft — no teams assigned.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(status.drafted_teams || []).map((t) => (
                  <div key={t.id} className="wc-team-chip flex items-center gap-2.5 px-3 py-2 rounded-lg border border-primary/25 min-h-[44px]">
                    <WcFlag team={t} size="md" />
                    <span className="text-sm font-heading text-foreground">{t.name}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-mutedForeground mt-3">
              {status?.ghost_entry
                ? 'Ghost test mode — assigned teams mirror the raffle but do not remove nations from real players.'
                : 'All 48 nations are assigned across entrants — fewer players means more teams each. Jackpot if any of yours wins the tournament.'}
            </p>
          </WcPanel>

          {draftResults?.draft_run && (draftResults.assignments || []).length > 0 && (
            <WcPanel className="p-4 overflow-x-auto">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Everyone&apos;s draft</h2>
                <span className="text-[10px] text-mutedForeground font-heading">
                  {draftResults.real_entrants} players · {draftResults.total_teams_distributed}/{draftResults.total_teams} teams ·{' '}
                  {draftResults.teams_per_user_min}–{draftResults.teams_per_user_max} each
                </span>
              </div>
              <table className="w-full text-xs min-w-[280px]">
                <thead>
                  <tr className="border-b border-primary/10 text-left text-mutedForeground font-heading uppercase">
                    <th className="p-2">Player</th>
                    <th className="p-2 w-10 text-center">#</th>
                    <th className="p-2">Nations</th>
                  </tr>
                </thead>
                <tbody>
                  {(draftResults.assignments || []).map((row) => (
                    <tr key={row.user_id} className="border-b border-primary/5 align-top">
                      <td className="p-2 text-sm text-foreground font-heading">{row.username}</td>
                      <td className="p-2 text-center tabular-nums text-primary">{row.team_count}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1.5">
                          {(row.teams || []).map((t) => (
                            <span
                              key={t.id}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/15 bg-primary/5"
                              title={t.name}
                            >
                              <WcFlag team={t} size="sm" />
                              <span className="text-[10px] truncate max-w-[72px]">{t.name}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </WcPanel>
          )}
        </div>
      )}

      {tab === 'groups' && (
        <div className="space-y-3 wc-fade-in">
          <WcEnterBanner
            entered={status?.entered}
            canEnter={canEnter}
            lateEntryAvailable={lateEntryAvailable}
            entering={entering}
            onEnter={enterEvent}
          />
          {tournamentPicksLocked && (
            <WcPanel className="p-3 text-[10px] text-amber-300/90 font-heading uppercase tracking-wider">
              Tournament has started — group winner picks are locked and cannot be changed.
            </WcPanel>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((gid) => {
            const locked = groupLocked(gid);
            const pred = predsByKey[`group_winner:${gid}`];
            const pickId = pred?.value?.team_id || pred?.value;
            return (
              <WcPanel key={gid} className="p-3 wc-group-card">
                <div className="wc-group-head flex items-center justify-between gap-2">
                  <span className="font-heading font-bold text-primary text-base tracking-wide">Group {gid}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <GroupPickResult pred={pred} />
                    <WcPointsBadge pts={points.group_winner_points} />
                  </div>
                </div>
                {locked && !tournamentPicksLocked && <p className="text-[10px] text-amber-400 mb-2 uppercase font-heading">Locked</p>}
                <div className="space-y-1">
                  {(teamsByGroup[gid] || []).map((t) => (
                    <WcTeamRow
                      key={t.id}
                      team={t}
                      selected={pickId === t.id}
                      disabled={locked || saving || !status?.entered}
                      onSelect={(id) => savePrediction('group_winner', gid, { team_id: id })}
                    />
                  ))}
                </div>
              </WcPanel>
            );
          })}
          </div>
        </div>
      )}

      {tab === 'matches' && (
        <MatchPredictionsTab
          matches={groupMatches}
          predsByKey={predsByKey}
          points={points}
          entered={status?.entered}
          canEnter={canEnter}
          lateEntryAvailable={lateEntryAvailable}
          entering={entering}
          onEnter={enterEvent}
          saving={saving}
          onSave={savePrediction}
        />
      )}

      {tab === 'knockout' && (
        <KnockoutTab
          matches={knockoutMatches}
          knockoutRounds={knockoutRounds}
          teams={teams}
          predsByKey={predsByKey}
          points={points}
          entered={status?.entered}
          canEnter={canEnter}
          lateEntryAvailable={lateEntryAvailable}
          entering={entering}
          onEnter={enterEvent}
          saving={saving}
          picksLocked={tournamentPicksLocked}
          onSave={savePrediction}
        />
      )}

      {tab === 'leaderboard' && (
        <div className="space-y-3 wc-fade-in">
          {status?.ghost_entry ? (
            <WcPanel className="p-3 text-[10px] text-amber-300/90 font-heading uppercase tracking-wider">
              Ghost entry — leaderboard and points are for real players only. Predictions still settle for testing.
            </WcPanel>
          ) : leaderboard?.my_points != null ? (
            <WcPanel accent className="p-3 flex justify-between items-center sticky top-0 z-10">
              <span className="text-sm font-heading text-foreground">Your rank</span>
              <span className="text-sm text-primary font-heading tabular-nums text-right">
                #{leaderboard.my_rank || '—'} · {Number(leaderboard.my_points || 0).toLocaleString()} pts paid
                {Number(earnings?.points_pending || 0) > 0 ? (
                  <span className="block text-[10px] text-amber-300 font-normal">+{Number(earnings.points_pending).toLocaleString()} pending</span>
                ) : null}
              </span>
            </WcPanel>
          ) : null}
          <WcPanel className="divide-y divide-primary/10">
            {(leaderboard?.leaderboard || []).map((row) => (
              <div key={row.user_id} className="flex items-center gap-3 px-3 py-2.5 min-h-[44px]">
                <span className="w-8 text-sm font-heading text-mutedForeground tabular-nums">#{row.rank}</span>
                <span className="flex-1 text-sm text-foreground truncate">{row.username}</span>
                <span className="text-sm text-primary tabular-nums">{Number(row.points || 0).toLocaleString()}</span>
              </div>
            ))}
            {!leaderboard?.leaderboard?.length && <p className="p-4 text-sm text-mutedForeground">No scores yet.</p>}
          </WcPanel>
        </div>
      )}
    </div>
  );
}

function formatDraftCountdown(draftScheduledAt) {
  if (!draftScheduledAt) return null;
  const ms = new Date(draftScheduledAt).getTime() - Date.now();
  if (ms <= 0) return 'Team draft is due — running automatically soon';
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours >= 48) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h until team draft`;
  }
  return `${hours}h ${mins}m until team draft`;
}

function ScoreStepper({ value, onChange, disabled, disabledHint }) {
  const v = Number(value) || 0;
  const softBlock = Boolean(disabled && disabledHint);
  const hardDisabled = Boolean(disabled && !disabledHint);
  const bump = (delta) => {
    if (disabled) {
      if (disabledHint) toast.error(disabledHint);
      return;
    }
    onChange(v + delta);
  };
  const minusDisabled = hardDisabled || (!softBlock && v <= 0);
  const plusDisabled = hardDisabled || (!softBlock && v >= 15);
  return (
    <div className={`flex items-center gap-1 ${disabled ? 'opacity-50' : ''}`}>
      <button type="button" disabled={minusDisabled} onClick={() => bump(-1)} className="min-w-[44px] min-h-[44px] rounded border border-primary/20 flex items-center justify-center disabled:cursor-not-allowed">
        <Minus size={16} />
      </button>
      <span className="w-8 text-center font-heading tabular-nums">{v}</span>
      <button type="button" disabled={plusDisabled} onClick={() => bump(1)} className="min-w-[44px] min-h-[44px] rounded border border-primary/20 flex items-center justify-center disabled:cursor-not-allowed">
        <Plus size={16} />
      </button>
    </div>
  );
}

function MatchPredictionsTab({ matches, predsByKey, points, entered, canEnter, lateEntryAvailable, entering, onEnter, saving, onSave }) {
  const [filter, setFilter] = useState('all');
  const groupIds = useMemo(() => {
    const ids = new Set(matches.map((m) => m.group_id).filter(Boolean));
    return [...ids].sort();
  }, [matches]);
  const filtered = useMemo(() => {
    if (filter === 'all') return matches;
    return matches.filter((m) => m.group_id === filter);
  }, [matches, filter]);

  return (
    <div className="space-y-3 wc-fade-in">
      <WcEnterBanner
        entered={entered}
        canEnter={canEnter}
        lateEntryAvailable={lateEntryAvailable}
        entering={entering}
        onEnter={onEnter}
      />
      <p className="text-[10px] text-mutedForeground font-heading px-1">
        Group-stage matches only — knockout fixtures are on the Knockout tab.
      </p>
      <div className="wc-tab-scroll flex gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`shrink-0 px-3 py-2 min-h-[44px] rounded-full text-[10px] font-heading uppercase ${
            filter === 'all' ? 'bg-primary/15 text-primary border border-primary/30' : 'text-mutedForeground border border-primary/10'
          }`}
        >
          All groups
        </button>
        {groupIds.map((gid) => (
          <button
            key={gid}
            type="button"
            onClick={() => setFilter(gid)}
            className={`shrink-0 px-3 py-2 min-h-[44px] rounded-full text-[10px] font-heading uppercase ${
              filter === gid ? 'bg-primary/15 text-primary border border-primary/30' : 'text-mutedForeground border border-primary/10'
            }`}
          >
            Group {gid}
          </button>
        ))}
      </div>
      {filtered.map((m) => (
        <MatchCard key={m.id} match={m} predsByKey={predsByKey} points={points} entered={entered} saving={saving} onSave={onSave} />
      ))}
      {!filtered.length && <p className="text-sm text-mutedForeground p-4">No group matches scheduled yet.</p>}
    </div>
  );
}

function MatchCard({ match, predsByKey, points, entered, saving, onSave, knockoutPickMode = false }) {
  const [home, setHome] = useState(() => predsByKey[`match_score:${match.id}`]?.value?.home ?? 0);
  const [away, setAway] = useState(() => predsByKey[`match_score:${match.id}`]?.value?.away ?? 0);
  const [scorer, setScorer] = useState(() => predsByKey[`match_scorer:${match.id}`]?.value?.name || '');
  const locked = match.locked || match.status === 'settled';
  const controlsDisabled = !entered || saving;
  const disabledHint = !entered ? 'Join the World Cup event first (Overview or banner above).' : null;
  const scorePred = predsByKey[`match_score:${match.id}`]?.value;
  const pickedWinnerId = useMemo(() => {
    if (!scorePred) return null;
    const h = Number(scorePred.home) || 0;
    const a = Number(scorePred.away) || 0;
    if (h > a) return match.home_team?.id;
    if (a > h) return match.away_team?.id;
    return null;
  }, [scorePred, match.home_team?.id, match.away_team?.id]);

  const pickWinner = (side) => {
    if (controlsDisabled) {
      if (disabledHint) toast.error(disabledHint);
      return;
    }
    if (side === 'home') {
      setHome(1);
      setAway(0);
      onSave('match_score', match.id, { home: 1, away: 0 });
    } else {
      setHome(0);
      setAway(1);
      onSave('match_score', match.id, { home: 0, away: 1 });
    }
  };

  useEffect(() => {
    const ps = predsByKey[`match_score:${match.id}`]?.value;
    if (ps) {
      setHome(ps.home ?? 0);
      setAway(ps.away ?? 0);
    }
    const sc = predsByKey[`match_scorer:${match.id}`]?.value?.name;
    if (sc) setScorer(sc);
  }, [predsByKey, match.id]);

  const homeTeam = match.home_team;
  const awayTeam = match.away_team;

  return (
    <WcPanel className="p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {match.round_label && (
          <span className="text-[9px] font-heading uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded">
            {match.round_label}
          </span>
        )}
        <span className="text-[10px] text-mutedForeground shrink-0 ml-auto">{formatGameDateTime(match.kickoff)}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <WcFlag team={homeTeam} size="md" />
            <span className="text-sm font-heading text-foreground truncate">{homeTeam?.name || 'TBD'}</span>
          </div>
          <span className="text-[10px] text-mutedForeground font-heading uppercase shrink-0 px-1">vs</span>
          <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
            <span className="text-sm font-heading text-foreground truncate text-right">{awayTeam?.name || 'TBD'}</span>
            <WcFlag team={awayTeam} size="md" />
          </div>
        </div>
      </div>
      {locked ? (
        <p className="text-[10px] text-amber-400 uppercase font-heading">Locked</p>
      ) : knockoutPickMode ? (
        <>
          <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider">
            Pick winner · {Number(points.match_score_result_points || 0).toLocaleString()} pts (result) · exact score {Number(points.match_score_exact_points || 0).toLocaleString()} pts
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => pickWinner('home')}
              className={`flex items-center gap-2 min-h-[48px] px-3 py-2 rounded-md border text-left ${
                pickedWinnerId === homeTeam?.id ? 'bg-primary/12 border-primary/35' : 'border-primary/15 hover:bg-primary/5'
              } ${controlsDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <WcFlag team={homeTeam} size="md" />
              <span className="text-sm font-heading text-foreground flex-1 truncate">{homeTeam?.name || 'TBD'}</span>
              {pickedWinnerId === homeTeam?.id ? (
                <span className="text-[9px] text-primary font-heading uppercase">Your pick</span>
              ) : null}
            </button>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => pickWinner('away')}
              className={`flex items-center gap-2 min-h-[48px] px-3 py-2 rounded-md border text-left ${
                pickedWinnerId === awayTeam?.id ? 'bg-primary/12 border-primary/35' : 'border-primary/15 hover:bg-primary/5'
              } ${controlsDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <WcFlag team={awayTeam} size="md" />
              <span className="text-sm font-heading text-foreground flex-1 truncate">{awayTeam?.name || 'TBD'}</span>
              {pickedWinnerId === awayTeam?.id ? (
                <span className="text-[9px] text-primary font-heading uppercase">Your pick</span>
              ) : null}
            </button>
          </div>
          <details className="text-[10px] text-mutedForeground">
            <summary className="cursor-pointer font-heading uppercase tracking-wider text-primary/80">Exact score (optional)</summary>
            <div className="pt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2.5">
                  <WcFlag team={homeTeam} size="sm" />
                  <ScoreStepper value={home} onChange={setHome} disabled={controlsDisabled} disabledHint={disabledHint} />
                </div>
                <div className="flex items-center gap-2.5">
                  <WcFlag team={awayTeam} size="sm" />
                  <ScoreStepper value={away} onChange={setAway} disabled={controlsDisabled} disabledHint={disabledHint} />
                </div>
              </div>
              <button
                type="button"
                disabled={!entered || saving}
                onClick={() => onSave('match_score', match.id, { home, away })}
                className="min-h-[40px] px-4 rounded bg-primary/15 text-primary text-xs font-heading uppercase"
              >
                Save exact score
              </button>
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2.5">
              <WcFlag team={homeTeam} size="sm" />
              <ScoreStepper value={home} onChange={setHome} disabled={controlsDisabled} disabledHint={disabledHint} />
            </div>
            <div className="flex items-center gap-2.5">
              <WcFlag team={awayTeam} size="sm" />
              <ScoreStepper value={away} onChange={setAway} disabled={controlsDisabled} disabledHint={disabledHint} />
            </div>
          </div>
          <input
            type="text"
            value={scorer}
            onChange={(e) => setScorer(e.target.value)}
            placeholder="Goal scorer prediction"
            disabled={!entered || saving}
            className="w-full min-h-[44px] px-3 rounded border border-primary/20 bg-transparent text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!entered || saving}
              onClick={() => onSave('match_score', match.id, { home, away })}
              className="min-h-[44px] px-4 rounded bg-primary/15 text-primary text-xs font-heading uppercase"
            >
              Save score <WcPointsBadge pts={points.match_score_exact_points} />
            </button>
            {scorer.trim() && (
              <button
                type="button"
                disabled={!entered || saving}
                onClick={() => onSave('match_scorer', match.id, { name: scorer.trim() })}
                className="min-h-[44px] px-4 rounded border border-primary/20 text-xs font-heading uppercase"
              >
                Save scorer
              </button>
            )}
          </div>
        </>
      )}
      {match.result && (
        <p className="text-xs text-emerald-400">Result: {match.result.home_score} – {match.result.away_score}</p>
      )}
    </WcPanel>
  );
}

function KnockoutTab({
  matches,
  knockoutRounds,
  teams,
  predsByKey,
  points,
  entered,
  canEnter,
  lateEntryAvailable,
  entering,
  onEnter,
  saving,
  picksLocked,
  onSave,
}) {
  const [section, setSection] = useState('fixtures');
  const [roundFilter, setRoundFilter] = useState('all');
  const second = predsByKey['second_place:tournament']?.value?.team_id || predsByKey['second_place:tournament']?.value;
  const third = predsByKey['third_place:tournament']?.value?.team_id || predsByKey['third_place:tournament']?.value;
  const disabled = !entered || saving || picksLocked;

  const roundOrder = useMemo(() => {
    const fromApi = knockoutRounds || [];
    const fromMatches = [...new Set(matches.map((m) => m.round_key).filter(Boolean))];
    const merged = [...new Set([...fromApi, ...fromMatches])];
    const order = ['round_of_32', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final', 'knockout'];
    return merged.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [knockoutRounds, matches]);

  const roundLabels = useMemo(() => {
    const m = {};
    matches.forEach((match) => {
      if (match.round_key) m[match.round_key] = match.round_label || match.round_key;
    });
    return m;
  }, [matches]);

  const filteredMatches = useMemo(() => {
    if (roundFilter === 'all') return matches;
    return matches.filter((m) => m.round_key === roundFilter);
  }, [matches, roundFilter]);

  const matchesByRound = useMemo(() => {
    const groups = {};
    filteredMatches.forEach((m) => {
      const key = m.round_key || 'knockout';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });
    return groups;
  }, [filteredMatches]);

  return (
    <div className="space-y-3 wc-fade-in">
      <WcEnterBanner
        entered={entered}
        canEnter={canEnter}
        lateEntryAvailable={lateEntryAvailable}
        entering={entering}
        onEnter={onEnter}
      />
      <div className="wc-tab-scroll flex gap-1.5 overflow-x-auto pb-1">
        {[
          { id: 'fixtures', label: 'Knockout fixtures' },
          { id: 'podium', label: '2nd & 3rd place' },
        ].map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`shrink-0 px-3 py-2 min-h-[44px] rounded-full text-[10px] font-heading uppercase ${
              section === id ? 'bg-primary/15 text-primary border border-primary/30' : 'text-mutedForeground border border-primary/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'fixtures' && (
        <>
          <WcPanel className="p-3 text-[10px] text-mutedForeground font-heading leading-relaxed">
            Tap a team to pick the winner (like group picks). Correct result earns{' '}
            <span className="text-primary">{Number(points.match_score_result_points || 0).toLocaleString()} pts</span>
            ; exact score earns{' '}
            <span className="text-primary">{Number(points.match_score_exact_points || 0).toLocaleString()} pts</span>.
            Fixtures load when staff sync from the odds feed — if empty, ask staff to run <strong className="text-foreground">Sync fixtures</strong> in admin.
          </WcPanel>
          {roundOrder.length > 0 && (
            <div className="wc-tab-scroll flex gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setRoundFilter('all')}
                className={`shrink-0 px-3 py-2 min-h-[40px] rounded-full text-[10px] font-heading uppercase ${
                  roundFilter === 'all' ? 'bg-primary/15 text-primary border border-primary/30' : 'text-mutedForeground border border-primary/10'
                }`}
              >
                All rounds
              </button>
              {roundOrder.map((rk) => (
                <button
                  key={rk}
                  type="button"
                  onClick={() => setRoundFilter(rk)}
                  className={`shrink-0 px-3 py-2 min-h-[40px] rounded-full text-[10px] font-heading uppercase ${
                    roundFilter === rk ? 'bg-primary/15 text-primary border border-primary/30' : 'text-mutedForeground border border-primary/10'
                  }`}
                >
                  {roundLabels[rk] || rk}
                </button>
              ))}
            </div>
          )}
          {!matches.length ? (
            <WcPanel className="p-4 text-sm text-mutedForeground">
              No knockout fixtures in the system yet. Staff need to sync fixtures after the group stage ends.
            </WcPanel>
          ) : (
            Object.keys(matchesByRound)
              .sort((a, b) => roundOrder.indexOf(a) - roundOrder.indexOf(b))
              .map((rk) => (
                <div key={rk} className="space-y-2">
                  <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-wider px-1">
                    {roundLabels[rk] || rk}
                  </h3>
                  {matchesByRound[rk].map((m) => (
                    <MatchCard
                      key={m.id}
                      match={m}
                      predsByKey={predsByKey}
                      points={points}
                      entered={entered}
                      saving={saving}
                      onSave={onSave}
                      knockoutPickMode
                    />
                  ))}
                </div>
              ))
          )}
        </>
      )}

      {section === 'podium' && (
        <>
          {picksLocked && (
            <WcPanel className="p-3 text-[10px] text-amber-300/90 font-heading uppercase tracking-wider">
              Tournament has started — 2nd and 3rd place picks are locked and cannot be changed.
            </WcPanel>
          )}
          <WcPanel className="p-4 space-y-2">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-heading text-primary uppercase">2nd place</h3>
              <WcPointsBadge pts={points.second_place_points} />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {teams.map((t) => (
                <WcTeamRow
                  key={`2-${t.id}`}
                  team={t}
                  selected={second === t.id}
                  disabled={disabled}
                  onSelect={(id) => onSave('second_place', 'tournament', { team_id: id })}
                />
              ))}
            </div>
          </WcPanel>
          <WcPanel className="p-4 space-y-2">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-heading text-primary uppercase">3rd place</h3>
              <WcPointsBadge pts={points.third_place_points} />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {teams.map((t) => (
                <WcTeamRow
                  key={`3-${t.id}`}
                  team={t}
                  selected={third === t.id}
                  disabled={disabled}
                  onSelect={(id) => onSave('third_place', 'tournament', { team_id: id })}
                />
              ))}
            </div>
          </WcPanel>
        </>
      )}
    </div>
  );
}
