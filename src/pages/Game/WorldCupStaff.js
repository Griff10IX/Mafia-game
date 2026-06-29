import { useState, useEffect, useCallback, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Trophy, RefreshCw, Play, ArrowLeft, CheckCircle2, ClipboardList, ChevronDown, ChevronUp } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { formatGameDateTime } from '../../utils/gameDateTime';
import styles from '../../styles/noir.module.css';

const WC_STAFF_STYLES = `
  .wc-staff-select {
    background-color: #18181b;
    color: #e4e4e7;
    color-scheme: dark;
  }
  .wc-staff-select option {
    background-color: #18181b;
    color: #e4e4e7;
  }
`;

const WC_SELECT = 'wc-staff-select rounded border border-primary/30 bg-zinc-900 text-foreground text-sm font-heading [color-scheme:dark] focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30';
const WC_SELECT_LG = `${WC_SELECT} w-full min-h-[48px] px-3`;
const WC_SELECT_MD = `${WC_SELECT} min-h-[40px] px-3`;
const WC_SELECT_SM = `${WC_SELECT} flex-1 min-h-[40px] px-2 min-w-[140px]`;

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

const STAGE_OPTIONS = [
  { id: '', label: 'Auto (from match)' },
  { id: 'group', label: 'Group stage' },
  { id: 'round_of_16', label: 'Round of 16' },
  { id: 'quarter_final', label: 'Quarter-final' },
  { id: 'semi_final', label: 'Semi-final' },
  { id: 'third_place', label: '3rd place' },
  { id: 'final', label: 'Final' },
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

function matchOptionLabel(m) {
  const base = m.label || m.id;
  const when = m.kickoff ? ` · ${formatGameDateTime(m.kickoff)}` : '';
  const score = m.result?.display ? ` · ${m.result.display}` : '';
  const tag = m.needs_result ? ' · needs score' : '';
  return `${base}${when}${score}${tag}`;
}

export default function WorldCupStaff() {
  const [tab, setTab] = useState('quick');
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
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [homeScore, setHomeScore] = useState('0');
  const [awayScore, setAwayScore] = useState('0');
  const [scorers, setScorers] = useState('');
  const [stage, setStage] = useState('');
  const [autoApproveResult, setAutoApproveResult] = useState(true);
  const [savingResult, setSavingResult] = useState(false);
  const [groupsSetup, setGroupsSetup] = useState([]);
  const [groupWinners, setGroupWinners] = useState({});
  const [groupWinnersSaving, setGroupWinnersSaving] = useState(false);
  const [settlingAndPaying, setSettlingAndPaying] = useState(false);
  const [showAdvancedMatch, setShowAdvancedMatch] = useState(false);

  const staffMatches = dash?.matches || [];
  const selectedMatch = staffMatches.find((m) => m.id === selectedMatchId) || null;

  const applyMatchSelection = useCallback((matchId, matches) => {
    setSelectedMatchId(matchId);
    const m = (matches || []).find((x) => x.id === matchId);
    if (!m) return;
    const res = m.result || {};
    if (res.home_score != null) setHomeScore(String(res.home_score));
    else setHomeScore('0');
    if (res.away_score != null) setAwayScore(String(res.away_score));
    else setAwayScore('0');
    setScorers((res.scorers || []).join(', '));
    setStage(m.stage || '');
  }, []);

  const loadGroupsSetup = useCallback(async () => {
    try {
      const r = await api.get('/world-cup/staff/groups-setup');
      const groups = r.data?.groups || [];
      setGroupsSetup(groups);
      const initial = {};
      groups.forEach((g) => {
        if (g.winner_team_id) initial[g.group_id] = g.winner_team_id;
      });
      setGroupWinners((prev) => ({ ...initial, ...prev }));
    } catch (err) {
      toast.error(getApiErrorMessage(err));
      setGroupsSetup([]);
    }
  }, []);

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
      const matches = d.data?.matches || [];
      setSelectedMatchId((prev) => {
        const keep = prev && matches.some((m) => m.id === prev) ? prev : '';
        const pick = keep || (matches.find((m) => m.needs_result) || matches[0])?.id || '';
        if (pick) {
          const m = matches.find((x) => x.id === pick);
          const res = m?.result || {};
          if (res.home_score != null) setHomeScore(String(res.home_score));
          else if (!keep) setHomeScore('0');
          if (res.away_score != null) setAwayScore(String(res.away_score));
          else if (!keep) setAwayScore('0');
          setScorers((res.scorers || []).join(', '));
          if (m?.stage) setStage(m.stage);
        }
        return pick;
      });
      await loadGroupsSetup();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
      setDash(null);
      setPending(null);
    } finally {
      setLoading(false);
    }
  }, [loadGroupsSetup]);

  useEffect(() => {
    load();
  }, [load]);

  const applyGroupWinners = async ({ autoApprove = true } = {}) => {
    const winners = {};
    groupsSetup.forEach((g) => {
      const pick = groupWinners[g.group_id];
      if (pick) winners[g.group_id] = pick;
    });
    const count = Object.keys(winners).length;
    if (!count) {
      toast.error('Pick at least one group winner');
      return;
    }
    const msg = autoApprove
      ? `Set ${count} group winner(s) and pay correct picks now?`
      : `Set ${count} group winner(s) and queue payouts for approval?`;
    if (!window.confirm(msg)) return;
    if (autoApprove) setSettlingAndPaying(true);
    else setGroupWinnersSaving(true);
    try {
      const r = await api.post('/world-cup/staff/group-winners/bulk', {
        winners,
        auto_approve: autoApprove,
      });
      const paid = r.data?.payout;
      toast.success(
        autoApprove
          ? `Done — ${r.data?.groups_updated || 0} groups · ${Number(paid?.total_points || 0).toLocaleString()} pts paid`
          : `Queued — ${r.data?.groups_updated || 0} groups · ${r.data?.predictions_settled || 0} picks`
      );
      await load();
      await reloadPredictions();
      await loadGroupsSetup();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setGroupWinnersSaving(false);
      setSettlingAndPaying(false);
    }
  };

  const settleGroupsAndPay = async () => {
    if (!window.confirm('Auto-settle group winners from standings and pay everyone pending?')) return;
    setSettlingAndPaying(true);
    try {
      const r = await api.post('/world-cup/staff/settle-groups-and-pay', { auto_approve: true });
      const paid = r.data?.payout;
      toast.success(
        `Settled ${r.data?.groups_settled || 0} group(s) · paid ${Number(paid?.total_points || 0).toLocaleString()} pts`
      );
      await load();
      await reloadPredictions();
      await loadGroupsSetup();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setSettlingAndPaying(false);
    }
  };

  const runDraft = async () => {
    if (!window.confirm('Run team draft raffle for all entrants? This cannot be undone.')) return;
    setDraftRunning(true);
    try {
      const r = await api.post('/world-cup/staff/run-draft');
      toast.success(`Draft complete — ${r.data?.real_entrants ?? r.data?.entrants} real, ${r.data?.ghost_entrants ?? 0} ghost`);
      await load();
      await reloadPredictions();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setDraftRunning(false);
    }
  };

  const patchResult = async () => {
    const mid = selectedMatchId.trim();
    if (!mid) {
      toast.error('Pick a match first');
      return;
    }
    const h = parseInt(String(homeScore), 10);
    const a = parseInt(String(awayScore), 10);
    if (Number.isNaN(h) || Number.isNaN(a) || h < 0 || a < 0) {
      toast.error('Enter valid scores');
      return;
    }
    const label = selectedMatch?.label || 'this match';
    const payNote = autoApproveResult ? ' and pay winners' : '';
    if (!window.confirm(`Save ${label} as ${h}-${a}${payNote}?`)) return;
    setSavingResult(true);
    try {
      const r = await api.patch(`/world-cup/staff/match/${mid}/result`, {
        home_score: h,
        away_score: a,
        scorers: scorers.split(',').map((s) => s.trim()).filter(Boolean),
        stage: stage.trim() || undefined,
        auto_approve: autoApproveResult,
      });
      const paid = r.data?.payout;
      toast.success(
        autoApproveResult && paid
          ? `Saved · ${r.data?.predictions_settled || 0} picks settled · ${Number(paid?.total_points || 0).toLocaleString()} pts paid`
          : `Saved · ${r.data?.predictions_settled || 0} picks queued for approval`
      );
      await load();
      await reloadPredictions();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setSavingResult(false);
    }
  };

  const settleGroups = async () => {
    try {
      const r = await api.post('/world-cup/staff/settle-groups');
      toast.success(`Settled ${r.data?.groups_settled || 0} group(s)`);
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
    if (!count || !window.confirm(`Pay all ${count} pending winner(s) now?`)) return;
    setApprovingAll(true);
    try {
      const r = await api.post('/world-cup/staff/approve-all-payouts');
      toast.success(`Paid ${Number(r.data?.total_points || 0).toLocaleString()} pts total`);
      await load();
      await reloadPredictions();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setApprovingAll(false);
    }
  };

  useEffect(() => {
    if (loading || tab !== 'advanced') return undefined;
    const t = setTimeout(() => {
      loadPredictions(predFilters);
    }, 150);
    return () => clearTimeout(t);
  }, [loading, tab, predFilter, matchFilter, groupFilter, usernameFilter, verdictFilter, settledFilter, payoutFilter, loadPredictions]);

  const applyPredFilter = (id) => {
    setPredFilter(id);
    if (id !== 'match_score' && id !== 'match_scorer' && id !== 'all') setMatchFilter('');
    if (id !== 'group_winner' && id !== 'all') setGroupFilter('');
  };

  const pendingCount = pending?.pending_payouts ?? dash?.pending_payouts ?? 0;
  const predCounts = predMeta?.counts || {};
  const needsScoreCount = staffMatches.filter((m) => m.needs_result).length;

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(10rem+env(safe-area-inset-bottom))]`}>
      <style>{WC_STAFF_STYLES}</style>
      <div className="h-1 bg-gradient-to-r from-emerald-800 via-primary to-emerald-800 rounded" />
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/game/entertainer" className="text-mutedForeground hover:text-primary flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> Hub
        </Link>
        <Trophy className="text-primary" size={22} />
        <h1 className="text-lg font-heading font-bold text-primary uppercase tracking-wider">World Cup</h1>
        <button
          type="button"
          onClick={() => { load(); if (tab === 'advanced') reloadPredictions(); }}
          className="ml-auto min-h-[44px] px-3 rounded border border-primary/20 flex items-center gap-1 text-sm"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('quick')}
          className={`flex-1 min-h-[44px] rounded text-sm font-heading uppercase ${tab === 'quick' ? 'bg-primary/20 text-primary border border-primary/40' : 'border border-primary/10 text-mutedForeground'}`}
        >
          Quick actions
        </button>
        <button
          type="button"
          onClick={() => setTab('advanced')}
          className={`flex-1 min-h-[44px] rounded text-sm font-heading uppercase ${tab === 'advanced' ? 'bg-primary/20 text-primary border border-primary/40' : 'border border-primary/10 text-mutedForeground'}`}
        >
          Audit &amp; tools
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-mutedForeground">Loading…</p>
      ) : tab === 'quick' ? (
        <>
          <div className={`${styles.panel} mobile-panel rounded-lg border border-primary/20 p-4 flex flex-wrap gap-4 text-sm`}>
            <span><strong className="text-amber-400">{pendingCount}</strong> to pay</span>
            <span><strong>{needsScoreCount}</strong> need score</span>
            <span><strong>{dash?.entrants ?? 0}</strong> entrants</span>
            {pendingCount > 0 && (
              <button
                type="button"
                disabled={approvingAll}
                onClick={approveAll}
                className="ml-auto min-h-[40px] px-4 rounded bg-amber-600 text-white font-heading uppercase text-xs flex items-center gap-2"
              >
                <CheckCircle2 size={14} /> {approvingAll ? 'Paying…' : `Pay all (${pendingCount})`}
              </button>
            )}
          </div>

          <div className={`${styles.panel} mobile-panel rounded-lg border border-emerald-500/40 p-4 space-y-3`}>
            <h2 className="text-sm font-heading text-emerald-300 uppercase">1 · Enter match score</h2>
            <p className="text-[10px] text-mutedForeground">Pick the game, enter the final score, save. Winners are paid automatically if the box below is ticked.</p>
            <select
              value={selectedMatchId}
              onChange={(e) => applyMatchSelection(e.target.value, staffMatches)}
              className={WC_SELECT_LG}
            >
              <option value="">— pick a match —</option>
              {staffMatches.map((m) => (
                <option key={m.id} value={m.id}>{matchOptionLabel(m)}</option>
              ))}
            </select>
            {selectedMatch && (
              <p className="text-[10px] text-mutedForeground">
                {selectedMatch.home_team?.name || 'Home'} vs {selectedMatch.away_team?.name || 'Away'}
                {selectedMatch.stage ? ` · ${selectedMatch.stage.replace(/_/g, ' ')}` : ''}
              </p>
            )}
            <div className="flex items-center gap-3">
              <label className="flex-1 text-center">
                <span className="block text-[9px] uppercase text-mutedForeground mb-1">Home</span>
                <input
                  type="number"
                  min={0}
                  value={homeScore}
                  onChange={(e) => setHomeScore(e.target.value)}
                  className="w-full min-h-[52px] text-2xl text-center rounded border border-primary/30 bg-transparent tabular-nums"
                />
              </label>
              <span className="text-xl text-mutedForeground pt-5">–</span>
              <label className="flex-1 text-center">
                <span className="block text-[9px] uppercase text-mutedForeground mb-1">Away</span>
                <input
                  type="number"
                  min={0}
                  value={awayScore}
                  onChange={(e) => setAwayScore(e.target.value)}
                  className="w-full min-h-[52px] text-2xl text-center rounded border border-primary/30 bg-transparent tabular-nums"
                />
              </label>
            </div>
            <input
              type="text"
              value={scorers}
              onChange={(e) => setScorers(e.target.value)}
              placeholder="Goal scorers (optional, comma-separated)"
              className="w-full min-h-[44px] px-3 rounded border border-primary/20 bg-transparent text-sm"
            />
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={autoApproveResult} onChange={(e) => setAutoApproveResult(e.target.checked)} className="rounded" />
              <span>Pay winners immediately after saving</span>
            </label>
            <button
              type="button"
              disabled={savingResult || !selectedMatchId}
              onClick={patchResult}
              className="w-full min-h-[48px] rounded bg-emerald-600 text-white font-heading uppercase text-sm disabled:opacity-50"
            >
              {savingResult ? 'Saving…' : 'Save score'}
            </button>
            <button
              type="button"
              onClick={() => setShowAdvancedMatch((v) => !v)}
              className="w-full text-[10px] text-mutedForeground flex items-center justify-center gap-1"
            >
              {showAdvancedMatch ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showAdvancedMatch ? 'Hide' : 'Show'} stage override / match ID
            </button>
            {showAdvancedMatch && (
              <div className="space-y-2 pt-1 border-t border-primary/10">
                <select value={stage} onChange={(e) => setStage(e.target.value)} className={`${WC_SELECT_MD} w-full`}>
                  {STAGE_OPTIONS.map((o) => (
                    <option key={o.id || 'auto'} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <p className="text-[9px] text-mutedForeground font-mono break-all">ID: {selectedMatchId || '—'}</p>
              </div>
            )}
          </div>

          {(pending?.predictions?.length > 0 || pending?.jackpots?.length > 0) && (
            <div className={`${styles.panel} mobile-panel rounded-lg border border-amber-500/30 p-4 space-y-2`}>
              <h2 className="text-sm font-heading text-amber-300 uppercase">2 · Pay winners</h2>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {(pending?.predictions || []).map((row) => (
                  <div key={row.id} className="flex items-center gap-2 p-2 rounded border border-primary/10 bg-primary/5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{row.username}</p>
                      <p className="text-[10px] text-mutedForeground truncate">{row.label || row.type}</p>
                    </div>
                    <span className="text-sm text-primary tabular-nums shrink-0">{Number(row.points || 0).toLocaleString()}</span>
                    <button
                      type="button"
                      disabled={approvingId === row.id}
                      onClick={() => approvePrediction(row.id)}
                      className="min-h-[36px] px-3 rounded border border-emerald-500/40 text-emerald-300 text-[10px] font-heading uppercase shrink-0"
                    >
                      Pay
                    </button>
                  </div>
                ))}
                {(pending?.jackpots || []).map((row) => (
                  <div key={row.user_id} className="flex items-center gap-2 p-2 rounded border border-amber-500/20">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{row.username}</p>
                      <p className="text-[10px] text-mutedForeground">Jackpot</p>
                    </div>
                    <span className="text-sm text-amber-300 tabular-nums shrink-0">{Number(row.points || 0).toLocaleString()}</span>
                    <button
                      type="button"
                      disabled={approvingId === `jackpot:${row.user_id}`}
                      onClick={() => approveJackpot(row.user_id)}
                      className="min-h-[36px] px-3 rounded border border-emerald-500/40 text-emerald-300 text-[10px] font-heading uppercase shrink-0"
                    >
                      Pay
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`${styles.panel} mobile-panel rounded-lg border border-primary/20 p-4 space-y-3`}>
            <h2 className="text-sm font-heading text-primary uppercase">3 · Group winners</h2>
            <p className="text-[10px] text-mutedForeground">When a group is finished, pick who won. 2,500 pts per correct pick.</p>
            {!groupsSetup.length ? (
              <p className="text-sm text-mutedForeground">No groups loaded.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {groupsSetup.map((g) => (
                  <div key={g.group_id} className="flex items-center gap-2 p-2 rounded border border-primary/10">
                    <span className="text-xs font-heading text-primary w-14 shrink-0">Grp {g.group_id}</span>
                    <select
                      value={groupWinners[g.group_id] || ''}
                      onChange={(e) => setGroupWinners((prev) => ({ ...prev, [g.group_id]: e.target.value }))}
                      className={WC_SELECT_SM}
                    >
                      <option value="">— winner —</option>
                      {(g.teams || []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.flag_emoji ? `${t.flag_emoji} ` : ''}{t.name}
                        </option>
                      ))}
                    </select>
                    {g.settled && <span className="text-[9px] text-emerald-400 shrink-0">✓</span>}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              disabled={groupWinnersSaving || settlingAndPaying}
              onClick={() => applyGroupWinners({ autoApprove: true })}
              className="w-full min-h-[48px] rounded bg-primary/20 border border-primary/40 text-primary font-heading uppercase text-sm"
            >
              {settlingAndPaying ? 'Working…' : 'Save group winners & pay'}
            </button>
            <button
              type="button"
              disabled={settlingAndPaying}
              onClick={settleGroupsAndPay}
              className="w-full min-h-[40px] rounded border border-primary/10 text-[10px] font-heading uppercase text-mutedForeground"
            >
              Auto from standings + pay all
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={`${styles.panel} mobile-panel rounded-lg border border-primary/20 p-4 space-y-2 text-sm`}>
            <p>Entrants: <strong>{dash?.entrants ?? 0}</strong> ({dash?.real_entrants ?? 0} real · {dash?.ghost_entrants ?? 0} ghost)</p>
            <p>Pending payouts: <strong className={pendingCount ? 'text-amber-400' : ''}>{pendingCount}</strong></p>
            <p>Unsettled matches: <strong>{dash?.unsettled_matches ?? 0}</strong></p>
            <p>Draft: <strong>{dash?.draft_run ? 'Done' : 'Not run'}</strong></p>
            {!dash?.draft_run && (
              <button type="button" disabled={draftRunning} onClick={runDraft} className="w-full min-h-[44px] mt-2 rounded border border-primary/30 text-primary text-xs font-heading uppercase flex items-center justify-center gap-2">
                <Play size={14} /> {draftRunning ? 'Running…' : 'Run draft now'}
              </button>
            )}
            <button type="button" onClick={settleGroups} className="w-full min-h-[40px] rounded border border-primary/20 text-[10px] font-heading uppercase text-mutedForeground">
              Force settle groups (queue only)
            </button>
          </div>

          <div className={`${styles.panel} mobile-panel rounded-lg border border-primary/20 p-4 space-y-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardList size={16} className="text-primary" />
              <h2 className="text-sm font-heading text-primary uppercase">Player predictions</h2>
              <span className="text-[10px] text-mutedForeground ml-auto">{predictions.length} shown</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRED_FILTERS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPredFilter(id)}
                  className={`min-h-[36px] px-2.5 rounded text-[10px] font-heading uppercase ${predFilter === id ? 'bg-primary/15 text-primary border border-primary/30' : 'text-mutedForeground border border-primary/10'}`}
                >
                  {label}
                  {id !== 'all' && predCounts[id] != null ? ` (${predCounts[id]})` : ''}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="flex gap-1 sm:col-span-2">
                <input
                  type="text"
                  value={usernameQuery}
                  onChange={(e) => setUsernameQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setUsernameFilter(usernameQuery)}
                  placeholder="Search username"
                  className="flex-1 min-h-[40px] px-3 rounded border border-primary/20 bg-transparent text-sm"
                />
                <button type="button" onClick={() => setUsernameFilter(usernameQuery)} className="min-h-[40px] px-3 rounded border border-primary/20 text-xs font-heading uppercase">Search</button>
              </div>
              <select value={verdictFilter} onChange={(e) => setVerdictFilter(e.target.value)} className={WC_SELECT_MD}>
                {VERDICT_FILTERS.map(({ id, label }) => <option key={id || 'any'} value={id}>{label}</option>)}
              </select>
              <select value={settledFilter} onChange={(e) => setSettledFilter(e.target.value)} className={WC_SELECT_MD}>
                <option value="">Any settlement</option>
                <option value="no">Open only</option>
                <option value="yes">Settled only</option>
              </select>
            </div>
            {(predFilter === 'all' || predFilter === 'match_score' || predFilter === 'match_scorer') && (predMeta?.matches || []).length > 0 && (
              <select value={matchFilter} onChange={(e) => setMatchFilter(e.target.value)} className={WC_SELECT_LG}>
                <option value="">All matches</option>
                {(predMeta.matches || []).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}{m.result?.display ? ` · ${m.result.display}` : ''}</option>
                ))}
              </select>
            )}
            {!predictions.length ? (
              <p className="text-sm text-mutedForeground">No predictions for this filter.</p>
            ) : (
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto rounded border border-primary/10">
                <table className="w-full text-xs min-w-[700px]">
                  <thead className="sticky top-0 bg-[var(--noir-content,#111)]">
                    <tr className="border-b border-primary/10 text-left text-mutedForeground font-heading uppercase">
                      <th className="p-2 w-8" />
                      <th className="p-2">Player</th>
                      <th className="p-2">Target</th>
                      <th className="p-2">Pick</th>
                      <th className="p-2">Actual</th>
                      <th className="p-2">Verdict</th>
                      <th className="p-2 text-right">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {predictions.map((row) => {
                      const expanded = expandedPredId === row.id;
                      return (
                        <Fragment key={row.id}>
                          <tr className={`border-b border-primary/5 align-top cursor-pointer hover:bg-primary/5 ${expanded ? 'bg-primary/5' : ''}`} onClick={() => setExpandedPredId(expanded ? null : row.id)}>
                            <td className="p-2 text-mutedForeground">{expanded ? '▼' : '▶'}</td>
                            <td className="p-2 whitespace-nowrap">{row.username}</td>
                            <td className="p-2 max-w-[120px] truncate">{row.target_label || row.target_id}</td>
                            <td className="p-2 font-mono">{row.pick || '—'}</td>
                            <td className="p-2 font-mono">{row.actual || '—'}</td>
                            <td className={`p-2 uppercase ${verdictClass(row.verdict)}`}>{verdictLabel(row.verdict)}</td>
                            <td className="p-2 text-right tabular-nums">{row.settled ? Number(row.points_awarded || 0).toLocaleString() : '—'}</td>
                          </tr>
                          {expanded && (
                            <tr className="border-b border-primary/10 bg-black/20">
                              <td colSpan={7} className="p-3 text-[10px] space-y-1">
                                <p className="font-mono break-all">ID: {row.id}</p>
                                <p>{row.summary}</p>
                                {row.payout_status === 'pending' && (
                                  <button type="button" disabled={approvingId === row.id} onClick={(e) => { e.stopPropagation(); approvePrediction(row.id); }} className="mt-2 min-h-[32px] px-3 rounded border border-emerald-500/40 text-emerald-300 text-[10px] uppercase">
                                    Approve payout
                                  </button>
                                )}
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
                    <td className="p-2">{e.username || `${e.user_id?.slice(0, 8)}…`}</td>
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
