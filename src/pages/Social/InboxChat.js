import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { toast } from 'sonner';
import { parseForumContent, FORUM_INLINE_SMILEY_PX } from '../../utils/forumContent';
import styles from '../../styles/noir.module.css';
import {
  INBOX_STYLES,
  IB_ACTION_GO,
  InboxHairline,
  InboxArtLine,
  InboxBar,
} from './inboxChrome';
import MessageComposer from './MessageComposer';

function formatTime(dateString) {
  const d = new Date(dateString);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function InboxChat() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [thread, setThread] = useState([]);
  const [otherUsername, setOtherUsername] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [gifUrl, setGifUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [censorProfanity, setCensorProfanity] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    api.get('/profile/censor-profanity').then((res) => {
      setCensorProfanity(res.data?.censor_profanity === true);
    }).catch(() => {});
  }, []);

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
      navigate('/social/inbox');
    } finally {
      setHasLoaded(true);
    }
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
    const gif = (gifUrl || '').trim();
    if ((!msg && !gif) || sending || !otherUsername) return;
    setSending(true);
    try {
      await api.post('/notifications/send', {
        target_username: otherUsername,
        message: msg || '(GIF)',
        gif_url: gif || null,
      });
      setReplyText('');
      setGifUrl('');
      await fetchThread();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      data-chat-surface="inbox"
      className={`${styles.pageContent} ${styles.panel} border border-primary/20 rounded-md overflow-hidden flex flex-col h-[calc(100dvh-8rem)] sm:h-[calc(100vh-10rem)] max-h-[700px] min-h-[320px] mobile-page-root mobile-panel`}
    >
      <style>{INBOX_STYLES}</style>
      <style>{`
        [data-chat-surface="inbox"] [data-chat-part="message-text"] .inline-smiley {
          width: ${FORUM_INLINE_SMILEY_PX}px !important;
          height: ${FORUM_INLINE_SMILEY_PX}px !important;
          max-width: ${FORUM_INLINE_SMILEY_PX}px !important;
          max-height: ${FORUM_INLINE_SMILEY_PX}px !important;
          object-fit: contain;
          vertical-align: middle;
        }
      `}</style>
      <InboxHairline />
      <InboxBar className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/social/inbox')}
          className={`${IB_ACTION_GO} inline-flex items-center gap-1`}
          aria-label="Back to inbox"
        >
          Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[11px] font-heading font-bold text-foreground truncate">
            {hasLoaded ? (otherUsername || 'User') : '…'}
          </h1>
          <p className="text-[9px] text-mutedForeground font-heading uppercase tracking-[0.12em]">Direct message</p>
        </div>
      </InboxBar>

      <div
        data-chat-part="messages"
        className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-secondary/20"
      >
        {!hasLoaded ? (
          <p className="text-[10px] text-mutedForeground font-heading text-center py-8">
            Loading…
          </p>
        ) : thread.length === 0 ? (
          <p className="text-[10px] text-mutedForeground font-heading text-center py-8">
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
                className={`max-w-[85%] sm:max-w-[75%] rounded-md px-2.5 py-1.5 ${
                  msg.from_me
                    ? 'bg-primary/20 text-primary border border-primary/40'
                    : `${styles.panel} border border-primary/20 text-foreground`
                }`}
              >
                {msg.message && !(msg.message === '(GIF)' && msg.gif_url) ? (
                  <div
                    data-chat-part="message-text"
                    className="text-[11px] sm:text-sm font-heading forum-content break-words"
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
                    className="mt-1.5 rounded max-w-full max-h-40 object-cover border border-primary/20"
                  />
                )}
                <p
                  data-chat-part="timestamp"
                  className="text-[9px] mt-1 text-mutedForeground"
                >
                  {formatTime(msg.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div data-chat-part="composer" className="border-t border-primary/20 p-2 shrink-0">
        <MessageComposer
          value={replyText}
          onChange={setReplyText}
          gifUrl={gifUrl}
          onGifUrlChange={setGifUrl}
          onSubmit={handleSend}
          sending={sending}
          disabled={!otherUsername}
          minHeightClass="min-h-16"
          placeholder="Message… [b]bold[/b], [url]https://…[/url], [img]https://…[/img]"
        />
      </div>
      <InboxArtLine />
    </div>
  );
}
