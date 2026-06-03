import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Trophy, RefreshCw, Play, ArrowLeft } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import styles from '../../styles/noir.module.css';

export default function WorldCupStaff() {
  const [dash, setDash] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftRunning, setDraftRunning] = useState(false);
  const [matchId, setMatchId] = useState('');
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [scorers, setScorers] = useState('');
  const [stage, setStage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, e] = await Promise.all([
        api.get('/world-cup/staff/dashboard'),
        api.get('/world-cup/staff/entries', { params: { limit: 200 } }),
      ]);
      setDash(d.data);
      setEntries(e.data?.entries || []);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
      setDash(null);
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
      toast.success(`Draft complete — ${r.data?.entrants} entrants, ${r.data?.teams} teams`);
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
      toast.success('Result saved and predictions settled');
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const settleGroups = async () => {
    try {
      const r = await api.post('/world-cup/staff/settle-groups');
      toast.success(`Settled ${r.data?.groups_settled || 0} group(s)`);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

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
            <p className="text-sm text-foreground">Entrants: <strong>{dash?.entrants ?? 0}</strong></p>
            <p className="text-sm text-foreground">Unsettled matches: <strong>{dash?.unsettled_matches ?? 0}</strong></p>
            <p className="text-sm text-foreground">Draft run: <strong>{dash?.draft_run ? 'Yes' : 'No'}</strong></p>
            <p className="text-[10px] text-mutedForeground">Last sync: {dash?.last_fixture_sync_at || '—'}</p>
            <p className="text-[10px] text-mutedForeground">Last auto-settle: {dash?.last_auto_settle_at || '—'}</p>
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
              Save result &amp; settle
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
                  <th className="p-2">Entered</th>
                  <th className="p-2">Teams</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.user_id} className="border-b border-primary/5">
                    <td className="p-2 font-mono text-[10px]">{e.user_id?.slice(0, 8)}…</td>
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
