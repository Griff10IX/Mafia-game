import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Mail, MailOpen, Bell, Trophy, Shield, Skull, Gift, MessageCircle, Send, X, ChevronRight, Bot } from 'lucide-react';
import api, { apiGetWithResumeRetries } from '../../utils/api';
import { toast } from 'sonner';
import { parseForumContent } from '../../utils/forumContent';
import styles from '../../styles/noir.module.css';
import { NotificationMessage } from '../../components/NotificationMessage';
import {
  INBOX_STYLES,
  IB_ACTION_GO,
  IB_ACTION_DANGER,
  InboxHairline,
  InboxArtLine,
  InboxBar,
} from './inboxChrome';
import MessageComposer from './MessageComposer';
import UserToField from './UserToField';

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
  const msg = String(detail || '').toLowerCase();
  if (msg.includes('expired')) return 'This OC invite expired.';
  if (msg.includes('already accepted')) return 'This OC invite was already accepted.';
  if (msg.includes('already cancelled')) return 'This OC invite was cancelled by the creator.';
  if (msg.includes('already declined')) return 'This OC invite was already declined.';
  if (msg.includes('already')) return 'This OC invite was already updated.';
  return action === 'accept' ? 'Failed to accept invite' : 'Failed to decline invite';
}

function sentRecipient(notification) {
  return notification.recipient_username || notification.to_username || notification.target_username || null;
}

function ComposePanel({
  onClose,
  sendTo,
  onSendToChange,
  sendMessage,
  onSendMessageChange,
  sendGifUrl,
  onSendGifUrlChange,
  onSendMessage,
  sending,
}) {
  return (
    <div className="flex flex-col h-full min-h-[280px]">
      <InboxBar className="flex items-center justify-between shrink-0">
        <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
          <Send size={12} />
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
      </InboxBar>
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        <UserToField value={sendTo} onChange={onSendToChange} autoFocus />
        <MessageComposer
          value={sendMessage}
          onChange={onSendMessageChange}
          gifUrl={sendGifUrl}
          onGifUrlChange={onSendGifUrlChange}
          onSubmit={onSendMessage}
          sending={sending}
          minHeightClass="min-h-32"
          showCancel
          onCancel={onClose}
        />
      </div>
    </div>
  );
}

