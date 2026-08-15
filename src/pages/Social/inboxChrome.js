export const INBOX_STYLES = `
  .ib-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .ib-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  .ib-filters { -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .ib-filters::-webkit-scrollbar { display: none; }

  @media (min-width: 1024px) and (prefers-reduced-motion: no-preference) {
    html:not([data-mobile-compositor-safe="on"]) .ib-fade-in {
      animation: ib-fade-in 0.4s ease-out;
    }
  }
  @keyframes ib-fade-in { from { opacity: 0.96; } to { opacity: 1; } }
  .ib-fade-in { opacity: 1; }

  @media (max-width: 1023px) {
    .ib-row {
      min-height: 44px;
      padding: 10px !important;
      align-items: center;
    }
    .ib-filters button { min-height: 36px; }
  }
`;

export const IB_ACTION =
  'ib-action-btn tap-feedback rounded px-2.5 py-1.5 min-h-9 text-[9px] font-heading font-bold uppercase tracking-wide border transition-all touch-manipulation active:scale-[0.97]';
export const IB_ACTION_GO = `${IB_ACTION} bg-primary/20 text-primary border-primary/40 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed`;
export const IB_ACTION_MUTE = `${IB_ACTION} bg-secondary text-mutedForeground border-border hover:text-foreground hover:border-primary/30`;
export const IB_ACTION_DANGER = `${IB_ACTION} bg-secondary text-mutedForeground border-border hover:text-red-400 hover:border-red-400/50`;

export const CLASSIC_SMILEYS = [
  { code: ':wink:', img: 'wink' },
  { code: ':twisted:', img: 'twisted' },
  { code: ':tup:', img: 'tup' },
  { code: ':tdown:', img: 'tdown' },
  { code: ':tongue:', img: 'tongue' },
  { code: ':surprised:', img: 'surprised' },
  { code: ':happy:', img: 'smirk' },
  { code: ':sad:', img: 'sad' },
  { code: ':rolleyes:', img: 'rolleyes' },
  { code: ':redface:', img: 'redface' },
  { code: ':?:', img: 'question' },
  { code: ':mad:', img: 'mad' },
  { code: ':lol:', img: 'lol' },
  { code: ':idea:', img: 'idea' },
  { code: ':!:', img: 'exclamation' },
  { code: ':evil:', img: 'evil' },
  { code: ':eek:', img: 'eek' },
  { code: ':cool:', img: 'cool' },
  { code: ':confused:', img: 'confused' },
  { code: ':grin:', img: 'grin' },
  { code: ':arrow:', img: 'arrow' },
  { code: ':feelsbadman:', img: 'feelsbadman' },
  { code: ':ez:', img: 'ez' },
  { code: ':crazy:', img: 'crazy' },
  { code: ':feelsrainman:', img: 'feelsrainman' },
  { code: ':fu:', img: 'fu' },
  { code: ':sadge:', img: 'sadge' },
  { code: ':howdie:', img: 'howdie' },
  { code: ':uzi:', img: 'uzi' },
  { code: ':kekl:', img: 'kekl' },
  { code: ':kekwait:', img: 'kekwait' },
  { code: ':kekleo:', img: 'kekleo' },
  { code: ':kekw:', img: 'kekw' },
  { code: ':hmmnice:', img: 'hmmnice' },
  { code: ':hypers:', img: 'hypers' },
  { code: ':poggers:', img: 'poggers' },
  { code: ':hackermans:', img: 'hackermans' },
  { code: ':prayge:', img: 'prayge' },
];

export const EMOJI_LIST = [
  '😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😎', '🤩', '😍',
  '😂', '🤣', '😅', '😢', '😭', '😤', '😡', '🤬', '😱', '😰',
  '🤔', '😐', '😑', '🙄', '😏', '😒', '🥱', '😴', '🤢', '🤮',
  '👍', '👎', '👋', '🤝', '🙏', '💪', '✊', '👊', '🤙', '✌️',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '❣️', '💕',
  '🔥', '⭐', '✨', '💥', '💯', '🎉', '🎊', '🏆', '👑', '💎',
  '💰', '💵', '💸', '🔫', '💀', '☠️', '⚔️', '🔪', '🎲', '🃏',
  '❓', '❗', '⚠️', '✅', '❌', '🚫', '➕', '➖', '➡️', '⬅️',
  '👔', '💼', '🥃', '🍷', '🎭',
];

export const SMILEY_IMG_BASE = `${process.env.PUBLIC_URL || ''}/images/smileys`;

export function InboxHairline() {
  return <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />;
}

export function InboxArtLine() {
  return <div className="ib-art-line text-primary mx-2.5" />;
}

export function InboxBar({ children, className = '' }) {
  return (
    <div className={`px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 ${className}`}>
      {children}
    </div>
  );
}
