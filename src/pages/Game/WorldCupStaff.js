import { useState, useEffect, useCallback, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Trophy, RefreshCw, Play, ArrowLeft, CheckCircle2, ClipboardList } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { formatGameDateTime } from '../../utils/gameDateTime';
import styles from '../../styles/noir.module.css';

const PRED_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'group_winner', label: 'Groups' },
  { id: 'match_score', label: 'Scores' },
  { id: 'match_scorer', label: 'Scorers' },
  { id: 'second_place', label: '2nd' },
  { id: 'third_place', label: '3rd' },
];

const VERDICT_FILTERS = [
  { id: '', label: 'Any verdict' },
  { id: 'pending', label: 'Pending' },
  { id: 'correct', label: 'Correct' },
  { id: 'result_correct', label: 'Result only' },
  { id: 'incorrect', label: 'Wrong' },
];

function predStatusLabel(row) {
  if (!row?.settled) return 'Open';
  if (row.payout_status === 'pending') return 'Pending';
  if (row.payout_status === 'paid') return 'Paid';
  if (row.payout_status === 'ghost') return 'Ghost';
  if (Number(row.points_awarded) > 0) return 'Correct';
  return 'Wrong';
}

function predStatusClass(row) {
  if (!row?.settled) return 'text-mutedForeground';
  if (row.payout_status === 'pending') return 'text-amber-400';
  if (row.payout_status === 'paid' || Number(row.points_awarded) > 0) return 'text-emerald-400';
  return 'text-red-400/80';
}

function verdictLabel(v) {
  if (v === 'correct') return 'Correct';
  if (v === 'result_correct') return 'Result only';
  if (v === 'incorrect') return 'Wrong';
  return 'Pending';
}

function verdictClass(v) {
  if (v === 'correct') return 'text-emerald-400';
  if (v === 'result_correct') return 'text-sky-400';
  if (v === 'incorrect') return 'text-red-400/80';
  return 'text-mutedForeground';
}

function fmtTs(iso) {
  if (!iso) return '—';
  return formatGameDateTime(iso);
}

