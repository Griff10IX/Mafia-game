import { useState, useEffect, useCallback, useMemo } from 'react';
import { Trophy, Users, Grid3X3, Swords, Medal, BarChart3, Info, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import api, { getApiErrorMessage } from '../../utils/api';
import styles from '../../styles/noir.module.css';
import { formatGameDateTime } from '../../utils/gameDateTime';

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

function WcPanel({ children, className = '', accent = false }) {
  return (
    <div className={`${styles.panel} mobile-panel rounded-lg border border-primary/20 overflow-hidden ${accent ? 'border-t-2 border-t-primary/50' : ''} ${className}`}>
      {children}
    </div>
  );
}

function WcTeamRow({ team, selected, onSelect, disabled }) {
  if (!team) return null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect?.(team.id)}
      className={`w-full flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-md text-left transition-colors ${
        selected ? 'bg-primary/8 border-l-2 border-primary' : 'hover:bg-primary/5 border-l-2 border-transparent'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <span className="text-lg shrink-0">{team.flag_emoji || '🏳️'}</span>
      <span className="text-sm text-foreground flex-1 truncate">{team.name}</span>
      <span className="text-[10px] text-mutedForeground font-heading">{team.short_code}</span>
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
  const [predictions, setPredictions] = useState([]);
  const [leaderboard, setLeaderboard] = useState(null);
  const [tab, setTab] = useState('overview');
  const [entering, setEntering] = useState(false);
  const [saving, setSaving] = useState(false);

  const points = status?.points || {};
  const predsByKey = useMemo(() => {
    const m = {};
    for (const p of predictions) {
      m[`${p.type}:${p.target_id}`] = p;
    }
    return m;
  }, [predictions]);

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
      const st = await api.get('/world-cup/status');
      if (st.data?.enabled === false) {
        setDisabled(true);
        setEndedMessage(st.data.ended_message || 'World Cup 2026 has ended.');
        setStatus(null);
        return;
      }
      setDisabled(false);
      setStatus(st.data);
      const [tRes, mRes, pRes] = await Promise.all([
        api.get('/world-cup/teams'),
        api.get('/world-cup/matches'),
        api.get('/world-cup/my-predictions'),
      ]);
      setTeams(tRes.data?.teams || []);
      setGroups(tRes.data?.groups || []);
      setMatches(mRes.data?.matches || []);
      setPredictions(pRes.data?.predictions || []);
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

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === 'leaderboard' && !disabled) loadLeaderboard();
  }, [tab, disabled, loadLeaderboard]);

  const enterEvent = async () => {
    setEntering(true);
    try {
      await api.post('/world-cup/enter');
      toast.success('You joined the World Cup predictions event!');
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setEntering(false);
    }
  };

  const savePrediction = async (type, target_id, value) => {
    setSaving(true);
    try {
      await api.post('/world-cup/predictions', { type, target_id, value });
      toast.success('Prediction saved');
      const pRes = await api.get('/world-cup/my-predictions');
      setPredictions(pRes.data?.predictions || []);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const groupLocked = (gid) => {
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
            <div className="flex flex-wrap gap-2 mt-3 text-[10px] text-white/80">
              <span>🇺🇸 USA</span>
              <span>🇨🇦 Canada</span>
              <span>🇲🇽 Mexico</span>
            </div>
          </div>
        </div>
      </div>

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
              <li className="flex gap-2"><span className="text-primary">1.</span> Join free — enter the event to join the team draft raffle.</li>
              <li className="flex gap-2"><span className="text-primary">2.</span> Get assigned nation(s) — if your team wins the World Cup, earn <WcPointsBadge pts={points.jackpot_points} />.</li>
              <li className="flex gap-2"><span className="text-primary">3.</span> Predict group winners — <WcPointsBadge pts={points.group_winner_points} /> each.</li>
              <li className="flex gap-2"><span className="text-primary">4.</span> Predict match scores, scorers, 2nd &amp; 3rd place for more points.</li>
            </ul>
            {!status?.entered ? (
              <button
                type="button"
                disabled={entering}
                onClick={enterEvent}
                className="w-full min-h-[44px] rounded-md bg-primary text-primary-foreground font-heading uppercase text-sm tracking-wider hover:opacity-90 disabled:opacity-50"
              >
                {entering ? 'Joining…' : 'Enter World Cup Event'}
              </button>
            ) : (
              <p className="text-sm text-emerald-400 font-heading">✓ You&apos;re entered{status?.config?.draft_run ? ' — draft complete' : ' — awaiting team draft'}.</p>
            )}
          </WcPanel>
        </div>
      )}

      {tab === 'teams' && (
        <div className="space-y-3 wc-fade-in">
          <WcPanel className="p-4">
            <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider mb-2">Your drafted teams</h2>
            {!status?.config?.draft_run ? (
              <p className="text-sm text-mutedForeground">Team draft has not run yet. Enter the event and wait for entertainers to run the raffle.</p>
            ) : (status?.drafted_teams || []).length === 0 ? (
              <p className="text-sm text-mutedForeground">No teams assigned.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(status.drafted_teams || []).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/20 bg-primary/5 min-h-[44px]">
                    <span className="text-xl">{t.flag_emoji}</span>
                    <span className="text-sm font-heading text-foreground">{t.name}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-mutedForeground mt-3">If any assigned team wins the tournament, you receive the jackpot.</p>
          </WcPanel>
        </div>
      )}

      {tab === 'groups' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 wc-fade-in">
          {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((gid) => {
            const locked = groupLocked(gid);
            const pred = predsByKey[`group_winner:${gid}`];
            const pickId = pred?.value?.team_id || pred?.value;
            return (
              <WcPanel key={gid} className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-heading font-bold text-primary">Group {gid}</span>
                  <WcPointsBadge pts={points.group_winner_points} />
                </div>
                {locked && <p className="text-[10px] text-amber-400 mb-2 uppercase font-heading">Locked</p>}
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
      )}

      {tab === 'matches' && (
        <MatchPredictionsTab
          matches={matches}
          predsByKey={predsByKey}
          points={points}
          entered={status?.entered}
          saving={saving}
          onSave={savePrediction}
        />
      )}

      {tab === 'knockout' && (
        <KnockoutTab teams={teams} predsByKey={predsByKey} points={points} entered={status?.entered} saving={saving} onSave={savePrediction} />
      )}

      {tab === 'leaderboard' && (
        <div className="space-y-3 wc-fade-in">
          {leaderboard?.my_points != null && (
            <WcPanel accent className="p-3 flex justify-between items-center sticky top-0 z-10">
              <span className="text-sm font-heading text-foreground">Your rank</span>
              <span className="text-sm text-primary font-heading tabular-nums">
                #{leaderboard.my_rank || '—'} · {Number(leaderboard.my_points || 0).toLocaleString()} pts
              </span>
            </WcPanel>
          )}
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

function ScoreStepper({ value, onChange, disabled }) {
  const v = Number(value) || 0;
  return (
    <div className="flex items-center gap-1">
      <button type="button" disabled={disabled || v <= 0} onClick={() => onChange(v - 1)} className="min-w-[44px] min-h-[44px] rounded border border-primary/20 flex items-center justify-center">
        <Minus size={16} />
      </button>
      <span className="w-8 text-center font-heading tabular-nums">{v}</span>
      <button type="button" disabled={disabled || v >= 15} onClick={() => onChange(v + 1)} className="min-w-[44px] min-h-[44px] rounded border border-primary/20 flex items-center justify-center">
        <Plus size={16} />
      </button>
    </div>
  );
}

function MatchPredictionsTab({ matches, predsByKey, points, entered, saving, onSave }) {
  const [filter, setFilter] = useState('all');
  const filtered = useMemo(() => {
    if (filter === 'all') return matches;
    return matches.filter((m) => m.stage === filter);
  }, [matches, filter]);

  return (
    <div className="space-y-3 wc-fade-in">
      <div className="wc-tab-scroll flex gap-1.5 overflow-x-auto pb-1">
        {['all', 'group', 'knockout'].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-2 min-h-[44px] rounded-full text-[10px] font-heading uppercase ${
              filter === f ? 'bg-primary/15 text-primary border border-primary/30' : 'text-mutedForeground border border-primary/10'
            }`}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>
      {filtered.map((m) => (
        <MatchCard key={m.id} match={m} predsByKey={predsByKey} points={points} entered={entered} saving={saving} onSave={onSave} />
      ))}
      {!filtered.length && <p className="text-sm text-mutedForeground p-4">No matches scheduled yet.</p>}
    </div>
  );
}

