import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Search, Plane, Car, Crosshair, Clock, MapPin, Skull, Calculator, Zap, FileText, Users, Star } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { refreshUser, getApiErrorMessage, apiRequestWith429Retry } from '../../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';
import { useAttackTurnstile } from '../../hooks/useAttackTurnstile';
import { RARITY_GLOW_HEX, rarityRowStyle } from '../../constants/carRarityGlows';
import { formatGameDateTime } from '../../utils/gameDateTime';

const ATTACK_STYLES = `
  @keyframes atk-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .atk-fade-in { animation: atk-fade-in 0.4s ease-out both; }
  @keyframes atk-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .atk-scale-in { animation: atk-scale-in 0.35s ease-out both; }
  @keyframes atk-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .atk-glow { animation: atk-glow 4s ease-in-out infinite; }
  .atk-card { transition: all 0.3s ease; }
  .atk-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .atk-row { transition: all 0.2s ease; }
  .atk-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .atk-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

/** Live countdown to expiry: "23h 59m 45s" → "0:00" when expired. Include seconds for live tick. */
function formatCountdown(expiresAtIso) {
  if (!expiresAtIso) return '—';
  const end = new Date(expiresAtIso).getTime();
  if (Number.isNaN(end)) return '—';
  const now = Date.now();
  const secs = Math.max(0, Math.floor((end - now) / 1000));
  if (secs === 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Show exact find clock for any searching row while the weekly perk is active. */
function showExactFindClock(a, perkActive) {
  return !!(perkActive && a?.status === 'searching' && a?.found_at);
}

function bodyguardFindTimePerkActive(untilIso, activeFlag) {
  if (activeFlag) return true;
  if (!untilIso) return false;
  const t = Date.parse(String(untilIso).replace('Z', '+00:00'));
  return Number.isFinite(t) && t > Date.now();
}

/** e.g. "ready in 12d" or "ready May 3" for paid inflation reset cooldown. */
function formatInflationResetReady(availableAtIso) {
  if (!availableAtIso) return 'on cooldown';
  const end = Date.parse(String(availableAtIso).replace('Z', '+00:00'));
  if (!Number.isFinite(end)) return 'on cooldown';
  const ms = end - Date.now();
  if (ms <= 0) return 'available';
  const days = Math.ceil(ms / 86400000);
  if (days >= 2) return `ready in ${days}d`;
  const hours = Math.ceil(ms / 3600000);
  if (hours >= 2) return `ready in ${hours}h`;
  return `ready ${formatGameDateTime(availableAtIso)}`;
}

// Shown in toast when caught during booze run (prohibition bust)
const BOOZE_CAUGHT_IMAGE = 'https://historicipswich.net/wp-content/uploads/2021/12/0a79f-boston-rum-prohibition1.jpg';
const MOLOTOV_BULLET_EQUIV = 250;
const MAX_BULLETS_REQUIRED = 150000;
const MOBILE_SEARCH_RENDER_STEP = 40;

function clampBulletsRequired(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), MAX_BULLETS_REQUIRED);
}

/** Strip legacy server copy like " in slot 2" so kill toasts never show slot numbers. */
function stripBodyguardSlotFromToastMessage(msg) {
  if (typeof msg !== 'string') return msg;
  return msg.replace(/\s+in slot\s+\d+/gi, '').trim();
}

// Only run the F5-resend check once per document load so navigating away and back doesn't resend
let attackResendCheckDoneThisLoad = false;

// Session-scoped cache: render the previously-loaded "My Searches" instantly on mount so the box is never blank
// while /attack/list is in flight. Keyed by JWT-bearing token presence (sessionStorage) — cleared on browser close.
const _ATTACK_LIST_CACHE_KEY = 'kill_attacks_cache_v1';
const _ATTACK_LIST_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const ATTACK_LIST_POLL_MS = 3000;
const ATTACK_LIST_REFRESH_AFTER_USER_EVENT_MS = 200;
function readCachedAttacks() {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.sessionStorage.getItem(_ATTACK_LIST_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.attacks)) return [];
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > _ATTACK_LIST_CACHE_MAX_AGE_MS) return [];
    return parsed.attacks;
  } catch (_e) {
    return [];
  }
}
function writeCachedAttacks(list) {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(
      _ATTACK_LIST_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), attacks: Array.isArray(list) ? list : [] }),
    );
  } catch (_e) { /* quota / disabled storage is non-fatal */ }
}

/** Normalized username — matches server kill_favorite_targets. */
function normKillFavUser(name) {
  return String(name || '').trim().toLowerCase();
}

/** Same-origin tabs: mirror server favorites so storage events sync instantly. */
const _KILL_FAV_MIRROR_KEY = 'kill_attack_favorite_targets_mirror_v2';
function readKillFavoriteMirror() {
  try {
    if (typeof window === 'undefined') return new Set();
    const raw = window.localStorage.getItem(_KILL_FAV_MIRROR_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x) : []);
  } catch (_e) {
    return new Set();
  }
}
function writeKillFavoriteMirror(set) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(_KILL_FAV_MIRROR_KEY, JSON.stringify([...set].sort()));
  } catch (_e) { /* quota */ }
}

// Travel info cache: server already memoizes /travel/info for 5s, but a fresh page nav still pays the
// full network round-trip when the modal opens. Pre-fetch + sessionStorage cache so the modal opens
// instantly with prior data, then refreshes in the background.
const _TRAVEL_INFO_CACHE_KEY = 'kill_travel_info_cache_v1';
const _TRAVEL_INFO_CACHE_MAX_AGE_MS = 30 * 1000;
function readCachedTravelInfo() {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(_TRAVEL_INFO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data) return null;
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > _TRAVEL_INFO_CACHE_MAX_AGE_MS) return null;
    return parsed.data;
  } catch (_e) {
    return null;
  }
}
function writeCachedTravelInfo(data) {
  try {
    if (typeof window === 'undefined' || !data) return;
    window.sessionStorage.setItem(
      _TRAVEL_INFO_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), data }),
    );
  } catch (_e) { /* quota / disabled storage is non-fatal */ }
}

function getAttackExecuteCodePayload(attack) {
  const codeName = String(attack?.execute_code_name || '').trim();
  if (
    codeName
    && Object.prototype.hasOwnProperty.call(attack || {}, codeName)
    && typeof attack[codeName] === 'string'
    && attack[codeName].trim().length >= 16
  ) {
    return {
      execute_code_name: codeName,
      [codeName]: attack[codeName].trim(),
    };
  }
  const legacy = typeof attack?.execute_token === 'string' ? attack.execute_token.trim() : '';
  return legacy.length >= 16 ? { execute_token: legacy } : null;
}

function getTravelCodePayload(travelInfo) {
  const codeName = String(travelInfo?.travel_code_name || '').trim();
  if (
    codeName
    && Object.prototype.hasOwnProperty.call(travelInfo || {}, codeName)
    && typeof travelInfo[codeName] === 'string'
    && travelInfo[codeName].trim().length >= 16
  ) {
    return {
      travel_code_name: codeName,
      [codeName]: travelInfo[codeName].trim(),
    };
  }
  return {};
}

function getSearchCodePayload(searchCodeInfo) {
  const codeName = String(searchCodeInfo?.search_code_name || '').trim();
  if (
    codeName
    && Object.prototype.hasOwnProperty.call(searchCodeInfo || {}, codeName)
    && typeof searchCodeInfo[codeName] === 'string'
    && searchCodeInfo[codeName].trim().length >= 16
  ) {
    return {
      search_code_name: codeName,
      [codeName]: searchCodeInfo[codeName].trim(),
    };
  }
  return {};
}

function isAttackSearchCodeError(error) {
  const detail = error?.response?.data?.detail;
  const msg = typeof detail === 'string'
    ? detail
    : (detail && typeof detail === 'object' && typeof detail.detail === 'string')
      ? detail.detail
      : '';
  const lower = msg.toLowerCase();
  return (
    error?.response?.status === 400
    && (
      detail?.code === 'attack_search_code_invalid'
      || lower.includes('search refreshed')
      || lower.includes('start search again')
    )
  );
}

function extractSearchCodeInfo(data) {
  if (!data || typeof data !== 'object') return null;
  const codeName = String(data.search_code_name || '').trim();
  if (
    codeName
    && typeof data[codeName] === 'string'
    && data[codeName].trim().length >= 16
  ) {
    return {
      search_code_name: codeName,
      search_code_bucket: data.search_code_bucket,
      [codeName]: data[codeName].trim(),
    };
  }
  return null;
}

function isAttackExecuteCodeError(error) {
  const detail = error?.response?.data?.detail;
  const msg = typeof detail === 'string'
    ? detail
    : typeof detail?.message === 'string'
      ? detail.message
      : typeof detail?.detail === 'string'
        ? detail.detail
      : '';
  const lower = msg.toLowerCase();
  return (
    error?.response?.status === 400
    && (
      detail?.code === 'attack_execute_code_invalid'
      || lower.includes('invalid or missing session token')
      || lower.includes('refresh the page and open my searches')
      || lower.includes('do not use bots or automated tools')
      || lower.includes('execute code')
    )
  );
}

/** Kill / execute feedback: same pattern as roulette — compact banner, × to dismiss only (no auto-close). */
const KillNotificationBanner = ({ message, onDismiss }) => {
  if (!message) return null;
  const { text, type, description, action } = message;
  const vClass =
    type === 'success'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
      : type === 'warning'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
        : type === 'error'
          ? 'border-red-500/40 bg-red-500/10 text-red-100'
          : 'border-primary/30 bg-primary/10 text-foreground';
  return (
    <div className={`atk-fade-in rounded-md border px-2.5 py-1.5 flex items-start justify-between gap-2 ${vClass}`} role="status">
      <div className="flex-1 min-w-0 max-h-[4.25rem] sm:max-h-[4.75rem] overflow-y-auto pr-1">
        <p className="text-[10px] font-heading leading-snug whitespace-pre-line font-bold">{text}</p>
        {description && (
          <p className="text-[10px] font-heading leading-snug text-white/70 dark:text-white/60 mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex items-start gap-1.5 shrink-0">
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="px-2 py-0.5 text-[10px] font-heading font-bold uppercase tracking-wider rounded border border-white/25 hover:bg-black/20 transition-colors"
          >
            {action.label}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 leading-none px-1 py-0.5 rounded text-[11px] text-white/60 hover:text-white hover:bg-black/20 font-heading"
          aria-label="Dismiss message"
        >
          ×
        </button>
      </div>
    </div>
  );
};

const KillUserCard = ({
  killUsername,
  setKillUsername,
  bulletsToUse,
  setBulletsToUse,
  deathMessage,
  setDeathMessage,
  makePublic,
  setMakePublic,
  useMolotovs,
  setUseMolotovs,
  inflationPct,
  inflationReset,
  onResetInflation,
  resetInflationBusy,
  slowKillInflationActive,
  userBullets,
  userMolotovs,
  foundAndReady,
  onKill,
  onOpenCalc,
  bulletsNeededForKill,
  bulletsNeededLoading,
}) => {
  const molotovsToUse = (() => {
    if (!useMolotovs) return null;
    const needed = Number(bulletsNeededForKill?.bullets || 0);
    const requested = parseInt(String(bulletsToUse || '').replace(/,/g, ''), 10) || 0;
    if (needed < 1 || requested < 1) return null;
    const bulletsUsed = Math.min(requested, Number(userBullets || 0));
    const shortfall = Math.max(0, needed - bulletsUsed);
    return Math.min(Number(userMolotovs || 0), Math.ceil(shortfall / MOLOTOV_BULLET_EQUIV));
  })();

  return (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 atk-card atk-fade-in mobile-panel`}>
    <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none atk-glow" />
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1">
        <Skull size={14} />
        Kill User
      </h2>
      <button
        type="button"
        className="text-[9px] uppercase tracking-wider text-primary hover:text-primary/80 font-heading inline-flex items-center gap-1 transition-colors"
        onClick={onOpenCalc}
      >
        <Calculator size={12} />
        Calculator
      </button>
    </div>
    <div className="p-2 space-y-2">
      <div>
        <label className="block text-[9px] text-mutedForeground font-heading uppercase tracking-wider mb-0.5">
          Username
        </label>
        <input
          type="text"
          value={killUsername}
          onChange={(e) => setKillUsername(e.target.value)}
          className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
          placeholder="Enter username..."
          list="found-users-inline"
          data-testid="kill-username-inline"
        />
        <datalist id="found-users-inline">
          {foundAndReady.map((a) => (
            <option key={a.attack_id} value={a.target_username} />
          ))}
        </datalist>
      </div>

      {killUsername.trim() && (
        <div className="text-[10px] font-heading text-mutedForeground">
          {bulletsNeededLoading ? (
            <span className="italic">Loading bullets needed…</span>
          ) : bulletsNeededForKill && (killUsername.trim().toLowerCase() === bulletsNeededForKill.username.toLowerCase()) ? (
            <span>
              Bullets needed to kill {bulletsNeededForKill.username}: <span className="text-primary font-bold">{Number(bulletsNeededForKill.bullets).toLocaleString()}</span>
            </span>
          ) : null}
        </div>
      )}
      
      <div>
        <label className="block text-[9px] text-mutedForeground font-heading uppercase tracking-wider mb-0.5">
          Bullets <span className="text-primary">({Number(userBullets).toLocaleString()} available)</span>
        </label>
        <FormattedNumberInput
          value={bulletsToUse}
          onChange={setBulletsToUse}
          className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
          placeholder="Enter amount (min 1)"
          data-testid="kill-bullets-inline"
        />
      </div>
      
      <div>
        <label className="block text-[9px] text-mutedForeground font-heading uppercase tracking-wider mb-0.5">
          Death Message (Optional)
        </label>
        <textarea
          value={deathMessage}
          onChange={(e) => setDeathMessage(e.target.value)}
          className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y transition-colors"
          placeholder="Leave a message..."
          rows={2}
          data-testid="kill-death-message-inline"
        />
      </div>
      
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5 bg-secondary/50 border border-border rounded px-2 py-1.5">
          <div className="text-[10px] text-mutedForeground font-heading min-w-0">
            Inflation: <span className="text-foreground font-bold">{inflationPct}%</span>
            {slowKillInflationActive ? (
              <span className="text-emerald-400/90 ml-1">(slow perk · half gain)</span>
            ) : null}
            {inflationPct > 0 && inflationReset?.reset_on_cooldown && inflationReset?.reset_available_at ? (
              <span className="text-mutedForeground/80 ml-1">
                (paid reset {formatInflationResetReady(inflationReset.reset_available_at)})
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {inflationPct > 0 && inflationReset?.reset_available ? (
              <button
                type="button"
                onClick={onResetInflation}
                disabled={resetInflationBusy}
                className="text-[9px] font-heading font-bold uppercase tracking-wider px-1.5 py-1 rounded border border-primary/40 text-primary bg-primary/15 hover:bg-primary/25 disabled:opacity-50 min-h-[28px]"
                data-testid="kill-inflation-reset"
                title="Pay 5,000 points to set inflation to 0% (once per 30 days)"
              >
                {resetInflationBusy ? '…' : `Reset · ${(inflationReset.reset_cost_points || 5000).toLocaleString()} pts`}
              </button>
            ) : null}
            <label className="inline-flex items-center gap-1.5 text-[10px] text-foreground font-heading cursor-pointer">
              <input 
                type="checkbox" 
                checked={makePublic} 
                onChange={(e) => setMakePublic(e.target.checked)} 
                className="w-3 h-3 accent-primary cursor-pointer" 
                data-testid="kill-make-public-inline" 
              />
              <span>Make Public</span>
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between bg-secondary/40 border border-border rounded px-2 py-1.5">
          <div className="text-[10px] text-mutedForeground font-heading">
            Molotovs:{' '}
            <span className="text-foreground font-bold">
              {Number(userMolotovs || 0).toLocaleString()} <span className="text-xs text-mutedForeground">(250 bullets each)</span>
            </span>
            {molotovsToUse != null ? (
              <span className={molotovsToUse > 0 ? 'text-primary ml-1' : 'text-mutedForeground/80 ml-1'}>
                · using {molotovsToUse.toLocaleString()}
              </span>
            ) : null}
          </div>
          <label className="inline-flex items-center gap-1.5 text-[10px] text-foreground font-heading cursor-pointer">
            <input
              type="checkbox"
              checked={useMolotovs}
              onChange={(e) => setUseMolotovs(e.target.checked)}
              className="w-3 h-3 accent-primary cursor-pointer"
            />
            <span>Use molotovs</span>
          </label>
        </div>
      </div>
      
      <button
        type="button"
        disabled={!killUsername.trim() || !bulletsToUse.trim() || parseInt(bulletsToUse, 10) < 1}
        onClick={onKill}
        className="w-full bg-gradient-to-r from-red-700 via-red-800 to-red-900 hover:from-red-600 hover:via-red-700 hover:to-red-800 text-white rounded font-heading font-bold uppercase tracking-widest py-2 text-[10px] border-2 border-red-600/50 shadow-lg shadow-red-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
        data-testid="kill-inline-button"
      >
        💀 Kill User
      </button>
    </div>
    <div className="atk-art-line text-primary mx-2" />
  </div>
  );
};

