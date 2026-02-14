import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, MailOpen, Bell, Trophy, Shield, Skull, Gift, Trash2, MessageCircle } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const NOTIFICATION_ICONS = {
  rank_up: Trophy,
  reward: Gift,
  bodyguard: Shield,
  attack: Skull,
  system: Bell,
  user_message: MessageCircle
};

const VALID_FILTERS = ['all', 'unread', 'rank_up', 'reward', 'bodyguard', 'attack', 'system', 'user_message'];

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
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = ({ unreadCount }) => (
  <div>
    <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2 flex items-center gap-3">
      <Mail className="w-8 h-8 md:w-10 md:h-10" />
      Inbox
    </h1>
    <p className="text-sm text-mutedForeground">
      {unreadCount > 0 ? `${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}` : 'All caught up!'}
    </p>
  </div>
);

const SendMessageCard = ({ 
  sendTo, 
  onSendToChange, 
  sendMessage, 
  onSendMessageChange, 
  sendGifUrl, 
  onSendGifUrlChange,
  onSendMessage,
  sending,
  onInsertEmoji 
}) => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2 bg-primary/10 border-b border-primary/30">
      <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        Send Message
      </h2>
    </div>
    <form onSubmit={onSendMessage} className="p-4 space-y-4">
      <div>
        <label className="block text-xs font-heading text-mutedForeground uppercase tracking-wider mb-1.5">
          To
        </label>
        <input
          type="text"
          value={sendTo}
          onChange={(e) => onSendToChange(e.target.value)}
          placeholder="Username"
          className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
        />
      </div>
      
      <div>
        <label className="block text-xs font-heading text-mutedForeground uppercase tracking-wider mb-1.5">
          Message
        </label>
        <textarea
          value={sendMessage}
          onChange={(e) => onSendMessageChange(e.target.value)}
          placeholder="Type a message..."
          rows={3}
          className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none resize-y"
        />
        <div className="mt-2">
          <span className="text-xs font-heading text-mutedForeground uppercase tracking-wider">
            Smileys
          </span>
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {EMOJI_ROWS.flat().map((emoji) => (
              <button 
                key={emoji} 
                type="button" 
                onClick={() => onInsertEmoji(emoji)} 
                className="text-lg leading-none p-1.5 rounded hover:bg-primary/20 transition-all" 
                title="Insert emoji"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      <div>
        <label className="block text-xs font-heading text-mutedForeground uppercase tracking-wider mb-1.5">
          GIF URL (optional)
        </label>
        <input
          type="url"
          value={sendGifUrl}
          onChange={(e) => onSendGifUrlChange(e.target.value)}
          placeholder="https://..."
          className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
        />
      </div>
      
      <button
        type="submit"
        disabled={sending}
        className="w-full bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground rounded-lg font-heading font-bold uppercase tracking-wide py-3 border-2 border-yellow-600/50 transition-all shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed touch-manipulation"
      >
        {sending ? 'Sending...' : '📤 Send Message'}
      </button>
    </form>
  </div>
);

const NotificationItem = ({ notification, onMarkRead, onDelete, onOcAccept, onOcDecline }) => {
  const Icon = NOTIFICATION_ICONS[notification.notification_type] || Bell;
  const timeAgo = getTimeAgo(notification.created_at);
  const isOcInvite = !!notification.oc_invite_id;

  return (
    <div
      className={`rounded-md p-4 transition-all border ${
        notification.read
          ? 'bg-secondary/50 border-border opacity-80'
          : 'bg-card border-primary/30'
      }`}
      data-testid={`notification-${notification.id}`}
    >
      {/* Mobile: Stacked, Desktop: Horizontal */}
      <div className="space-y-3 md:space-y-0 md:flex md:items-start md:gap-3">
        {/* Icon */}
        <div className={`p-2 rounded-md shrink-0 w-fit ${
          notification.read 
            ? 'bg-secondary border border-border' 
            : 'bg-primary/20 border border-primary/30'
        }`}>
          <Icon size={20} className={notification.read ? 'text-mutedForeground' : 'text-primary'} />
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm md:text-base font-heading font-bold text-foreground">
              {notification.title}
            </h3>
            <span className="text-xs text-mutedForeground font-heading whitespace-nowrap">
              {timeAgo}
            </span>
          </div>
          
          <p className="text-sm text-mutedForeground font-heading">
            {notification.message}
          </p>
          
          {notification.notification_type === 'user_message' && notification.gif_url && (
            <div className="mt-2">
              <img 
                src={notification.gif_url} 
                alt="GIF" 
                className="max-w-full sm:max-w-[200px] max-h-[150px] rounded-md border border-primary/20 object-cover" 
              />
            </div>
          )}
          
          {isOcInvite && onOcAccept && onOcDecline && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOcAccept(notification.oc_invite_id)}
                className="bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 rounded-md px-3 py-1.5 text-sm font-heading font-bold uppercase tracking-wide transition-all touch-manipulation"
              >
                ✓ Accept
              </button>
              <button
                onClick={() => onOcDecline(notification.oc_invite_id)}
                className="bg-secondary text-mutedForeground border border-border hover:text-foreground hover:border-primary/30 rounded-md px-3 py-1.5 text-sm font-heading font-bold uppercase tracking-wide transition-all touch-manipulation"
              >
                ✗ Decline
              </button>
            </div>
          )}
          
          {/* Actions for mobile */}
          <div className="flex items-center gap-2 md:hidden">
            {!notification.read && !isOcInvite && (
              <button
                onClick={() => onMarkRead(notification.id)}
                className="text-xs font-heading font-bold text-primary hover:text-primary/80 uppercase tracking-wide"
              >
                Mark read
              </button>
            )}
            <button
              onClick={() => onDelete(notification.id)}
              className="p-1.5 rounded text-mutedForeground hover:text-red-400 hover:bg-red-400/10 transition-all"
              title="Delete"
              aria-label="Delete message"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        
        {/* Actions for desktop */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          {!notification.read && !isOcInvite && (
            <button
              onClick={() => onMarkRead(notification.id)}
              className="text-xs font-heading font-bold text-primary hover:text-primary/80 uppercase tracking-wide whitespace-nowrap"
            >
              Mark read
            </button>
          )}
          <button
            onClick={() => onDelete(notification.id)}
            className="p-1.5 rounded text-mutedForeground hover:text-red-400 hover:bg-red-400/10 transition-all"
            title="Delete"
            aria-label="Delete message"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

const EmptyState = () => (
  <div className="bg-card rounded-md py-16 text-center" data-testid="no-notifications">
    <MailOpen size={64} className="mx-auto text-primary/50 mb-4" />
    <p className="text-foreground font-heading text-lg mb-2">No notifications yet</p>
    <p className="text-sm text-mutedForeground font-heading">
      Rank up, get attacked, or hire bodyguards to receive notifications
    </p>
  </div>
);

// Main component
export default function Inbox() {
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const initialFilter = VALID_FILTERS.includes(filterParam) ? filterParam : 'all';
  
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilter);
  const [sendTo, setSendTo] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sendGifUrl, setSendGifUrl] = useState('');
  const [sending, setSending] = useState(false);

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

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (VALID_FILTERS.includes(filterParam)) setFilter(filterParam);
  }, [filterParam]);

  const markAsRead = async (notificationId) => {
    try {
      await api.post(`/notifications/${notificationId}/read`);
      fetchNotifications();
    } catch (error) {
      toast.error('Failed to mark as read');
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.post('/notifications/read-all');
      fetchNotifications();
      toast.success('All notifications marked as read');
    } catch (error) {
      toast.error('Failed to mark all as read');
    }
  };

  const deleteMessage = async (notificationId) => {
    try {
      await api.delete(`/notifications/${notificationId}`);
      fetchNotifications();
      toast.success('Message deleted');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete message');
    }
  };

  const deleteAllMessages = async () => {
    if (!window.confirm('Delete all messages in your inbox?')) return;
    try {
      const res = await api.delete('/notifications');
      fetchNotifications();
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
      fetchNotifications();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const insertEmoji = (emoji) => setSendMessage(m => m + emoji);

  const filteredNotifications = filter === 'all' 
    ? notifications 
    : filter === 'unread'
      ? notifications.filter(n => !n.read)
      : notifications.filter(n => n.notification_type === filter);

  if (loading) {
    return <LoadingSpinner />;
  }

  const filterButtons = [
    { value: 'all', label: 'All' },
    { value: 'unread', label: 'Unread' },
    { value: 'rank_up', label: 'Rank Up' },
    { value: 'reward', label: 'Reward' },
    { value: 'bodyguard', label: 'Bodyguard' },
    { value: 'attack', label: 'Attack' },
    { value: 'system', label: 'System' },
    { value: 'user_message', label: 'Messages' },
  ];

  return (
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="inbox-page">
      <PageHeader unreadCount={unreadCount} />

      <SendMessageCard
        sendTo={sendTo}
        onSendToChange={setSendTo}
        sendMessage={sendMessage}
        onSendMessageChange={setSendMessage}
        sendGifUrl={sendGifUrl}
        onSendGifUrlChange={setSendGifUrl}
        onSendMessage={handleSendMessage}
        sending={sending}
        onInsertEmoji={insertEmoji}
      />

      {/* Filters and actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {filterButtons.map(btn => (
            <button
              key={btn.value}
              onClick={() => setFilter(btn.value)}
              className={`px-3 py-2 rounded-md text-sm font-heading font-bold whitespace-nowrap transition-all border touch-manipulation ${
                filter === btn.value
                  ? 'bg-primary/20 text-primary border-primary/50'
                  : 'bg-secondary text-mutedForeground border-border hover:text-foreground hover:border-primary/30'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground rounded-md px-4 py-2 text-sm font-heading font-bold uppercase tracking-wide border border-yellow-600/50 transition-all shadow-lg shadow-primary/20 touch-manipulation"
              data-testid="mark-all-read"
            >
              Mark All Read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={deleteAllMessages}
              className="bg-secondary text-mutedForeground border border-border hover:text-red-400 hover:border-red-400/50 rounded-md px-4 py-2 text-sm font-heading font-bold uppercase tracking-wide transition-all touch-manipulation"
              data-testid="delete-all"
            >
              Delete All
            </button>
          )}
        </div>
      </div>

      {/* Notifications list */}
      {filteredNotifications.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3" data-testid="notifications-list">
          {filteredNotifications.map(notification => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkRead={markAsRead}
              onDelete={deleteMessage}
              onOcAccept={handleOcInviteAccept}
              onOcDecline={handleOcInviteDecline}
            />
          ))}
        </div>
      )}
    </div>
  );
}