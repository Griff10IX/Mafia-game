import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import GifPicker from '../../components/GifPicker';
import { parseForumContent } from '../../utils/forumContent';
import styles from '../../styles/noir.module.css';

function formatTime(dateString) {
  const d = new Date(dateString);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

const SMILEY_IMG_BASE = `${process.env.PUBLIC_URL || ''}/images/smileys`;

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

export default function InboxChat() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [thread, setThread] = useState([]);
  const [otherUsername, setOtherUsername] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [censorProfanity, setCensorProfanity] = useState(false);
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    api.get('/profile/censor-profanity').then((res) => {
      setCensorProfanity(res.data?.censor_profanity === true);
    }).catch(() => {});
  }, []);

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
      setThread(res.data?.thread ?? []);
      setOtherUsername(res.data?.other_username ?? 'User');
    } catch (e) {
      toast.error(e.response?.status === 404 ? 'User not found' : 'Failed to load chat');
      setThread([]);
      setOtherUsername('');
      navigate('/inbox');
    } finally { setHasLoaded(true); }
  };

  useEffect(() => {
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

  if (!hasLoaded) {
    return (
      <div className={`${styles.pageContent} ${styles.page} mobile-page-root`}>
      </div>
    );
  }

  return (
    <div data-chat-surface="inbox" className={`${styles.pageContent} flex flex-col h-[calc(100vh-10rem)] max-h-[700px] min-h-[320px] mobile-page-root`}>
      <style>{`
        [data-chat-surface="inbox"] [data-chat-part="message-text"] .inline-smiley {
          width: 15px !important;
          height: 15px !important;
          max-width: 15px !important;
          max-height: 15px !important;
          object-fit: contain;
          vertical-align: middle;
        }
      `}</style>
      {/* Header */}
      <div data-chat-part="header" className="flex items-center gap-3 py-3 border-b border-primary/20 shrink-0">
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
        data-chat-part="messages"
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
              data-chat-part="message-row"
              data-chat-own={msg.from_me ? 'true' : 'false'}
              className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 ${
                  msg.from_me
                    ? 'bg-primary/20 text-primary border border-primary/40 rounded-br-md'
                    : `${styles.panel} border border-primary/20 text-foreground rounded-bl-md`
                }`}
              >
                {msg.message && !(msg.message === '(GIF)' && msg.gif_url) ? (
                  <div
                    data-chat-part="message-text"
                    className="text-sm font-heading forum-content break-words"
                    dangerouslySetInnerHTML={{
                      __html: parseForumContent(msg.message, {
                        censorProfanity,
                        dmUnicodeSmileys: true,
                      }),
                    }}
                  />
                ) : null}
                {msg.gif_url && (
                  <img
                    src={msg.gif_url}
                    alt="GIF"
                    className="mt-2 rounded-lg max-w-full max-h-40 object-cover"
                  />
                )}
                <p
                  data-chat-part="timestamp"
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
        data-chat-part="composer"
        className={`p-3 border-t border-primary/20 ${styles.panel} shrink-0`}
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
            data-chat-part="aux-btn"
            onClick={() => setShowGifPicker((v) => !v)}
            className="shrink-0 w-10 h-10 rounded-full border border-primary/30 text-primary flex items-center justify-center hover:bg-primary/10 transition-colors"
            title="Search GIFs"
            aria-label="GIF"
          >
            GIF
          </button>
          <input
            type="text"
            data-chat-part="input"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Message… [b]bold[/b], [i]italic[/i], [url]https://…[/url], [img]https://…[/img]"
            className={`flex-1 ${styles.input} rounded-2xl px-4 py-2.5 text-sm font-heading border border-primary/30 focus:border-primary/60 focus:outline-none`}
            disabled={sending}
          />
          <button
            type="submit"
            data-chat-part="send"
            disabled={sending || !replyText.trim()}
            className="shrink-0 w-10 h-10 rounded-full bg-primary/20 text-primary border border-primary/40 flex items-center justify-center hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity font-heading"
            aria-label="Send"
          >
            <Send size={18} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {/* Classic forum smileys first */}
          {CLASSIC_SMILEYS.map(({ code, img }) => (
            <button
              key={code}
              type="button"
              onClick={() => insertEmoji(code)}
              className="leading-none p-1.5 rounded hover:bg-primary/20 transition-all focus:outline-none focus:ring-1 focus:ring-primary/50 hover:scale-110"
              title={code}
              aria-label={code}
            >
              <img src={`${SMILEY_IMG_BASE}/${img}.png`} alt={code} className="w-[15px] h-[15px] object-contain" />
            </button>
          ))}
          {/* Modern emojis */}
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
