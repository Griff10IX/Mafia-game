import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Trophy, RefreshCw, Play, ArrowLeft, CheckCircle2 } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import styles from '../../styles/noir.module.css';

export default function WorldCupStaff() {
  const [dash, setDash] = useState(null);
  const [entries, setEntries] = useState([]);
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draftRunning, setDraftRunning] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [approvingId, setApprovingId] = useState(null);
  const [matchId, setMatchId] = useState('');
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [scorers, setScorers] = useState('');
  const [stage, setStage] = useState('');

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
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const settleGroups = async () => {
    try {
      const r = await api.post('/world-cup/staff/settle-groups');
      toast.success(`Settled ${r.data?.groups_settled || 0} group(s) — winners queued for approval`);
      await load();
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
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setApprovingAll(false);
    }
  };

  const pendingCount = pending?.pending_payouts ?? dash?.pending_payouts ?? 0;

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(10rem+env(safe-area-inset-bottom))]`}>
      <div className="h-1 bg-gradient-to-r from-emerald-800 via-primary to-emerald-800 rounded" />
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/game/entertainer" className="text-mutedForeground hover:text-primary flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> Hub
        </Link>
        <Trophy className="text-primary" size={22} />
        <h1 className="text-lg font-heading font-bold text-primary uppercase tracking-wider">World Cup Staff</h1>
        <button type="button" onClick={load} className="ml-auto min-h-[44px] px-3 rounded border border-primary/20 flex items-center gap-1 text-sm">
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
            {!dash?.draft_run && (
              <button
                type="button"
                disabled={draftRunning}
                onClick={runDraft}
                className="w-full min-h-[44px] mt-2 rounded bg-primary text-primary-foreground font-heading uppercase text-sm flex items-center justify-center gap-2"
              >
                <Play size={16} /> {draftRunning ? 'Running…' : 'Run team draft raffle'}
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
                    <td className="p-2 font-mono text-[10px]">{e.user_id?.slice(0, 8)}…</td>
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
