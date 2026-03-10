import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Lock, ThumbsUp, Send, Pin, AlertCircle, Trash2, ArrowLeft,
  MessageCircle, Eye, Clock, Dice5, Package, UserPlus,
  Bold, Italic, Image, Palette, Pencil, X,
} from 'lucide-react';
import api from '../utils/api';
import GifPicker from '../components/GifPicker';
import { toast } from 'sonner';
import { parseForumContent, insertAtCursor } from '../utils/forumContent';
import { FormattedNumberInput } from '../components/FormattedNumberInput';
import styles from '../styles/noir.module.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const EMOJI_STRIP = [
  '😀','😂','👍','❤️','🔥','😎','👋','🎉',
  '💀','😢','💰','💎','🔫','👑','🏆','✨',
];

const BACK_LINKS = {
  designer:    '/forum?tab=designer',
  entertainer: '/forum?tab=entertainer',
  crew_oc:     '/forum?tab=crew_oc',
};

// ─── Injected styles (scoped, no hardcoded colours) ──────────────────────────

const PAGE_STYLES = `
  /* Forum content rendering */
  .fc-media { max-width: 100%; height: auto; border-radius: 8px; margin: 0.25em 0; display: block; }
  .fc-gif   { max-height: 280px; object-fit: contain; }
  .fc strong { font-weight: 700; }
  .fc em     { font-style: italic; }

  /* FAQ / rich-html topics */
  .faq-wrap { max-width: 100%; }
  .faq-wrap .faq-outer { background: var(--noir-surface); color: var(--noir-foreground); padding: 0.75em 1em; border-radius: 6px; border: 1px solid var(--noir-border-mid); }
  .faq-wrap details { margin: 0.25em 0; border: 1px solid var(--noir-border-light); border-radius: 4px; overflow: hidden; }
  .faq-wrap summary { background: rgba(var(--noir-primary-rgb),.08); color: var(--noir-primary); padding: .35em .75em; cursor: pointer; font-weight: bold; list-style: none; font-size: .95em; }
  .faq-wrap summary::-webkit-details-marker { display: none; }
  .faq-wrap summary:hover { background: rgba(var(--noir-primary-rgb),.12); }
  .faq-wrap details[open] summary { border-bottom: 1px solid var(--noir-border-light); }
  .faq-wrap details > div { padding: .6em .9em; background: var(--noir-content); color: var(--noir-foreground); line-height: 1.45; }
  .faq-wrap strong { color: var(--noir-primary); }
  .faq-wrap p  { margin: .35em 0; color: var(--noir-foreground); }
  .faq-wrap ul, .faq-wrap ol { margin: .35em 0; padding-left: 1.25em; color: var(--noir-foreground); }
  .faq-wrap li { color: var(--noir-foreground); margin: .15em 0; }
  .faq-wrap table { border-collapse: collapse; width: 100%; margin-top: .35em; border-radius: 4px; overflow: hidden; }
  .faq-wrap th, .faq-wrap td { border: 1px solid var(--noir-border-light); padding: .35em .6em; text-align: left; color: var(--noir-foreground); font-size: .95em; }
  .faq-wrap th { background: rgba(var(--noir-primary-rgb),.08); color: var(--noir-primary); }
  .faq-wrap tr:nth-child(even) { background: var(--noir-surface); }

  /* Comment card */
  .comment-card { transition: background 0.15s; scroll-margin-top: 72px; }
  .comment-card:hover { background: rgba(var(--noir-primary-rgb), 0.03); }

  /* Reply quote left border */
  .reply-quote { border-left: 2px solid rgba(var(--noir-primary-rgb),.30); }

  /* Staff bar */
  .staff-bar { border: 1px solid rgba(212,166,80,.18); background: rgba(212,166,80,.04); }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s <    60) return 'Just now';
  if (s <  3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function detectFaq(content = '') {
  return (
    content.includes('<details') ||
    content.includes('class="faq-box"') ||
    content.includes("class='faq-box'")
  );
}

function prepareFaqContent(raw = '') {
  return raw
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/<style>[\s\S]*?<\/style>/gi, '')
    .replace(/<div\s+style="[^"]*"[^>]*>/, '<div class="faq-outer">');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Staff action pill */
function StaffPill({ icon: Icon, label, active, variant = 'amber', onClick, disabled }) {
  const colours = {
    amber: active
      ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
      : 'border-zinc-700/50 text-zinc-500 hover:border-amber-500/40 hover:text-amber-400',
    red: active
      ? 'bg-red-500/20 border-red-500/50 text-red-400'
      : 'border-zinc-700/50 text-zinc-500 hover:border-red-500/40 hover:text-red-400',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading border transition-all disabled:opacity-40 ${colours[variant]}`}
    >
      <Icon size={10} /> {label}
    </button>
  );
}

