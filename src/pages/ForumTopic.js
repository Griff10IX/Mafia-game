import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Lock, ThumbsUp, Send, ChevronDown, Pin, AlertCircle, Trash2, Settings } from 'lucide-react';
import api from '../utils/api';
import GifPicker from '../components/GifPicker';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const EMOJI_STRIP = ['😀', '😂', '👍', '❤️', '🔥', '😎', '👋', '🎉', '💀', '😢', '💰', '💵', '💎', '🎩', '🔫', '⚔️', '🎲', '👑', '🏆', '✨'];

function getTimeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const s = Math.floor((now - d) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ForumTopic() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const [topic, setTopic] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [likingId, setLikingId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);

  const fetchTopic = useCallback(async () => {
    if (!topicId) return;
    setLoading(true);
    try {
      const res = await api.get(`/forum/topics/${topicId}`);
      setTopic(res.data?.topic ?? null);
      setComments(res.data?.comments ?? []);
    } catch (e) {
      if (e.response?.status === 404) {
        toast.error('Topic not found');
        navigate('/forum');
      } else {
        toast.error('Failed to load topic');
      }
    } finally {
      setLoading(false);
    }
  }, [topicId, navigate]);

  useEffect(() => {
    fetchTopic();
  }, [fetchTopic]);

  useEffect(() => {
    api.get('/admin/check').then((r) => setIsAdmin(!!r.data?.is_admin)).catch(() => setIsAdmin(false));
  }, []);

  const updateTopicFlags = async (payload) => {
    setAdminBusy(true);
    try {
      await api.patch(`/forum/topics/${topicId}`, payload);
      toast.success('Updated');
      fetchTopic();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update');
    } finally {
      setAdminBusy(false);
    }
  };

  const deleteTopic = async () => {
    if (!window.confirm('Delete this topic and all comments? This cannot be undone.')) return;
    setAdminBusy(true);
    try {
      await api.delete(`/forum/topics/${topicId}`);
      toast.success('Topic deleted');
      navigate('/forum');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete');
    } finally {
      setAdminBusy(false);
    }
  };

  const insertEmoji = (emoji) => {
    setCommentText((c) => c + emoji);
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (topic?.is_locked) {
      toast.error('Topic is locked');
      return;
    }
    const text = commentText.trim();
    if (!text) {
      toast.error('Enter a comment');
      return;
    }
    setPosting(true);
    try {
      await api.post(`/forum/topics/${topicId}/comments`, { content: text });
      setCommentText('');
      toast.success('Comment posted');
      fetchTopic();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  };

  const handleSendGif = async (gifUrl) => {
    if (!gifUrl || posting || topic?.is_locked) return;
    setPosting(true);
    setShowGifPicker(false);
    try {
      await api.post(`/forum/topics/${topicId}/comments`, { content: '', gif_url: gifUrl });
      toast.success('GIF posted');
      fetchTopic();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to post GIF');
    } finally {
      setPosting(false);
    }
  };

  const likeComment = async (commentId) => {
    setLikingId(commentId);
    try {
      const res = await api.post(`/forum/topics/${topicId}/comments/${commentId}/like`);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, likes: res.data?.likes ?? c.likes, liked: res.data?.liked ?? false }
            : c
        )
      );
    } catch {
      toast.error('Failed to update like');
    } finally {
      setLikingId(null);
    }
  };

  if (loading && !topic) {
    return (
      <div className={`${styles.pageContent} flex items-center justify-center min-h-[40vh]`}>
        <div className="text-primary font-heading">Loading...</div>
      </div>
    );
  }
  if (!topic) {
    return null;
  }

  const commentCount = comments.length;

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="forum-topic-page">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => navigate('/forum')}
          className="text-sm text-mutedForeground hover:text-primary font-heading"
        >
          ← Forum
        </button>
        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-amber-400 font-heading uppercase flex items-center gap-1">
              <Settings size={12} /> Admin
            </span>
            <button
              type="button"
              title={topic.is_sticky ? 'Unsticky' : 'Sticky'}
              onClick={() => updateTopicFlags({ is_sticky: !topic.is_sticky })}
              disabled={adminBusy}
              className={`p-1.5 rounded border text-xs font-heading ${topic.is_sticky ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'border-zinc-600 text-mutedForeground hover:border-amber-500/50'}`}
            >
              <Pin size={14} /> Sticky
            </button>
            <button
              type="button"
              title={topic.is_important ? 'Not important' : 'Important'}
              onClick={() => updateTopicFlags({ is_important: !topic.is_important })}
              disabled={adminBusy}
              className={`p-1.5 rounded border text-xs font-heading ${topic.is_important ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'border-zinc-600 text-mutedForeground hover:border-amber-500/50'}`}
            >
              <AlertCircle size={14} /> Important
            </button>
            <button
              type="button"
              title={topic.is_locked ? 'Unlock' : 'Lock'}
              onClick={() => updateTopicFlags({ is_locked: !topic.is_locked })}
              disabled={adminBusy}
              className={`p-1.5 rounded border text-xs font-heading ${topic.is_locked ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'border-zinc-600 text-mutedForeground hover:border-red-500/50'}`}
            >
              <Lock size={14} /> Lock
            </button>
            <button
              type="button"
              onClick={deleteTopic}
              disabled={adminBusy}
              className="p-1.5 rounded border border-red-500/50 text-red-400 text-xs font-heading hover:bg-red-500/20"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Topic post */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="p-4 border-b border-primary/10">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="text-lg font-heading font-bold text-foreground">
              {topic.title}
            </h1>
            <div className="flex items-center gap-2 text-xs text-mutedForeground font-heading">
              <span>{topic.views ?? 0} Views</span>
              <span>/</span>
              <span>{commentCount} Comment{commentCount !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs text-mutedForeground font-heading">
            <span>/ {topic.author_username}</span>
            <span>·</span>
            <span>{getTimeAgo(topic.created_at)}</span>
            {topic.is_locked && (
              <>
                <span>·</span>
                <Lock size={12} className="inline" />
                <span>Locked</span>
              </>
            )}
          </div>
          <div className="mt-3 text-foreground font-heading whitespace-pre-wrap">
            {topic.content || '—'}
          </div>
          {!topic.is_locked && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => document.getElementById('forum-add-comment')?.focus()}
                className="text-xs font-heading text-primary hover:underline"
              >
                Add Comment
              </button>
            </div>
          )}
        </div>

        {/* Comments */}
        <div className="divide-y divide-zinc-700/50">
          {comments.map((c) => (
            <div key={c.id} className="p-4">
              <div className="flex items-center gap-2 text-xs text-mutedForeground font-heading">
                <span className="text-foreground font-bold">{c.author_username}</span>
                <span>{getTimeAgo(c.created_at)}</span>
                {c.likes > 0 && (
                  <span className="text-emerald-400">+{c.likes}</span>
                )}
              </div>
              <div className="mt-1 text-foreground font-heading whitespace-pre-wrap text-sm">
                {c.gif_url && (
                  <div className="mb-2">
                    <img src={c.gif_url} alt="GIF" className="rounded max-h-48 object-contain" />
                  </div>
                )}
                {c.content && c.content !== '(GIF)' && c.content}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => likeComment(c.id)}
                  disabled={likingId === c.id}
                  className={`flex items-center gap-1 text-xs font-heading ${c.liked ? 'text-primary' : 'text-mutedForeground hover:text-primary'}`}
                >
                  <ThumbsUp size={12} />
                  Like{c.likes > 0 ? ` (${c.likes})` : ''}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add comment */}
        {!topic.is_locked && (
          <div className="p-4 border-t border-primary/10">
            <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest mb-2">
              Add Comment
            </h3>
            {showGifPicker && (
              <div className="mb-2">
                <GifPicker
                  onSelect={handleSendGif}
                  onClose={() => setShowGifPicker(false)}
                />
              </div>
            )}
            <form onSubmit={postComment} className="space-y-2">
              <textarea
                id="forum-add-comment"
                placeholder="Enter Comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-600/50 rounded text-foreground font-heading placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y"
              />
              <div className="flex flex-wrap gap-1 items-center">
                <button
                  type="button"
                  onClick={() => setShowGifPicker((v) => !v)}
                  className="shrink-0 px-2 py-1 rounded border border-primary/30 text-primary text-xs font-heading hover:bg-primary/10"
                  title="Search GIFs"
                >
                  GIF
                </button>
                {EMOJI_STRIP.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => insertEmoji(em)}
                    className="text-base hover:scale-110 transition-transform"
                  >
                    {em}
                  </button>
                ))}
                <button type="button" className="text-mutedForeground p-0.5">
                  <ChevronDown size={14} />
                </button>
              </div>
              <button
                type="submit"
                disabled={posting}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-primary/20 border border-primary/50 text-primary font-heading font-bold uppercase tracking-wider rounded hover:bg-primary/30 disabled:opacity-50"
              >
                <Send size={14} />
                {posting ? '...' : 'Post Comment'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
