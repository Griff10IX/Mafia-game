import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { MessageSquare, Lock, Pin, AlertCircle, Plus, ChevronRight, Eye, MessageCircle, Dice5, Package, Users, Bold, Italic, Image, Palette } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import GifPicker from '../components/GifPicker';
import { parseForumContent, insertAtCursor } from '../utils/forumContent';
import styles from '../styles/noir.module.css';

const FORUM_STYLES = `
  @keyframes f-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .f-fade-in { animation: f-fade-in 0.4s ease-out both; }
  .f-card { transition: all 0.3s ease; }
  .f-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .f-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .f-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

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

/** Seconds until next batch (next_auto_create_at). */
function getSecondsUntilNextBatch(nextAutoCreateAt) {
  if (!nextAutoCreateAt) return 0;
  const secs = Math.floor((new Date(nextAutoCreateAt).getTime() - Date.now()) / 1000);
  return Math.max(0, secs);
}

/** Seconds until the roll window (20 mins before next batch). */
function getSecondsUntilRollWindow(nextAutoCreateAt) {
  if (!nextAutoCreateAt) return 0;
  const nextBatch = new Date(nextAutoCreateAt).getTime();
  const rollAt = nextBatch - 20 * 60 * 1000;
  const secs = Math.floor((rollAt - Date.now()) / 1000);
  return Math.max(0, secs);
}

function formatTimeUntil(seconds) {
  if (seconds <= 0) return 'soon';
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

const CreateTopicModal = ({ isOpen, onClose, onCreated, category = 'general' }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [topicGifUrl, setTopicGifUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const contentTextareaRef = useRef(null);

  const insertEmoji = (emoji) => setContent((c) => c + emoji);

  const insertTopicMarkup = (before, after = '') => {
    const ta = contentTextareaRef.current;
    if (!ta) {
      setContent((c) => c + before + after);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const { value, cursor } = insertAtCursor(content, before, after, start, end);
    setContent(value);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { toast.error('Enter a title'); return; }
    setSubmitting(true);
    try {
      const payload = { title: title.trim(), content: content.trim(), category };
      if (topicGifUrl.trim()) payload.gif_url = topicGifUrl.trim();
      await api.post('/forum/topics', payload);
      toast.success('Topic created');
      setTitle('');
      setContent('');
      setTopicGifUrl('');
      onClose();
      onCreated();
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : (Array.isArray(detail) ? detail.map((x) => x?.msg || x).join(', ') : null) || 'Failed to create topic');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className={`${styles.panel} w-full max-w-md rounded-lg overflow-hidden border border-primary/20 shadow-2xl`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
            {category === 'entertainer' ? '🎭 Entertainer: New Topic' : category === 'designer' ? '🎨 Designer Forum: New Topic' : '📝 Create New Topic'}
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
          {showGifPicker && (
            <div className="rounded border border-zinc-700/50 overflow-hidden">
              <GifPicker
                onSelect={(url) => {
                  if (url) {
                    setTopicGifUrl(url);
                    insertTopicMarkup('[gif]' + url + '[/gif]');
                  }
                  setShowGifPicker(false);
                }}
                onClose={() => setShowGifPicker(false)}
              />
            </div>
          )}
          <textarea
            ref={contentTextareaRef}
            placeholder="Content... Use [b]bold[/b], [i]italic[/i], [color=red]coloured[/color], [img]url[/img], [gif]url[/gif], or :) smileys"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y"
          />
          
          {/* Rich toolbar */}
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={() => insertTopicMarkup('[b]', '[/b]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Bold"><Bold size={14} /></button>
            <button type="button" onClick={() => insertTopicMarkup('[i]', '[/i]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Italic"><Italic size={14} /></button>
            <button type="button" onClick={() => insertTopicMarkup('[color=#eab308]', '[/color]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Colour"><Palette size={14} /></button>
            <button type="button" onClick={() => { const u = window.prompt('Image URL (http/https):'); if (u && u.trim()) insertTopicMarkup('[img]' + u.trim() + '[/img]'); }} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Image"><Image size={14} /></button>
            <button type="button" onClick={() => setShowGifPicker((v) => !v)} className="px-2 py-1 rounded border border-primary/30 text-primary text-[10px] font-heading hover:bg-primary/10">GIF</button>
            <button type="button" onClick={() => setShowEmojis(!showEmojis)} className="px-2 py-1 rounded border border-zinc-700/50 text-mutedForeground text-[10px] font-heading hover:text-foreground">{showEmojis ? 'Hide emoji' : '😀 Emoji'}</button>
          </div>
          {showEmojis && (
            <div className="flex flex-wrap gap-1">
              {EMOJI_STRIP.map((em) => (
                <button key={em} type="button" onClick={() => insertEmoji(em)} className="text-base hover:scale-110 transition-transform p-0.5">
                  {em}
                </button>
              ))}
            </div>
          )}
          
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-700/50 text-foreground text-xs font-heading font-bold uppercase rounded border border-zinc-600/50 hover:bg-zinc-600/50 transition-all">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all">
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
  const [pot, setPot] = useState(0);
  const [joinFee, setJoinFee] = useState(0);
  const [manualRoll, setManualRoll] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/forum/entertainer/games', {
        game_type: gameType,
        max_players: Math.max(1, Math.min(10, parseInt(maxPlayers, 10) || 10)),
        join_fee: Math.max(0, parseInt(joinFee, 10) || 0),
        pot: Math.max(0, parseInt(pot, 10) || 0),
        manual_roll: manualRoll,
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
      <div className={`${styles.panel} w-full max-w-sm rounded-lg overflow-hidden border border-primary/20 shadow-2xl`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🎲 Create Game</h2>
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
            <p className="text-[10px] text-mutedForeground mt-1">Winnings: random — points, cash, bullets, or cars. Optional pot & entry fee.</p>
          </div>
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Players (1–10)</label>
            <input type="number" min={1} max={10} value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground" />
          </div>
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Pot ($ you put in)</label>
            <input type="number" min={0} value={pot} onChange={(e) => setPot(e.target.value)} placeholder="0" className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground" />
          </div>
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Entry fee ($ per player)</label>
            <input type="number" min={0} value={joinFee} onChange={(e) => setJoinFee(e.target.value)} placeholder="0" className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={manualRoll} onChange={(e) => setManualRoll(e.target.checked)} className="w-4 h-4 accent-primary" />
            <span className="text-xs font-heading text-foreground">Manual roll (I roll when ready)</span>
          </label>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-700/50 text-foreground text-xs font-heading uppercase rounded border border-zinc-600/50">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-primary/20 text-primary text-xs font-heading uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50">{submitting ? '...' : 'Create'}</button>
          </div>
        </form>
      </div>
      <button type="button" onClick={onClose} className="absolute inset-0 -z-10" aria-label="Close" />
    </div>
  );
};

// Topic row for desktop with hover preview. canStickyImportant = admin/mod (sticky, important, lock). canLock = admin/mod/hdo (lock only for HDO).
const TopicRowDesktop = ({ topic, canStickyImportant, canLock, onUpdate, updating, designerCompId, myEntryTopicIds, meUsername, onSubmitToComp, submittingTopicId }) => {
  const [showPreview, setShowPreview] = useState(false);
  const showFlagControls = canStickyImportant || canLock;
  const isMyTopic = meUsername && topic.author_username === meUsername;
  const showDesignerSubmit = designerCompId && isMyTopic;
  const alreadySubmitted = showDesignerSubmit && (myEntryTopicIds || []).includes(topic.id);
  const isSubmitting = submittingTopicId === topic.id;
  const titleHtml = parseForumContent(topic.title || '');

  return (
    <div 
      className="hidden sm:block relative"
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
    >
      <div className="grid grid-cols-12 gap-2 px-3 py-2 f-row transition-colors items-center text-xs">
        <div className={`flex items-center gap-1.5 min-w-0 ${showFlagControls ? 'col-span-6' : 'col-span-7'}`}>
          <Link to={`/forum/topic/${topic.id}`} className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
            {topic.is_important && <AlertCircle size={12} className="text-amber-400 shrink-0" />}
            {topic.is_sticky && !topic.is_important && <Pin size={12} className="text-amber-400 shrink-0" />}
            <span
              className={`truncate font-heading ${topic.is_important || topic.is_sticky ? 'text-amber-400' : 'text-foreground'}`}
              dangerouslySetInnerHTML={{
                __html: `${topic.is_important ? 'IMPORTANT: ' : ''}${topic.is_sticky && !topic.is_important ? 'STICKY: ' : ''}${titleHtml}`,
              }}
            />
            {topic.is_locked && <Lock size={10} className="text-mutedForeground shrink-0" />}
          </Link>
          {showDesignerSubmit && (
            <span className="shrink-0" onClick={(e) => e.preventDefault()} role="presentation">
              {alreadySubmitted ? (
                <span className="text-[10px] text-emerald-400 font-heading font-bold">Submitted</span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSubmitToComp(designerCompId, topic.id); }}
                  disabled={isSubmitting}
                  className="text-[10px] font-heading font-bold text-primary hover:underline disabled:opacity-50"
                >
                  {isSubmitting ? '...' : 'Submit to competition'}
                </button>
              )}
            </span>
          )}
        </div>
        <div className="col-span-2 text-right truncate">
          <Link to={`/profile/${encodeURIComponent(topic.author_username)}`} className="text-mutedForeground hover:text-primary hover:underline">{topic.author_username}</Link>
        </div>
        <div className="col-span-1 text-right text-foreground tabular-nums">{topic.posts}</div>
        <div className="col-span-2 text-right text-mutedForeground tabular-nums">{topic.views}</div>
        {showFlagControls && (
          <div className="col-span-1 flex items-center justify-end gap-0.5">
            {canStickyImportant && (
              <>
                <button type="button" title={topic.is_sticky ? 'Unsticky' : 'Sticky'} onClick={(e) => { e.preventDefault(); onUpdate(topic.id, { is_sticky: !topic.is_sticky }); }} disabled={updating} className={`p-0.5 rounded ${topic.is_sticky ? 'text-amber-400' : 'text-mutedForeground hover:text-amber-400'}`}>
                  <Pin size={12} />
                </button>
                <button type="button" title={topic.is_important ? 'Not important' : 'Important'} onClick={(e) => { e.preventDefault(); onUpdate(topic.id, { is_important: !topic.is_important }); }} disabled={updating} className={`p-0.5 rounded ${topic.is_important ? 'text-amber-400' : 'text-mutedForeground hover:text-amber-400'}`}>
                  <AlertCircle size={12} />
                </button>
              </>
            )}
            {canLock && (
              <button type="button" title={topic.is_locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.preventDefault(); onUpdate(topic.id, { is_locked: !topic.is_locked }); }} disabled={updating} className={`p-0.5 rounded ${topic.is_locked ? 'text-red-400' : 'text-mutedForeground hover:text-red-400'}`}>
                <Lock size={12} />
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Hover Preview */}
      {showPreview && topic.preview && (
        <div className="absolute left-4 right-4 top-full z-20 mt-1 p-3 bg-zinc-900 border border-primary/30 rounded-md shadow-xl">
          <p className="text-xs text-mutedForeground line-clamp-3">{topic.preview}</p>
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-700/30 text-[10px] text-mutedForeground">
            <span>By <Link to={`/profile/${encodeURIComponent(topic.author_username)}`} className="text-foreground hover:text-primary hover:underline">{topic.author_username}</Link></span>
            {topic.created_at && <span>{getTimeAgo(topic.created_at)}</span>}
            <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {topic.posts} replies</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Topic card for mobile. canStickyImportant = admin/mod, canLock = admin/mod/hdo.
const TopicRowMobile = ({ topic, canStickyImportant, canLock, onUpdate, updating, designerCompId, myEntryTopicIds, meUsername, onSubmitToComp, submittingTopicId }) => {
  const showFlagControls = canStickyImportant || canLock;
  const isMyTopic = meUsername && topic.author_username === meUsername;
  const showDesignerSubmit = designerCompId && isMyTopic;
  const alreadySubmitted = showDesignerSubmit && (myEntryTopicIds || []).includes(topic.id);
  const isSubmitting = submittingTopicId === topic.id;
  const titleHtml = parseForumContent(topic.title || '');

  return (
  <Link to={`/forum/topic/${topic.id}`} className="sm:hidden block px-3 py-2 f-row transition-colors active:bg-zinc-800/50">
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {topic.is_important && <AlertCircle size={12} className="text-amber-400 shrink-0" />}
          {topic.is_sticky && !topic.is_important && <Pin size={12} className="text-amber-400 shrink-0" />}
          <span
            className={`text-xs font-heading truncate ${topic.is_important || topic.is_sticky ? 'text-amber-400 font-bold' : 'text-foreground'}`}
            dangerouslySetInnerHTML={{ __html: titleHtml }}
          />
          {topic.is_locked && <Lock size={10} className="text-mutedForeground shrink-0" />}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[10px] text-mutedForeground">
          <Link to={`/profile/${encodeURIComponent(topic.author_username)}`} onClick={(e) => e.stopPropagation()} className="hover:text-primary hover:underline">{topic.author_username}</Link>
          <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {topic.posts}</span>
          <span className="flex items-center gap-0.5"><Eye size={10} /> {topic.views}</span>
        </div>
      </div>
      <ChevronRight size={16} className="text-mutedForeground shrink-0 mt-1" />
    </div>

    {/* Staff controls on mobile: mod/admin = sticky, important, lock; HDO = lock only */}
    {showFlagControls && (
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-zinc-700/30" onClick={(e) => e.preventDefault()}>
        {canStickyImportant && (
          <>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUpdate(topic.id, { is_sticky: !topic.is_sticky }); }} disabled={updating} className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] ${topic.is_sticky ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800/50 text-mutedForeground'}`}>
              <Pin size={10} /> {topic.is_sticky ? 'Unsticky' : 'Sticky'}
            </button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUpdate(topic.id, { is_important: !topic.is_important }); }} disabled={updating} className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] ${topic.is_important ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800/50 text-mutedForeground'}`}>
              <AlertCircle size={10} /> {topic.is_important ? 'Unmark' : 'Important'}
            </button>
          </>
        )}
        {canLock && (
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUpdate(topic.id, { is_locked: !topic.is_locked }); }} disabled={updating} className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] ${topic.is_locked ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800/50 text-mutedForeground'}`}>
            <Lock size={10} /> {topic.is_locked ? 'Unlock' : 'Lock'}
          </button>
        )}
      </div>
    )}
    {showDesignerSubmit && (
      <div className="px-3 py-1.5 border-t border-zinc-700/30" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        {alreadySubmitted ? (
          <span className="text-[10px] text-emerald-400 font-heading font-bold">Submitted to competition</span>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSubmitToComp(designerCompId, topic.id); }}
            disabled={isSubmitting}
            className="px-2 py-1 bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold rounded hover:bg-primary/30 disabled:opacity-50"
          >
            {isSubmitting ? '...' : 'Submit to competition'}
          </button>
        )}
      </div>
    )}
  </Link>
  );
};

