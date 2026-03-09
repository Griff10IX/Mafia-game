import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, Settings, UserX } from 'lucide-react';
import api from '../utils/api';
import { getApiErrorMessage } from '../utils/api';
import { toast } from 'sonner';
import GifPicker from './GifPicker';

const POLL_INTERVAL_MS = 5000;
const MAX_MESSAGE_LEN = 500;

// Same gangster/noir themed strip as InboxChat
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
  const messagesEndRef = useRef(null);
  const scrollRef = useRef(null);
  const shouldScrollToBottomRef = useRef(false);

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

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  useEffect(() => {
    fetchMessages();
    const t = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchMessages]);

  useEffect(() => {
    if (!messages.length) return;
    if (shouldScrollToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      shouldScrollToBottomRef.current = false;
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
      shouldScrollToBottomRef.current = true;
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
      shouldScrollToBottomRef.current = true;
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
    <div className="flex flex-col h-full min-h-0 border-t pt-2 mt-2" style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.12)' }}>
      <div className="flex items-center justify-between gap-1 shrink-0 mb-1.5">
        <span className="text-[10px] font-heading uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--noir-primary)' }}>
          <MessageSquare size={10} /> Game Chat
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            className="p-0.5 rounded hover:bg-primary/10 transition-colors"
            style={{ color: 'var(--noir-primary)' }}
            aria-label="Chat settings"
          >
            <Settings size={12} />
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
                      onChange={(e) => { setFamilyOnly(e.target.checked); }}
                      className="rounded border-primary/50"
                    />
                    <span style={{ color: 'var(--noir-foreground)' }}>Family only</span>
                  </label>
                )}
                {prefs.blocked_user_ids.length > 0 && (
                  <div className="mt-1 pt-1 border-t border-zinc-700/50">
                    <p className="text-[9px] font-heading uppercase text-mutedForeground px-1 mb-0.5">Blocked</p>
                    {(prefs.block_list_with_names?.length ? prefs.block_list_with_names : prefs.blocked_user_ids.map((uid) => ({ user_id: uid, username: uid }))).slice(0, 10).map((item) => (
                      <div key={item.user_id} className="flex items-center justify-between gap-1 py-0.5 px-1 text-[10px]">
                        <span className="truncate" style={{ color: 'var(--noir-foreground)' }}>{item.username}</span>
                        <button type="button" onClick={() => unblockUser(item.user_id)} className="text-primary hover:underline shrink-0" title="Unblock">Unblock</button>
                      </div>
                    ))}
                    {prefs.blocked_user_ids.length > 10 && <p className="text-[9px] text-mutedForeground px-1">+{prefs.blocked_user_ids.length - 10} more</p>}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-[120px] max-h-[200px] overflow-y-auto overflow-x-hidden space-y-1 pr-0.5 scrollbar-thin">
        {prefs.muted && (
          <p className="text-[10px] text-amber-400 font-heading py-1">You are muted from game chat. Contact staff if you think this is a mistake.</p>
        )}
        {loading ? (
          <p className="text-[10px] text-mutedForeground font-heading">Loading...</p>
        ) : messages.length === 0 ? (
          <p className="text-[10px] text-mutedForeground font-heading">No messages yet. Say something.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="group relative">
              <div className="text-[10px] leading-tight break-words">
                <div className="font-heading font-bold shrink-0" style={{ color: 'var(--noir-primary)' }}>{m.username}</div>
                {m.gif_url && (
                  <div className="mt-0.5">
                    <img src={m.gif_url} alt="GIF" className="rounded max-h-40 w-full object-contain bg-zinc-900/50" loading="lazy" />
                  </div>
                )}
                {m.message && m.message !== '(GIF)' && (
                  <div className="mt-0.5" style={{ color: 'var(--noir-foreground)' }}>{m.message}</div>
                )}
              </div>
              <div className="text-[9px] text-mutedForeground mt-0.5">{formatChatTime(m.created_at)}</div>
              {m.user_id !== myUserId && (
                <button
                  type="button"
                  onClick={() => blockUser(m.user_id, m.username)}
                  className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-red-400 hover:bg-red-400/10 flex items-center gap-0.5 text-[9px] font-heading"
                  title={`Block ${m.username}`}
                >
                  <UserX size={10} /> Block
                </button>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {showGifPicker && (
        <div className="shrink-0 mt-1">
          <GifPicker onSelect={handleSendGif} onClose={() => setShowGifPicker(false)} />
        </div>
      )}

      <form onSubmit={handleSend} className="shrink-0 flex gap-1 mt-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={prefs.muted ? 'Muted' : 'Message...'}
          maxLength={MAX_MESSAGE_LEN}
          disabled={prefs.muted}
          className="flex-1 min-w-0 text-[10px] font-heading px-2 py-1.5 rounded border bg-zinc-900/80 placeholder:text-mutedForeground disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-foreground)' }}
        />
        <button
          type="button"
          onClick={() => setShowGifPicker((v) => !v)}
          disabled={prefs.muted}
          className="shrink-0 p-1.5 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="GIF"
          aria-label="Pick GIF"
        >
          <span className="text-[10px] font-heading">GIF</span>
        </button>
        <button
          type="button"
          onClick={() => setShowEmojis((e) => !e)}
          disabled={prefs.muted}
          className="shrink-0 p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground text-[10px] font-heading transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={showEmojis ? 'Hide emoji' : 'Emoji'}
          aria-label="Toggle emoji"
        >
          😀
        </button>
        <button
          type="submit"
          disabled={sending || prefs.muted || !(input || '').trim()}
          className="shrink-0 p-1.5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Send"
        >
          <Send size={12} />
        </button>
      </form>
      {showEmojis && (
        <div className="flex flex-wrap gap-0.5 mt-1">
          {CHAT_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => insertEmoji(emoji)}
              className="w-7 h-7 flex items-center justify-center rounded border border-transparent hover:bg-primary/10 hover:border-primary/20 text-sm"
              title="Insert emoji"
              aria-label="Insert emoji"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
