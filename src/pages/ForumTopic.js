import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Lock, ThumbsUp, Send, Pin, AlertCircle, Trash2, ArrowLeft, MessageCircle, Eye, Clock, Dice5, Package, UserPlus, Bold, Italic, Image, Palette } from 'lucide-react';
import api from '../utils/api';
import GifPicker from '../components/GifPicker';
import { toast } from 'sonner';
import { parseForumContent, insertAtCursor } from '../utils/forumContent';
import styles from '../styles/noir.module.css';

const EMOJI_STRIP = ['😀', '😂', '👍', '❤️', '🔥', '😎', '👋', '🎉', '💀', '😢', '💰', '💎', '🔫', '👑', '🏆', '✨'];

/** FAQ / HTML topic content: dark gray dropdowns with coloured text. */
const FORUM_FAQ_STYLES = `
  .forum-faq-content { background: #2d2d2d; color: #b8c4d0; padding: 1.2em; border-radius: 8px; max-width: 100%; }
  .forum-faq-content details { margin: 0.6em 0; border: 1px solid #444; border-radius: 6px; overflow: hidden; }
  .forum-faq-content summary { background: #3a3a3a; color: #e8d4a8; padding: 0.6em 1em; cursor: pointer; font-weight: bold; list-style: none; }
  .forum-faq-content summary::-webkit-details-marker { display: none; }
  .forum-faq-content summary:hover { background: #454545; color: #f0e0b0; }
  .forum-faq-content details[open] summary { border-bottom: 1px solid #444; }
  .forum-faq-content details > div { padding: 1em 1.2em; background: #252525; color: #b8c4d0; line-height: 1.5; }
  .forum-faq-content strong { color: #d4a574; }
  .forum-faq-content p { margin: 0.5em 0; color: #b8c4d0; }
  .forum-faq-content ul, .forum-faq-content ol { margin: 0.5em 0; padding-left: 1.5em; color: #b8c4d0; }
  .forum-faq-content li { color: #c0ccd8; }
  .forum-faq-content table { border-collapse: collapse; width: 100%; margin-top: 0.5em; }
  .forum-faq-content th, .forum-faq-content td { border: 1px solid #444; padding: 0.5em 0.75em; text-align: left; color: #b8c4d0; }
  .forum-faq-content th { background: #353535; color: #e8d4a8; }
  .forum-faq-content tr:nth-child(even) { background: #2a2a2a; }
`;
const FORUM_CONTENT_STYLES = `
  .forum-content-media { max-width: 100%; height: auto; border-radius: 8px; margin: 0.25em 0; display: block; }
  .forum-content-gif { max-height: 280px; object-fit: contain; }
  .forum-content strong { font-weight: 700; }
  .forum-content em { font-style: italic; }
`;

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
  const [showEmojis, setShowEmojis] = useState(false);
  const [createGameType, setCreateGameType] = useState('dice');
  const [createGameMaxPlayers, setCreateGameMaxPlayers] = useState(10);
  const [createGameManualRoll, setCreateGameManualRoll] = useState(true);
  const [createGamePot, setCreateGamePot] = useState(0);
  const [createGameJoinFee, setCreateGameJoinFee] = useState(0);
  const [createGameSubmitting, setCreateGameSubmitting] = useState(false);
  const [crewOCApplyLoading, setCrewOCApplyLoading] = useState(false);
  const commentTextareaRef = useRef(null);

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

  useEffect(() => { fetchTopic(); }, [fetchTopic]);
  useEffect(() => { api.get('/admin/check').then((r) => setIsAdmin(!!r.data?.is_admin)).catch(() => setIsAdmin(false)); }, []);

  const updateTopicFlags = async (payload) => {
    setAdminBusy(true);
    try {
      await api.patch(`/forum/topics/${topicId}`, payload);
      toast.success('Updated');
      fetchTopic();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setAdminBusy(false);
    }
  };

  const deleteTopic = async () => {
    if (!window.confirm('Delete this topic and all comments?')) return;
    setAdminBusy(true);
    try {
      await api.delete(`/forum/topics/${topicId}`);
      toast.success('Deleted');
      navigate('/forum');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setAdminBusy(false);
    }
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (topic?.is_locked) { toast.error('Topic is locked'); return; }
    const text = commentText.trim();
    if (!text) { toast.error('Enter a comment'); return; }
    setPosting(true);
    try {
      await api.post(`/forum/topics/${topicId}/comments`, { content: text });
      setCommentText('');
      toast.success('Posted');
      fetchTopic();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
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
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setPosting(false);
    }
  };

  const createGameInTopic = async (e) => {
    e.preventDefault();
    if (topic?.is_locked) return;
    setCreateGameSubmitting(true);
    try {
      await api.post('/forum/entertainer/games', {
        game_type: createGameType,
        max_players: Math.max(1, Math.min(10, parseInt(createGameMaxPlayers, 10) || 10)),
        join_fee: Math.max(0, parseInt(createGameJoinFee, 10) || 0),
        pot: Math.max(0, parseInt(createGamePot, 10) || 0),
        manual_roll: createGameManualRoll,
        topic_id: topicId || undefined,
      });
      toast.success(createGameManualRoll ? 'Game created — roll it when ready from the Entertainer Forum.' : 'Game created');
      navigate('/forum', { state: { category: 'entertainer' } });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create game');
    } finally {
      setCreateGameSubmitting(false);
    }
  };

  const applyCrewOC = async () => {
    if (!topic?.crew_oc_family_id) return;
    setCrewOCApplyLoading(true);
    try {
      const res = await api.post('/families/crew-oc/apply', { family_id: topic.crew_oc_family_id });
      toast.success(res.data?.message || 'Applied.');
      fetchTopic();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to apply');
    } finally {
      setCrewOCApplyLoading(false);
    }
  };

  const insertCommentMarkup = (before, after = '') => {
    const ta = commentTextareaRef.current;
    if (!ta) {
      setCommentText((c) => c + before + after);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const { value, cursor } = insertAtCursor(commentText, before, after, start, end);
    setCommentText(value);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    }, 0);
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
      toast.error('Failed');
    } finally {
      setLikingId(null);
    }
  };

  if (loading && !topic) {
    return (
      <div className={`${styles.pageContent} flex items-center justify-center min-h-[40vh]`}>
        <div className="text-primary font-heading text-sm">Loading...</div>
      </div>
    );
  }
  if (!topic) return null;

  const commentCount = comments.length;
  const isFaqHtml = topic.content && (topic.content.includes('<details') || topic.content.includes('class="faq-box"') || topic.content.includes('class=\'faq-box\''));
  // Convert Markdown **bold** to <strong> so FAQ content renders correctly (forum stores HTML + some markdown)
  const topicContentRaw = topic.content || '—';
  const topicContent = isFaqHtml
    ? topicContentRaw.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    : topicContentRaw;

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="forum-topic-page">
      <style>{FORUM_CONTENT_STYLES}</style>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/forum" className="text-mutedForeground hover:text-primary transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              {topic.is_important && <AlertCircle size={14} className="text-amber-400" />}
              {topic.is_sticky && !topic.is_important && <Pin size={14} className="text-amber-400" />}
              <h1 className="text-lg sm:text-xl font-heading font-bold text-primary">
                {topic.title}
              </h1>
              {topic.is_locked && <Lock size={14} className="text-red-400" />}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-mutedForeground">
              <span className="text-foreground font-bold">{topic.author_username}</span>
              <span className="flex items-center gap-0.5"><Clock size={10} /> {getTimeAgo(topic.created_at)}</span>
              <span className="flex items-center gap-0.5"><Eye size={10} /> {topic.views ?? 0}</span>
              <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {commentCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Controls */}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-amber-400 font-heading uppercase mr-1">Admin:</span>
          <button
            onClick={() => updateTopicFlags({ is_sticky: !topic.is_sticky })}
            disabled={adminBusy}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading border transition-all ${
              topic.is_sticky ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-zinc-800/50 border-zinc-700/50 text-mutedForeground hover:border-amber-500/50'
            }`}
          >
            <Pin size={10} /> {topic.is_sticky ? 'Unsticky' : 'Sticky'}
          </button>
          <button
            onClick={() => updateTopicFlags({ is_important: !topic.is_important })}
            disabled={adminBusy}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading border transition-all ${
              topic.is_important ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-zinc-800/50 border-zinc-700/50 text-mutedForeground hover:border-amber-500/50'
            }`}
          >
            <AlertCircle size={10} /> {topic.is_important ? 'Unmark' : 'Important'}
          </button>
          <button
            onClick={() => updateTopicFlags({ is_locked: !topic.is_locked })}
            disabled={adminBusy}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading border transition-all ${
              topic.is_locked ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-zinc-800/50 border-zinc-700/50 text-mutedForeground hover:border-red-500/50'
            }`}
          >
            <Lock size={10} /> {topic.is_locked ? 'Unlock' : 'Lock'}
          </button>
          <button
            onClick={deleteTopic}
            disabled={adminBusy}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading border border-red-500/50 text-red-400 hover:bg-red-500/20 transition-all"
          >
            <Trash2 size={10} /> Delete
          </button>
        </div>
      )}

      {/* Topic Content */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">📝 Original Post</span>
        </div>
        <div className="p-3">
          {topic.gif_url && (
            <div className="mb-3">
              <img src={topic.gif_url} alt="GIF" className="rounded max-h-64 object-contain forum-content-gif" loading="lazy" />
            </div>
          )}
          {isFaqHtml ? (
            <>
              <style>{FORUM_FAQ_STYLES}</style>
              <div
                className="forum-faq-content text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: topicContent }}
              />
            </>
          ) : (
            <div
              className="forum-content text-sm text-foreground leading-relaxed break-words"
              dangerouslySetInnerHTML={{ __html: parseForumContent(topicContent) }}
            />
          )}
        </div>
      </div>

      {/* Crew OC: Apply to join */}
      {topic.crew_oc_family_id && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center gap-2">
            <UserPlus size={14} className="text-primary" />
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Apply to Crew OC</span>
          </div>
          <div className="p-3">
            <p className="text-xs text-mutedForeground mb-2">
              Join {topic.crew_oc_family_name} [{topic.crew_oc_family_tag}] for their next Crew OC run.
              {topic.crew_oc_join_fee > 0
                ? ` Pay ${(topic.crew_oc_join_fee || 0).toLocaleString()} cash to join instantly.`
                : ' Free — your application will need approval.'}
            </p>
            {topic.crew_oc_my_application ? (
              <p className="text-xs font-heading font-bold text-primary">
                You applied: {topic.crew_oc_my_application.status}
              </p>
            ) : (
              <button
                type="button"
                onClick={applyCrewOC}
                disabled={crewOCApplyLoading}
                className="w-full py-2 font-heading font-bold uppercase tracking-wider text-xs rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
              >
                {crewOCApplyLoading ? '...' : topic.crew_oc_join_fee > 0 ? `Apply — pay $${(topic.crew_oc_join_fee || 0).toLocaleString()}` : 'Apply (free)'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Entertainer: Create dice / gbox game (manual roll when ready) */}
      {topic.category === 'entertainer' && !topic.is_locked && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🎲 Create Game</span>
          </div>
          <div className="p-3">
            <p className="text-xs text-mutedForeground mb-3">Start a dice or gbox game linked to this topic. Use manual roll to roll it yourself when everyone has joined.</p>
            <form onSubmit={createGameInTopic} className="space-y-3">
              <div>
                <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Type</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCreateGameType('dice')} className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded border text-xs font-heading ${createGameType === 'dice' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-600/50 text-mutedForeground'}`}>
                    <Dice5 size={14} /> Dice
                  </button>
                  <button type="button" onClick={() => setCreateGameType('gbox')} className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded border text-xs font-heading ${createGameType === 'gbox' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-600/50 text-mutedForeground'}`}>
                    <Package size={14} /> Gbox
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Max players (1–10)</label>
                <input type="number" min={1} max={10} value={createGameMaxPlayers} onChange={(e) => setCreateGameMaxPlayers(e.target.value)} className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground" />
              </div>
              <div>
                <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Pot ($ you put in)</label>
                <input type="number" min={0} value={createGamePot} onChange={(e) => setCreateGamePot(e.target.value)} placeholder="0" className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground" />
              </div>
              <div>
                <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Entry fee ($ per player to join)</label>
                <input type="number" min={0} value={createGameJoinFee} onChange={(e) => setCreateGameJoinFee(e.target.value)} placeholder="0" className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={createGameManualRoll} onChange={(e) => setCreateGameManualRoll(e.target.checked)} className="w-4 h-4 accent-primary" />
                <span className="text-xs font-heading text-foreground">Manual roll — I&apos;ll roll when ready (no auto-roll)</span>
              </label>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={createGameSubmitting} className="px-4 py-2 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50">
                  {createGameSubmitting ? '...' : 'Create game'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Comments */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">💬 Comments</span>
          <span className="text-[10px] text-mutedForeground">{commentCount} {commentCount === 1 ? 'reply' : 'replies'}</span>
        </div>
        
        {comments.length === 0 ? (
          <div className="p-4 text-center text-xs text-mutedForeground">No comments yet. Be the first!</div>
        ) : (
          <div className="divide-y divide-zinc-700/30">
            {comments.map((c, idx) => (
              <div key={c.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[10px] text-mutedForeground">
                    <span className="text-foreground font-bold">{c.author_username}</span>
                    <span>·</span>
                    <span>{getTimeAgo(c.created_at)}</span>
                    <span className="text-zinc-600">#{idx + 1}</span>
                  </div>
                  {c.likes > 0 && (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                      <ThumbsUp size={10} /> {c.likes}
                    </span>
                  )}
                </div>
                
                {/* GIF (legacy gif_url) */}
                {c.gif_url && (
                  <div className="mt-2">
                    <img src={c.gif_url} alt="GIF" className="rounded max-h-40 object-contain forum-content-gif" loading="lazy" />
                  </div>
                )}
                
                {/* Text content (supports [b], [i], [color], [img], [gif], smileys) */}
                {c.content && c.content !== '(GIF)' && (
                  <div
                    className="mt-2 text-xs text-foreground forum-content break-words"
                    dangerouslySetInnerHTML={{ __html: parseForumContent(c.content) }}
                  />
                )}
                
                {/* Like button */}
                <div className="mt-2">
                  <button
                    onClick={() => likeComment(c.id)}
                    disabled={likingId === c.id}
                    className={`flex items-center gap-1 text-[10px] font-heading px-2 py-1 rounded transition-all ${
                      c.liked 
                        ? 'bg-primary/20 text-primary' 
                        : 'text-mutedForeground hover:text-primary hover:bg-primary/10'
                    }`}
                  >
                    <ThumbsUp size={10} /> {c.liked ? 'Liked' : 'Like'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Comment */}
      {topic.is_locked ? (
        <div className="px-3 py-3 bg-zinc-800/30 border border-zinc-700/30 rounded-md text-center">
          <p className="text-xs text-mutedForeground flex items-center justify-center gap-1.5">
            <Lock size={12} /> This topic is locked
          </p>
        </div>
      ) : (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">✍️ Add Comment</span>
          </div>
          <div className="p-3 space-y-3">
            {showGifPicker && (
              <div className="mb-2">
                <GifPicker onSelect={handleSendGif} onClose={() => setShowGifPicker(false)} />
              </div>
            )}
            
            <form onSubmit={postComment} className="space-y-2">
              <textarea
                ref={commentTextareaRef}
                id="forum-add-comment"
                placeholder="Write a comment... Use [b]bold[/b], [i]italic[/i], [color=red]coloured[/color], [img]url[/img], [gif]url[/gif], or :) smileys"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y"
              />
              
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => insertCommentMarkup('[b]', '[/b]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Bold"><Bold size={14} /></button>
                <button type="button" onClick={() => insertCommentMarkup('[i]', '[/i]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Italic"><Italic size={14} /></button>
                <button type="button" onClick={() => insertCommentMarkup('[color=#eab308]', '[/color]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Colour"><Palette size={14} /></button>
                <button
                  type="button"
                  onClick={() => {
                    const url = window.prompt('Image URL (must start with http:// or https://):');
                    if (url && url.trim()) insertCommentMarkup('[img]' + url.trim() + '[/img]');
                  }}
                  className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10"
                  title="Image"
                >
                  <Image size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowGifPicker((v) => !v)}
                  className="px-2 py-1 rounded border border-primary/30 text-primary text-[10px] font-heading hover:bg-primary/10 transition-all"
                >
                  GIF
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmojis(!showEmojis)}
                  className="px-2 py-1 rounded border border-zinc-700/50 text-mutedForeground text-[10px] font-heading hover:text-foreground transition-all"
                >
                  😀 Emoji
                </button>
                
                <div className="flex-1" />
                
                <button
                  type="submit"
                  disabled={posting}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all touch-manipulation"
                >
                  <Send size={12} /> {posting ? '...' : 'Post'}
                </button>
              </div>
              
              {/* Emoji picker */}
              {showEmojis && (
                <div className="flex flex-wrap gap-1 pt-2 border-t border-zinc-700/30">
                  {EMOJI_STRIP.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setCommentText((c) => c + em)}
                      className="text-lg hover:scale-110 transition-transform p-0.5"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
