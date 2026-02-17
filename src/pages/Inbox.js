import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Mail, MailOpen, Bell, Trophy, Shield, Skull, Gift, Trash2, MessageCircle, Send, X, ChevronRight } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import GifPicker from '../components/GifPicker';
import styles from '../styles/noir.module.css';

const INBOX_STYLES = `
  @keyframes ib-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .ib-fade-in { animation: ib-fade-in 0.4s ease-out both; }
  .ib-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .ib-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const NOTIFICATION_ICONS = {
  rank_up: Trophy,
  reward: Gift,
  bodyguard: Shield,
  attack: Skull,
  system: Bell,
  user_message: MessageCircle
};

const VALID_FILTERS = ['all', 'unread', 'sent', 'rank_up', 'reward', 'bodyguard', 'attack', 'system', 'user_message'];

const EMOJI_ROWS = [
  ['😀', '😂', '👍', '❤️', '🔥', '😎', '👋', '🎉', '💀', '😢'],
  ['💰', '💵', '💎', '🎩', '🕴️', '🔫', '⚔️', '🔪', '🃏', '🎲'],
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

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
    <Mail size={22} className="text-primary/40 animate-pulse" />
    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[9px] font-heading uppercase tracking-[0.2em]">Loading...</span>
  </div>
);

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/80 backdrop-blur-sm">
      <div className={`${styles.panel} rounded-md border-2 border-primary/30 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col`}>
        {/* Header */}
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
            <Send size={14} />
            New Message
          </h2>
          <button
            onClick={onClose}
            className="p-0.5 hover:bg-secondary rounded transition-colors"
          >
            <X size={14} className="text-mutedForeground" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSendMessage} className="p-2 space-y-2 overflow-y-auto">
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
              placeholder="Type your message..."
              rows={3}
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y transition-colors"
            />
            <div className="mt-1 flex flex-wrap gap-0.5">
              {EMOJI_ROWS.flat().map((emoji) => (
                <button 
                  key={emoji} 
                  type="button" 
                  onClick={() => onInsertEmoji(emoji)} 
                  className="text-sm p-1 rounded hover:bg-primary/20 active:scale-95 transition-all" 
                >
                  {emoji}
                </button>
              ))}
            </div>
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
              className="flex-1 bg-secondary text-foreground border border-border hover:bg-secondary/80 rounded-md px-2.5 py-1.5 font-heading font-bold uppercase tracking-wide text-[10px] transition-all active:scale-95"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="flex-1 bg-primary/20 text-primary rounded-md px-2.5 py-1.5 font-heading font-bold uppercase tracking-wide text-[10px] border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
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

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
      className={`group relative flex items-center gap-2 px-2 py-1.5 border-b border-border cursor-pointer transition-all ib-row ${
        isSelected 
          ? 'bg-primary/10 border-l-4 border-l-primary' 
          : isSent
          ? 'bg-secondary/20 hover:bg-secondary/40 border-l-4 border-l-transparent'
          : notification.read 
          ? 'bg-secondary/30 hover:bg-secondary/50' 
          : `${styles.panel} hover:bg-secondary/30 border-l-4 border-l-primary/50`
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
          <h3 className={`text-[11px] font-heading truncate ${
            isSent ? 'text-foreground' : notification.read ? 'text-foreground' : 'text-foreground font-bold'
          }`}>
            {isSent ? `To: ${recipient || 'Unknown'}` : notification.title}
          </h3>
          <span className="text-[9px] text-mutedForeground whitespace-nowrap">
            {timeAgo}
          </span>
        </div>
        <p className="text-[9px] text-mutedForeground truncate">
          {notification.message}
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
      <ChevronRight size={10} className="text-mutedForeground shrink-0" />
      
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
              {notification.message}
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

const MessageDetail = ({ notification, onMarkRead, onDelete, onOcAccept, onOcDecline, onOpenChat, isSent }) => {
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
              <h2 className="text-sm font-heading font-bold text-foreground mb-0.5">
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
        <div className="flex flex-wrap gap-1">
          {!isSent && !notification.read && (
            <button
              onClick={() => onMarkRead(notification.id)}
              className="px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 text-[9px] font-heading font-bold uppercase transition-all"
            >
              ✓ Mark Read
            </button>
          )}
          {!isSent && isUserMessage && (
            <button
              onClick={() => onOpenChat(notification)}
              className="px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 text-[9px] font-heading font-bold uppercase transition-all"
            >
              💬 Reply
            </button>
          )}
          <button
            onClick={() => onDelete(notification.id)}
            className="px-2 py-0.5 rounded bg-secondary text-mutedForeground border border-border hover:text-red-400 hover:border-red-400/50 text-[9px] font-heading font-bold uppercase transition-all"
          >
            🗑️ Delete
          </button>
        </div>
      </div>

      {/* Message Body */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="prose prose-invert max-w-none">
          <p className="text-[11px] text-foreground leading-snug whitespace-pre-wrap">
            {notification.message}
          </p>
          
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
              <div className="flex gap-1">
                <button
                  onClick={() => onOcAccept(notification.oc_invite_id)}
                  className="bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 rounded px-2 py-1 text-[10px] font-heading font-bold uppercase transition-all active:scale-95"
                >
                  ✓ Accept
                </button>
                <button
                  onClick={() => onOcDecline(notification.oc_invite_id)}
                  className="bg-secondary text-foreground border border-border hover:border-primary/30 rounded px-2 py-1 text-[10px] font-heading font-bold uppercase transition-all active:scale-95"
                >
                  ✗ Decline
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
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilter);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sendGifUrl, setSendGifUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await api.get('/notifications');
      setNotifications(response.data.notifications);
      setUnreadCount(response.data.unread_count);
    } catch (error) {
      toast.error('Failed to load notifications');
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSentMessages = useCallback(async () => {
    try {
      const response = await api.get('/notifications/sent');
      setSentMessages(response.data.sent_messages || []);
    } catch (error) {
      console.error('Error fetching sent messages:', error);
      // Don't show error toast as this is optional
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchSentMessages();
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
      toast.error(error.response?.data?.detail || 'Failed to accept');
    }
  };

  const handleOcInviteDecline = async (inviteId) => {
    try {
      const res = await api.post(`/oc/invite/${inviteId}/decline`);
      toast.success(res.data?.message || 'Declined');
      fetchNotifications();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to decline');
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

  if (loading) {
    return (
      <div className={`space-y-2 ${styles.pageContent}`}>
        <style>{INBOX_STYLES}</style>
        <LoadingSpinner />
      </div>
    );
  }

  const filterButtons = [
    { value: 'all', label: 'All', icon: Mail },
    { value: 'unread', label: 'Unread', icon: MailOpen },
    { value: 'sent', label: 'Sent', icon: Send },
    { value: 'user_message', label: 'Messages', icon: MessageCircle },
    { value: 'rank_up', label: 'Rank', icon: Trophy },
    { value: 'attack', label: 'Attack', icon: Skull },
    { value: 'system', label: 'System', icon: Bell },
  ];

  return (
    <div className={`space-y-2 ${styles.pageContent}`} data-testid="inbox-page">
      <style>{INBOX_STYLES}</style>

      <div className="relative ib-fade-in">
        <p className="text-[9px] text-zinc-500 font-heading italic">Notifications, DMs, rank-ups & more.</p>
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
      <div className={`relative ${styles.panel} border border-primary/20 rounded-md overflow-hidden ib-fade-in`} style={{ animationDelay: '0.03s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        {/* Toolbar */}
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          {/* Top row: Filters + Compose */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 flex-1">
              {filterButtons.map(btn => {
                const Icon = btn.icon;
                return (
                  <button
                    key={btn.value}
                    onClick={() => setFilter(btn.value)}
                    className={`flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-heading font-bold whitespace-nowrap transition-all border ${
                      filter === btn.value
                        ? 'bg-primary/20 text-primary border-primary/50'
                        : 'bg-secondary/50 text-mutedForeground border-border hover:text-foreground'
                    }`}
                  >
                    <Icon size={10} />
                    {btn.label}
                  </button>
                );
              })}
            </div>
            
            {/* Compose button - integrated with toolbar */}
            <button
              onClick={() => setShowCompose(true)}
              className="bg-primary/20 text-primary rounded px-2 py-0.5 font-heading font-bold uppercase tracking-wide text-[10px] border border-primary/40 hover:bg-primary/30 transition-all active:scale-95 touch-manipulation flex items-center gap-0.5 shrink-0"
            >
              <Send size={10} />
              <span className="hidden sm:inline">Compose</span>
            </button>
          </div>
          
          {/* Bottom row: Actions */}
          <div className="flex items-center justify-end gap-1">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 text-[9px] font-heading font-bold uppercase whitespace-nowrap transition-all"
              >
                ✓ Mark All Read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={deleteAllMessages}
                className="px-2 py-0.5 rounded bg-secondary text-mutedForeground border border-border hover:text-red-400 hover:border-red-400/50 text-[9px] font-heading font-bold uppercase whitespace-nowrap transition-all"
              >
                🗑️ Delete All
              </button>
            )}
          </div>
        </div>

        {/* Inbox Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5">
          {/* Message List */}
          <div className="lg:col-span-2 border-r border-primary/20 bg-secondary/20 max-h-[480px] overflow-y-auto">
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

          {/* Message Detail */}
          <div className="lg:col-span-3 hidden lg:block">
            <MessageDetail
              notification={selectedNotification}
              onMarkRead={markAsRead}
              onDelete={deleteMessage}
              onOcAccept={handleOcInviteAccept}
              onOcDecline={handleOcInviteDecline}
              onOpenChat={(n) => n.sender_id && navigate(`/inbox/chat/${n.sender_id}`)}
              isSent={filter === 'sent'}
            />
          </div>
        </div>
      </div>

      {/* Mobile: Selected message fullscreen */}
      {selectedNotification && (
        <div className="lg:hidden fixed inset-0 z-40 bg-background">
          <div className="flex flex-col h-full">
            <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <button
                onClick={() => setSelectedNotification(null)}
                className="p-1 hover:bg-secondary rounded transition-colors"
              >
                <X size={16} className="text-foreground" />
              </button>
              <h2 className="text-[11px] font-heading font-bold text-primary uppercase">
                Message
              </h2>
            </div>
            <MessageDetail
              notification={selectedNotification}
              onMarkRead={markAsRead}
              onDelete={deleteMessage}
              onOcAccept={handleOcInviteAccept}
              onOcDecline={handleOcInviteDecline}
              onOpenChat={(n) => n.sender_id && navigate(`/inbox/chat/${n.sender_id}`)}
              isSent={filter === 'sent'}
            />
          </div>
        </div>
      )}
    </div>
  );
}
