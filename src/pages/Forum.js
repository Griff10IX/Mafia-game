import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Lock, Pin, AlertCircle, Plus, ChevronDown, Settings } from 'lucide-react';
import api from '../utils/api';
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

const CreateTopicModal = ({ isOpen, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const insertEmoji = (emoji) => {
    setContent((c) => c + emoji);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Enter a title');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/forum/topics', { title: title.trim(), content: content.trim() });
      toast.success('Topic created');
      setTitle('');
      setContent('');
      onClose();
      onCreated();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create topic');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className={`${styles.panel} w-full max-w-lg rounded-lg overflow-hidden border-2 border-primary/30 shadow-2xl`}>
        <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
          <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest text-center">
            Create New Topic
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <input
            type="text"
            placeholder="Enter Title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-600/50 rounded text-foreground font-heading placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none"
          />
          <textarea
            placeholder="Enter Content..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-600/50 rounded text-foreground font-heading placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y"
          />
          <div className="flex flex-wrap gap-1">
            {EMOJI_STRIP.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => insertEmoji(em)}
                className="text-lg hover:scale-110 transition-transform"
              >
                {em}
              </button>
            ))}
            <button type="button" className="text-mutedForeground p-1">
              <ChevronDown size={16} />
            </button>
          </div>
          <div className="flex justify-center pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2 bg-primary/20 border border-primary/50 text-primary font-heading font-bold uppercase tracking-wider rounded hover:bg-primary/30 disabled:opacity-50"
            >
              {submitting ? '...' : 'Create Topic'}
            </button>
          </div>
        </form>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 -z-10"
        aria-label="Close"
      />
    </div>
  );
};

export default function Forum() {
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  const fetchTopics = useCallback(async () => {
    try {
      const res = await api.get('/forum/topics');
      setTopics(res.data?.topics ?? []);
    } catch {
      toast.error('Failed to load forum');
      setTopics([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  useEffect(() => {
    api.get('/admin/check').then((r) => setIsAdmin(!!r.data?.is_admin)).catch(() => setIsAdmin(false));
  }, []);

  const updateTopicFlags = async (topicId, payload, e) => {
    e.preventDefault();
    e.stopPropagation();
    setUpdatingId(topicId);
    try {
      await api.patch(`/forum/topics/${topicId}`, payload);
      toast.success('Updated');
      fetchTopics();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="forum-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-2">
            <MessageSquare size={28} />
            Main Forum
          </h1>
          <p className="text-sm text-mutedForeground font-heading mt-1">Discuss OC, crew wars, trades, and more</p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-primary/20 border border-primary/50 text-primary font-heading font-bold uppercase tracking-wider rounded hover:bg-primary/30 transition-colors"
        >
          <Plus size={18} />
          New Topic
        </button>
      </div>

      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className={`grid gap-2 px-4 py-2 bg-primary/10 border-b border-primary/30 text-xs font-heading font-bold text-primary uppercase tracking-widest ${isAdmin ? 'grid-cols-12' : 'grid-cols-12'}`}>
          <div className={isAdmin ? 'col-span-6' : 'col-span-7'}>Main Forum</div>
          <div className="col-span-2 text-right">Author</div>
          <div className="col-span-1 text-right">Posts</div>
          <div className="col-span-2 text-right">Views</div>
          {isAdmin && <div className="col-span-1 text-right">Admin</div>}
        </div>
        {loading ? (
          <div className="p-8 text-center text-mutedForeground font-heading">Loading...</div>
        ) : topics.length === 0 ? (
          <div className="p-8 text-center text-mutedForeground font-heading">No topics yet. Create one!</div>
        ) : (
          <ul className="divide-y divide-zinc-700/50">
            {topics.map((t) => (
              <li key={t.id} className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-zinc-800/30 transition-colors items-center">
                <Link
                  to={`/forum/topic/${t.id}`}
                  className={`flex items-center gap-2 min-w-0 ${isAdmin ? 'col-span-6' : 'col-span-7'}`}
                >
                  {t.is_important && (
                    <span className="text-amber-400 shrink-0" title="Important">
                      <AlertCircle size={14} />
                    </span>
                  )}
                  {t.is_sticky && !t.is_important && (
                    <span className="text-amber-400 shrink-0" title="Sticky">
                      <Pin size={14} />
                    </span>
                  )}
                  <span className={`truncate font-heading ${t.is_important || t.is_sticky ? 'text-amber-400/90' : 'text-foreground'}`}>
                    {t.is_important ? `IMPORTANT: ` : ''}
                    {t.is_sticky && !t.is_important ? `STICKY: ` : ''}
                    {t.title}
                  </span>
                  {t.is_locked && (
                    <Lock size={12} className="text-mutedForeground shrink-0" />
                  )}
                </Link>
                <div className="col-span-2 text-right text-mutedForeground text-sm truncate">
                  {t.author_username}
                  {t.is_locked && <Lock size={10} className="inline ml-0.5 text-mutedForeground" />}
                </div>
                <div className="col-span-1 text-right text-foreground font-heading tabular-nums">
                  {t.posts}
                </div>
                <div className="col-span-2 text-right text-mutedForeground font-heading tabular-nums">
                  {t.views}
                </div>
                {isAdmin && (
                  <div className="col-span-1 flex items-center justify-end gap-0.5" onClick={(e) => e.preventDefault()}>
                    <button
                      type="button"
                      title={t.is_sticky ? 'Unsticky' : 'Sticky'}
                      onClick={(e) => updateTopicFlags(t.id, { is_sticky: !t.is_sticky }, e)}
                      disabled={updatingId === t.id}
                      className={`p-1 rounded ${t.is_sticky ? 'bg-amber-500/20 text-amber-400' : 'text-mutedForeground hover:text-amber-400'}`}
                    >
                      <Pin size={14} />
                    </button>
                    <button
                      type="button"
                      title={t.is_important ? 'Not important' : 'Important'}
                      onClick={(e) => updateTopicFlags(t.id, { is_important: !t.is_important }, e)}
                      disabled={updatingId === t.id}
                      className={`p-1 rounded ${t.is_important ? 'bg-amber-500/20 text-amber-400' : 'text-mutedForeground hover:text-amber-400'}`}
                    >
                      <AlertCircle size={14} />
                    </button>
                    <button
                      type="button"
                      title={t.is_locked ? 'Unlock' : 'Lock'}
                      onClick={(e) => updateTopicFlags(t.id, { is_locked: !t.is_locked }, e)}
                      disabled={updatingId === t.id}
                      className={`p-1 rounded ${t.is_locked ? 'bg-red-500/20 text-red-400' : 'text-mutedForeground hover:text-red-400'}`}
                    >
                      <Lock size={14} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreateTopicModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={fetchTopics}
      />
    </div>
  );
}
