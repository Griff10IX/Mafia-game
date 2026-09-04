import { Link } from 'react-router-dom';

export const SYSTEM_AI_AVATAR = '/images/system-ai-profile.jpg?v=7';
export const SYSTEM_AI_PROFILE_PATH = '/profile/System%20AI';

export function isSystemAiInbox(notification) {
  if (!notification) return false;
  if (notification.system_ai) return true;
  return String(notification.avatar_url || '').includes('system-ai-avatar');
}

export function isSystemAiAuthor(obj) {
  if (!obj) return false;
  if (obj.system_ai) return true;
  if (String(obj.author_id || '') === 'system_ai') return true;
  return /^system\s*ai$/i.test(String(obj.author_username || '').trim());
}

export function ForumSystemAiAuthor({ className = '', avatarClassName = 'w-4 h-4', showAvatar = true }) {
  return (
    <Link
      to={SYSTEM_AI_PROFILE_PATH}
      className={`inline-flex items-center gap-1.5 font-heading font-semibold text-amber-400 hover:text-amber-300 hover:underline ${className}`}
      title="System AI profile"
    >
      {showAvatar ? (
        <img src={SYSTEM_AI_AVATAR} alt="" className={`${avatarClassName} rounded-full object-cover object-[22%_14%] border border-amber-400/40 shrink-0`} />
      ) : null}
      System AI
    </Link>
  );
}

export function systemAiInboxPreview(message) {
  const text = String(message || '')
    .replace(/\n[—\-]\s*System AI\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'System AI';
  return text.length > 88 ? `${text.slice(0, 85)}…` : text;
}

function bodyParagraphs(message) {
  let text = String(message || '').trim();
  text = text.replace(/\n[—\-]\s*System AI\s*$/i, '').trim();
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

export function SystemAiInboxMessage({ notification, className = '', kicker, title, children, bodyClassName }) {
  const paras = bodyParagraphs(notification?.message);
  const avatar = notification?.avatar_url || SYSTEM_AI_AVATAR;
  const kickerText = (kicker || 'File check').trim() || 'File check';

  return (
    <div className={`rounded-lg overflow-hidden border border-amber-500/30 bg-gradient-to-b from-amber-500/[0.09] via-zinc-950/40 to-black/30 ${className}`}>
      <div className="flex items-center gap-3 px-4 py-3.5 bg-amber-500/[0.06] border-b border-amber-500/20">
        <Link to={SYSTEM_AI_PROFILE_PATH} className="shrink-0">
          <img
            src={avatar}
            alt=""
            className="w-12 h-12 rounded-full object-cover object-[22%_14%] border border-amber-400/45 shadow-[0_0_14px_rgba(251,191,36,0.28)] shrink-0"
          />
        </Link>
        <div className="min-w-0">
          <p className="text-[9px] font-heading font-bold uppercase tracking-[0.2em] text-amber-400">
            <Link to={SYSTEM_AI_PROFILE_PATH} className="hover:text-amber-300 hover:underline">
              System AI
            </Link>
          </p>
          <p className="text-[10px] text-zinc-400 font-heading mt-0.5">
            {kickerText}
          </p>
        </div>
      </div>
      <div className={bodyClassName || 'px-4 py-3.5 space-y-2.5'}>
        {title ? (
          <p className="text-[13px] sm:text-sm font-heading font-semibold text-zinc-50 leading-snug">
            {title}
          </p>
        ) : null}
        {children || paras.map((p, i) => (
          <p key={i} className="text-[12px] sm:text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap">
            {p}
          </p>
        ))}
        <p className="text-[10px] font-heading text-amber-400/85 pt-1 tracking-wide">
          — System AI
        </p>
      </div>
    </div>
  );
}