const FORUM_TABS = [
  { id: 'general', label: 'General' },
  { id: 'entertainer', label: 'Entertainer Forum' },
  { id: 'designer', label: 'Designer Forum' },
  { id: 'crew_oc', label: 'Crew OC' },
];

export default function Forum() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    if (t === 'entertainer' || t === 'designer' || t === 'crew_oc') return t;
    return 'general';
  });
  const [topics, setTopics] = useState([]);
  const [forumPage, setForumPage] = useState(1);
  const [canViewPage2, setCanViewPage2] = useState(false);
  useEffect(() => {
    if (searchParams.get('tab') === 'entertainer' || location.state?.category === 'entertainer') setActiveTab('entertainer');
    else if (searchParams.get('tab') === 'designer') setActiveTab('designer');
    else if (searchParams.get('tab') === 'crew_oc' || location.state?.category === 'crew_oc') setActiveTab('crew_oc');
    else setActiveTab('general');
  }, [searchParams, location.state?.category]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [gameModalOpen, setGameModalOpen] = useState(false);
  const [entertainerGames, setEntertainerGames] = useState([]);
  const [entertainerHistory, setEntertainerHistory] = useState([]);
  const [entertainerPrizes, setEntertainerPrizes] = useState(null);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [entertainerConfig, setEntertainerConfig] = useState({ auto_create_enabled: false, last_auto_create_at: null, next_auto_create_at: null });
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [isHdo, setIsHdo] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [joiningId, setJoiningId] = useState(null);
  const [rollingId, setRollingId] = useState(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [creatingGames, setCreatingGames] = useState(false);
  const [, setTick] = useState(0);
  const [activeDesignerComp, setActiveDesignerComp] = useState(null);
  const [myVoteEntryId, setMyVoteEntryId] = useState(null);
  const [designerEntries, setDesignerEntries] = useState([]);
  const [designerEntriesLoading, setDesignerEntriesLoading] = useState(false);
  const [designerVotingId, setDesignerVotingId] = useState(null);
  const [canWithdrawVote, setCanWithdrawVote] = useState(false);
  const [designerWithdrawingId, setDesignerWithdrawingId] = useState(null);
  const [designerCompManageOpen, setDesignerCompManageOpen] = useState(false);
  const [designerCompsList, setDesignerCompsList] = useState([]);
  const [designerCompForm, setDesignerCompForm] = useState({ title: '', description: '', start_at: '', end_at: '', reward_money: 0, reward_points: 0 });
  const [designerCompSubmitting, setDesignerCompSubmitting] = useState(false);
  const [designerCompEndingId, setDesignerCompEndingId] = useState(null);
  const [designerCompStartingId, setDesignerCompStartingId] = useState(null);
  const [myEntryCommentId, setMyEntryCommentId] = useState(null);
  const [designerSubmittingEntry, setDesignerSubmittingEntry] = useState(false);
  const [designerSubmittingTopicId, setDesignerSubmittingTopicId] = useState(null);

  const fetchTopics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/forum/topics', { params: { category: activeTab, page: forumPage } });
      setTopics(res.data?.topics ?? []);
      setCanViewPage2(!!res.data?.can_view_page_2);
    } catch {
      toast.error('Failed to load forum');
      setTopics([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, forumPage]);

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
      setEntertainerConfig(res.data ?? { auto_create_enabled: false, last_auto_create_at: null, next_auto_create_at: null });
    } catch {
      setEntertainerConfig({ auto_create_enabled: false, last_auto_create_at: null, next_auto_create_at: null });
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
      const id = setInterval(() => {
        fetchEntertainerGames();
        fetchEntertainerConfig();
      }, 10000);
      return () => clearInterval(id);
    }
  }, [activeTab, fetchEntertainerGames, fetchEntertainerConfig]);

  const fetchActiveDesignerComp = useCallback(async () => {
    try {
      const res = await api.get('/forum/designer/competitions/active');
      setActiveDesignerComp(res.data?.competition ?? null);
      setMyVoteEntryId(res.data?.my_vote_entry_id ?? null);
      setMyEntryCommentId(res.data?.my_entry_comment_id ?? null);
    } catch {
      setActiveDesignerComp(null);
      setMyVoteEntryId(null);
      setMyEntryCommentId(null);
    }
  }, []);

  const fetchDesignerEntries = useCallback(async (compId) => {
    if (!compId) return;
    setDesignerEntriesLoading(true);
    try {
      const res = await api.get(`/forum/designer/competitions/${compId}/entries`);
      setDesignerEntries(res.data?.entries ?? []);
      setMyVoteEntryId(res.data?.my_vote_entry_id ?? null);
      setCanWithdrawVote(!!res.data?.can_withdraw_vote);
    } catch {
      setDesignerEntries([]);
      setCanWithdrawVote(false);
    } finally {
      setDesignerEntriesLoading(false);
    }
  }, []);

  const fetchDesignerCompsList = useCallback(async () => {
    try {
      const res = await api.get('/forum/designer/competitions');
      setDesignerCompsList(res.data?.competitions ?? []);
    } catch {
      setDesignerCompsList([]);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'designer') {
      fetchActiveDesignerComp();
      api.get('/auth/me').then((r) => setUser(r.data)).catch(() => setUser(null));
    }
  }, [activeTab, fetchActiveDesignerComp]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    api.get('/admin/check').then((r) => {
      setIsAdmin(!!r.data?.is_admin);
      setIsModerator(!!r.data?.is_moderator);
      setIsHdo(!!r.data?.is_help_desk_operator);
    }).catch(() => { setIsAdmin(false); setIsModerator(false); setIsHdo(false); });
  }, []);

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

  const currentCategory = activeTab === 'entertainer' ? 'entertainer' : activeTab === 'crew_oc' ? 'crew_oc' : activeTab === 'designer' ? 'designer' : 'general';
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

  const handleDesignerVote = async (compId, entryId) => {
    setDesignerVotingId(entryId);
    try {
      await api.post(`/forum/designer/competitions/${compId}/vote`, { entry_id: entryId });
      toast.success('Vote recorded! +100 points');
      setMyVoteEntryId(entryId);
      setCanWithdrawVote(false);
      fetchDesignerEntries(compId);
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to vote');
    } finally {
      setDesignerVotingId(null);
    }
  };

  const handleDesignerWithdrawVote = async (compId) => {
    setDesignerWithdrawingId(compId);
    try {
      await api.post(`/forum/designer/competitions/${compId}/withdraw-vote`);
      toast.success('Vote withdrawn (-100 pts). You can vote again for 100 pts.');
      setMyVoteEntryId(null);
      setCanWithdrawVote(false);
      fetchDesignerEntries(compId);
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to withdraw vote');
    } finally {
      setDesignerWithdrawingId(null);
    }
  };

  const handleCreateDesignerComp = async (e) => {
    e.preventDefault();
    if (!designerCompForm.title.trim()) { toast.error('Title required'); return; }
    setDesignerCompSubmitting(true);
    try {
      await api.post('/forum/designer/competitions', {
        title: designerCompForm.title.trim(),
        description: designerCompForm.description.trim() || undefined,
        start_at: designerCompForm.start_at || new Date().toISOString().slice(0, 19),
        end_at: designerCompForm.end_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19),
        reward_money: parseInt(designerCompForm.reward_money, 10) || 0,
        reward_points: parseInt(designerCompForm.reward_points, 10) || 0,
      });
      toast.success('Competition created (draft)');
      setDesignerCompForm({ title: '', description: '', start_at: '', end_at: '', reward_money: 0, reward_points: 0 });
      fetchDesignerCompsList();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setDesignerCompSubmitting(false);
    }
  };

  const handleStartDesignerComp = async (compId) => {
    setDesignerCompStartingId(compId);
    try {
      await api.post(`/forum/designer/competitions/${compId}/start`);
      toast.success('Competition started; all users notified');
      fetchDesignerCompsList();
      fetchActiveDesignerComp();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setDesignerCompStartingId(null);
    }
  };

  const handleEndDesignerComp = async (compId) => {
    setDesignerCompEndingId(compId);
    try {
      await api.post(`/forum/designer/competitions/${compId}/end`);
      toast.success('Competition ended; winner paid');
      fetchDesignerCompsList();
      fetchActiveDesignerComp();
      setDesignerEntries([]);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setDesignerCompEndingId(null);
    }
  };

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="forum-page">
      <style>{FORUM_STYLES}</style>

      {/* Page header */}
      <div className="relative f-fade-in flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] text-zinc-500 font-heading italic">
            {activeTab === 'general' && 'Discuss OC, crews, trades & more'}
            {activeTab === 'entertainer' && 'Dice games, gbox — auto payout when full'}
            {activeTab === 'designer' && 'Designers: advertise your pictures. Users: request work or discuss.'}
            {activeTab === 'crew_oc' && 'Family Crew OC ads — apply from topic or family profile'}
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
          {activeTab !== 'crew_oc' && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation"
            >
              <Plus size={14} /> New Topic
            </button>
          )}
        </div>
      </div>

      {/* Tabs: General | Entertainer Forum — full width on mobile, scrollable */}
      <div className="w-full sm:w-fit overflow-x-auto overflow-y-hidden -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-thin">
        <div className="flex gap-1 p-1 bg-zinc-800/50 rounded border border-primary/20 w-max sm:w-full min-w-0">
          {FORUM_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setForumPage(1); setSearchParams(tab.id === 'general' ? {} : { tab: tab.id }, { replace: true }); }}
              className={`shrink-0 px-3 py-1.5 text-xs font-heading font-bold uppercase rounded transition-all ${activeTab === tab.id ? 'bg-primary/30 text-primary border border-primary/50' : 'text-mutedForeground hover:text-foreground border border-transparent'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Designer: competition block + entries */}
      {activeTab === 'designer' && (
        <>
          {(isAdmin || isModerator) && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { setDesignerCompManageOpen(true); fetchDesignerCompsList(); }}
                className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/50 text-amber-400 text-xs font-heading font-bold uppercase rounded hover:bg-amber-500/30"
              >
                Manage competitions
              </button>
            </div>
          )}
          {activeDesignerComp ? (
            <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in`}>
              <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🎨 Designer competition</span>
              </div>
              <div className="p-3 space-y-2">
                <h3 className="font-heading font-bold text-foreground">{activeDesignerComp.title}</h3>
                {activeDesignerComp.description && <p className="text-xs text-mutedForeground">{activeDesignerComp.description}</p>}
                <p className="text-[10px] text-mutedForeground">
                  Ends: {activeDesignerComp.end_at ? new Date(activeDesignerComp.end_at).toLocaleString() : '—'}
                  {' · '}
                  Winner: ${(activeDesignerComp.reward_money || 0).toLocaleString()} + {(activeDesignerComp.reward_points || 0).toLocaleString()} pts
                  {activeDesignerComp.reward_bullets ? ` + ${activeDesignerComp.reward_bullets} bullets` : ''}
                </p>
                <p className="text-[10px] text-mutedForeground">
                  Post your picture in the pinned competition topic below (add a reply with your image), then open that topic and click &quot;Submit as my entry&quot; on your post.
                  {activeDesignerComp.competition_topic_id && (
                    <> <Link to={`/forum/topic/${activeDesignerComp.competition_topic_id}`} className="text-primary font-heading font-bold underline">Open competition topic →</Link></>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fetchDesignerEntries(activeDesignerComp.id)}
                    className="px-2 py-1 bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase rounded hover:bg-primary/30"
                  >
                    View entries & vote (voters get 100 pts)
                  </button>
                  {myVoteEntryId && canWithdrawVote && (
                    <button
                      type="button"
                      onClick={() => handleDesignerWithdrawVote(activeDesignerComp.id)}
                      disabled={designerWithdrawingId === activeDesignerComp.id}
                      className="px-2 py-1 bg-amber-500/20 border border-amber-500/50 text-amber-400 text-[10px] font-heading font-bold uppercase rounded hover:bg-amber-500/30 disabled:opacity-50"
                    >
                      {designerWithdrawingId === activeDesignerComp.id ? '...' : 'Withdraw vote (−100 pts)'}
                    </button>
                  )}
                </div>
              </div>
              {designerEntries.length > 0 && (
                <div className="border-t border-primary/20 p-3">
                  <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider mb-2">Entries</p>
                  {designerEntriesLoading ? (
                    <p className="text-xs text-mutedForeground">Loading…</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {designerEntries.map((entry) => (
                        <div key={entry.id} className="rounded border border-primary/20 bg-zinc-800/30 p-2">
                          {entry.gif_url ? (
                            <a href={entry.gif_url} target="_blank" rel="noopener noreferrer" className="block mb-1.5 rounded overflow-hidden bg-zinc-900">
                              <img src={entry.gif_url} alt="" className="w-full h-24 object-contain" />
                            </a>
                          ) : null}
                          {entry.title && entry.title !== 'Entry' && !entry.title.startsWith('[') && !entry.title.startsWith('http') ? (
                            <p className="text-[10px] font-heading font-bold truncate" title={entry.title}>{entry.title}</p>
                          ) : (
                            <p className="text-[10px] font-heading font-bold text-mutedForeground">Entry</p>
                          )}
                          <p className="text-[10px] text-mutedForeground">by <Link to={`/profile/${encodeURIComponent(entry.author_username)}`} className="text-primary hover:underline">{entry.author_username}</Link></p>
                          <p className="text-[10px] text-mutedForeground">{entry.vote_count} vote(s)</p>
                          <div className="flex gap-1 mt-1.5">
                            <Link to={`/forum/topic/${entry.topic_id || activeDesignerComp?.competition_topic_id || ''}`} className="text-[10px] text-primary hover:underline">View topic</Link>
                            {activeDesignerComp && (
                              myVoteEntryId === entry.id ? (
                                <span className="text-[10px] text-emerald-400 font-heading font-bold">Voted</span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!!myVoteEntryId || designerVotingId === entry.id}
                                  onClick={() => handleDesignerVote(activeDesignerComp.id, entry.id)}
                                  className="text-[10px] font-heading font-bold text-primary hover:underline disabled:opacity-50"
                                >
                                  {designerVotingId === entry.id ? '...' : 'Vote (+100 pts)'}
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="f-art-line text-primary mx-3" />
            </div>
          ) : (
            <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in`}>
              <div className="p-4 text-center text-xs text-mutedForeground">
                No active designer competition. When one is running, a pinned topic will appear here — post your picture there and submit that post as your entry. Voters get 100 points.
              </div>
            </div>
          )}
        </>
      )}

      {/* Entertainer: Auto games (dice / gbox) */}
      {activeTab === 'entertainer' && (
        <>
          {/* Admin tools */}
          {isAdmin && (
            <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-amber-500/30 f-fade-in`}>
              <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
              <div className="px-3 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
                <span className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-[0.15em]">🛠️ E-Games Admin</span>
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
                  <span className="text-xs font-heading">Auto-create 3–5 games every 3 hours</span>
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
                {entertainerConfig.next_auto_create_at && (
                  <span className="text-[10px] text-mutedForeground">
                    Next games due in: {formatTimeUntil(getSecondsUntilNextBatch(entertainerConfig.next_auto_create_at))}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* What you can win */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-card f-fade-in`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🎁 What you can win</span>
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
            <div className="f-art-line text-primary mx-3" />
          </div>

          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between flex-wrap gap-1">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🎲 Auto games</span>
              <span className="text-[10px] text-mutedForeground">Free to join · Win random: points, cash, bullets, cars · Rolls when full or 20 mins before next batch</span>
            </div>
            {gamesLoading ? (
              <div className="p-4 text-center text-xs text-mutedForeground">Loading games...</div>
            ) : openGames.length === 0 ? (
              <div className="p-4 text-center text-xs text-mutedForeground">No open games. Create one above{entertainerConfig.auto_create_enabled ? ' or wait for the next batch (every 3h)' : ''}.</div>
            ) : (
              <div className="divide-y divide-zinc-700/30">
                {openGames.map((g) => {
                  const participants = g.participants || [];
                  const isIn = user && participants.some((p) => p.user_id === user.id);
                  const secsLeft = getSecondsUntilRollWindow(entertainerConfig.next_auto_create_at);
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
                            <span className="text-[10px] text-amber-400/90 ml-2">Rolls in {formatTimeUntil(secsLeft)}</span>
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
            <div className="f-art-line text-primary mx-3" />
          </div>

          {/* Last 10 Games */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">📜 Last 10 games</span>
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
                      <tr key={h.id} className="border-b border-zinc-700/20 f-row">
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
            <div className="f-art-line text-primary mx-3" />
          </div>
        </>
      )}

      {/* Stats */}
      <div className="flex items-center justify-between gap-4 text-xs text-mutedForeground">
        <div className="flex items-center gap-4">
          <span>{topics.length} topics</span>
          <span>{pinnedTopics.length} pinned</span>
        </div>
        {canViewPage2 && (
          <div className="hidden sm:flex gap-1">
            <button type="button" onClick={() => setForumPage(1)} className={`px-2 py-1 rounded text-[10px] font-heading font-bold ${forumPage === 1 ? 'bg-primary/30 text-primary' : 'text-mutedForeground hover:text-foreground'}`}>Page 1</button>
            <button type="button" onClick={() => setForumPage(2)} className={`px-2 py-1 rounded text-[10px] font-heading font-bold ${forumPage === 2 ? 'bg-primary/30 text-primary' : 'text-mutedForeground hover:text-foreground'}`}>Page 2</button>
          </div>
        )}
      </div>

      {/* Topics List */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        {/* Desktop Header */}
        <div className={`hidden sm:grid grid-cols-12 gap-2 px-3 py-2.5 bg-primary/8 border-b border-primary/20 text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]`}>
          <div className={isAdmin ? 'col-span-6' : 'col-span-7'}>Topic</div>
          <div className="col-span-2 text-right">Author</div>
          <div className="col-span-1 text-right">Posts</div>
          <div className="col-span-2 text-right">Views</div>
          {isAdmin && <div className="col-span-1 text-right">Admin</div>}
        </div>

        {/* Mobile Header */}
        <div className="sm:hidden px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">📋 Topics</span>
          {canViewPage2 && (
            <div className="flex gap-1">
              <button type="button" onClick={() => setForumPage(1)} className={`px-2 py-1 rounded text-[10px] font-heading font-bold ${forumPage === 1 ? 'bg-primary/30 text-primary' : 'text-mutedForeground hover:text-foreground'}`}>Page 1</button>
              <button type="button" onClick={() => setForumPage(2)} className={`px-2 py-1 rounded text-[10px] font-heading font-bold ${forumPage === 2 ? 'bg-primary/30 text-primary' : 'text-mutedForeground hover:text-foreground'}`}>Page 2</button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-6 flex flex-col items-center justify-center gap-3">
            <MessageSquare size={28} className="text-primary/40 animate-pulse" />
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading...</span>
          </div>
        ) : topics.length === 0 ? (
          <div className="p-6 text-center text-xs text-mutedForeground">No topics yet. Create one!</div>
        ) : (
          <div className="space-y-1.5 px-1 sm:px-0">
            {/* Pinned topics first */}
            {pinnedTopics.length > 0 && (
              <>
                {pinnedTopics.map((t) => (
                  <div
                    key={t.id}
                    className={`${styles.panel} rounded-md overflow-hidden border border-zinc-800/60 bg-zinc-900/70`}
                  >
                    <TopicRowDesktop
                      topic={t}
                      canStickyImportant={isAdmin || isModerator}
                      canLock={isAdmin || isModerator || isHdo}
                      onUpdate={updateTopicFlags}
                      updating={updatingId === t.id}
                      designerCompId={null}
                      myEntryTopicIds={[]}
                      meUsername={user?.username}
                      onSubmitToComp={() => {}}
                      submittingTopicId={null}
                    />
                    <TopicRowMobile
                      topic={t}
                      canStickyImportant={isAdmin || isModerator}
                      canLock={isAdmin || isModerator || isHdo}
                      onUpdate={updateTopicFlags}
                      updating={updatingId === t.id}
                      designerCompId={null}
                      myEntryTopicIds={[]}
                      meUsername={user?.username}
                      onSubmitToComp={() => {}}
                      submittingTopicId={null}
                    />
                  </div>
                ))}
                {regularTopics.length > 0 && (
                  <div className="px-3 py-1 bg-zinc-800/30 text-[10px] text-mutedForeground">Regular topics</div>
                )}
              </>
            )}
            
            {/* Regular topics */}
            {regularTopics.map((t) => (
              <div
                key={t.id}
                className={`${styles.panel} rounded-md overflow-hidden border border-zinc-800/60 bg-zinc-900/70`}
              >
                <TopicRowDesktop
                  topic={t}
                  canStickyImportant={isAdmin || isModerator}
                  canLock={isAdmin || isModerator || isHdo}
                  onUpdate={updateTopicFlags}
                  updating={updatingId === t.id}
                  designerCompId={null}
                  myEntryTopicIds={[]}
                  meUsername={user?.username}
                  onSubmitToComp={() => {}}
                  submittingTopicId={null}
                />
                <TopicRowMobile
                  topic={t}
                  canStickyImportant={isAdmin || isModerator}
                  canLock={isAdmin || isModerator || isHdo}
                  onUpdate={updateTopicFlags}
                  updating={updatingId === t.id}
                  designerCompId={null}
                  myEntryTopicIds={[]}
                  meUsername={user?.username}
                  onSubmitToComp={() => {}}
                  submittingTopicId={null}
                />
              </div>
            ))}
          </div>
        )}
        <div className="f-art-line text-primary mx-3" />
      </div>

      {/* Rules */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in`} style={{ animationDelay: '0.05s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">ℹ️ Rules</span>
        </div>
        <div className="p-3">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Be respectful to other players</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>No real-world threats or harassment</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Keep trades in the marketplace</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>No spam or excessive posting</li>
          </ul>
        </div>
        <div className="f-art-line text-primary mx-3" />
      </div>

      <CreateTopicModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onCreated={fetchTopics} category={currentCategory} />
      <CreateGameModal isOpen={gameModalOpen} onClose={() => setGameModalOpen(false)} onCreated={() => { fetchEntertainerGames(); window.dispatchEvent(new CustomEvent('app:refresh-user')); }} me={user} />

      {/* Manage designer competitions modal (admin/mod) */}
      {designerCompManageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className={`${styles.panel} w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-amber-500/30 shadow-2xl`}>
            <div className="px-3 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
              <span className="text-[10px] font-heading font-bold text-amber-500 uppercase tracking-[0.15em]">Manage designer competitions</span>
              <button type="button" onClick={() => setDesignerCompManageOpen(false)} className="text-amber-500 hover:text-amber-400 text-lg leading-none">×</button>
            </div>
            <div className="p-3 space-y-4">
              <form onSubmit={handleCreateDesignerComp} className="space-y-2 border-b border-primary/20 pb-3">
                <h4 className="text-xs font-heading font-bold text-foreground">Create new (draft)</h4>
                <input type="text" placeholder="Title" value={designerCompForm.title} onChange={(e) => setDesignerCompForm((f) => ({ ...f, title: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-primary/30 bg-zinc-800/50 text-foreground text-xs" />
                <input type="text" placeholder="Description (optional)" value={designerCompForm.description} onChange={(e) => setDesignerCompForm((f) => ({ ...f, description: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-primary/30 bg-zinc-800/50 text-foreground text-xs" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="datetime-local" placeholder="Start" value={designerCompForm.start_at} onChange={(e) => setDesignerCompForm((f) => ({ ...f, start_at: e.target.value }))} className="px-2 py-1.5 rounded border border-primary/30 bg-zinc-800/50 text-foreground text-xs" />
                  <input type="datetime-local" placeholder="End" value={designerCompForm.end_at} onChange={(e) => setDesignerCompForm((f) => ({ ...f, end_at: e.target.value }))} className="px-2 py-1.5 rounded border border-primary/30 bg-zinc-800/50 text-foreground text-xs" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" min="0" placeholder="Reward $" value={designerCompForm.reward_money || ''} onChange={(e) => setDesignerCompForm((f) => ({ ...f, reward_money: e.target.value }))} className="px-2 py-1.5 rounded border border-primary/30 bg-zinc-800/50 text-foreground text-xs" />
                  <input type="number" min="0" placeholder="Reward points" value={designerCompForm.reward_points || ''} onChange={(e) => setDesignerCompForm((f) => ({ ...f, reward_points: e.target.value }))} className="px-2 py-1.5 rounded border border-primary/30 bg-zinc-800/50 text-foreground text-xs" />
                </div>
                <button type="submit" disabled={designerCompSubmitting} className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/50 text-amber-400 text-[10px] font-heading font-bold uppercase rounded hover:bg-amber-500/30 disabled:opacity-50">{designerCompSubmitting ? '...' : 'Create draft'}</button>
              </form>
              <div>
                <h4 className="text-xs font-heading font-bold text-foreground mb-2">Competitions</h4>
                {designerCompsList.length === 0 ? (
                  <p className="text-xs text-mutedForeground">None yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {designerCompsList.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-primary/20 p-2 text-xs">
                        <span className="font-heading font-bold">{c.title}</span>
                        <span className={`px-1.5 py-0.5 rounded font-heading ${c.status === 'draft' ? 'bg-zinc-600' : c.status === 'active' ? 'bg-emerald-600/30 text-emerald-400' : 'bg-zinc-700 text-mutedForeground'}`}>{c.status}</span>
                        <span className="text-mutedForeground">{c.entry_count} entries, {c.vote_count} votes</span>
                        {c.status === 'draft' && (
                          <button type="button" onClick={() => handleStartDesignerComp(c.id)} disabled={!!designerCompStartingId} className="px-2 py-1 bg-emerald-600/20 border border-emerald-500/50 text-emerald-400 text-[10px] font-heading font-bold rounded hover:bg-emerald-600/30 disabled:opacity-50">{designerCompStartingId === c.id ? '...' : 'Start (notify all)'}</button>
                        )}
                        {c.status === 'active' && (
                          <button type="button" onClick={() => handleEndDesignerComp(c.id)} disabled={!!designerCompEndingId} className="px-2 py-1 bg-red-600/20 border border-red-500/50 text-red-400 text-[10px] font-heading font-bold rounded hover:bg-red-600/30 disabled:opacity-50">{designerCompEndingId === c.id ? '...' : 'End & pay winner'}</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