const FindUserCard = ({
  targetUsername,
  setTargetUsername,
  note,
  setNote,
  loading,
  onSearch
}) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 atk-card atk-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1">
        <Search size={14} />
        Find User
      </h2>
    </div>
    <form onSubmit={onSearch} className="p-2 space-y-2">
      <div>
        <label className="block text-[9px] text-mutedForeground font-heading uppercase tracking-wider mb-0.5">
          Username
        </label>
        <input
          type="text"
          value={targetUsername}
          onChange={(e) => setTargetUsername(e.target.value)}
          className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
          placeholder="Enter username..."
          required
          data-testid="target-username-input"
        />
      </div>
      
      <div>
        <label className="block text-[9px] text-mutedForeground font-heading uppercase tracking-wider mb-0.5">
          Note (Optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
          placeholder="E.g. rival, bounty, etc."
          data-testid="target-note-input"
        />
      </div>
      
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-primary/20 text-primary rounded font-heading font-bold uppercase tracking-widest py-2 text-[10px] border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
        data-testid="search-target-button"
      >
        {loading ? '⏳ Searching...' : '🔍 Start Search'}
      </button>
      
      <p className="text-[9px] text-mutedForeground font-heading italic">
        💡 Tip: Searches take time. Track progress in "My Searches" below.
      </p>
    </form>
    <div className="atk-art-line text-primary mx-2" />
  </div>
);

