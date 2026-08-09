import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom';
import { Lock, ThumbsUp, ThumbsDown, Send, Pin, AlertCircle, Trash2, ArrowLeft, MessageCircle, Eye, Clock, Dice5, Package, UserPlus, Bold, Italic, Image, Palette, Pencil, X, Plus, Mic2 } from 'lucide-react';
import api from '../../utils/api';
import { confirmEntertainerGameCreatorDeduction, ENTERTAINER_GBOX_MAX_POINTS } from '../../utils/entertainerGameCreateConfirm';
import { writeSessionJson } from '../../utils/sessionPageCache';
import { forumTopicCacheKey, readForumTopicCache } from '../../utils/forumTopicWarm';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import GifPicker from '../../components/GifPicker';
import { toast } from 'sonner';
import { parseForumContent, insertAtCursor, FORUM_INLINE_SMILEY_PX } from '../../utils/forumContent';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import FamilyEmblem from '../../components/FamilyEmblem';
import styles from '../../styles/noir.module.css';

// Classic forum smileys (text codes that render as images)
const CLASSIC_SMILEYS = [
  { code: ':wink:', img: 'wink' },
  { code: ':twisted:', img: 'twisted' },
  { code: ':tup:', img: 'tup' },
  { code: ':tdown:', img: 'tdown' },
  { code: ':tongue:', img: 'tongue' },
  { code: ':surprised:', img: 'surprised' },
  { code: ':happy:', img: 'smirk' },
  { code: ':sad:', img: 'sad' },
  { code: ':rolleyes:', img: 'rolleyes' },
  { code: ':redface:', img: 'redface' },
  { code: ':?:', img: 'question' },
  { code: ':mad:', img: 'mad' },
  { code: ':lol:', img: 'lol' },
  { code: ':idea:', img: 'idea' },
  { code: ':!:', img: 'exclamation' },
  { code: ':evil:', img: 'evil' },
  { code: ':eek:', img: 'eek' },
  { code: ':cool:', img: 'cool' },
  { code: ':confused:', img: 'confused' },
  { code: ':grin:', img: 'grin' },
  { code: ':arrow:', img: 'arrow' },
  { code: ':feelsbadman:', img: 'feelsbadman' },
  { code: ':ez:', img: 'ez' },
  { code: ':crazy:', img: 'crazy' },
  { code: ':feelsrainman:', img: 'feelsrainman' },
  { code: ':fu:', img: 'fu' },
  { code: ':sadge:', img: 'sadge' },
  { code: ':howdie:', img: 'howdie' },
  { code: ':uzi:', img: 'uzi' },
  { code: ':kekl:', img: 'kekl' },
  { code: ':kekwait:', img: 'kekwait' },
  { code: ':kekleo:', img: 'kekleo' },
  { code: ':kekw:', img: 'kekw' },
  { code: ':hmmnice:', img: 'hmmnice' },
  { code: ':hypers:', img: 'hypers' },
  { code: ':poggers:', img: 'poggers' },
  { code: ':hackermans:', img: 'hackermans' },
  { code: ':prayge:', img: 'prayge' },
];

// Modern emoji picker
const EMOJI_STRIP = [
  '😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😎', '🤩', '😍', 
  '😂', '🤣', '😅', '😢', '😭', '😤', '😡', '🤬', '😱', '😰',
  '🤔', '😐', '😑', '🙄', '😏', '😒', '🥱', '😴', '🤢', '🤮',
  '👍', '👎', '👋', '🤝', '🙏', '💪', '✊', '👊', '🤙', '✌️',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '❣️', '💕',
  '🔥', '⭐', '✨', '💥', '💯', '🎉', '🎊', '🏆', '👑', '💎',
  '💰', '💵', '💸', '🔫', '💀', '☠️', '⚔️', '🔪', '🎲', '🃏',
  '❓', '❗', '⚠️', '✅', '❌', '🚫', '➕', '➖', '➡️', '⬅️'
];

const TITLE_COLORS = [
  // Default
  { name: 'Default', value: '' },
  // Standard colors
  { name: 'White', value: '#FFFFFF' },
  { name: 'Silver', value: '#C0C0C0' },
  { name: 'Grey', value: '#808080' },
  { name: 'Red', value: '#FF0000' },
  { name: 'Maroon', value: '#800000' },
  { name: 'Orange', value: '#FF8C00' },
  { name: 'Gold', value: '#FFD700' },
  { name: 'Yellow', value: '#FFFF00' },
  { name: 'Lime', value: '#00FF00' },
  { name: 'Green', value: '#008000' },
  { name: 'Teal', value: '#008080' },
  { name: 'Cyan', value: '#00FFFF' },
  { name: 'Blue', value: '#0000FF' },
  { name: 'Navy', value: '#000080' },
  { name: 'Purple', value: '#800080' },
  { name: 'Pink', value: '#FFC0CB' },
  { name: 'Brown', value: '#8B4513' },
  // Neon colors
  { name: 'Neon Pink', value: '#FF10F0' },
  { name: 'Neon Green', value: '#39FF14' },
  { name: 'Neon Blue', value: '#00BFFF' },
  { name: 'Neon Purple', value: '#BF00FF' },
  { name: 'Neon Orange', value: '#FF6600' },
  { name: 'Neon Cyan', value: '#00FFFF' },
  { name: 'Neon Red', value: '#FF3131' },
  { name: 'Electric Lime', value: '#CCFF00' },
  { name: 'Hot Magenta', value: '#FF00FF' },
  { name: 'Laser Lemon', value: '#FFFF66' },
  { name: 'Electric Blue', value: '#7DF9FF' },
  { name: 'Neon Coral', value: '#FF6F61' },
  { name: 'Toxic Green', value: '#61FF00' },
  { name: 'Plasma Purple', value: '#8B00FF' },
];