export default function WorldCupStaff() {
  const [dash, setDash] = useState(null);
  const [entries, setEntries] = useState([]);
  const [pending, setPending] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [predMeta, setPredMeta] = useState(null);
  const [predFilter, setPredFilter] = useState('all');
  const [matchFilter, setMatchFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [usernameFilter, setUsernameFilter] = useState('');
  const [usernameQuery, setUsernameQuery] = useState('');
  const [verdictFilter, setVerdictFilter] = useState('');
  const [settledFilter, setSettledFilter] = useState('');
  const [payoutFilter, setPayoutFilter] = useState('');
  const [expandedPredId, setExpandedPredId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draftRunning, setDraftRunning] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [approvingId, setApprovingId] = useState(null);
  const [matchId, setMatchId] = useState('');
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [scorers, setScorers] = useState('');
  const [stage, setStage] = useState('');

  const loadPredictions = useCallback(async (filters) => {
    try {
      const params = { limit: 200 };
      const { filter, matchId, groupId, username, verdict, settled, payoutStatus } = filters;
      if (filter && filter !== 'all') params.type = filter;
      if (matchId && (filter === 'match_score' || filter === 'match_scorer' || filter === 'all')) params.match_id = matchId;
      if (groupId && (filter === 'group_winner' || filter === 'all')) params.group_id = groupId;
      if (username?.trim()) params.username = username.trim();
      if (verdict) params.verdict = verdict;
      if (settled === 'yes') params.settled = true;
      if (settled === 'no') params.settled = false;
      if (payoutStatus) params.payout_status = payoutStatus;
      const r = await api.get('/world-cup/staff/predictions', { params });
      setPredictions(r.data?.predictions || []);
      setPredMeta(r.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
      setPredictions([]);
      setPredMeta(null);
    }
  }, []);

  const predFilters = {
    filter: predFilter,
    matchId: matchFilter,
    groupId: groupFilter,
    username: usernameFilter,
    verdict: verdictFilter,
    settled: settledFilter,
    payoutStatus: payoutFilter,
  };
  const reloadPredictions = () => loadPredictions(predFilters);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, e, p] = await Promise.all([
        api.get('/world-cup/staff/dashboard'),
        api.get('/world-cup/staff/entries', { params: { limit: 200 } }),
        api.get('/world-cup/staff/pending-payouts', { params: { limit: 200 } }),
      ]);
      setDash(d.data);
      setEntries(e.data?.entries || []);
      setPending(p.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
      setDash(null);
      setPending(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runDraft = async () => {
    if (!window.confirm('Run team draft raffle for all entrants? This cannot be undone.')) return;
    setDraftRunning(true);
    try {
      const r = await api.post('/world-cup/staff/run-draft');
      toast.success(`Draft complete — ${r.data?.real_entrants ?? r.data?.entrants} real, ${r.data?.ghost_entrants ?? 0} ghost, ${r.data?.teams} teams`);
      await load();
      await reloadPredictions();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setDraftRunning(false);
    }
  };

  const patchResult = async () => {
    if (!matchId.trim()) {
      toast.error('Match ID required');
      return;
    }
    try {
      await api.patch(`/world-cup/staff/match/${matchId.trim()}/result`, {
        home_score: Number(homeScore),
        away_score: Number(awayScore),
        scorers: scorers.split(',').map((s) => s.trim()).filter(Boolean),
        stage: stage.trim() || undefined,
      });
      toast.success('Result saved — correct predictions queued for staff approval');
      await load();
      await reloadPredictions();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const settleGroups = async () => {
    try {
      const r = await api.post('/world-cup/staff/settle-groups');
      toast.success(`Settled ${r.data?.groups_settled || 0} group(s) — winners queued for approval`);
      await load();
      await reloadPredictions();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const approvePrediction = async (predictionId) => {
    setApprovingId(predictionId);
    try {
      const r = await api.post(`/world-cup/staff/approve-payout/${predictionId}`);
      toast.success(`Approved ${Number(r.data?.points || 0).toLocaleString()} pts`);
      await load();
      await reloadPredictions();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setApprovingId(null);
    }
  };

  const approveJackpot = async (userId) => {
    setApprovingId(`jackpot:${userId}`);
    try {
      const r = await api.post(`/world-cup/staff/approve-jackpot/${userId}`);
      toast.success(`Jackpot approved — ${Number(r.data?.points || 0).toLocaleString()} pts`);
      await load();
      await reloadPredictions();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setApprovingId(null);
    }
  };

  const approveAll = async () => {
    const count = pending?.pending_payouts ?? 0;
    if (!count || !window.confirm(`Approve and send points for all ${count} pending payout(s)?`)) return;
    setApprovingAll(true);
    try {
      const r = await api.post('/world-cup/staff/approve-all-payouts');
      toast.success(`Approved ${r.data?.predictions_approved || 0} predictions and ${r.data?.jackpots_approved || 0} jackpots (${Number(r.data?.total_points || 0).toLocaleString()} pts total)`);
      await load();
      await reloadPredictions();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setApprovingAll(false);
    }
  };

  useEffect(() => {
    if (loading) return undefined;
    const t = setTimeout(() => {
      loadPredictions(predFilters);
    }, 150);
    return () => clearTimeout(t);
  }, [loading, predFilter, matchFilter, groupFilter, usernameFilter, verdictFilter, settledFilter, payoutFilter, loadPredictions]);

  const applyPredFilter = (id) => {
    setPredFilter(id);
    if (id !== 'match_score' && id !== 'match_scorer' && id !== 'all') setMatchFilter('');
    if (id !== 'group_winner' && id !== 'all') setGroupFilter('');
  };

  const pendingCount = pending?.pending_payouts ?? dash?.pending_payouts ?? 0;
  const predCounts = predMeta?.counts || {};

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(10rem+env(safe-area-inset-bottom))]`}>
      <div className="h-1 bg-gradient-to-r from-emerald-800 via-primary to-emerald-800 rounded" />
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/game/entertainer" className="text-mutedForeground hover:text-primary flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> Hub
        </Link>
        <Trophy className="text-primary" size={22} />
        <h1 className="text-lg font-heading font-bold text-primary uppercase tracking-wider">World Cup Staff</h1>
        <button
          type="button"
          onClick={() => {
            load();
            reloadPredictions();
          }}
          className="ml-auto min-h-[44px] px-3 rounded border border-primary/20 flex items-center gap-1 text-sm"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-mutedForeground">Loading…</p>
      ) : (
        <>
          <div className={`${styles.panel} mobile-panel rounded-lg border border-primary/20 p-4 space-y-2`}>
            <p className="text-sm text-foreground">Entrants: <strong>{dash?.entrants ?? 0}</strong> ({dash?.real_entrants ?? 0} real · {dash?.ghost_entrants ?? 0} ghost)</p>
            <p className="text-sm text-foreground">Pending payouts: <strong className={pendingCount ? 'text-amber-400' : ''}>{pendingCount}</strong></p>
            <p className="text-sm text-foreground">Unsettled matches: <strong>{dash?.unsettled_matches ?? 0}</strong></p>
            <p className="text-sm text-foreground">Draft run: <strong>{dash?.draft_run ? 'Yes' : 'No'}</strong></p>
            <p className="text-[10px] text-mutedForeground">Last sync: {dash?.last_fixture_sync_at || '—'}</p>
            <p className="text-[10px] text-mutedForeground">Last auto-settle: {dash?.last_auto_settle_at || '—'}</p>
            {pendingCount > 0 && (
              <button
                type="button"
                disabled={approvingAll}
                onClick={approveAll}
                className="w-full min-h-[44px] mt-2 rounded bg-amber-600 text-white font-heading uppercase text-sm flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={16} /> {approvingAll ? 'Approving…' : `Approve all pending (${pendingCount})`}
              </button>
            )}
            <p className="text-[10px] text-mutedForeground">Draft auto-runs 24h before first match{dash?.draft_scheduled_at ? ` (${formatGameDateTime(dash.draft_scheduled_at)})` : ''}</p>
            {!dash?.draft_run && (
              <button
                type="button"
                disabled={draftRunning}
                onClick={runDraft}
                className="w-full min-h-[44px] mt-2 rounded border border-primary/30 text-primary font-heading uppercase text-sm flex items-center justify-center gap-2"
              >
                <Play size={16} /> {draftRunning ? 'Running…' : 'Run draft now (manual override)'}
              </button>
            )}
          </div>

          {(pending?.predictions?.length > 0 || pending?.jackpots?.length > 0) && (
            <div className={`${styles.panel} mobile-panel rounded-lg border border-amber-500/30 p-4 space-y-3`}>
              <h2 className="text-sm font-heading text-amber-300 uppercase">Pending point approvals</h2>
              <p className="text-[10px] text-mutedForeground">Correct predictions are queued here. Approve to send store points to players.</p>
              <div className="space-y-2">
                {(pending?.predictions || []).map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center gap-2 p-2 rounded border border-primary/10 bg-primary/5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{row.username}</p>
                      <p className="text-[10px] text-mutedForeground truncate">{row.label || row.type} · {row.target_id}</p>
                    </div>
                    <span className="text-sm text-primary tabular-nums">{Number(row.points || 0).toLocaleString()} pts</span>
                    <button
                      type="button"
                      disabled={approvingId === row.id}
                      onClick={() => approvePrediction(row.id)}
                      className="min-h-[36px] px-3 rounded border border-emerald-500/40 text-emerald-300 text-xs font-heading uppercase"
                    >
                      {approvingId === row.id ? '…' : 'Approve'}
                    </button>
                  </div>
                ))}
                {(pending?.jackpots || []).map((row) => (
                  <div key={row.user_id} className="flex flex-wrap items-center gap-2 p-2 rounded border border-amber-500/20 bg-amber-950/20">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{row.username}</p>
                      <p className="text-[10px] text-mutedForeground truncate">{row.label} (jackpot)</p>
                    </div>
                    <span className="text-sm text-amber-300 tabular-nums">{Number(row.points || 0).toLocaleString()} pts</span>
                    <button
                      type="button"
                      disabled={approvingId === `jackpot:${row.user_id}`}
                      onClick={() => approveJackpot(row.user_id)}
                      className="min-h-[36px] px-3 rounded border border-emerald-500/40 text-emerald-300 text-xs font-heading uppercase"
                    >
                      {approvingId === `jackpot:${row.user_id}` ? '…' : 'Approve'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`${styles.panel} mobile-panel rounded-lg border border-primary/20 p-4 space-y-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardList size={16} className="text-primary" />
              <h2 className="text-sm font-heading text-primary uppercase">Player predictions — verification</h2>
              <span className="text-[10px] text-mutedForeground ml-auto">{predictions.length} shown</span>
            </div>
            <p className="text-[10px] text-mutedForeground">
              Tap a row for full audit detail (IDs, timestamps, raw pick, match/group context). Compare pick vs actual before approving payouts.
            </p>
            {predMeta?.points_reference && (
              <div className="text-[10px] text-mutedForeground flex flex-wrap gap-x-3 gap-y-1 p-2 rounded border border-primary/10 bg-primary/5">
                <span>Group winner: {Number(predMeta.points_reference.group_winner_points || 0).toLocaleString()}</span>
                <span>Exact score: {Number(predMeta.points_reference.match_score_exact_points || 0).toLocaleString()}</span>
                <span>Result only: {Number(predMeta.points_reference.match_score_result_points || 0).toLocaleString()}</span>
                <span>Scorer: {Number(predMeta.points_reference.match_scorer_points || 0).toLocaleString()}</span>
                <span>2nd: {Number(predMeta.points_reference.second_place_points || 0).toLocaleString()}</span>
                <span>3rd: {Number(predMeta.points_reference.third_place_points || 0).toLocaleString()}</span>
                <span>Jackpot: {Number(predMeta.points_reference.jackpot_points || 0).toLocaleString()}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {PRED_FILTERS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPredFilter(id)}
                  className={`min-h-[36px] px-2.5 rounded text-[10px] font-heading uppercase ${
                    predFilter === id ? 'bg-primary/15 text-primary border border-primary/30' : 'text-mutedForeground border border-primary/10'
                  }`}
                >
                  {label}
                  {id !== 'all' && predCounts[id] != null ? ` (${predCounts[id]})` : id === 'all' ? ` (${Object.values(predCounts).reduce((a, b) => a + b, 0) || 0})` : ''}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div className="flex gap-1 sm:col-span-2">
                <input
                  type="text"
                  value={usernameQuery}
                  onChange={(e) => setUsernameQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setUsernameFilter(usernameQuery)}
                  placeholder="Search username"
                  className="flex-1 min-h-[40px] px-3 rounded border border-primary/20 bg-transparent text-sm"
                />
                <button
                  type="button"
                  onClick={() => setUsernameFilter(usernameQuery)}
                  className="min-h-[40px] px-3 rounded border border-primary/20 text-xs font-heading uppercase"
                >
                  Search
                </button>
                {usernameFilter && (
                  <button
                    type="button"
                    onClick={() => { setUsernameFilter(''); setUsernameQuery(''); }}
                    className="min-h-[40px] px-2 rounded text-xs text-mutedForeground"
                  >
                    Clear
                  </button>
                )}
              </div>
              <select
                value={verdictFilter}
                onChange={(e) => setVerdictFilter(e.target.value)}
                className="min-h-[40px] px-3 rounded border border-primary/20 bg-transparent text-sm"
              >
                {VERDICT_FILTERS.map(({ id, label }) => (
                  <option key={id || 'any'} value={id}>{label}</option>
                ))}
              </select>
              <select
                value={settledFilter}
                onChange={(e) => setSettledFilter(e.target.value)}
                className="min-h-[40px] px-3 rounded border border-primary/20 bg-transparent text-sm"
              >
                <option value="">Any settlement</option>
                <option value="no">Open only</option>
                <option value="yes">Settled only</option>
              </select>
              <select
                value={payoutFilter}
                onChange={(e) => setPayoutFilter(e.target.value)}
                className="min-h-[40px] px-3 rounded border border-primary/20 bg-transparent text-sm"
              >
                <option value="">Any payout</option>
                <option value="pending">Pending approval</option>
                <option value="paid">Paid</option>
                <option value="ghost">Ghost (no pay)</option>
              </select>
            </div>
            {(predFilter === 'all' || predFilter === 'group_winner') && (predMeta?.groups || []).length > 0 && (
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded border border-primary/20 bg-transparent text-sm"
              >
                <option value="">All groups</option>
                {(predMeta.groups || []).map((g) => (
                  <option key={g.group_id} value={g.group_id}>
                    Group {g.group_id}
                    {g.winner_team?.name ? ` · winner: ${g.winner_team.name}` : ''}
                    {g.prediction_count ? ` (${g.prediction_count})` : ''}
                  </option>
                ))}
              </select>
            )}
            {(predFilter === 'all' || predFilter === 'match_score' || predFilter === 'match_scorer') && (predMeta?.matches || []).length > 0 && (
              <select
                value={matchFilter}
                onChange={(e) => setMatchFilter(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded border border-primary/20 bg-transparent text-sm"
              >
                <option value="">All matches</option>
                {(predMeta.matches || []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.result?.display ? ` · ${m.result.display}` : ''}
                    {m.kickoff ? ` · ${formatGameDateTime(m.kickoff)}` : ''}
                    {m.prediction_count ? ` (${m.prediction_count})` : ''}
                  </option>
                ))}
              </select>
            )}
            {!predictions.length ? (
              <p className="text-sm text-mutedForeground">No predictions yet for this filter.</p>
            ) : (
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto rounded border border-primary/10">
                <table className="w-full text-xs min-w-[900px]">
                  <thead className="sticky top-0 bg-[var(--noir-content,#111)] z-10">
                    <tr className="border-b border-primary/10 text-left text-mutedForeground font-heading uppercase">
                      <th className="p-2 w-8" />
                      <th className="p-2">Player</th>
                      <th className="p-2">Target</th>
                      <th className="p-2">Pick</th>
                      <th className="p-2">Actual</th>
                      <th className="p-2">Verdict</th>
                      <th className="p-2">Settlement</th>
                      <th className="p-2 text-right">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {predictions.map((row) => {
                      const expanded = expandedPredId === row.id;
                      const ptsExpected = Number(row.expected_points || 0);
                      const ptsAwarded = Number(row.points_awarded || 0);
                      return (
                        <Fragment key={row.id}>
                          <tr
                            className={`border-b border-primary/5 align-top cursor-pointer hover:bg-primary/5 ${expanded ? 'bg-primary/5' : ''}`}
                            onClick={() => setExpandedPredId(expanded ? null : row.id)}
                          >
                            <td className="p-2 text-mutedForeground">{expanded ? '▼' : '▶'}</td>
                            <td className="p-2 whitespace-nowrap">
                              <span className="text-sm text-foreground font-heading">{row.username}</span>
                              {row.entrant?.ghost_entry && (
                                <span className="ml-1 text-[9px] text-amber-400 uppercase">Ghost</span>
                              )}
                            </td>
                            <td className="p-2 text-sm text-foreground max-w-[140px] truncate" title={row.target_label || row.target_id}>
                              {row.target_label || row.target_id}
                            </td>
                            <td className="p-2 text-sm text-foreground font-mono">{row.pick || '—'}</td>
                            <td className="p-2 text-sm text-foreground font-mono">{row.actual || '—'}</td>
                            <td className={`p-2 text-[10px] font-heading uppercase whitespace-nowrap ${verdictClass(row.verdict)}`}>
                              {verdictLabel(row.verdict)}
                            </td>
                            <td className={`p-2 text-[10px] font-heading uppercase whitespace-nowrap ${predStatusClass(row)}`}>
                              {predStatusLabel(row)}
                              {row.settle_label ? (
                                <span className="block normal-case text-mutedForeground font-sans">{row.settle_label}</span>
                              ) : null}
                            </td>
                            <td className="p-2 text-right tabular-nums whitespace-nowrap">
                              {row.settled ? (
                                <>
                                  <span className={ptsAwarded > 0 ? 'text-primary' : 'text-mutedForeground'}>
                                    {ptsAwarded > 0 ? ptsAwarded.toLocaleString() : '0'}
                                  </span>
                                  {ptsExpected > 0 && ptsExpected !== ptsAwarded && (
                                    <span className="block text-[9px] text-mutedForeground">exp {ptsExpected.toLocaleString()}</span>
                                  )}
                                </>
                              ) : ptsExpected > 0 ? (
                                <span className="text-mutedForeground">exp {ptsExpected.toLocaleString()}</span>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="border-b border-primary/10 bg-black/20">
                              <td colSpan={8} className="p-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-[10px]">
                                  <div className="space-y-1">
                                    <p className="font-heading uppercase text-mutedForeground">Reference IDs</p>
                                    <p><span className="text-mutedForeground">Prediction:</span> <span className="font-mono break-all">{row.id}</span></p>
                                    <p><span className="text-mutedForeground">User:</span> <span className="font-mono break-all">{row.user_id}</span></p>
                                    <p><span className="text-mutedForeground">Target:</span> <span className="font-mono break-all">{row.target_id}</span></p>
                                    <p><span className="text-mutedForeground">Type:</span> {row.type} ({row.type_label})</p>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="font-heading uppercase text-mutedForeground">Timestamps</p>
                                    <p>Created: {fmtTs(row.created_at)}</p>
                                    <p>Updated: {fmtTs(row.updated_at)}</p>
                                    <p>Settled: {fmtTs(row.settled_at)}</p>
                                    <p>Payout approved: {fmtTs(row.payout_approved_at)}</p>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="font-heading uppercase text-mutedForeground">Entrant</p>
                                    <p>Entered: {row.entrant?.entered ? 'Yes' : 'No'}</p>
                                    <p>Ghost: {row.entrant?.ghost_entry ? 'Yes' : 'No'}</p>
                                    <p>Entered at: {fmtTs(row.entrant?.entered_at)}</p>
                                    <p>Drafted teams: {row.entrant?.drafted_team_count ?? 0}</p>
                                  </div>
                                  {row.match && (
                                    <div className="space-y-1 md:col-span-2">
                                      <p className="font-heading uppercase text-mutedForeground">Match context</p>
                                      <p>{row.match.label} · {row.match.stage || '—'} · {row.match.status || '—'}</p>
                                      <p>Kickoff: {fmtTs(row.match.kickoff)} · Lock: {fmtTs(row.match.lock_at)} {row.match.locked ? '(locked)' : ''}</p>
                                      <p>Match ID: <span className="font-mono">{row.match.id}</span></p>
                                      {row.match.external_event_id && (
                                        <p>External: <span className="font-mono">{row.match.external_event_id}</span></p>
                                      )}
                                      {row.match.result && (
                                        <p>
                                          Official result: <span className="font-mono">{row.match.result.display}</span>
                                          {row.match.result.scorers?.length ? (
                                            <span> · Scorers: {row.match.result.scorers.join(', ')}</span>
                                          ) : null}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  {row.group && (
                                    <div className="space-y-1">
                                      <p className="font-heading uppercase text-mutedForeground">Group context</p>
                                      <p>Group {row.group.group_id}</p>
                                      <p>Winner: {row.group.winner_team?.name || row.group.winner_team_id || '—'}</p>
                                      <p>Group settled: {fmtTs(row.group.settled_at)}</p>
                                    </div>
                                  )}
                                  {row.tournament && (
                                    <div className="space-y-1">
                                      <p className="font-heading uppercase text-mutedForeground">Tournament picks (config)</p>
                                      <p>Champion ID: <span className="font-mono">{row.tournament.champion_team_id || '—'}</span></p>
                                      <p>Runner-up ID: <span className="font-mono">{row.tournament.runner_up_team_id || '—'}</span></p>
                                      <p>3rd place ID: <span className="font-mono">{row.tournament.third_place_team_id || '—'}</span></p>
                                    </div>
                                  )}
                                  <div className="space-y-1 md:col-span-2 lg:col-span-3">
                                    <p className="font-heading uppercase text-mutedForeground">Raw pick value</p>
                                    <pre className="p-2 rounded border border-primary/10 bg-black/30 overflow-x-auto font-mono text-[10px]">
                                      {JSON.stringify(row.value, null, 2)}
                                    </pre>
                                    <p className="text-mutedForeground">Summary: {row.summary}</p>
                                  </div>
                                  {row.payout_status === 'pending' && (
                                    <div className="md:col-span-2 lg:col-span-3">
                                      <button
                                        type="button"
                                        disabled={approvingId === row.id}
                                        onClick={(e) => { e.stopPropagation(); approvePrediction(row.id); }}
                                        className="min-h-[36px] px-4 rounded border border-emerald-500/40 text-emerald-300 text-xs font-heading uppercase"
                                      >
                                        {approvingId === row.id ? 'Approving…' : `Approve ${ptsAwarded.toLocaleString()} pts`}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {matchFilter && (
              <p className="text-[10px] text-mutedForeground font-mono break-all">
                Match ID (manual result): {matchFilter}
                <button type="button" className="ml-2 text-primary underline" onClick={() => setMatchId(matchFilter)}>Use in form</button>
              </p>
            )}
          </div>

          <div className={`${styles.panel} mobile-panel rounded-lg border border-primary/20 p-4 space-y-3`}>
            <h2 className="text-sm font-heading text-primary uppercase">Manual match result</h2>
            <input
              type="text"
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              placeholder="Match ID"
              className="w-full min-h-[44px] px-3 rounded border border-primary/20 bg-transparent text-sm"
            />
            <div className="flex gap-2">
              <input type="number" min={0} value={homeScore} onChange={(e) => setHomeScore(e.target.value)} className="flex-1 min-h-[44px] px-3 rounded border border-primary/20" placeholder="Home" />
              <input type="number" min={0} value={awayScore} onChange={(e) => setAwayScore(e.target.value)} className="flex-1 min-h-[44px] px-3 rounded border border-primary/20" placeholder="Away" />
            </div>
            <input
              type="text"
              value={scorers}
              onChange={(e) => setScorers(e.target.value)}
              placeholder="Scorers (comma-separated)"
              className="w-full min-h-[44px] px-3 rounded border border-primary/20 bg-transparent text-sm"
            />
            <input
              type="text"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              placeholder="Stage override (group, final, third_place…)"
              className="w-full min-h-[44px] px-3 rounded border border-primary/20 bg-transparent text-sm"
            />
            <button type="button" onClick={patchResult} className="w-full min-h-[44px] rounded border border-primary/30 text-sm font-heading uppercase">
              Save result &amp; queue settlement
            </button>
            <button type="button" onClick={settleGroups} className="w-full min-h-[44px] rounded border border-primary/20 text-sm font-heading uppercase">
              Force settle groups
            </button>
          </div>

          <div className={`${styles.panel} mobile-panel rounded-lg border border-primary/20 overflow-x-auto`}>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-primary/10 text-left text-mutedForeground font-heading uppercase">
                  <th className="p-2">User</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Entered</th>
                  <th className="p-2">Teams</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.user_id} className="border-b border-primary/5">
                    <td className="p-2 text-sm font-heading">{e.username || `${e.user_id?.slice(0, 8)}…`}</td>
                    <td className="p-2">{e.ghost_entry ? <span className="text-amber-400">Ghost</span> : 'Real'}</td>
                    <td className="p-2">{e.entered_at?.slice(0, 10)}</td>
                    <td className="p-2">{(e.drafted_team_ids || []).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
