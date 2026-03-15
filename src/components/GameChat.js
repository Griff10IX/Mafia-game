import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Send, Settings, UserX, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../utils/api';
import { getApiErrorMessage } from '../utils/api';
import { toast } from 'sonner';
import GifPicker from './GifPicker';
import { filterProfanity } from '../utils/profanityFilter';

const POLL_INTERVAL_MS = 10000;
const MAX_MESSAGE_LEN = 500;
const GAME_CHAT_MINIMIZED_KEY = 'game_chat_minimized';

function getStoredMinimized() {
  try {
    return localStorage.getItem(GAME_CHAT_MINIMIZED_KEY) === '1';
  } catch (_) {
    return false;
  }
}

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

const CHAT_EMOJIS = [
  '😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😎', '🤩', '😍', 
  '😂', '🤣', '😅', '😢', '😭', '😤', '😡', '🤬', '😱', '😰',
  '🤔', '😐', '😑', '🙄', '😏', '😒', '🥱', '😴', '🤢', '🤮',
  '👍', '👎', '👋', '🤝', '🙏', '💪', '✊', '👊', '🤙', '✌️',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '❣️', '💕',
  '🔥', '⭐', '✨', '💥', '💯', '🎉', '🎊', '🏆', '👑', '💎',
  '💰', '💵', '💸', '🔫', '💀', '☠️', '⚔️', '🔪', '🎲', '🃏',
  '🎩', '🚬', '🥃', '🍷', '👔', '💼', '🕴️', '🎭', '🚗', '🏠',
  '❓', '❗', '⚠️', '✅', '❌', '🚫', '➕', '➖', '➡️', '⬅️'
];

function formatChatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function GameChat({ myUserId, onCloseSidebar, censorProfanity = false, canClearChat = false }) {
  const [messages, setMessages] = useState([]);
  const [prefs, setPrefs] = useState({ family_only: false, blocked_user_ids: [], block_list_with_names: [], in_family: false, muted: false, muted_until: null });
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [isMinimized, setIsMinimized] = useState(getStoredMinimized);
  const scrollRef = useRef(null);
  const shouldScrollToTopRef = useRef(false);

  const toggleMinimized = () => {
    setIsMinimized((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(GAME_CHAT_MINIMIZED_KEY, next ? '1' : '0');
      } catch (_) {}
      return next;
    });
  };

  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get('/game-chat/messages', { params: { limit: 10 } });
      setMessages(res.data.messages || []);
    } catch (e) {
      if (loading) setMessages([]);
    } finally {
      if (loading) setLoading(false);
    }
  }, [loading]);

  const fetchPrefs = useCallback(async () => {
    try {
      const res = await api.get('/game-chat/prefs');
      setPrefs({
        family_only: res.data.family_only === true,
        blocked_user_ids: res.data.blocked_user_ids || [],
        block_list_with_names: res.data.block_list_with_names || [],
        in_family: res.data.in_family === true,
        muted: res.data.muted === true,
        muted_until: res.data.muted_until || null,
      });
    } catch (_) {
      setPrefs({ family_only: false, blocked_user_ids: [], block_list_with_names: [], in_family: false, muted: false, muted_until: null });
    }
  }, []);

  useEffect(() => { fetchPrefs(); }, [fetchPrefs]);

  useEffect(() => {
    fetchMessages();
    const t = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchMessages]);

  useEffect(() => {
    if (!messages.length) return;
    if (shouldScrollToTopRef.current) {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      shouldScrollToTopRef.current = false;
    }
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = (input || '').trim();
    if (!text || sending) return;
    if (text.length > MAX_MESSAGE_LEN) {
      toast.error(`Message must be ${MAX_MESSAGE_LEN} characters or less`);
      return;
    }
    setSending(true);
    try {
      const res = await api.post('/game-chat/send', { message: text });
      setInput('');
      shouldScrollToTopRef.current = true;
      // Optimistically add sent message so we don't depend on fetchMessages; it may fail with 500
      const sent = res.data?.message;
      if (sent) {
        setMessages((prev) => [...prev, sent].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
      }
      fetchMessages().catch(() => {}); // Refresh in background; ignore errors (poll will retry)
    } catch (err) {
      const status = err.response?.status;
      const msg = status === 500
        ? 'Send failed; your message may still appear in a moment.'
        : getApiErrorMessage(err);
      toast.error(msg);
      // Refetch after short delay — server may have saved the message but returned 500
      setTimeout(() => fetchMessages().catch(() => {}), 1500);
    } finally {
      setSending(false);
    }
  };

  const handleClearChat = async () => {
    if (!canClearChat || clearingChat) return;
    if (!window.confirm('Clear all game chat messages? This cannot be undone.')) return;
    setClearingChat(true);
    try {
      await api.delete('/game-chat/messages');
      setMessages([]);
      toast.success('Game chat cleared');
      fetchMessages().catch(() => {});
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setClearingChat(false);
    }
  };

  const handleSendGif = async (gifUrl) => {
    if (!gifUrl || sending) return;
    setSending(true);
    setShowGifPicker(false);
    try {
      const res = await api.post('/game-chat/send', { message: '(GIF)', gif_url: gifUrl });
      shouldScrollToTopRef.current = true;
      const sent = res.data?.message;
      if (sent) {
        setMessages((prev) => [...prev, sent].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
      }
      fetchMessages().catch(() => {});
    } catch (err) {
      const status = err.response?.status;
      const msg = status === 500
        ? 'Send failed; your message may still appear in a moment.'
        : getApiErrorMessage(err);
      toast.error(msg);
      setTimeout(() => fetchMessages().catch(() => {}), 1500);
    } finally {
      setSending(false);
    }
  };

  const insertEmoji = (emoji) => setInput((t) => t + emoji);

  const setFamilyOnly = async (value) => {
    try {
      await api.patch('/game-chat/prefs', { family_only: value });
      setPrefs((p) => ({ ...p, family_only: value }));
      await fetchMessages();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const blockUser = async (userId, username) => {
    if (userId === myUserId) return;
    try {
      await api.post(`/game-chat/block/${userId}`);
      await fetchPrefs();
      setMessages((prev) => prev.filter((m) => m.user_id !== userId));
      toast.success(`Blocked ${username || 'user'}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const unblockUser = async (userId) => {
    try {
      await api.delete(`/game-chat/block/${userId}`);
      await fetchPrefs();
      await fetchMessages();
      toast.success('User unblocked');
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  return (
    <div className="flex flex-col min-h-0 border-t mt-2 w-full" data-chat-surface="game" style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.12)' }}>

      {/* ── Header (always visible; when minimized this is the only row) ── */}
      <div
        data-chat-part="header"
        className="flex items-center justify-between px-2 sm:px-3 py-2 sm:py-2 shrink-0 min-h-[44px] cursor-pointer select-none"
        style={{ background: 'rgba(var(--noir-primary-rgb), 0.06)', borderBottom: isMinimized ? 'none' : '1px solid rgba(var(--noir-primary-rgb), 0.12)' }}
        onClick={isMinimized ? toggleMinimized : undefined}
        role={isMinimized ? 'button' : undefined}
        tabIndex={isMinimized ? 0 : undefined}
        onKeyDown={isMinimized ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMinimized(); } } : undefined}
        aria-expanded={!isMinimized}
        aria-label={isMinimized ? 'Expand game chat' : undefined}
      >
        <span
          className="text-[9px] sm:text-[9px] font-heading uppercase tracking-widest flex items-center gap-1.5"
          style={{ color: 'var(--noir-primary)' }}
        >
          <MessageSquare size={10} className="shrink-0" />
          Game Chat
        </span>

        <div className="flex items-center gap-1" onClick={(e) => !isMinimized && e.stopPropagation()}>
          {!isMinimized && (
            <button
              type="button"
              onClick={toggleMinimized}
              className="min-w-[36px] min-h-[36px] sm:min-w-[28px] sm:min-h-[28px] flex items-center justify-center rounded transition-colors hover:opacity-80 touch-manipulation active:scale-95"
              style={{ color: 'rgba(var(--noir-primary-rgb), 0.6)' }}
              aria-label="Minimize chat"
            >
              <ChevronDown size={14} className="shrink-0" />
            </button>
          )}
          {isMinimized && (
            <span className="flex items-center" style={{ color: 'rgba(var(--noir-primary-rgb), 0.6)' }} aria-hidden>
              <ChevronUp size={14} className="shrink-0" />
            </span>
          )}
          {/* Settings — touch-friendly on mobile (only when expanded) */}
          {!isMinimized && <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              className="min-w-[44px] min-h-[44px] -m-1 flex items-center justify-center rounded transition-colors hover:opacity-80 touch-manipulation active:scale-95 md:min-w-0 md:min-h-0 md:p-0.5"
              style={{ color: 'rgba(var(--noir-primary-rgb), 0.5)' }}
              aria-label="Chat settings"
            >
              <Settings size={12} className="shrink-0" />
            </button>

            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => setSettingsOpen(false)} />
                <div
                  className="absolute right-0 top-full mt-0.5 z-20 py-2 px-2 rounded border shadow-lg min-w-[160px] w-full max-w-[200px] sm:w-auto sm:max-w-none"
                  style={{ backgroundColor: 'var(--noir-content)', borderColor: 'var(--noir-border-mid)' }}
                >
                  {canClearChat && (
                    <div className="pb-2 mb-2 border-b border-zinc-700/50">
                      <button
                        type="button"
                        onClick={() => { setSettingsOpen(false); handleClearChat(); }}
                        disabled={clearingChat}
                        className="w-full text-left text-[10px] font-heading py-1.5 px-1 rounded hover:bg-red-500/10 text-red-400 disabled:opacity-50"
                      >
                        {clearingChat ? 'Clearing…' : 'Clear game chat'}
                      </button>
                    </div>
                  )}
                  {prefs.in_family && (
                    <label className="flex items-center gap-2 cursor-pointer text-[10px] font-heading py-1 px-1 rounded hover:bg-primary/5">
                      <input
                        type="checkbox"
                        checked={prefs.family_only}
                        onChange={(e) => setFamilyOnly(e.target.checked)}
                        className="rounded border-primary/50"
                      />
                      <span style={{ color: 'var(--noir-foreground)' }}>Family only</span>
                    </label>
                  )}
                  {prefs.blocked_user_ids.length > 0 && (
                    <div className="mt-1 pt-1 border-t border-zinc-700/50">
                      <p className="text-[9px] font-heading uppercase px-1 mb-0.5" style={{ color: 'var(--noir-muted-foreground)' }}>Blocked</p>
                      {(prefs.block_list_with_names?.length
                        ? prefs.block_list_with_names
                        : prefs.blocked_user_ids.map((uid) => ({ user_id: uid, username: uid }))
                      ).slice(0, 10).map((item) => (
                        <div key={item.user_id} className="flex items-center justify-between gap-1 py-0.5 px-1 text-[10px]">
                          <Link to={`/profile/${encodeURIComponent(item.username)}`} className="truncate hover:underline" style={{ color: 'var(--noir-primary)' }}>{item.username}</Link>
                          <button
                            type="button"
                            onClick={() => unblockUser(item.user_id)}
                            className="shrink-0 hover:underline"
                            style={{ color: 'var(--noir-primary)' }}
                          >
                            Unblock
                          </button>
                        </div>
                      ))}
                      {prefs.blocked_user_ids.length > 10 && (
                        <p className="text-[9px] px-1" style={{ color: 'var(--noir-muted-foreground)' }}>
                          +{prefs.blocked_user_ids.length - 10} more
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>}
        </div>
      </div>

      {!isMinimized && (
        <>
      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        data-chat-part="messages"
        className="flex-1 min-h-[180px] max-h-[400px] sm:min-h-[200px] sm:max-h-[380px] overflow-y-auto overflow-x-hidden scrollbar-thin touch-pan-y"
        style={{ scrollbarColor: 'rgba(var(--noir-primary-rgb), 0.15) transparent' }}
      >
        {prefs.muted && (
          <p className="text-[9px] font-heading px-3 py-2 text-amber-400">
            You are muted. Contact staff if this is a mistake.
          </p>
        )}

        {loading ? (
          <p className="text-[9px] font-heading px-3 py-2" style={{ color: 'var(--noir-muted-foreground)' }}>
            Loading...
          </p>
        ) : messages.length === 0 ? (
          <p className="text-[9px] font-heading px-3 py-2 italic" style={{ color: 'var(--noir-muted-foreground)' }}>
            No messages yet. Say something.
          </p>
        ) : (
          [...messages].reverse().map((m) => {
            const isOwn = m.user_id === myUserId;
            return (
              <div
                key={m.id}
                data-chat-part="message-row"
                data-chat-own={isOwn ? 'true' : 'false'}
                className="group relative px-2 sm:px-3 py-1.5 sm:py-1"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
              >
                {/* Inline name + message */}
                <div className="text-[11px] sm:text-[11px] leading-snug break-words pr-12 sm:pr-10">
                  <Link
                    to={`/profile/${encodeURIComponent(m.username)}`}
                    className="font-heading text-[9.5px] font-bold mr-1 shrink-0 hover:underline"
                    style={{ color: isOwn ? 'var(--noir-primary)' : 'rgba(var(--noir-primary-rgb), 0.75)' }}
                  >
                    {m.username}
                  </Link>
                  <span className="text-[9px] mr-1.5" style={{ color: 'rgba(255,255,255,0.18)' }}>·</span>
                  {m.gif_url && (
                    <span className="block mt-1">
                      <img
                        src={m.gif_url}
                        alt="GIF"
                        className="rounded max-h-32 sm:max-h-40 max-w-full object-contain"
                        style={{ border: '1px solid rgba(var(--noir-primary-rgb), 0.18)', background: 'rgba(0,0,0,0.4)' }}
                        loading="lazy"
                      />
                    </span>
                  )}
                  {m.message && m.message !== '(GIF)' && (
                    <span data-chat-part="message-text" style={{ color: 'rgba(255,255,255,0.68)' }}>{censorProfanity ? filterProfanity(m.message) : m.message}</span>
                  )}
                </div>

                {/* Timestamp */}
                <div data-chat-part="timestamp" className="text-[8.5px] font-heading mt-0.5" style={{ color: 'rgba(255,255,255,0.2)', letterSpacing: '0.04em' }}>
                  {formatChatTime(m.created_at)}
                </div>

                {/* Block button — always visible on touch (mobile), hover on desktop */}
                {!isOwn && (
                  <button
                    type="button"
                    onClick={() => blockUser(m.user_id, m.username)}
                    className="absolute right-1 top-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-0.5 text-[8px] font-heading px-2 py-1 sm:px-1.5 sm:py-0.5 rounded min-h-[32px] min-w-[32px] items-center justify-center sm:min-h-0 sm:min-w-0 touch-manipulation active:scale-95"
                    style={{ color: 'rgba(248,113,113,0.6)', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(248,113,113,0.15)' }}
                    title={`Block ${m.username}`}
                  >
                    <UserX size={10} /> <span className="hidden sm:inline">Block</span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── GIF Picker ── */}
      {showGifPicker && (
        <div className="shrink-0 px-2 pt-1 max-h-[45vh] sm:max-h-none overflow-y-auto">
          <GifPicker compact onSelect={handleSendGif} onClose={() => setShowGifPicker(false)} />
        </div>
      )}

      {/* ── Input area ── */}
      <div
        data-chat-part="composer"
        className="shrink-0 px-2 pt-2 pb-2 flex flex-col gap-1.5"
        style={{ borderTop: '1px solid rgba(var(--noir-primary-rgb), 0.1)', background: 'rgba(0,0,0,0.2)' }}
      >
        {/* Text input + action buttons — touch-friendly on mobile */}
        <form onSubmit={handleSend} className="flex items-stretch gap-1 flex-wrap sm:flex-nowrap">
          <input
            type="text"
            data-chat-part="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={prefs.muted ? 'Muted' : 'Say something, wise guy...'}
            maxLength={MAX_MESSAGE_LEN}
            disabled={prefs.muted}
            className="flex-1 min-w-0 text-[11px] px-2.5 py-2.5 sm:py-1.5 rounded-sm disabled:opacity-60 disabled:cursor-not-allowed outline-none transition-colors min-h-[44px] sm:min-h-0"
            style={{
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(var(--noir-primary-rgb), 0.18)',
              color: 'var(--noir-foreground)',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'rgba(var(--noir-primary-rgb), 0.45)')}
            onBlur={(e) => (e.target.style.borderColor = 'rgba(var(--noir-primary-rgb), 0.18)')}
          />

          {/* GIF */}
          <button
            type="button"
            data-chat-part="aux-btn"
            onClick={() => setShowGifPicker((v) => !v)}
            disabled={prefs.muted}
            className="shrink-0 min-w-[36px] min-h-[44px] sm:min-w-0 sm:min-h-0 px-2 rounded-sm font-heading text-[9px] tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center touch-manipulation active:scale-95"
            style={{
              background: 'rgba(var(--noir-primary-rgb), 0.07)',
              border: '1px solid rgba(var(--noir-primary-rgb), 0.2)',
              color: 'rgba(var(--noir-primary-rgb), 0.7)',
            }}
            title="GIF"
          >
            GIF
          </button>

          {/* Emoji toggle */}
          <button
            type="button"
            data-chat-part="aux-btn"
            onClick={() => setShowEmojis((v) => !v)}
            disabled={prefs.muted}
            className="shrink-0 min-w-[36px] min-h-[44px] sm:min-w-0 sm:min-h-0 px-2 rounded-sm text-[13px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center touch-manipulation active:scale-95"
            style={{
              background: 'rgba(var(--noir-primary-rgb), 0.07)',
              border: '1px solid rgba(var(--noir-primary-rgb), 0.2)',
            }}
            title={showEmojis ? 'Hide emoji' : 'Emoji'}
          >
            😀
          </button>

          {/* Send */}
          <button
            type="submit"
            data-chat-part="send"
            disabled={sending || prefs.muted || !(input || '').trim()}
            className="shrink-0 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 px-2.5 rounded-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center touch-manipulation active:scale-95"
            style={{
              background: 'rgba(var(--noir-primary-rgb), 0.15)',
              border: '1px solid rgba(var(--noir-primary-rgb), 0.35)',
              color: 'var(--noir-primary)',
            }}
            aria-label="Send"
          >
            <Send size={12} />
          </button>
        </form>

        {/* Emoji strip — horizontal scrolling, touch-friendly buttons */}
        {showEmojis && (
          <div
            className="flex gap-1 overflow-x-auto overflow-y-hidden py-0.5 -mx-0.5 flex-wrap"
            style={{ scrollbarWidth: 'none' }}
          >
            {/* Classic forum smileys first */}
            {CLASSIC_SMILEYS.map(({ code, img }) => (
              <button
                key={code}
                type="button"
                onClick={() => insertEmoji(code)}
                className="shrink-0 min-w-[36px] min-h-[36px] w-9 h-9 sm:w-6 sm:h-6 sm:min-w-[24px] sm:min-h-[24px] flex items-center justify-center rounded-sm transition-colors touch-manipulation active:scale-95 hover:scale-110"
                style={{ border: '1px solid transparent' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(var(--noir-primary-rgb), 0.1)';
                  e.currentTarget.style.borderColor = 'rgba(var(--noir-primary-rgb), 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
                title={code}
              >
                <img src={`/images/smileys/${img}.png`} alt={code} className="w-5 h-5" />
              </button>
            ))}
            {/* Modern emojis */}
            {CHAT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => insertEmoji(emoji)}
                className="shrink-0 min-w-[36px] min-h-[36px] w-9 h-9 sm:w-6 sm:h-6 sm:min-w-[24px] sm:min-h-[24px] flex items-center justify-center rounded-sm text-[13px] transition-colors touch-manipulation active:scale-95"
                style={{ border: '1px solid transparent' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(var(--noir-primary-rgb), 0.1)';
                  e.currentTarget.style.borderColor = 'rgba(var(--noir-primary-rgb), 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
