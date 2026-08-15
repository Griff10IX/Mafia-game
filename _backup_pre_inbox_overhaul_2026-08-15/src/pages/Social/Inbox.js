import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Mail, MailOpen, Bell, Trophy, Shield, Skull, Gift, Trash2, MessageCircle, Send, X, ChevronRight, Bot, Smile } from 'lucide-react';
import api, { apiGetWithResumeRetries } from '../../utils/api';
import { toast } from 'sonner';
import GifPicker from '../../components/GifPicker';
import { parseForumContent, FORUM_INLINE_SMILEY_PX } from '../../utils/forumContent';
import styles from '../../styles/noir.module.css';
import { NotificationMessage } from '../../components/NotificationMessage';

const INBOX_STYLES = `
  @keyframes ib-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .ib-fade-in { animation: ib-fade-in 0.4s ease-out both; }
  .ib-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .ib-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  .ib-filters { -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .ib-filters::-webkit-scrollbar { display: none; }

  @media (max-width: 1023px) {
    .ib-row {
      min-height: 44px;
      padding: 8px 10px !important;
      align-items: center;
    }
    .ib-filters button { min-height: 36px; }
  }
`;

const IB_ACTION =
  'ib-action-btn tap-feedback rounded px-2.5 py-1.5 min-h-9 text-[9px] font-heading font-bold uppercase tracking-wide border transition-all touch-manipulation active:scale-[0.97]';
const IB_ACTION_GO = `${IB_ACTION} bg-primary/20 text-primary border-primary/40 hover:bg-primary/30`;
const IB_ACTION_MUTE = `${IB_ACTION} bg-secondary text-mutedForeground border-border hover:text-red-400 hover:border-red-400/50`;

const NOTIFICATION_ICONS = {
  rank_up: Trophy,
  reward: Gift,
  bodyguard: Shield,
  attack: Skull,
  system: Bell,
  user_message: MessageCircle,
  staff_bot_client: Bot,
};

const VALID_FILTERS = ['all', 'unread', 'sent', 'rank_up', 'reward', 'bodyguard', 'attack', 'system', 'user_message', 'staff_bot_client'];

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

const EMOJI_ROWS = [
  ['😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😎', '🤩', '😍'],
  ['😂', '🤣', '😅', '😢', '😭', '😤', '😡', '🤬', '😱', '😰'],
  ['🤔', '😐', '😑', '🙄', '😏', '😒', '🥱', '😴', '🤢', '🤮'],
  ['👍', '👎', '👋', '🤝', '🙏', '💪', '✊', '👊', '🤙', '✌️'],
  ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '❣️', '💕'],
  ['🔥', '⭐', '✨', '💥', '💯', '🎉', '🎊', '🏆', '👑', '💎'],
  ['💰', '💵', '💸', '🔫', '💀', '☠️', '⚔️', '🔪', '🎲', '🃏'],
  ['❓', '❗', '⚠️', '✅', '❌', '🚫', '➕', '➖', '➡️', '⬅️'],
  ['👔', '💼', '🥃', '🍷', '🎭', '👑', '🏆', '✨', '🙏', '💪'],
];

// Utility function
function getTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function ocInviteActionError(detail, action) {
  const msg = String(detail || "").toLowerCase();
  if (msg.includes("expired")) return "This OC invite expired.";
  if (msg.includes("already accepted")) return "This OC invite was already accepted.";
  if (msg.includes("already cancelled")) return "This OC invite was cancelled by the creator.";
  if (msg.includes("already declined")) return "This OC invite was already declined.";
  if (msg.includes("already")) return "This OC invite was already updated.";
  return action === "accept" ? "Failed to accept invite" : "Failed to decline invite";
}

