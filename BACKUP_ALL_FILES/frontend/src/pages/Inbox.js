// Inbox page - notifications list
import { useState, useEffect, useCallback } from 'react';
import { Mail, MailOpen, Bell, Trophy, Shield, Skull, Gift } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

const NOTIFICATION_ICONS = {
  rank_up: Trophy,
  reward: Gift,
  bodyguard: Shield,
  attack: Skull,
  system: Bell
};

function NotificationItem({ notification, onMarkRead }) {
  const Icon = NOTIFICATION_ICONS[notification.notification_type] || Bell;
  const timeAgo = getTimeAgo(notification.created_at);

  return (
    <div
      className={`border rounded-sm p-4 transition-smooth ${
        notification.read 
          ? 'bg-card border-border opacity-70' 
          : 'bg-card border-primary'
      }`}
      data-testid={`notification-${notification.id}`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-sm ${notification.read ? 'bg-secondary' : 'bg-primary/20'}`}>
          <Icon size={18} className={notification.read ? 'text-mutedForeground' : 'text-primary'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground truncate">{notification.title}</h3>
            <span className="text-xs text-mutedForeground whitespace-nowrap">{timeAgo}</span>
          </div>
          <p className="text-xs text-mutedForeground">{notification.message}</p>
        </div>
        {!notification.read && (
          <button
            onClick={() => onMarkRead(notification.id)}
            className="text-xs text-primary hover:underline"
          >
            Mark read
          </button>
        )}
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

export default function Inbox() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

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
    <div className="space-y-6" data-testid="inbox-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mb-2">Inbox</h1>
          <p className="text-sm text-mutedForeground">
            {unreadCount > 0 ? `${unreadCount} unread notifications` : 'All caught up!'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="bg-primary hover:bg-primary/90 text-background px-4 py-2 rounded-sm text-sm font-semibold transition-smooth"
            data-testid="mark-all-read"
          >
            Mark All Read
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {['all', 'unread', 'rank_up', 'reward', 'bodyguard', 'attack', 'system'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-sm text-xs font-semibold whitespace-nowrap transition-smooth ${
              filter === f 
                ? 'bg-primary text-background' 
                : 'bg-secondary text-mutedForeground hover:text-foreground'
            }`}
          >
            {f === 'rank_up' ? 'Rank Up' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filteredNotifications.length === 0 ? (
        <div className="text-center py-12" data-testid="no-notifications">
          <MailOpen size={48} className="mx-auto text-mutedForeground mb-4" />
          <p className="text-mutedForeground">No notifications yet</p>
          <p className="text-xs text-mutedForeground mt-1">Rank up, get attacked, or hire bodyguards to receive notifications</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="notifications-list">
          {filteredNotifications.map(notification => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkRead={markAsRead}
            />
          ))}
        </div>
      )}
    </div>
  );
}
