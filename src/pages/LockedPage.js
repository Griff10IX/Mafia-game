import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, LogOut } from 'lucide-react';
import api from '../utils/api';

const MAX_COMMENT_LENGTH = 2000;

export default function LockedPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/account-locked');
        if (cancelled) return;
        setData(res.data);
        if (!res.data?.account_locked) {
          navigate('/dashboard', { replace: true });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        if (e.response?.status === 403) {
          navigate('/locked', { replace: true });
          return;
        }
        setData({ account_locked: false });
        navigate('/dashboard', { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  const [secondsRemaining, setSecondsRemaining] = useState(null);
  useEffect(() => {
    const until = data?.account_locked_until;
    if (!until) {
      setSecondsRemaining(null);
      return;
    }
    const update = () => {
      const untilDate = new Date(until);
      const sec = Math.max(0, Math.ceil((untilDate - Date.now()) / 1000));
      setSecondsRemaining(sec);
      if (sec <= 0) {
        api.get('/account-locked').then((res) => {
          if (!res.data?.account_locked) navigate('/dashboard', { replace: true });
        }).catch(() => {});
      }
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [data?.account_locked_until, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!data?.can_submit_comment || submitting || !comment.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/account-locked', { comment: comment.trim() });
      setData((prev) => ({
        ...prev,
        can_submit_comment: false,
        comment: comment.trim(),
        comment_at: new Date().toISOString(),
      }));
      setComment('');
    } catch (err) {
      // keep form
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Lock size={28} className="text-primary/50 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-xs font-heading uppercase tracking-widest">Loading...</span>
        </div>
      </div>
    );
  }

  if (!data?.account_locked) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-amber-500/40 bg-zinc-900/80 p-6 shadow-xl">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Lock size={24} className="text-amber-400" />
          <h1 className="text-lg font-heading font-bold text-amber-400 uppercase tracking-wider">
            Account under investigation
          </h1>
        </div>
        <p className="text-sm text-zinc-300 font-heading mb-4 text-center">
          Your account is being reviewed. You can only access this page and submit one message explaining your side. We will get back to you once the investigation is complete.
        </p>

        {secondsRemaining != null && (
          <p className="text-center text-amber-400 font-heading font-bold text-sm mb-4">
            Unlocks in {secondsRemaining}s
          </p>
        )}

        {data.can_submit_comment ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-[10px] font-heading text-zinc-400 uppercase tracking-wider mb-1">
              Your message (one submission only)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
              placeholder="Explain your side..."
              rows={5}
              className="w-full px-3 py-2 rounded border border-zinc-600 bg-zinc-800/50 text-foreground text-sm font-heading placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none resize-y"
              maxLength={MAX_COMMENT_LENGTH}
              disabled={submitting}
            />
            <div className="text-[10px] text-zinc-500 font-heading text-right">
              {comment.length} / {MAX_COMMENT_LENGTH}
            </div>
            <button
              type="submit"
              disabled={submitting || !comment.trim()}
              className="w-full py-2.5 rounded font-heading font-bold text-sm uppercase tracking-wider border-2 border-amber-500/60 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </form>
        ) : (
          <div className="rounded border border-zinc-600/50 bg-zinc-800/30 p-4">
            <p className="text-[10px] font-heading text-zinc-400 uppercase tracking-wider mb-2">
              You have submitted your comment.
            </p>
            {data.comment ? (
              <p className="text-sm text-foreground font-heading whitespace-pre-wrap">{data.comment}</p>
            ) : (
              <p className="text-zinc-500 text-sm italic">No comment submitted.</p>
            )}
            {data.comment_at && (
              <p className="text-[10px] text-zinc-500 mt-2">
                Submitted {new Date(data.comment_at).toLocaleString()}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-zinc-700/50 flex justify-center">
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded font-heading text-xs text-zinc-400 hover:text-foreground hover:bg-zinc-800/50 transition-colors"
          >
            <LogOut size={14} />
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
