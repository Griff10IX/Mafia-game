import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lightbulb } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

export default function GameIdeas() {
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState(null);
  const [entries, setEntries] = useState([]);
  const [myVoteEntryId, setMyVoteEntryId] = useState(null);
  const [votePhase, setVotePhase] = useState(null);
  const [votingId, setVotingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const activeRes = await api.get('/forum/game-ideas/active-season');
      const s = activeRes.data?.season;
      if (!s?.id) {
        setSeason(null);
        setEntries([]);
        setMyVoteEntryId(null);
        setVotePhase(null);
        return;
      }
      const entRes = await api.get(`/forum/game-ideas/seasons/${s.id}/entries`);
      setSeason(s);
      setEntries(entRes.data?.entries ?? []);
      setMyVoteEntryId(entRes.data?.my_vote_entry_id ?? null);
      setVotePhase(entRes.data?.vote_phase ?? null);
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to load');
      setSeason(null);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const hubId = season?.hub_topic_id;
  const status = season?.status;
  const canVote = status === 'primary' || status === 'final';

  const castVote = async (entryId) => {
    if (!season?.id || !canVote) return;
    setVotingId(entryId);
    try {
      await api.post(`/forum/game-ideas/seasons/${season.id}/vote`, { entry_id: entryId });
      toast.success('Vote saved');
      setMyVoteEntryId(entryId);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Vote failed');
    } finally {
      setVotingId(null);
    }
  };

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
      <div className="flex items-center gap-3">
        <Link to="/forum?tab=game_ideas" className="text-mutedForeground hover:text-primary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-lg font-heading font-bold text-primary flex items-center gap-2">
            <Lightbulb size={22} className="text-amber-400" />
            Game Ideas — vote
          </h1>
          <p className="text-[10px] text-mutedForeground mt-0.5">
            Post your idea in the hub topic, then register your post. Vote here during open rounds (not for your own entry).
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-mutedForeground">Loading…</p>
      ) : !season ? (
        <div className={`${styles.panel} rounded-md border border-primary/20 p-4 text-sm text-mutedForeground`}>
          No Game Ideas season is running yet. When staff start one, a hub topic will appear under <strong className="text-foreground">Forum → Game Ideas</strong>.
        </div>
      ) : (
        <>
          <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-xs space-y-2`}>
            <div className="font-heading font-bold text-primary">{season.title}</div>
            <div className="text-mutedForeground">
              Status: <span className="text-foreground capitalize">{status}</span>
              {votePhase && canVote && (
                <span className="ml-2">
                  · Phase: <span className="text-foreground">{votePhase}</span>
                </span>
              )}
            </div>
            {hubId && (
              <Link
                to={`/forum/topic/${hubId}`}
                className="inline-block text-primary font-heading font-bold hover:underline"
              >
                Open hub topic (post & register your idea) →
              </Link>
            )}
          </div>

          {!canVote && (
            <p className="text-[11px] text-mutedForeground">
              Voting is closed for this season. Final winners: staff may grant implementation rewards from admin tools.
            </p>
          )}

          <div className="space-y-2">
            {entries.length === 0 ? (
              <p className="text-xs text-mutedForeground">No entries yet.</p>
            ) : (
              entries.map((en) => (
                <div
                  key={en.id}
                  className={`${styles.panel} rounded-md border p-3 text-xs flex flex-wrap items-start justify-between gap-2 ${
                    myVoteEntryId === en.id ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-zinc-700/40'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-heading font-bold text-foreground">{en.author_username}</div>
                    <p className="text-mutedForeground mt-1 whitespace-pre-wrap break-words">{en.preview || '—'}</p>
                    <div className="text-[10px] text-mutedForeground mt-1 tabular-nums">Votes: {en.vote_count}</div>
                  </div>
                  {canVote && (
                    <button
                      type="button"
                      disabled={votingId === en.id}
                      onClick={() => castVote(en.id)}
                      className="shrink-0 px-3 py-1.5 bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase rounded hover:bg-primary/30 disabled:opacity-50"
                    >
                      {votingId === en.id ? '...' : myVoteEntryId === en.id ? 'Your vote' : 'Vote'}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
