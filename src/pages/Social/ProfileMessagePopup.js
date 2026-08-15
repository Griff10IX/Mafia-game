import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import { parseForumContent } from '../../utils/forumContent';
import styles from '../../styles/noir.module.css';
import { IB_ACTION_MUTE, InboxHairline, InboxBar } from './inboxChrome';
import MessageComposer from './MessageComposer';

function formatTime(dateString) {
  const d = new Date(dateString);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ProfileMessagePopup({
  userId,
  username,
  onClose,
  censorProfanity = false,
}) {
  const [thread, setThread] = useState([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [gifUrl, setGifUrl] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const fetchThread = async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/notifications/thread/${userId}`);
      setThread(res.data?.thread ?? []);
    } catch {
      setThread([]);
    } finally {
      setHasLoaded(true);
    }
  };

  useEffect(() => {
    fetchThread();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread]);

  const handleSend = async (e) => {
    e.preventDefault();
    const msg = (replyText || '').trim();
    const gif = (gifUrl || '').trim();
    if ((!msg && !gif) || sending || !username) return;
    setSending(true);
    try {
      await api.post('/notifications/send', {
        target_username: username,
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
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-2 sm:p-4 bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-message-title"
      onClick={onClose}
    >
      <div
        className={`${styles.panel} w-full max-w-md rounded-md border border-primary/30 shadow-2xl overflow-hidden flex flex-col max-h-[min(32rem,80dvh)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <InboxHairline />
        <InboxBar className="flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h2 id="profile-message-title" className="text-[11px] font-heading font-bold text-foreground truncate">
              {username}
            </h2>
            <p className="text-[9px] text-mutedForeground font-heading uppercase tracking-[0.12em]">Send message</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`${IB_ACTION_MUTE} min-w-9 inline-flex items-center justify-center`}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </InboxBar>

        <div className="flex-1 min-h-[7rem] max-h-52 overflow-y-auto p-2.5 space-y-1.5 bg-secondary/20">
          {!hasLoaded ? (
            <p className="text-[10px] text-mutedForeground font-heading text-center py-6">Loading…</p>
          ) : thread.length === 0 ? (
            <p className="text-[10px] text-mutedForeground font-heading text-center py-6">
              No messages yet. Write below.
            </p>
          ) : (
            thread.map((msg) => (
              <div key={msg.id} className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] rounded-md px-2 py-1.5 ${
                    msg.from_me
                      ? 'bg-primary/20 text-primary border border-primary/40'
                      : `${styles.panel} border border-primary/20 text-foreground`
                  }`}
                >
                  {msg.message && !(msg.message === '(GIF)' && msg.gif_url) ? (
                    <div
                      className="text-[11px] font-heading forum-content break-words"
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
                      className="mt-1 rounded max-w-full max-h-28 object-cover border border-primary/20"
                    />
                  )}
                  <p className="text-[9px] mt-0.5 text-mutedForeground">{formatTime(msg.created_at)}</p>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-primary/20 p-2 shrink-0">
          <MessageComposer
            value={replyText}
            onChange={setReplyText}
            gifUrl={gifUrl}
            onGifUrlChange={setGifUrl}
            onSubmit={handleSend}
            sending={sending}
            disabled={!username}
            autoFocus
            minHeightClass="min-h-16"
            placeholder="Write a message…"
          />
        </div>
      </div>
    </div>
  );
}
