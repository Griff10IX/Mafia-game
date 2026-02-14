import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import GifPicker from '../components/GifPicker';
import styles from '../styles/noir.module.css';

function formatTime(dateString) {
  const d = new Date(dateString);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Gangster / noir themed — money, power, danger, no hearts/cutesy
const CHAT_EMOJIS = [
  '💰', '💵', '💎', '🎩', '🔫', '⚔️', '🔪', '💀', '🚬', '🥃', '🍷', '🎲', '🃏', '👔', '💼', '🕴️', '🏆', '👑', '✨', '💪', '👍', '😎', '🎭',
];

export default function InboxChat() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [thread, setThread] = useState([]);
  const [otherUsername, setOtherUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const insertEmoji = (emoji) => setReplyText((t) => t + emoji);

  const handleSendGif = async (gifUrl) => {
    if (!gifUrl || sending) return;
    setSending(true);
    setShowGifPicker(false);
    try {
      await api.post('/notifications/send', {
        target_username: otherUsername,
        message: '(GIF)',
        gif_url: gifUrl,
      });
      await fetchThread();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to send GIF');
    } finally {
      setSending(false);
    }
  };

  const fetchThread = async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/notifications/thread/${userId}`);
      setThread(res.data.thread || []);
      setOtherUsername(res.data.other_username || 'User');
    } catch (e) {
      toast.error(e.response?.status === 404 ? 'User not found' : 'Failed to load chat');
      navigate('/inbox');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchThread();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread]);

  const handleSend = async (e) => {
    e.preventDefault();
    const msg = (replyText || '').trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await api.post('/notifications/send', {
        target_username: otherUsername,
        message: msg,
        gif_url: null,
      });
      setReplyText('');
      await fetchThread();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className={`${styles.pageContent} ${styles.page}`}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <span className="text-primary font-heading">Loading chat...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.pageContent} flex flex-col h-[calc(100vh-8rem)] max-h-[800px] min-h-[400px]`}>
      {/* Header */}
      <div className="flex items-center gap-3 py-3 border-b border-primary/20 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/inbox')}
          className="p-2 rounded-md text-mutedForeground hover:text-primary hover:bg-primary/10 transition-colors"
          aria-label="Back to inbox"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-heading font-bold text-foreground truncate">
            {otherUsername}
          </h1>
          <p className="text-xs text-mutedForeground font-heading">Direct message</p>
        </div>
      </div>

      {/* Messages (Telegram-style bubbles) */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-background/50"
      >
        {thread.length === 0 ? (
          <p className="text-sm text-mutedForeground font-heading text-center py-8">
            No messages yet. Say something below.
          </p>
        ) : (
          thread.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 ${
                  msg.from_me
                    ? 'bg-primary text-primaryForeground rounded-br-md'
                    : 'bg-card border border-primary/20 text-foreground rounded-bl-md'
                }`}
              >
                <p className="text-sm font-heading whitespace-pre-wrap break-words">
                  {msg.message}
                </p>
                {msg.gif_url && (
                  <img
                    src={msg.gif_url}
                    alt="GIF"
                    className="mt-2 rounded-lg max-w-full max-h-40 object-cover"
                  />
                )}
                <p
                  className={`text-[10px] mt-1 ${
                    msg.from_me ? 'text-primaryForeground/80' : 'text-mutedForeground'
                  }`}
                >
                  {formatTime(msg.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply box (Telegram-style input at bottom) + GIPHY + gangster emojis below */}
      <form
        onSubmit={handleSend}
        className="p-3 border-t border-primary/20 bg-card shrink-0"
      >
        {showGifPicker && (
          <div className="mb-2">
            <GifPicker
              onSelect={handleSendGif}
              onClose={() => setShowGifPicker(false)}
            />
          </div>
        )}
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            onClick={() => setShowGifPicker((v) => !v)}
            className="shrink-0 w-10 h-10 rounded-full border border-primary/30 text-primary flex items-center justify-center hover:bg-primary/10 transition-colors"
            title="Search GIFs"
            aria-label="GIF"
          >
            GIF
          </button>
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Message..."
            className={`flex-1 ${styles.input} rounded-2xl px-4 py-2.5 text-sm font-heading border border-primary/30 focus:border-primary/60 focus:outline-none`}
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !replyText.trim()}
            className="shrink-0 w-10 h-10 rounded-full bg-primary text-primaryForeground flex items-center justify-center hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            aria-label="Send"
          >
            <Send size={18} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {CHAT_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => insertEmoji(emoji)}
              className="text-lg leading-none p-1.5 rounded hover:bg-primary/20 transition-all focus:outline-none focus:ring-1 focus:ring-primary/50"
              title="Insert emoji"
              aria-label="Insert emoji"
            >
              {emoji}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