function MatchCard({ match, predsByKey, points, entered, saving, onSave }) {
  const [home, setHome] = useState(() => predsByKey[`match_score:${match.id}`]?.value?.home ?? 0);
  const [away, setAway] = useState(() => predsByKey[`match_score:${match.id}`]?.value?.away ?? 0);
  const [scorer, setScorer] = useState(() => predsByKey[`match_scorer:${match.id}`]?.value?.name || '');
  const locked = match.locked || match.status === 'settled';

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
        <div className="text-sm font-heading text-foreground min-w-0">
          <span>{homeTeam?.flag_emoji} {homeTeam?.short_code || '?'}</span>
          <span className="text-mutedForeground mx-2">vs</span>
          <span>{awayTeam?.flag_emoji} {awayTeam?.short_code || '?'}</span>
        </div>
        <span className="text-[10px] text-mutedForeground">{formatGameDateTime(match.kickoff)}</span>
      </div>
      {locked ? (
        <p className="text-[10px] text-amber-400 uppercase font-heading">Locked</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs w-12 truncate">{homeTeam?.short_code}</span>
              <ScoreStepper value={home} onChange={setHome} disabled={!entered || saving} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs w-12 truncate">{awayTeam?.short_code}</span>
              <ScoreStepper value={away} onChange={setAway} disabled={!entered || saving} />
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

function KnockoutTab({ teams, predsByKey, points, entered, saving, onSave }) {
  const second = predsByKey['second_place:tournament']?.value?.team_id || predsByKey['second_place:tournament']?.value;
  const third = predsByKey['third_place:tournament']?.value?.team_id || predsByKey['third_place:tournament']?.value;

  return (
    <div className="space-y-3 wc-fade-in">
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
              disabled={!entered || saving}
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
              disabled={!entered || saving}
              onSelect={(id) => onSave('third_place', 'tournament', { team_id: id })}
            />
          ))}
        </div>
      </WcPanel>
    </div>
  );
}
