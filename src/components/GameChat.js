import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, Settings, UserX } from 'lucide-react';
import api from '../utils/api';
import { getApiErrorMessage } from '../utils/api';
import { toast } from 'sonner';
import GifPicker from './GifPicker';

const POLL_INTERVAL_MS = 5000;
const MAX_MESSAGE_LEN = 500;

const CHAT_EMOJIS = [
  '💰', '💵', '💎', '🎩', '🔫', '⚔️', '🔪', '💀', '🚬', '🥃', '🍷', '🎲', '🃏', '👔', '💼', '🕴️', '🏆', '👑', '✨', '💪', '👍', '😎', '🎭',
];

function formatChatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function GameChat({ myUserId, onCloseSidebar }) {
  const [messages, setMessages] = useState([]);
  const [prefs, setPrefs] = useState({ family_only: false, blocked_user_ids: [], block_list_with_names: [], in_family: false, muted: false, muted_until: null });
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const scrollRef = useRef(null);
  const shouldScrollToTopRef = useRef(false);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get('/game-chat/messages', { params: { limit: 50 } });
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
      await api.post('/game-chat/send', { message: text });
      setInput('');
      shouldScrollToTopRef.current = true;
      await fetchMessages();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleSendGif = async (gifUrl) => {
    if (!gifUrl || sending) return;
    setSending(true);
    setShowGifPicker(false);
    try {
      await api.post('/game-chat/send', { message: '(GIF)', gif_url: gifUrl });
      shouldScrollToTopRef.current = true;
      await fetchMessages();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
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
    <div className="flex flex-col min-h-0 border-t mt-2" style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.12)' }}>

      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ background: 'rgba(var(--noir-primary-rgb), 0.06)', borderBottom: '1px solid rgba(var(--noir-primary-rgb), 0.12)' }}
      >
        <span
          className="text-[9px] font-heading uppercase tracking-widest flex items-center gap-1.5"
          style={{ color: 'var(--noir-primary)' }}
        >
          <MessageSquare size={9} />
          Game Chat
        </span>

        <div className="flex items-center gap-2">
          {/* Settings */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              className="p-0.5 rounded transition-colors hover:opacity-80"
              style={{ color: 'rgba(var(--noir-primary-rgb), 0.5)' }}
              aria-label="Chat settings"
            >
              <Settings size={11} />
            </button>

            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => setSettingsOpen(false)} />
                <div
                  className="absolute right-0 top-full mt-0.5 z-20 py-2 px-2 rounded border shadow-lg min-w-[160px]"
                  style={{ backgroundColor: 'var(--noir-content)', borderColor: 'var(--noir-border-mid)' }}
                >
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
                          <span className="truncate" style={{ color: 'var(--noir-foreground)' }}>{item.username}</span>
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
          </div>
        </div>
      </div>

      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-[130px] max-h-[200px] overflow-y-auto overflow-x-hidden scrollbar-thin"
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
                className="group relative px-3 py-1"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
              >
                {/* Inline name + message */}
                <div className="text-[11px] leading-snug break-words">
                  <span
                    className="font-heading text-[9.5px] font-bold mr-1 shrink-0"
                    style={{ color: isOwn ? 'var(--noir-primary)' : 'rgba(var(--noir-primary-rgb), 0.75)' }}
                  >
                    {m.username}
                  </span>
                  <span className="text-[9px] mr-1.5" style={{ color: 'rgba(255,255,255,0.18)' }}>·</span>
                  {m.gif_url && (
                    <span className="block mt-1">
                      <img
                        src={m.gif_url}
                        alt="GIF"
                        className="rounded max-h-40 max-w-full object-contain"
                        style={{ border: '1px solid rgba(var(--noir-primary-rgb), 0.18)', background: 'rgba(0,0,0,0.4)' }}
                        loading="lazy"
                      />
                    </span>
                  )}
                  {m.message && m.message !== '(GIF)' && (
                    <span style={{ color: 'rgba(255,255,255,0.68)' }}>{m.message}</span>
                  )}
                </div>

                {/* Timestamp */}
                <div className="text-[8.5px] font-heading mt-0.5" style={{ color: 'rgba(255,255,255,0.2)', letterSpacing: '0.04em' }}>
                  {formatChatTime(m.created_at)}
                </div>

                {/* Block button — hover only */}
                {!isOwn && (
                  <button
                    type="button"
                    onClick={() => blockUser(m.user_id, m.username)}
                    className="absolute right-2 top-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 text-[8px] font-heading px-1.5 py-0.5 rounded"
                    style={{ color: 'rgba(248,113,113,0.6)', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(248,113,113,0.15)' }}
                    title={`Block ${m.username}`}
                  >
                    <UserX size={9} /> Block
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── GIF Picker ── */}
      {showGifPicker && (
        <div className="shrink-0 px-2 pt-1">
          <GifPicker compact onSelect={handleSendGif} onClose={() => setShowGifPicker(false)} />
        </div>
      )}

      {/* ── Input area ── */}
      <div
        className="shrink-0 px-2 pt-2 pb-2 flex flex-col gap-1.5"
        style={{ borderTop: '1px solid rgba(var(--noir-primary-rgb), 0.1)', background: 'rgba(0,0,0,0.2)' }}
      >
        {/* Text input + action buttons */}
        <form onSubmit={handleSend} className="flex items-stretch gap-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={prefs.muted ? 'Muted' : 'Say something, wise guy...'}
            maxLength={MAX_MESSAGE_LEN}
            disabled={prefs.muted}
            className="flex-1 min-w-0 text-[11px] px-2.5 py-1.5 rounded-sm disabled:opacity-60 disabled:cursor-not-allowed outline-none transition-colors"
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
            onClick={() => setShowGifPicker((v) => !v)}
            disabled={prefs.muted}
            className="shrink-0 px-2 rounded-sm font-heading text-[9px] tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
            onClick={() => setShowEmojis((v) => !v)}
            disabled={prefs.muted}
            className="shrink-0 px-2 rounded-sm text-[13px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
            disabled={sending || prefs.muted || !(input || '').trim()}
            className="shrink-0 px-2.5 rounded-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(var(--noir-primary-rgb), 0.15)',
              border: '1px solid rgba(var(--noir-primary-rgb), 0.35)',
              color: 'var(--noir-primary)',
            }}
            aria-label="Send"
          >
            <Send size={11} />
          </button>
        </form>

        {/* Emoji strip — horizontal scrolling, no wrap */}
        {showEmojis && (
          <div
            className="flex gap-0.5 overflow-x-auto"
            style={{ scrollbarWidth: 'none' }}
          >
            {CHAT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => insertEmoji(emoji)}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-sm text-[13px] transition-colors"
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
    </div>
  );
}
