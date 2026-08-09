import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Image, MessageSquare, Reply, Settings, Send, Smile, UserX, X } from 'lucide-react';
import { toast } from 'sonner';
import api, { getApiErrorMessage } from '../utils/api';
import { parseForumContent, FORUM_INLINE_SMILEY_PX } from '../utils/forumContent';
import { warmProfilePrefetchFromUsername } from '../utils/profileNavPrefetch';
import GifPicker from './GifPicker';

const POLL_INTERVAL_MS = 10000;
const PAGE_SIZE = 30;
const MAX_MESSAGE_LEN = 500;

const CLASSIC_SMILEYS = [
  [':wink:', 'wink'], [':twisted:', 'twisted'], [':tup:', 'tup'], [':tdown:', 'tdown'],
  [':tongue:', 'tongue'], [':surprised:', 'surprised'], [':happy:', 'smirk'], [':sad:', 'sad'],
  [':rolleyes:', 'rolleyes'], [':redface:', 'redface'], [':?:', 'question'], [':mad:', 'mad'],
  [':lol:', 'lol'], [':idea:', 'idea'], [':!:', 'exclamation'], [':evil:', 'evil'],
  [':eek:', 'eek'], [':cool:', 'cool'], [':confused:', 'confused'], [':grin:', 'grin'],
  [':arrow:', 'arrow'], [':feelsbadman:', 'feelsbadman'], [':ez:', 'ez'], [':crazy:', 'crazy'],
  [':feelsrainman:', 'feelsrainman'], [':fu:', 'fu'], [':sadge:', 'sadge'], [':howdie:', 'howdie'],
  [':uzi:', 'uzi'], [':kekl:', 'kekl'], [':kekwait:', 'kekwait'], [':kekleo:', 'kekleo'],
  [':kekw:', 'kekw'], [':hmmnice:', 'hmmnice'], [':hypers:', 'hypers'],
  [':poggers:', 'poggers'], [':hackermans:', 'hackermans'], [':prayge:', 'prayge'],
];

const CHAT_EMOJIS = [
  '😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😎', '🤩', '😍', '😂', '🤣',
  '😅', '😢', '😭', '😤', '😡', '🤬', '😱', '🤔', '🙄', '😏', '😴', '👍',
  '👎', '👋', '🤝', '🙏', '💪', '✊', '👊', '❤️', '💔', '🔥', '⭐', '✨',
  '💥', '💯', '🎉', '🏆', '👑', '💎', '💰', '🔫', '💀', '⚔️', '🔪',
  '🎲', '🃏', '🎩', '🚬', '🥃', '🚗', '🏠', '❓', '❗', '⚠️', '✅', '❌',
];

const EMPTY_PREFS = {
  blocked_user_ids: [],
  block_list_with_names: [],
  in_family: false,
  muted: false,
  muted_until: null,
};

function formatChatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function sortAndDedupe(rows) {
  const byId = new Map();
  rows.forEach((row) => {
    if (row?.id != null) byId.set(String(row.id), row);
  });
  return Array.from(byId.values()).sort((a, b) => {
    const timeDiff = new Date(b.created_at || 0) - new Date(a.created_at || 0);
    return timeDiff || String(b.id).localeCompare(String(a.id));
  });
}

function highlightSafeMention(html, username) {
  if (!html || !username || typeof document === 'undefined') return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const escaped = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mention = new RegExp(`@${escaped}(?![\\w-])`, 'gi');
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (!mention.test(node.nodeValue || '')) {
      mention.lastIndex = 0;
      return;
    }
    mention.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    String(node.nodeValue).replace(mention, (match, offset) => {
      fragment.append(document.createTextNode(node.nodeValue.slice(cursor, offset)));
      const mark = document.createElement('mark');
      mark.className = 'game-chat-own-mention';
      mark.textContent = match;
      fragment.append(mark);
      cursor = offset + match.length;
      return match;
    });
    fragment.append(document.createTextNode(node.nodeValue.slice(cursor)));
    node.replaceWith(fragment);
    mention.lastIndex = 0;
  });
  return template.innerHTML;
}

function normalizeResponse(data) {
  return {
    messages: Array.isArray(data?.messages) ? data.messages : [],
    hasMore: data?.has_more === true,
  };
}

