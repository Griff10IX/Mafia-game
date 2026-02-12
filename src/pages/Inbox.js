// Inbox page - notifications list
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, MailOpen, Bell, Trophy, Shield, Skull, Gift, Trash2 } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const NOTIFICATION_ICONS = {
  rank_up: Trophy,
  reward: Gift,
  bodyguard: Shield,
  attack: Skull,
  system: Bell
};

function NotificationItem({ notification, onMarkRead, onDelete }) {
  const Icon = NOTIFICATION_ICONS[notification.notification_type] || Bell;
  const timeAgo = getTimeAgo(notification.created_at);

  return (
    <div
      className={`rounded-sm p-4 transition-smooth border ${
        notification.read
          ? `${styles.surfaceMuted} border-primary/10 opacity-90`
          : `${styles.panel} border-primary/30`
      }`}
      data-testid={`notification-${notification.id}`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-sm shrink-0 ${notification.read ? `${styles.surface} border border-primary/10` : 'bg-primary/20 border border-primary/30'}`}>
          <Icon size={18} className={notification.read ? 'text-mutedForeground' : 'text-primary'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-heading font-bold text-foreground truncate">{notification.title}</h3>
            <span className="text-xs text-mutedForeground font-heading whitespace-nowrap">{timeAgo}</span>
          </div>
          <p className="text-xs text-mutedForeground font-heading">{notification.message}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!notification.read && (
            <button
              onClick={() => onMarkRead(notification.id)}
              className="text-xs font-heading font-bold text-primary hover:text-primary/80 uppercase tracking-wider"
            >
              Mark read
            </button>
          )}
          <button
            onClick={() => onDelete(notification.id)}
            className="p-1.5 rounded text-mutedForeground hover:text-destructive hover:bg-destructive/10 transition-smooth"
            title="Delete"
            aria-label="Delete message"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function getTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const VALID_FILTERS = ['all', 'unread', 'rank_up', 'reward', 'bodyguard', 'attack', 'system'];

export default function Inbox() {
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const initialFilter = VALID_FILTERS.includes(filterParam) ? filterParam : 'all';
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilter);

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await api.get('/notifications');
      setNotifications(response.data.notifications);
      setUnreadCount(response.data.unread_count);
    } catch (error) {
      toast.error('Failed to load notifications');
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

  const filteredNotifications = filter === 'all' 
    ? notifications 
    : filter === 'unread'
      ? notifications.filter(n => !n.read)
      : notifications.filter(n => n.notification_type === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="inbox-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">Inbox</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {['all', 'unread', 'rank_up', 'reward', 'bodyguard', 'attack', 'system'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-sm text-xs font-heading font-bold whitespace-nowrap transition-smooth border ${
                filter === f
                  ? 'bg-primary/20 text-primary border-primary/50'
                  : `${styles.surface} ${styles.raisedHover} text-mutedForeground border-primary/20`
              }`}
            >
              {f === 'rank_up' ? 'Rank Up' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 px-4 py-2 rounded-sm text-xs font-heading font-bold uppercase tracking-wider border border-yellow-600/50 transition-smooth"
              data-testid="mark-all-read"
            >
              Mark All Read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={deleteAllMessages}
              className="px-4 py-2 rounded-sm text-xs font-heading font-bold uppercase tracking-wider border border-primary/30 text-mutedForeground hover:text-destructive hover:border-destructive/50 transition-smooth"
              data-testid="delete-all"
            >
              Delete All
            </button>
          )}
        </div>
      </div>

      {filteredNotifications.length === 0 ? (
        <div className={`${styles.panel} rounded-sm py-12 text-center`} data-testid="no-notifications">
          <MailOpen size={48} className="mx-auto text-primary/50 mb-4" />
          <p className="text-mutedForeground font-heading">No notifications yet</p>
          <p className="text-xs text-mutedForeground font-heading mt-1">Rank up, get attacked, or hire bodyguards to receive notifications</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="notifications-list">
          {filteredNotifications.map(notification => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkRead={markAsRead}
              onDelete={deleteMessage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
