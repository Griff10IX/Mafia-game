import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ChevronRight, Bell, Trophy, Shield, Skull, Gift, MessageCircle } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const NOTIFICATION_ICONS = {
  rank_up: Trophy,
  reward: Gift,
  bodyguard: Shield,
  attack: Skull,
  system: Bell,
  user_message: MessageCircle,
};

function getTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function NotificationsWidget({ onRefresh }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get('/notifications');
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const handleMarkRead = async (notificationId) => {
    try {
      await api.post('/notifications/' + notificationId + '/read');
      setData(prev => prev ? {
        ...prev,
        notifications: prev.notifications.map(n => n.id === notificationId ? { ...n, read: true } : n),
        unread_count: Math.max(0, (prev.unread_count || 0) - 1),
      } : null);
      onRefresh?.();
    } catch {
      toast.error('Failed to mark as read');
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingRead(true);
    try {
      await api.post('/notifications/read-all');
      setData(prev => prev ? {
        ...prev,
        notifications: prev.notifications.map(n => ({ ...n, read: true })),
        unread_count: 0,
      } : null);
      onRefresh?.();
    } catch {
      toast.error('Failed to mark all as read');
    } finally {
      setMarkingRead(false);
    }
  };

  if (loading) {
    return (
      <div className={`${styles.panel} rounded-md border border-primary/20 p-2.5`}>
        <div className="flex items-center gap-2 text-mutedForeground">
          <Mail size={14} className="animate-pulse" />
          <span className="text-[10px] font-heading">Loading...</span>
        </div>
      </div>
    );
  }

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unread_count ?? 0;
  const preview = notifications.slice(0, 3);

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
          <Mail size={10} />
          Notifications
          {unreadCount > 0 && (
            <span className="bg-primary/30 text-primary text-[9px] px-1.5 py-0.5 rounded font-bold">
              {unreadCount}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={markingRead}
              className="text-[9px] font-heading text-primary hover:text-primary/80 disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
          <Link to="/social/inbox" className="text-[9px] font-heading text-primary hover:text-primary/80 flex items-center gap-0.5">
            Inbox <ChevronRight size={10} />
          </Link>
        </div>
      </div>
      <div className="p-2 space-y-1">
        {preview.length === 0 ? (
          <p className="text-[10px] font-heading text-mutedForeground">No notifications</p>
        ) : (
          preview.map((n) => {
            const Icon = NOTIFICATION_ICONS[n.notification_type] || Bell;
            return (
              <div
                key={n.id}
                className={`flex items-start gap-1.5 px-2 py-1 rounded border cursor-pointer transition-colors ${
                  n.read ? 'bg-zinc-800/20 border-zinc-700/30' : 'bg-primary/5 border-primary/30'
                }`}
                onClick={() => !n.read && handleMarkRead(n.id)}
              >
                <Icon size={12} className={`shrink-0 mt-0.5 ${n.read ? 'text-mutedForeground' : 'text-primary'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-[10px] font-heading truncate ${n.read ? 'text-mutedForeground' : 'text-foreground font-medium'}`}>
                    {n.title}
                  </p>
                  <p className="text-[9px] text-mutedForeground line-clamp-2">{n.message}</p>
                  <span className="text-[8px] text-mutedForeground">{getTimeAgo(n.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