const SearchesCard = ({
  attacks,
  filterText,
  setFilterText,
  show,
  setShow,
  targetFilter,
  setTargetFilter,
  isFavoriteTarget,
  toggleFavorite,
  favoriteCount,
  selectedAttackIds,
  toggleSelected,
  toggleSelectAll,
  allSelected,
  loading,
  travelBusy = false,
  onDelete,
  onTravel,
  onFillKillTarget,
  robotBgAutoSearchActive,
  bodyguardFindTimeActive = false,
}) => {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });
  const [mobileVisibleCount, setMobileVisibleCount] = useState(MOBILE_SEARCH_RENDER_STEP);
  const showKillForRow = (a) => !!(a.can_attack && onFillKillTarget);
  const selectedIdSet = useMemo(() => new Set(selectedAttackIds), [selectedAttackIds]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia('(min-width: 768px)');
    const onChange = (e) => setIsDesktop(e.matches);
    setIsDesktop(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);
  // Live countdown: re-render every second so EXPIRES shows h/m/s ticking
  const [, setTick] = useState(0);
  useEffect(() => {
    if (attacks.length === 0) return;
    const heavyMobileList = !isDesktop && attacks.length > MOBILE_SEARCH_RENDER_STEP;
    const id = setInterval(() => setTick((t) => t + 1), heavyMobileList ? 15000 : 1000);
    return () => clearInterval(id);
  }, [attacks.length, isDesktop]);

  useEffect(() => {
    setMobileVisibleCount(MOBILE_SEARCH_RENDER_STEP);
  }, [filterText, show, targetFilter, isDesktop]);

  const mobileListCapped = !isDesktop && attacks.length > mobileVisibleCount;
  const mobileAttacksToRender = !isDesktop ? attacks.slice(0, mobileVisibleCount) : attacks;

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 atk-card atk-fade-in mobile-panel`} style={{ animationDelay: '0.1s' }}>
      <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none atk-glow" />
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1">
          <Users size={14} />
          My Searches ({attacks.length})
          {favoriteCount > 0 ? (
            <span className="text-red-400/90 normal-case tracking-normal font-bold" title="Favorited targets">
              · ★ {favoriteCount}
            </span>
          ) : null}
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-mutedForeground font-heading">Show:</span>
            <select
              value={show}
              onChange={(e) => setShow(e.target.value)}
              className="bg-secondary border border-border rounded px-1.5 py-0.5 text-[9px] font-heading text-foreground focus:border-primary/50 focus:outline-none"
              data-testid="attack-show-filter"
            >
              <option value="all">All</option>
              <option value="favorites">Favorites</option>
              <option value="searching">Searching</option>
              <option value="found">Found</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-mutedForeground font-heading">Target:</span>
            <select
              value={targetFilter}
              onChange={(e) => setTargetFilter(e.target.value)}
              className="bg-secondary border border-border rounded px-1.5 py-0.5 text-[9px] font-heading text-foreground focus:border-primary/50 focus:outline-none max-w-[11rem]"
              data-testid="attack-target-filter"
              title="Filter by search target type"
            >
              <option value="all">All</option>
              <option value="robot">Robot bodyguards</option>
              <option value="users">Users only</option>
            </select>
          </div>
        </div>
      </div>
      
      <div className="p-2 space-y-2">
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
          placeholder="Filter by username or note..."
          data-testid="attack-filter-input"
        />

        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex items-center gap-1.5 text-[10px] text-mutedForeground font-heading cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-3 h-3 accent-primary cursor-pointer"
              data-testid="attack-select-all"
            />
            Select all
          </label>
          <button
            type="button"
            disabled={loading || selectedAttackIds.length === 0}
            onClick={onDelete}
            className="px-2 py-1 rounded bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 text-[9px] font-heading font-bold uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            data-testid="attack-delete-selected"
          >
            🗑️ Delete ({selectedAttackIds.length})
          </button>
        </div>

        {attacks.length === 0 ? (
          <div className="py-6 text-center">
            <Search size={32} className="mx-auto text-primary/30 mb-2" />
            <p className="text-[10px] text-mutedForeground font-heading">No active searches</p>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">Start a search above to track targets</p>
          </div>
        ) : (
          <>
            {isDesktop ? (
            <div className="border border-zinc-700/40 rounded overflow-hidden">
              <div className="grid grid-cols-12 bg-zinc-800/50 text-[8px] uppercase tracking-wider font-heading text-zinc-500 px-2 py-1 border-b border-zinc-700/40">
                <div className="col-span-1"></div>
                <div className="col-span-4">User / Note</div>
                <div className="col-span-3">Location</div>
                <div className="col-span-4 text-right">Expires</div>
              </div>
              
              <div className="divide-y divide-zinc-700/30">
                {attacks.map((a) => (
                  <div
                    key={a.attack_id}
                    className={`atk-row grid grid-cols-12 px-2 py-1.5 items-start gap-2 ${
                      a.bodyguard_is_mine ? 'border-l-2 border-primary bg-primary/[0.07]' : ''
                    }`}
                  >
                    <div className="col-span-1 pt-0.5">
                      <input
                        type="checkbox"
                        checked={selectedIdSet.has(a.attack_id)}
                        onChange={() => toggleSelected(a.attack_id)}
                        className="w-3 h-3 accent-primary cursor-pointer"
                        data-testid={`attack-select-${a.attack_id}`}
                      />
                    </div>

                    <div className="col-span-4 min-w-0">
                      <div className="flex items-start gap-1.5 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleFavorite(a.target_username);
                          }}
                          className="shrink-0 p-0.5 rounded hover:bg-white/5 mt-0.5"
                          aria-label={isFavoriteTarget(a) ? 'Remove from favorites' : 'Add to favorites'}
                          aria-pressed={isFavoriteTarget(a)}
                          data-testid={`attack-favorite-${a.attack_id}`}
                        >
                          <Star
                            size={12}
                            className={
                              isFavoriteTarget(a)
                                ? 'text-red-500 fill-red-500'
                                : 'text-zinc-500 fill-transparent'
                            }
                          />
                        </button>
                        <Link
                          to={`/profile/${encodeURIComponent(a.target_username)}`}
                          className="font-heading font-bold text-foreground hover:text-primary transition-colors block text-[10px] truncate min-w-0"
                          data-testid={`attack-user-${a.attack_id}`}
                        >
                          {a.target_username}
                        </Link>
                        {a.bodyguard_is_mine ? (
                          <span className="shrink-0 px-1 py-0.5 rounded text-[8px] font-heading font-bold uppercase bg-primary/25 text-primary border border-primary/40">
                            Yours
                          </span>
                        ) : null}
                      </div>
                      {a.bodyguard_owner_username && !a.bodyguard_is_mine ? (
                        <div className="text-[8px] text-zinc-500 font-heading mt-0.5 truncate">
                          Guarding{' '}
                          <Link
                            to={`/profile/${encodeURIComponent(a.bodyguard_owner_username)}`}
                            className="text-zinc-400 hover:text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {a.bodyguard_owner_username}
                          </Link>
                        </div>
                      ) : null}
                      {a.note && (
                        <div className="text-[9px] text-mutedForeground truncate font-heading mt-0.5">
                          {a.note}
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-1.5 text-[9px] flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded font-heading font-bold uppercase ${
                          a.status === 'searching' 
                            ? 'bg-secondary text-mutedForeground border border-border' 
                            : 'bg-primary/20 text-primary border border-primary/30'
                        }`}>
                          {a.status}
                        </span>
                        {a.can_travel && (
                          <button
                            type="button"
                            disabled={travelBusy}
                            onClick={() => onTravel(a.location_state)}
                            className="inline-flex items-center gap-0.5 text-primary hover:text-primary/80 font-heading font-bold transition-colors disabled:opacity-50"
                            data-testid={`attack-travel-${a.attack_id}`}
                          >
                            <Plane size={10} />
                            Travel
                          </button>
                        )}
                        {showKillForRow(a) && (
                          <button
                            type="button"
                            onClick={() => onFillKillTarget(a.target_username)}
                            className="inline-flex items-center gap-0.5 text-red-400 hover:text-red-300 font-heading font-bold transition-colors disabled:opacity-50"
                            data-testid={`attack-kill-${a.attack_id}`}
                            title="Fill username into Kill User form"
                          >
                            <Crosshair size={10} />
                            Kill
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="col-span-3 text-[10px] text-mutedForeground font-heading">
                      {a.status === 'found' && a.location_state ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin size={12} className="text-primary" />
                          <span className="text-foreground">{a.location_state}</span>
                        </span>
                      ) : (
                        <span className="text-mutedForeground/60">Searching...</span>
                      )}
                    </div>

                    <div className="col-span-4 text-right text-[9px] text-mutedForeground font-heading">
                      {showExactFindClock(a, bodyguardFindTimeActive) ? (
                        <span className="inline-flex flex-col items-end gap-0.5">
                          <span className="inline-flex items-center gap-1 text-cyan-300 font-bold">
                            <Clock size={12} />
                            Finds in {formatCountdown(a.found_at)}
                          </span>
                          <span className="text-[8px] text-cyan-400/80 tabular-nums" title={a.found_at}>
                            {formatGameDateTime(a.found_at)}
                          </span>
                          <span className="text-[8px] text-mutedForeground/70">
                            Row expires {formatCountdown(a.expires_at || a.search_started)}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 justify-end">
                          <Clock size={12} />
                          {formatCountdown(a.expires_at || a.search_started)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            ) : (
            <div className="space-y-2">
              {attacks.length > MOBILE_SEARCH_RENDER_STEP ? (
                <div className="rounded border border-primary/20 bg-primary/8 px-2 py-1.5 text-[9px] text-mutedForeground font-heading">
                  Showing {Math.min(mobileVisibleCount, attacks.length)} of {attacks.length} searches on mobile to keep the kill page smooth.
                  Use the filter box to narrow the list.
                </div>
              ) : null}
              {mobileAttacksToRender.map((a) => (
                <div
                  key={a.attack_id}
                  className={`atk-row bg-zinc-800/30 rounded p-2 border space-y-2 ${
                    a.bodyguard_is_mine ? 'border-primary/50 border-l-2 border-l-primary bg-primary/[0.07]' : 'border-zinc-700/30'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIdSet.has(a.attack_id)}
                      onChange={() => toggleSelected(a.attack_id)}
                      className="w-3 h-3 accent-primary cursor-pointer mt-0.5"
                      data-testid={`attack-select-${a.attack_id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-1.5 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleFavorite(a.target_username);
                          }}
                          className="shrink-0 p-0.5 rounded hover:bg-white/5 mt-0.5"
                          aria-label={isFavoriteTarget(a) ? 'Remove from favorites' : 'Add to favorites'}
                          aria-pressed={isFavoriteTarget(a)}
                          data-testid={`attack-favorite-${a.attack_id}`}
                        >
                          <Star
                            size={13}
                            className={
                              isFavoriteTarget(a)
                                ? 'text-red-500 fill-red-500'
                                : 'text-zinc-500 fill-transparent'
                            }
                          />
                        </button>
                        <Link
                          to={`/profile/${encodeURIComponent(a.target_username)}`}
                          className="font-heading font-bold text-foreground hover:text-primary transition-colors block text-[11px] truncate min-w-0"
                        >
                          {a.target_username}
                        </Link>
                        {a.bodyguard_is_mine ? (
                          <span className="shrink-0 px-1 py-0.5 rounded text-[8px] font-heading font-bold uppercase bg-primary/25 text-primary border border-primary/40">
                            Yours
                          </span>
                        ) : null}
                      </div>
                      {a.bodyguard_owner_username && !a.bodyguard_is_mine ? (
                        <div className="text-[8px] text-zinc-500 font-heading mt-0.5">
                          Guarding{' '}
                          <Link
                            to={`/profile/${encodeURIComponent(a.bodyguard_owner_username)}`}
                            className="text-zinc-400 hover:text-primary"
                          >
                            {a.bodyguard_owner_username}
                          </Link>
                        </div>
                      ) : null}
                      {a.note && (
                        <div className="text-[9px] text-mutedForeground font-heading mt-0.5">
                          {a.note}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-heading font-bold uppercase ${
                      a.status === 'searching' 
                        ? 'bg-secondary text-mutedForeground border border-border' 
                        : 'bg-primary/20 text-primary border border-primary/30'
                    }`}>
                      {a.status}
                    </span>
                    
                    {a.status === 'found' && a.location_state && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-foreground font-heading">
                        <MapPin size={12} className="text-primary" />
                        {a.location_state}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {a.can_travel && (
                      <button
                        type="button"
                        disabled={travelBusy}
                        onClick={() => onTravel(a.location_state)}
                        className="flex-1 bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 rounded px-2 py-1 text-[10px] font-heading font-bold uppercase transition-all disabled:opacity-50 active:scale-95 touch-manipulation inline-flex items-center justify-center gap-1"
                      >
                        <Plane size={12} />
                        Travel
                      </button>
                    )}
                    {showKillForRow(a) && (
                      <button
                        type="button"
                        onClick={() => onFillKillTarget(a.target_username)}
                        className="flex-1 bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 rounded px-2 py-1 text-[10px] font-heading font-bold uppercase transition-all disabled:opacity-50 active:scale-95 touch-manipulation inline-flex items-center justify-center gap-1"
                        title="Fill username into Kill User form"
                      >
                        <Crosshair size={12} />
                        Kill
                      </button>
                    )}
                  </div>

                  <div className="text-[9px] text-mutedForeground font-heading flex flex-col gap-0.5">
                    {showExactFindClock(a, bodyguardFindTimeActive) ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-cyan-300 font-bold">
                          <Clock size={10} />
                          Finds in {formatCountdown(a.found_at)}
                        </span>
                        <span className="text-[8px] text-cyan-400/80 tabular-nums pl-3.5">
                          {formatGameDateTime(a.found_at)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-mutedForeground/70">
                          <Clock size={10} />
                          Row expires: {formatCountdown(a.expires_at || a.search_started)}
                        </span>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={10} />
                        Expires: {formatCountdown(a.expires_at || a.search_started)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {mobileListCapped ? (
                <button
                  type="button"
                  onClick={() => setMobileVisibleCount((n) => Math.min(n + MOBILE_SEARCH_RENDER_STEP, attacks.length))}
                  className="w-full rounded border border-primary/30 bg-primary/10 px-2 py-2 text-[10px] font-heading font-bold uppercase tracking-wider text-primary hover:bg-primary/20"
                >
                  Show {Math.min(MOBILE_SEARCH_RENDER_STEP, attacks.length - mobileVisibleCount)} more searches
                </button>
              ) : null}
            </div>
            )}
          </>
        )}
        
        {attacks.length > 0 && (
          <p className="text-[9px] text-mutedForeground font-heading italic pt-1">
            💡 Searches complete automatically. Typical find time ~2h 15m–2h 45m; the timer above is the 24h row expiry from search start.
            {bodyguardFindTimeActive ? (
              <span className="block mt-1 text-cyan-400/90">Find Clock is active — searching rows show the exact find time.</span>
            ) : null}
            {robotBgAutoSearchActive ? (
              <span className="block mt-1 text-cyan-400/90">Robot auto-search is active — your hired robots are re-searched when a row has ≤3h left.</span>
            ) : null}
          </p>
        )}
      </div>
      <div className="atk-art-line text-primary mx-2" />
    </div>
  );
};

const TravelModal = ({ 
  destination, 
  onClose, 
  travelInfo, 
  loading, 
  countdown, 
  onTravel 
}) => {
  const dest = destination ?? 'Unknown';
  return (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
    <div className={`${styles.panel} border-2 border-primary/30 rounded-md shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1">
          <MapPin size={14} />
          Travel to {dest}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-mutedForeground hover:text-primary transition-colors p-0.5"
          aria-label="Close"
        >
          <span className="text-lg">×</span>
        </button>
      </div>
      
      <div className="p-2">
        {countdown != null && countdown > 0 ? (
          <div className="text-center py-4">
            <div className="text-2xl mb-2">🚗</div>
            <p className="text-[11px] font-heading font-bold text-primary mb-1">
              Traveling to {dest}...
            </p>
            <p className="text-2xl font-heading font-bold text-foreground tabular-nums">
              {countdown}s
            </p>
          </div>
        ) : !travelInfo ? (
          <div className="py-4 text-center text-[10px] text-mutedForeground font-heading">
            Loading travel options...
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              onClick={() => onTravel('airport')}
              disabled={loading || travelInfo.carrying_booze || (travelInfo.user_points ?? 0) < (travelInfo.airport_cost ?? 10)}
              className="w-full flex items-center justify-between bg-gradient-to-r from-primary/20 to-yellow-600/20 hover:from-primary/30 hover:to-yellow-600/30 border-2 border-primary/50 px-2 py-2 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
            >
              <span className="flex items-center gap-1.5">
                <Plane size={14} className="text-primary" />
                <span className="text-[10px] font-heading font-bold text-primary">Airport</span>
              </span>
              <span className="text-[9px] text-primary font-heading flex items-center gap-1">
                {travelInfo.airport_time > 0 ? `${travelInfo.airport_time}s` : 'Instant'} · {travelInfo.airport_cost ?? 10} pts
                {travelInfo.airports?.some((a) => a.you_own) && (
                  <span className="text-[8px] text-amber-400/90 font-normal">(5% discount)</span>
                )}
              </span>
            </button>
            
            {travelInfo.carrying_booze && (
              <p className="text-[9px] text-amber-400 font-heading">
                ⚠️ Car only while carrying booze
              </p>
            )}
            
            {/* All car options (custom + regular) sorted fastest first */}
            {(() => {
              const custom = travelInfo?.custom_car;
              const cars = travelInfo?.cars || [];
              const combined = [
                ...(custom ? [{ ...custom, travelMethod: 'custom', user_car_id: 'custom', rarity: 'custom' }] : []),
                ...cars.map(c => ({ ...c, travelMethod: c.user_car_id })),
              ].sort((a, b) => (a.travel_time ?? 999) - (b.travel_time ?? 999));
              return combined.slice(0, 5).map((item) => {
                const isCustom = item.travelMethod === 'custom';
                const glowHex = RARITY_GLOW_HEX[item.rarity] || RARITY_GLOW_HEX.common;
                const carDisabled = loading || item.can_travel === false;
                return (
                  <button
                    key={isCustom ? 'custom' : item.user_car_id}
                    onClick={() => onTravel(item.travelMethod)}
                    disabled={carDisabled}
                    style={!carDisabled ? rarityRowStyle(item.rarity) : undefined}
                    className="w-full flex items-center justify-between bg-secondary hover:bg-secondary/80 border border-border px-2 py-2 rounded transition-all disabled:opacity-50 active:scale-95 touch-manipulation"
                  >
                    <span className="flex items-center gap-1.5 min-w-0 flex-1">
                      {isCustom ? <Zap size={14} className="shrink-0" style={{ color: glowHex }} /> : <Car size={14} className="shrink-0" style={{ color: glowHex }} />}
                      <span className="text-[10px] font-heading truncate" style={{ color: glowHex }}>{item.name}</span>
                    </span>
                    <span className="text-[9px] text-mutedForeground font-heading whitespace-nowrap ml-1">
                      {item.travel_time}s
                      {item.damage_percent != null && ` · ${item.damage_percent}%`}
                    </span>
                  </button>
                );
              });
            })()}
            
            {(!travelInfo?.cars || travelInfo.cars.length === 0) && !travelInfo?.custom_car && (
              <div className="text-center py-3 text-[10px] text-mutedForeground font-heading">
                <Car size={24} className="mx-auto text-primary/30 mb-1" />
                <p>No cars available</p>
                <p className="text-[9px] mt-0.5">Steal some cars or use airport</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
  );
};

const CalcModal = ({
  isOpen,
  onClose,
  calcTarget,
  setCalcTarget,
  foundAndReady,
  calcLoading,
  calcResult,
  onCalculate
}) => {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className={`${styles.panel} border-2 border-primary/30 rounded-md shadow-2xl w-full max-w-xl max-h-[90vh] overflow-auto`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between sticky top-0">
          <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1">
            <Calculator size={14} />
            Bullet Calculator
          </h2>
          <div className="flex items-center gap-2">
            <Link
              to="/inbox?filter=attack"
              className="text-[9px] font-heading font-bold text-primary hover:text-primary/80 uppercase tracking-wide transition-colors inline-flex items-center gap-1"
            >
              <FileText size={12} />
              Witness Statements
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="text-mutedForeground hover:text-primary transition-colors p-0.5"
              aria-label="Close"
            >
              <span className="text-lg">×</span>
            </button>
          </div>
        </div>
        
        <div className="p-2 space-y-2">
          <div>
            <label className="block text-[9px] text-mutedForeground font-heading mb-0.5">
              Target Username
            </label>
            <input
              type="text"
              value={calcTarget}
              onChange={(e) => setCalcTarget(e.target.value)}
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
              placeholder="Enter username..."
              list="calc-users"
              data-testid="bullet-calc-target"
            />
            <datalist id="calc-users">
              {foundAndReady.map((a) => (
                <option key={a.attack_id} value={a.target_username} />
              ))}
            </datalist>
          </div>

          <button
            type="button"
            onClick={onCalculate}
            disabled={calcLoading || !calcTarget.trim()}
            className="w-full bg-primary/20 text-primary rounded font-heading font-bold uppercase tracking-widest py-2 text-[10px] border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
            data-testid="bullet-calc-run"
          >
            {calcLoading ? '⏳ Calculating...' : '🔢 Calculate Bullets'}
          </button>

          {calcResult && (
            <div className="bg-secondary/50 border border-border rounded overflow-hidden">
              <div className="px-2 py-1 bg-secondary/30 border-b border-border">
                <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">
                  Results
                </h3>
              </div>
              <div className="p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-mutedForeground font-heading">Bullets Required:</span>
                  <span className="text-lg font-heading font-bold text-primary tabular-nums">
                    {Number(calcResult.bullets_required || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-mutedForeground font-heading">Inflation:</span>
                  <span className="text-[11px] font-heading font-bold text-foreground">
                    {Number(calcResult.inflation_pct ?? 0)}%
                  </span>
                </div>
                {Number(calcResult.mastery_discount_pct ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-mutedForeground font-heading">Shooting range mastery:</span>
                    <span className="text-[11px] font-heading font-bold text-emerald-500">
                      -{Number(calcResult.mastery_discount_pct).toFixed(1)}% bullets
                    </span>
                  </div>
                )}
                {calcResult.loot_exclusive_weapon_bullet_discount && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-mutedForeground font-heading">Colt Monitor equipped:</span>
                    <span className="text-[11px] font-heading font-bold text-emerald-500">−25% bullets</span>
                  </div>
                )}
                <div className="pt-2 border-t border-border text-[10px] text-mutedForeground font-heading space-y-0.5">
                  <div>
                    Your Rank: <span className="text-foreground font-bold">{calcResult.attacker_rank_name}</span>
                  </div>
                  <div>
                    Your Weapon: <span className="text-foreground font-bold">{calcResult.weapon_name}</span>
                  </div>
                  <div>
                    Target Rank: <span className="text-foreground font-bold">{calcResult.target_rank_name}</span>
                  </div>
                  <div>
                    Target Armour: <span className="text-foreground font-bold">Level {calcResult.target_armour_level}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {!calcResult && (
            <p className="text-[10px] text-mutedForeground font-heading italic text-center py-3">
              💡 Enter a target username and calculate bullets needed
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

// Main component
export default function Attack() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { getAttackCaptcha, captchaModal } = useAttackTurnstile();
  const [targetUsername, setTargetUsername] = useState('');
  const [note, setNote] = useState('');
  const [attacks, setAttacks] = useState(() => readCachedAttacks());
  const [selectedAttackIds, setSelectedAttackIds] = useState([]);
  /** Kill / execute / delete / travel rows — not Find User search. */
  const [loading, setLoading] = useState(false);
  /** Find User form + hitlist auto-search + bodyguard "Search" from banner only. */
  const [searchLoading, setSearchLoading] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [show, setShow] = useState('all');
  const [targetFilter, setTargetFilter] = useState('all');
  const [favoriteTargets, setFavoriteTargets] = useState(() => readKillFavoriteMirror());
  const [robotBgAutoSearchActive, setRobotBgAutoSearchActive] = useState(false);
  const [bodyguardFindTimeActive, setBodyguardFindTimeActive] = useState(false);

  const isFavoriteTarget = useCallback(
    (a) => !!(a?.target_username && favoriteTargets.has(normKillFavUser(a.target_username))),
    [favoriteTargets],
  );

  const toggleFavorite = useCallback(async (targetUsername) => {
    const key = normKillFavUser(targetUsername);
    if (!key) return;
    let prevRef = null;
    setFavoriteTargets((p) => {
      prevRef = p;
      const optimistic = new Set(p);
      if (optimistic.has(key)) optimistic.delete(key);
      else optimistic.add(key);
      writeKillFavoriteMirror(optimistic);
      return optimistic;
    });
    try {
      const res = await api.post('/attack/favorites/toggle', { target_username: targetUsername });
      const arr = res.data?.targets;
      if (Array.isArray(arr)) {
        const synced = new Set(arr.filter((x) => typeof x === 'string'));
        setFavoriteTargets(synced);
        writeKillFavoriteMirror(synced);
      }
    } catch (e) {
      if (prevRef) {
        setFavoriteTargets(prevRef);
        writeKillFavoriteMirror(prevRef);
      }
      toast.error(getApiErrorMessage(e) || 'Could not update favorites');
    }
  }, []);

  const [killUsername, setKillUsernameState] = useState(() => {
    try {
      return sessionStorage.getItem('attack-kill-username') || '';
    } catch {
      return '';
    }
  });
  const setKillUsername = (value) => {
    setKillUsernameState(value);
    try {
      if (value != null) sessionStorage.setItem('attack-kill-username', String(value));
    } catch (_) {}
  };
  const [deathMessage, setDeathMessageState] = useState(() => {
    try {
      return sessionStorage.getItem('attack-death-message') || '';
    } catch {
      return '';
    }
  });
  const setDeathMessage = (value) => {
    setDeathMessageState(value);
    try {
      if (value != null) sessionStorage.setItem('attack-death-message', String(value));
    } catch (_) {}
  };
  const [makePublic, setMakePublicState] = useState(() => {
    try {
      return sessionStorage.getItem('attack-make-public') === '1';
    } catch {
      return false;
    }
  });
  const setMakePublic = (value) => {
    setMakePublicState(value);
    try {
      sessionStorage.setItem('attack-make-public', value ? '1' : '0');
    } catch (_) {}
  };
  const [useMolotovs, setUseMolotovsState] = useState(() => {
    try {
      const v = sessionStorage.getItem('attack-use-molotovs');
      if (v === null || v === '') return false;
      return v === '1';
    } catch {
      return false;
    }
  });
  const setUseMolotovs = (value) => {
    setUseMolotovsState(value);
    try {
      sessionStorage.setItem('attack-use-molotovs', value ? '1' : '0');
    } catch (_) {}
  };
  const [inflationPct, setInflationPct] = useState(0);
  const [inflationReset, setInflationReset] = useState(null);
  const [resetInflationBusy, setResetInflationBusy] = useState(false);
  const [slowKillInflationActive, setSlowKillInflationActive] = useState(false);
  const [bulletsToUse, setBulletsToUseState] = useState(() => {
    try {
      return sessionStorage.getItem('attack-bullets-to-use') || '';
    } catch {
      return '';
    }
  });
  const setBulletsToUse = useCallback((value) => {
    setBulletsToUseState(value);
    try {
      if (value != null) sessionStorage.setItem('attack-bullets-to-use', String(value));
    } catch (_) {}
  }, []);
  const [calcTarget, setCalcTarget] = useState('');
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcResult, setCalcResult] = useState(null);
  const [showCalcModal, setShowCalcModal] = useState(false);
  const [killBulletsResult, setKillBulletsResult] = useState(null);
  const [killBulletsLoading, setKillBulletsLoading] = useState(false);
  const [userBullets, setUserBullets] = useState(0);
  const [userMolotovs, setUserMolotovs] = useState(0);
  const [travelModalDestination, setTravelModalDestination] = useState(null);
  const [travelInfo, setTravelInfo] = useState(() => readCachedTravelInfo());
  const [travelSubmitLoading, setTravelSubmitLoading] = useState(false);
  const [travelCountdown, setTravelCountdown] = useState(null);
  /** Active timed travel from kill page: { dest, endsAtMs } */
  const [killTravelTrip, setKillTravelTrip] = useState(null);
  const [pendingResend, setPendingResend] = useState(null);
  const [killBannerMessage, setKillBannerMessage] = useState(null);

  /** Abort in-flight GET /attack/list so overlapping polls/loads cannot apply out-of-order (empty after full). */
  const attackListAbortRef = useRef(null);
  /** Last good /attack/list result. Used so a transient refresh failure does not look like "no target". */
  const attacksRef = useRef(attacks);
  /** Rotating hidden search code from GET /attack/list (anti-bot for Start Search). */
  const searchCodeRef = useRef(null);
  /** Abort in-flight kill-form bullet calc while typing. */
  const killCalcAbortRef = useRef(null);

  useEffect(() => {
    attacksRef.current = Array.isArray(attacks) ? attacks : [];
  }, [attacks]);

  const showKillResult = (text, type, options = {}) => {
    const { description, action } = options;
    setKillBannerMessage({ text, type, description, action });
  };

  const fetchBullets = async () => {
    try {
      const res = await api.get('/auth/me');
      setUserBullets(res.data?.bullets ?? 0);
      setUserMolotovs(res.data?.molotovs ?? 0);
      setSlowKillInflationActive(!!res.data?.slow_kill_inflation_active);
    } catch (e) {}
  };

  const applyInflationPayload = useCallback((data) => {
    if (!data || typeof data !== 'object') return;
    if (typeof data.inflation_pct === 'number') {
      setInflationPct(Number(data.inflation_pct));
    }
    if (
      typeof data.reset_cost_points === 'number'
      || typeof data.reset_available === 'boolean'
      || data.reset_available_at != null
      || typeof data.reset_on_cooldown === 'boolean'
    ) {
      setInflationReset({
        reset_cost_points: Number(data.reset_cost_points ?? 5000),
        reset_available: !!data.reset_available,
        reset_on_cooldown: !!data.reset_on_cooldown,
        reset_available_at: data.reset_available_at || null,
        reset_cooldown_days: Number(data.reset_cooldown_days ?? 30),
      });
    }
  }, []);

  const fetchInflation = async () => {
    try {
      const res = await api.get('/attack/inflation');
      applyInflationPayload(res.data);
    } catch (e) {}
  };

  const handleResetInflation = async () => {
    if (resetInflationBusy) return;
    const cost = inflationReset?.reset_cost_points || 5000;
    if (!window.confirm(`Reset kill inflation to 0% for ${Number(cost).toLocaleString()} points?\n\nYou can do this once every 30 days.`)) {
      return;
    }
    setResetInflationBusy(true);
    try {
      const res = await api.post('/attack/inflation/reset');
      applyInflationPayload(res.data);
      toast.success(res.data?.message || 'Kill inflation reset to 0%');
      refreshUser();
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not reset kill inflation'));
      await fetchInflation();
    } finally {
      setResetInflationBusy(false);
    }
  };

  const refreshAttacks = useCallback(async () => {
    attackListAbortRef.current?.abort();
    const ac = new AbortController();
    attackListAbortRef.current = ac;
    try {
      const response = await api.get('/attack/list', { signal: ac.signal });
      const list = response.data?.attacks || [];
      setAttacks(list);
      attacksRef.current = list;
      writeCachedAttacks(list);
      const nextSearchCode = extractSearchCodeInfo(response.data);
      if (nextSearchCode) searchCodeRef.current = nextSearchCode;
      // Inflation comes inline now (Tier 3 plan item: drop the dedicated /attack/inflation page-load call).
      if (response.data && typeof response.data.inflation_pct === 'number') {
        applyInflationPayload(response.data);
      }
      if (typeof response.data?.robot_bg_auto_search_active === 'boolean') {
        setRobotBgAutoSearchActive(response.data.robot_bg_auto_search_active);
      }
      return list;
    } catch (error) {
      const canceled =
        error?.code === 'ERR_CANCELED' ||
        error?.name === 'CanceledError' ||
        (typeof error?.message === 'string' && error.message.toLowerCase().includes('canceled'));
      if (canceled) return null;
      return Array.isArray(attacksRef.current) ? attacksRef.current : [];
    }
  }, [applyInflationPayload]);

  // Pre-fetch /travel/info shortly after the page settles so the modal opens instantly when the user clicks Travel.
  // Backed by sessionStorage cache + 30s TTL so navigation back to Kill is also instant. /travel/info is 5s
  // server-cached and no longer rate-limited so this is cheap.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      api.get('/travel/info').then((r) => {
        if (cancelled) return;
        setTravelInfo(r.data);
        writeCachedTravelInfo(r.data);
      }).catch(() => { /* non-fatal: modal will fetch on open */ });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const onRefreshAttacks = () => {
      refreshAttacks();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('app:refresh-attacks', onRefreshAttacks);
      return () => window.removeEventListener('app:refresh-attacks', onRefreshAttacks);
    }
    return undefined;
  }, [refreshAttacks]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/attack/favorites');
        const arr = res.data?.targets;
        if (cancelled || !Array.isArray(arr)) return;
        const s = new Set(arr.filter((x) => typeof x === 'string'));
        setFavoriteTargets(s);
        writeKillFavoriteMirror(s);
      } catch {
        /* keep mirror from initial read */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== _KILL_FAV_MIRROR_KEY) return;
      if (e.newValue == null) return;
      try {
        const arr = JSON.parse(e.newValue);
        if (!Array.isArray(arr)) return;
        setFavoriteTargets(new Set(arr.filter((x) => typeof x === 'string')));
      } catch {
        /* ignore */
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    }
    return undefined;
  }, []);

  useEffect(() => {
    try {
      window.localStorage?.removeItem('kill_attack_favorites_v1');
    } catch {
      /* ignore */
    }
  }, []);

  const searchCompleteTimeoutRef = useRef(null);

  // Refetch list exactly when the soonest "searching" attack is due to complete, so the UI shows "found" at the set time (e.g. 1 min on the dot)
  useEffect(() => {
    if (searchCompleteTimeoutRef.current) {
      clearTimeout(searchCompleteTimeoutRef.current);
      searchCompleteTimeoutRef.current = null;
    }
    const searching = attacks.filter((a) => a.status === 'searching' && a.found_at);
    if (searching.length === 0) return;
    let soonest = null;
    for (const a of searching) {
      const ts = new Date(a.found_at).getTime();
      if (Number.isNaN(ts)) continue;
      if (soonest === null || ts < soonest) soonest = ts;
    }
    if (soonest == null) return;
    const now = Date.now();
    const delayMs = Math.max(0, soonest - now);
    const maxDelay = 24 * 60 * 60 * 1000;
    if (delayMs > maxDelay) return;
    searchCompleteTimeoutRef.current = setTimeout(() => {
      searchCompleteTimeoutRef.current = null;
      refreshAttacks();
    }, delayMs);
    return () => {
      if (searchCompleteTimeoutRef.current) {
        clearTimeout(searchCompleteTimeoutRef.current);
        searchCompleteTimeoutRef.current = null;
      }
    };
  }, [attacks, refreshAttacks]);

  const hitlistNpcAutoFillRef = useRef(false);
  const killByUsernameInFlightRef = useRef(false);

  const withAttackCaptcha = useCallback(async (action, body) => {
    const captcha = await getAttackCaptcha(action);
    return captcha ? { ...body, ...captcha } : body;
  }, [getAttackCaptcha]);

  const withSearchCode = useCallback(async (body) => {
    let codePayload = getSearchCodePayload(searchCodeRef.current);
    if (!Object.keys(codePayload).length) {
      await refreshAttacks();
      codePayload = getSearchCodePayload(searchCodeRef.current);
    }
    return { ...body, ...codePayload };
  }, [refreshAttacks]);

  const postAttackExecute = useCallback((body) => (
    apiRequestWith429Retry(() => api.post('/attack/execute', body, { timeout: 20000 }))
  ), []);

  const showExecuteError = useCallback((error) => {
    const status = error?.response?.status;
    const transient = status === 0 || status === 502 || status === 503 || status === 504 || error?.code === 'ECONNABORTED';
    if (transient) {
      showKillResult(
        'Attack result could not be confirmed. Refreshing your searches now.',
        'warning',
        { description: getApiErrorMessage(error) || 'Check My Searches before clicking kill again.' },
      );
      refreshAttacks();
      fetchBullets();
      refreshUser();
      return;
    }
    showKillResult(getApiErrorMessage(error) || 'Failed to execute attack', 'error');
  }, [refreshAttacks]);

  const showBodyguardBlockResult = useCallback((data, fallbackMessage) => {
    const bg = data?.first_bodyguard || data;
    const message =
      stripBodyguardSlotFromToastMessage(data?.message || fallbackMessage)
      || 'Target has a bodyguard. You need to kill them first.';
    const action = bg?.search_username
      ? {
          label: 'Search',
          onClick: async () => {
            setKillBannerMessage(null);
            setSearchLoading(true);
            try {
              const note = bg.target_username ? `Bodyguard for: ${bg.target_username}` : '';
              const searchBody = await withSearchCode(
                await withAttackCaptcha('search', { target_username: bg.search_username, note }),
              );
              const res = await api.post('/attack/search', searchBody);
              toast.success(res.data?.message || 'Search started', { duration: 10000 });
              await refreshAttacks();
            } catch (err) {
              if (isAttackSearchCodeError(err)) {
                await refreshAttacks();
                toast.error('Search code refreshed. Tap Search again.', { duration: 10000 });
              } else {
                toast.error(getApiErrorMessage(err) || 'Failed to search', { duration: 10000 });
              }
            } finally {
              setSearchLoading(false);
            }
          },
        }
      : undefined;
    showKillResult(message, 'warning', action ? { action } : {});
  }, [refreshAttacks, withAttackCaptcha, withSearchCode]);

  // Hitlist board crosshair → /attack?target=… — prefill kill form and start a search (same as Find User submit)
  useEffect(() => {
    const t = searchParams.get('target');
    const isHitlistNpc = searchParams.get('hitlist_npc') === '1' || searchParams.get('hitlist_npc') === 'true';
    if (!t || typeof t !== 'string' || !t.trim()) return undefined;

    const trimmed = t.trim();
    const noteFromBoard = isHitlistNpc ? 'Hitlist NPC' : 'Hitlist';
    setTargetUsername(trimmed);
    setKillUsername(trimmed);
    if (isHitlistNpc) hitlistNpcAutoFillRef.current = true;

    const ac = new AbortController();
    let cancelled = false;
    const stripBoardQuery = () => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('target');
        next.delete('hitlist_npc');
        return next;
      }, { replace: true });
    };
    (async () => {
      try {
        setSearchLoading(true);
        try {
          sessionStorage.setItem(
            'attack-last-submit',
            JSON.stringify({ type: 'search', target_username: trimmed, note: noteFromBoard }),
          );
        } catch (_) {}
        const searchBody = await withSearchCode(
          await withAttackCaptcha('search', { target_username: trimmed, note: noteFromBoard }),
        );
        const response = await api.post('/attack/search', searchBody, { signal: ac.signal });
        if (cancelled) return;
        stripBoardQuery();
        toast.success(response.data?.message || 'Search started');
        setTargetUsername('');
        setNote('');
        window.dispatchEvent(new CustomEvent('app:refresh-attacks'));
      } catch (error) {
        if (cancelled || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
        stripBoardQuery();
        if (isAttackSearchCodeError(error)) {
          window.dispatchEvent(new CustomEvent('app:refresh-attacks'));
          toast.error('Search code refreshed. Try Start Search again.');
        } else {
          toast.error(getApiErrorMessage(error) || 'Failed to search target');
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [searchParams, setSearchParams, withAttackCaptcha, withSearchCode]);

  // Clear stored submit when leaving the page so "Kill → go to Crimes → back to Kill" never auto-sends. F5 on Attack page still resends (reload doesn't run this cleanup).
  useEffect(() => {
    return () => {
      try {
        sessionStorage.removeItem('attack-last-submit');
      } catch (_) {}
    };
  }, []);

  useEffect(() => {
    // If F5 (full page reload) with stored submit, trigger resend. Never resend when just mounting after client-side nav.
    if (!attackResendCheckDoneThisLoad) {
      attackResendCheckDoneThisLoad = true;
      const navEntry = typeof performance !== 'undefined' && performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      const isReload = navEntry && navEntry.type === 'reload';
      if (isReload) {
        try {
          const raw = sessionStorage.getItem('attack-last-submit');
          if (raw) {
            const data = JSON.parse(raw);
            if (data && (data.type === 'search' || data.type === 'kill')) {
              setPendingResend(data);
            }
          }
        } catch (_) {}
      }
    }

    const load = async () => {
      try {
        // /attack/list now returns inflation_pct inline so we drop the dedicated /attack/inflation page-load call.
        const all = await Promise.all([
          api.get('/auth/me').catch(() => ({ data: {} })),
          refreshAttacks(),
        ]);
        const meRes = all[0];
        setUserBullets(meRes.data?.bullets ?? 0);
        setUserMolotovs(meRes.data?.molotovs ?? 0);
        setBodyguardFindTimeActive(
          bodyguardFindTimePerkActive(meRes.data?.bodyguard_find_time_until, meRes.data?.bodyguard_find_time_active),
        );
        setSlowKillInflationActive(
          bodyguardFindTimePerkActive(meRes.data?.slow_kill_inflation_until, meRes.data?.slow_kill_inflation_active),
        );
      } catch (_) {
        setInflationPct(0);
        setInflationReset(null);
        setUserBullets(0);
        setUserMolotovs(0);
        await refreshAttacks();
      }
    };
    load();
    const interval = setInterval(refreshAttacks, ATTACK_LIST_POLL_MS);
    return () => {
      clearInterval(interval);
      attackListAbortRef.current?.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let timeoutId = null;
    const scheduleRefresh = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timeoutId = null;
        refreshAttacks();
      }, ATTACK_LIST_REFRESH_AFTER_USER_EVENT_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    window.addEventListener('app:refresh-user', scheduleRefresh);
    window.addEventListener('focus', scheduleRefresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('app:refresh-user', scheduleRefresh);
      window.removeEventListener('focus', scheduleRefresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshAttacks]);

  // Timed travel from kill page: tick from endsAtMs (not countdown state) so the effect
  // does not reset every second. On arrival, settle location + can_attack with retries —
  // server only applies current_state when travel_arrives_at elapses in get_current_user.
  useEffect(() => {
    if (!killTravelTrip?.endsAtMs) return;
    let cancelled = false;
    let settleTimer = null;
    let settled = false;
    const dest = killTravelTrip.dest;
    const endsAtMs = killTravelTrip.endsAtMs;

    const markArrivedLocally = (arrivedAt) => {
      refreshUser({ current_state: arrivedAt });
      setAttacks((prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((a) => {
          if (a.status !== 'found' || !a.location_state) return a;
          if (a.location_state === arrivedAt) {
            return { ...a, can_attack: true, can_travel: false };
          }
          return { ...a, can_attack: false, can_travel: true };
        });
      });
    };

    const settleArrival = async () => {
      if (cancelled || settled) return;
      settled = true;
      await new Promise((resolve) => {
        settleTimer = setTimeout(resolve, 280);
      });
      if (cancelled) return;
      setKillTravelTrip(null);
      setTravelCountdown(null);
      setTravelModalDestination(null);
      markArrivedLocally(dest);
      for (let i = 0; i < 4 && !cancelled; i += 1) {
        await refreshAttacks();
        if (cancelled) return;
        if (i < 3) {
          await new Promise((resolve) => {
            settleTimer = setTimeout(resolve, 350);
          });
        }
      }
    };

    const tick = () => {
      if (cancelled || settled) return;
      const remaining = Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000));
      if (remaining <= 0) {
        setTravelCountdown(null);
        settleArrival();
        return;
      }
      setTravelCountdown(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [killTravelTrip, refreshAttacks]);

  // Resend last submit after F5 (search or kill)
  useEffect(() => {
    if (!pendingResend) return;
    const payload = { ...pendingResend };
    setPendingResend(null);

    const run = async () => {
      if (payload.type === 'search') {
        setSearchLoading(true);
        try {
          const searchBody = await withSearchCode(
            await withAttackCaptcha('search', {
              target_username: payload.target_username || '',
              note: payload.note || '',
            }),
          );
          const response = await api.post('/attack/search', searchBody);
          toast.success(response.data?.message || 'Search started');
          await refreshAttacks();
        } catch (error) {
          if (isAttackSearchCodeError(error)) {
            await refreshAttacks();
            toast.error('Search code refreshed. Try Start Search again.');
          } else {
            toast.error(getApiErrorMessage(error) || 'Failed to search target');
          }
        } finally {
          setSearchLoading(false);
        }
        return;
      }
      if (payload.type === 'kill') {
        setLoading(true);
        try {
          let list = await refreshAttacks();
          if (!Array.isArray(list)) list = [];
          const username = (payload.killUsername || '').trim().toLowerCase();
          const found = list.filter((a) => (a.target_username || '').toLowerCase() === username && a.status === 'found');
          const best = found.find((a) => a.can_attack);
          if (!best) {
            if (found.length > 0) {
              showKillResult('You must be in the target\'s location to attack. Travel there first.', 'error');
            } else {
              showKillResult('No found target for that username. Start a search first.', 'error');
            }
            return;
          }
          const executeCode = getAttackExecuteCodePayload(best);
          const extra = {
            death_message: payload.deathMessage || null,
            make_public: payload.makePublic || false,
            bullets_to_use: payload.bulletsToUse ?? 1,
            use_molotovs: payload.useMolotovs ?? false,
            ...(executeCode || {}),
          };
          const execBody = executeCode ? extra : { attack_id: best.attack_id, ...extra };
          const securedExecBody = await withAttackCaptcha('execute', execBody);
          const execRes = await postAttackExecute(securedExecBody);
          refreshUser();
          fetchBullets();
          // Background refresh — the result toast/feedback below doesn't need the latest list.
          refreshAttacks();
          if (execRes.data?.success) {
            const rewardMoney = execRes.data.rewards?.money;
            showKillResult(execRes.data?.message || 'Kill executed.', 'success', {
              description: rewardMoney != null ? `Rewards: $${Number(rewardMoney).toLocaleString()}` : undefined,
            });
          } else if (execRes.data?.first_bodyguard) {
            showBodyguardBlockResult(execRes.data, 'Target has a bodyguard.');
          } else {
            showKillResult(execRes.data?.message || 'Kill failed.', 'error');
          }
        } catch (error) {
          showExecuteError(error);
        } finally {
          setLoading(false);
        }
      }
    };
    run();
  }, [pendingResend, withAttackCaptcha, withSearchCode, showBodyguardBlockResult]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSelected = (attackId) => {
    setSelectedAttackIds((prev) => (
      prev.includes(attackId) ? prev.filter((x) => x !== attackId) : [...prev, attackId]
    ));
  };

  const toggleSelectAllFiltered = (ids) => {
    setSelectedAttackIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((x) => !ids.includes(x));
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const deleteSelected = async () => {
    const toDelete = selectedAttackIds.filter(Boolean);
    if (toDelete.length === 0) return;
    setLoading(true);
    try {
      const res = await api.post('/attack/delete', { attack_ids: toDelete });
      toast.success(res.data?.message || `Deleted ${toDelete.length} search(es)`);
      setSelectedAttackIds([]);
      await refreshAttacks();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete searches');
    } finally {
      setLoading(false);
    }
  };

  const searchTarget = async (e) => {
    e.preventDefault();
    setSearchLoading(true);
    const target = (targetUsername || '').trim();
    const noteVal = (note || '').trim();
    try {
      try {
        sessionStorage.setItem('attack-last-submit', JSON.stringify({ type: 'search', target_username: target, note: noteVal }));
      } catch (_) {}
      const searchBody = await withSearchCode(
        await withAttackCaptcha('search', { target_username: target, note: noteVal }),
      );
      const response = await api.post('/attack/search', searchBody);
      toast.success(response.data.message);
      setTargetUsername('');
      setNote('');
      await refreshAttacks();
    } catch (error) {
      if (isAttackSearchCodeError(error)) {
        await refreshAttacks();
        toast.error('Search code refreshed. Click Start Search again.');
      } else {
        toast.error(getApiErrorMessage(error) || 'Failed to search target');
      }
    } finally {
      setSearchLoading(false);
    }
  };

  const openTravelModal = (locationState) => {
    setTravelModalDestination(locationState || null);
    // Don't clear travelInfo: showing slightly-stale options instantly is far better UX than
    // forcing "Loading travel options..." for a 1-2s round-trip every time. We refresh in the background.
    if (locationState) {
      api.get('/travel/info').then((r) => {
        setTravelInfo(r.data);
        writeCachedTravelInfo(r.data);
      }).catch(() => { /* keep prior cached travelInfo on error */ });
    }
  };

  const handleTravelFromModal = async (method) => {
    if (!travelModalDestination) return;
    const dest = travelModalDestination;
    setTravelSubmitLoading(true);
    try {
      const response = await api.post('/travel', {
        destination: dest,
        travel_method: method,
        ...getTravelCodePayload(travelInfo),
      });
      const travelTime = Number(response.data?.travel_time ?? 0);
      if (travelTime <= 0) {
        const arrived = (response.data?.current_state || dest || '').trim() || dest;
        toast.success(response.data?.message || `Traveled to ${arrived}`);
        setTravelModalDestination(null);
        setKillTravelTrip(null);
        setTravelCountdown(null);
        refreshUser({ current_state: arrived });
        setAttacks((prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((a) => {
            if (a.status !== 'found' || !a.location_state) return a;
            if (a.location_state === arrived) {
              return { ...a, can_attack: true, can_travel: false };
            }
            return { ...a, can_attack: false, can_travel: true };
          });
        });
        await refreshAttacks();
      } else {
        toast.success(response.data?.message || `Traveling to ${dest}`);
        const arrivesRaw = response.data?.travel_arrives_at;
        let endsAtMs = arrivesRaw ? Date.parse(arrivesRaw) : NaN;
        if (!Number.isFinite(endsAtMs)) {
          endsAtMs = Date.now() + Math.max(1, travelTime) * 1000;
        }
        const arrivesIso = Number.isFinite(Date.parse(arrivesRaw))
          ? arrivesRaw
          : new Date(endsAtMs).toISOString();
        setKillTravelTrip({ dest, endsAtMs });
        setTravelCountdown(Math.max(1, Math.ceil((endsAtMs - Date.now()) / 1000)));
        refreshUser({ traveling_to: dest, travel_arrives_at: arrivesIso });
        refreshAttacks();
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      toast.error((detail && typeof detail === 'object' ? detail.detail : detail) || 'Travel failed');
    } finally {
      setTravelSubmitLoading(false);
    }
  };

  const executeAttack = async (attackId, extra = null) => {
    setLoading(true);
    try {
      const buildPayload = (payloadExtra) => {
        const tok = payloadExtra && typeof payloadExtra.execute_token === 'string' ? payloadExtra.execute_token.trim() : '';
        const hasRotatingCode = payloadExtra && Object.entries(payloadExtra).some(([k, v]) => (
          typeof k === 'string'
          && k.startsWith('kc_')
          && typeof v === 'string'
          && v.trim().length >= 16
        ));
        return tok.length >= 16 || hasRotatingCode
          ? { ...payloadExtra }
          : payloadExtra
            ? { attack_id: attackId, ...payloadExtra }
            : { attack_id: attackId };
      };
      const sendExecute = async (payloadExtra) => {
        const securedPayload = await withAttackCaptcha('execute', buildPayload(payloadExtra));
        return postAttackExecute(securedPayload);
      };
      let response;
      try {
        response = await sendExecute(extra);
      } catch (error) {
        if (!isAttackExecuteCodeError(error)) throw error;
        await refreshAttacks();
        showKillResult(
          'Kill code refreshed. Click Kill again.',
          'warning',
          { description: 'The hidden kill code changed while you were on the page. Nothing was retried automatically.' },
        );
        return;
      }
      setLoading(false);
      if (response.data.success) {
        const rewardMoney = response.data.rewards?.money;
        showKillResult(response.data.message, 'success', {
          description: rewardMoney != null ? `Rewards: $${Number(rewardMoney).toLocaleString()}` : undefined,
        });
      } else if (response.data.first_bodyguard) {
        showBodyguardBlockResult(response.data, 'Target has a bodyguard.');
      } else {
        showKillResult(response.data.message, 'error');
      }
      refreshUser();
      fetchBullets();
      // Refresh in the background — toast already fired, no need to keep the button busy
      // for another /attack/list round-trip (which can be 0.5-1.5s under load).
      refreshAttacks();
    } catch (error) {
      showExecuteError(error);
    } finally {
      setLoading(false);
    }
  };

  const killByUsername = async () => {
    // Silent in-flight guard: blocks double-fires on the same click without disabling/relabelling
    // the button. The user dislikes any "killing..." indicator — we rely on the toast for feedback
    // and the server-side micro-cooldown for spam protection.
    if (killByUsernameInFlightRef.current) return;
    killByUsernameInFlightRef.current = true;
    try {
      const username = (killUsername || '').trim();
      if (!username) {
        showKillResult('Enter a username', 'error');
        return;
      }

      // Use the cached attacks list directly. Polling already keeps it fresh on a 10s loop, and
      // forcing a /attack/list round-trip here just adds 0.5-1.5s of perceived latency under load
      // for cases where the result wouldn't have changed (still searching, wrong location, etc.).
      const list = Array.isArray(attacks) ? attacks : [];
      const found = list.filter((a) => (a.target_username || '').toLowerCase() === username.toLowerCase() && a.status === 'found');
      const best = found.find((a) => a.can_attack);

      if (!best) {
        if (found.length > 0) {
          showKillResult('You must be in the target\'s location to attack or bodyguard-check. Travel there first.', 'error');
          return;
        }
        const alreadySearching = list.some(
          (a) => (a.target_username || '').toLowerCase() === username.toLowerCase() && a.status === 'searching'
        );
        if (alreadySearching) {
          showKillResult('A search is already in progress for this target. Wait for it to finish.', 'error');
        } else {
          showKillResult('Target not found. Use "Find User" to search for them first.', 'error');
        }
        return;
      }

      const bulletNum = bulletsToUse !== "" && bulletsToUse != null ? parseInt(bulletsToUse, 10) : NaN;
      if (Number.isNaN(bulletNum) || bulletNum < 1) {
        showKillResult('Enter how many bullets to use (at least 1).', 'error');
        return;
      }
      const extra = {
        death_message: deathMessage,
        make_public: makePublic,
        bullets_to_use: bulletNum,
        use_molotovs: useMolotovs,
        ...(getAttackExecuteCodePayload(best) || {}),
      };
      if (best.first_bodyguard) {
        const bg = best.first_bodyguard;
        const protectedName = bg.target_username || best.target_username || username;
        const fallbackMessage = bg.search_username
          ? `${protectedName} has a bodyguard called ${bg.display_name || bg.search_username}. You need to kill them first.`
          : `${protectedName} has a bodyguard. You need to kill them first.`;
        showBodyguardBlockResult({ message: fallbackMessage, first_bodyguard: bg }, fallbackMessage);
      }
      try {
        sessionStorage.setItem('attack-last-submit', JSON.stringify({
          type: 'kill',
          killUsername: username,
          bulletsToUse: bulletNum,
          deathMessage,
          makePublic,
          useMolotovs,
        }));
      } catch (_) {}
      await executeAttack(best.attack_id, extra);
      // Inflation is part of /attack/list now (returned inline) — refresh in the background.
      fetchInflation();
    } finally {
      killByUsernameInFlightRef.current = false;
    }
  };

  const runCalc = async () => {
    const username = (calcTarget || '').trim();
    if (!username) {
      toast.error('Enter a target username');
      return;
    }
    setCalcLoading(true);
    try {
      const res = await api.post('/attack/bullets/calc', { target_username: username });
      setCalcResult({
        ...res.data,
        bullets_required: clampBulletsRequired(res.data?.bullets_required),
      });
    } catch (error) {
      setCalcResult(null);
      toast.error(error.response?.data?.detail || 'Failed to calculate bullets');
    } finally {
      setCalcLoading(false);
    }
  };

  // Debounced fetch of bullets needed to kill the user in the kill form
  useEffect(() => {
    const trimmed = (killUsername || '').trim();
    killCalcAbortRef.current?.abort();
    if (!trimmed) {
      setKillBulletsResult(null);
      setKillBulletsLoading(false);
      return;
    }
    setKillBulletsLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const ac = new AbortController();
      killCalcAbortRef.current = ac;
      try {
        const res = await api.post(
          '/attack/bullets/calc',
          { target_username: trimmed, soft_fail: true },
          { signal: ac.signal },
        );
        if (cancelled) return;
        if (res.data?.calc_ok === false) {
          setKillBulletsResult(null);
          return;
        }
        const result = {
          username: res.data.target_username ?? trimmed,
          bullets: clampBulletsRequired(res.data?.bullets_required),
          isNpc: res.data.target_is_npc === true,
        };
        setKillBulletsResult(result);
        // NPC targets: auto-fill bullets needed in the form.
        if (result.isNpc && result.bullets > 0) {
          setBulletsToUse(String(result.bullets));
        }
        // Hitlist NPC link: keep one-time behavior for direct board links as fallback.
        if (hitlistNpcAutoFillRef.current && result.bullets > 0) {
          hitlistNpcAutoFillRef.current = false;
          setBulletsToUse(String(result.bullets));
        }
      } catch (error) {
        const canceled =
          error?.code === 'ERR_CANCELED'
          || error?.name === 'CanceledError'
          || (typeof error?.message === 'string' && error.message.toLowerCase().includes('canceled'));
        if (canceled) return;
        setKillBulletsResult(null);
      } finally {
        if (!cancelled) setKillBulletsLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      killCalcAbortRef.current?.abort();
    };
  }, [killUsername, setBulletsToUse]);

  // Convenience: if molotov mode is on and molotovs alone can cover the kill requirement,
  // auto-set bullets input to 1 so the attack still includes a minimal bullet amount.
  useEffect(() => {
    const needed = Number(killBulletsResult?.bullets || 0);
    if (!useMolotovs || needed < 1) return;
    const molotovs = Number(userMolotovs || 0);
    const canCoverWithMolotovs = (molotovs * MOLOTOV_BULLET_EQUIV) >= needed;
    if (!canCoverWithMolotovs) return;
    if (String(bulletsToUse || '').trim() !== '1') {
      setBulletsToUse('1');
    }
  }, [useMolotovs, killBulletsResult?.bullets, userMolotovs, bulletsToUse, setBulletsToUse]);

  const foundAndReady = useMemo(() => attacks.filter((a) => a.status === 'found'), [attacks]);
  
  const filteredAttacks = useMemo(() => {
    const t = filterText.trim().toLowerCase();
    const list = attacks
      .filter((a) => {
        if (show === 'all') return true;
        if (show === 'favorites') {
          return !!(a.target_username && favoriteTargets.has(normKillFavUser(a.target_username)));
        }
        return a.status === show;
      })
      .filter((a) => {
        if (targetFilter === 'all') return true;
        const isRobot = a.target_is_robot_bodyguard === true;
        if (targetFilter === 'robot') return isRobot;
        return !isRobot;
      })
      .filter((a) => {
        if (!t) return true;
        const hay = `${a.target_username || ''} ${a.note || ''}`.toLowerCase();
        return hay.includes(t);
      });
    const fav = [];
    const rest = [];
    for (const a of list) {
      if (a.target_username && favoriteTargets.has(normKillFavUser(a.target_username))) fav.push(a);
      else rest.push(a);
    }
    return [...fav, ...rest];
  }, [attacks, filterText, show, targetFilter, favoriteTargets]);

  const filteredIds = useMemo(() => filteredAttacks.map((a) => a.attack_id), [filteredAttacks]);

  const selectedAttackIdSet = useMemo(() => new Set(selectedAttackIds), [selectedAttackIds]);
  const allFilteredSelected = useMemo(
    () => filteredIds.length > 0 && filteredIds.every((id) => selectedAttackIdSet.has(id)),
    [filteredIds, selectedAttackIdSet]
  );

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="attack-page">
      <style>{ATTACK_STYLES}</style>
      {captchaModal}

      <p className="text-[9px] text-zinc-500 font-heading italic">Search, travel, and strike. No witnesses, no mercy.</p>

      {killBannerMessage && (
        <KillNotificationBanner
          message={killBannerMessage}
          onDismiss={() => setKillBannerMessage(null)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <div className="space-y-2">
          <KillUserCard
            killUsername={killUsername}
            setKillUsername={setKillUsername}
            bulletsToUse={bulletsToUse}
            setBulletsToUse={setBulletsToUse}
            deathMessage={deathMessage}
            setDeathMessage={setDeathMessage}
            makePublic={makePublic}
            setMakePublic={setMakePublic}
            useMolotovs={useMolotovs}
            setUseMolotovs={setUseMolotovs}
            inflationPct={inflationPct}
            inflationReset={inflationReset}
            onResetInflation={handleResetInflation}
            resetInflationBusy={resetInflationBusy}
            slowKillInflationActive={slowKillInflationActive}
            userBullets={userBullets}
            userMolotovs={userMolotovs}
            foundAndReady={foundAndReady}
            onKill={killByUsername}
            onOpenCalc={() => setShowCalcModal(true)}
            bulletsNeededForKill={killBulletsResult}
            bulletsNeededLoading={killBulletsLoading}
          />

          <FindUserCard
            targetUsername={targetUsername}
            setTargetUsername={setTargetUsername}
            note={note}
            setNote={setNote}
            loading={searchLoading}
            onSearch={searchTarget}
          />
        </div>

        {/* Right Column */}
        <SearchesCard
          attacks={filteredAttacks}
          filterText={filterText}
          setFilterText={setFilterText}
          show={show}
          setShow={setShow}
          targetFilter={targetFilter}
          setTargetFilter={setTargetFilter}
          isFavoriteTarget={isFavoriteTarget}
          toggleFavorite={toggleFavorite}
          favoriteCount={favoriteTargets.size}
          selectedAttackIds={selectedAttackIds}
          toggleSelected={toggleSelected}
          toggleSelectAll={() => toggleSelectAllFiltered(filteredIds)}
          allSelected={allFilteredSelected}
          loading={loading}
          travelBusy={travelSubmitLoading || killTravelTrip != null}
          onDelete={deleteSelected}
          onTravel={openTravelModal}
          onFillKillTarget={setKillUsername}
          robotBgAutoSearchActive={robotBgAutoSearchActive}
          bodyguardFindTimeActive={bodyguardFindTimeActive}
        />
      </div>

      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 atk-card atk-fade-in mobile-panel`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Combat timeline</p>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">
              Detailed combat logs moved to their own page to keep Attack fast.
            </p>
          </div>
          <Link
            to="/kill/combat-timeline"
            className="px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary text-[9px] font-heading font-bold uppercase tracking-wider hover:bg-primary/20"
          >
            Open timeline
          </Link>
        </div>
        <div className="atk-art-line text-primary mx-2.5" />
      </div>

      {travelModalDestination && (
        <TravelModal
          destination={travelModalDestination}
          onClose={() => setTravelModalDestination(null)}
          travelInfo={travelInfo}
          loading={travelSubmitLoading}
          countdown={travelCountdown}
          onTravel={handleTravelFromModal}
        />
      )}

      <CalcModal
        isOpen={showCalcModal}
        onClose={() => setShowCalcModal(false)}
        calcTarget={calcTarget}
        setCalcTarget={setCalcTarget}
        foundAndReady={foundAndReady}
        calcLoading={calcLoading}
        calcResult={calcResult}
        onCalculate={runCalc}
      />
    </div>
  );
}