const MessageRow = ({ notification, isSelected, onClick, onMarkRead, isSent }) => {
  const Icon = NOTIFICATION_ICONS[notification.notification_type] || Bell;
  const timeAgo = getTimeAgo(notification.created_at);
  const recipient = isSent ? sentRecipient(notification) : null;

  const handleMouseEnter = () => {
    if (!isSent && !notification.read && onMarkRead) {
      onMarkRead(notification.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={handleMouseEnter}
      className={`ib-row group relative flex w-full items-center gap-2 px-2.5 py-1.5 min-h-11 text-left border-b border-border/60 cursor-pointer transition-all touch-manipulation ${
        isSelected
          ? 'bg-primary/12 border-l-2 border-l-primary'
          : isSent
          ? 'bg-transparent hover:bg-secondary/40 border-l-2 border-l-transparent'
          : notification.read
          ? 'bg-transparent hover:bg-secondary/40 border-l-2 border-l-transparent'
          : 'bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary/50'
      }`}
    >
      <div className={`p-1 rounded shrink-0 ${
        isSent ? 'bg-primary/20' : notification.read ? 'bg-secondary' : 'bg-primary/20'
      }`}>
        {isSent ? (
          <Send size={12} className="text-primary" />
        ) : (
          <Icon size={12} className={notification.read ? 'text-mutedForeground' : 'text-primary'} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <h3 className="text-xs font-heading font-bold text-foreground truncate">
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

      {isSent ? (
        <div className="px-1 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-bold shrink-0">
          SENT
        </div>
      ) : !notification.read ? (
        <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
      ) : null}

      <ChevronRight size={14} className="text-mutedForeground shrink-0" />
    </div>
  );
};

const MessageDetail = ({ notification, onMarkRead, onDelete, onOcAccept, onOcDecline, onOpenChat, isSent, censorProfanity }) => {
  if (!notification) {
    return (
      <div className="flex-1 flex items-center justify-center bg-secondary/20 min-h-[200px]">
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
  const recipient = isSent ? sentRecipient(notification) : null;

  return (
    <div className={`flex-1 flex flex-col ${styles.panel}`}>
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
            className={IB_ACTION_DANGER}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5">
        <div className="prose prose-invert max-w-none">
          {isBbDirectMessage &&
          notification.message &&
          !(notification.message === '(GIF)' && notification.gif_url) ? (
            <div
              className="text-[11px] sm:text-sm text-foreground forum-content leading-snug break-words"
              dangerouslySetInnerHTML={{
                __html: parseForumContent(notification.message, {
                  censorProfanity: !!censorProfanity,
                  dmUnicodeSmileys: true,
                }),
              }}
            />
          ) : (
            <p className="text-[11px] sm:text-sm text-foreground leading-snug whitespace-pre-wrap">
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
                  className={IB_ACTION_DANGER}
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

export default function Inbox() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
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
      if (response.data?.read_retention_days != null) {
        setReadRetentionDays(response.data.read_retention_days);
      }
      if (response.data?.unread_retention_days != null) {
        setUnreadRetentionDays(response.data.unread_retention_days);
      }
    } catch (error) {
      if (!silent) {
        toast.error("Messages didn't load. Check your connection — try again or reopen this tab.");
      }
    } finally {
      setHasLoaded(true);
    }
  }, []);

  const fetchSentMessages = useCallback(async () => {
    try {
      const response = await apiGetWithResumeRetries('/notifications/sent');
      const sent = response.data?.sent_messages ?? [];
      setSentMessages(sent);
      return sent;
    } catch (error) {
      setSentMessages([]);
      return [];
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchSentMessages();
  }, [fetchNotifications, fetchSentMessages]);

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
    else if (!filterParam) setFilter('all');
  }, [filterParam]);

  useEffect(() => {
    const fromQuery = (searchParams.get('compose') || '').trim();
    const fromState = String(location.state?.composeTo || '').trim();
    const name = fromState || fromQuery;
    if (!name) return;
    setSendTo(name);
    setShowCompose(true);
    const next = new URLSearchParams(searchParams);
    next.delete('compose');
    const qs = next.toString();
    navigate(`${location.pathname}${qs ? `?${qs}` : ''}`, { replace: true, state: {} });
  }, [searchParams, location.state, location.pathname, navigate]);

  const applyFilter = (value) => {
    setFilter(value);
    setSelectedNotification(null);
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete('filter');
    else next.set('filter', value);
    setSearchParams(next, { replace: true });
  };

  const closeCompose = () => {
    setShowCompose(false);
    setSendTo('');
    setSendMessage('');
    setSendGifUrl('');
  };

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
      fetchSentMessages();
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
      toast.error(ocInviteActionError(error.response?.data?.detail, 'accept'));
    }
  };

  const handleOcInviteDecline = async (inviteId) => {
    try {
      const res = await api.post(`/oc/invite/${inviteId}/decline`);
      toast.success(res.data?.message || 'Declined');
      fetchNotifications();
    } catch (error) {
      toast.error(ocInviteActionError(error.response?.data?.detail, 'decline'));
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
      toast.error('Enter a message or GIF');
      return;
    }

    setSending(true);
    try {
      const res = await api.post('/notifications/send', {
        target_username: to,
        message: msg || '(GIF)',
        gif_url: gif || null,
      });
      toast.success(res.data?.message || 'Message sent');
      closeCompose();
      fetchNotifications();
      const sent = await fetchSentMessages();
      const match = sent.find((m) => {
        const name = sentRecipient(m);
        return name && name.toLowerCase() === to.toLowerCase() && m.recipient_id;
      });
      if (match?.recipient_id) {
        navigate(`/social/chat/${match.recipient_id}`);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const openChat = (n) => {
    if (n?.sender_id) navigate(`/social/chat/${n.sender_id}`);
  };

  const filteredNotifications = filter === 'sent'
    ? sentMessages
    : filter === 'all'
    ? notifications
    : filter === 'unread'
      ? notifications.filter((n) => !n.read)
      : notifications.filter((n) => n.notification_type === filter);

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

  const listHiddenOnMobile = !!(selectedNotification || showCompose);
  const composeProps = {
    onClose: closeCompose,
    sendTo,
    onSendToChange: setSendTo,
    sendMessage,
    onSendMessageChange: setSendMessage,
    sendGifUrl,
    onSendGifUrlChange: setSendGifUrl,
    onSendMessage: handleSendMessage,
    sending,
  };

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="inbox-page">
      <style>{INBOX_STYLES}</style>

      <div className="relative ib-fade-in space-y-1">
        <p className="text-[9px] text-zinc-500 font-heading italic">Notifications, DMs, rank-ups & more.</p>
        <p className="text-[9px] text-zinc-500/90 font-heading leading-snug max-w-2xl">
          <span className="text-primary/80 font-bold uppercase tracking-wider">Retention:</span>{' '}
          messages you&apos;ve <strong className="text-zinc-400">read</strong> are removed from inbox after{' '}
          <strong className="text-zinc-400">{readRetentionDays} days</strong>. Unread inbox items expire after about{' '}
          <strong className="text-zinc-400">{unreadRetentionDays} days</strong>. Delete All clears inbox only — not Sent.
        </p>
      </div>

      <div className={`relative ${styles.panel} border border-primary/20 rounded-md overflow-hidden ib-fade-in mobile-panel`}>
        <InboxHairline />
        <InboxBar className={`space-y-1.5 ${listHiddenOnMobile ? 'hidden lg:block' : ''}`}>
          <div className="flex items-center gap-1.5">
            <div className="ib-filters flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
              {filterButtons.map((btn) => {
                const Icon = btn.icon;
                const short = btn.value === 'staff_bot_client' ? 'Bots' : btn.label;
                return (
                  <button
                    key={btn.value}
                    type="button"
                    onClick={() => applyFilter(btn.value)}
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
                <button type="button" onClick={deleteAllMessages} className={IB_ACTION_DANGER}>
                  Delete All
                </button>
              )}
            </div>
          )}
        </InboxBar>

        <div className="grid grid-cols-1 lg:grid-cols-5">
          <div className={`lg:col-span-2 lg:border-r border-primary/20 bg-secondary/20 overflow-y-auto max-h-[70vh] lg:max-h-[480px] ${listHiddenOnMobile ? 'hidden lg:block' : ''}`}>
            {filter === 'bodyguard' && filteredNotifications.length > 0 && (
              <div className="px-2 py-1.5 border-b border-primary/20 bg-amber-500/5 text-[9px] text-mutedForeground font-heading italic">
                Past hires shown here. Max 4 bodyguards at once. Slots free up when a guard is lost in combat.
              </div>
            )}
            {!hasLoaded ? (
              <div className="p-4 text-center">
                <p className="text-[10px] text-mutedForeground font-heading">Loading…</p>
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="p-4 text-center">
                <MailOpen size={28} className="mx-auto text-primary/30 mb-2" />
                <p className="text-[10px] text-mutedForeground font-heading">
                  No messages
                </p>
              </div>
            ) : (
              filteredNotifications.map((notification) => (
                <MessageRow
                  key={notification.id}
                  notification={notification}
                  isSelected={selectedNotification?.id === notification.id}
                  onClick={() => {
                    setShowCompose(false);
                    setSelectedNotification(notification);
                  }}
                  onMarkRead={markAsRead}
                  isSent={filter === 'sent'}
                />
              ))
            )}
          </div>

          <div className="lg:col-span-3 hidden lg:block min-h-[280px]">
            {showCompose ? (
              <ComposePanel {...composeProps} />
            ) : (
              <MessageDetail
                notification={selectedNotification}
                onMarkRead={markAsRead}
                onDelete={deleteMessage}
                onOcAccept={handleOcInviteAccept}
                onOcDecline={handleOcInviteDecline}
                onOpenChat={openChat}
                isSent={filter === 'sent'}
                censorProfanity={censorProfanity}
              />
            )}
          </div>
        </div>

        {showCompose && (
          <div className="lg:hidden bg-secondary/20 min-h-[70vh]">
            <ComposePanel {...composeProps} />
          </div>
        )}

        {!showCompose && selectedNotification && (
          <div className="lg:hidden bg-secondary/20 overflow-y-auto max-h-[75vh]">
            <InboxBar className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSelectedNotification(null)}
                className={`${IB_ACTION_GO} inline-flex items-center gap-1`}
              >
                Back
              </button>
              <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Message</span>
            </InboxBar>
            <MessageDetail
              notification={selectedNotification}
              onMarkRead={markAsRead}
              onDelete={deleteMessage}
              onOcAccept={handleOcInviteAccept}
              onOcDecline={handleOcInviteDecline}
              onOpenChat={openChat}
              isSent={filter === 'sent'}
              censorProfanity={censorProfanity}
            />
          </div>
        )}
        <InboxArtLine />
      </div>
    </div>
  );
}
