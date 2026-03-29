import { Link } from 'react-router-dom';

/**
 * Inbox-style plain text with optional link segments (actor profile, forum topic, custom message link).
 * API fields: actor_username, topic_id, topic_title, comment_id, message_link_to, message_link_label
 */
export function NotificationMessage({
  message,
  actorUsername,
  topicId,
  topicTitle,
  commentId,
  messageLinkTo,
  messageLinkLabel,
  className,
  onLinkNavigate,
}) {
  if (!message || typeof message !== 'string') return null;

  const linkCls = 'text-primary hover:underline font-heading';

  const stopRow = (e) => {
    e.stopPropagation();
    onLinkNavigate?.();
  };

  const forumTopicTo = () => {
    if (!topicId) return null;
    const q = commentId ? `?comment=${encodeURIComponent(commentId)}` : '';
    return `/social/forum/${encodeURIComponent(topicId)}${q}`;
  };

  const tryQuotedTopicLink = (text) => {
    const to = forumTopicTo();
    if (!to) return null;
    if (topicTitle) {
      const ttrunc = String(topicTitle).slice(0, 80);
      const exactQuoted = `"${ttrunc}"`;
      const qidx = text.indexOf(exactQuoted);
      if (qidx !== -1) {
        const beforeQ = text.slice(0, qidx);
        const afterQ = text.slice(qidx + exactQuoted.length);
        return (
          <>
            {beforeQ}
            <Link to={to} onClick={stopRow} className={`${linkCls} ${className || ''}`}>
              {exactQuoted}
            </Link>
            {afterQ}
          </>
        );
      }
    }
    const m = text.match(/"([^"]+)"\s*$/);
    if (!m || m.index === undefined) return null;
    const beforeQ = text.slice(0, m.index);
    const quotedSlice = text.slice(m.index, m.index + m[0].length).replace(/\s+$/, '');
    const afterQ = text.slice(m.index + m[0].length);
    return (
      <>
        {beforeQ}
        <Link to={to} onClick={stopRow} className={`${linkCls} ${className || ''}`}>
          {quotedSlice}
        </Link>
        {afterQ}
      </>
    );
  };

  const tryMessageLink = (text) => {
    if (!messageLinkTo || !messageLinkLabel) return null;
    const label = String(messageLinkLabel);
    const idx = text.indexOf(label);
    if (idx === -1) return null;
    const before = text.slice(0, idx);
    const after = text.slice(idx + label.length);
    return (
      <>
        {before}
        <Link to={messageLinkTo} onClick={stopRow} className={`${linkCls} ${className || ''}`}>
          {label}
        </Link>
        {after}
      </>
    );
  };

  let rest = message;
  const parts = [];

  if (actorUsername && typeof actorUsername === 'string') {
    const idx = rest.indexOf(actorUsername);
    if (idx !== -1) {
      if (idx > 0) parts.push(<span key="pre-actor">{rest.slice(0, idx)}</span>);
      parts.push(
        <Link key="actor" to={`/profile/${encodeURIComponent(actorUsername)}`} onClick={stopRow} className={`${linkCls} ${className || ''}`}>
          {actorUsername}
        </Link>
      );
      rest = rest.slice(idx + actorUsername.length);
    }
  }

  const topicLink = tryQuotedTopicLink(rest);
  if (topicLink) {
    return <span className={className}>{parts}{topicLink}</span>;
  }

  const inlineLink = tryMessageLink(rest);
  if (inlineLink) {
    return <span className={className}>{parts}{inlineLink}</span>;
  }

  if (parts.length) {
    return (
      <span className={className}>
        {parts}
        {rest}
      </span>
    );
  }

  return <span className={className}>{message}</span>;
}