function messageMentionsUsername(message, username) {
  if (!message || !username) return false;
  const escaped = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${escaped}(?![\\w-])`, 'i').test(String(message));
}

function getSeenMessageId(username, channel) {
  try {
    return localStorage.getItem(`game_chat_seen:${String(username || '').toLowerCase()}:${channel}`);
  } catch {
    return null;
  }
}

function storeSeenMessageId(username, channel, messageId) {
  if (messageId == null) return;
  try {
    localStorage.setItem(`game_chat_seen:${String(username || '').toLowerCase()}:${channel}`, String(messageId));
  } catch (_) {}
}

export default function GameChat({
  currentUsername = '',
  censorProfanity = false,
  canClearChat = false,
  mobileBottomClearance = true,
  onHide,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState('global');
  const [messagesByChannel, setMessagesByChannel] = useState({ global: [], family: [] });
  const [hasMoreByChannel, setHasMoreByChannel] = useState({ global: false, family: false });
  const [prefs, setPrefs] = useState(EMPTY_PREFS);
  const [censorEnabled, setCensorEnabled] = useState(censorProfanity);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [unreadByChannel, setUnreadByChannel] = useState({ global: false, family: false });
  const [mentionByChannel, setMentionByChannel] = useState({ global: false, family: false });
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const inFlightRef = useRef(new Map());
  const initialLoadedRef = useRef({ global: false, family: false });
  const seenMessageIdRef = useRef({
    global: getSeenMessageId(currentUsername, 'global'),
    family: getSeenMessageId(currentUsername, 'family'),
  });
  const openRef = useRef(open);
  const channelRef = useRef(channel);
  const scrollAfterLoadRef = useRef('none');
  const targetMessageRef = useRef(null);
  const messages = useMemo(() => messagesByChannel[channel] || [], [channel, messagesByChannel]);
  const hasUnread = unreadByChannel.global || unreadByChannel.family;
  const hasMention = mentionByChannel.global || mentionByChannel.family;
  openRef.current = open;
  channelRef.current = channel;

  const setChannelMessages = useCallback((targetChannel, updater) => {
    setMessagesByChannel((previous) => ({
      ...previous,
      [targetChannel]: typeof updater === 'function' ? updater(previous[targetChannel] || []) : updater,
    }));
  }, []);

  const fetchPrefs = useCallback(async () => {
    api.get('/profile/censor-profanity').then(({ data }) => {
      setCensorEnabled(data?.censor_profanity === true);
    }).catch(() => {});
    try {
      const { data } = await api.get('/game-chat/prefs');
      setPrefs({
        blocked_user_ids: data?.blocked_user_ids || [],
        block_list_with_names: data?.block_list_with_names || [],
        in_family: data?.in_family === true,
        muted: data?.muted === true,
        muted_until: data?.muted_until || null,
      });
      if (data?.in_family !== true) {
        setChannel((current) => (current === 'family' ? 'global' : current));
      }
    } catch (_) {
      setPrefs(EMPTY_PREFS);
    }
  }, []);

  useEffect(() => {
    setCensorEnabled(censorProfanity);
  }, [censorProfanity]);

  const fetchMessages = useCallback(async (targetChannel, { beforeId, force = false } = {}) => {
    const key = `${targetChannel}:${beforeId || 'latest'}`;
    if (inFlightRef.current.has(key)) return inFlightRef.current.get(key);
    if (!beforeId && !force && initialLoadedRef.current[targetChannel]) return undefined;

    const request = (async () => {
      if (beforeId) setLoadingOlder(true);
      else if (!initialLoadedRef.current[targetChannel]) setLoading(true);
      try {
        const markSeen = openRef.current && channelRef.current === targetChannel;
        const { data } = await api.get('/game-chat/messages', {
          params: {
            channel: targetChannel,
            limit: PAGE_SIZE,
            ...(beforeId ? { before_id: beforeId } : {}),
            ...(markSeen ? { mark_seen: true } : {}),
          },
        });
        const result = normalizeResponse(data);
        if (!beforeId && result.messages.length > 0) {
          const latestId = String(result.messages[0].id);
          const seenMessageId = seenMessageIdRef.current[targetChannel];
          const isViewingChannel = openRef.current && channelRef.current === targetChannel;
          if (isViewingChannel) {
            seenMessageIdRef.current[targetChannel] = latestId;
            storeSeenMessageId(currentUsername, targetChannel, latestId);
            setUnreadByChannel((previous) => ({ ...previous, [targetChannel]: false }));
            setMentionByChannel((previous) => ({ ...previous, [targetChannel]: false }));
          } else if (seenMessageId !== latestId) {
            const seenIndex = result.messages.findIndex((row) => String(row.id) === seenMessageId);
            const newRows = seenIndex >= 0 ? result.messages.slice(0, seenIndex) : result.messages;
            const unreadRows = newRows.filter((row) => !row.is_own);
            if (unreadRows.length > 0 && !isViewingChannel) {
              setUnreadByChannel((previous) => ({ ...previous, [targetChannel]: true }));
              if (unreadRows.some((row) => (
                messageMentionsUsername(row.message, currentUsername)
                || String(row.reply_to?.username || '').toLowerCase() === String(currentUsername || '').toLowerCase()
              ))) {
                setMentionByChannel((previous) => ({ ...previous, [targetChannel]: true }));
              }
            }
          }
        }
        setChannelMessages(targetChannel, (previous) => (
          beforeId ? sortAndDedupe([...result.messages, ...previous]) : sortAndDedupe([...previous, ...result.messages])
        ));
        setHasMoreByChannel((previous) => ({ ...previous, [targetChannel]: result.hasMore }));
        initialLoadedRef.current[targetChannel] = true;
        return result;
      } catch (error) {
        if (!beforeId && !initialLoadedRef.current[targetChannel]) {
          setChannelMessages(targetChannel, []);
        }
        throw error;
      } finally {
        setLoading(false);
        setLoadingOlder(false);
      }
    })();

    inFlightRef.current.set(key, request);
    try {
      return await request;
    } finally {
      inFlightRef.current.delete(key);
    }
  }, [currentUsername, setChannelMessages]);

  useEffect(() => {
    const onVisibilityChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requested = params.get('gameChat');
    if (requested !== 'global' && requested !== 'family') return;
    setChannel(requested);
    setOpen(true);
    targetMessageRef.current = params.get('gameChatMessage');
    params.delete('gameChat');
    params.delete('gameChatMessage');
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true, state: location.state }
    );
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!visible) return undefined;
    fetchPrefs();
    const poll = () => {
      const channels = ['global', ...(prefs.in_family ? ['family'] : [])];
      channels.forEach((targetChannel) => {
        fetchMessages(targetChannel, { force: true }).catch(() => {});
      });
    };
    if (open) scrollAfterLoadRef.current = initialLoadedRef.current[channel] ? 'none' : 'top';
    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [channel, fetchMessages, fetchPrefs, open, prefs.in_family, visible]);

  useEffect(() => {
    if (!open) return;
    const latestId = messagesByChannel[channel]?.[0]?.id;
    if (latestId != null) {
      seenMessageIdRef.current[channel] = String(latestId);
      storeSeenMessageId(currentUsername, channel, latestId);
    }
    setUnreadByChannel((previous) => ({ ...previous, [channel]: false }));
    setMentionByChannel((previous) => ({ ...previous, [channel]: false }));
  }, [channel, currentUsername, messagesByChannel, open]);

  useEffect(() => {
    if (!open || !scrollRef.current) return;
    const targetId = targetMessageRef.current;
    if (targetId) {
      const target = scrollRef.current.querySelector(`[data-message-id="${CSS.escape(String(targetId))}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.classList.add('game-chat-linked-message');
        targetMessageRef.current = null;
        return;
      }
    }
    if (scrollAfterLoadRef.current === 'top') {
      scrollRef.current.scrollTop = 0;
      scrollAfterLoadRef.current = 'none';
    }
  }, [messages, open]);

  const switchChannel = (nextChannel) => {
    setChannel(nextChannel);
    setReplyingTo(null);
    setSettingsOpen(false);
    setShowGifPicker(false);
    setShowEmojis(false);
    scrollAfterLoadRef.current = 'top';
  };

  const loadOlder = async () => {
    const oldest = messages[messages.length - 1];
    if (!oldest || loadingOlder) return;
    try {
      await fetchMessages(channel, { beforeId: oldest.id });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const sendMessage = async ({ message, gifUrl }) => {
    if (sending || prefs.muted) return;
    const text = String(message || '').trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE_LEN) {
      toast.error(`Message must be ${MAX_MESSAGE_LEN} characters or less`);
      return;
    }

    const replyTarget = replyingTo;
    const tempId = `optimistic-${Date.now()}`;
    const optimistic = {
      id: tempId,
      sender_id: 'self',
      username: currentUsername,
      message: text,
      gif_url: gifUrl || null,
      channel,
      is_own: true,
      created_at: new Date().toISOString(),
      pending: true,
      view_count: 0,
      reply_to: replyTarget ? {
        id: replyTarget.id,
        username: replyTarget.username,
        message: replyTarget.message,
        has_gif: replyTarget.has_gif,
      } : null,
    };
    setSending(true);
    setChannelMessages(channel, (previous) => sortAndDedupe([...previous, optimistic]));
    scrollAfterLoadRef.current = 'top';
    setInput('');
    setReplyingTo(null);
    setShowGifPicker(false);

    try {
      const { data } = await api.post('/game-chat/send', {
        message: text,
        ...(gifUrl ? { gif_url: gifUrl } : {}),
        ...(replyTarget?.id ? { reply_to_message_id: replyTarget.id } : {}),
        channel,
      });
      const sent = data?.message && typeof data.message === 'object' ? data.message : data;
      setChannelMessages(channel, (previous) => sortAndDedupe([
        ...previous.filter((row) => String(row.id) !== tempId),
        ...(sent?.id != null ? [sent] : []),
      ]));
      await fetchMessages(channel, { force: true }).catch(() => {});
    } catch (error) {
      setChannelMessages(channel, (previous) => previous.filter((row) => String(row.id) !== tempId));
      toast.error(getApiErrorMessage(error));
      fetchMessages(channel, { force: true }).catch(() => {});
    } finally {
      setSending(false);
    }
  };

  const handleSend = (event) => {
    event.preventDefault();
    sendMessage({ message: input });
  };

  const beginReply = (row) => {
    setReplyingTo({
      id: row.id,
      username: row.username || 'Unknown',
      message: row.message || '',
      has_gif: !!row.gif_url,
    });
    setShowEmojis(false);
    setShowGifPicker(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const scrollToRepliedMessage = (messageId) => {
    const target = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
    if (!target) {
      toast.info('Original message is outside the loaded chat history');
      return;
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('game-chat-linked-message');
  };

  const blockUser = async (senderId, username) => {
    if (senderId == null) return;
    try {
      await api.post(`/game-chat/block/${senderId}`);
      setMessagesByChannel((previous) => ({
        global: previous.global.filter((row) => row.sender_id !== senderId),
        family: previous.family.filter((row) => row.sender_id !== senderId),
      }));
      await fetchPrefs();
      toast.success(`Blocked ${username || 'user'}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const unblockUser = async (senderId) => {
    try {
      await api.delete(`/game-chat/block/${senderId}`);
      await fetchPrefs();
      await fetchMessages(channel, { force: true });
      toast.success('User unblocked');
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const clearChat = async () => {
    if (!canClearChat || clearingChat || !window.confirm('Clear all game chat messages? This cannot be undone.')) return;
    setClearingChat(true);
    try {
      await api.delete('/game-chat/messages');
      setMessagesByChannel({ global: [], family: [] });
      toast.success('Game chat cleared');
      await fetchMessages(channel, { force: true });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setClearingChat(false);
    }
  };

  const renderedMessages = useMemo(() => messages.map((row) => {
    const hasText = !!row.message && row.message !== '(GIF)';
    const parsed = hasText ? parseForumContent(row.message, { censorProfanity: censorEnabled }) : '';
    return { ...row, renderedHtml: highlightSafeMention(parsed, currentUsername), hasText };
  }), [censorEnabled, currentUsername, messages]);

  return (
    <div
      className={`game-chat-root ${mobileBottomClearance ? 'game-chat-clear-mobile-nav' : ''}`}
    >
      <style>{`
        .game-chat-root {
          position: fixed; z-index: 60; right: max(16px, env(safe-area-inset-right, 0px));
          bottom: max(16px, env(safe-area-inset-bottom, 0px)); font-family: inherit;
          pointer-events: none;
        }
        .game-chat-launcher {
          min-width: 132px; min-height: 44px; padding: 0 14px; display: flex; align-items: center;
          justify-content: center; gap: 8px; border-radius: 999px; color: var(--noir-primary);
          background: var(--noir-content); border: 1px solid rgba(var(--noir-primary-rgb), .42);
          box-shadow: 0 12px 34px rgba(0,0,0,.55), 0 0 18px rgba(var(--noir-primary-rgb), .08);
          pointer-events: auto; position: relative;
        }
        .game-chat-notification-dot {
          position: absolute; width: 10px; height: 10px; border-radius: 999px;
          background: #22d3ee; border: 2px solid var(--noir-content);
          box-shadow: 0 0 9px rgba(34,211,238,.9);
        }
        .game-chat-notification-dot-mention {
          animation: game-chat-dot-pulse 1.4s ease-in-out infinite;
        }
        @keyframes game-chat-dot-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 7px rgba(34,211,238,.7); }
          50% { transform: scale(1.25); box-shadow: 0 0 13px rgba(34,211,238,1); }
        }
        .game-chat-window {
          width: min(390px, calc(100vw - 24px)); height: min(590px, calc(100dvh - 32px));
          max-height: min(590px, calc(100dvh - 32px)); display: flex; flex-direction: column;
          overflow: hidden; border-radius: 12px; color: var(--noir-foreground);
          background: var(--noir-content); border: 1px solid rgba(var(--noir-primary-rgb), .35);
          box-shadow: 0 20px 60px rgba(0,0,0,.72), 0 0 24px rgba(var(--noir-primary-rgb), .08);
          pointer-events: auto;
        }
        .game-chat-message-content .inline-smiley {
          display: inline !important; width: ${FORUM_INLINE_SMILEY_PX}px !important;
          height: ${FORUM_INLINE_SMILEY_PX}px !important; max-width: ${FORUM_INLINE_SMILEY_PX}px !important;
          max-height: ${FORUM_INLINE_SMILEY_PX}px !important; object-fit: contain; vertical-align: middle;
        }
        .game-chat-message-content .forum-content-media,
        .game-chat-message-content .forum-content-img,
        .game-chat-message-content .forum-content-gif {
          max-width: min(270px, 100%) !important; max-height: 190px !important; object-fit: contain;
        }
        .game-chat-own-mention {
          border-radius: 3px; padding: 0 2px; color: var(--noir-primary);
          background: rgba(var(--noir-primary-rgb), .18); font-weight: 700;
        }
        .game-chat-linked-message { animation: gameChatLinked 2.4s ease-out; }
        @keyframes gameChatLinked {
          0%, 35% { background: rgba(var(--noir-primary-rgb), .24); }
          100% { background: transparent; }
        }
        @media (max-width: 767px) {
          .game-chat-root {
            left: 12px; right: 12px; bottom: max(12px, env(safe-area-inset-bottom, 0px));
            z-index: 48;
          }
          .game-chat-launcher {
            width: 48px; min-width: 48px; height: 48px; min-height: 48px; padding: 0;
            margin-left: auto; border-radius: 12px;
          }
          .game-chat-launcher-label { display: none; }
          .game-chat-root.game-chat-clear-mobile-nav {
            bottom: calc(68px + env(safe-area-inset-bottom, 0px));
          }
          .game-chat-window {
            width: 100%; height: min(620px, calc(100dvh - 92px));
            max-height: calc(100dvh - 92px);
          }
          .game-chat-clear-mobile-nav .game-chat-window {
            height: min(620px, calc(100dvh - 148px)); max-height: calc(100dvh - 148px);
          }
        }
      `}</style>

      {!open ? (
        <button type="button" className="game-chat-launcher touch-manipulation" onClick={() => setOpen(true)} aria-label={hasMention ? 'Open game chat, unread mention' : hasUnread ? 'Open game chat, new messages' : 'Open game chat'}>
          <MessageSquare size={17} />
          <span className="game-chat-launcher-label font-heading text-[10px] font-bold uppercase tracking-[.12em]">Game Chat</span>
          {hasUnread && <span className={`game-chat-notification-dot -right-0.5 -top-0.5 ${hasMention ? 'game-chat-notification-dot-mention' : ''}`} aria-hidden />}
        </button>
      ) : (
        <section className="game-chat-window" data-chat-surface="game" role="dialog" aria-label="Game chat">
          <header className="shrink-0 border-b" style={{ borderColor: 'rgba(var(--noir-primary-rgb), .18)' }}>
            <div className="flex items-center justify-between min-h-[48px] px-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={15} style={{ color: 'var(--noir-primary)' }} />
                <h2 className="font-heading text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: 'var(--noir-primary)' }}>Game Chat</h2>
              </div>
              <div className="flex items-center">
                {onHide && (
                  <button
                    type="button"
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-white/5"
                    onClick={() => {
                      setOpen(false);
                      onHide();
                    }}
                    title="Hide Game Chat"
                    aria-label="Hide Game Chat"
                  >
                    <EyeOff size={16} />
                  </button>
                )}
                {(canClearChat || prefs.blocked_user_ids.length > 0) && (
                  <button type="button" className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-white/5" onClick={() => setSettingsOpen((value) => !value)} aria-label="Chat settings">
                    <Settings size={16} />
                  </button>
                )}
                <button type="button" className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-white/5" onClick={() => setOpen(false)} aria-label="Close game chat">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 px-2 gap-1">
              {['global', 'family'].map((value) => {
                const disabled = value === 'family' && !prefs.in_family;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    onClick={() => switchChannel(value)}
                    className="relative min-h-[44px] rounded-t font-heading text-[10px] font-bold uppercase tracking-wider disabled:opacity-35"
                    style={channel === value ? {
                      color: 'var(--noir-primary)',
                      background: 'rgba(var(--noir-primary-rgb), .12)',
                      borderBottom: '2px solid var(--noir-primary)',
                    } : { color: 'var(--noir-muted)' }}
                    title={disabled ? 'Join a family to use family chat' : undefined}
                  >
                    {value}
                    {unreadByChannel[value] && (
                      <span className={`game-chat-notification-dot right-3 top-2 ${mentionByChannel[value] ? 'game-chat-notification-dot-mention' : ''}`} aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          </header>

          {settingsOpen && (canClearChat || prefs.blocked_user_ids.length > 0) && (
            <div className="shrink-0 border-b p-2 text-[10px] font-heading" style={{ borderColor: 'var(--noir-border-mid)', background: 'var(--noir-surface)' }}>
              {canClearChat && (
                <button type="button" onClick={clearChat} disabled={clearingChat} className="w-full min-h-[44px] px-2 text-left rounded text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                  {clearingChat ? 'Clearing…' : 'Clear all game chat'}
                </button>
              )}
              {prefs.blocked_user_ids.length > 0 && (
                <div className={canClearChat ? 'border-t pt-1' : ''} style={{ borderColor: 'var(--noir-border)' }}>
                  <p className="px-2 py-1 uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>Blocked users</p>
                  {(prefs.block_list_with_names.length
                    ? prefs.block_list_with_names
                    : prefs.blocked_user_ids.map((senderId) => ({ user_id: senderId, username: String(senderId) }))
                  ).slice(0, 10).map((item) => (
                    <div key={item.user_id} className="flex items-center justify-between gap-2 min-h-[36px] px-2">
                      <Link to={`/profile/${encodeURIComponent(item.username)}`} className="truncate hover:underline" style={{ color: 'var(--noir-primary)' }}>{item.username}</Link>
                      <button type="button" onClick={() => unblockUser(item.user_id)} className="min-h-[36px] px-2 hover:underline">Unblock</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y" style={{ scrollbarColor: 'rgba(var(--noir-primary-rgb), .22) transparent' }}>
            {prefs.muted && (
              <p className="px-3 py-2 text-[10px] font-heading text-amber-400">
                You are muted{prefs.muted_until ? ` until ${formatChatTime(prefs.muted_until)}` : ''}.
              </p>
            )}
            {loading && !messages.length ? (
              <p className="px-3 py-4 text-[10px] font-heading" style={{ color: 'var(--noir-muted)' }}>Loading chat…</p>
            ) : !messages.length ? (
              <p className="px-3 py-4 text-[10px] font-heading italic" style={{ color: 'var(--noir-muted)' }}>No messages yet. Say something.</p>
            ) : renderedMessages.map((row) => (
              <article
                key={row.id}
                data-message-id={row.id}
                data-chat-own={row.is_own ? 'true' : 'false'}
                className="group relative px-3 py-2 border-b"
                style={{
                  borderColor: 'rgba(255,255,255,.04)',
                  background: row.is_own ? 'rgba(var(--noir-primary-rgb), .035)' : 'transparent',
                  opacity: row.pending ? .62 : 1,
                }}
              >
                <div className={`flex items-baseline gap-2 ${!row.is_own && !row.sender_is_staff && row.sender_id != null ? 'pr-[88px]' : 'pr-11'}`}>
                  <Link
                    to={`/profile/${encodeURIComponent(row.username || '')}`}
                    className="shrink-0 font-heading text-[10px] font-bold hover:underline"
                    style={{ color: row.author_online_color || (row.is_own ? 'var(--noir-primary)' : 'rgba(var(--noir-primary-rgb), .78)') }}
                    onPointerDown={() => warmProfilePrefetchFromUsername(row.username)}
                    onPointerEnter={() => warmProfilePrefetchFromUsername(row.username)}
                  >
                    {row.username || 'Unknown'}
                  </Link>
                  <time className="text-[8px] font-heading" style={{ color: 'var(--noir-muted)' }}>{formatChatTime(row.created_at)}</time>
                  <span
                    className="inline-flex items-center gap-0.5 text-[8px] font-heading tabular-nums"
                    style={{ color: 'var(--noir-muted)' }}
                    title={`${Number(row.view_count) || 0} seen`}
                    aria-label={`${Number(row.view_count) || 0} seen`}
                  >
                    <Eye size={10} strokeWidth={2} aria-hidden />
                    ({Number(row.view_count) || 0})
                  </span>
                  {row.pending && <span className="text-[8px] font-heading" style={{ color: 'var(--noir-muted)' }}>Sending…</span>}
                </div>
                {row.reply_to && (
                  <button
                    type="button"
                    onClick={() => scrollToRepliedMessage(row.reply_to.id)}
                    className="mt-1 w-full rounded border-l-2 px-2 py-1 text-left hover:bg-white/5"
                    style={{ borderColor: 'var(--noir-primary)', background: 'rgba(var(--noir-primary-rgb), .06)' }}
                    title="Go to original message"
                  >
                    <span className="block truncate text-[9px] font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>
                      Replying to {row.reply_to.username}
                    </span>
                    <span className="block truncate text-[10px]" style={{ color: 'var(--noir-muted)' }}>
                      {row.reply_to.message || (row.reply_to.has_gif ? 'GIF' : 'Message')}
                    </span>
                  </button>
                )}
                {row.hasText && (
                  <div className="game-chat-message-content mt-1 text-[12px] leading-relaxed break-words" style={{ color: 'var(--noir-foreground)' }} dangerouslySetInnerHTML={{ __html: row.renderedHtml }} />
                )}
                {row.gif_url && (
                  <img src={row.gif_url} alt="Chat GIF" loading="lazy" decoding="async" className="mt-1 rounded max-h-44 max-w-full object-contain" style={{ border: '1px solid rgba(var(--noir-primary-rgb), .18)' }} />
                )}
                <div className="absolute right-1 top-1 flex items-center">
                  <button
                    type="button"
                    onClick={() => beginReply(row)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded opacity-70 sm:opacity-0 sm:group-hover:opacity-80 hover:text-primary"
                    title={`Reply to ${row.username || 'user'}`}
                    aria-label={`Reply to ${row.username || 'user'}`}
                  >
                    <Reply size={14} />
                  </button>
                  {!row.is_own && !row.sender_is_staff && row.sender_id != null && (
                    <button
                      type="button"
                      onClick={() => blockUser(row.sender_id, row.username)}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded opacity-70 sm:opacity-0 sm:group-hover:opacity-80 hover:text-red-400"
                      title={`Block ${row.username || 'user'}`}
                      aria-label={`Block ${row.username || 'user'}`}
                    >
                      <UserX size={14} />
                    </button>
                  )}
                </div>
              </article>
            ))}
            {hasMoreByChannel[channel] && (
              <div className="flex justify-center p-2">
                <button type="button" onClick={loadOlder} disabled={loadingOlder} className="min-h-[44px] px-4 font-heading text-[9px] uppercase tracking-wider rounded border disabled:opacity-50" style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-primary)' }}>
                  {loadingOlder ? 'Loading…' : 'Load older'}
                </button>
              </div>
            )}
          </div>

          {showGifPicker && (
            <div className="shrink-0 max-h-[42%] overflow-y-auto border-t p-2" style={{ borderColor: 'var(--noir-border-mid)', background: 'var(--noir-surface)' }}>
              <GifPicker compact onSelect={(url) => sendMessage({ message: '(GIF)', gifUrl: url })} onClose={() => setShowGifPicker(false)} />
            </div>
          )}

          {showEmojis && (
            <div className="shrink-0 max-h-28 overflow-y-auto border-t p-1.5 flex flex-wrap gap-1" style={{ borderColor: 'var(--noir-border-mid)', background: 'var(--noir-surface)' }}>
              {CLASSIC_SMILEYS.map(([code, imageName]) => (
                <button key={code} type="button" onClick={() => setInput((value) => value + code)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-white/5" title={code}>
                  <img src={`/images/smileys/${imageName}.png`} alt={code} loading="lazy" className="object-contain" style={{ width: FORUM_INLINE_SMILEY_PX, height: FORUM_INLINE_SMILEY_PX }} />
                </button>
              ))}
              {CHAT_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => setInput((value) => value + emoji)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded text-lg hover:bg-white/5">{emoji}</button>
              ))}
            </div>
          )}

          <div className="shrink-0 border-t p-2" style={{ borderColor: 'rgba(var(--noir-primary-rgb), .18)', background: 'var(--noir-content)', paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}>
            {replyingTo && (
              <div className="mb-1.5 flex items-center gap-2 rounded border-l-2 px-2 py-1.5" style={{ borderColor: 'var(--noir-primary)', background: 'rgba(var(--noir-primary-rgb), .07)' }}>
                <Reply size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[9px] font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>Replying to {replyingTo.username}</p>
                  <p className="truncate text-[10px]" style={{ color: 'var(--noir-muted)' }}>{replyingTo.message || (replyingTo.has_gif ? 'GIF' : 'Message')}</p>
                </div>
                <button type="button" onClick={() => setReplyingTo(null)} className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded hover:bg-white/5" aria-label="Cancel reply">
                  <X size={14} />
                </button>
              </div>
            )}
            <form onSubmit={handleSend} className="flex items-end gap-1.5">
              <div className="flex-1 min-w-0">
                <label htmlFor="game-chat-input" className="sr-only">Chat message</label>
                <textarea
                  ref={inputRef}
                  id="game-chat-input"
                  rows={1}
                  value={input}
                  maxLength={MAX_MESSAGE_LEN}
                  disabled={prefs.muted}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSend(event);
                    }
                  }}
                  placeholder={prefs.muted ? 'You are muted' : `Message ${channel} chat…`}
                  className="block w-full min-h-[44px] max-h-24 resize-none rounded px-3 py-2.5 text-[16px] sm:text-[12px] outline-none disabled:opacity-50"
                  style={{ background: 'rgba(0,0,0,.42)', border: '1px solid rgba(var(--noir-primary-rgb), .24)', color: 'var(--noir-foreground)' }}
                />
              </div>
              <button type="button" onClick={() => { setShowEmojis((value) => !value); setShowGifPicker(false); }} disabled={prefs.muted} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded border disabled:opacity-40" style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-primary)' }} aria-label="Toggle emojis">
                <Smile size={17} />
              </button>
              <button type="button" onClick={() => { setShowGifPicker((value) => !value); setShowEmojis(false); }} disabled={prefs.muted} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded border disabled:opacity-40" style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-primary)' }} aria-label="Toggle GIF picker">
                <Image size={17} />
              </button>
              <button type="submit" disabled={sending || prefs.muted || !input.trim()} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded border disabled:opacity-40" style={{ borderColor: 'rgba(var(--noir-primary-rgb), .45)', color: 'var(--noir-primary)', background: 'rgba(var(--noir-primary-rgb), .12)' }} aria-label="Send message">
                <Send size={17} />
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
