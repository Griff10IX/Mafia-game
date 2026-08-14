import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { MessageSquare, Lock, Pin, AlertCircle, Plus, ChevronRight, Eye, MessageCircle, Dice5, Package, Users, Bold, Italic, Image, Palette, Puzzle, Mic2 } from 'lucide-react';
import api from '../../utils/api';
import { confirmEntertainerGameCreatorDeduction, ENTERTAINER_GBOX_MAX_POINTS } from '../../utils/entertainerGameCreateConfirm';
import { readForumSpecialTabsWarm } from '../../utils/forumSpecialTabsWarm';
import { prefetchForumTopic } from '../../utils/forumTopicWarm';
import { toast } from 'sonner';
import GifPicker from '../../components/GifPicker';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import { parseForumContent, insertAtCursor, FORUM_INLINE_SMILEY_PX } from '../../utils/forumContent';
import styles from '../../styles/noir.module.css';
import FamilyEmblem from '../../components/FamilyEmblem';
import { useEntJoinTurnstile } from '../../hooks/useEntJoinTurnstile';

/** Show "Update Log: N" when there are unread dated entries. */
function forumTopicTitleForDisplay(topic) {
  const base = topic?.title || '';
  const n = Number(topic?.update_log_unread) || 0;
  if (n > 0 && /^update\s*log$/i.test(String(base).trim())) {
    return `Update Log: ${n}`;
  }
  return base;
}

/** Unread count for Update Log topic (0 if not applicable). */
function forumUpdateLogUnreadCount(topic) {
  const n = Number(topic?.update_log_unread) || 0;
  if (n > 0 && /^update\s*log$/i.test(String(topic?.title || '').trim())) return n;
  return 0;
}

function isUpdateLogTopic(topic) {
  return /^update\s*log$/i.test(String(topic?.title || '').trim());
}

/** Update Log always uses theme primary (matches unread badge); other topics use title_color. */
function forumTopicTitleColorStyle(topic) {
  if (isUpdateLogTopic(topic)) return { color: 'var(--noir-primary)' };
  if (topic?.title_color) return { color: topic.title_color };
  return undefined;
}

function forumTopicAccentColor(topic) {
  if (isUpdateLogTopic(topic)) return 'var(--noir-primary)';
  return topic?.title_color || 'var(--noir-primary)';
}

const FORUM_STYLES = `
  @keyframes f-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .f-fade-in { animation: f-fade-in 0.4s ease-out both; }
  .f-card { transition: all 0.3s ease; }
  .f-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .f-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .f-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  @keyframes hm-draw { from { stroke-dashoffset: 200; } to { stroke-dashoffset: 0; } }
  .hm-part { stroke-dasharray: 200; stroke-dashoffset: 200; animation: hm-draw 0.45s ease-out forwards; }
  @keyframes hm-appear { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: scale(1); } }
  .hm-head { animation: hm-appear 0.35s ease-out forwards; }
  .hm-letter-box { transition: background 0.2s, color 0.2s; }
  .hm-key { transition: background 0.15s, opacity 0.15s; }
  @keyframes hm-correct { 0%,100% { transform: scale(1); } 50% { transform: scale(1.25); } }
  .hm-letter-correct { animation: hm-correct 0.3s ease-out; }
  @keyframes hm-clue-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  .hm-clue-in { animation: hm-clue-in 0.4s ease-out both; }
  .hm-box { border-radius: 10px; border: 1px solid rgba(82,82,91,0.45); background: rgba(24,24,27,0.6); }
  .hm-kb-grid { display: grid; grid-template-columns: repeat(13, minmax(0, 1fr)); gap: 4px; }
  @media (max-width: 768px) {
    .hm-kb-grid { grid-template-columns: repeat(9, minmax(0, 1fr)); gap: 5px; }
  }
  @media (max-width: 767px) {
    body[data-mobile-layout="pocket_deck"] .forum-tabs-sticky {
      top: var(--pocket-hud-top, 2.75rem);
    }
  }
`;

