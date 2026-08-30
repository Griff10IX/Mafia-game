import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ChevronRight, Bell, Trophy, Shield, Skull, Gift, MessageCircle, Bot } from 'lucide-react';
import api from '../../utils/api';
import { getDashboardWidget, setDashboardWidget } from '../../utils/dashboardWidgetCache';
import { NotificationMessage } from '../NotificationMessage';
import { toast } from 'sonner';
import dash from '../../styles/dashboard.module.css';
import { DashPanel, DashHeader, DashBody, DashLoading } from './dashChrome';

const NOTIFICATION_ICONS = {
  rank_up: Trophy,
  reward: Gift,
  bodyguard: Shield,
  attack: Skull,
  system: Bell,
  user_message: MessageCircle,
  staff_bot_client: Bot,
};

const NOTIFICATION_TYPE_ICON = {
  staff_bot_client: 'text-red-400',
  system: 'text-amber-400',
  user_message: 'text-primary',
  rank_up: 'text-yellow-400',
  reward: 'text-emerald-400',
  bodyguard: 'text-sky-400',
  attack: 'text-rose-400',
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

const WIDGET_KEY = 'notifications';

export default function NotificationsWidget({ onRefresh, userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get('/notifications');
      const d = res.data;
      setData(d);
      if (d) setDashboardWidget(userId, WIDGET_KEY, d);
    } catch {
      // Keep previous data on transient failures
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setData(null);
      setLoading(true);
      return;
    }
    const cached = getDashboardWidget(userId, WIDGET_KEY);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    fetchNotifications();
  }, [userId, fetchNotifications]);

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
    return <DashLoading icon={Mail} />;
  }

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unread_count ?? 0;
  const preview = notifications.slice(0, 3);

  const actionNode = (
    <div className="flex items-center gap-1.5">
      {unreadCount > 0 && (
        <button
          type="button"
          onClick={handleMarkAllRead}
          disabled={markingRead}
          className={`${dash.panelAction} disabled:opacity-50 font-heading`}
        >
          Mark all
        </button>
      )}
      <Link to="/social/inbox" className={`${dash.panelAction} font-heading`}>
        Inbox <ChevronRight size={10} aria-hidden />
      </Link>
    </div>
  );

  return (
    <DashPanel>
      <DashHeader
        title="Notifications"
        icon={Mail}
        actionNode={actionNode}
        badge={unreadCount > 0 ? (
          <span className="bg-primary/30 text-primary text-[9px] px-1.5 py-0.5 rounded font-bold">
            {unreadCount}
          </span>
        ) : null}
      />
      <DashBody className="space-y-1" compact>
        {preview.length === 0 ? (
          <p className="text-[10px] font-heading text-mutedForeground">No notifications</p>
        ) : (
          preview.map((n) => {
            const Icon = NOTIFICATION_ICONS[n.notification_type] || Bell;
            return (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                className={n.read ? dash.rowMuted : dash.rowActive}
                style={{ cursor: n.read ? 'default' : 'pointer', alignItems: 'flex-start' }}
                onClick={() => !n.read && handleMarkRead(n.id)}
                onKeyDown={(e) => {
                  if (!n.read && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    handleMarkRead(n.id);
                  }
                }}
              >
                <Icon size={12} className={`shrink-0 mt-0.5 ${n.read ? 'text-mutedForeground' : (NOTIFICATION_TYPE_ICON[n.notification_type] || 'text-primary')}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-[10px] font-heading truncate ${n.read ? 'text-mutedForeground' : 'text-foreground font-medium'}`}>
                    {n.title}
                  </p>
                  <div className="text-[9px] text-mutedForeground line-clamp-2">
                    <NotificationMessage
                      message={n.message}
                      actorUsername={n.actor_username}
                      topicId={n.topic_id}
                      topicTitle={n.topic_title}
                      commentId={n.comment_id}
                      messageLinkTo={n.message_link_to}
                      messageLinkLabel={n.message_link_label}
                      className="text-inherit"
                    />
                  </div>
                  <span className="text-[8px] text-mutedForeground">{getTimeAgo(n.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </DashBody>
    </DashPanel>
  );
}
