import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { MessageSquare, Lock, Pin, AlertCircle, Plus, ChevronRight, Eye, MessageCircle, Dice5, Package, Users, Bold, Italic, Image, Palette, Puzzle } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import GifPicker from '../../components/GifPicker';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import { parseForumContent, insertAtCursor } from '../../utils/forumContent';
import styles from '../../styles/noir.module.css';

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
        await api.post('/forum/designer/auctions', {
          title: title.trim(),
          content: content.trim(),
          image_url: auctionImageUrl.trim(),
          currency: auctionCurrency,
          starting_bid: parseInt(String(auctionStartingBid).replace(/\D/g, ''), 10) || 0,
          end_at: endAtIso,
          title_color: titleColor || undefined,
        });
        toast.success('Designer auction created');
      } else {
        const payload = { title: title.trim(), content: content.trim(), category };
        if (topicGifUrl.trim()) payload.gif_url = topicGifUrl.trim();
        if (titleColor) payload.title_color = titleColor;
        await api.post('/forum/topics', payload);
        toast.success('Topic created');
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
            {category === 'entertainer' ? '🎭 Entertainer: New Topic' : category === 'designer' ? '🎨 Designer Forum: New Topic' : category === 'game_ideas' ? '💡 Game Ideas: New Topic (admin)' : '📝 Create New Topic'}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-3 space-y-3">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Title..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={titleColor ? { color: titleColor } : {}}
                className="flex-1 px-3 py-2 bg-zinc-900/50 border border-zinc-700/50 rounded text-sm placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none"
              />
              {canUseColors && (
                <button
                  type="button"
                  onClick={() => setShowTitleColors(!showTitleColors)}
                  className="px-2 py-1 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10 flex items-center gap-1"
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
                    className={`px-2 py-1 text-[10px] font-heading rounded border transition-all ${
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
              {/* Classic forum smileys first */}
              {CLASSIC_SMILEYS.map(({ code, img }) => (
                <button key={code} type="button" onClick={() => insertEmoji(code)} className="hover:scale-110 transition-transform p-0.5" title={code}>
                  <img src={`/images/smileys/${img}.png`} alt={code} className="w-5 h-5" />
                </button>
              ))}
              {/* Modern emojis */}
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
const TopicRowDesktop = ({ topic, canStickyImportant, canLock, onUpdate, updating, designerCompId, myEntryTopicIds, meUsername, onSubmitToComp, submittingTopicId, censorProfanity }) => {
  const [showPreview, setShowPreview] = useState(false);
  const showFlagControls = canStickyImportant || canLock;
  const isMyTopic = meUsername && topic.author_username === meUsername;
  const showDesignerSubmit = designerCompId && isMyTopic;
  const alreadySubmitted = showDesignerSubmit && (myEntryTopicIds || []).includes(topic.id);
  const isSubmitting = submittingTopicId === topic.id;
  const titleHtml = parseForumContent(topic.title || '', { censorProfanity });

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
            {topic.is_important && <span className="text-amber-400 font-heading shrink-0">IMPORTANT:&nbsp;</span>}
            {topic.is_sticky && !topic.is_important && <span className="text-amber-400 font-heading shrink-0">STICKY:&nbsp;</span>}
            <span
              className="truncate font-heading"
              style={topic.title_color ? { color: topic.title_color } : {}}
              dangerouslySetInnerHTML={{ __html: titleHtml }}
            />
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
            <span className="truncate block text-mutedForeground font-heading font-semibold text-[10px] uppercase tracking-wide" title="Posted automatically by the game">System</span>
          ) : (
            <Link to={`/profile/${encodeURIComponent(topic.author_username || '?')}`} className="hover:text-primary hover:underline truncate block" style={topic.author_online_color ? { color: topic.author_online_color } : undefined}>{topic.author_username || '?'}</Link>
          )}
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
            <span>By {topic.redeem_code ? <span className="text-mutedForeground font-heading font-semibold">System</span> : <Link to={`/profile/${encodeURIComponent(topic.author_username || '?')}`} className="hover:text-primary hover:underline" style={topic.author_online_color ? { color: topic.author_online_color } : undefined}>{topic.author_username || '?'}</Link>}</span>
            {topic.created_at && <span>{getTimeAgo(topic.created_at)}</span>}
            <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {topic.posts} replies</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Topic card for mobile. canStickyImportant = admin/mod, canLock = admin/mod/hdo.
const TopicRowMobile = ({ topic, canStickyImportant, canLock, onUpdate, updating, designerCompId, myEntryTopicIds, meUsername, onSubmitToComp, submittingTopicId, censorProfanity }) => {
  const showFlagControls = canStickyImportant || canLock;
  const isMyTopic = meUsername && topic.author_username === meUsername;
  const showDesignerSubmit = designerCompId && isMyTopic;
  const alreadySubmitted = showDesignerSubmit && (myEntryTopicIds || []).includes(topic.id);
  const isSubmitting = submittingTopicId === topic.id;
  const titleHtml = parseForumContent(topic.title || '', { censorProfanity });

  return (
  <Link to={`/forum/topic/${topic.id}`} className="sm:hidden block px-3 py-2 f-row transition-colors active:bg-zinc-800/50">
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {topic.is_important && <AlertCircle size={12} className="text-amber-400 shrink-0" />}
          {topic.is_sticky && !topic.is_important && <Pin size={12} className="text-amber-400 shrink-0" />}
          <span
            className={`text-xs font-heading truncate ${topic.is_important || topic.is_sticky ? 'text-amber-400 font-bold' : ''}`}
            style={topic.title_color && !topic.is_important && !topic.is_sticky ? { color: topic.title_color } : {}}
            dangerouslySetInnerHTML={{ __html: titleHtml }}
          />
          {topic?.designer_auction && (
            <span className="inline-flex items-center gap-1 shrink-0">
              <span className={`text-[9px] px-1 py-0.5 rounded border ${getAuctionStatusChip(topic.designer_auction.status).className}`}>
                {getAuctionStatusChip(topic.designer_auction.status).label}
              </span>
              <span className="text-[9px] px-1 py-0.5 rounded border border-primary/40 bg-primary/15 text-primary">
                {(Number(topic.designer_auction.current_bid || topic.designer_auction.starting_bid || 0)).toLocaleString()} {topic.designer_auction.currency === 'points' ? 'pts' : '$'}
                {topic.designer_auction.winner_username ? ` · ${topic.designer_auction.winner_username}` : ''}
              </span>
            </span>
          )}
          {topic.is_locked && <Lock size={10} className="text-mutedForeground shrink-0" />}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[10px] text-mutedForeground">
          {topic.redeem_code ? (
            <span className="font-heading font-semibold text-mutedForeground uppercase tracking-wide" title="Posted automatically by the game">System</span>
          ) : (
            <Link to={`/profile/${encodeURIComponent(topic.author_username || '?')}`} onClick={(e) => e.stopPropagation()} className="hover:text-primary hover:underline" style={topic.author_online_color ? { color: topic.author_online_color } : undefined}>{topic.author_username || '?'}</Link>
          )}
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
  { id: 'game_ideas', label: 'Game Ideas' },
  { id: 'crew_oc', label: 'Crew OC' },
];

export default function Forum() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    if (t === 'entertainer' || t === 'designer' || t === 'crew_oc' || t === 'game_ideas') return t;
    return 'general';
  });
  const [topics, setTopics] = useState([]);
  const [forumPage, setForumPage] = useState(1);
  const [canViewPage2, setCanViewPage2] = useState(false);
  useEffect(() => {
    if (searchParams.get('tab') === 'entertainer' || location.state?.category === 'entertainer') setActiveTab('entertainer');
    else if (searchParams.get('tab') === 'designer') setActiveTab('designer');
    else if (searchParams.get('tab') === 'crew_oc' || location.state?.category === 'crew_oc') setActiveTab('crew_oc');
    else if (searchParams.get('tab') === 'game_ideas') setActiveTab('game_ideas');
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
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/forum/topics', { params: { category: activeTab, page: forumPage } });
      setTopics(res.data?.topics ?? []);
      setCanViewPage2(!!res.data?.can_view_page_2);
    } catch {
      if (!silent) toast.error('Failed to load forum');
      if (!silent) setTopics([]);
    } finally {
      if (!silent) setLoading(false);
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
      const res = await api.patch('/forum/entertainer/admin/rewards', rewardsConfig);
      setRewardsConfig(res.data);
      toast.success(res.data?.message || 'Rewards config saved');
      setRewardsEditing(false);
      fetchEntertainerPrizes();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save');
    } finally { setRewardsConfigSaving(false); }
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

  const currentCategory = activeTab === 'entertainer' ? 'entertainer' : activeTab === 'crew_oc' ? 'crew_oc' : activeTab === 'designer' ? 'designer' : activeTab === 'game_ideas' ? 'game_ideas' : 'general';
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

  const [expandedHangmanId, setExpandedHangmanId] = useState(null);
  const [guessingLetter, setGuessingLetter] = useState(null);

  const handleGuessLetter = async (gameId, letter) => {
    setGuessingLetter(letter);
    try {
      const res = await api.post(`/forum/entertainer/games/${gameId}/guess`, { letter });
      fetchEntertainerGames();
      fetchEntertainerHistory();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
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
          {activeTab === 'entertainer' && !isAdmin && (
            <button
              onClick={() => setGameModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 border border-primary/50 text-primary text-xs font-heading font-bold uppercase rounded hover:bg-primary/30 transition-all"
            >
              <Dice5 size={14} /> New Game
            </button>
          )}
          {activeTab !== 'crew_oc' && activeTab !== 'game_ideas' && (
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

          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between flex-wrap gap-1">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🎲 Auto games</span>
              <span className="text-[10px] text-mutedForeground">Free to join · Win random: cash, bullets, tokens, cars · Rolls when full or 20 mins before next batch</span>
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
                    <div key={g.id}>
                    <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded bg-primary/20 border border-primary/30">
                          {g.game_type === 'dice' ? (
                            <Dice5 size={14} className="text-primary" />
                          ) : g.game_type === 'hangman' ? (
                            <Puzzle size={14} className="text-primary" />
                          ) : (
                            <Package size={14} className="text-primary" />
                          )}
                        </div>
                        <div>
                          <span className="text-xs font-heading font-bold text-foreground capitalize">{g.game_type}</span>
                          <span className="text-[10px] text-mutedForeground ml-2">
                            <Users size={10} className="inline" /> {participants.length}/{g.max_players}
                          </span>
                          <span className="text-primary text-[10px] ml-2">Winnings: cash, bullets, tokens, cars</span>
                          {g.game_type === 'hangman' && g.hangman && (
                            <span className="text-[10px] text-amber-400 ml-2">
                              {(g.hangman.wrong_count || 0)}/{g.hangman.max_wrong || 6} misses · {(g.hangman.revealed_pattern || []).filter(c => c !== '_').length}/{g.hangman.word_length || 0} revealed
                            </span>
                          )}
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
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 f-fade-in mobile-panel`}>
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
                      censorProfanity={user?.censor_profanity}
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
                      censorProfanity={user?.censor_profanity}
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
                  censorProfanity={user?.censor_profanity}
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

      <CreateTopicModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onCreated={fetchTopics} category={currentCategory} canUseColors={isAdmin || isModerator} />
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