// ─── Hangman game panel ──────────────────────────────────────────────────────
const HangmanSVG = ({ wrongCount }) => {
  const stroke = 'currentColor';
  const sw = 3;
  const sw2 = 2.5;
  return (
    <svg viewBox="0 0 120 130" width="100%" height="100%" className="text-zinc-400" aria-label="Hangman drawing">
      {/* Gallows — always visible */}
      <line x1="10" y1="125" x2="110" y2="125" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <line x1="30" y1="125" x2="30" y2="10"  stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <line x1="30" y1="10"  x2="70" y2="10"  stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <line x1="70" y1="10"  x2="70" y2="28"  stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      {/* Part 1 — head */}
      {wrongCount >= 1 && (
        <circle cx="70" cy="38" r="10" stroke={stroke} strokeWidth={sw2} fill="none" className="hm-head" />
      )}
      {/* Part 2 — body */}
      {wrongCount >= 2 && (
        <line x1="70" y1="48" x2="70" y2="85" stroke={stroke} strokeWidth={sw2} strokeLinecap="round" className="hm-part" />
      )}
      {/* Part 3 — left arm */}
      {wrongCount >= 3 && (
        <line x1="70" y1="58" x2="50" y2="72" stroke={stroke} strokeWidth={sw2} strokeLinecap="round" className="hm-part" />
      )}
      {/* Part 4 — right arm */}
      {wrongCount >= 4 && (
        <line x1="70" y1="58" x2="90" y2="72" stroke={stroke} strokeWidth={sw2} strokeLinecap="round" className="hm-part" />
      )}
      {/* Part 5 — left leg */}
      {wrongCount >= 5 && (
        <line x1="70" y1="85" x2="52" y2="108" stroke={stroke} strokeWidth={sw2} strokeLinecap="round" className="hm-part" />
      )}
      {/* Part 6 — right leg */}
      {wrongCount >= 6 && (
        <line x1="70" y1="85" x2="88" y2="108" stroke={stroke} strokeWidth={sw2} strokeLinecap="round" className="hm-part" />
      )}
    </svg>
  );
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ENTERTAINER_POLL_MS = 30000;

const HangmanPanel = ({ game, userId, onGuessLetter, guessingLetter }) => {
  const hang = game?.hangman || {};
  const revealed = hang.revealed_pattern || [];
  const guessed = hang.guessed_letters || [];
  const wrong = hang.wrong_letters || [];
  const wrongCount = hang.wrong_count || 0;
  const maxWrong = hang.max_wrong || 6;
  const solved = hang.solved || false;
  const gameOver = hang.game_over_no_solve || wrongCount >= maxWrong;
  const canGuess = !solved && !gameOver && game?.status === 'open' && typeof onGuessLetter === 'function';
  const category = hang.category || '';
  const clue = hang.clue || '';
  const showClue = wrongCount >= 2 && clue;

  return (
    <div className="px-2 sm:px-3 pb-3 pt-2 border-t border-zinc-700/30 bg-zinc-900/25">
      <div className="hm-box p-2.5 sm:p-3">
      <div className="grid grid-cols-1 md:grid-cols-[120px_minmax(0,1fr)] gap-3 items-start">
        {/* Hangman SVG */}
        <div className="w-full md:w-[120px] h-28 sm:h-32 md:h-[120px] shrink-0 flex items-center justify-center rounded bg-zinc-800/60 border border-zinc-700/40 p-1">
          <HangmanSVG wrongCount={wrongCount} />
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          {/* Category + clue */}
          <div className="flex flex-wrap items-center gap-2">
            {category && (
              <span className="text-[9px] font-heading font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-primary/15 border border-primary/30 text-primary">
                {category}
              </span>
            )}
            {wrongCount >= 2 && !clue && (
              <span className="text-[10px] text-zinc-500 italic">Hint unlocks at 2 misses…</span>
            )}
            {showClue && (
              <span className="text-[10px] text-amber-300/80 italic hm-clue-in">Hint: {clue}</span>
            )}
            {wrongCount < 2 && (
              <span className="text-[10px] text-zinc-600 italic">Hint unlocks after 2 misses</span>
            )}
          </div>

          {/* Word boxes */}
          <div className="flex flex-wrap gap-1">
            {(Array.isArray(revealed) ? revealed : Array.from(revealed)).map((ch, i) => {
              const isRevealed = ch !== '_';
              return (
                <div
                  key={i}
                  className={`w-6 h-7 sm:w-7 sm:h-8 flex items-center justify-center rounded border text-xs sm:text-sm font-heading font-bold hm-letter-box
                    ${isRevealed
                      ? 'border-primary/60 bg-primary/15 text-primary hm-letter-correct'
                      : 'border-zinc-600/50 bg-zinc-800/50 text-zinc-600'
                    }`}
                >
                  {isRevealed ? ch : '_'}
                </div>
              );
            })}
          </div>

          {/* Wrong letters */}
          {wrong.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[9px] text-zinc-500 font-heading uppercase tracking-wider">Wrong:</span>
              {wrong.map(l => (
                <span key={l} className="text-[10px] font-heading font-bold text-red-400/80 px-1">{l}</span>
              ))}
            </div>
          )}

          {/* Miss counter bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-0.5">
              {Array.from({ length: maxWrong }).map((_, i) => (
                <div key={i} className={`w-2.5 h-2.5 rounded-sm border ${i < wrongCount ? 'bg-red-500/70 border-red-500/50' : 'bg-zinc-800/50 border-zinc-700/40'}`} />
              ))}
            </div>
            <span className="text-[9px] text-zinc-500">{wrongCount}/{maxWrong} misses</span>
          </div>

          {/* Status messages */}
          {solved && (
            <p className="text-[11px] font-heading font-bold text-emerald-400">Word solved! Winner: {hang.solved_by || 'someone'}</p>
          )}
          {gameOver && !solved && (
            <p className="text-[11px] font-heading font-bold text-red-400">Hangman complete — no one solved it.</p>
          )}
        </div>
      </div>

      {/* A–Z keyboard */}
      <div className="mt-3">
      {canGuess ? (
        <div className="hm-kb-grid">
          {ALPHABET.map(l => {
            const used = guessed.includes(l);
            const isWrong = wrong.includes(l);
            const isCorrect = used && !isWrong;
            const isLoading = guessingLetter === l;
            return (
              <button
                key={l}
                type="button"
                disabled={used || !!guessingLetter}
                onClick={() => onGuessLetter(game.id, l)}
                className={`h-7 sm:h-8 text-[11px] sm:text-xs font-heading font-bold rounded border hm-key
                  ${isLoading ? 'opacity-60 animate-pulse' : ''}
                  ${isWrong ? 'bg-red-900/40 border-red-500/30 text-red-400/60 cursor-not-allowed' : ''}
                  ${isCorrect ? 'bg-primary/20 border-primary/40 text-primary/60 cursor-not-allowed' : ''}
                  ${!used ? 'bg-zinc-800/60 border-zinc-600/50 text-zinc-300 hover:bg-primary/20 hover:border-primary/50 hover:text-primary active:scale-95' : ''}
                `}
              >
                {isLoading ? '…' : l}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-[10px] text-zinc-500 text-center py-1">
          {game?.status !== 'open'
            ? 'Game is closed.'
            : solved
              ? 'Word already solved.'
              : gameOver
                ? 'Game over.'
                : 'Join the game to play.'}
        </div>
      )}
      </div>
      </div>
    </div>
  );
};

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

function getAuctionEndLabel(auction) {
  if (!auction?.end_at) return 'No end';
  const status = String(auction.status || '').toLowerCase();
  const end = new Date(auction.end_at);
  if (Number.isNaN(end.getTime())) return 'No end';
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

function getAuctionStatusChip(statusRaw) {
  const status = String(statusRaw || '').toLowerCase();
  if (status === 'open') return { label: 'Open', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' };
  if (status === 'in_escrow') return { label: 'Escrow', className: 'bg-amber-500/20 text-amber-300 border-amber-400/40' };
  if (status === 'completed') return { label: 'Completed', className: 'bg-blue-500/20 text-blue-300 border-blue-400/40' };
  if (status === 'disputed') return { label: 'Disputed', className: 'bg-red-500/20 text-red-300 border-red-400/40' };
  if (status === 'delivered') return { label: 'Delivered', className: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40' };
  return { label: 'Closed', className: 'bg-zinc-600/30 text-zinc-200 border-zinc-500/40' };
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

const CreateTopicModal = ({ isOpen, onClose, onCreated, category = 'general', canUseColors = false }) => {
  const [title, setTitle] = useState('');
  const [titleColor, setTitleColor] = useState('');
  const [showTitleColors, setShowTitleColors] = useState(false);
  const [content, setContent] = useState('');
  const [topicGifUrl, setTopicGifUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isAuction, setIsAuction] = useState(false);
  const [auctionImageUrl, setAuctionImageUrl] = useState('');
  const [auctionCurrency, setAuctionCurrency] = useState('money');
  const [auctionStartingBid, setAuctionStartingBid] = useState('');
  const [auctionEndAt, setAuctionEndAt] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showImageUrl, setShowImageUrl] = useState(false);
  const [imageUrlDraft, setImageUrlDraft] = useState('');
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

  const insertImageFromDraft = () => {
    const url = imageUrlDraft.trim();
    if (!url) {
      toast.error('Enter an image URL');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error('Image URL must start with http:// or https://');
      return;
    }
    insertTopicMarkup(`[img]${url}[/img]`);
    setImageUrlDraft('');
    setShowImageUrl(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { toast.error('Enter a title'); return; }
    setSubmitting(true);
    try {
      let createdTopicId = null;
      if (category === 'designer' && isAuction) {
        const endAtIso = auctionEndAt ? new Date(auctionEndAt).toISOString() : '';
        if (!auctionImageUrl.trim()) {
          toast.error('Auction image URL is required');
          setSubmitting(false);
          return;
        }
        if (!endAtIso) {
          toast.error('Auction end time is required');
          setSubmitting(false);
          return;
        }
        const endAt = new Date(endAtIso);
        const maxEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
        if (endAt > maxEnd) {
          toast.error('Auction max duration is 1 day');
          setSubmitting(false);
          return;
        }
        const auctionRes = await api.post('/forum/designer/auctions', {
          title: title.trim(),
          content: content.trim(),
          image_url: auctionImageUrl.trim(),
          currency: auctionCurrency,
          starting_bid: parseInt(String(auctionStartingBid).replace(/\D/g, ''), 10) || 0,
          end_at: endAtIso,
          title_color: titleColor || undefined,
        });
        toast.success('Designer auction created');
        createdTopicId = auctionRes.data?.topic_id || null;
      } else {
        const payload = { title: title.trim(), content: content.trim(), category };
        if (topicGifUrl.trim()) payload.gif_url = topicGifUrl.trim();
        if (titleColor) payload.title_color = titleColor;
        const topicRes = await api.post('/forum/topics', payload);
        toast.success('Topic created');
        createdTopicId = topicRes.data?.id || null;
      }
      setTitle('');
      setTitleColor('');
      setContent('');
      setTopicGifUrl('');
      setIsAuction(false);
      setAuctionImageUrl('');
      setAuctionCurrency('money');
      setAuctionStartingBid('');
      setAuctionEndAt('');
      onClose();
      onCreated(createdTopicId ? { topicId: createdTopicId } : undefined);
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : (Array.isArray(detail) ? detail.map((x) => x?.msg || x).join(', ') : null) || 'Failed to create topic');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
      <div className={`${styles.panel} w-full sm:max-w-md max-h-[90dvh] sm:max-h-[85vh] flex flex-col rounded-t-lg sm:rounded-lg overflow-hidden border border-primary/20 shadow-2xl`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent shrink-0" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 shrink-0">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
            {category === 'entertainer' ? '🎭 Entertainer: New Topic' : category === 'designer' ? '🎨 Designer Forum: New Topic' : category === 'game_ideas' ? '💡 Game Ideas: New Topic (admin)' : '📝 Create New Topic'}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-3 space-y-3 overflow-y-auto overscroll-contain flex-1 min-h-0">
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Title…"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={titleColor ? { color: titleColor } : {}}
                  className="flex-1 px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 placeholder:italic focus:border-primary/50 focus:outline-none"
                />
                {canUseColors && (
                  <button
                    type="button"
                    onClick={() => setShowTitleColors(!showTitleColors)}
                    className="px-2 py-1.5 min-h-10 min-w-10 sm:min-h-8 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10 flex items-center justify-center gap-1 touch-manipulation"
                    title="Title Color (Staff Only)"
                  >
                    <Palette size={14} />
                    {titleColor && <span className="w-3 h-3 rounded-full" style={{ backgroundColor: titleColor }} />}
                  </button>
                )}
              </div>
              {canUseColors && showTitleColors && (
                <div className="flex flex-wrap gap-1 p-2 bg-zinc-900/50 border border-zinc-700/50 rounded">
                  {TITLE_COLORS.map((c) => (
                    <button
                      key={c.value || 'default'}
                      type="button"
                      onClick={() => { setTitleColor(c.value); setShowTitleColors(false); }}
                      className={`px-2 py-1.5 min-h-9 text-[10px] font-heading rounded border transition-all touch-manipulation ${
                        titleColor === c.value
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
            {category === 'designer' && (
              <div className="rounded border border-zinc-700/50 p-2 space-y-2">
                <label className="inline-flex items-center gap-2 text-[11px] font-heading text-foreground">
                  <input
                    type="checkbox"
                    checked={isAuction}
                    onChange={(e) => setIsAuction(e.target.checked)}
                    className="w-3.5 h-3.5 accent-primary"
                  />
                  Create as image auction
                </label>
                {isAuction && (
                  <div className="grid grid-cols-1 gap-2">
                    <input
                      type="url"
                      placeholder="Picture URL (image-host link or external URL)"
                      value={auctionImageUrl}
                      onChange={(e) => setAuctionImageUrl(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={auctionCurrency}
                        onChange={(e) => setAuctionCurrency(e.target.value)}
                        className="px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground focus:border-primary/50 focus:outline-none"
                      >
                        <option value="money">Cash ($)</option>
                        <option value="points">Points</option>
                      </select>
                      <FormattedNumberInput
                        value={auctionStartingBid}
                        onChange={setAuctionStartingBid}
                        placeholder="Starting bid"
                        className="px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                    <input
                      type="datetime-local"
                      value={auctionEndAt}
                      onChange={(e) => setAuctionEndAt(e.target.value)}
                      className="px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground focus:border-primary/50 focus:outline-none"
                    />
                    <p className="text-[10px] text-zinc-500">Max auction length: 1 day. Winner is highest bidder at close; funds go to escrow until both confirm delivery.</p>
                  </div>
                )}
              </div>
            )}
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
              placeholder="Write your post…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 placeholder:italic focus:border-primary/50 focus:outline-none resize-y"
            />
            <p className="text-[9px] text-zinc-500 font-heading -mt-1">
              Tips: [b]bold[/b] · [i]italic[/i] · [img]url[/img] · [gif]url[/gif] · :) smileys
            </p>

            <div className="flex flex-wrap items-center gap-1">
              <button type="button" onClick={() => insertTopicMarkup('[b]', '[/b]')} className="p-1.5 min-h-10 min-w-10 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10 touch-manipulation" title="Bold"><Bold size={14} /></button>
              <button type="button" onClick={() => insertTopicMarkup('[i]', '[/i]')} className="p-1.5 min-h-10 min-w-10 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10 touch-manipulation" title="Italic"><Italic size={14} /></button>
              <button type="button" onClick={() => insertTopicMarkup('[color=#eab308]', '[/color]')} className="p-1.5 min-h-10 min-w-10 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10 touch-manipulation" title="Colour"><Palette size={14} /></button>
              <button
                type="button"
                onClick={() => { setShowImageUrl((v) => !v); setShowGifPicker(false); }}
                className={`p-1.5 min-h-10 min-w-10 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded border touch-manipulation ${showImageUrl ? 'border-primary/40 text-primary bg-primary/10' : 'border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10'}`}
                title="Image"
              >
                <Image size={14} />
              </button>
              <button type="button" onClick={() => { setShowGifPicker((v) => !v); setShowImageUrl(false); }} className="px-2.5 py-1.5 min-h-10 sm:min-h-8 rounded border border-primary/30 text-primary text-[10px] font-heading hover:bg-primary/10 touch-manipulation">GIF</button>
              <button type="button" onClick={() => setShowEmojis(!showEmojis)} className="px-2.5 py-1.5 min-h-10 sm:min-h-8 rounded border border-zinc-700/50 text-mutedForeground text-[10px] font-heading hover:text-foreground touch-manipulation">{showEmojis ? 'Hide emoji' : '😀 Emoji'}</button>
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
                <button type="button" onClick={insertImageFromDraft} className="shrink-0 px-3 min-h-10 sm:min-h-9 rounded border border-primary/40 bg-primary/15 text-primary text-[10px] font-heading font-bold uppercase touch-manipulation">
                  Insert
                </button>
              </div>
            )}
            {showEmojis && (
              <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto overscroll-contain p-1 rounded border border-zinc-700/40 bg-zinc-900/40">
                {CLASSIC_SMILEYS.map(({ code, img }) => (
                  <button key={code} type="button" onClick={() => insertEmoji(code)} className="min-w-10 min-h-10 inline-flex items-center justify-center hover:scale-110 transition-transform touch-manipulation" title={code}>
                    <img src={`/images/smileys/${img}.png`} alt={code} className="object-contain shrink-0" style={{ width: FORUM_INLINE_SMILEY_PX, height: FORUM_INLINE_SMILEY_PX }} />
                  </button>
                ))}
                {EMOJI_STRIP.map((em) => (
                  <button key={em} type="button" onClick={() => insertEmoji(em)} className="min-w-10 min-h-10 inline-flex items-center justify-center text-base hover:scale-110 transition-transform touch-manipulation">
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 p-3 border-t border-primary/20 shrink-0 bg-zinc-950/80">
            <button type="button" onClick={onClose} className="flex-1 min-h-[44px] sm:min-h-0 px-4 py-2 bg-zinc-700/50 text-foreground text-xs font-heading font-bold uppercase rounded border border-zinc-600/50 hover:bg-zinc-600/50 transition-all touch-manipulation">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="flex-1 min-h-[44px] sm:min-h-0 px-4 py-2 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all touch-manipulation">
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
  const [rewardMoney, setRewardMoney] = useState('0');
  const [rewardPoints, setRewardPoints] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const parsedMaxPlayers = Math.max(1, Math.min(10, parseInt(maxPlayers, 10) || 10));
    const parsedJoinFee = Math.max(0, parseInt(String(joinFee).replace(/\D/g, ''), 10) || 0);
    const parsedPot = Math.max(0, parseInt(String(pot).replace(/\D/g, ''), 10) || 0);
    const parsedRewardMoney = Math.max(0, parseInt(String(rewardMoney).replace(/\D/g, ''), 10) || 0);
    const parsedRewardPoints = Math.max(0, parseInt(String(rewardPoints).replace(/\D/g, ''), 10) || 0);
    const prep = confirmEntertainerGameCreatorDeduction({
      isAdmin: !!me?.is_admin,
      isEntertainer: !!me?.is_entertainer,
      manualRoll,
      parsedPot,
      rewardMoney: parsedRewardMoney,
      rewardPoints: parsedRewardPoints,
      gameType,
    });
    if (!prep.allowed) {
      if (prep.toastMessage) toast.error(prep.toastMessage);
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/forum/entertainer/games', {
        game_type: gameType,
        max_players: parsedMaxPlayers,
        join_fee: parsedJoinFee,
        pot: parsedPot,
        manual_roll: manualRoll,
        reward_money: parsedRewardMoney,
        reward_points: parsedRewardPoints,
      }, { timeout: 45000 });
      toast.success('Game created');
      onClose();
      onCreated();
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      const isExplicitReject = (status === 400 || status === 401 || status === 403 || status === 404) && typeof detail === 'string' && detail.length > 0;
      if ((typeof status === 'number' && status >= 200 && status < 300) || !isExplicitReject) {
        toast.success('Game created');
        onClose();
        onCreated();
      } else {
        toast.error(detail || 'Failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-game-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`${styles.panel} w-full max-w-sm max-h-[min(82dvh,calc(100dvh-5.25rem))] sm:max-h-[min(90dvh,720px)] rounded-lg overflow-hidden border border-primary/20 shadow-2xl flex flex-col min-h-0`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-0.5 shrink-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="shrink-0 px-3 py-2 sm:py-2.5 bg-primary/8 border-b border-primary/20">
          <h2 id="create-game-modal-title" className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🎲 Create Game</h2>
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y px-3 py-2 space-y-2 sm:space-y-3 sm:py-3 pb-4 [-webkit-overflow-scrolling:touch]"
        >
          {me?.is_entertainer && (
            <div className="rounded-lg border border-violet-500/35 bg-violet-950/25 px-2 py-1.5 sm:px-2.5 sm:py-2 space-y-1">
              <div className="flex items-center gap-2 text-[9px] font-heading font-bold text-violet-200 uppercase tracking-wider">
                <Mic2 size={13} className="text-violet-400 shrink-0" />
                Entertainer fund
              </div>
              <p className="text-[9px] text-zinc-400 font-heading leading-snug">
                Pot + rewards are debited from your <strong className="text-zinc-200">entertainer fund</strong> (cash + fund points), not your main wallet.
              </p>
              <div className="flex flex-wrap gap-x-3 text-[10px] font-heading text-zinc-300">
                <span>Cash <strong className="text-emerald-400">${Math.trunc(Number(me?.entertainer_fund_cash ?? 0)).toLocaleString()}</strong></span>
                <span>Fund pts <strong className="text-sky-400/90">{Math.trunc(Number(me?.entertainer_fund_points ?? 0)).toLocaleString()}</strong></span>
              </div>
            </div>
          )}
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Type</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setGameType('dice')} className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 sm:py-2 rounded border text-xs font-heading ${gameType === 'dice' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-600/50 text-mutedForeground'}`}>
                <Dice5 size={14} /> Dice
              </button>
              <button type="button" onClick={() => setGameType('gbox')} className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 sm:py-2 rounded border text-xs font-heading ${gameType === 'gbox' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-600/50 text-mutedForeground'}`}>
                <Package size={14} /> Gbox
              </button>
            </div>
            <p className="text-[9px] sm:text-[10px] text-mutedForeground mt-1 leading-snug">
              {gameType === 'gbox'
                ? `Gbox: set total reward cash and/or points — split randomly among joiners when you roll.${me?.is_entertainer ? ` Entertainer fund: max ${ENTERTAINER_GBOX_MAX_POINTS.toLocaleString()} reward points total per Gbox.` : ''}`
                : 'Dice: winner gets the full reward cash and points you set below.'}
            </p>
          </div>
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Players (1–10)</label>
            <input type="number" min={1} max={10} value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} className="w-full px-3 py-1.5 sm:py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground" />
          </div>
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Pot ($ you put in)</label>
            <input type="number" min={0} value={pot} onChange={(e) => setPot(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 sm:py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground" />
          </div>
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Entry fee ($ per player)</label>
            <input type="number" min={0} value={joinFee} onChange={(e) => setJoinFee(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 sm:py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={manualRoll} onChange={(e) => setManualRoll(e.target.checked)} className="w-4 h-4 accent-primary shrink-0" />
            <span className="text-[11px] sm:text-xs font-heading text-foreground leading-snug">Manual roll (I roll when ready)</span>
          </label>
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Reward cash ($)</label>
            <FormattedNumberInput value={rewardMoney} onChange={setRewardMoney} placeholder="0" className="w-full px-3 py-1.5 sm:py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none" />
          </div>
          <div>
            <label className="block text-[10px] text-mutedForeground uppercase font-heading mb-1">Reward points</label>
            <FormattedNumberInput value={rewardPoints} onChange={setRewardPoints} placeholder="0" className="w-full px-3 py-1.5 sm:py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none" />
          </div>
          <div className="flex gap-2 pt-1 shrink-0 pb-1">
            <button type="button" onClick={onClose} className="flex-1 min-h-[44px] sm:min-h-0 px-3 sm:px-4 py-2 bg-zinc-700/50 text-foreground text-xs font-heading uppercase rounded border border-zinc-600/50">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 min-h-[44px] sm:min-h-0 px-3 sm:px-4 py-2 bg-primary/20 text-primary text-xs font-heading uppercase rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-50">{submitting ? '...' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Topic row for desktop with hover preview. Sticky/important/lock are handled inside the topic page.
const TopicRowDesktop = ({ topic, designerCompId, myEntryTopicIds, meUsername, onSubmitToComp, submittingTopicId, censorProfanity }) => {
  const [showPreview, setShowPreview] = useState(false);
  const isMyTopic = meUsername && topic.author_username === meUsername;
  const showDesignerSubmit = designerCompId && isMyTopic;
  const alreadySubmitted = showDesignerSubmit && (myEntryTopicIds || []).includes(topic.id);
  const isSubmitting = submittingTopicId === topic.id;
  const updateLogUnread = forumUpdateLogUnreadCount(topic);
  const titleHtml = parseForumContent(
    updateLogUnread > 0 ? 'Update Log' : forumTopicTitleForDisplay(topic),
    { censorProfanity },
  );

  return (
    <div 
      className="hidden sm:block relative"
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
    >
      <div className="grid grid-cols-12 gap-2 px-3 py-2 f-row transition-colors items-center text-xs">
        <div className="flex items-center gap-1.5 min-w-0 col-span-7">
          <Link
            to={`/social/forum/${topic.id}`}
            className="flex items-center gap-1.5 min-w-0 flex-1 truncate"
            onMouseEnter={() => prefetchForumTopic(topic.id)}
            onFocus={() => prefetchForumTopic(topic.id)}
            onPointerDown={() => prefetchForumTopic(topic.id)}
          >
            {topic.category === 'crew_oc' && (
              <FamilyEmblem
                emblemPresetId={topic.crew_oc_family_emblem_preset_id}
                avatarUrl={topic.crew_oc_family_emblem_avatar_url}
                size={20}
              />
            )}
            {topic.is_important && <AlertCircle size={12} className="text-amber-400 shrink-0" />}
            {topic.is_sticky && !topic.is_important && <Pin size={12} className="text-amber-400 shrink-0" />}
            {topic.is_important && <span className="text-amber-400 font-heading shrink-0">IMPORTANT:&nbsp;</span>}
            {topic.is_sticky && !topic.is_important && <span className="text-amber-400 font-heading shrink-0">STICKY:&nbsp;</span>}
            <span
              className="truncate font-heading inline-flex items-baseline gap-1 min-w-0"
              style={forumTopicTitleColorStyle(topic)}
            >
              <span className="truncate" dangerouslySetInnerHTML={{ __html: titleHtml }} />
              {updateLogUnread > 0 && (
                <span
                  className="shrink-0 font-heading font-bold tabular-nums text-primary"
                  style={{
                    color: forumTopicAccentColor(topic),
                    textShadow: '0 0 8px rgba(var(--noir-primary-rgb), 0.53)',
                  }}
                  title={`${updateLogUnread} unread update${updateLogUnread === 1 ? '' : 's'}`}
                >
                  {updateLogUnread}
                </span>
              )}
            </span>
            {topic?.designer_auction && (
              <span className="inline-flex items-center gap-1 shrink-0">
                <span className={`text-[9px] px-1 py-0.5 rounded border ${getAuctionStatusChip(topic.designer_auction.status).className}`}>
                  {getAuctionStatusChip(topic.designer_auction.status).label}
                </span>
                <span className="text-[9px] px-1 py-0.5 rounded border border-primary/40 bg-primary/15 text-primary">
                  Auction: {(Number(topic.designer_auction.current_bid || topic.designer_auction.starting_bid || 0)).toLocaleString()} {topic.designer_auction.currency === 'points' ? 'pts' : '$'}
                  {topic.designer_auction.winner_username ? ` · Winner: ${topic.designer_auction.winner_username}` : ''}
                  {` · ${getAuctionEndLabel(topic.designer_auction)}`}
                </span>
              </span>
            )}
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
          {topic.redeem_code ? (
            <span className="truncate block text-mutedForeground font-heading font-semibold text-[10px] uppercase tracking-wide" title="Posted automatically by the game">
              System
              {topic.redeem_max_uses != null && topic.redeem_uses_remaining != null && (
                <span className="block text-amber-400/90 tabular-nums normal-case mt-0.5">
                  {topic.redeem_uses_remaining}/{topic.redeem_max_uses} left
                </span>
              )}
            </span>
          ) : (
            <Link to={`/profile/${encodeURIComponent(topic.author_username || '?')}`} className="hover:text-primary hover:underline truncate block" style={topic.author_online_color ? { color: topic.author_online_color } : undefined}>{topic.author_username || '?'}</Link>
          )}
        </div>
        <div className="col-span-1 text-right text-foreground tabular-nums">{topic.posts}</div>
        <div className="col-span-2 text-right text-mutedForeground tabular-nums">{topic.views}</div>
      </div>
      
      {/* Hover Preview */}
      {showPreview && topic.preview && (
        <div className="absolute left-4 right-4 top-full z-20 mt-1 p-3 bg-zinc-900 border border-primary/30 rounded-md shadow-xl">
          <p className="text-xs text-mutedForeground line-clamp-3">{topic.preview}</p>
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-700/30 text-[10px] text-mutedForeground">
            <span>By {topic.redeem_code ? <span className="text-mutedForeground font-heading font-semibold">System</span> : <Link to={`/profile/${encodeURIComponent(topic.author_username || '?')}`} className="hover:text-primary hover:underline" style={topic.author_online_color ? { color: topic.author_online_color } : undefined}>{topic.author_username || '?'}</Link>}</span>
            {topic.created_at && <span>{getTimeAgo(topic.created_at)}</span>}
            <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {topic.posts} replies</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Topic card for mobile. Sticky/important/lock are handled inside the topic page.
const TopicRowMobile = ({ topic, designerCompId, myEntryTopicIds, meUsername, onSubmitToComp, submittingTopicId, censorProfanity }) => {
  const navigate = useNavigate();
  const isMyTopic = meUsername && topic.author_username === meUsername;
  const showDesignerSubmit = designerCompId && isMyTopic;
  const alreadySubmitted = showDesignerSubmit && (myEntryTopicIds || []).includes(topic.id);
  const isSubmitting = submittingTopicId === topic.id;
  const updateLogUnread = forumUpdateLogUnreadCount(topic);
  const titleHtml = parseForumContent(
    updateLogUnread > 0 ? 'Update Log' : forumTopicTitleForDisplay(topic),
    { censorProfanity },
  );
  const activityAt = topic.updated_at || topic.last_reply_at || topic.created_at;
  const activityLabel = getTimeAgo(activityAt);

  const openTopic = () => navigate(`/social/forum/${topic.id}`);

  return (
  <div
    role="link"
    tabIndex={0}
    className="sm:hidden block px-3 py-2.5 f-row transition-colors active:bg-zinc-800/50 cursor-pointer touch-manipulation"
    onClick={openTopic}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTopic();
      }
    }}
    onMouseEnter={() => prefetchForumTopic(topic.id)}
    onFocus={() => prefetchForumTopic(topic.id)}
    onPointerDown={() => prefetchForumTopic(topic.id)}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {topic.category === 'crew_oc' && (
            <FamilyEmblem
              emblemPresetId={topic.crew_oc_family_emblem_preset_id}
              avatarUrl={topic.crew_oc_family_emblem_avatar_url}
              size={18}
            />
          )}
          {topic.is_important && <AlertCircle size={12} className="text-amber-400 shrink-0" />}
          {topic.is_sticky && !topic.is_important && <Pin size={12} className="text-amber-400 shrink-0" />}
          {topic.is_important && <span className="text-amber-400 font-heading shrink-0 text-xs">IMPORTANT:&nbsp;</span>}
          {topic.is_sticky && !topic.is_important && <span className="text-amber-400 font-heading shrink-0 text-xs">STICKY:&nbsp;</span>}
          <span
            className="text-xs font-heading truncate inline-flex items-baseline gap-1 min-w-0 flex-1"
            style={forumTopicTitleColorStyle(topic)}
          >
            <span className="truncate" dangerouslySetInnerHTML={{ __html: titleHtml }} />
            {updateLogUnread > 0 && (
              <span
                className="shrink-0 font-heading font-bold tabular-nums text-primary"
                style={{
                  color: forumTopicAccentColor(topic),
                  textShadow: '0 0 8px rgba(var(--noir-primary-rgb), 0.53)',
                }}
                title={`${updateLogUnread} unread update${updateLogUnread === 1 ? '' : 's'}`}
              >
                {updateLogUnread}
              </span>
            )}
          </span>
          {topic.is_locked && <Lock size={10} className="text-mutedForeground shrink-0" />}
        </div>
        {topic?.designer_auction && (
          <div className="flex flex-wrap items-center gap-1 mt-1">
            <span className={`text-[9px] px-1 py-0.5 rounded border ${getAuctionStatusChip(topic.designer_auction.status).className}`}>
              {getAuctionStatusChip(topic.designer_auction.status).label}
            </span>
            <span className="text-[9px] px-1 py-0.5 rounded border border-primary/40 bg-primary/15 text-primary">
              {(Number(topic.designer_auction.current_bid || topic.designer_auction.starting_bid || 0)).toLocaleString()} {topic.designer_auction.currency === 'points' ? 'pts' : '$'}
              {topic.designer_auction.winner_username ? ` · ${topic.designer_auction.winner_username}` : ''}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] text-mutedForeground">
          {topic.redeem_code ? (
            <span className="inline-flex flex-col gap-0.5" title="Posted automatically by the game">
              <span className="font-heading font-semibold text-mutedForeground uppercase tracking-wide">System</span>
              {topic.redeem_max_uses != null && topic.redeem_uses_remaining != null && (
                <span className="font-heading font-semibold text-amber-400/90 tabular-nums normal-case">
                  {topic.redeem_uses_remaining}/{topic.redeem_max_uses} left
                </span>
              )}
            </span>
          ) : (
            <Link
              to={`/profile/${encodeURIComponent(topic.author_username || '?')}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:text-primary hover:underline relative z-[1]"
              style={topic.author_online_color ? { color: topic.author_online_color } : undefined}
            >
              {topic.author_username || '?'}
            </Link>
          )}
          <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {topic.posts}</span>
          <span className="flex items-center gap-0.5"><Eye size={10} /> {topic.views}</span>
          {activityLabel && <span className="tabular-nums">{activityLabel}</span>}
        </div>
      </div>
      <ChevronRight size={16} className="text-mutedForeground shrink-0 mt-1" />
    </div>

    {showDesignerSubmit && (
      <div className="pt-2 border-t border-zinc-700/30 mt-2" onClick={(e) => e.stopPropagation()}>
        {alreadySubmitted ? (
          <span className="text-[10px] text-emerald-400 font-heading font-bold">Submitted to competition</span>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSubmitToComp(designerCompId, topic.id); }}
            disabled={isSubmitting}
            className="px-3 min-h-10 bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold rounded hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
          >
            {isSubmitting ? '...' : 'Submit to competition'}
          </button>
        )}
      </div>
    )}
  </div>
  );
};

const FORUM_TABS = [
  { id: 'general', label: 'General', shortLabel: 'General' },
  { id: 'entertainer', label: 'Entertainer Forum', shortLabel: 'Ent.' },
  { id: 'designer', label: 'Designer Forum', shortLabel: 'Design' },
  { id: 'game_ideas', label: 'Game Ideas', shortLabel: 'Ideas' },
  { id: 'crew_oc', label: 'Crew OC', shortLabel: 'Crew' },
];

const FORUM_TOPICS_CACHE_PREFIX = 'forum_topics_cache_v1';
const FORUM_TOPICS_CACHE_MAX_AGE_MS = 2 * 60 * 1000;

function forumTopicsCacheKey(category, page) {
  return `${FORUM_TOPICS_CACHE_PREFIX}:${category || 'general'}:${Number(page) || 1}`;
}

function readForumTopicsCache(category, page) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(forumTopicsCacheKey(category, page));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - Number(parsed.ts || 0) > FORUM_TOPICS_CACHE_MAX_AGE_MS) return null;
    return parsed.data || null;
  } catch {
    return null;
  }
}

function writeForumTopicsCache(category, page, data) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      forumTopicsCacheKey(category, page),
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {
    /* sessionStorage may be full or unavailable */
  }
}

function forumTopicsSignature(list) {
  return (Array.isArray(list) ? list : [])
    .map((t) => `${t.id || ''}:${t.updated_at || t.last_reply_at || t.created_at || ''}:${t.views || 0}:${t.comment_count || 0}:${t.is_sticky ? 1 : 0}:${t.is_important ? 1 : 0}`)
    .join('|');
}

export default function Forum() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    if (t === 'entertainer' || t === 'designer' || t === 'crew_oc' || t === 'game_ideas') return t;
    return 'general';
  });
  const initialTopicsCache = readForumTopicsCache(activeTab, 1);
  const [topics, setTopics] = useState(Array.isArray(initialTopicsCache?.topics) ? initialTopicsCache.topics : []);
  const [forumPage, setForumPage] = useState(1);
  const [canViewPage2, setCanViewPage2] = useState(!!initialTopicsCache?.can_view_page_2);
  useEffect(() => {
    if (searchParams.get('tab') === 'entertainer' || location.state?.category === 'entertainer') setActiveTab('entertainer');
    else if (searchParams.get('tab') === 'designer') setActiveTab('designer');
    else if (searchParams.get('tab') === 'crew_oc' || location.state?.category === 'crew_oc') setActiveTab('crew_oc');
    else if (searchParams.get('tab') === 'game_ideas') setActiveTab('game_ideas');
    else setActiveTab('general');
  }, [searchParams, location.state?.category]);
  const [modalOpen, setModalOpen] = useState(false);
  const [gameModalOpen, setGameModalOpen] = useState(false);
  const [entertainerGames, setEntertainerGames] = useState([]);
  const [entertainerHistory, setEntertainerHistory] = useState([]);
  const [entertainerPrizes, setEntertainerPrizes] = useState(null);
  const [entertainerConfig, setEntertainerConfig] = useState({
    auto_create_enabled: false,
    find_word_auto_enabled: false,
    last_auto_create_at: null,
    next_auto_create_at: null,
    last_find_word_auto_at: null,
  });
  const [findWordActive, setFindWordActive] = useState({ active: false });
  const [findWordHistory, setFindWordHistory] = useState([]);
  const [startingWordHunt, setStartingWordHunt] = useState(false);
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [isHdo, setIsHdo] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const joiningInFlightRef = useRef(new Set());
  const entJoinTokenRef = useRef(null);
  const { getCaptchaToken: getEntJoinCaptchaToken, captchaModal: entJoinCaptchaModal } = useEntJoinTurnstile();
  const [rollingId, setRollingId] = useState(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [creatingGames, setCreatingGames] = useState(false);
  const [rewardsConfig, setRewardsConfig] = useState(null);
  const [rewardsConfigLoading, setRewardsConfigLoading] = useState(false);
  const [rewardsConfigSaving, setRewardsConfigSaving] = useState(false);
  const [rewardsEditing, setRewardsEditing] = useState(false);
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
  const [giSeasons, setGiSeasons] = useState([]);
  const [giSeasonsLoading, setGiSeasonsLoading] = useState(false);
  const [giForm, setGiForm] = useState({
    title: '',
    description: '',
    finalist_count: '5',
    finalist_reward_money: '',
    finalist_reward_points: '',
    winner_reward_money: '',
    winner_reward_points: '',
  });
  const [giCreating, setGiCreating] = useState(false);
  const [giActionId, setGiActionId] = useState(null);
  const [giImplSeasonId, setGiImplSeasonId] = useState('');
  const [giImplEntryId, setGiImplEntryId] = useState('');
  const [giImplCandidates, setGiImplCandidates] = useState([]);
  const [giImplLoading, setGiImplLoading] = useState(false);
  const [giConfirming, setGiConfirming] = useState(false);

  const fetchGiSeasons = useCallback(async () => {
    if (!isAdmin) return;
    setGiSeasonsLoading(true);
    try {
      const res = await api.get('/admin/game-ideas/seasons');
      setGiSeasons(res.data?.seasons ?? []);
    } catch {
      setGiSeasons([]);
    } finally {
      setGiSeasonsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (activeTab === 'game_ideas' && isAdmin) fetchGiSeasons();
  }, [activeTab, isAdmin, fetchGiSeasons]);

  useEffect(() => {
    if (!giImplSeasonId || !isAdmin) {
      setGiImplCandidates([]);
      setGiImplEntryId('');
      return;
    }
    let cancelled = false;
    setGiImplLoading(true);
    api.get(`/admin/game-ideas/seasons/${giImplSeasonId}/implementation-options`)
      .then((r) => {
        if (!cancelled) {
          setGiImplCandidates(r.data?.candidates ?? []);
          setGiImplEntryId('');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGiImplCandidates([]);
          setGiImplEntryId('');
        }
      })
      .finally(() => {
        if (!cancelled) setGiImplLoading(false);
      });
    return () => { cancelled = true; };
  }, [giImplSeasonId, isAdmin]);

  const fetchTopics = useCallback(async (silent = false) => {
    try {
      const res = await api.get('/forum/topics', { params: { category: activeTab, page: forumPage } });
      const nextTopics = res.data?.topics ?? [];
      const nextCanViewPage2 = !!res.data?.can_view_page_2;
      writeForumTopicsCache(activeTab, forumPage, {
        topics: nextTopics,
        can_view_page_2: nextCanViewPage2,
      });
      setTopics((prev) => (
        forumTopicsSignature(prev) === forumTopicsSignature(nextTopics) ? prev : nextTopics
      ));
      setCanViewPage2(nextCanViewPage2);
    } catch {
      if (!silent) toast.error('Failed to load forum');
    }
  }, [activeTab, forumPage]);

  const fetchEntertainerGames = useCallback(async () => {
    try {
      const res = await api.get('/forum/entertainer/games');
      setEntertainerGames(res.data?.games ?? []);
      if (res.data?.join_token) entJoinTokenRef.current = res.data.join_token;
    } catch {
      setEntertainerGames([]);
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

  const fetchFindWordPublic = useCallback(async () => {
    try {
      const [a, h] = await Promise.all([
        api.get('/forum/entertainer/find-word/active'),
        api.get('/forum/entertainer/find-word/history?limit=8'),
      ]);
      setFindWordActive(a.data ?? { active: false });
      setFindWordHistory(h.data?.rounds ?? []);
    } catch {
      setFindWordActive({ active: false });
      setFindWordHistory([]);
    }
  }, []);

  const defaultEntertainerConfig = useRef({
    auto_create_enabled: false,
    find_word_auto_enabled: false,
    last_auto_create_at: null,
    next_auto_create_at: null,
    last_find_word_auto_at: null,
  });
  useLayoutEffect(() => {
    const cached = readForumTopicsCache(activeTab, forumPage);
    if (cached && Array.isArray(cached.topics)) {
      setTopics((prev) => (
        forumTopicsSignature(prev) === forumTopicsSignature(cached.topics) ? prev : cached.topics
      ));
      setCanViewPage2(!!cached.can_view_page_2);
      return;
    }
    // No cache for this tab: clear stale rows from another tab and paint chrome immediately
    // (dark skeleton on dark bg looked like a black screen on mobile).
    setTopics([]);
    setCanViewPage2(false);
  }, [activeTab, forumPage]);

  useLayoutEffect(() => {
    const warm = readForumSpecialTabsWarm();
    if (!warm) return;
    if (warm.adminCheck) {
      setIsAdmin(!!warm.adminCheck.is_admin);
      setIsModerator(!!warm.adminCheck.is_moderator);
      setIsHdo(!!warm.adminCheck.is_help_desk_operator);
    }
    const special = ['entertainer', 'designer', 'game_ideas', 'crew_oc'];
    if (special.includes(activeTab) && forumPage === 1) {
      const pack = warm.topics?.[activeTab];
      if (pack && Array.isArray(pack.topics)) {
        setTopics(pack.topics);
        setCanViewPage2(!!pack.can_view_page_2);
      }
    }
    if (activeTab === 'entertainer' && warm.entertainer) {
      const e = warm.entertainer;
      setEntertainerGames(e.games ?? []);
      setEntertainerHistory(e.history ?? []);
      setEntertainerPrizes(e.prizes ?? null);
      setEntertainerConfig(e.config && typeof e.config === 'object' ? e.config : { ...defaultEntertainerConfig.current });
      setFindWordActive(e.findWordActive && typeof e.findWordActive === 'object' ? e.findWordActive : { active: false });
      setFindWordHistory(e.findWordHistory ?? []);
    }
    if (activeTab === 'designer' && warm.designer?.activeRes) {
      const ar = warm.designer.activeRes;
      setActiveDesignerComp(ar.competition ?? null);
      setMyVoteEntryId(ar.my_vote_entry_id ?? null);
      setMyEntryCommentId(ar.my_entry_comment_id ?? null);
      if (warm.designer.entriesPack) {
        setDesignerEntries(warm.designer.entriesPack.entries ?? []);
        setMyVoteEntryId(warm.designer.entriesPack.my_vote_entry_id ?? ar.my_vote_entry_id ?? null);
        setCanWithdrawVote(!!warm.designer.entriesPack.can_withdraw_vote);
      }
    }
  }, [activeTab, forumPage]);

  const fetchEntertainerConfig = useCallback(async () => {
    if (!isAdmin) {
      setEntertainerConfig({ ...defaultEntertainerConfig.current });
      return;
    }
    try {
      const res = await api.get('/forum/entertainer/admin/config');
      setEntertainerConfig(res.data ?? {
        auto_create_enabled: false,
        find_word_auto_enabled: false,
        last_auto_create_at: null,
        next_auto_create_at: null,
        last_find_word_auto_at: null,
      });
    } catch {
      setEntertainerConfig({
        auto_create_enabled: false,
        find_word_auto_enabled: false,
        last_auto_create_at: null,
        next_auto_create_at: null,
        last_find_word_auto_at: null,
      });
    }
  }, [isAdmin]);

  useEffect(() => { fetchTopics(); }, [fetchTopics]);
  
  // Silent background refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchTopics(true);
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchTopics]);
  useEffect(() => {
    if (activeTab === 'entertainer') {
      fetchEntertainerGames();
      fetchEntertainerHistory();
      fetchEntertainerPrizes();
      fetchEntertainerConfig();
      fetchFindWordPublic();
      api.get('/auth/me').then((r) => setUser(r.data)).catch(() => setUser(null));
    }
  }, [activeTab, fetchEntertainerGames, fetchEntertainerHistory, fetchEntertainerPrizes, fetchEntertainerConfig, fetchFindWordPublic]);
  useEffect(() => {
    if (activeTab === 'entertainer') {
      const id = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        fetchEntertainerGames();
        fetchEntertainerConfig();
        fetchFindWordPublic(true);
      }, ENTERTAINER_POLL_MS);
      const onVisibilityChange = () => {
        if (typeof document !== 'undefined' && !document.hidden) {
          fetchEntertainerGames();
          fetchEntertainerConfig();
          fetchFindWordPublic(true);
        }
      };
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibilityChange);
      }
      return () => {
        clearInterval(id);
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisibilityChange);
        }
      };
    }
  }, [activeTab, fetchEntertainerGames, fetchEntertainerConfig, fetchFindWordPublic]);

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
    api.get('/auth/staff-flags').then((r) => {
      setIsAdmin(!!r.data?.is_admin);
      setIsModerator(!!r.data?.is_moderator);
      setIsHdo(!!r.data?.is_help_desk_operator);
    }).catch(() => { setIsAdmin(false); setIsModerator(false); setIsHdo(false); });
  }, []);

  const handleToggleAutoCreate = async () => {
    if (!isAdmin) return;
    setConfigSaving(true);
    const next = !entertainerConfig.auto_create_enabled;
    try {
      const res = await api.patch('/forum/entertainer/admin/config', { auto_create_enabled: next });
      if (res.data) setEntertainerConfig(res.data);
      else setEntertainerConfig((c) => ({ ...c, auto_create_enabled: next }));
      toast.success(next ? 'Auto-create enabled' : 'Auto-create disabled');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleToggleFindWordAuto = async () => {
    if (!isAdmin) return;
    setConfigSaving(true);
    const next = !entertainerConfig.find_word_auto_enabled;
    try {
      const res = await api.patch('/forum/entertainer/admin/config', { find_word_auto_enabled: next });
      if (res.data) setEntertainerConfig(res.data);
      else setEntertainerConfig((c) => ({ ...c, find_word_auto_enabled: next }));
      toast.success(next ? 'Word hunt auto enabled (every 3h with E-Games cycle)' : 'Word hunt auto disabled');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleStartWordHuntNow = async () => {
    if (!isAdmin) return;
    setStartingWordHunt(true);
    try {
      const res = await api.post('/forum/entertainer/find-word/admin/start', {});
      toast.success(res.data?.message || 'Word hunt started');
      fetchFindWordPublic();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to start');
    } finally {
      setStartingWordHunt(false);
    }
  };

  const handleCreateGamesNow = async () => {
    if (!isAdmin) return;
    setCreatingGames(true);
    try {
      const res = await api.post('/forum/entertainer/admin/auto-create', {}, { timeout: 90000 });
      toast.success(res.data?.message || 'Games created');
      fetchEntertainerGames();
      fetchEntertainerHistory();
      fetchEntertainerConfig();
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      const isExplicitReject = (status === 400 || status === 401 || status === 403 || status === 404) && typeof detail === 'string' && detail.length > 0;
      if ((typeof status === 'number' && status >= 200 && status < 300) || !isExplicitReject) {
        fetchEntertainerGames();
        fetchEntertainerHistory();
        fetchEntertainerConfig();
        toast.success('Create request sent. Refreshed games list.');
      } else {
        toast.error(detail || 'Could not create games. Try again.');
      }
    } finally {
      setCreatingGames(false);
    }
  };

  const fetchRewardsConfig = async () => {
    setRewardsConfigLoading(true);
    try {
      const res = await api.get('/forum/entertainer/admin/rewards');
      setRewardsConfig(res.data);
    } catch { setRewardsConfig(null); }
    finally { setRewardsConfigLoading(false); }
  };

  const handleSaveRewardsConfig = async () => {
    if (!rewardsConfig) return;
    setRewardsConfigSaving(true);
    try {
      const { cash_min, cash_max, bullets_min, bullets_max, reward_type_weights } = rewardsConfig;
      const res = await api.patch('/forum/entertainer/admin/rewards', {
        cash_min,
        cash_max,
        bullets_min,
        bullets_max,
        reward_type_weights,
      });
      const d = res.data || {};
      setRewardsConfig({
        cash_min: d.cash_min,
        cash_max: d.cash_max,
        bullets_min: d.bullets_min,
        bullets_max: d.bullets_max,
        reward_type_weights: d.reward_type_weights,
      });
      toast.success(d.message || 'Rewards config saved');
      setRewardsEditing(false);
      fetchEntertainerPrizes();
    } catch (err) {
      const det = err.response?.data?.detail;
      const msg =
        typeof det === 'string'
          ? det
          : Array.isArray(det)
            ? det.map((e) => e?.msg || e?.message || JSON.stringify(e)).join('; ')
            : det && typeof det === 'object'
              ? det.msg || det.message || JSON.stringify(det)
              : null;
      const status = err.response?.status;
      const fallback =
        status === 403
          ? 'Admin only — sign in with an admin account'
          : status === 401
            ? 'Session expired — sign in again'
            : err.message || 'Failed to save';
      toast.error(msg || fallback);
    } finally { setRewardsConfigSaving(false); }
  };

  const handleRollGame = async (gameId) => {
    setRollingId(gameId);
    try {
      const res = await api.post(`/forum/entertainer/games/${encodeURIComponent(gameId)}/roll`);
      const summary = typeof res.data?.message === 'string' ? res.data.message : res.data?.summary;
      toast.success(summary || 'Game rolled');
      fetchEntertainerGames();
      fetchEntertainerHistory();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setRollingId(null);
    }
  };

  // Separate sticky/important topics
  const pinnedTopics = topics.filter(t => t.is_sticky || t.is_important);
  const regularTopics = topics.filter(t => !t.is_sticky && !t.is_important);

  const currentCategory = activeTab === 'entertainer' ? 'entertainer' : activeTab === 'crew_oc' ? 'crew_oc' : activeTab === 'designer' ? 'designer' : activeTab === 'game_ideas' ? 'game_ideas' : 'general';
  const openGames = (entertainerGames || []).filter((g) => g.status === 'open');
  const openManualGames = openGames.filter((g) => g.manual_roll === true);
  const openAutoGames = openGames.filter((g) => g.manual_roll !== true);
  const uidStr = user?.id != null ? String(user.id) : '';
  const isUserInParticipantList = (parts) =>
    !!uidStr && (parts || []).some((p) => String(p.user_id || '') === uidStr);
  const handleJoinGame = async (gameId) => {
    // Serialize all joins (not just same gameId) so the next join always uses a fresh token.
    if (!gameId || joiningInFlightRef.current.size > 0) return;
    joiningInFlightRef.current.add(gameId);
    setJoiningId(gameId);
    try {
      let captchaToken = null;
      try {
        captchaToken = await getEntJoinCaptchaToken();
      } catch {
        return; // captcha cancelled/failed — user can tap Join again
      }
      const res = await api.post(`/forum/entertainer/games/${gameId}/join`, {
        join_token: entJoinTokenRef.current,
        captcha_token: captchaToken,
      });
      if (res.data?.join_token) entJoinTokenRef.current = res.data.join_token;
      toast.success('Joined');
      fetchEntertainerGames();
      fetchEntertainerHistory();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (err) {
      const detail = err.response?.data?.detail || '';
      // Anti-bot join token expired/stale: silently refresh the list (issues a fresh token) and ask for another tap.
      if (typeof detail === 'string' && (detail.includes('refresh the games list') || detail.includes('Too fast'))) {
        fetchEntertainerGames();
        toast.warning(detail.includes('Too fast') ? 'Too fast — tap Join again.' : 'Session refreshed — tap Join again.');
      } else if (err.response?.status === 429) {
        toast.warning(typeof detail === 'string' && detail ? detail : 'Please wait a moment before joining again.');
      } else {
        toast.error(detail || 'Failed to join');
      }
    } finally {
      joiningInFlightRef.current.delete(gameId);
      setJoiningId(null);
    }
  };

  const [expandedHangmanId, setExpandedHangmanId] = useState(null);
  const [guessingLetter, setGuessingLetter] = useState(null);

  const handleGuessLetter = async (gameId, letter) => {
    setGuessingLetter(letter);
    try {
      const res = await api.post(`/forum/entertainer/games/${gameId}/guess`, { letter });
      const settled = !!(res.data?.word_solved || res.data?.game_over);
      if (res.data?.game) {
        setEntertainerGames((prev) => {
          const nextGame = res.data.game;
          const idx = (prev || []).findIndex((g) => g.id === gameId);
          if (idx < 0) {
            return settled ? prev : [...(prev || []), nextGame];
          }
          if (settled && nextGame.status && nextGame.status !== 'open') {
            return prev.filter((g) => g.id !== gameId);
          }
          const copy = prev.slice();
          copy[idx] = nextGame;
          return copy;
        });
      }
      if (settled) {
        fetchEntertainerGames();
        fetchEntertainerHistory();
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
      }
      if (res.data?.word_solved) {
        toast.success(`'${letter}' — word solved! Game settled.`);
        setExpandedHangmanId(null);
      } else if (res.data?.game_over) {
        toast.error(`Hangman complete — game settled (${res.data?.wrong_count}/6 misses).`);
        setExpandedHangmanId(null);
      } else if (res.data?.correct) {
        toast.success(`'${letter}' is in the word!`);
      } else {
        toast.error(`'${letter}' not in word (${res.data?.wrong_count}/6 misses)`);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to submit guess');
      fetchEntertainerGames();
    } finally {
      setGuessingLetter(null);
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

  const handleCreateGiSeason = async (e) => {
    e.preventDefault();
    if (!giForm.title.trim()) { toast.error('Title required'); return; }
    setGiCreating(true);
    try {
      await api.post('/admin/game-ideas/seasons', {
        title: giForm.title.trim(),
        description: giForm.description.trim() || undefined,
        finalist_count: parseInt(giForm.finalist_count, 10) || 5,
        finalist_reward_money: parseInt(String(giForm.finalist_reward_money).replace(/\D/g, ''), 10) || 0,
        finalist_reward_points: parseInt(String(giForm.finalist_reward_points).replace(/\D/g, ''), 10) || 0,
        winner_reward_money: parseInt(String(giForm.winner_reward_money).replace(/\D/g, ''), 10) || 0,
        winner_reward_points: parseInt(String(giForm.winner_reward_points).replace(/\D/g, ''), 10) || 0,
      });
      toast.success('Game Ideas season created (draft)');
      setGiForm({
        title: '', description: '', finalist_count: '5',
        finalist_reward_money: '', finalist_reward_points: '',
        winner_reward_money: '', winner_reward_points: '',
      });
      fetchGiSeasons();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setGiCreating(false);
    }
  };

  const runGiAction = async (seasonId, path, okMsg) => {
    setGiActionId(seasonId);
    try {
      await api.post(`/admin/game-ideas/seasons/${seasonId}/${path}`);
      toast.success(okMsg);
      fetchGiSeasons();
      fetchTopics(true);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setGiActionId(null);
    }
  };

  const handleGiConfirmImplementation = async () => {
    const sid = giImplSeasonId;
    const eid = giImplEntryId;
    if (!sid || !eid) { toast.error('Select a closed season and a winning entry'); return; }
    setGiConfirming(true);
    try {
      await api.post(`/admin/game-ideas/seasons/${sid}/confirm-implementation`, { entry_id: eid });
      toast.success('Implementation reward granted');
      const r = await api.get(`/admin/game-ideas/seasons/${sid}/implementation-options`);
      setGiImplCandidates(r.data?.candidates ?? []);
      setGiImplEntryId('');
      fetchGiSeasons();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally {
      setGiConfirming(false);
    }
  };

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="forum-page">
      <style>{FORUM_STYLES}</style>
      {entJoinCaptchaModal}

      {/* Page header */}
      <div className="relative f-fade-in flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] text-zinc-500 font-heading italic">
            {activeTab === 'general' && 'Discuss OC, crews, trades & more'}
            {activeTab === 'entertainer' && 'Dice, gbox, hangman — auto payout when full'}
            {activeTab === 'designer' && 'Designers: advertise your pictures. Users: request work or discuss.'}
            {activeTab === 'crew_oc' && 'Family Crew OC ads — apply from topic or family profile'}
            {activeTab === 'game_ideas' && 'Suggest features in the hub topic; vote on the Game Ideas board'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'entertainer' && (
            <button
              onClick={() => setGameModalOpen(true)}
              className="flex items-center gap-1.5 px-3 min-h-[44px] sm:min-h-0 py-1.5 bg-primary/20 border border-primary/50 text-primary text-xs font-heading font-bold uppercase rounded hover:bg-primary/30 transition-all touch-manipulation"
            >
              <Dice5 size={14} /> New Game
            </button>
          )}
          {activeTab !== 'crew_oc' && activeTab !== 'game_ideas' && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 px-3 min-h-[44px] sm:min-h-0 py-1.5 bg-primary/20 text-primary text-xs font-heading font-bold uppercase rounded border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation"
            >
              <Plus size={14} /> New Topic
            </button>
          )}
        </div>
      </div>

      {/* Tabs: General | Entertainer Forum — full width on mobile, scrollable */}
      <div className="forum-tabs-sticky w-full sm:w-fit overflow-x-auto overflow-y-hidden -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-thin sticky top-0 z-10 sm:static sm:z-auto bg-[var(--noir-bg,#0a0a0a)]/95 sm:bg-transparent backdrop-blur-sm sm:backdrop-blur-none py-1 sm:py-0">
        <div className="flex gap-1 p-1 bg-zinc-800/50 rounded border border-primary/20 w-max sm:w-full min-w-0">
          {FORUM_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setForumPage(1); setSearchParams(tab.id === 'general' ? {} : { tab: tab.id }, { replace: true }); }}
              className={`shrink-0 px-3 py-2 min-h-11 sm:min-h-9 text-xs font-heading font-bold uppercase rounded transition-all touch-manipulation ${activeTab === tab.id ? 'bg-primary/30 text-primary border border-primary/50' : 'text-mutedForeground hover:text-foreground border border-transparent'}`}
            >
              <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'game_ideas' && (
        <>
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-amber-500/25 f-fade-in mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
            <div className="px-3 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-[0.15em]">Game Ideas</span>
              <Link
                to="/game/game-ideas"
                className="text-[10px] font-heading font-bold text-primary uppercase hover:underline"
              >
                Open voting board →
              </Link>
            </div>
            <div className="p-3 text-[11px] text-mutedForeground">
              When staff start a season, a pinned hub topic appears below. Post your idea there, then click <strong className="text-foreground">Register as my idea</strong> on your post. Cast votes on the voting board (not for your own entry). Finalists get rewards when staff advance rounds; the winner receives the implementation bonus when staff confirm the feature is live.
            </div>
          </div>
          {isAdmin && (
            <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-red-500/30 f-fade-in mobile-panel`}>
              <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20">
                <span className="text-[10px] font-heading font-bold text-red-400 uppercase tracking-widest">Admin — Game Ideas seasons</span>
              </div>
              <form onSubmit={handleCreateGiSeason} className="p-3 space-y-2 border-b border-zinc-700/30 text-[11px]">
                <div className="font-heading text-mutedForeground uppercase text-[10px]">New draft season</div>
                <input
                  className="w-full px-2 py-1 rounded border border-input bg-transparent text-xs font-heading"
                  placeholder="Season title"
                  value={giForm.title}
                  onChange={(e) => setGiForm((p) => ({ ...p, title: e.target.value }))}
                />
                <textarea
                  className="w-full px-2 py-1 rounded border border-input bg-transparent text-xs min-h-[50px]"
                  placeholder="Hub topic description (optional)"
                  value={giForm.description}
                  onChange={(e) => setGiForm((p) => ({ ...p, description: e.target.value }))}
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <label className="text-[10px] text-mutedForeground">Finalists (top N)<input type="number" min={1} max={50} className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-xs" value={giForm.finalist_count} onChange={(e) => setGiForm((p) => ({ ...p, finalist_count: e.target.value }))} /></label>
                  <label className="text-[10px] text-mutedForeground">Finalist $ <input className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-xs" value={giForm.finalist_reward_money} onChange={(e) => setGiForm((p) => ({ ...p, finalist_reward_money: e.target.value }))} /></label>
                  <label className="text-[10px] text-mutedForeground">Finalist pts<input className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-xs" value={giForm.finalist_reward_points} onChange={(e) => setGiForm((p) => ({ ...p, finalist_reward_points: e.target.value }))} /></label>
                  <label className="text-[10px] text-mutedForeground">Winner impl. $<input className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-xs" value={giForm.winner_reward_money} onChange={(e) => setGiForm((p) => ({ ...p, winner_reward_money: e.target.value }))} /></label>
                  <label className="text-[10px] text-mutedForeground">Winner impl. pts<input className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-xs" value={giForm.winner_reward_points} onChange={(e) => setGiForm((p) => ({ ...p, winner_reward_points: e.target.value }))} /></label>
                </div>
                <button type="submit" disabled={giCreating} className="px-3 py-1.5 bg-red-500/20 border border-red-500/50 text-red-300 text-[10px] font-heading font-bold uppercase rounded">{giCreating ? '...' : 'Create draft'}</button>
              </form>
              <div className="p-3 space-y-2 text-[10px]">
                <div className="font-heading text-mutedForeground uppercase">Seasons</div>
                {giSeasonsLoading ? <p className="text-mutedForeground">Loading…</p> : giSeasons.length === 0 ? <p className="text-mutedForeground">None yet.</p> : (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {giSeasons.map((s) => (
                      <div key={s.id} className="rounded border border-zinc-700/40 p-2 space-y-1">
                        <div className="text-foreground font-heading">{s.title} <span className="text-mutedForeground font-normal">({s.status})</span></div>
                        <div className="flex flex-wrap gap-1">
                          {s.status === 'draft' && (
                            <button type="button" disabled={giActionId === s.id} onClick={() => runGiAction(s.id, 'start', 'Season started')} className="px-2 py-0.5 bg-primary/20 border border-primary/40 text-primary rounded uppercase font-heading">Start</button>
                          )}
                          {s.status === 'primary' && (
                            <button type="button" disabled={giActionId === s.id} onClick={() => runGiAction(s.id, 'advance-final', 'Advanced to final')} className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded uppercase font-heading">Advance final</button>
                          )}
                          {s.status === 'final' && (
                            <button type="button" disabled={giActionId === s.id} onClick={() => runGiAction(s.id, 'close-final', 'Final closed')} className="px-2 py-0.5 bg-zinc-600/40 border border-zinc-500/50 text-zinc-200 rounded uppercase font-heading">Close final</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="pt-2 border-t border-zinc-700/30 space-y-2">
                  <div className="font-heading text-mutedForeground uppercase">Confirm implementation</div>
                  <p className="text-[9px] text-mutedForeground">Choose a closed season, then the winning player&apos;s entry (IDs are applied automatically).</p>
                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-stretch sm:items-end">
                    <label className="flex flex-col gap-0.5 text-[10px] text-mutedForeground min-w-[160px] flex-1">
                      Season
                      <select
                        className="px-2 py-1.5 rounded border border-input bg-zinc-900/80 text-foreground text-[11px] font-heading"
                        value={giImplSeasonId}
                        onChange={(e) => setGiImplSeasonId(e.target.value)}
                      >
                        <option value="">Select closed season…</option>
                        {giSeasons.filter((s) => s.status === 'closed').map((s) => (
                          <option key={s.id} value={s.id}>{s.title}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5 text-[10px] text-mutedForeground min-w-[200px] flex-[2]">
                      Winning entry
                      <select
                        className="px-2 py-1.5 rounded border border-input bg-zinc-900/80 text-foreground text-[11px] font-heading disabled:opacity-50"
                        disabled={!giImplSeasonId || giImplLoading}
                        value={giImplEntryId}
                        onChange={(e) => setGiImplEntryId(e.target.value)}
                      >
                        <option value="">{giImplLoading ? 'Loading…' : giImplSeasonId ? 'Select entry…' : 'Pick a season first'}</option>
                        {giImplCandidates.map((c) => (
                          <option key={c.entry_id} value={c.entry_id} disabled={c.implementation_paid}>
                            {c.author_username}{c.implementation_paid ? ' (already paid)' : ''} — {(c.preview || '').slice(0, 80)}{(c.preview || '').length > 80 ? '…' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" disabled={giConfirming || !giImplSeasonId || !giImplEntryId} onClick={handleGiConfirmImplementation} className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 rounded uppercase font-heading text-[10px] shrink-0 self-end">{giConfirming ? '...' : 'Pay reward'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

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
            <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in mobile-panel`}>
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
                    <> <Link to={`/social/forum/${activeDesignerComp.competition_topic_id}`} onMouseEnter={() => prefetchForumTopic(activeDesignerComp.competition_topic_id)} onPointerDown={() => prefetchForumTopic(activeDesignerComp.competition_topic_id)} className="text-primary font-heading font-bold underline">Open competition topic →</Link></>
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
                            <Link to={`/social/forum/${entry.topic_id || activeDesignerComp?.competition_topic_id || ''}`} onMouseEnter={() => prefetchForumTopic(entry.topic_id || activeDesignerComp?.competition_topic_id)} onPointerDown={() => prefetchForumTopic(entry.topic_id || activeDesignerComp?.competition_topic_id)} className="text-[10px] text-primary hover:underline">View topic</Link>
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
            <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in mobile-panel`}>
              <div className="p-4 text-center text-xs text-mutedForeground">
                No active designer competition. When one is running, a pinned topic will appear here — post your picture there and submit that post as your entry. Voters get 100 points.
              </div>
            </div>
          )}
        </>
      )}

      {/* Entertainer: Auto games (dice / gbox / hangman) */}
      {activeTab === 'entertainer' && (
        <>
          {/* Admin tools */}
          {isAdmin && (
            <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-amber-500/30 f-fade-in mobile-panel`}>
              <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
              <div className="px-3 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
                <span className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-[0.15em]">🛠️ E-Games Admin</span>
                <p className="text-[9px] text-mutedForeground mt-1.5 font-heading leading-snug">
                  Referral report / prereg heal / manual links:{' '}
                  <Link to="/tjjeujr3wa/overview#admin-players" className="text-primary hover:underline">Admin Tools → Player Management → Referrals & prereg heal</Link>
                </p>
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
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!entertainerConfig.find_word_auto_enabled}
                    onChange={handleToggleFindWordAuto}
                    disabled={configSaving}
                    className="rounded border-primary/50"
                  />
                  <span className="text-xs font-heading">Auto word hunt (with 3h cycle)</span>
                </label>
                <button
                  type="button"
                  onClick={handleStartWordHuntNow}
                  disabled={startingWordHunt || configSaving}
                  className="px-2 py-1 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[10px] font-heading font-bold uppercase rounded hover:bg-emerald-500/25 disabled:opacity-50"
                >
                  {startingWordHunt ? '...' : 'Start word hunt'}
                </button>
                {entertainerConfig.last_find_word_auto_at && (
                  <span className="text-[10px] text-mutedForeground">
                    Last word hunt auto: {getTimeAgo(entertainerConfig.last_find_word_auto_at)}
                  </span>
                )}
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
              {/* Reward config editor */}
              <div className="px-3 pb-3 border-t border-amber-500/20">
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-[10px] font-heading text-amber-400 uppercase tracking-wider">Reward Config</span>
                  {!rewardsEditing ? (
                    <button type="button" onClick={() => { fetchRewardsConfig(); setRewardsEditing(true); }}
                      disabled={rewardsConfigLoading}
                      className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/50 text-amber-400 text-[9px] font-heading font-bold uppercase rounded hover:bg-amber-500/30 disabled:opacity-50">
                      {rewardsConfigLoading ? '...' : 'Edit Rewards'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setRewardsEditing(false)}
                      className="px-2 py-0.5 bg-zinc-700/50 border border-zinc-600/50 text-mutedForeground text-[9px] font-heading font-bold uppercase rounded hover:bg-zinc-700">
                      Cancel
                    </button>
                  )}
                </div>
                {rewardsEditing && rewardsConfig && (
                  <div className="mt-2 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="text-[9px] text-mutedForeground font-heading block mb-0.5">Cash Min</label>
                        <input type="number" min="0" value={rewardsConfig.cash_min ?? ''} onChange={(e) => setRewardsConfig(c => ({...c, cash_min: parseInt(e.target.value,10)||0}))}
                          className="w-full px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono" />
                      </div>
                      <div>
                        <label className="text-[9px] text-mutedForeground font-heading block mb-0.5">Cash Max</label>
                        <input type="number" min="0" value={rewardsConfig.cash_max ?? ''} onChange={(e) => setRewardsConfig(c => ({...c, cash_max: parseInt(e.target.value,10)||0}))}
                          className="w-full px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono" />
                      </div>
                      <div>
                        <label className="text-[9px] text-mutedForeground font-heading block mb-0.5">Bullets Min</label>
                        <input type="number" min="0" value={rewardsConfig.bullets_min ?? ''} onChange={(e) => setRewardsConfig(c => ({...c, bullets_min: parseInt(e.target.value,10)||0}))}
                          className="w-full px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono" />
                      </div>
                      <div>
                        <label className="text-[9px] text-mutedForeground font-heading block mb-0.5">Bullets Max</label>
                        <input type="number" min="0" value={rewardsConfig.bullets_max ?? ''} onChange={(e) => setRewardsConfig(c => ({...c, bullets_max: parseInt(e.target.value,10)||0}))}
                          className="w-full px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] text-mutedForeground font-heading block mb-1">Reward Type Weights (higher = more likely)</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {rewardsConfig.reward_type_weights && Object.entries(rewardsConfig.reward_type_weights).map(([key, val]) => (
                          <div key={key} className="flex items-center gap-1.5">
                            <span className="text-[9px] text-mutedForeground font-mono min-w-[100px]">{key}</span>
                            <input type="number" min="0" value={val} onChange={(e) => setRewardsConfig(c => ({...c, reward_type_weights: {...c.reward_type_weights, [key]: parseInt(e.target.value,10)||0}}))}
                              className="w-16 px-1.5 py-0.5 rounded border border-input bg-transparent text-[10px] font-mono" />
                          </div>
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={handleSaveRewardsConfig} disabled={rewardsConfigSaving}
                      className="px-3 py-1 bg-amber-500/20 border border-amber-500/50 text-amber-400 text-[10px] font-heading font-bold uppercase rounded hover:bg-amber-500/30 disabled:opacity-50">
                      {rewardsConfigSaving ? 'Saving...' : 'Save Rewards Config'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Find the word hunt */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-card f-fade-in mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🔎 Find the word</span>
            </div>
            <div className="p-3 text-[11px] font-heading space-y-2">
              {findWordActive?.active ? (
                findWordActive.can_claim === false ? (
                  <>
                    <p className="text-foreground">
                      <span className="text-amber-400 font-bold uppercase text-[10px]">Live</span>
                      {' — '}A hunt is running, but{' '}
                      <strong className="text-foreground">you won the last round</strong>, so you cannot claim this one.
                    </p>
                    {findWordActive.ineligible_reason && (
                      <p className="text-[11px] text-amber-200/90 border-l-2 border-amber-500/40 pl-2 mt-2">{findWordActive.ineligible_reason}</p>
                    )}
                    {findWordActive.hint && (
                      <p className="text-[11px] text-mutedForeground italic border-l-2 border-primary/30 pl-2 mt-2">
                        <span className="text-primary not-italic font-heading font-bold uppercase text-[9px] tracking-wider">
                          Hint
                        </span>
                        {' — '}
                        {findWordActive.hint}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-foreground">
                      <span className="text-emerald-400 font-bold uppercase text-[10px]">Live</span>
                      {' — '}A hidden word can appear on <strong className="text-foreground">any page</strong> while you&apos;re
                      logged in (position shifts as you move around). First click wins an E-Game style prize, then the round
                      closes.
                    </p>
                    {findWordActive.hint && (
                      <p className="text-[11px] text-mutedForeground italic border-l-2 border-primary/30 pl-2 mt-2">
                        <span className="text-primary not-italic font-heading font-bold uppercase text-[9px] tracking-wider">
                          Hint
                        </span>
                        {' — '}
                        {findWordActive.hint}
                      </p>
                    )}
                  </>
                )
              ) : (
                <p className="text-mutedForeground">No word hunt right now. Watch notifications — or ask staff to start one.</p>
              )}
              <p className="text-[9px] text-mutedForeground mt-2 leading-relaxed">
                If you won the most recent round, you sit out the next hunt only — then you can win again.
              </p>
              {findWordHistory.length > 0 && (
                <div className="pt-2 border-t border-border/60">
                  <p className="text-[9px] uppercase tracking-wider text-mutedForeground mb-1.5">Recent rounds</p>
                  <ul className="space-y-1 text-[10px] text-mutedForeground">
                    {findWordHistory.map((r) => (
                      <li key={r.id} className="flex flex-wrap gap-x-2 gap-y-0.5">
                        <span className="text-foreground/90 font-mono">{r.word}</span>
                        <span>—</span>
                        <span>{r.winner_username || '—'}</span>
                        {r.reward_text && <span className="text-primary">({r.reward_text})</span>}
                        <span className="opacity-70">{r.completed_at ? new Date(r.completed_at).toLocaleString() : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="f-art-line text-primary mx-3" />
          </div>

          {/* What you can win */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-card f-fade-in mobile-panel`}>
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
                      <span className="text-mutedForeground">Bullets</span>
                      <span className="ml-2 text-primary font-heading font-bold">{entertainerPrizes.bullets?.min} – {entertainerPrizes.bullets?.max}</span>
                    </div>
                    <div className="rounded bg-zinc-800/40 border border-zinc-700/30 px-2 py-1.5">
                      <span className="text-mutedForeground">Tokens</span>
                      <span className="ml-2 text-primary font-heading font-bold">{entertainerPrizes.tokens?.min} – {entertainerPrizes.tokens?.max}</span>
                    </div>
                  </div>
                  {entertainerPrizes.tokens?.types?.length > 0 && (
                    <div className="mb-3 rounded bg-zinc-800/30 border border-zinc-700/30 px-2 py-1.5">
                      <span className="text-mutedForeground">Token types: </span>
                      <span className="text-foreground">{entertainerPrizes.tokens.types.map((t) => t.label).join(', ')}</span>
                    </div>
                  )}
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

          {[
            {
              key: 'manual',
              title: 'Manual games',
              emoji: '🎩',
              subtitle: 'Funded by the host; they roll when the table is ready. Free to join unless an entry fee is set.',
              games: openManualGames,
              showAutoRollCountdown: false,
              showCreateBtn: true,
              emptyHint: 'No manual games open. Use Create manual game or start one from an entertainer topic.',
            },
            {
              key: 'auto',
              title: 'Auto games',
              emoji: '🎲',
              subtitle: 'System batch games — free to join · random prizes · rolls when full or 20 mins before the next batch.',
              games: openAutoGames,
              showAutoRollCountdown: true,
              showCreateBtn: false,
              emptyHint: openManualGames.length > 0
                ? 'No system batch games open right now. Manual games are listed above.'
                : `No open batch games${entertainerConfig.auto_create_enabled ? ' — next batch every ~3h when enabled' : ''}.`,
            },
          ].map((sec) => {
            const secsLeft = getSecondsUntilRollWindow(entertainerConfig.next_auto_create_at);
            return (
              <div key={sec.key} className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in mobile-panel`}>
                <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">{sec.emoji} {sec.title}</span>
                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    {sec.showCreateBtn && (
                      <button
                        type="button"
                        onClick={() => setGameModalOpen(true)}
                        className="flex items-center gap-1 px-2 py-1 bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase rounded hover:bg-primary/30 shrink-0"
                      >
                        <Dice5 size={12} /> Create manual game
                      </button>
                    )}
                    <span className="text-[10px] text-mutedForeground max-w-xl">{sec.subtitle}</span>
                  </div>
                </div>
                {sec.games.length === 0 ? (
                  <div className="p-4 text-center text-xs text-mutedForeground">{sec.emptyHint}</div>
                ) : (
                  <div className="divide-y divide-zinc-700/30">
                    {sec.games.map((g) => {
                      const participants = g.participants || [];
                      const isIn = isUserInParticipantList(participants);
                      const host = (g.creator_username || '').trim() || '—';
                      const hostIsSystem = (g.creator_id || '') === 'system';
                      return (
                        <div key={g.id}>
                          <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="p-1.5 rounded bg-primary/20 border border-primary/30 shrink-0">
                                {g.game_type === 'dice' ? (
                                  <Dice5 size={14} className="text-primary" />
                                ) : g.game_type === 'hangman' ? (
                                  <Puzzle size={14} className="text-primary" />
                                ) : (
                                  <Package size={14} className="text-primary" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <span className="text-xs font-heading font-bold text-foreground capitalize">{g.game_type}</span>
                                <span className="text-[10px] text-mutedForeground ml-2">
                                  <Users size={10} className="inline" /> {participants.length}/{g.max_players}
                                </span>
                                <span className="text-primary text-[10px] ml-2">Winnings: cash, bullets, tokens, cars</span>
                                {g.game_type === 'hangman' && g.hangman && (
                                  <span className="text-[10px] text-amber-400 ml-2">
                                    {(g.hangman.wrong_count || 0)}/{g.hangman.max_wrong || 6} misses · {(g.hangman.revealed_pattern || []).filter((c) => c !== '_').length}/{g.hangman.word_length || 0} revealed
                                  </span>
                                )}
                                {sec.showAutoRollCountdown && secsLeft > 0 && (
                                  <span className="text-[10px] text-amber-400/90 ml-2">Rolls in {formatTimeUntil(secsLeft)}</span>
                                )}
                                <div className="text-[10px] text-mutedForeground mt-0.5">
                                  Host:{' '}
                                  {hostIsSystem || host === '—' ? (
                                    <span className="text-zinc-300">{host}</span>
                                  ) : (
                                    <Link to={`/profile/${encodeURIComponent(host)}`} className="text-primary hover:underline font-heading">
                                      {host}
                                    </Link>
                                  )}
                                </div>
                                <div className="text-[10px] mt-0.5 flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                                  <span className="text-mutedForeground shrink-0">Joined:</span>
                                  {participants.length === 0 ? (
                                    <span className="text-zinc-500 font-heading">Nobody yet</span>
                                  ) : (
                                    participants.map((p, idx) => {
                                      const uname = (p.username || '?').trim() || '?';
                                      return (
                                        <span key={p.user_id || `join-${g.id}-${idx}`} className="inline">
                                          {idx > 0 ? <span className="text-mutedForeground">, </span> : null}
                                          <Link
                                            to={`/profile/${encodeURIComponent(uname)}`}
                                            className="text-primary/90 hover:underline font-heading"
                                          >
                                            {uname}
                                          </Link>
                                        </span>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {!!user && !isIn && g.status === 'open' && (
                                <button
                                  onClick={() => handleJoinGame(g.id)}
                                  disabled={joiningId === g.id}
                                  className="px-2 py-1 bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase rounded hover:bg-primary/30 disabled:opacity-50"
                                >
                                  {joiningId === g.id ? '...' : 'Join free'}
                                </button>
                              )}
                              {isIn && <span className="text-[10px] text-mutedForeground">You&apos;re in</span>}
                              {g.game_type === 'hangman' && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedHangmanId(expandedHangmanId === g.id ? null : g.id)}
                                  className="px-2 py-1 bg-amber-500/20 border border-amber-500/50 text-amber-400 text-[10px] font-heading font-bold uppercase rounded hover:bg-amber-500/30"
                                >
                                  {expandedHangmanId === g.id ? 'Hide' : 'Play'}
                                </button>
                              )}
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
                          {g.game_type === 'hangman' && expandedHangmanId === g.id && (
                            <HangmanPanel
                              game={g}
                              userId={user?.id}
                              onGuessLetter={isIn ? handleGuessLetter : null}
                              guessingLetter={guessingLetter}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="f-art-line text-primary mx-3" />
              </div>
            );
          })}

          {/* Last 10 Games */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in mobile-panel`}>
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
                      <th className="px-3 py-2">Hosted by</th>
                      <th className="px-3 py-2">Winner(s)</th>
                      <th className="px-3 py-2">Rewards</th>
                      <th className="px-3 py-2 text-right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entertainerHistory.map((h) => (
                      <tr key={h.id} className="border-b border-zinc-700/20 f-row">
                        <td className="px-3 py-1.5 font-heading capitalize">{h.game_type}</td>
                        <td className="px-3 py-1.5 text-mutedForeground">{h.host || '—'}</td>
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
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        {/* Desktop Header */}
        <div className="hidden sm:grid grid-cols-12 gap-2 px-3 py-2.5 bg-primary/8 border-b border-primary/20 text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
          <div className="col-span-7">Topic</div>
          <div className="col-span-2 text-right">Author</div>
          <div className="col-span-1 text-right">Posts</div>
          <div className="col-span-2 text-right">Views</div>
        </div>

        {/* Mobile Header */}
        <div className="sm:hidden px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Topics</span>
          {canViewPage2 && (
            <div className="flex gap-1">
              <button type="button" onClick={() => setForumPage(1)} className={`px-3 min-h-10 rounded text-[10px] font-heading font-bold touch-manipulation ${forumPage === 1 ? 'bg-primary/30 text-primary' : 'text-mutedForeground hover:text-foreground'}`}>Page 1</button>
              <button type="button" onClick={() => setForumPage(2)} className={`px-3 min-h-10 rounded text-[10px] font-heading font-bold touch-manipulation ${forumPage === 2 ? 'bg-primary/30 text-primary' : 'text-mutedForeground hover:text-foreground'}`}>Page 2</button>
            </div>
          )}
        </div>

        {topics.length === 0 ? (
          <div className="p-6 text-center text-xs text-mutedForeground">
            {activeTab === 'crew_oc' ? 'No Crew OC ads yet.' : 'No topics yet. Create one!'}
          </div>
        ) : (
          <div className="divide-y divide-zinc-700/30 sm:divide-y-0 sm:space-y-1.5 sm:px-0">
            {/* Pinned topics first */}
            {pinnedTopics.length > 0 && (
              <>
                {pinnedTopics.map((t) => (
                  <div
                    key={t.id}
                    className="sm:rounded-md sm:overflow-hidden sm:border sm:border-zinc-800/60 sm:bg-zinc-900/70"
                  >
                    <TopicRowDesktop
                      topic={t}
                      designerCompId={null}
                      myEntryTopicIds={[]}
                      meUsername={user?.username}
                      onSubmitToComp={() => {}}
                      submittingTopicId={null}
                      censorProfanity={user?.censor_profanity}
                    />
                    <TopicRowMobile
                      topic={t}
                      designerCompId={null}
                      myEntryTopicIds={[]}
                      meUsername={user?.username}
                      onSubmitToComp={() => {}}
                      submittingTopicId={null}
                      censorProfanity={user?.censor_profanity}
                    />
                  </div>
                ))}
                {regularTopics.length > 0 && (
                  <div className="px-3 py-1.5 bg-zinc-800/30 text-[10px] text-mutedForeground">Regular topics</div>
                )}
              </>
            )}

            {/* Regular topics */}
            {regularTopics.map((t) => (
              <div
                key={t.id}
                className="sm:rounded-md sm:overflow-hidden sm:border sm:border-zinc-800/60 sm:bg-zinc-900/70"
              >
                <TopicRowDesktop
                  topic={t}
                  designerCompId={null}
                  myEntryTopicIds={[]}
                  meUsername={user?.username}
                  onSubmitToComp={() => {}}
                  submittingTopicId={null}
                  censorProfanity={user?.censor_profanity}
                />
                <TopicRowMobile
                  topic={t}
                  designerCompId={null}
                  myEntryTopicIds={[]}
                  meUsername={user?.username}
                  onSubmitToComp={() => {}}
                  submittingTopicId={null}
                  censorProfanity={user?.censor_profanity}
                />
              </div>
            ))}
          </div>
        )}
        <div className="f-art-line text-primary mx-3" />
      </div>

      {/* Rules */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
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

      <CreateTopicModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(info) => {
          fetchTopics();
          const tid = info?.topicId;
          if (tid) {
            prefetchForumTopic(tid);
            navigate(`/social/forum/${tid}#forum-topic-${tid}`);
          }
        }}
        category={currentCategory}
        canUseColors={isAdmin || isModerator}
      />
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