/** FAQ: compact noir theme to match the rest of the app. */
const FORUM_FAQ_STYLES = `
  .forum-faq-content { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
  .forum-faq-content .forum-faq-outer { background: var(--noir-surface); color: var(--noir-foreground); padding: 0.75em 1em; border-radius: 6px; border: 1px solid var(--noir-border-mid); }
  .forum-faq-content details { margin: 0.25em 0; border: 1px solid var(--noir-border-light); border-radius: 4px; overflow: hidden; }
  .forum-faq-content summary { background: rgba(var(--noir-primary-rgb), 0.08); color: var(--noir-primary); padding: 0.35em 0.75em; cursor: pointer; font-weight: bold; list-style: none; border: none; font-size: 0.95em; }
  .forum-faq-content summary::-webkit-details-marker { display: none; }
  .forum-faq-content summary:hover { background: rgba(var(--noir-primary-rgb), 0.12); color: var(--noir-primary-bright); }
  .forum-faq-content details[open] summary { border-bottom: 1px solid var(--noir-border-light); }
  .forum-faq-content details > div { padding: 0.6em 0.9em; background: var(--noir-content); color: var(--noir-foreground); line-height: 1.45; }
  .forum-faq-content strong { color: var(--noir-primary); }
  /* BBCode [color] wraps list rows in <span style="color:…">; [b] becomes <strong> — let bold inherit tier color (e.g. wealth ranks FAQ). */
  .forum-faq-content li span[style*="color:"] strong { color: inherit !important; }
  .forum-faq-content p { margin: 0.35em 0; color: var(--noir-foreground); line-height: 1.5; }
  .forum-faq-content ul, .forum-faq-content ol { margin: 0.35em 0 0.55em; padding-left: 1.25em; color: var(--noir-foreground); }
  .forum-faq-content li { color: var(--noir-foreground); margin: 0.2em 0; line-height: 1.45; }
  .forum-faq-content blockquote,
  .forum-faq-content .forum-content-quote {
    margin: 0.55em 0 0.95em !important;
    padding: 0.7em 0.95em !important;
    background: var(--noir-content) !important;
    border-left: 3px solid rgba(var(--noir-primary-rgb), 0.5) !important;
    border-radius: 0 4px 4px 0 !important;
    color: var(--noir-foreground) !important;
  }
  .forum-faq-content hr {
    border: none;
    border-top: 1px solid var(--noir-border-light);
    margin: 1.15em 0;
    opacity: 0.9;
  }
  .forum-faq-content table { border-collapse: collapse; width: max-content; min-width: 100%; margin-top: 0.35em; border-radius: 4px; }
  .forum-faq-content th, .forum-faq-content td { border: 1px solid var(--noir-border-light); padding: 0.35em 0.6em; text-align: left; color: var(--noir-foreground); font-size: 0.95em; }
  .forum-faq-content th { background: rgba(var(--noir-primary-rgb), 0.08); color: var(--noir-primary); }
  .forum-faq-content tr:nth-child(even) { background: var(--noir-surface); }
  @media (max-width: 767px) {
    .forum-faq-content { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  }
`;
const FORUM_CONTENT_STYLES = `
  @keyframes f-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .f-fade-in { animation: f-fade-in 0.35s ease-out both; }
  .forum-content-media { max-width: 100%; height: auto; border-radius: 8px; margin: 0.25em 0; display: block; }
  .forum-content-gif { max-height: 280px; object-fit: contain; }
  .forum-content strong { font-weight: 700; }
  .forum-content em { font-style: italic; }
  .forum-content .forum-content-emoji { font-size: ${FORUM_INLINE_SMILEY_PX}px !important; line-height: 1; display: inline-block; vertical-align: -0.2em; }
  [id^="forum-comment-"],
  [id^="forum-topic-"] {
    scroll-margin-top: 4.5rem;
    scroll-margin-bottom: 9rem;
  }
  .forum-sticky-composer {
    position: sticky;
    z-index: 30;
    bottom: 0;
  }
  @media (max-width: 767px) {
    [id^="forum-comment-"],
    [id^="forum-topic-"] {
      scroll-margin-top: 5.25rem;
      scroll-margin-bottom: 11rem;
    }
    .forum-sticky-composer {
      bottom: calc(4.75rem + env(safe-area-inset-bottom, 0px));
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.45);
    }
    body[data-mobile-layout="pocket_deck"] .forum-sticky-composer {
      bottom: calc(5.25rem + env(safe-area-inset-bottom, 0px));
    }
    body[data-mobile-layout="pocket_deck"] [id^="forum-comment-"],
    body[data-mobile-layout="pocket_deck"] [id^="forum-topic-"] {
      scroll-margin-top: 6rem;
    }
  }
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

/** Scroll to a comment or topic OP block (`forum-comment-*` / `forum-topic-*`). */
function scrollToForumElementById(elementId) {
  if (!elementId) return;
  const run = () => {
    const el = document.getElementById(elementId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
}

function focusForumComposer(textareaRef) {
  const composer = document.getElementById('forum-composer');
  if (composer) {
    composer.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
  window.setTimeout(() => {
    textareaRef?.current?.focus?.({ preventScroll: true });
  }, 280);
}

/** Telegram-style emoji reactions on topic OP or a comment */
function ForumEmojiReactionBar({
  topicId,
  commentId,
  reactions,
  myEmoji,
  locked,
  onApplied,
  onShowWho,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAbove, setPickerAbove] = useState(true);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setPickerOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setPickerAbove(rect.top > 220);
  }, [pickerOpen]);

  const apply = async (emoji) => {
    if (busy || !topicId) return;
    if (locked) {
      toast.error('Topic is locked');
      return;
    }
    setBusy(true);
    try {
      const url =
        commentId != null
          ? `/forum/topics/${topicId}/comments/${commentId}/reactions`
          : `/forum/topics/${topicId}/reactions`;
      const res = await api.post(url, { emoji });
      onApplied(res.data);
      setPickerOpen(false);
    } catch (err) {
      const d = err.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const list = Array.isArray(reactions) ? reactions : [];

  return (
    <div className="flex flex-wrap items-center gap-1 mt-2" ref={wrapRef}>
      {list.map((row) => (
        <button
          key={row.emoji}
          type="button"
          disabled={busy}
          title={
            locked && myEmoji === row.emoji
              ? 'Topic is locked'
              : myEmoji === row.emoji
                ? 'Remove your reaction'
                : 'Who reacted'
          }
          onClick={() => {
            if (!locked && myEmoji === row.emoji) {
              apply(row.emoji);
            } else {
              onShowWho(row.emoji);
            }
          }}
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors ${
            myEmoji === row.emoji
              ? 'border-primary/50 bg-primary/12 shadow-[0_0_0_1px_rgba(var(--noir-primary-rgb),0.15)]'
              : 'border-zinc-700/70 bg-zinc-900/85 hover:bg-zinc-800/90'
          } disabled:opacity-60`}
        >
          <span className="leading-none select-none" aria-hidden>
            {row.emoji}
          </span>
          <span className="flex -space-x-1.5">
            {(row.users || []).slice(0, 3).map((u) =>
              u.avatar_url ? (
                <img
                  key={u.user_id}
                  src={u.avatar_url}
                  alt=""
                  className="w-4 h-4 rounded-full border border-zinc-800 object-cover shrink-0"
                />
              ) : (
                <span
                  key={u.user_id}
                  className="w-4 h-4 rounded-full border border-zinc-800 bg-zinc-700 text-[8px] flex items-center justify-center font-heading text-zinc-200 shrink-0 uppercase"
                >
                  {(u.username || '?').slice(0, 1)}
                </span>
              ),
            )}
          </span>
          {(row.count || 0) > 1 && (
            <span className="tabular-nums text-mutedForeground text-[10px] font-heading shrink-0">{row.count}</span>
          )}
        </button>
      ))}
      {!locked && (
        <div className="relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-dashed border-zinc-600/80 text-mutedForeground hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-50"
            title="Add reaction"
            aria-label="Add reaction"
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
          {pickerOpen && (
            <div
              className={`absolute left-0 z-40 p-2 rounded-lg border border-zinc-700/80 bg-zinc-950 shadow-xl max-w-[min(240px,calc(100vw-2rem))] ${
                pickerAbove ? 'bottom-full mb-1' : 'top-full mt-1'
              }`}
            >
              <div className="flex flex-wrap gap-0.5 max-h-40 overflow-y-auto overscroll-contain">
                {EMOJI_STRIP.map((em) => (
                  <button
                    key={em}
                    type="button"
                    className="text-lg min-w-9 min-h-9 inline-flex items-center justify-center hover:bg-zinc-800 rounded leading-none touch-manipulation"
                    onClick={() => apply(em)}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getAuctionEndStatusLabel(auction) {
  if (!auction?.end_at) return 'No end';
  const end = new Date(auction.end_at);
  if (Number.isNaN(end.getTime())) return 'No end';
  const status = String(auction.status || '').toLowerCase();
  if (status === 'open') {
    const leftMs = end.getTime() - Date.now();
    if (leftMs <= 0) return 'Ends now';
    const s = Math.floor(leftMs / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  }
  return `Ended ${end.toLocaleString()}`;
}

export default function ForumTopic() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [topic, setTopic] = useState(() => readForumTopicCache(topicId)?.topic ?? null);
  const [comments, setComments] = useState(() => readForumTopicCache(topicId)?.comments ?? []);
  const [hasLoaded, setHasLoaded] = useState(() => !!readForumTopicCache(topicId)?.topic);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [likingId, setLikingId] = useState(null);
  const [dislikingId, setDislikingId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [isHdo, setIsHdo] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showImageUrl, setShowImageUrl] = useState(false);
  const [imageUrlDraft, setImageUrlDraft] = useState('');
  const [createGameType, setCreateGameType] = useState('dice');
  const [createGameMaxPlayers, setCreateGameMaxPlayers] = useState(10);
  const [createGameManualRoll, setCreateGameManualRoll] = useState(true);
  const [createGamePot, setCreateGamePot] = useState('0');
  const [createGameJoinFee, setCreateGameJoinFee] = useState('0');
  const [createGameRewardMoney, setCreateGameRewardMoney] = useState('0');
  const [createGameRewardPoints, setCreateGameRewardPoints] = useState('0');
  const [createGameSubmitting, setCreateGameSubmitting] = useState(false);
  const [crewOCApplyLoading, setCrewOCApplyLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [showEditTopic, setShowEditTopic] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTitleColor, setEditTitleColor] = useState('');
  const [showEditTitleColors, setShowEditTitleColors] = useState(false);
  const [showStaffTitleColors, setShowStaffTitleColors] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editGifUrl, setEditGifUrl] = useState('');
  const [editShowGifPicker, setEditShowGifPicker] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [replyToComment, setReplyToComment] = useState(null); // { id, author_username }
  const commentTextareaRef = useRef(null);
  const [activeDesignerComp, setActiveDesignerComp] = useState(null);
  const [myEntryCommentId, setMyEntryCommentId] = useState(null);
  const [designerSubmitLoading, setDesignerSubmitLoading] = useState(false);
  const [designerSubmittingCommentId, setDesignerSubmittingCommentId] = useState(null);
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const [reactionModal, setReactionModal] = useState(null); // { kind: 'like'|'dislike'|'emoji', commentId?, emoji? }
  const [reactionUsers, setReactionUsers] = useState([]);
  const [reactionLoading, setReactionLoading] = useState(false);
  const [activeGameIdeaSeason, setActiveGameIdeaSeason] = useState(null);
  const [gameIdeaMyEntryCommentId, setGameIdeaMyEntryCommentId] = useState(null);
  const [gameIdeaSubmittingCommentId, setGameIdeaSubmittingCommentId] = useState(null);
  const [designerAuction, setDesignerAuction] = useState(null);
  const [designerAuctionLoading, setDesignerAuctionLoading] = useState(false);
  const [designerBidAmount, setDesignerBidAmount] = useState('');
  const [designerBidSubmitting, setDesignerBidSubmitting] = useState(false);
  const [designerDeliverUrl, setDesignerDeliverUrl] = useState('');
  const [designerDeliverSubmitting, setDesignerDeliverSubmitting] = useState(false);
  const [designerConfirmSubmitting, setDesignerConfirmSubmitting] = useState(false);
  const [designerDisputeReason, setDesignerDisputeReason] = useState('');
  const [designerDisputeSubmitting, setDesignerDisputeSubmitting] = useState(false);

  const forumHashScrollDoneRef = useRef('');

  const fetchTopic = useCallback(async (silent = false) => {
    if (!topicId) return;
    try {
      const res = await api.get(`/forum/topics/${topicId}`);
      const t = res.data?.topic ?? null;
      const cm = res.data?.comments ?? [];
      setTopic(t);
      setComments(cm);
      if (t) writeSessionJson(forumTopicCacheKey(topicId), { topic: t, comments: cm });
    } catch (e) {
      if (!silent) {
        setTopic(null);
        setComments([]);
        if (e.response?.status === 404) {
          toast.error('Topic not found');
          navigate('/forum');
        } else {
          toast.error('Failed to load topic');
        }
      }
    } finally {
      setHasLoaded(true);
    }
  }, [topicId, navigate]);

  useLayoutEffect(() => {
    if (!topicId) return;
    const c = readForumTopicCache(topicId);
    if (c?.topic) {
      setTopic(c.topic);
      setComments(c.comments ?? []);
      setHasLoaded(true);
      fetchTopic(true);
    } else {
      setTopic(null);
      setComments([]);
      setHasLoaded(false);
      fetchTopic(false);
    }
  }, [topicId, fetchTopic]);

  useEffect(() => {
    forumHashScrollDoneRef.current = '';
  }, [topicId]);

  // Deep link: /forum/topic/:id#forum-comment-… or #forum-topic-…
  useEffect(() => {
    if (!hasLoaded || !topic?.id) return;
    const raw = (location.hash || '').replace(/^#/, '');
    if (!raw || (!raw.startsWith('forum-comment-') && !raw.startsWith('forum-topic-'))) return;
    if (forumHashScrollDoneRef.current === raw) return;
    const el = document.getElementById(raw);
    if (!el) return;
    scrollToForumElementById(raw);
    forumHashScrollDoneRef.current = raw;
  }, [hasLoaded, topic?.id, location.hash, comments.length]);

  useEffect(() => {
    if (!topicId) return;
    const interval = setInterval(() => fetchTopic(true), 60_000);
    return () => clearInterval(interval);
  }, [topicId, fetchTopic]);
  useEffect(() => {
    api.get('/auth/staff-flags').then((r) => {
      setIsAdmin(!!r.data?.is_admin);
      setIsModerator(!!r.data?.is_moderator);
      setIsHdo(!!r.data?.is_help_desk_operator);
    }).catch(() => { setIsAdmin(false); setIsModerator(false); setIsHdo(false); });
  }, []);
  useEffect(() => { api.get('/auth/me').then((r) => setUser(r.data)).catch(() => setUser(null)); }, []);

  useEffect(() => {
    if (topic?.category === 'designer' && user) {
      api.get('/forum/designer/competitions/active').then((r) => {
        setActiveDesignerComp(r.data?.competition ?? null);
        setMyEntryCommentId(r.data?.my_entry_comment_id ?? null);
      }).catch(() => { setActiveDesignerComp(null); setMyEntryCommentId(null); });
    } else {
      setActiveDesignerComp(null);
      setMyEntryCommentId(null);
    }
  }, [topic?.category, user]);

  const fetchDesignerAuction = useCallback(async () => {
    if (!topicId || topic?.category !== 'designer') {
      setDesignerAuction(null);
      return;
    }
    setDesignerAuctionLoading(true);
    try {
      const res = await api.get(`/forum/designer/auctions/topic/${topicId}`);
      setDesignerAuction(res.data?.auction ?? null);
    } catch {
      setDesignerAuction(null);
    } finally {
      setDesignerAuctionLoading(false);
    }
  }, [topicId, topic?.category]);

  useEffect(() => {
    fetchDesignerAuction();
  }, [fetchDesignerAuction]);

  useEffect(() => {
    const sid = topic?.game_idea_season_id;
    if (!sid || !user) {
      setActiveGameIdeaSeason(null);
      setGameIdeaMyEntryCommentId(null);
      return;
    }
    api.get('/forum/game-ideas/active-season', { params: { hub_season_id: sid } }).then((r) => {
      const s = r.data?.season;
      if (s) {
        setActiveGameIdeaSeason(s);
        setGameIdeaMyEntryCommentId(r.data?.my_entry_comment_id ?? null);
      } else {
        setActiveGameIdeaSeason(null);
        setGameIdeaMyEntryCommentId(null);
      }
    }).catch(() => { setActiveGameIdeaSeason(null); setGameIdeaMyEntryCommentId(null); });
  }, [topic?.game_idea_season_id, user]);

  const isAuthor = topic && user && topic.author_id === user.id && !topic.redeem_code;
  const canEditTopic = Boolean(
    topic && user && !topic.crew_oc_family_id && (isAuthor || isAdmin || isModerator)
  );

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

  const openEditTopic = () => {
    if (!topic) return;
    setEditTitle(topic.title || '');
    setEditTitleColor(topic.title_color || '');
    setEditContent(topic.content || '');
    setEditGifUrl(topic.gif_url || '');
    setShowEditTopic(true);
  };

  const saveEditTopic = async (e) => {
    e.preventDefault();
    const title = editTitle.trim();
    if (!title) { toast.error('Title is required'); return; }
    setEditSubmitting(true);
    try {
      await api.patch(`/forum/topics/${topicId}`, {
        title,
        title_color: editTitleColor || '',
        content: editContent.trim(),
        gif_url: editGifUrl.trim(),
      });
      toast.success('Topic updated');
      setShowEditTopic(false);
      fetchTopic();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setEditSubmitting(false);
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

  const handleDesignerBid = async (e) => {
    e.preventDefault();
    if (!designerAuction?.id) return;
    const amount = parseInt(String(designerBidAmount).replace(/\D/g, ''), 10) || 0;
    if (amount <= 0) return;
    setDesignerBidSubmitting(true);
    try {
      await api.post(`/forum/designer/auctions/${designerAuction.id}/bid`, { amount });
      toast.success('Bid placed');
      setDesignerBidAmount('');
      fetchDesignerAuction();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to bid');
    } finally {
      setDesignerBidSubmitting(false);
    }
  };

  const handleDesignerDeliver = async (e) => {
    e.preventDefault();
    if (!designerAuction?.id) return;
    if (!designerDeliverUrl.trim()) return;
    setDesignerDeliverSubmitting(true);
    try {
      await api.post(`/forum/designer/auctions/${designerAuction.id}/deliver`, { delivered_image_url: designerDeliverUrl.trim() });
      toast.success('Marked delivered');
      setDesignerDeliverUrl('');
      fetchDesignerAuction();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to mark delivered');
    } finally {
      setDesignerDeliverSubmitting(false);
    }
  };

  const handleDesignerConfirm = async (side) => {
    if (!designerAuction?.id) return;
    setDesignerConfirmSubmitting(true);
    try {
      if (side === 'designer') {
        await api.post(`/forum/designer/auctions/${designerAuction.id}/confirm-designer`);
      } else {
        await api.post(`/forum/designer/auctions/${designerAuction.id}/confirm-winner`);
      }
      toast.success('Confirmation recorded');
      fetchDesignerAuction();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to confirm');
    } finally {
      setDesignerConfirmSubmitting(false);
    }
  };

  const handleDesignerDispute = async (e) => {
    e.preventDefault();
    if (!designerAuction?.id) return;
    setDesignerDisputeSubmitting(true);
    try {
      await api.post(`/forum/designer/auctions/${designerAuction.id}/dispute`, { reason: designerDisputeReason.trim() || undefined });
      toast.success('Dispute reported to staff');
      setDesignerDisputeReason('');
      fetchDesignerAuction();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to report dispute');
    } finally {
      setDesignerDisputeSubmitting(false);
    }
  };

  const submitToGameIdea = async (commentId) => {
    const sid = topic?.game_idea_season_id;
    if (!sid || !commentId) return;
    setGameIdeaSubmittingCommentId(commentId);
    try {
      await api.post(`/forum/game-ideas/seasons/${sid}/entries`, { comment_id: String(commentId).trim() });
      toast.success('Idea registered');
      setGameIdeaMyEntryCommentId(commentId);
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to register');
    } finally {
      setGameIdeaSubmittingCommentId(null);
    }
  };

  const submitToDesignerComp = async (commentId) => {
    if (!activeDesignerComp?.id || !commentId) return;
    setDesignerSubmittingCommentId(commentId);
    try {
      await api.post(`/forum/designer/competitions/${activeDesignerComp.id}/entries`, {
        comment_id: String(commentId).trim(),
      });
      toast.success('Entry submitted');
      setMyEntryCommentId(commentId);
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to submit entry');
    } finally {
      setDesignerSubmittingCommentId(null);
    }
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (topic?.is_locked) { toast.error('Topic is locked'); return; }
    const text = commentText.trim();
    if (!text) { toast.error('Enter a comment'); return; }
    setPosting(true);
    try {
      const res = await api.post(`/forum/topics/${topicId}/comments`, {
        content: text,
        reply_to_comment_id: replyToComment?.id || undefined,
      }, { timeout: 30000 });
      setCommentText('');
      setReplyToComment(null);
      const newComment = res.data?.comment
        ? {
            ...res.data.comment,
            liked: res.data.comment.liked ?? false,
            disliked: res.data.comment.disliked ?? false,
            dislikes: res.data.comment.dislikes ?? 0,
            emoji_reactions: res.data.comment.emoji_reactions ?? [],
            my_emoji_reaction: res.data.comment.my_emoji_reaction ?? null,
          }
        : null;
      const anchorId = newComment?.id ? `forum-comment-${newComment.id}` : null;
      if (newComment) setComments((prev) => [newComment, ...prev]);
      toast.success('Posted');
      if (anchorId) {
        scrollToForumElementById(anchorId);
        fetchTopic()
          .then(() => scrollToForumElementById(anchorId))
          .catch(() => {});
      } else {
        fetchTopic().catch(() => {});
      }
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      const isExplicitReject = (status === 400 || status === 403 || status === 404) && typeof detail === 'string' && detail.length > 0;
      if ((typeof status === 'number' && status >= 200 && status < 300) || !isExplicitReject) {
        setCommentText('');
        setReplyToComment(null);
        toast.success('Posted');
        fetchTopic().catch(() => {});
      } else {
        toast.error(detail || 'Failed');
      }
    } finally {
      setPosting(false);
    }
  };

  const handleSendGif = async (gifUrl) => {
    if (!gifUrl || posting || topic?.is_locked) return;
    setPosting(true);
    setShowGifPicker(false);
    try {
      const res = await api.post(`/forum/topics/${topicId}/comments`, {
        content: '',
        gif_url: gifUrl,
        reply_to_comment_id: replyToComment?.id || undefined,
      }, { timeout: 30000 });
      const newComment = res.data?.comment
        ? {
            ...res.data.comment,
            liked: res.data.comment.liked ?? false,
            disliked: res.data.comment.disliked ?? false,
            dislikes: res.data.comment.dislikes ?? 0,
            emoji_reactions: res.data.comment.emoji_reactions ?? [],
            my_emoji_reaction: res.data.comment.my_emoji_reaction ?? null,
          }
        : null;
      const anchorId = newComment?.id ? `forum-comment-${newComment.id}` : null;
      if (newComment) setComments((prev) => [newComment, ...prev]);
      setReplyToComment(null);
      toast.success('GIF posted');
      if (anchorId) {
        scrollToForumElementById(anchorId);
        fetchTopic()
          .then(() => scrollToForumElementById(anchorId))
          .catch(() => {});
      } else {
        fetchTopic().catch(() => {});
      }
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      const isExplicitReject = (status === 400 || status === 403 || status === 404) && typeof detail === 'string' && detail.length > 0;
      if ((typeof status === 'number' && status >= 200 && status < 300) || !isExplicitReject) {
        toast.success('GIF posted');
        fetchTopic().catch(() => {});
      } else {
        toast.error(detail || 'Failed');
      }
    } finally {
      setPosting(false);
    }
  };

  const createGameInTopic = async (e) => {
    e.preventDefault();
    if (topic?.is_locked) return;
    const parsedMaxPlayers = Math.max(1, Math.min(10, parseInt(createGameMaxPlayers, 10) || 10));
    const parsedJoinFee = Math.max(0, parseInt(String(createGameJoinFee).replace(/\D/g, ''), 10) || 0);
    const parsedPot = Math.max(0, parseInt(String(createGamePot).replace(/\D/g, ''), 10) || 0);
    const rewardMoney = Math.max(0, parseInt(String(createGameRewardMoney).replace(/\D/g, ''), 10) || 0);
    const rewardPoints = Math.max(0, parseInt(String(createGameRewardPoints).replace(/\D/g, ''), 10) || 0);
    const prep = confirmEntertainerGameCreatorDeduction({
      isAdmin: !!isAdmin,
      isEntertainer: !!user?.is_entertainer,
      manualRoll: createGameManualRoll,
      parsedPot,
      rewardMoney,
      rewardPoints,
      gameType: createGameType,
    });
    if (!prep.allowed) {
      if (prep.toastMessage) toast.error(prep.toastMessage);
      return;
    }
    setCreateGameSubmitting(true);
    try {
      await api.post('/forum/entertainer/games', {
        game_type: createGameType,
        max_players: parsedMaxPlayers,
        join_fee: parsedJoinFee,
        pot: parsedPot,
        manual_roll: createGameManualRoll,
        reward_money: rewardMoney,
        reward_points: rewardPoints,
        topic_id: topicId || undefined,
      }, { timeout: 45000 });
      toast.success(createGameManualRoll ? 'Game created — roll it when ready from the Entertainer Forum.' : 'Game created');
      navigate('/forum?tab=entertainer');
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      const isExplicitReject = (status === 400 || status === 401 || status === 403 || status === 404) && typeof detail === 'string' && detail.length > 0;
      if ((typeof status === 'number' && status >= 200 && status < 300) || !isExplicitReject) {
        toast.success(createGameManualRoll ? 'Game created — roll it when ready from the Entertainer Forum.' : 'Game created');
        navigate('/forum?tab=entertainer');
      } else {
        toast.error(detail || 'Failed to create game');
      }
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

  const insertCommentImageFromDraft = () => {
    const url = imageUrlDraft.trim();
    if (!url) {
      toast.error('Enter an image URL');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error('Image URL must start with http:// or https://');
      return;
    }
    insertCommentMarkup(`[img]${url}[/img]`);
    setImageUrlDraft('');
    setShowImageUrl(false);
  };

  const beginReplyToComment = (comment) => {
    setReplyToComment({ id: comment.id, author_username: comment.author_username });
    focusForumComposer(commentTextareaRef);
  };

  const likeComment = async (commentId) => {
    setLikingId(commentId);
    try {
      const res = await api.post(`/forum/topics/${topicId}/comments/${commentId}/like`);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { 
                ...c, 
                likes: res.data?.likes ?? c.likes, 
                liked: res.data?.liked ?? false,
                dislikes: res.data?.dislikes ?? c.dislikes ?? 0,
                disliked: res.data?.disliked ?? false
              }
            : c
        )
      );
    } catch {
      toast.error('Failed');
    } finally {
      setLikingId(null);
    }
  };

  const dislikeComment = async (commentId) => {
    setDislikingId(commentId);
    try {
      const res = await api.post(`/forum/topics/${topicId}/comments/${commentId}/dislike`);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { 
                ...c, 
                dislikes: res.data?.dislikes ?? c.dislikes ?? 0, 
                disliked: res.data?.disliked ?? false,
                likes: res.data?.likes ?? c.likes,
                liked: res.data?.liked ?? false
              }
            : c
        )
      );
    } catch {
      toast.error('Failed');
    } finally {
      setDislikingId(null);
    }
  };

  const closeReactionModal = () => {
    setReactionModal(null);
    setReactionUsers([]);
    setReactionLoading(false);
  };

  const openReactionUsers = async (commentId, kind) => {
    if (!topicId) return;
    setReactionModal({ kind, commentId });
    setReactionLoading(true);
    setReactionUsers([]);
    try {
      const path = kind === 'like' ? 'likes' : 'dislikes';
      const res = await api.get(`/forum/topics/${topicId}/comments/${commentId}/${path}`);
      setReactionUsers(res.data?.users ?? []);
    } catch (err) {
      const d = err.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Failed to load list');
      setReactionModal(null);
    } finally {
      setReactionLoading(false);
    }
  };

  const openEmojiReactionUsers = async (commentId, emoji) => {
    if (!topicId || !emoji) return;
    setReactionModal({ kind: 'emoji', commentId: commentId ?? null, emoji });
    setReactionLoading(true);
    setReactionUsers([]);
    try {
      const q = `?emoji=${encodeURIComponent(emoji)}`;
      const url =
        commentId != null
          ? `/forum/topics/${topicId}/comments/${commentId}/reactions/users${q}`
          : `/forum/topics/${topicId}/reactions/users${q}`;
      const res = await api.get(url);
      setReactionUsers(res.data?.users ?? []);
    } catch (err) {
      const d = err.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Failed to load list');
      setReactionModal(null);
    } finally {
      setReactionLoading(false);
    }
  };

  const deleteComment = async (commentId) => {
    if (!window.confirm('Delete this comment? This cannot be undone.')) return;
    setDeletingCommentId(commentId);
    try {
      await api.delete(`/forum/topics/${topicId}/comments/${commentId}`);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      toast.success('Comment deleted');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete comment');
    } finally {
      setDeletingCommentId(null);
    }
  };

  if (!hasLoaded && !topic) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="forum-topic-page">
        <style>{FORUM_CONTENT_STYLES}</style>
        <div className="flex items-center gap-3 f-fade-in">
          <div className="h-8 w-8 rounded-md bg-zinc-800/80 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2 min-w-0">
            <div className="h-5 w-48 max-w-[70%] rounded bg-primary/20 animate-pulse" />
            <div className="h-3 w-36 rounded bg-zinc-700/60 animate-pulse" />
          </div>
        </div>
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel f-fade-in`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
            <span className="text-xs font-heading font-bold text-primary/70 uppercase tracking-widest">📝 Original Post</span>
          </div>
          <div className="p-3 space-y-2.5">
            <div className="h-3.5 w-full rounded bg-zinc-700/50 animate-pulse" />
            <div className="h-3.5 w-[92%] rounded bg-zinc-700/40 animate-pulse" />
            <div className="h-3.5 w-[78%] rounded bg-zinc-700/35 animate-pulse" />
            <div className="h-3.5 w-[55%] rounded bg-zinc-700/30 animate-pulse" />
          </div>
        </div>
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel f-fade-in`} style={{ animationDelay: '0.05s' }}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary/70 uppercase tracking-widest">💬 Comments</span>
            <span className="text-[10px] text-mutedForeground/60">Loading…</span>
          </div>
          <div className="p-3 space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-md border border-zinc-700/40 bg-zinc-900/50 p-2.5 space-y-2">
                <div className="h-3 w-28 rounded bg-zinc-700/55 animate-pulse" />
                <div className="h-3 w-full rounded bg-zinc-700/40 animate-pulse" />
                <div className="h-3 w-2/3 rounded bg-zinc-700/30 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!topic) return null;

  const commentCount = comments.length;
  const topicTitlePlain = (topic.title || '').replace(/<[^>]+>/g, '').trim();
  const isPinnedGuideTopic = /^(how\s*to|faqs?|update\s*log)$/i.test(topicTitlePlain);
  const isLegacyFaqHtml =
    topic.content &&
    (topic.content.includes('<details') ||
      topic.content.includes('class="faq-box"') ||
      topic.content.includes('class=\'faq-box\''));
  // Convert Markdown **bold** to <strong> and strip embedded FAQ styles so noir theme applies
  let topicContentRaw = topic.content || '—';
  if (isLegacyFaqHtml || isPinnedGuideTopic) {
    topicContentRaw = topicContentRaw.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    topicContentRaw = topicContentRaw.replace(/<style>[\s\S]*?<\/style>/gi, '');
    topicContentRaw = topicContentRaw.replace(/<div\s+style="[^"]*"[^>]*>/, '<div class="forum-faq-outer">');
  }
  const topicContent = topicContentRaw;
  const forumParseOpts = { censorProfanity: user?.censor_profanity };

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root f-fade-in ${topic.is_locked ? '' : 'pb-36 sm:pb-0'}`} data-testid="forum-topic-page">
      <style>{FORUM_CONTENT_STYLES}</style>
      <AutoRefreshNote seconds={60}>Topic and comments refresh every 60 seconds in the background.</AutoRefreshNote>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to={topic?.category === 'designer' ? '/forum?tab=designer' : topic?.category === 'entertainer' ? '/forum?tab=entertainer' : topic?.category === 'crew_oc' ? '/forum?tab=crew_oc' : topic?.category === 'game_ideas' ? '/forum?tab=game_ideas' : '/forum'}
            className="text-mutedForeground hover:text-primary transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              {topic.is_important && <AlertCircle size={14} className="text-amber-400" />}
              {topic.is_sticky && !topic.is_important && <Pin size={14} className="text-amber-400" />}
              <h1
                className="text-lg sm:text-xl font-heading font-bold prof-banner-content"
                style={
                  /^update\s*log$/i.test(String(topic.title || '').trim())
                    ? { color: 'var(--noir-primary)' }
                    : topic.title_color
                      ? { color: topic.title_color }
                      : { color: 'var(--noir-primary)' }
                }
                dangerouslySetInnerHTML={{ __html: parseForumContent(topic.title || '', { censorProfanity: user?.censor_profanity }) }}
              />
              {topic.is_locked && <Lock size={14} className="text-red-400" />}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] text-mutedForeground">
              {topic.redeem_code ? (
                <span className="inline-flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                  <span className="font-heading font-semibold text-mutedForeground uppercase tracking-wide" title="Posted automatically by the game">System</span>
                  {topic.redeem_max_uses != null && topic.redeem_uses_remaining != null && (
                    <span className="font-heading font-semibold text-amber-400/95 tabular-nums normal-case" title="Global redemption limit for this code">
                      {topic.redeem_uses_remaining} of {topic.redeem_max_uses} uses left
                    </span>
                  )}
                </span>
              ) : (
                <Link to={`/profile/${encodeURIComponent(topic.author_username || '?')}`} className="text-foreground font-bold hover:text-primary hover:underline" style={topic.author_online_color ? { color: topic.author_online_color } : undefined}>{topic.author_username || '?'}</Link>
              )}
              <span className="flex items-center gap-0.5"><Clock size={10} /> {getTimeAgo(topic.created_at)}</span>
              <span className="flex items-center gap-0.5"><Eye size={10} /> {topic.views ?? 0}</span>
              <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {commentCount}</span>
            </div>
          </div>
        </div>
      </div>

      {topic?.category === 'game_ideas' && topic?.game_idea_season_id && (
        <div className="px-3 py-2 rounded-md border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-200/90">
          <span className="font-heading font-bold text-amber-400 uppercase tracking-wide mr-2">Game Ideas</span>
          Post your idea below, then register your post.{' '}
          <Link to="/game/game-ideas" className="text-primary font-heading font-bold hover:underline">Open voting board →</Link>
        </div>
      )}

      {topic?.category === 'designer' && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Designer Auction</span>
            {designerAuctionLoading && <span className="text-[10px] text-mutedForeground">Loading…</span>}
          </div>
          <div className="p-3 space-y-2">
            {!designerAuction ? (
              <p className="text-xs text-mutedForeground">No auction attached to this topic.</p>
            ) : (
              <>
                <div className="text-xs text-mutedForeground">
                  Status: <span className="text-foreground">{designerAuction.status}</span> · Currency: <span className="text-foreground">{designerAuction.currency}</span>
                </div>
                <div className="text-xs text-mutedForeground">
                  Highest bid: <span className="text-primary font-bold">{(designerAuction.current_bid || 0).toLocaleString()}</span> (start {(designerAuction.starting_bid || 0).toLocaleString()})
                </div>
                <div className="text-xs text-mutedForeground">
                  End: {getAuctionEndStatusLabel(designerAuction)}
                </div>
                {designerAuction.image_url && (
                  <a href={designerAuction.image_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline break-all">Open design image</a>
                )}
                {designerAuction.delivered_image_url && (
                  <a href={designerAuction.delivered_image_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 underline break-all">Open delivered image</a>
                )}

                {designerAuction.status === 'open' && user?.id !== designerAuction.designer_user_id && (
                  <form onSubmit={handleDesignerBid} className="flex gap-2">
                    <FormattedNumberInput
                      value={designerBidAmount}
                      onChange={setDesignerBidAmount}
                      placeholder={`Bid in ${designerAuction.currency}`}
                      className="flex-1 px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground"
                    />
                    <button type="submit" disabled={designerBidSubmitting} className="px-3 py-2 rounded border border-primary/40 bg-primary/20 text-primary text-xs font-heading font-bold">
                      {designerBidSubmitting ? '...' : 'Bid'}
                    </button>
                  </form>
                )}

                {user?.id === designerAuction.designer_user_id && ['in_escrow', 'delivered', 'disputed'].includes(designerAuction.status) && (
                  <form onSubmit={handleDesignerDeliver} className="flex gap-2">
                    <input
                      type="url"
                      value={designerDeliverUrl}
                      onChange={(e) => setDesignerDeliverUrl(e.target.value)}
                      placeholder="Delivered image URL"
                      className="flex-1 px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground"
                    />
                    <button type="submit" disabled={designerDeliverSubmitting} className="px-3 py-2 rounded border border-emerald-500/40 bg-emerald-500/20 text-emerald-400 text-xs font-heading font-bold">
                      {designerDeliverSubmitting ? '...' : 'Deliver'}
                    </button>
                  </form>
                )}

                {(user?.id === designerAuction.designer_user_id || user?.id === designerAuction.winner_id) && ['in_escrow', 'delivered', 'disputed'].includes(designerAuction.status) && (
                  <div className="flex gap-2">
                    {user?.id === designerAuction.designer_user_id && (
                      <button type="button" onClick={() => handleDesignerConfirm('designer')} disabled={designerConfirmSubmitting} className="px-3 py-1.5 rounded border border-primary/40 bg-primary/20 text-primary text-xs font-heading font-bold">
                        Confirm (designer)
                      </button>
                    )}
                    {user?.id === designerAuction.winner_id && (
                      <button type="button" onClick={() => handleDesignerConfirm('winner')} disabled={designerConfirmSubmitting} className="px-3 py-1.5 rounded border border-primary/40 bg-primary/20 text-primary text-xs font-heading font-bold">
                        Confirm (winner)
                      </button>
                    )}
                  </div>
                )}

                {(user?.id === designerAuction.designer_user_id || user?.id === designerAuction.winner_id) && ['in_escrow', 'delivered'].includes(designerAuction.status) && (
                  <form onSubmit={handleDesignerDispute} className="space-y-2">
                    <input
                      type="text"
                      value={designerDisputeReason}
                      onChange={(e) => setDesignerDisputeReason(e.target.value)}
                      placeholder="Report dispute reason (optional)"
                      className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground"
                    />
                    <button type="submit" disabled={designerDisputeSubmitting} className="px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/20 text-amber-300 text-xs font-heading font-bold">
                      {designerDisputeSubmitting ? '...' : 'Report dispute'}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Staff controls: Admin/Mod = sticky, important, lock; HDO = lock only; Admin/Mod/HDO = delete topic */}
      {(isAdmin || isModerator || isHdo) && (
        <div className="flex flex-wrap items-center gap-2">
          {(isAdmin || isModerator || isHdo) && <span className="text-[10px] text-amber-400 font-heading uppercase mr-0.5">Staff:</span>}
          {(isAdmin || isModerator) && (
            <>
              <button
                onClick={() => updateTopicFlags({ is_sticky: !topic.is_sticky })}
                disabled={adminBusy}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-8 rounded text-[10px] font-heading border transition-all touch-manipulation ${
                  topic.is_sticky ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-zinc-800/50 border-zinc-700/50 text-mutedForeground hover:border-amber-500/50'
                }`}
              >
                <Pin size={10} /> {topic.is_sticky ? 'Unsticky' : 'Sticky'}
              </button>
              <button
                onClick={() => updateTopicFlags({ is_important: !topic.is_important })}
                disabled={adminBusy}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-8 rounded text-[10px] font-heading border transition-all touch-manipulation ${
                  topic.is_important ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-zinc-800/50 border-zinc-700/50 text-mutedForeground hover:border-amber-500/50'
                }`}
              >
                <AlertCircle size={10} /> {topic.is_important ? 'Unmark' : 'Important'}
              </button>
              <button
                type="button"
                onClick={() => setShowStaffTitleColors((v) => !v)}
                disabled={adminBusy}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-8 rounded text-[10px] font-heading border transition-all touch-manipulation ${
                  topic.title_color || showStaffTitleColors
                    ? 'bg-primary/20 border-primary/50 text-primary'
                    : 'bg-zinc-800/50 border-zinc-700/50 text-mutedForeground hover:border-primary/50'
                }`}
                title="Title colour (list + topic header)"
              >
                <Palette size={10} />
                Colour
                {topic.title_color ? (
                  <span className="w-2.5 h-2.5 rounded-full border border-white/20" style={{ backgroundColor: topic.title_color }} />
                ) : null}
              </button>
            </>
          )}
          {(isAdmin || isModerator || isHdo) && (
            <button
              onClick={() => updateTopicFlags({ is_locked: !topic.is_locked })}
              disabled={adminBusy}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-8 rounded text-[10px] font-heading border transition-all touch-manipulation ${
                topic.is_locked ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-zinc-800/50 border-zinc-700/50 text-mutedForeground hover:border-red-500/50'
              }`}
            >
              <Lock size={10} /> {topic.is_locked ? 'Unlock' : 'Lock'}
            </button>
          )}
          {(isAdmin || isModerator || isHdo) && (
            <button
              onClick={deleteTopic}
              disabled={adminBusy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-8 rounded text-[10px] font-heading border border-red-500/50 text-red-400 hover:bg-red-500/20 transition-all touch-manipulation"
            >
              <Trash2 size={10} /> Delete
            </button>
          )}
        </div>
      )}

      {(isAdmin || isModerator) && showStaffTitleColors && topic && (
        <div className="flex flex-wrap gap-1 p-2 mt-1.5 bg-zinc-900/50 border border-zinc-700/50 rounded">
          {TITLE_COLORS.map((c) => (
            <button
              key={c.value || 'default'}
              type="button"
              disabled={adminBusy}
              onClick={() => {
                updateTopicFlags({ title_color: c.value || '' });
                setShowStaffTitleColors(false);
              }}
              className={`px-2 py-1 text-[10px] font-heading rounded border transition-all ${
                (topic.title_color || '') === (c.value || '')
                  ? 'border-primary bg-primary/20 text-primary'
                  : 'border-zinc-700/50 hover:border-primary/50'
              }`}
              style={c.value ? { color: c.value } : {}}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Author or staff: Edit topic (staff can edit redeem-code / system topics) */}
      {canEditTopic && (
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <button
            type="button"
            onClick={openEditTopic}
            className="flex items-center gap-1 px-2.5 py-1.5 min-h-8 rounded text-[10px] font-heading border border-primary/40 text-primary hover:bg-primary/10 transition-all touch-manipulation"
          >
            <Pencil size={10} /> Edit topic
          </button>
        </div>
      )}

      {/* Edit Topic Modal */}
      {showEditTopic && topic && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className={`${styles.panel} w-full sm:max-w-md max-h-[90dvh] flex flex-col rounded-t-lg sm:rounded-lg overflow-hidden border border-primary/20 shadow-2xl pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:pb-0`}>
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 shrink-0">
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Edit topic</h2>
            </div>
            <form onSubmit={saveEditTopic} className="p-3 space-y-3 overflow-y-auto overscroll-contain min-h-0">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Title…"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    style={editTitleColor ? { color: editTitleColor } : {}}
                    className="flex-1 px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 placeholder:italic focus:border-primary/50 focus:outline-none"
                  />
                  {(isAdmin || isModerator) && (
                    <button
                      type="button"
                      onClick={() => setShowEditTitleColors(!showEditTitleColors)}
                      className="px-2 py-1 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10 flex items-center gap-1"
                      title="Title Color (Staff Only)"
                    >
                      <Palette size={14} />
                      {editTitleColor && <span className="w-3 h-3 rounded-full" style={{ backgroundColor: editTitleColor }} />}
                    </button>
                  )}
                </div>
                {(isAdmin || isModerator) && showEditTitleColors && (
                  <div className="flex flex-wrap gap-1 p-2 bg-zinc-900/50 border border-zinc-700/50 rounded">
                    {TITLE_COLORS.map((c) => (
                      <button
                        key={c.value || 'default'}
                        type="button"
                        onClick={() => { setEditTitleColor(c.value); setShowEditTitleColors(false); }}
                        className={`px-2 py-1 text-[10px] font-heading rounded border transition-all ${
                          editTitleColor === c.value 
                            ? 'border-primary bg-primary/20 text-primary' 
                            : 'border-zinc-700/50 hover:border-primary/50'
                        }`}
                        style={c.value ? { color: c.value } : {}}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {editShowGifPicker && (
                <div className="rounded border border-zinc-700/50 overflow-hidden">
                  <GifPicker
                    onSelect={(url) => { if (url) setEditGifUrl(url); setEditShowGifPicker(false); }}
                    onClose={() => setEditShowGifPicker(false)}
                  />
                </div>
              )}
              {editGifUrl && (
                <div className="flex items-center gap-2">
                  <img src={editGifUrl} alt="GIF" className="h-16 w-16 object-cover rounded" />
                  <button type="button" onClick={() => setEditGifUrl('')} className="text-[10px] text-red-400 font-heading">Remove GIF</button>
                </div>
              )}
              <textarea
                placeholder="Write your post…"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 placeholder:italic focus:border-primary/50 focus:outline-none resize-y"
              />
              <p className="text-[9px] text-zinc-500 font-heading -mt-1">
                Tips: [b]bold[/b] · [i]italic[/i] · [img]url[/img] · [gif]url[/gif]
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditShowGifPicker((v) => !v)} className="px-2.5 py-1.5 min-h-8 rounded border border-primary/30 text-primary text-[10px] font-heading hover:bg-primary/10 touch-manipulation">GIF</button>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowEditTopic(false)} className="flex-1 px-4 py-2 bg-zinc-700/50 text-foreground text-xs font-heading font-bold uppercase rounded border border-zinc-600/50 hover:bg-zinc-600/50">
                  Cancel
                </button>
                <button type="submit" disabled={editSubmitting} className="flex-1 px-4 py-2 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50">
                  {editSubmitting ? '...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
          <button type="button" onClick={() => setShowEditTopic(false)} className="absolute inset-0 -z-10" aria-label="Close" />
        </div>
      )}

      {/* Topic Content */}
      <div id={topic?.id ? `forum-topic-${topic.id}` : undefined} className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">📝 Original Post</span>
          {topic.redeem_code && topic.redeem_max_uses != null && topic.redeem_uses_remaining != null && (
            <span className="text-[10px] font-heading font-semibold text-amber-400/95 tabular-nums" title="Global redemption limit for this code">
              {topic.redeem_uses_remaining} of {topic.redeem_max_uses} uses left
            </span>
          )}
        </div>
        <div className="p-3">
          {topic.gif_url && (
            <div className="mb-3">
              <img src={topic.gif_url} alt="GIF" className="rounded max-h-64 object-contain forum-content-gif" loading="lazy" />
            </div>
          )}
          {isLegacyFaqHtml ? (
            <>
              <style>{FORUM_FAQ_STYLES}</style>
              <div
                className="forum-faq-content text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: topicContent }}
              />
            </>
          ) : isPinnedGuideTopic ? (
            <>
              <style>{FORUM_FAQ_STYLES}</style>
              <div
                className="forum-faq-content text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: parseForumContent(topicContent, forumParseOpts) }}
              />
            </>
          ) : (
            <div
              className="forum-content text-sm text-foreground leading-relaxed break-words"
              dangerouslySetInnerHTML={{ __html: parseForumContent(topicContent, forumParseOpts) }}
            />
          )}
          <ForumEmojiReactionBar
            topicId={topicId}
            commentId={null}
            reactions={topic.emoji_reactions}
            myEmoji={topic.my_emoji_reaction}
            locked={!!topic.is_locked}
            onApplied={(data) =>
              setTopic((t) =>
                t
                  ? {
                      ...t,
                      emoji_reactions: data.emoji_reactions,
                      my_emoji_reaction: data.my_emoji_reaction,
                    }
                  : t,
              )
            }
            onShowWho={(emoji) => openEmojiReactionUsers(null, emoji)}
          />
        </div>
      </div>

      {/* Crew OC: Apply to join */}
      {topic.crew_oc_family_id && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center gap-2">
            <UserPlus size={14} className="text-primary" />
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Apply to Crew OC</span>
          </div>
          <div className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <FamilyEmblem
                emblemPresetId={topic.crew_oc_family_emblem_preset_id}
                avatarUrl={topic.crew_oc_family_emblem_avatar_url}
                size={28}
              />
              <p className="text-xs text-mutedForeground">
                Join {topic.crew_oc_family_name} [{topic.crew_oc_family_tag}] for their next Crew OC run.
              </p>
            </div>
            <p className="text-xs text-mutedForeground mb-2">
              {topic.crew_oc_join_fee > 0
                ? ` Pay ${(topic.crew_oc_join_fee || 0).toLocaleString()} cash to join instantly.`
                : ' Free — your application will need approval.'}
            </p>
            {topic.crew_oc_my_application ? (
              (() => {
                const status = (topic.crew_oc_my_application.status || '').toLowerCase();
                const canReapply = status === 'kicked' || status === 'rejected';
                return (
                  <div className="space-y-2">
                    <p className="text-xs font-heading font-bold text-primary">
                      You applied: {topic.crew_oc_my_application.status}
                    </p>
                    {canReapply && (
                      <button
                        type="button"
                        onClick={applyCrewOC}
                        disabled={crewOCApplyLoading}
                        className="w-full py-2 font-heading font-bold uppercase tracking-wider text-xs rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
                      >
                        {crewOCApplyLoading ? '...' : topic.crew_oc_join_fee > 0 ? `Reapply — pay $${(topic.crew_oc_join_fee || 0).toLocaleString()}` : 'Reapply (free)'}
                      </button>
                    )}
                  </div>
                );
              })()
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
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🎲 Create Game</span>
          </div>
          <div className="p-3">
            <p className="text-xs text-mutedForeground mb-3">Link a dice or gbox game to this topic. Manual dice: winner gets the full rewards below. Manual gbox: reward cash and points are totals split randomly among joiners. You can also start a game from Entertainer Forum (New Game) without a topic.</p>
            {user?.is_entertainer && (
              <div className="rounded-lg border border-violet-500/35 bg-violet-950/25 px-2.5 py-2 space-y-1 mb-3">
                <div className="flex items-center gap-2 text-[9px] font-heading font-bold text-violet-200 uppercase tracking-wider">
                  <Mic2 size={13} className="text-violet-400 shrink-0" />
                  Entertainer fund
                </div>
                <p className="text-[9px] text-zinc-400 font-heading leading-snug">
                  Funding comes from your <strong className="text-zinc-200">entertainer fund</strong> (not main wallet): cash for pot + reward cash; fund points for reward points.
                </p>
                <div className="flex flex-wrap gap-x-3 text-[10px] font-heading text-zinc-300">
                  <span>Cash <strong className="text-emerald-400">${Math.trunc(Number(user?.entertainer_fund_cash ?? 0)).toLocaleString()}</strong></span>
                  <span>Fund pts <strong className="text-sky-400/90">{Math.trunc(Number(user?.entertainer_fund_points ?? 0)).toLocaleString()}</strong></span>
                </div>
              </div>
            )}
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
                {user?.is_entertainer && createGameType === 'gbox' && (
                  <p className="text-[10px] text-violet-300/90 font-heading mt-1">
                    Entertainer fund: max {ENTERTAINER_GBOX_MAX_POINTS.toLocaleString()} reward points total per Gbox.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Max players (1–10)</label>
                <input type="number" min={1} max={10} value={createGameMaxPlayers} onChange={(e) => setCreateGameMaxPlayers(e.target.value)} className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground" />
              </div>
              <div>
                <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Pot ($ you put in)</label>
                <FormattedNumberInput value={createGamePot} onChange={setCreateGamePot} placeholder="0" className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Entry fee ($ per player to join)</label>
                <FormattedNumberInput value={createGameJoinFee} onChange={setCreateGameJoinFee} placeholder="0" className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={createGameManualRoll} onChange={(e) => setCreateGameManualRoll(e.target.checked)} className="w-4 h-4 accent-primary" />
                <span className="text-xs font-heading text-foreground">Manual roll — I&apos;ll roll when ready (no auto-roll)</span>
              </label>
              <div>
                <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Reward cash ($)</label>
                <FormattedNumberInput value={createGameRewardMoney} onChange={setCreateGameRewardMoney} placeholder="0" className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Reward points</label>
                <FormattedNumberInput value={createGameRewardPoints} onChange={setCreateGameRewardPoints} placeholder="0" className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none" />
              </div>
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
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">💬 Comments</span>
          <span className="text-[10px] text-mutedForeground">{commentCount} {commentCount === 1 ? 'reply' : 'replies'}</span>
        </div>
        
        {comments.length === 0 ? (
          <div className="p-4 text-center text-xs text-mutedForeground">No comments yet. Be the first!</div>
        ) : (
          <div className="space-y-1.5">
            {comments.map((c, idx) => {
              const isGameIdeasLog = c.game_ideas_log === true;
              return (
              <div
                key={c.id}
                id={c.id ? `forum-comment-${c.id}` : undefined}
                className={`${styles.panel} border rounded-md p-3 sm:p-3.5 ${
                  isGameIdeasLog
                    ? 'border-amber-500/25 bg-amber-950/15'
                    : 'border-zinc-800/60 bg-zinc-900/70'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-[10px] text-mutedForeground">
                      {isGameIdeasLog ? (
                        <span className="text-amber-400/90 font-bold font-heading">System</span>
                      ) : (
                      <Link to={`/profile/${encodeURIComponent(c.author_username)}`} className="text-foreground font-bold hover:text-primary hover:underline" style={c.author_online_color ? { color: c.author_online_color } : undefined}>
                        {c.author_username}
                      </Link>
                      )}
                      <span className="text-zinc-600">#{idx + 1}</span>
                    </div>
                    <div className="mt-0.5 text-[9px] text-zinc-500 font-heading">
                      {getTimeAgo(c.created_at)}
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-2">
                    {c.likes > 0 && (
                      <button
                        type="button"
                        title="Who liked this"
                        onClick={() => openReactionUsers(c.id, 'like')}
                        className="text-[10px] text-emerald-400 flex items-center gap-0.5 whitespace-nowrap hover:underline hover:text-emerald-300"
                      >
                        <ThumbsUp size={10} /> {c.likes}
                      </button>
                    )}
                    {(c.dislikes || 0) > 0 && (
                      <button
                        type="button"
                        title="Who disliked this"
                        onClick={() => openReactionUsers(c.id, 'dislike')}
                        className="text-[10px] text-red-400 flex items-center gap-0.5 whitespace-nowrap hover:underline hover:text-red-300"
                      >
                        <ThumbsDown size={10} /> {c.dislikes}
                      </button>
                    )}
                  </div>
                </div>

                {/* Quoted parent when this is a reply */}
                {c.reply_to_comment_id && (() => {
                  const parent = comments.find((p) => p.id === c.reply_to_comment_id);
                  if (!parent) return null;
                  const parentIndex = comments.findIndex((p) => p.id === parent.id);
                  const parentIsLog = parent.game_ideas_log === true;
                  return (
                    <div className="mt-2 mb-2 px-2.5 py-2 rounded-md bg-zinc-900/70 border border-zinc-800/80">
                      <div className="flex items-center gap-2 text-[9px] text-zinc-500 font-heading mb-1">
                        <span className="uppercase tracking-wider">Replying to</span>
                        {parentIsLog ? (
                          <span className="text-amber-400/90 font-bold">System</span>
                        ) : (
                        <Link
                          to={`/profile/${encodeURIComponent(parent.author_username)}`}
                          className="text-foreground font-bold hover:text-primary hover:underline"
                        >
                          {parent.author_username}
                        </Link>
                        )}
                        {parentIndex >= 0 && (
                          <span className="text-zinc-600">#{parentIndex + 1}</span>
                        )}
                      </div>
                      {parent.content && parent.content !== '(GIF)' && (
                        <div
                          className="text-[10px] text-zinc-400 font-normal forum-content line-clamp-3"
                          dangerouslySetInnerHTML={{ __html: parseForumContent(parent.content, { censorProfanity: user?.censor_profanity }) }}
                        />
                      )}
                    </div>
                  );
                })()}
                
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
                    dangerouslySetInnerHTML={{ __html: parseForumContent(c.content, { censorProfanity: user?.censor_profanity }) }}
                  />
                )}
                <ForumEmojiReactionBar
                  topicId={topicId}
                  commentId={c.id}
                  reactions={c.emoji_reactions}
                  myEmoji={c.my_emoji_reaction}
                  locked={!!topic?.is_locked}
                  onApplied={(data) =>
                    setComments((prev) =>
                      prev.map((x) =>
                        x.id === c.id
                          ? { ...x, emoji_reactions: data.emoji_reactions, my_emoji_reaction: data.my_emoji_reaction }
                          : x,
                      ),
                    )
                  }
                  onShowWho={(emoji) => openEmojiReactionUsers(c.id, emoji)}
                />

                {/* Like + Dislike + Reply (hidden for automated Game Ideas season logs) */}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {!isGameIdeasLog && (
                  <>
                  <div
                    className={`inline-flex items-stretch rounded-md overflow-hidden border text-[10px] font-heading transition-all ${
                      c.liked ? 'border-emerald-500/40 bg-emerald-500/15' : 'border-zinc-700/50 bg-zinc-900/40'
                    }`}
                  >
                    <button
                      type="button"
                      title="Who liked this"
                      onClick={() => openReactionUsers(c.id, 'like')}
                      disabled={likingId === c.id || dislikingId === c.id}
                      className={`px-2 py-1.5 min-h-9 sm:min-h-8 shrink-0 transition-colors touch-manipulation ${
                        c.liked ? 'text-emerald-400 hover:bg-emerald-500/25' : 'text-mutedForeground hover:text-emerald-400 hover:bg-emerald-500/10'
                      } disabled:opacity-50`}
                    >
                      <ThumbsUp size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => likeComment(c.id)}
                      disabled={likingId === c.id || dislikingId === c.id}
                      className={`px-2.5 py-1.5 min-h-9 sm:min-h-8 border-l border-zinc-700/50 transition-colors touch-manipulation ${
                        c.liked ? 'text-emerald-400 hover:bg-emerald-500/25' : 'text-mutedForeground hover:text-emerald-400 hover:bg-emerald-500/10'
                      } disabled:opacity-50`}
                    >
                      <span className="sm:hidden tabular-nums">{c.likes > 0 ? c.likes : (c.liked ? '·' : '')}</span>
                      <span className="hidden sm:inline">{c.likes > 0 ? c.likes : ''} {c.liked ? 'Liked' : 'Like'}</span>
                    </button>
                  </div>
                  <div
                    className={`inline-flex items-stretch rounded-md overflow-hidden border text-[10px] font-heading transition-all ${
                      c.disliked ? 'border-red-500/40 bg-red-500/15' : 'border-zinc-700/50 bg-zinc-900/40'
                    }`}
                  >
                    <button
                      type="button"
                      title="Who disliked this"
                      onClick={() => openReactionUsers(c.id, 'dislike')}
                      disabled={likingId === c.id || dislikingId === c.id}
                      className={`px-2 py-1.5 min-h-9 sm:min-h-8 shrink-0 transition-colors touch-manipulation ${
                        c.disliked ? 'text-red-400 hover:bg-red-500/25' : 'text-mutedForeground hover:text-red-400 hover:bg-red-500/10'
                      } disabled:opacity-50`}
                    >
                      <ThumbsDown size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => dislikeComment(c.id)}
                      disabled={likingId === c.id || dislikingId === c.id}
                      className={`px-2.5 py-1.5 min-h-9 sm:min-h-8 border-l border-zinc-700/50 transition-colors touch-manipulation ${
                        c.disliked ? 'text-red-400 hover:bg-red-500/25' : 'text-mutedForeground hover:text-red-400 hover:bg-red-500/10'
                      } disabled:opacity-50`}
                    >
                      <span className="sm:hidden tabular-nums">{(c.dislikes || 0) > 0 ? c.dislikes : (c.disliked ? '·' : '')}</span>
                      <span className="hidden sm:inline">{(c.dislikes || 0) > 0 ? c.dislikes : ''} {c.disliked ? 'Disliked' : 'Dislike'}</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => beginReplyToComment(c)}
                    className="inline-flex items-center gap-1.5 text-[10px] font-heading px-2.5 py-1.5 min-h-9 sm:min-h-8 rounded text-mutedForeground hover:text-primary hover:bg-primary/10 transition-all touch-manipulation"
                  >
                    <MessageCircle size={11} /> Reply
                  </button>
                  </>
                  )}
                  {/* Staff: delete comment */}
                  {(isAdmin || isModerator || isHdo) && (
                    <button
                      type="button"
                      onClick={() => deleteComment(c.id)}
                      disabled={deletingCommentId === c.id}
                      className="inline-flex items-center gap-1.5 text-[10px] font-heading px-2.5 py-1.5 min-h-8 rounded text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50 touch-manipulation"
                    >
                      <Trash2 size={11} /> {deletingCommentId === c.id ? '...' : 'Delete'}
                    </button>
                  )}
                  {/* Designer competition: submit this post as my entry (only on competition topic, only my comments) */}
                  {topicId === activeDesignerComp?.competition_topic_id && user && c.author_id === user.id && activeDesignerComp && (
                    myEntryCommentId === c.id ? (
                      <span className="text-[10px] font-heading font-bold text-emerald-400 px-2 py-1">Submitted to competition</span>
                    ) : !myEntryCommentId ? (
                      <button
                        type="button"
                        onClick={() => submitToDesignerComp(c.id)}
                        disabled={!!designerSubmittingCommentId}
                        className="flex items-center gap-1 text-[10px] font-heading px-2 py-1 rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
                      >
                        {designerSubmittingCommentId === c.id ? '...' : 'Submit as my entry'}
                      </button>
                    ) : null
                  )}
                  {!isGameIdeasLog && topic?.game_idea_season_id && activeGameIdeaSeason?.status === 'primary' && user && String(c.author_id) === String(user.id) && (
                    gameIdeaMyEntryCommentId === c.id ? (
                      <span className="text-[10px] font-heading font-bold text-emerald-400 px-2 py-1">Registered idea</span>
                    ) : !gameIdeaMyEntryCommentId ? (
                      <button
                        type="button"
                        onClick={() => submitToGameIdea(c.id)}
                        disabled={!!gameIdeaSubmittingCommentId}
                        className="flex items-center gap-1 text-[10px] font-heading px-2 py-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50"
                      >
                        {gameIdeaSubmittingCommentId === c.id ? '...' : 'Register as my idea'}
                      </button>
                    ) : null
                  )}
                </div>
              </div>
            );
            })}
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
        <div
          id="forum-composer"
          className={`${styles.panel} forum-sticky-composer rounded-md overflow-hidden border border-primary/20 mobile-panel bg-[var(--noir-content,#161618)]`}
        >
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Add Comment</span>
          </div>
          <div className="p-3 space-y-3">
            {showGifPicker && (
              <div className="mb-2 max-h-[40vh] overflow-y-auto overscroll-contain">
                <GifPicker onSelect={handleSendGif} onClose={() => setShowGifPicker(false)} />
              </div>
            )}
            {replyToComment && (
              <div className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-primary/10 border border-primary/30 text-xs text-primary">
                <span>Replying to <Link to={`/profile/${encodeURIComponent(replyToComment.author_username)}`} className="font-bold text-primary hover:underline">{replyToComment.author_username}</Link></span>
                <button type="button" onClick={() => setReplyToComment(null)} className="min-h-9 px-2 text-mutedForeground hover:text-foreground underline touch-manipulation">Cancel</button>
              </div>
            )}
            <form onSubmit={postComment} className="space-y-2">
              <textarea
                ref={commentTextareaRef}
                id="forum-add-comment"
                placeholder="Write a comment…"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 placeholder:italic focus:border-primary/50 focus:outline-none resize-y min-h-[4.5rem]"
              />
              <p className="hidden sm:block text-[9px] text-zinc-500 font-heading -mt-1">
                Tips: [b]bold[/b] · [i]italic[/i] · [img]url[/img] · @Username
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => insertCommentMarkup('[b]', '[/b]')} className="p-1.5 min-h-10 min-w-10 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10 touch-manipulation" title="Bold"><Bold size={14} /></button>
                <button type="button" onClick={() => insertCommentMarkup('[i]', '[/i]')} className="p-1.5 min-h-10 min-w-10 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10 touch-manipulation" title="Italic"><Italic size={14} /></button>
                <button type="button" onClick={() => insertCommentMarkup('[color=#eab308]', '[/color]')} className="p-1.5 min-h-10 min-w-10 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10 touch-manipulation" title="Colour"><Palette size={14} /></button>
                <button
                  type="button"
                  onClick={() => { setShowImageUrl((v) => !v); setShowGifPicker(false); }}
                  className={`p-1.5 min-h-10 min-w-10 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded border touch-manipulation ${showImageUrl ? 'border-primary/40 text-primary bg-primary/10' : 'border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10'}`}
                  title="Image"
                >
                  <Image size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => { setShowGifPicker((v) => !v); setShowImageUrl(false); }}
                  className="px-2.5 py-1.5 min-h-10 sm:min-h-8 rounded border border-primary/30 text-primary text-[10px] font-heading hover:bg-primary/10 transition-all touch-manipulation"
                >
                  GIF
                </button>
                {topic?.category !== 'designer' && (
                  <button
                    type="button"
                    onClick={() => setShowEmojis(!showEmojis)}
                    className="px-2.5 py-1.5 min-h-10 sm:min-h-8 rounded border border-zinc-700/50 text-mutedForeground text-[10px] font-heading hover:text-foreground transition-all touch-manipulation"
                  >
                    {showEmojis ? 'Hide' : '😀'}
                  </button>
                )}

                <div className="flex-1 min-w-2" />

                <button
                  type="submit"
                  disabled={posting}
                  className="flex items-center justify-center gap-1.5 px-4 min-h-[44px] sm:min-h-0 py-1.5 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all touch-manipulation"
                >
                  <Send size={12} /> {posting ? '...' : 'Post'}
                </button>
              </div>

              {showImageUrl && (
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={imageUrlDraft}
                    onChange={(e) => setImageUrlDraft(e.target.value)}
                    placeholder="https://… image URL"
                    className="flex-1 min-w-0 px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none"
                  />
                  <button type="button" onClick={insertCommentImageFromDraft} className="shrink-0 px-3 min-h-10 sm:min-h-9 rounded border border-primary/40 bg-primary/15 text-primary text-[10px] font-heading font-bold uppercase touch-manipulation">
                    Insert
                  </button>
                </div>
              )}

              {topic?.category !== 'designer' && showEmojis && (
                <div className="flex flex-wrap gap-1 pt-2 border-t border-zinc-700/30 max-h-32 overflow-y-auto overscroll-contain">
                  {CLASSIC_SMILEYS.map(({ code, img }) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setCommentText((c) => c + code)}
                      className="min-w-10 min-h-10 inline-flex items-center justify-center hover:scale-110 transition-transform touch-manipulation"
                      title={code}
                    >
                      <img
                        src={`/images/smileys/${img}.png`}
                        alt={code}
                        className="object-contain shrink-0"
                        style={{ width: FORUM_INLINE_SMILEY_PX, height: FORUM_INLINE_SMILEY_PX }}
                      />
                    </button>
                  ))}
                  {EMOJI_STRIP.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setCommentText((c) => c + em)}
                      className="min-w-10 min-h-10 inline-flex items-center justify-center text-lg hover:scale-110 transition-transform touch-manipulation"
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

      {reactionModal && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70"
          onClick={closeReactionModal}
          role="presentation"
        >
          <div
            className={`${styles.panel} border border-zinc-700/60 rounded-t-lg sm:rounded-lg max-w-sm w-full max-h-[min(70vh,420px)] overflow-hidden flex flex-col shadow-xl pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:pb-0`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="forum-reaction-modal-title"
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-700/50 bg-zinc-900/80">
              <span id="forum-reaction-modal-title" className="text-xs font-heading font-bold uppercase tracking-wider text-foreground">
                {reactionModal.kind === 'emoji' ? (
                  <span className="normal-case">
                    Reacted with {reactionModal.emoji}
                  </span>
                ) : reactionModal.kind === 'like' ? (
                  'Liked by'
                ) : (
                  'Disliked by'
                )}
              </span>
              <button
                type="button"
                onClick={closeReactionModal}
                className="p-1.5 rounded-md text-mutedForeground hover:text-foreground hover:bg-zinc-800 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-3 overflow-y-auto overflow-x-hidden">
              {reactionLoading ? (
                <p className="text-xs text-mutedForeground font-heading">Loading...</p>
              ) : reactionUsers.length === 0 ? (
                <p className="text-xs text-mutedForeground font-heading">No one yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {reactionUsers.map((u) => (
                    <li key={u.user_id}>
                      <Link
                        to={`/profile/${encodeURIComponent(u.username)}`}
                        className="text-sm text-primary hover:underline font-heading"
                        onClick={closeReactionModal}
                      >
                        {u.username}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