/** Panel section header bar */
function PanelHeader({ children, right }) {
  return (
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/20 flex items-center justify-between gap-2">
      <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">
        {children}
      </span>
      {right && <span className="text-[10px] text-mutedForeground">{right}</span>}
    </div>
  );
}

/** Single comment card */
function CommentCard({
  comment, idx, allComments, user, topicId,
  activeDesignerComp, myEntryCommentId, designerSubmittingId,
  likingId, onLike, onReply, onSubmitDesigner,
}) {
  const isMyComment = user && comment.author_id === user.id;
  const isCompTopic = topicId === activeDesignerComp?.competition_topic_id;
  const parent      = comment.reply_to_comment_id
    ? allComments.find((p) => p.id === comment.reply_to_comment_id)
    : null;
  const parentIdx   = parent ? allComments.findIndex((p) => p.id === parent.id) : -1;

  return (
    <div
      id={`c-${comment.id}`}
      className="comment-card p-3 sm:p-4 border-b border-zinc-800/50 last:border-b-0"
    >
      {/* Author row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Link
            to={`/profile/${encodeURIComponent(comment.author_username)}`}
            className="text-xs font-heading font-bold text-foreground hover:text-primary transition-colors"
          >
            {comment.author_username}
          </Link>
          <span className="text-[9px] text-zinc-600 font-heading">#{idx + 1}</span>
          <span className="flex items-center gap-0.5 text-[9px] text-zinc-500">
            <Clock size={8} /> {timeAgo(comment.created_at)}
          </span>
        </div>
        {comment.likes > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-emerald-400 shrink-0">
            <ThumbsUp size={9} /> {comment.likes}
          </span>
        )}
      </div>

      {/* Reply quote */}
      {parent && (
        <a
          href={`#c-${parent.id}`}
          className="reply-quote flex flex-col gap-0.5 mb-2.5 pl-2.5 py-1.5 rounded-r-md bg-zinc-900/60 hover:bg-zinc-900/90 transition-colors"
        >
          <span className="text-[9px] font-heading text-zinc-500 uppercase tracking-wider">
            ↩ {parent.author_username}
            {parentIdx >= 0 && <span className="text-zinc-600 ml-1">#{parentIdx + 1}</span>}
          </span>
          {parent.content && parent.content !== '(GIF)' && (
            <div
              className="text-[10px] text-zinc-400 fc line-clamp-2 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: parseForumContent(parent.content) }}
            />
          )}
          {!parent.content && parent.gif_url && (
            <span className="text-[9px] text-zinc-600 italic">GIF</span>
          )}
        </a>
      )}

      {/* GIF */}
      {comment.gif_url && (
        <img
          src={comment.gif_url}
          alt="GIF"
          className="rounded max-h-48 sm:max-h-64 object-contain fc-gif mb-2"
          loading="lazy"
        />
      )}

      {/* Text */}
      {comment.content && comment.content !== '(GIF)' && (
        <div
          className="text-xs text-foreground fc break-words leading-relaxed"
          dangerouslySetInnerHTML={{ __html: parseForumContent(comment.content) }}
        />
      )}

      {/* Actions */}
      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => onLike(comment.id)}
          disabled={likingId === comment.id}
          className={`flex items-center gap-1 text-[10px] font-heading px-2 py-1 rounded border transition-all disabled:opacity-40 ${
            comment.liked
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'border-zinc-700/40 text-zinc-500 hover:text-primary hover:border-primary/30 hover:bg-primary/8'
          }`}
        >
          <ThumbsUp size={9} /> {comment.liked ? 'Liked' : 'Like'}
        </button>

        <button
          onClick={() => onReply(comment)}
          className="flex items-center gap-1 text-[10px] font-heading px-2 py-1 rounded border border-zinc-700/40 text-zinc-500 hover:text-primary hover:border-primary/30 hover:bg-primary/8 transition-all"
        >
          <MessageCircle size={9} /> Reply
        </button>

        {/* Designer comp submission */}
        {isCompTopic && isMyComment && activeDesignerComp && (
          myEntryCommentId === comment.id ? (
            <span className="text-[10px] font-heading font-bold text-emerald-400 px-2 py-1">
              ✓ Entered
            </span>
          ) : !myEntryCommentId ? (
            <button
              onClick={() => onSubmitDesigner(comment.id)}
              disabled={!!designerSubmittingId}
              className="flex items-center gap-1 text-[10px] font-heading px-2 py-1 rounded bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 disabled:opacity-50 transition-all"
            >
              {designerSubmittingId === comment.id ? '…' : 'Submit as entry'}
            </button>
          ) : null
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ForumTopic() {
  const { topicId } = useParams();
  const navigate    = useNavigate();

  // Core
  const [topic,    setTopic]    = useState(null);
  const [comments, setComments] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [user,     setUser]     = useState(null);

  // Auth / staff
  const [isAdmin,     setIsAdmin]     = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [isHdo,       setIsHdo]       = useState(false);
  const [adminBusy,   setAdminBusy]   = useState(false);

  // Composer
  const [commentText,   setCommentText]   = useState('');
  const [posting,       setPosting]       = useState(false);
  const [replyTo,       setReplyTo]       = useState(null); // { id, author_username }
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojis,    setShowEmojis]    = useState(false);
  const commentRef = useRef(null);

  // Likes
  const [likingId, setLikingId] = useState(null);

  // Edit topic modal
  const [showEdit,    setShowEdit]    = useState(false);
  const [editTitle,   setEditTitle]   = useState('');
  const [editContent, setEditContent] = useState('');
  const [editGifUrl,  setEditGifUrl]  = useState('');
  const [editGifOpen, setEditGifOpen] = useState(false);
  const [editBusy,    setEditBusy]    = useState(false);

  // Entertainer game creator
  const [gameType,       setGameType]       = useState('dice');
  const [gameMaxPlayers, setGameMaxPlayers] = useState(10);
  const [gameManualRoll, setGameManualRoll] = useState(true);
  const [gamePot,        setGamePot]        = useState('0');
  const [gameJoinFee,    setGameJoinFee]    = useState('0');
  const [gameBusy,       setGameBusy]       = useState(false);

  // Crew OC
  const [crewBusy, setCrewBusy] = useState(false);

  // Designer comp
  const [activeDesignerComp,   setActiveDesignerComp]   = useState(null);
  const [myEntryCommentId,     setMyEntryCommentId]     = useState(null);
  const [designerSubmittingId, setDesignerSubmittingId] = useState(null);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchTopic = useCallback(async () => {
    if (!topicId) return;
    setLoading(true);
    try {
      const res = await api.get(`/forum/topics/${topicId}`);
      setTopic(res.data?.topic ?? null);
      setComments(res.data?.comments ?? []);
    } catch (e) {
      if (e.response?.status === 404) { toast.error('Topic not found'); navigate('/forum'); }
      else toast.error('Failed to load topic');
    } finally {
      setLoading(false);
    }
  }, [topicId, navigate]);

  useEffect(() => { fetchTopic(); }, [fetchTopic]);

  useEffect(() => {
    api.get('/admin/check')
      .then((r) => {
        setIsAdmin(!!r.data?.is_admin);
        setIsModerator(!!r.data?.is_moderator);
        setIsHdo(!!r.data?.is_help_desk_operator);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/auth/me').then((r) => setUser(r.data)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (topic?.category !== 'designer' || !user) {
      setActiveDesignerComp(null); setMyEntryCommentId(null); return;
    }
    api.get('/forum/designer/competitions/active')
      .then((r) => {
        setActiveDesignerComp(r.data?.competition ?? null);
        setMyEntryCommentId(r.data?.my_entry_comment_id ?? null);
      })
      .catch(() => { setActiveDesignerComp(null); setMyEntryCommentId(null); });
  }, [topic?.category, user]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const updateTopicFlags = async (payload) => {
    setAdminBusy(true);
    try { await api.patch(`/forum/topics/${topicId}`, payload); toast.success('Updated'); fetchTopic(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setAdminBusy(false); }
  };

  const deleteTopic = async () => {
    if (!window.confirm('Delete this topic and all comments?')) return;
    setAdminBusy(true);
    try { await api.delete(`/forum/topics/${topicId}`); toast.success('Deleted'); navigate('/forum'); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setAdminBusy(false); }
  };

  const openEdit = () => {
    if (!topic) return;
    setEditTitle(topic.title || '');
    setEditContent(topic.content || '');
    setEditGifUrl(topic.gif_url || '');
    setShowEdit(true);
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    const title = editTitle.trim();
    if (!title) { toast.error('Title is required'); return; }
    setEditBusy(true);
    try {
      await api.patch(`/forum/topics/${topicId}`, {
        title, content: editContent.trim(), gif_url: editGifUrl.trim(),
      });
      toast.success('Topic updated'); setShowEdit(false); fetchTopic();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setEditBusy(false); }
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (topic?.is_locked) { toast.error('Topic is locked'); return; }
    const text = commentText.trim();
    if (!text) { toast.error('Enter a comment'); return; }
    setPosting(true);
    try {
      const res = await api.post(
        `/forum/topics/${topicId}/comments`,
        { content: text, reply_to_comment_id: replyTo?.id || undefined },
        { timeout: 30000 },
      );
      setCommentText(''); setReplyTo(null);
      const nc = res.data?.comment;
      if (nc) setComments((prev) => [{ ...nc, liked: nc.liked ?? false }, ...prev]);
      toast.success('Posted');
      fetchTopic().catch(() => {});
    } catch (err) {
      const { status, data } = err.response || {};
      const isReject = (status === 400 || status === 403 || status === 404) && data?.detail;
      if (!isReject) {
        setCommentText(''); setReplyTo(null); toast.success('Posted'); fetchTopic().catch(() => {});
      } else {
        toast.error(data.detail || 'Failed');
      }
    } finally { setPosting(false); }
  };

  const sendGif = async (gifUrl) => {
    if (!gifUrl || posting || topic?.is_locked) return;
    setPosting(true); setShowGifPicker(false);
    try {
      const res = await api.post(
        `/forum/topics/${topicId}/comments`,
        { content: '', gif_url: gifUrl, reply_to_comment_id: replyTo?.id || undefined },
        { timeout: 30000 },
      );
      const nc = res.data?.comment;
      if (nc) setComments((prev) => [{ ...nc, liked: nc.liked ?? false }, ...prev]);
      setReplyTo(null); toast.success('GIF posted'); fetchTopic().catch(() => {});
    } catch (err) {
      const { status, data } = err.response || {};
      const isReject = (status === 400 || status === 403 || status === 404) && data?.detail;
      if (!isReject) { toast.success('GIF posted'); fetchTopic().catch(() => {}); }
      else toast.error(data?.detail || 'Failed');
    } finally { setPosting(false); }
  };

  const likeComment = async (commentId) => {
    setLikingId(commentId);
    try {
      const res = await api.post(`/forum/topics/${topicId}/comments/${commentId}/like`);
      setComments((prev) => prev.map((c) =>
        c.id === commentId
          ? { ...c, likes: res.data?.likes ?? c.likes, liked: res.data?.liked ?? false }
          : c,
      ));
    } catch { toast.error('Failed'); }
    finally { setLikingId(null); }
  };

  const submitDesignerEntry = async (commentId) => {
    if (!activeDesignerComp?.id) return;
    setDesignerSubmittingId(commentId);
    try {
      await api.post(`/forum/designer/competitions/${activeDesignerComp.id}/entries`, { comment_id: commentId });
      toast.success('Entry submitted'); setMyEntryCommentId(commentId);
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setDesignerSubmittingId(null); }
  };

  const applyCrewOC = async () => {
    if (!topic?.crew_oc_family_id) return;
    setCrewBusy(true);
    try {
      const res = await api.post('/families/crew-oc/apply', { family_id: topic.crew_oc_family_id });
      toast.success(res.data?.message || 'Applied.'); fetchTopic();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to apply'); }
    finally { setCrewBusy(false); }
  };

  const createGame = async (e) => {
    e.preventDefault();
    if (topic?.is_locked) return;
    setGameBusy(true);
    try {
      await api.post('/forum/entertainer/games', {
        game_type:   gameType,
        max_players: Math.max(1, Math.min(10, parseInt(gameMaxPlayers, 10) || 10)),
        join_fee:    Math.max(0, parseInt(String(gameJoinFee).replace(/\D/g, ''), 10) || 0),
        pot:         Math.max(0, parseInt(String(gamePot).replace(/\D/g, ''), 10) || 0),
        manual_roll: gameManualRoll,
        topic_id:    topicId || undefined,
      });
      toast.success(gameManualRoll ? 'Game created — roll when ready.' : 'Game created');
      navigate('/forum?tab=entertainer');
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to create game'); }
    finally { setGameBusy(false); }
  };

  const insertMarkup = (before, after = '') => {
    const ta = commentRef.current;
    if (!ta) { setCommentText((c) => c + before + after); return; }
    const { value, cursor } = insertAtCursor(commentText, before, after, ta.selectionStart, ta.selectionEnd);
    setCommentText(value);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(cursor, cursor); }, 0);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const isAuthor     = topic && user && topic.author_id === user.id;
  const isStaff      = isAdmin || isModerator || isHdo;
  const backLink     = BACK_LINKS[topic?.category] || '/forum';
  const isFaq        = detectFaq(topic?.content ?? '');
  const richContent  = isFaq ? prepareFaqContent(topic?.content || '') : (topic?.content || '—');
  const commentCount = comments.length;

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading && !topic) {
    return (
      <div className={`${styles.pageContent} flex items-center justify-center min-h-[40vh]`}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-[10px] font-heading text-mutedForeground tracking-widest uppercase">Loading…</span>
        </div>
      </div>
    );
  }
  if (!topic) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="forum-topic-page">
      <style>{PAGE_STYLES}</style>

      {/* ────────────────── Page header ────────────────────────── */}
      <div className="flex items-start justify-between gap-3">

        {/* Back + title */}
        <div className="flex items-start gap-3 min-w-0">
          <Link
            to={backLink}
            className="mt-0.5 shrink-0 text-zinc-500 hover:text-primary transition-colors"
            aria-label="Back to forum"
          >
            <ArrowLeft size={18} />
          </Link>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              {topic.is_important && <AlertCircle size={12} className="text-amber-400 shrink-0" />}
              {topic.is_sticky && !topic.is_important && <Pin size={12} className="text-amber-400 shrink-0" />}
              <h1 className="text-base sm:text-lg font-heading font-bold text-primary leading-snug break-words">
                {topic.title}
              </h1>
              {topic.is_locked && <Lock size={12} className="text-red-400 shrink-0" />}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[9px] text-zinc-500">
              <Link
                to={`/profile/${encodeURIComponent(topic.author_username)}`}
                className="text-foreground font-bold font-heading hover:text-primary transition-colors"
              >
                {topic.author_username}
              </Link>
              <span className="flex items-center gap-0.5"><Clock size={8} /> {timeAgo(topic.created_at)}</span>
              <span className="flex items-center gap-0.5"><Eye size={8} /> {topic.views ?? 0}</span>
              <span className="flex items-center gap-0.5"><MessageCircle size={8} /> {commentCount}</span>
            </div>
          </div>
        </div>

        {/* Author edit + admin delete */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isAuthor && !topic.crew_oc_family_id && (
            <button
              onClick={openEdit}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading border border-primary/30 text-primary hover:bg-primary/10 transition-all"
            >
              <Pencil size={10} /> Edit
            </button>
          )}
          {isAdmin && (
            <button
              onClick={deleteTopic}
              disabled={adminBusy}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading border border-red-500/40 text-red-400 hover:bg-red-500/15 transition-all disabled:opacity-40"
            >
              <Trash2 size={10} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* ────────────────── Staff controls ─────────────────────── */}
      {isStaff && (
        <div className="staff-bar flex flex-wrap items-center gap-1.5 px-2.5 py-2 rounded-md">
          <span className="text-[9px] font-heading text-amber-500 uppercase tracking-widest mr-1">Staff</span>
          {(isAdmin || isModerator) && (
            <>
              <StaffPill
                icon={Pin}
                label={topic.is_sticky ? 'Unsticky' : 'Sticky'}
                active={topic.is_sticky}
                onClick={() => updateTopicFlags({ is_sticky: !topic.is_sticky })}
                disabled={adminBusy}
              />
              <StaffPill
                icon={AlertCircle}
                label={topic.is_important ? 'Unmark' : 'Important'}
                active={topic.is_important}
                onClick={() => updateTopicFlags({ is_important: !topic.is_important })}
                disabled={adminBusy}
              />
            </>
          )}
          <StaffPill
            icon={Lock}
            label={topic.is_locked ? 'Unlock' : 'Lock'}
            active={topic.is_locked}
            variant="red"
            onClick={() => updateTopicFlags({ is_locked: !topic.is_locked })}
            disabled={adminBusy}
          />
        </div>
      )}

      {/* ────────────────── Edit Topic modal ───────────────────── */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            className={`${styles.panel} relative w-full max-w-md rounded-lg overflow-hidden border border-primary/25 shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2.5 bg-primary/10 border-b border-primary/20 flex items-center justify-between">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">Edit Topic</span>
              <button onClick={() => setShowEdit(false)} className="text-zinc-500 hover:text-foreground transition-colors">
                <X size={14} />
              </button>
            </div>
            <form onSubmit={saveEdit} className="p-3 space-y-3">
              <input
                type="text"
                placeholder="Title…"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none"
              />
              {editGifOpen && (
                <div className="rounded border border-zinc-700/50 overflow-hidden">
                  <GifPicker
                    onSelect={(url) => { if (url) setEditGifUrl(url); setEditGifOpen(false); }}
                    onClose={() => setEditGifOpen(false)}
                  />
                </div>
              )}
              {editGifUrl && (
                <div className="flex items-center gap-2">
                  <img src={editGifUrl} alt="GIF" className="h-14 w-14 object-cover rounded border border-zinc-700/50" />
                  <button type="button" onClick={() => setEditGifUrl('')} className="text-[10px] text-red-400 font-heading hover:text-red-300">
                    Remove GIF
                  </button>
                </div>
              )}
              <textarea
                placeholder="Content…"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={5}
                className="w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none resize-y"
              />
              <button
                type="button"
                onClick={() => setEditGifOpen((v) => !v)}
                className="px-2 py-1 rounded border border-primary/30 text-primary text-[10px] font-heading hover:bg-primary/10 transition-all"
              >
                {editGifOpen ? 'Hide GIF picker' : 'Add GIF'}
              </button>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowEdit(false)}
                  className="flex-1 px-4 py-2 bg-zinc-800/60 text-foreground text-xs font-heading font-bold uppercase rounded border border-zinc-700/50 hover:bg-zinc-700/60 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editBusy}
                  className="flex-1 px-4 py-2 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all"
                >
                  {editBusy ? '…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
          <div className="absolute inset-0 -z-10" onClick={() => setShowEdit(false)} />
        </div>
      )}

      {/* ────────────────── Original post ──────────────────────── */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <PanelHeader>Original Post</PanelHeader>
        <div className="p-3 sm:p-4">
          {topic.gif_url && (
            <img
              src={topic.gif_url}
              alt=""
              className="rounded max-h-64 object-contain fc-gif mb-3"
              loading="lazy"
            />
          )}
          {isFaq ? (
            <div
              className="faq-wrap text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: richContent }}
            />
          ) : (
            <div
              className="fc text-sm text-foreground leading-relaxed break-words"
              dangerouslySetInnerHTML={{ __html: parseForumContent(richContent) }}
            />
          )}
        </div>
      </div>

      {/* ────────────────── Crew OC apply ──────────────────────── */}
      {topic.crew_oc_family_id && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <PanelHeader>
            <UserPlus size={11} className="inline mr-1.5 -mt-0.5" />Apply to Crew OC
          </PanelHeader>
          <div className="p-3 sm:p-4">
            <p className="text-xs text-mutedForeground mb-3 leading-relaxed">
              Join <span className="text-foreground font-bold">{topic.crew_oc_family_name}</span>{' '}
              [{topic.crew_oc_family_tag}] for their next Crew OC run.{' '}
              {topic.crew_oc_join_fee > 0
                ? `Pay $${(topic.crew_oc_join_fee || 0).toLocaleString()} to join instantly.`
                : 'Free — your application will need approval.'}
            </p>
            {topic.crew_oc_my_application ? (
              <p className="text-xs font-heading font-bold text-primary">
                Status: {topic.crew_oc_my_application.status}
              </p>
            ) : (
              <button
                onClick={applyCrewOC}
                disabled={crewBusy}
                className="w-full sm:w-auto px-5 py-2 font-heading font-bold uppercase tracking-wider text-xs rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all"
              >
                {crewBusy ? '…' : topic.crew_oc_join_fee > 0
                  ? `Apply — $${(topic.crew_oc_join_fee || 0).toLocaleString()}`
                  : 'Apply (free)'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ────────────────── Entertainer: create game ───────────── */}
      {topic.category === 'entertainer' && !topic.is_locked && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <PanelHeader>
            <Dice5 size={11} className="inline mr-1.5 -mt-0.5" />Create Game
          </PanelHeader>
          <div className="p-3 sm:p-4">
            <p className="text-xs text-mutedForeground mb-3 leading-relaxed">
              Start a dice or gbox game linked to this topic. Use manual roll to roll when everyone has joined.
            </p>
            <form onSubmit={createGame} className="space-y-3">
              {/* Type toggle */}
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase font-heading mb-1.5">Game type</label>
                <div className="flex gap-2">
                  {[
                    { val: 'dice', icon: Dice5,   label: 'Dice' },
                    { val: 'gbox', icon: Package, label: 'Gbox' },
                  ].map(({ val, icon: Icon, label }) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setGameType(val)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded border text-xs font-heading transition-all ${
                        gameType === val
                          ? 'bg-primary/20 border-primary/50 text-primary'
                          : 'border-zinc-700/50 text-zinc-500 hover:border-zinc-600 hover:text-foreground'
                      }`}
                    >
                      <Icon size={12} /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Inputs grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] text-zinc-500 uppercase font-heading mb-1">Max players</label>
                  <input
                    type="number" min={1} max={10} value={gameMaxPlayers}
                    onChange={(e) => setGameMaxPlayers(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 uppercase font-heading mb-1">Pot ($)</label>
                  <FormattedNumberInput
                    value={gamePot} onChange={setGamePot} placeholder="0"
                    className="w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 uppercase font-heading mb-1">Entry fee ($)</label>
                  <FormattedNumberInput
                    value={gameJoinFee} onChange={setGameJoinFee} placeholder="0"
                    className="w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox" checked={gameManualRoll}
                  onChange={(e) => setGameManualRoll(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-xs font-heading text-foreground">Manual roll — I&apos;ll roll when ready</span>
              </label>

              <button
                type="submit"
                disabled={gameBusy}
                className="px-5 py-2 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all"
              >
                {gameBusy ? '…' : 'Create Game'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ────────────────── Comments list ──────────────────────── */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <PanelHeader right={`${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}`}>
          Comments
        </PanelHeader>

        {comments.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-2">
            <MessageCircle size={22} className="text-zinc-700" />
            <p className="text-xs text-zinc-600 font-heading">No comments yet — be the first.</p>
          </div>
        ) : (
          <div>
            {comments.map((c, idx) => (
              <CommentCard
                key={c.id}
                comment={c}
                idx={idx}
                allComments={comments}
                user={user}
                topicId={topicId}
                activeDesignerComp={activeDesignerComp}
                myEntryCommentId={myEntryCommentId}
                designerSubmittingId={designerSubmittingId}
                likingId={likingId}
                onLike={likeComment}
                onReply={(comment) => {
                  setReplyTo({ id: comment.id, author_username: comment.author_username });
                  setTimeout(() => commentRef.current?.focus(), 80);
                }}
                onSubmitDesigner={submitDesignerEntry}
              />
            ))}
          </div>
        )}
      </div>

      {/* ────────────────── Composer ───────────────────────────── */}
      {topic.is_locked ? (
        <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-zinc-900/40 border border-zinc-800/50">
          <Lock size={11} className="text-zinc-600" />
          <span className="text-xs text-zinc-600 font-heading">This topic is locked</span>
        </div>
      ) : (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <PanelHeader>Add Comment</PanelHeader>

          <div className="p-3 sm:p-4 space-y-2.5">

            {/* GIF picker */}
            {showGifPicker && (
              <div className="rounded border border-zinc-700/50 overflow-hidden">
                <GifPicker onSelect={sendGif} onClose={() => setShowGifPicker(false)} />
              </div>
            )}

            {/* Reply-to banner */}
            {replyTo && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-primary/8 border border-primary/25">
                <span className="text-xs text-zinc-400">
                  Replying to{' '}
                  <Link
                    to={`/profile/${encodeURIComponent(replyTo.author_username)}`}
                    className="font-bold text-primary hover:underline"
                  >
                    {replyTo.author_username}
                  </Link>
                </span>
                <button
                  onClick={() => setReplyTo(null)}
                  className="text-zinc-600 hover:text-foreground transition-colors"
                  aria-label="Cancel reply"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            <form onSubmit={postComment} className="space-y-2">
              <textarea
                ref={commentRef}
                id="forum-add-comment"
                placeholder="Write a comment… [b]bold[/b]  [i]italic[/i]  [color=red]colour[/color]  [img]url[/img]  @Username"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none resize-y"
              />

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" title="Bold"
                  onClick={() => insertMarkup('[b]', '[/b]')}
                  className="p-1.5 rounded border border-zinc-800 text-zinc-500 hover:text-foreground hover:bg-primary/8 hover:border-zinc-700 transition-all"
                ><Bold size={13} /></button>

                <button type="button" title="Italic"
                  onClick={() => insertMarkup('[i]', '[/i]')}
                  className="p-1.5 rounded border border-zinc-800 text-zinc-500 hover:text-foreground hover:bg-primary/8 hover:border-zinc-700 transition-all"
                ><Italic size={13} /></button>

                <button type="button" title="Colour"
                  onClick={() => insertMarkup('[color=#eab308]', '[/color]')}
                  className="p-1.5 rounded border border-zinc-800 text-zinc-500 hover:text-foreground hover:bg-primary/8 hover:border-zinc-700 transition-all"
                ><Palette size={13} /></button>

                <button type="button" title="Image"
                  onClick={() => {
                    const url = window.prompt('Image URL:');
                    if (url?.trim()) insertMarkup('[img]' + url.trim() + '[/img]');
                  }}
                  className="p-1.5 rounded border border-zinc-800 text-zinc-500 hover:text-foreground hover:bg-primary/8 hover:border-zinc-700 transition-all"
                ><Image size={13} /></button>

                <div className="w-px h-4 bg-zinc-800 mx-0.5" />

                <button
                  type="button"
                  onClick={() => setShowGifPicker((v) => !v)}
                  className={`px-2 py-1 rounded border text-[10px] font-heading transition-all ${
                    showGifPicker
                      ? 'bg-primary/20 border-primary/50 text-primary'
                      : 'border-zinc-800 text-zinc-500 hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  GIF
                </button>

                <button
                  type="button"
                  onClick={() => setShowEmojis((v) => !v)}
                  className={`px-2 py-1 rounded border text-[10px] font-heading transition-all ${
                    showEmojis
                      ? 'bg-primary/20 border-primary/50 text-primary'
                      : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-foreground'
                  }`}
                >
                  😀
                </button>

                <div className="flex-1" />

                <button
                  type="submit"
                  disabled={posting}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all touch-manipulation"
                >
                  <Send size={11} /> {posting ? '…' : 'Post'}
                </button>
              </div>

              {/* Emoji tray */}
              {showEmojis && (
                <div className="flex flex-wrap gap-0.5 pt-2 border-t border-zinc-800/60">
                  {EMOJI_STRIP.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setCommentText((c) => c + em)}
                      className="text-base p-1 rounded hover:bg-primary/10 hover:scale-110 transition-all"
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
