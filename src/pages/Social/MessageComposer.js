import { useState, useEffect } from 'react';
import { Smile } from 'lucide-react';
import GifPicker from '../../components/GifPicker';
import { FORUM_INLINE_SMILEY_PX } from '../../utils/forumContent';
import {
  IB_ACTION_GO,
  IB_ACTION_MUTE,
  CLASSIC_SMILEYS,
  EMOJI_LIST,
  SMILEY_IMG_BASE,
} from './inboxChrome';

export default function MessageComposer({
  value,
  onChange,
  gifUrl,
  onGifUrlChange,
  onSubmit,
  sending = false,
  placeholder = 'Type your message… [b]bold[/b], [url]https://…[/url], [img]https://…[/img]',
  minHeightClass = 'min-h-20',
  showCancel = false,
  onCancel,
  autoFocus = false,
  disabled = false,
}) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [showGifUrl, setShowGifUrl] = useState(false);

  useEffect(() => {
    if (disabled) {
      setShowEmoji(false);
      setShowGif(false);
    }
  }, [disabled]);

  const hasContent = !!(value || '').trim() || !!(gifUrl || '').trim();
  const submitDisabled = sending || disabled || !hasContent;

  const insertToken = (token) => onChange(`${value || ''}${token}`);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1.5">
      {gifUrl ? (
        <div className="flex items-start gap-2">
          <img
            src={gifUrl}
            alt="GIF attached"
            className="max-h-28 max-w-[70%] rounded border border-primary/20 object-cover"
          />
          <button
            type="button"
            onClick={() => onGifUrlChange('')}
            className={IB_ACTION_MUTE}
          >
            Clear GIF
          </button>
        </div>
      ) : null}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches}
        disabled={sending || disabled}
        rows={3}
        className={`w-full ${minHeightClass} bg-input border border-border rounded px-2.5 py-2 text-[16px] lg:text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y transition-colors`}
      />

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setShowEmoji((v) => !v);
            setShowGif(false);
          }}
          className={`${IB_ACTION_MUTE} inline-flex items-center gap-1`}
          aria-expanded={showEmoji}
          aria-controls="inbox-emoji-picker"
        >
          <Smile size={12} />
          Emoji
        </button>
        <button
          type="button"
          onClick={() => {
            setShowGif((v) => !v);
            setShowEmoji(false);
          }}
          className={IB_ACTION_MUTE}
          aria-expanded={showGif}
        >
          GIF
        </button>
        <div className="flex-1" />
        {showCancel && (
          <button type="button" onClick={onCancel} className={IB_ACTION_MUTE}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={submitDisabled} className={IB_ACTION_GO}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>

      {showGif && (
        <div className="space-y-1.5">
          <GifPicker
            compact
            onSelect={(url) => {
              onGifUrlChange(url);
              setShowGif(false);
              setShowGifUrl(false);
            }}
            onClose={() => setShowGif(false)}
          />
          <button
            type="button"
            onClick={() => setShowGifUrl((v) => !v)}
            className="text-[9px] font-heading font-bold uppercase tracking-wide text-mutedForeground hover:text-primary"
          >
            {showGifUrl ? 'Hide URL' : 'Paste URL'}
          </button>
          {showGifUrl && (
            <input
              type="url"
              value={gifUrl}
              onChange={(e) => onGifUrlChange(e.target.value)}
              placeholder="Paste GIF URL…"
              className="w-full min-h-9 bg-input border border-border rounded px-2.5 py-1.5 text-[16px] lg:text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none"
            />
          )}
        </div>
      )}

      {showEmoji && (
        <div
          id="inbox-emoji-picker"
          className="flex flex-wrap content-start gap-0.5 max-h-36 overflow-y-auto overscroll-contain border-t border-primary/10 pt-1.5"
        >
          {CLASSIC_SMILEYS.map(({ code, img }) => (
            <button
              key={code}
              type="button"
              onClick={() => insertToken(code)}
              className="p-1.5 min-w-9 min-h-9 rounded hover:bg-primary/20 active:scale-95 transition-all touch-manipulation"
              title={code}
              aria-label={code}
            >
              <img
                src={`${SMILEY_IMG_BASE}/${img}.png`}
                alt={code}
                className="object-contain shrink-0"
                style={{ width: FORUM_INLINE_SMILEY_PX, height: FORUM_INLINE_SMILEY_PX }}
              />
            </button>
          ))}
          {EMOJI_LIST.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => insertToken(emoji)}
              className="text-base p-1.5 min-w-9 min-h-9 rounded hover:bg-primary/20 active:scale-95 transition-all touch-manipulation"
              aria-label={`Insert ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
