import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MessageSquare, Lock, Pin, AlertCircle, Plus, ChevronRight, Eye, MessageCircle, Dice5, Package, Users } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const EMOJI_STRIP = ['😀', '😂', '👍', '❤️', '🔥', '😎', '👋', '🎉', '💀', '😢', '💰', '💵', '💎', '🎩', '🔫', '⚔️', '🎲', '👑', '🏆', '✨'];

const AUTO_ROLL_SECONDS = 60;

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

function getSecondsUntilRoll(createdAt) {
  if (!createdAt) return 0;
  const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
  return Math.max(0, AUTO_ROLL_SECONDS - elapsed);
}

const CreateTopicModal = ({ isOpen, onClose, onCreated, category = 'general' }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);

  const insertEmoji = (emoji) => setContent((c) => c + emoji);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { toast.error('Enter a title'); return; }
    setSubmitting(true);
    try {
      await api.post('/forum/topics', { title: title.trim(), content: content.trim(), category });
      toast.success('Topic created');
      setTitle('');
      setContent('');
      onClose();
      onCreated();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className={`${styles.panel} w-full max-w-md rounded-md overflow-hidden border border-primary/30 shadow-2xl`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
            {category === 'entertainer' ? '🎭 Entertainer: New Topic' : '📝 Create New Topic'}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-3 space-y-3">
          <input
            type="text"
            placeholder="Title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none"
          />
          <textarea
            placeholder="Content..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y"
          />
          
          {/* Emoji toggle */}
          <div>
            <button type="button" onClick={() => setShowEmojis(!showEmojis)} className="text-[10px] text-mutedForeground hover:text-foreground">
              {showEmojis ? 'Hide emojis' : 'Add emoji'}
            </button>
            {showEmojis && (
              <div className="flex flex-wrap gap-1 mt-2">
                {EMOJI_STRIP.map((em) => (
                  <button key={em} type="button" onClick={() => insertEmoji(em)} className="text-base hover:scale-110 transition-transform p-0.5">
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-700/50 text-foreground text-xs font-heading font-bold uppercase rounded border border-zinc-600/50 hover:bg-zinc-600/50 transition-all">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground text-xs font-heading font-bold uppercase rounded border border-yellow-600/50 disabled:opacity-50 transition-all">
              {submitting ? '...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
      <button type="button" onClick={onClose} className="absolute inset-0 -z-10" aria-label="Close" />
    </div>
  );
};

const CreateGameModal = ({ isOpen, onClose, onCreated, me }) => {
  const [gameType, setGameType] = useState('dice');
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/forum/entertainer/games', {
        game_type: gameType,
        max_players: Math.max(1, Math.min(10, parseInt(maxPlayers, 10) || 10)),
        join_fee: 0,
      });
      toast.success('Game created');
      onClose();
      onCreated();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className={`${styles.panel} w-full max-w-sm rounded-md overflow-hidden border border-primary/30 shadow-2xl`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🎲 Create Game</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-3 space-y-3">
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Type</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setGameType('dice')} className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded border text-xs font-heading ${gameType === 'dice' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-600/50 text-mutedForeground'}`}>
                <Dice5 size={14} /> Dice
              </button>
              <button type="button" onClick={() => setGameType('gbox')} className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded border text-xs font-heading ${gameType === 'gbox' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-600/50 text-mutedForeground'}`}>
                <Package size={14} /> Gbox
              </button>
            </div>
            <p className="text-[10px] text-mutedForeground mt-1">Free to join. Winnings: random — points, cash, bullets, or cars.</p>
          </div>
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Players (1–10)</label>
            <input type="number" min={1} max={10} value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-700/50 text-foreground text-xs font-heading uppercase rounded border border-zinc-600/50">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground text-xs font-heading uppercase rounded border border-yellow-600/50 disabled:opacity-50">{submitting ? '...' : 'Create'}</button>
          </div>
        </form>
      </div>
      <button type="button" onClick={onClose} className="absolute inset-0 -z-10" aria-label="Close" />
    </div>
  );
};

// Topic row for desktop with hover preview
const TopicRowDesktop = ({ topic, isAdmin, onUpdate, updating }) => {
  const [showPreview, setShowPreview] = useState(false);
  
  return (
    <div 
      className="hidden sm:block relative"
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
    >
      <div className="grid grid-cols-12 gap-2 px-3 py-2 hover:bg-zinc-800/30 transition-colors items-center text-xs">
        <Link to={`/forum/topic/${topic.id}`} className={`flex items-center gap-1.5 min-w-0 ${isAdmin ? 'col-span-6' : 'col-span-7'}`}>
          {topic.is_important && <AlertCircle size={12} className="text-amber-400 shrink-0" />}
          {topic.is_sticky && !topic.is_important && <Pin size={12} className="text-amber-400 shrink-0" />}
          <span className={`truncate font-heading ${topic.is_important || topic.is_sticky ? 'text-amber-400' : 'text-foreground'}`}>
            {topic.is_important ? 'IMPORTANT: ' : ''}{topic.is_sticky && !topic.is_important ? 'STICKY: ' : ''}{topic.title}
          </span>
          {topic.is_locked && <Lock size={10} className="text-mutedForeground shrink-0" />}
        </Link>
        <div className="col-span-2 text-right text-mutedForeground truncate">{topic.author_username}</div>
        <div className="col-span-1 text-right text-foreground tabular-nums">{topic.posts}</div>
        <div className="col-span-2 text-right text-mutedForeground tabular-nums">{topic.views}</div>
        {isAdmin && (
          <div className="col-span-1 flex items-center justify-end gap-0.5">
            <button type="button" title={topic.is_sticky ? 'Unsticky' : 'Sticky'} onClick={(e) => { e.preventDefault(); onUpdate(topic.id, { is_sticky: !topic.is_sticky }); }} disabled={updating} className={`p-0.5 rounded ${topic.is_sticky ? 'text-amber-400' : 'text-mutedForeground hover:text-amber-400'}`}>
              <Pin size={12} />
            </button>
            <button type="button" title={topic.is_important ? 'Not important' : 'Important'} onClick={(e) => { e.preventDefault(); onUpdate(topic.id, { is_important: !topic.is_important }); }} disabled={updating} className={`p-0.5 rounded ${topic.is_important ? 'text-amber-400' : 'text-mutedForeground hover:text-amber-400'}`}>
              <AlertCircle size={12} />
            </button>
            <button type="button" title={topic.is_locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.preventDefault(); onUpdate(topic.id, { is_locked: !topic.is_locked }); }} disabled={updating} className={`p-0.5 rounded ${topic.is_locked ? 'text-red-400' : 'text-mutedForeground hover:text-red-400'}`}>
              <Lock size={12} />
            </button>
          </div>
        )}
      </div>
      
      {/* Hover Preview */}
      {showPreview && topic.preview && (
        <div className="absolute left-4 right-4 top-full z-20 mt-1 p-3 bg-zinc-900 border border-primary/30 rounded-md shadow-xl">
          <p className="text-xs text-mutedForeground line-clamp-3">{topic.preview}</p>
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-700/30 text-[10px] text-mutedForeground">
            <span>By <span className="text-foreground">{topic.author_username}</span></span>
            {topic.created_at && <span>{getTimeAgo(topic.created_at)}</span>}
            <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {topic.posts} replies</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Topic card for mobile
const TopicRowMobile = ({ topic, isAdmin, onUpdate, updating }) => (
  <Link to={`/forum/topic/${topic.id}`} className="sm:hidden block px-3 py-2 hover:bg-zinc-800/30 transition-colors active:bg-zinc-800/50">
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {topic.is_important && <AlertCircle size={12} className="text-amber-400 shrink-0" />}
          {topic.is_sticky && !topic.is_important && <Pin size={12} className="text-amber-400 shrink-0" />}
          <span className={`text-xs font-heading truncate ${topic.is_important || topic.is_sticky ? 'text-amber-400 font-bold' : 'text-foreground'}`}>
            {topic.title}
          </span>
          {topic.is_locked && <Lock size={10} className="text-mutedForeground shrink-0" />}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[10px] text-mutedForeground">
          <span>{topic.author_username}</span>
          <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {topic.posts}</span>
          <span className="flex items-center gap-0.5"><Eye size={10} /> {topic.views}</span>
        </div>
      </div>
      <ChevronRight size={16} className="text-mutedForeground shrink-0 mt-1" />
    </div>
    
    {/* Admin controls on mobile */}
    {isAdmin && (
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-zinc-700/30" onClick={(e) => e.preventDefault()}>
        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUpdate(topic.id, { is_sticky: !topic.is_sticky }); }} disabled={updating} className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] ${topic.is_sticky ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800/50 text-mutedForeground'}`}>
          <Pin size={10} /> {topic.is_sticky ? 'Unsticky' : 'Sticky'}
        </button>
        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUpdate(topic.id, { is_important: !topic.is_important }); }} disabled={updating} className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] ${topic.is_important ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800/50 text-mutedForeground'}`}>
          <AlertCircle size={10} /> {topic.is_important ? 'Unmark' : 'Important'}
        </button>
        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUpdate(topic.id, { is_locked: !topic.is_locked }); }} disabled={updating} className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] ${topic.is_locked ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800/50 text-mutedForeground'}`}>
          <Lock size={10} /> {topic.is_locked ? 'Unlock' : 'Lock'}
        </button>
      </div>
    )}
  </Link>
);

const FORUM_TABS = [
  { id: 'general', label: 'General' },
  { id: 'entertainer', label: 'Entertainer Forum' },
];

export default function Forum() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('general');
  const [topics, setTopics] = useState([]);
  useEffect(() => {
    if (location.state?.category === 'entertainer') setActiveTab('entertainer');
  }, [location.state?.category]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [gameModalOpen, setGameModalOpen] = useState(false);
  const [entertainerGames, setEntertainerGames] = useState([]);
  const [entertainerHistory, setEntertainerHistory] = useState([]);
  const [entertainerPrizes, setEntertainerPrizes] = useState(null);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [entertainerConfig, setEntertainerConfig] = useState({ auto_create_enabled: false, last_auto_create_at: null });
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [joiningId, setJoiningId] = useState(null);
  const [rollingId, setRollingId] = useState(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [creatingGames, setCreatingGames] = useState(false);
  const [, setTick] = useState(0);

  const fetchTopics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/forum/topics', { params: { category: activeTab } });
      setTopics(res.data?.topics ?? []);
    } catch {
      toast.error('Failed to load forum');
      setTopics([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  const fetchEntertainerGames = useCallback(async () => {
    setGamesLoading(true);
    try {
      const res = await api.get('/forum/entertainer/games');
      setEntertainerGames(res.data?.games ?? []);
    } catch {
      setEntertainerGames([]);
    } finally {
      setGamesLoading(false);
    }
  }, []);

  const fetchEntertainerHistory = useCallback(async () => {
    try {
      const res = await api.get('/forum/entertainer/games/history');
      setEntertainerHistory(res.data?.games ?? []);
    } catch {
      setEntertainerHistory([]);
    }
  }, []);

  const fetchEntertainerPrizes = useCallback(async () => {
    try {
      const res = await api.get('/forum/entertainer/prizes');
      setEntertainerPrizes(res.data ?? null);
    } catch {
      setEntertainerPrizes(null);
    }
  }, []);

  const fetchEntertainerConfig = useCallback(async () => {
    try {
      const res = await api.get('/forum/entertainer/admin/config');
      setEntertainerConfig(res.data ?? { auto_create_enabled: false, last_auto_create_at: null });
    } catch {
      setEntertainerConfig({ auto_create_enabled: false, last_auto_create_at: null });
    }
  }, []);

  useEffect(() => { fetchTopics(); }, [fetchTopics]);
  useEffect(() => {
    if (activeTab === 'entertainer') {
      fetchEntertainerGames();
      fetchEntertainerHistory();
      fetchEntertainerPrizes();
      fetchEntertainerConfig();
      api.get('/auth/me').then((r) => setUser(r.data)).catch(() => setUser(null));
    }
  }, [activeTab, fetchEntertainerGames, fetchEntertainerHistory, fetchEntertainerPrizes, fetchEntertainerConfig]);
  useEffect(() => {
    if (activeTab === 'entertainer') {
      const id = setInterval(fetchEntertainerGames, 10000);
      return () => clearInterval(id);
    }
  }, [activeTab, fetchEntertainerGames]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { api.get('/admin/check').then((r) => setIsAdmin(!!r.data?.is_admin)).catch(() => setIsAdmin(false)); }, []);

  const handleToggleAutoCreate = async () => {
    if (!isAdmin) return;
    setConfigSaving(true);
    try {
      await api.patch('/forum/entertainer/admin/config', { auto_create_enabled: !entertainerConfig.auto_create_enabled });
      setEntertainerConfig((c) => ({ ...c, auto_create_enabled: !c.auto_create_enabled }));
      toast.success(entertainerConfig.auto_create_enabled ? 'Auto-create disabled' : 'Auto-create enabled');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleCreateGamesNow = async () => {
    if (!isAdmin) return;
    setCreatingGames(true);
    try {
      const res = await api.post('/forum/entertainer/admin/auto-create');
      toast.success(res.data?.message || 'Games created');
      fetchEntertainerGames();
      fetchEntertainerHistory();
      fetchEntertainerConfig();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not create games. Try again.');
    } finally {
      setCreatingGames(false);
    }
  };

  const handleRollGame = async (gameId) => {
    if (!isAdmin) return;
    setRollingId(gameId);
    try {
      await api.post(`/forum/entertainer/games/${gameId}/roll`);
      toast.success('Game rolled');
      fetchEntertainerGames();
      fetchEntertainerHistory();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setRollingId(null);
    }
  };

  const updateTopicFlags = async (topicId, payload) => {
    setUpdatingId(topicId);
    try {
      await api.patch(`/forum/topics/${topicId}`, payload);
      toast.success('Updated');
      fetchTopics();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setUpdatingId(null);
    }
  };

  // Separate sticky/important topics
  const pinnedTopics = topics.filter(t => t.is_sticky || t.is_important);
  const regularTopics = topics.filter(t => !t.is_sticky && !t.is_important);

  const currentCategory = activeTab === 'entertainer' ? 'entertainer' : 'general';
  const openGames = (entertainerGames || []).filter((g) => g.status === 'open');
  const handleJoinGame = async (gameId) => {
    setJoiningId(gameId);
    try {
      await api.post(`/forum/entertainer/games/${gameId}/join`);
      toast.success('Joined');
      fetchEntertainerGames();
      fetchEntertainerHistory();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to join');
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="forum-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
            💬 Forum
          </h1>
          <p className="text-xs text-mutedForeground">
            {activeTab === 'general' ? 'Discuss OC, crews, trades & more' : 'Dice games, gbox — auto payout when full'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'entertainer' && !isAdmin && (
            <button
              onClick={() => setGameModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 border border-primary/50 text-primary text-xs font-heading font-bold uppercase rounded hover:bg-primary/30 transition-all"
            >
              <Dice5 size={14} /> New Game
            </button>
          )}
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground text-xs font-heading font-bold uppercase rounded border border-yellow-600/50 hover:from-yellow-500 hover:to-yellow-600 transition-all touch-manipulation"
          >
            <Plus size={14} /> New Topic
          </button>
        </div>
      </div>

      {/* Tabs: General | Entertainer Forum */}
      <div className="flex gap-1 p-1 bg-zinc-800/50 rounded border border-primary/20 w-fit">
        {FORUM_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-heading font-bold uppercase rounded transition-all ${activeTab === tab.id ? 'bg-primary/30 text-primary border border-primary/50' : 'text-mutedForeground hover:text-foreground border border-transparent'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Entertainer: Auto games (dice / gbox) */}
      {activeTab === 'entertainer' && (
        <>
          {/* Admin tools */}
          {isAdmin && (
            <div className={`${styles.panel} rounded-md overflow-hidden border border-amber-500/30`}>
              <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/30">
                <span className="text-xs font-heading font-bold text-amber-400 uppercase tracking-widest">🛠️ E-Games Admin</span>
              </div>
              <div className="p-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!entertainerConfig.auto_create_enabled}
                    onChange={handleToggleAutoCreate}
                    disabled={configSaving}
                    className="rounded border-primary/50"
                  />
                  <span className="text-xs font-heading">Auto-create 3–5 games every hour</span>
                </label>
                <button
                  type="button"
                  onClick={handleCreateGamesNow}
                  disabled={creatingGames}
                  className="px-2 py-1 bg-amber-500/20 border border-amber-500/50 text-amber-400 text-[10px] font-heading font-bold uppercase rounded hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {creatingGames ? '...' : 'Create games now'}
                </button>
                {entertainerConfig.last_auto_create_at && (
                  <span className="text-[10px] text-mutedForeground">
                    Last run: {getTimeAgo(entertainerConfig.last_auto_create_at)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* What you can win */}
          <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
            <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🎁 What you can win</span>
            </div>
            <div className="p-3 text-[11px]">
              {entertainerPrizes ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                    <div className="rounded bg-zinc-800/40 border border-zinc-700/30 px-2 py-1.5">
                      <span className="text-mutedForeground">Cash</span>
                      <span className="ml-2 text-primary font-heading font-bold">${entertainerPrizes.cash?.min?.toLocaleString()} – ${entertainerPrizes.cash?.max?.toLocaleString()}</span>
                    </div>
                    <div className="rounded bg-zinc-800/40 border border-zinc-700/30 px-2 py-1.5">
                      <span className="text-mutedForeground">Points</span>
                      <span className="ml-2 text-primary font-heading font-bold">{entertainerPrizes.points?.min} – {entertainerPrizes.points?.max}</span>
                    </div>
                    <div className="rounded bg-zinc-800/40 border border-zinc-700/30 px-2 py-1.5">
                      <span className="text-mutedForeground">Bullets</span>
                      <span className="ml-2 text-primary font-heading font-bold">{entertainerPrizes.bullets?.min} – {entertainerPrizes.bullets?.max}</span>
                    </div>
                  </div>
                  {entertainerPrizes.cars?.length > 0 && (
                    <div>
                      <div className="text-mutedForeground uppercase tracking-wider mb-1.5">Cars you can win</div>
                      <div className="space-y-1">
                        {["common", "uncommon", "rare"].map((rarity) => {
                          const list = (entertainerPrizes.cars || []).filter((c) => c.rarity === rarity);
                          if (!list.length) return null;
                          return (
                            <div key={rarity} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className={`font-heading font-bold capitalize shrink-0 ${rarity === 'rare' ? 'text-amber-400' : rarity === 'uncommon' ? 'text-blue-400' : 'text-zinc-300'}`}>
                                {rarity}:
                              </span>
                              <span className="text-foreground">{list.map((c) => c.name).join(', ')}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-mutedForeground">Loading prizes…</div>
              )}
            </div>
          </div>

          <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
            <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between flex-wrap gap-1">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🎲 Auto games</span>
              <span className="text-[10px] text-mutedForeground">Free to join · Win random: points, cash, bullets, cars · Rolls when full or after 60s</span>
            </div>
            {gamesLoading ? (
              <div className="p-4 text-center text-xs text-mutedForeground">Loading games...</div>
            ) : openGames.length === 0 ? (
              <div className="p-4 text-center text-xs text-mutedForeground">No open games. Create one above{entertainerConfig.auto_create_enabled ? ' or wait for the next hourly batch' : ''}.</div>
            ) : (
              <div className="divide-y divide-zinc-700/30">
                {openGames.map((g) => {
                  const participants = g.participants || [];
                  const isIn = user && participants.some((p) => p.user_id === user.id);
                  const secsLeft = getSecondsUntilRoll(g.created_at);
                  return (
                    <div key={g.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded bg-primary/20 border border-primary/30">
                          {g.game_type === 'dice' ? <Dice5 size={14} className="text-primary" /> : <Package size={14} className="text-primary" />}
                        </div>
                        <div>
                          <span className="text-xs font-heading font-bold text-foreground capitalize">{g.game_type}</span>
                          <span className="text-[10px] text-mutedForeground ml-2">
                            <Users size={10} className="inline" /> {participants.length}/{g.max_players}
                          </span>
                          <span className="text-primary text-[10px] ml-2">Winnings: points, cash, bullets, cars</span>
                          {g.manual_roll && (
                            <span className="text-[10px] text-mutedForeground ml-2">Manual roll</span>
                          )}
                          {secsLeft > 0 && !g.manual_roll && (
                            <span className="text-[10px] text-amber-400/90 ml-2">Rolls in {secsLeft}s</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isIn && g.status === 'open' && (
                          <button
                            onClick={() => handleJoinGame(g.id)}
                            disabled={joiningId === g.id}
                            className="px-2 py-1 bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase rounded hover:bg-primary/30 disabled:opacity-50"
                          >
                            {joiningId === g.id ? '...' : 'Join free'}
                          </button>
                        )}
                        {isIn && <span className="text-[10px] text-mutedForeground">You're in</span>}
                        {((isAdmin || (g.manual_roll && user && g.creator_id === user.id)) && g.status === 'open') && (
                          <button
                            type="button"
                            onClick={() => handleRollGame(g.id)}
                            disabled={rollingId === g.id}
                            className="px-2 py-1 bg-red-500/20 border border-red-500/50 text-red-400 text-[10px] font-heading font-bold uppercase rounded hover:bg-red-500/30 disabled:opacity-50"
                            title={g.manual_roll ? 'Roll when ready' : 'Force roll (admin)'}
                          >
                            {rollingId === g.id ? '...' : 'Roll now'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Last 10 Games */}
          <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
            <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">📜 Last 10 games</span>
            </div>
            {entertainerHistory.length === 0 ? (
              <div className="p-3 text-center text-[11px] text-mutedForeground">No completed games yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-zinc-700/30 text-left text-[10px] font-heading font-bold text-primary uppercase tracking-wider">
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Winner(s)</th>
                      <th className="px-3 py-2">Rewards</th>
                      <th className="px-3 py-2 text-right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entertainerHistory.map((h) => (
                      <tr key={h.id} className="border-b border-zinc-700/20 hover:bg-zinc-800/20">
                        <td className="px-3 py-1.5 font-heading capitalize">{h.game_type}</td>
                        <td className="px-3 py-1.5 text-mutedForeground">
                          {h.winner != null ? h.winner : (h.winners && h.winners.length ? h.winners.join(', ') : '—')}
                        </td>
                        <td className="px-3 py-1.5 text-primary text-[10px] max-w-[240px] break-words">
                          {h.reward_text || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-mutedForeground">{h.completed_at ? getTimeAgo(h.completed_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-mutedForeground">
        <span>{topics.length} topics</span>
        <span>{pinnedTopics.length} pinned</span>
      </div>

      {/* Topics List */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        {/* Desktop Header */}
        <div className={`hidden sm:grid grid-cols-12 gap-2 px-3 py-2 bg-primary/10 border-b border-primary/30 text-[10px] font-heading font-bold text-primary uppercase tracking-widest`}>
          <div className={isAdmin ? 'col-span-6' : 'col-span-7'}>Topic</div>
          <div className="col-span-2 text-right">Author</div>
          <div className="col-span-1 text-right">Posts</div>
          <div className="col-span-2 text-right">Views</div>
          {isAdmin && <div className="col-span-1 text-right">Admin</div>}
        </div>
        
        {/* Mobile Header */}
        <div className="sm:hidden px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">📋 Topics</span>
        </div>

        {loading ? (
          <div className="p-6 text-center text-xs text-mutedForeground">Loading...</div>
        ) : topics.length === 0 ? (
          <div className="p-6 text-center text-xs text-mutedForeground">No topics yet. Create one!</div>
        ) : (
          <div className="divide-y divide-zinc-700/30">
            {/* Pinned topics first */}
            {pinnedTopics.length > 0 && (
              <>
                {pinnedTopics.map((t) => (
                  <div key={t.id}>
                    <TopicRowDesktop topic={t} isAdmin={isAdmin} onUpdate={updateTopicFlags} updating={updatingId === t.id} />
                    <TopicRowMobile topic={t} isAdmin={isAdmin} onUpdate={updateTopicFlags} updating={updatingId === t.id} />
                  </div>
                ))}
                {regularTopics.length > 0 && (
                  <div className="px-3 py-1 bg-zinc-800/30 text-[10px] text-mutedForeground">Regular topics</div>
                )}
              </>
            )}
            
            {/* Regular topics */}
            {regularTopics.map((t) => (
              <div key={t.id}>
                <TopicRowDesktop topic={t} isAdmin={isAdmin} onUpdate={updateTopicFlags} updating={updatingId === t.id} />
                <TopicRowMobile topic={t} isAdmin={isAdmin} onUpdate={updateTopicFlags} updating={updatingId === t.id} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rules */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">ℹ️ Rules</span>
        </div>
        <div className="p-3">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Be respectful to other players</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>No real-world threats or harassment</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Keep trades in the marketplace</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>No spam or excessive posting</li>
          </ul>
        </div>
      </div>

      <CreateTopicModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onCreated={fetchTopics} category={currentCategory} />
      <CreateGameModal isOpen={gameModalOpen} onClose={() => setGameModalOpen(false)} onCreated={() => { fetchEntertainerGames(); window.dispatchEvent(new CustomEvent('app:refresh-user')); }} me={user} />
    </div>
  );
}