// Subcomponents
const ComposeModal = ({ 
  isOpen,
  onClose,
  sendTo, 
  onSendToChange, 
  sendMessage, 
  onSendMessageChange, 
  sendGifUrl, 
  onSendGifUrlChange,
  onSendMessage,
  sending,
  onInsertEmoji,
  onOpenGifPicker,
  showGifPicker,
  gifPickerOnSelect,
  gifPickerOnClose,
}) => {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  useEffect(() => {
    if (!isOpen) setShowEmojiPicker(false);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/80 backdrop-blur-sm">
      <div className={`${styles.panel} rounded-md border-2 border-primary/30 shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] overflow-hidden flex flex-col`}>
        {/* Header */}
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
            <Send size={14} />
            New Message
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 min-w-9 inline-flex items-center justify-center hover:bg-secondary rounded transition-colors touch-manipulation"
            aria-label="Close compose"
          >
            <X size={16} className="text-mutedForeground" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSendMessage} className="p-2 space-y-2 overflow-y-auto overscroll-contain">
          <div>
            <label className="block text-[10px] font-heading text-mutedForeground mb-1">
              To
            </label>
            <input
              type="text"
              value={sendTo}
              onChange={(e) => onSendToChange(e.target.value)}
              placeholder="Enter username..."
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-[10px] font-heading text-mutedForeground mb-1">
              Message
            </label>
            <textarea
              value={sendMessage}
              onChange={(e) => onSendMessageChange(e.target.value)}
              placeholder="Type your message… [b]bold[/b], [url]https://…[/url], [img]https://…[/img]"
              rows={5}
              className="w-full min-h-32 bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowEmojiPicker((visible) => !visible)}
              className="mt-1 min-h-11 sm:min-h-8 px-2 flex items-center gap-1.5 rounded text-[10px] font-heading text-mutedForeground hover:text-primary hover:bg-primary/10 touch-manipulation"
              aria-expanded={showEmojiPicker}
              aria-controls="compose-message-emoji-picker"
            >
              <Smile size={16} />
              {showEmojiPicker ? 'Hide emojis' : 'Add emoji'}
            </button>
            {showEmojiPicker && (
              <div
                id="compose-message-emoji-picker"
                className="mt-1 flex flex-wrap content-start gap-0.5 max-h-36 overflow-y-auto overscroll-contain border-t border-primary/10 pt-1"
              >
                {/* Classic forum smileys first */}
                {CLASSIC_SMILEYS.map(({ code, img }) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => onInsertEmoji(code)}
                    className="p-2 min-w-10 min-h-10 rounded hover:bg-primary/20 active:scale-95 transition-all hover:scale-110 touch-manipulation"
                    title={code}
                    aria-label={code}
                  >
                    <img src={`/images/smileys/${img}.png`} alt={code} className="object-contain shrink-0" style={{ width: FORUM_INLINE_SMILEY_PX, height: FORUM_INLINE_SMILEY_PX }} />
                  </button>
                ))}
                {/* Modern emojis */}
                {EMOJI_ROWS.flat().map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onInsertEmoji(emoji)}
                    className="text-lg p-2 min-w-10 min-h-10 rounded hover:bg-primary/20 active:scale-95 transition-all touch-manipulation"
                    aria-label={`Insert ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-heading text-mutedForeground">
                GIF (Optional)
              </label>
              {onOpenGifPicker && (
                <button
                  type="button"
                  onClick={onOpenGifPicker}
                  className="text-[9px] font-heading font-bold text-primary hover:text-primary/80 uppercase"
                >
                  Search GIPHY →
                </button>
              )}
            </div>
            {showGifPicker && (
              <GifPicker
                onSelect={gifPickerOnSelect}
                onClose={gifPickerOnClose}
                className="mb-1"
              />
            )}
            <input
              type="url"
              value={sendGifUrl}
              onChange={(e) => onSendGifUrlChange(e.target.value)}
              placeholder="Paste GIF URL..."
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>
          
          <div className="flex gap-1.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 ${IB_ACTION_MUTE} !text-foreground hover:!text-foreground`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className={`flex-1 ${IB_ACTION_GO} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const MessageRow = ({ notification, isSelected, onClick, onMarkRead, onDelete, onOcAccept, onOcDecline, isSent }) => {
  const [showPreview, setShowPreview] = useState(false);
  const Icon = NOTIFICATION_ICONS[notification.notification_type] || Bell;
  const timeAgo = getTimeAgo(notification.created_at);
  const isOcInvite = !!notification.oc_invite_id;
  const isUserMessage = notification.notification_type === 'user_message';
  
  // Get recipient for sent messages
  const recipient = isSent ? (notification.recipient_username || notification.to_username || notification.target_username) : null;

  const handleMouseEnter = () => {
    setShowPreview(true);
    if (!isSent && !notification.read && onMarkRead) {
      onMarkRead(notification.id);
    }
  };

  return (
    <div
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowPreview(false)}
      className={`ib-row group relative flex items-center gap-2 px-2.5 py-1.5 border-b border-border/60 cursor-pointer transition-all touch-manipulation ${
        isSelected
          ? 'bg-primary/12 border-l-2 border-l-primary'
          : isSent
          ? 'bg-transparent hover:bg-secondary/40 border-l-2 border-l-transparent'
          : notification.read
          ? 'bg-transparent hover:bg-secondary/40 border-l-2 border-l-transparent'
          : 'bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary/50'
      }`}
    >
      {/* Icon */}
      <div className={`p-1 rounded shrink-0 ${
        isSent ? 'bg-primary/20' : notification.read ? 'bg-secondary' : 'bg-primary/20'
      }`}>
        {isSent ? (
          <Send size={12} className="text-primary" />
        ) : (
          <Icon size={12} className={notification.read ? 'text-mutedForeground' : 'text-primary'} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <h3 className={`text-xs font-heading truncate ${
            isSent || notification.read ? 'text-foreground font-bold' : 'text-foreground font-bold'
          }`}>
            {isSent ? `To: ${recipient || 'Unknown'}` : notification.title}
          </h3>
          <span className="text-[9px] text-mutedForeground whitespace-nowrap">
            {timeAgo}
          </span>
        </div>
        <p className="text-[10px] text-mutedForeground truncate">
          <NotificationMessage
            message={notification.message}
            actorUsername={notification.actor_username}
            topicId={notification.topic_id}
            topicTitle={notification.topic_title}
            commentId={notification.comment_id}
            messageLinkTo={notification.message_link_to}
            messageLinkLabel={notification.message_link_label}
            className="text-inherit"
          />
        </p>
      </div>

      {/* Unread indicator or Sent badge */}
      {isSent ? (
        <div className="px-1 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-bold shrink-0">
          SENT
        </div>
      ) : !notification.read ? (
        <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
      ) : null}

      {/* Arrow */}
      <ChevronRight size={14} className="text-mutedForeground shrink-0" />
      
      {/* Hover Preview Tooltip - Fixed positioning */}
      {showPreview && (
        <div 
          className="fixed z-[100] pointer-events-none hidden lg:block"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }}
        >
          <div className="bg-zinc-900 border-2 border-primary/40 rounded-md p-2 shadow-2xl shadow-black/50 w-80 animate-in fade-in duration-150">
            {/* Preview Header */}
            <div className="flex items-start gap-2 mb-2 pb-2 border-b border-primary/20">
              <div className="p-1.5 rounded bg-primary/20 border border-primary/30">
                {isSent ? (
                  <Send size={12} className="text-primary" />
                ) : (
                  <Icon size={12} className="text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-[11px] font-heading font-bold text-primary mb-0.5">
                  {isSent ? `To: ${recipient || 'Unknown'}` : notification.title}
                </h4>
                <p className="text-[9px] text-mutedForeground">
                  {timeAgo}
                </p>
              </div>
              {!isSent && !notification.read && (
                <div className="px-1 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-bold">
                  NEW
                </div>
              )}
            </div>
            
            {/* Preview Body */}
            <p className="text-[10px] text-foreground leading-snug max-h-32 overflow-y-auto whitespace-pre-wrap">
              <NotificationMessage
                message={notification.message}
                actorUsername={notification.actor_username}
                topicId={notification.topic_id}
                topicTitle={notification.topic_title}
                commentId={notification.comment_id}
                messageLinkTo={notification.message_link_to}
                messageLinkLabel={notification.message_link_label}
                className="text-inherit"
              />
            </p>
            
            {/* GIF Preview */}
            {notification.gif_url && (
              <div className="mt-2 pt-2 border-t border-primary/20">
                <img 
                  src={notification.gif_url} 
                  alt="GIF preview" 
                  className="max-w-full max-h-24 rounded border border-primary/20 mx-auto" 
                />
              </div>
            )}
            
            {/* Click hint */}
            <div className="mt-2 pt-2 border-t border-primary/20 text-center">
              <span className="text-[9px] text-mutedForeground">Click to view full message</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MessageDetail = ({ notification, onMarkRead, onDelete, onOcAccept, onOcDecline, onOpenChat, isSent, censorProfanity }) => {
  if (!notification) {
    return (
      <div className="flex-1 flex items-center justify-center bg-secondary/20">
        <div className="text-center">
          <MailOpen size={36} className="mx-auto text-primary/30 mb-2" />
          <p className="text-[10px] text-mutedForeground font-heading">
            Select a message to read
          </p>
        </div>
      </div>
    );
  }

  const Icon = isSent ? Send : (NOTIFICATION_ICONS[notification.notification_type] || Bell);
  const isOcInvite = !!notification.oc_invite_id;
  const isUserMessage = notification.notification_type === 'user_message' && notification.sender_id;
  const isBbDirectMessage =
    notification.notification_type === 'user_message' ||
    notification.notification_type === 'user_message_sent';
  
  // Get recipient for sent messages
  const recipient = isSent ? (notification.recipient_username || notification.to_username || notification.target_username) : null;

  return (
    <div className={`flex-1 flex flex-col ${styles.panel}`}>
      {/* Message Header */}
      <div className="px-2.5 py-2 border-b border-primary/20 bg-primary/8">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-2">
            <div className="p-1.5 rounded-md bg-primary/10 border border-primary/20">
              <Icon size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-xs font-heading font-bold text-foreground mb-0.5">
                {isSent ? `To: ${recipient || 'Unknown'}` : notification.title}
              </h2>
              <p className="text-[10px] text-mutedForeground">
                {isSent && <span className="text-primary font-bold mr-1">Sent</span>}
                {getTimeAgo(notification.created_at)}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-1.5">
          {!isSent && !notification.read && (
            <button
              type="button"
              onClick={() => onMarkRead(notification.id)}
              className={IB_ACTION_GO}
            >
              Mark Read
            </button>
          )}
          {!isSent && isUserMessage && (
            <button
              type="button"
              onClick={() => onOpenChat(notification)}
              className={IB_ACTION_GO}
            >
              Reply
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(notification.id)}
            className={IB_ACTION_MUTE}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Message Body */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="prose prose-invert max-w-none">
          {isBbDirectMessage &&
          notification.message &&
          !(notification.message === '(GIF)' && notification.gif_url) ? (
            <div
              className="text-[11px] text-foreground forum-content leading-snug break-words"
              dangerouslySetInnerHTML={{
                __html: parseForumContent(notification.message, {
                  censorProfanity: !!censorProfanity,
                  dmUnicodeSmileys: true,
                }),
              }}
            />
          ) : (
            <p className="text-[11px] text-foreground leading-snug whitespace-pre-wrap">
              <NotificationMessage
                message={notification.message}
                actorUsername={notification.actor_username}
                topicId={notification.topic_id}
                topicTitle={notification.topic_title}
                commentId={notification.comment_id}
                messageLinkTo={notification.message_link_to}
                messageLinkLabel={notification.message_link_label}
                className="text-inherit"
              />
            </p>
          )}

          {notification.gif_url && (
            <div className="mt-2">
              <img 
                src={notification.gif_url} 
                alt="GIF" 
                className="max-w-full max-h-[280px] rounded border border-primary/20 shadow-lg" 
              />
            </div>
          )}

          {!isSent && isOcInvite && (
            <div className="mt-3 p-2 bg-primary/10 border border-primary/30 rounded-md">
              <p className="text-[10px] text-foreground font-heading font-bold mb-2">
                Organised Crime Invitation
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onOcAccept(notification.oc_invite_id)}
                  className={IB_ACTION_GO}
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => onOcDecline(notification.oc_invite_id)}
                  className={IB_ACTION_MUTE}
                >
                  Decline
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Main component
export default function Inbox() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const initialFilter = VALID_FILTERS.includes(filterParam) ? filterParam : 'all';
  
  const [notifications, setNotifications] = useState([]);
  const [sentMessages, setSentMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [readRetentionDays, setReadRetentionDays] = useState(5);
  const [unreadRetentionDays, setUnreadRetentionDays] = useState(60);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [filter, setFilter] = useState(initialFilter);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sendGifUrl, setSendGifUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [censorProfanity, setCensorProfanity] = useState(false);

  useEffect(() => {
    api.get('/profile/censor-profanity').then((res) => {
      setCensorProfanity(res.data?.censor_profanity === true);
    }).catch(() => {});
  }, []);

  const fetchNotifications = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    try {
      const response = await apiGetWithResumeRetries('/notifications');
      setNotifications(response.data?.notifications ?? []);
      setUnreadCount(response.data?.unread_count ?? 0);
    } catch (error) {
      if (!silent) {
        toast.error("Messages didn't load. Check your connection — try again or reopen this tab.");
      }
      // Do not clear inbox on failure — a later refetch can succeed after wake-from-background.
    } finally {
      setHasLoaded(true);
    }
  }, []);

  const fetchSentMessages = useCallback(async () => {
    try {
      const response = await apiGetWithResumeRetries('/notifications/sent');
      setSentMessages(response.data?.sent_messages ?? []);
    } catch (error) {
      setSentMessages([]);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchSentMessages();
  }, [fetchNotifications, fetchSentMessages]);

  // iPhone / Safari: first fetch after returning from background often fails; refetch when tab is visible again (no error toast).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      fetchNotifications({ silent: true });
      fetchSentMessages();
    };
    const onPageShow = (e) => {
      if (e.persisted) {
        fetchNotifications({ silent: true });
        fetchSentMessages();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [fetchNotifications, fetchSentMessages]);

  useEffect(() => {
    if (VALID_FILTERS.includes(filterParam)) setFilter(filterParam);
  }, [filterParam]);

  const markAsRead = async (notificationId) => {
    try {
      await api.post(`/notifications/${notificationId}/read`);
      fetchNotifications();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (error) {
      toast.error('Failed to mark as read');
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.post('/notifications/read-all');
      fetchNotifications();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
      toast.success('All notifications marked as read');
    } catch (error) {
      toast.error('Failed to mark all as read');
    }
  };

  const deleteMessage = async (notificationId) => {
    try {
      await api.delete(`/notifications/${notificationId}`);
      if (selectedNotification?.id === notificationId) {
        setSelectedNotification(null);
      }
      fetchNotifications();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
      toast.success('Message deleted');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete message');
    }
  };

  const deleteAllMessages = async () => {
    if (!window.confirm('Delete all messages in your inbox?')) return;
    try {
      const res = await api.delete('/notifications');
      setSelectedNotification(null);
      fetchNotifications();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
      toast.success(res.data?.message || 'All messages deleted');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete all');
    }
  };

  const handleOcInviteAccept = async (inviteId) => {
    try {
      const res = await api.post(`/oc/invite/${inviteId}/accept`);
      toast.success(res.data?.message || 'Accepted');
      fetchNotifications();
    } catch (error) {
      toast.error(ocInviteActionError(error.response?.data?.detail, "accept"));
    }
  };

  const handleOcInviteDecline = async (inviteId) => {
    try {
      const res = await api.post(`/oc/invite/${inviteId}/decline`);
      toast.success(res.data?.message || 'Declined');
      fetchNotifications();
    } catch (error) {
      toast.error(ocInviteActionError(error.response?.data?.detail, "decline"));
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const to = (sendTo || '').trim();
    const msg = (sendMessage || '').trim();
    const gif = (sendGifUrl || '').trim();
    
    if (!to) {
      toast.error('Enter a username');
      return;
    }
    if (!msg && !gif) {
      toast.error('Enter a message or GIF URL');
      return;
    }
    
    setSending(true);
    try {
      const res = await api.post('/notifications/send', { 
        target_username: to, 
        message: msg || '(GIF)', 
        gif_url: gif || null 
      });
      toast.success(res.data?.message || 'Message sent');
      setSendTo('');
      setSendMessage('');
      setSendGifUrl('');
      setShowGifPicker(false);
      setShowCompose(false);
      fetchNotifications();
      fetchSentMessages();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const insertEmoji = (emoji) => setSendMessage(m => m + emoji);

  const filteredNotifications = filter === 'sent'
    ? sentMessages
    : filter === 'all' 
    ? notifications 
    : filter === 'unread'
      ? notifications.filter(n => !n.read)
      : notifications.filter(n => n.notification_type === filter);

  const filterButtons = [
    { value: 'all', label: 'All', icon: Mail },
    { value: 'unread', label: 'Unread', icon: MailOpen },
    { value: 'sent', label: 'Sent', icon: Send },
    { value: 'user_message', label: 'Messages', icon: MessageCircle },
    { value: 'rank_up', label: 'Rank', icon: Trophy },
    { value: 'attack', label: 'Attack', icon: Skull },
    { value: 'system', label: 'System', icon: Bell },
    { value: 'staff_bot_client', label: 'Bot alerts', icon: Bot },
  ];

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="inbox-page">
      <style>{INBOX_STYLES}</style>

      <div className="relative ib-fade-in space-y-1">
        <p className="text-[9px] text-zinc-500 font-heading italic">Notifications, DMs, rank-ups & more.</p>
        <p className="text-[9px] text-zinc-500/90 font-heading leading-snug max-w-2xl">
          <span className="text-primary/80 font-bold uppercase tracking-wider">Retention:</span>{' '}
          messages you&apos;ve <strong className="text-zinc-400">read</strong> are removed automatically after{' '}
          <strong className="text-zinc-400">{readRetentionDays} days</strong> (keeps the database healthy). Unread items expire after about{' '}
          <strong className="text-zinc-400">{unreadRetentionDays} days</strong>. Save anything important elsewhere.
        </p>
      </div>

      <ComposeModal
        isOpen={showCompose}
        onClose={() => setShowCompose(false)}
        sendTo={sendTo}
        onSendToChange={setSendTo}
        sendMessage={sendMessage}
        onSendMessageChange={setSendMessage}
        sendGifUrl={sendGifUrl}
        onSendGifUrlChange={setSendGifUrl}
        onSendMessage={handleSendMessage}
        sending={sending}
        onInsertEmoji={insertEmoji}
        onOpenGifPicker={() => setShowGifPicker(true)}
        showGifPicker={showGifPicker}
        gifPickerOnSelect={(url) => { setSendGifUrl(url); setShowGifPicker(false); }}
        gifPickerOnClose={() => setShowGifPicker(false)}
      />

      {/* Inbox Layout */}
      <div className={`relative ${styles.panel} border border-primary/20 rounded-md overflow-hidden ib-fade-in mobile-panel`} style={{ animationDelay: '0.03s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        {/* Toolbar */}
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="ib-filters flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
              {filterButtons.map(btn => {
                const Icon = btn.icon;
                const short = btn.value === 'staff_bot_client' ? 'Bots' : btn.label;
                return (
                  <button
                    key={btn.value}
                    type="button"
                    onClick={() => { setFilter(btn.value); setSelectedNotification(null); }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 min-h-9 rounded text-[9px] font-heading font-bold whitespace-nowrap transition-all border touch-manipulation ${
                      filter === btn.value
                        ? 'bg-primary/20 text-primary border-primary/50'
                        : 'bg-secondary/50 text-mutedForeground border-border hover:text-foreground'
                    }`}
                  >
                    <Icon size={12} />
                    <span className="sm:hidden">{short}</span>
                    <span className="hidden sm:inline">{btn.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setShowCompose(true)}
              className={`${IB_ACTION_GO} shrink-0 inline-flex items-center gap-1`}
            >
              <Send size={12} />
              <span className="hidden sm:inline">Compose</span>
            </button>
          </div>
          {(unreadCount > 0 || notifications.length > 0) && (
            <div className="flex items-center justify-end gap-1.5">
              {unreadCount > 0 && (
                <button type="button" onClick={markAllAsRead} className={IB_ACTION_GO}>
                  Mark All Read
                </button>
              )}
              {notifications.length > 0 && (
                <button type="button" onClick={deleteAllMessages} className={IB_ACTION_MUTE}>
                  Delete All
                </button>
              )}
            </div>
          )}
        </div>

        {/* Inbox Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5">
          <div className={`lg:col-span-2 lg:border-r border-primary/20 bg-secondary/20 overflow-y-auto max-h-[70vh] lg:max-h-[480px] ${selectedNotification ? 'hidden lg:block' : ''}`}>
            {filter === 'bodyguard' && filteredNotifications.length > 0 && (
              <div className="px-2 py-1.5 border-b border-primary/20 bg-amber-500/5 text-[9px] text-mutedForeground font-heading italic">
                Past hires shown here. Max 4 bodyguards at once. Slots free up when a guard is lost in combat.
              </div>
            )}
            {filteredNotifications.length === 0 ? (
              <div className="p-4 text-center">
                <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                <MailOpen size={28} className="mx-auto text-primary/30 mb-2" />
                <p className="text-[10px] text-mutedForeground font-heading">
                  No messages
                </p>
              </div>
            ) : (
              filteredNotifications.map(notification => (
                <MessageRow
                  key={notification.id}
                  notification={notification}
                  isSelected={selectedNotification?.id === notification.id}
                  onClick={() => setSelectedNotification(notification)}
                  onMarkRead={markAsRead}
                  onDelete={deleteMessage}
                  onOcAccept={handleOcInviteAccept}
                  onOcDecline={handleOcInviteDecline}
                  isSent={filter === 'sent'}
                />
              ))
            )}
          </div>

          {/* Message Detail: desktop side panel; mobile inline below list */}
          <div className="lg:col-span-3 hidden lg:block">
            <MessageDetail
              notification={selectedNotification}
              onMarkRead={markAsRead}
              onDelete={deleteMessage}
              onOcAccept={handleOcInviteAccept}
              onOcDecline={handleOcInviteDecline}
              onOpenChat={(n) => n.sender_id && navigate(`/inbox/chat/${n.sender_id}`)}
              isSent={filter === 'sent'}
              censorProfanity={censorProfanity}
            />
          </div>
        </div>

        {/* Mobile: selected message inline below list (no fullscreen) */}
        {selectedNotification && (
          <div className="lg:hidden bg-secondary/20 overflow-y-auto max-h-[75vh]">
            <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSelectedNotification(null)}
                className={`${IB_ACTION_GO} inline-flex items-center gap-1`}
              >
                Back
              </button>
              <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Message</span>
            </div>
            <MessageDetail
              notification={selectedNotification}
              onMarkRead={markAsRead}
              onDelete={deleteMessage}
              onOcAccept={handleOcInviteAccept}
              onOcDecline={handleOcInviteDecline}
              onOpenChat={(n) => n.sender_id && navigate(`/inbox/chat/${n.sender_id}`)}
              isSent={filter === 'sent'}
              censorProfanity={censorProfanity}
            />
          </div>
        )}
        <div className="ib-art-line text-primary mx-2.5" />
      </div>
    </div>
  );
}
