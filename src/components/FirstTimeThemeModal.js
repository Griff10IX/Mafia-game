import { THEME_PRESETS, getThemeColour } from '../constants/themes';
import styles from '../styles/noir.module.css';

const PRESET_DEFAULT_ID = 'old-default';
const PRESET_MODERN_ID = 'modern-full';
const PRESET_DARK_MAFIA_ID = 'dark-mafia-wars';

function PreviewCard({ presetId, label, buttonLabel, onChoose }) {
  const preset = THEME_PRESETS.find((p) => p.id === presetId);
  const colour = preset ? getThemeColour(preset.colourId) : null;
  const primary = colour?.primary ?? '#888';
  const isModern = preset?.themeVariant === 'modern';
  const isDarkMafia = preset?.themeVariant === 'dark_mafia';

  return (
    <div
      className="flex flex-col rounded-xl border-2 overflow-hidden transition-all hover:border-primary/50 focus-within:border-primary/50"
      style={{
        borderColor: 'rgba(var(--noir-primary-rgb), 0.2)',
        backgroundColor: 'var(--noir-content)',
      }}
    >
      <div
        className="h-2 w-full shrink-0"
        style={{ backgroundColor: primary }}
        aria-hidden
      />
      <div
        className="flex-1 p-4 flex flex-col gap-3"
        style={{
          background: isDarkMafia
            ? 'linear-gradient(180deg, #141414 0%, #0a0a0a 100%)'
            : isModern
            ? 'linear-gradient(180deg, rgba(45,45,50,0.5) 0%, rgba(32,32,36,0.6) 100%)'
            : 'linear-gradient(180deg, rgba(28,25,23,0.6) 0%, rgba(20,18,16,0.7) 100%)',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full shrink-0 border border-white/20"
            style={{ backgroundColor: primary }}
          />
          <span className="text-sm font-heading font-bold uppercase tracking-wider" style={{ color: 'var(--noir-foreground)' }}>
            {label}
          </span>
        </div>
        <div className="flex gap-2 items-center">
          <div
            className="h-8 rounded px-3 flex items-center justify-center text-xs font-heading border"
            style={{
              backgroundColor: `${primary}22`,
              borderColor: `${primary}66`,
              color: primary,
            }}
          >
            Sample
          </div>
          <span className="text-[10px] font-heading uppercase text-mutedForeground">
            {isDarkMafia ? 'Dark Mafia Wars' : isModern ? 'Modern layout' : 'Classic layout'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onChoose(presetId)}
          className="mt-auto w-full py-2.5 px-4 rounded-lg text-xs font-heading font-bold uppercase tracking-wider border-2 transition-all hover:opacity-90 active:scale-[0.98]"
          style={{
            backgroundColor: primary,
            borderColor: primary,
            color: colour?.foregroundOnPrimary ?? '#ffffff',
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

export default function FirstTimeThemeModal({ open, onClose, onChoose }) {
  if (!open) return null;

  const dismissChosen = () => {
    try {
      localStorage.setItem('app_initial_theme_chosen', '1');
    } catch (_) {}
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={dismissChosen}
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-time-theme-title"
    >
      <div
        className={`${styles.panel} w-full max-w-2xl rounded-2xl overflow-hidden border border-primary/20 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-primary/15 bg-primary/5">
          <h2 id="first-time-theme-title" className="text-sm font-heading font-bold text-primary uppercase tracking-wider">
            Choose your look
          </h2>
          <p className="text-[11px] text-mutedForeground font-heading mt-1">
            Pick Default, Modern, or Dark Mafia Wars. You can change this anytime in Theme settings.
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <PreviewCard
            presetId={PRESET_DEFAULT_ID}
            label="Default"
            buttonLabel="Choose Default"
            onChoose={onChoose}
          />
          <PreviewCard
            presetId={PRESET_MODERN_ID}
            label="Modern"
            buttonLabel="Choose Modern"
            onChoose={onChoose}
          />
          <PreviewCard
            presetId={PRESET_DARK_MAFIA_ID}
            label="Dark Mafia"
            buttonLabel="Choose Dark Mafia"
            onChoose={onChoose}
          />
        </div>
        <div className="px-5 py-3 border-t border-primary/10 flex justify-center">
          <button
            type="button"
            onClick={dismissChosen}
            className="text-[11px] font-heading uppercase tracking-wider text-mutedForeground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
