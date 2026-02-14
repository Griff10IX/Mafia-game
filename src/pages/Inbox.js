import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Mail, MailOpen, Bell, Trophy, Shield, Skull, Gift, Trash2, MessageCircle, Send, X, ChevronRight } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import GifPicker from '../components/GifPicker';
import styles from '../styles/noir.module.css';

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
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = ({ unreadCount, onCompose }) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 flex items-center gap-3">
        <Mail className="w-8 h-8 md:w-10 md:h-10" />
        Inbox
      </h1>
      <p className="text-sm text-mutedForeground">
        {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
      </p>
    </div>
    <button
      onClick={onCompose}
      className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg px-4 md:px-6 py-2.5 md:py-3 font-heading font-bold uppercase tracking-wide text-sm border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all active:scale-95 touch-manipulation flex items-center gap-2"
    >
      <Send size={18} />
      <span className="hidden sm:inline">Compose</span>
    </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-card rounded-lg border-2 border-primary/30 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 md:px-6 py-4 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <h2 className="text-lg font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
            <Send size={20} />
            New Message
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-secondary rounded transition-colors"
          >
            <X size={20} className="text-mutedForeground" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSendMessage} className="p-4 md:p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-heading text-mutedForeground mb-2">
              To
            </label>
            <input
              type="text"
              value={sendTo}
              onChange={(e) => onSendToChange(e.target.value)}
              placeholder="Enter username..."
              className="w-full bg-input border border-border rounded-md px-4 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-sm font-heading text-mutedForeground mb-2">
              Message
            </label>
            <textarea
              value={sendMessage}
              onChange={(e) => onSendMessageChange(e.target.value)}
              placeholder="Type your message..."
              rows={5}
              className="w-full bg-input border border-border rounded-md px-4 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y transition-colors"
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {EMOJI_ROWS.flat().map((emoji) => (
                <button 
                  key={emoji} 
                  type="button" 
                  onClick={() => onInsertEmoji(emoji)} 
                  className="text-base p-1.5 rounded hover:bg-primary/20 active:scale-95 transition-all" 
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-heading text-mutedForeground">
                GIF (Optional)
              </label>
              {onOpenGifPicker && (
                <button
                  type="button"
                  onClick={onOpenGifPicker}
                  className="text-xs font-heading font-bold text-primary hover:text-primary/80 uppercase"
                >
                  Search GIPHY →
                </button>
              )}
            </div>
            {showGifPicker && (
              <GifPicker
                onSelect={gifPickerOnSelect}
                onClose={gifPickerOnClose}
                className="mb-2"
              />
            )}
            <input
              type="url"
              value={sendGifUrl}
              onChange={(e) => onSendGifUrlChange(e.target.value)}
              placeholder="Paste GIF URL..."
              className="w-full bg-input border border-border rounded-md px-4 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>
          
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-secondary text-foreground border border-border hover:bg-secondary/80 rounded-lg px-6 py-3 font-heading font-bold uppercase tracking-wide text-sm transition-all active:scale-95"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="flex-1 bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg px-6 py-3 font-heading font-bold uppercase tracking-wide text-sm border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
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
  const Icon = NOTIFICATION_ICONS[notification.notification_type] || Bell;
  const timeAgo = getTimeAgo(notification.created_at);
  const isOcInvite = !!notification.oc_invite_id;
  const isUserMessage = notification.notification_type === 'user_message';
  
  // Get recipient for sent messages
  const recipient = isSent ? (notification.recipient_username || notification.to_username || notification.target_username) : null;

  return (
    <div
      onClick={onClick}
      className={`group relative flex items-center gap-3 px-4 py-3 border-b border-border cursor-pointer transition-all ${
        isSelected 
          ? 'bg-primary/10 border-l-4 border-l-primary' 
          : isSent
          ? 'bg-secondary/20 hover:bg-secondary/40 border-l-4 border-l-transparent'
          : notification.read 
          ? 'bg-secondary/30 hover:bg-secondary/50' 
          : 'bg-card hover:bg-secondary/30 border-l-4 border-l-primary/50'
      }`}
    >
      {/* Icon */}
      <div className={`p-2 rounded-md shrink-0 ${
        isSent ? 'bg-primary/20' : notification.read ? 'bg-secondary' : 'bg-primary/20'
      }`}>
        {isSent ? (
          <Send size={18} className="text-primary" />
        ) : (
          <Icon size={18} className={notification.read ? 'text-mutedForeground' : 'text-primary'} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className={`text-sm font-heading truncate ${
            isSent ? 'text-foreground' : notification.read ? 'text-foreground' : 'text-foreground font-bold'
          }`}>
            {isSent ? `To: ${recipient || 'Unknown'}` : notification.title}
          </h3>
          <span className="text-xs text-mutedForeground whitespace-nowrap">
            {timeAgo}
          </span>
        </div>
        <p className="text-xs text-mutedForeground truncate">
          {notification.message}
        </p>
      </div>

      {/* Unread indicator or Sent badge */}
      {isSent ? (
        <div className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-bold shrink-0">
          SENT
        </div>
      ) : !notification.read ? (
        <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
      ) : null}

      {/* Arrow */}
      <ChevronRight size={16} className="text-mutedForeground shrink-0" />
      
      {/* Hover Preview Tooltip */}
      <div className="absolute left-full ml-2 top-0 z-50 hidden group-hover:block pointer-events-none">
        <div className="bg-zinc-900 border-2 border-primary/40 rounded-lg p-4 shadow-2xl max-w-sm w-80">
          <div className="flex items-start gap-3 mb-3">
            <div className="p-2 rounded-md bg-primary/20 border border-primary/30">
              {isSent ? (
                <Send size={16} className="text-primary" />
              ) : (
                <Icon size={16} className="text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-heading font-bold text-primary mb-1">
                {isSent ? `To: ${recipient || 'Unknown'}` : notification.title}
              </h4>
              <p className="text-xs text-mutedForeground">
                {timeAgo}
              </p>
            </div>
          </div>
          <p className="text-sm text-foreground leading-relaxed max-h-32 overflow-y-auto">
            {notification.message}
          </p>
          {notification.gif_url && (
            <div className="mt-2">
              <img 
                src={notification.gif_url} 
                alt="GIF preview" 
                className="max-w-full max-h-24 rounded border border-primary/20" 
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const MessageDetail = ({ notification, onMarkRead, onDelete, onOcAccept, onOcDecline, onOpenChat, isSent }) => {
  if (!notification) {
    return (
      <div className="flex-1 flex items-center justify-center bg-secondary/20">
        <div className="text-center">
          <MailOpen size={64} className="mx-auto text-primary/30 mb-4" />
          <p className="text-mutedForeground font-heading">
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
    <div className="flex-1 flex flex-col bg-card">
      {/* Message Header */}
      <div className="px-4 md:px-6 py-4 border-b border-border bg-secondary/30">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-md bg-primary/20 border border-primary/30">
              <Icon size={24} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-heading font-bold text-foreground mb-1">
                {isSent ? `To: ${recipient || 'Unknown'}` : notification.title}
              </h2>
              <p className="text-sm text-mutedForeground">
                {isSent && <span className="text-primary font-bold mr-2">Sent</span>}
                {getTimeAgo(notification.created_at)}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {!isSent && !notification.read && (
            <button
              onClick={() => onMarkRead(notification.id)}
              className="px-3 py-1.5 rounded-md bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 text-xs font-heading font-bold uppercase transition-all"
            >
              ✓ Mark Read
            </button>
          )}
          {!isSent && isUserMessage && (
            <button
              onClick={() => onOpenChat(notification)}
              className="px-3 py-1.5 rounded-md bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 text-xs font-heading font-bold uppercase transition-all"
            >
              💬 Reply
            </button>
          )}
          <button
            onClick={() => onDelete(notification.id)}
            className="px-3 py-1.5 rounded-md bg-secondary text-mutedForeground border border-border hover:text-red-400 hover:border-red-400/50 text-xs font-heading font-bold uppercase transition-all"
          >
            🗑️ Delete
          </button>
        </div>
      </div>

      {/* Message Body */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="prose prose-invert max-w-none">
          <p className="text-foreground leading-relaxed whitespace-pre-wrap">
            {notification.message}
          </p>
          
          {notification.gif_url && (
            <div className="mt-4">
              <img 
                src={notification.gif_url} 
                alt="GIF" 
                className="max-w-full max-h-[400px] rounded-md border border-primary/20 shadow-lg" 
              />
            </div>
          )}

          {!isSent && isOcInvite && (
            <div className="mt-6 p-4 bg-primary/10 border border-primary/30 rounded-md">
              <p className="text-sm text-foreground font-heading font-bold mb-3">
                Organised Crime Invitation
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => onOcAccept(notification.oc_invite_id)}
                  className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black border border-yellow-600/50 rounded-md px-4 py-2 text-sm font-heading font-bold uppercase shadow-md shadow-primary/20 transition-all active:scale-95"
                >
                  ✓ Accept Invitation
                </button>
                <button
                  onClick={() => onOcDecline(notification.oc_invite_id)}
                  className="bg-secondary text-foreground border border-border hover:border-primary/30 rounded-md px-4 py-2 text-sm font-heading font-bold uppercase transition-all active:scale-95"
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
      if (selectedNotification?.id === notificationId) {
        setSelectedNotification(null);
      }
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
      setSelectedNotification(null);
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
    return <LoadingSpinner />;
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
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="inbox-page">
      <PageHeader unreadCount={unreadCount} onCompose={() => setShowCompose(true)} />

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
      <div className="bg-card border border-primary/20 rounded-lg overflow-hidden">
        {/* Toolbar */}
        <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 flex-1">
            {filterButtons.map(btn => {
              const Icon = btn.icon;
              return (
                <button
                  key={btn.value}
                  onClick={() => setFilter(btn.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-heading font-bold whitespace-nowrap transition-all border ${
                    filter === btn.value
                      ? 'bg-primary/20 text-primary border-primary/50'
                      : 'bg-secondary/50 text-mutedForeground border-border hover:text-foreground'
                  }`}
                >
                  <Icon size={14} />
                  {btn.label}
                </button>
              );
            })}
          </div>
          
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="px-3 py-1.5 rounded-md bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 text-xs font-heading font-bold uppercase whitespace-nowrap transition-all"
              >
                ✓ Mark All Read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={deleteAllMessages}
                className="px-3 py-1.5 rounded-md bg-secondary text-mutedForeground border border-border hover:text-red-400 hover:border-red-400/50 text-xs font-heading font-bold uppercase whitespace-nowrap transition-all"
              >
                🗑️ Delete All
              </button>
            )}
          </div>
        </div>

        {/* Inbox Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5">
          {/* Message List */}
          <div className="lg:col-span-2 border-r border-border bg-secondary/20 max-h-[600px] overflow-y-auto">
            {filteredNotifications.length === 0 ? (
              <div className="p-8 text-center">
                <MailOpen size={48} className="mx-auto text-primary/30 mb-3" />
                <p className="text-sm text-mutedForeground font-heading">
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
            <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center gap-3">
              <button
                onClick={() => setSelectedNotification(null)}
                className="p-2 hover:bg-secondary rounded transition-colors"
              >
                <X size={20} className="text-foreground" />
              </button>
              <h2 className="text-sm font-heading font-bold text-primary uppercase">
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
