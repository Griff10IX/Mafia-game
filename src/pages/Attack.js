import { useMemo, useState, useEffect } from 'react';
import { Search, Plane, Car, Crosshair, Clock, MapPin, Skull, Calculator, Zap, FileText, Users } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const ATTACK_STYLES = `
  @keyframes atk-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .atk-fade-in { animation: atk-fade-in 0.4s ease-out both; }
  @keyframes atk-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .atk-scale-in { animation: atk-scale-in 0.35s ease-out both; }
  @keyframes atk-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .atk-glow { animation: atk-glow 4s ease-in-out infinite; }
  .atk-corner::before, .atk-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .atk-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .atk-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .atk-card { transition: all 0.3s ease; }
  .atk-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .atk-row { transition: all 0.2s ease; }
  .atk-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .atk-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

// Shown in toast when caught during booze run (prohibition bust)
const BOOZE_CAUGHT_IMAGE = 'https://historicipswich.net/wp-content/uploads/2021/12/0a79f-boston-rum-prohibition1.jpg';

// Subcomponents
const LoadingSpinner = () => (
  <div className={`space-y-4 ${styles.pageContent}`}>
    <style>{ATTACK_STYLES}</style>
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <Crosshair size={28} className="text-primary/40 animate-pulse" />
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading attack...</span>
    </div>
  </div>
);

const EventBanner = ({ event }) => (
  <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 atk-fade-in`}>
    <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
        🎯 Today's Event
      </h2>
    </div>
    <div className="p-4">
      <p className="text-base font-heading font-bold text-primary mb-1">{event.name}</p>
      <p className="text-sm text-mutedForeground font-heading">{event.message}</p>
    </div>
    <div className="atk-art-line text-primary mx-4" />
  </div>
);

const KillUserCard = ({
  killUsername,
  setKillUsername,
  bulletsToUse,
  setBulletsToUse,
  deathMessage,
  setDeathMessage,
  makePublic,
  setMakePublic,
  inflationPct,
  userBullets,
  foundAndReady,
  loading,
  onKill,
  onOpenCalc
}) => (
  <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 atk-card atk-corner atk-fade-in`}>
    <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl pointer-events-none atk-glow" />
    <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-2">
        <Skull size={16} />
        Kill User
      </h2>
      <button
        type="button"
        className="text-xs uppercase tracking-wider text-primary hover:text-primary/80 font-heading inline-flex items-center gap-1.5 transition-colors"
        onClick={onOpenCalc}
      >
        <Calculator size={14} />
        Calculator
      </button>
    </div>
    <div className="p-4 space-y-3">
      <div>
        <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1.5">
          Username
        </label>
        <input
          type="text"
          value={killUsername}
          onChange={(e) => setKillUsername(e.target.value)}
          className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
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
      
      <div>
        <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1.5">
          Bullets <span className="text-primary">({Number(userBullets).toLocaleString()} available)</span>
        </label>
        <input
          type="number"
          value={bulletsToUse}
          onChange={(e) => setBulletsToUse(e.target.value)}
          className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
          placeholder="Enter amount (min 1)"
          min="1"
          data-testid="kill-bullets-inline"
        />
      </div>
      
      <div>
        <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1.5">
          Death Message (Optional)
        </label>
        <textarea
          value={deathMessage}
          onChange={(e) => setDeathMessage(e.target.value)}
          className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none resize-y transition-colors"
          placeholder="Leave a message..."
          rows={3}
          data-testid="kill-death-message-inline"
        />
      </div>
      
      <div className="flex items-center justify-between bg-secondary/50 border border-border rounded-md px-4 py-3">
        <div className="text-sm text-mutedForeground font-heading">
          Inflation: <span className="text-foreground font-bold">{inflationPct}%</span>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-foreground font-heading cursor-pointer">
          <input 
            type="checkbox" 
            checked={makePublic} 
            onChange={(e) => setMakePublic(e.target.checked)} 
            className="w-4 h-4 accent-primary cursor-pointer" 
            data-testid="kill-make-public-inline" 
          />
          <span>Make Public</span>
        </label>
      </div>
      
      <button
        type="button"
        disabled={loading || !killUsername.trim() || !bulletsToUse.trim() || parseInt(bulletsToUse, 10) < 1}
        onClick={onKill}
        className="w-full bg-gradient-to-r from-red-700 via-red-800 to-red-900 hover:from-red-600 hover:via-red-700 hover:to-red-800 text-white rounded-lg font-heading font-bold uppercase tracking-widest py-3 text-sm border-2 border-red-600/50 shadow-lg shadow-red-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
        data-testid="kill-inline-button"
      >
        {loading ? '⏳ Executing...' : '💀 Kill User'}
      </button>
      
      <p className="text-xs text-mutedForeground font-heading italic">
        💡 Tip: Starts a search if target not found. Travel to target location before killing.
      </p>
    </div>
    <div className="atk-art-line text-primary mx-4" />
  </div>
);

const FindUserCard = ({
  targetUsername,
  setTargetUsername,
  note,
  setNote,
  loading,
  onSearch
}) => (
  <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 atk-card atk-corner atk-fade-in`} style={{ animationDelay: '0.05s' }}>
    <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl pointer-events-none atk-glow" />
    <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-2">
        <Search size={16} />
        Find User
      </h2>
    </div>
    <form onSubmit={onSearch} className="p-4 space-y-3">
      <div>
        <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1.5">
          Username
        </label>
        <input
          type="text"
          value={targetUsername}
          onChange={(e) => setTargetUsername(e.target.value)}
          className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
          placeholder="Enter username..."
          required
          data-testid="target-username-input"
        />
      </div>
      
      <div>
        <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1.5">
          Note (Optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
          placeholder="E.g. rival, bounty, etc."
          data-testid="target-note-input"
        />
      </div>
      
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-lg font-heading font-bold uppercase tracking-widest py-3 text-sm shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
        data-testid="search-target-button"
      >
        {loading ? '⏳ Searching...' : '🔍 Start Search'}
      </button>
      
      <p className="text-xs text-mutedForeground font-heading italic">
        💡 Tip: Searches take time. Track progress in "My Searches" below.
      </p>
    </form>
    <div className="atk-art-line text-primary mx-4" />
  </div>
);

const SearchesCard = ({
  attacks,
  filterText,
  setFilterText,
  show,
  setShow,
  selectedAttackIds,
  toggleSelected,
  toggleSelectAll,
  allSelected,
  loading,
  onDelete,
  onTravel,
  onAttack,
  onFillKillTarget
}) => {
  return (
    <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 atk-card atk-corner atk-fade-in`} style={{ animationDelay: '0.1s' }}>
      <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl pointer-events-none atk-glow" />
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-2">
          <Users size={16} />
          My Searches ({attacks.length})
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-mutedForeground font-heading">Show:</span>
          <select
            value={show}
            onChange={(e) => setShow(e.target.value)}
            className="bg-secondary border border-border rounded-md px-2 py-1 text-xs font-heading text-foreground focus:border-primary/50 focus:outline-none"
            data-testid="attack-show-filter"
          >
            <option value="all">All</option>
            <option value="searching">Searching</option>
            <option value="found">Found</option>
          </select>
        </div>
      </div>
      
      <div className="p-4 space-y-3">
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
          placeholder="Filter by username or note..."
          data-testid="attack-filter-input"
        />

        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-mutedForeground font-heading cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 accent-primary cursor-pointer"
              data-testid="attack-select-all"
            />
            Select all
          </label>
          <button
            type="button"
            disabled={loading || selectedAttackIds.length === 0}
            onClick={onDelete}
            className="px-3 py-1.5 rounded-md bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 text-xs font-heading font-bold uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            data-testid="attack-delete-selected"
          >
            🗑️ Delete ({selectedAttackIds.length})
          </button>
        </div>

        {attacks.length === 0 ? (
          <div className="py-12 text-center">
            <Search size={48} className="mx-auto text-primary/30 mb-3" />
            <p className="text-sm text-mutedForeground font-heading">No active searches</p>
            <p className="text-xs text-mutedForeground font-heading mt-1">Start a search above to track targets</p>
          </div>
        ) : (
          <>
            {/* Desktop: Table */}
            <div className="hidden md:block border border-zinc-700/40 rounded-lg overflow-hidden">
              <div className="grid grid-cols-12 bg-zinc-800/50 text-[9px] uppercase tracking-[0.12em] font-heading text-zinc-500 px-4 py-2 border-b border-zinc-700/40">
                <div className="col-span-1"></div>
                <div className="col-span-4">User / Note</div>
                <div className="col-span-3">Location</div>
                <div className="col-span-4 text-right">Expires</div>
              </div>
              
              <div className="divide-y divide-zinc-700/30">
                {attacks.map((a) => (
                  <div key={a.attack_id} className="atk-row grid grid-cols-12 px-4 py-3 items-start gap-3">
                    <div className="col-span-1 pt-1">
                      <input
                        type="checkbox"
                        checked={selectedAttackIds.includes(a.attack_id)}
                        onChange={() => toggleSelected(a.attack_id)}
                        className="w-4 h-4 accent-primary cursor-pointer"
                        data-testid={`attack-select-${a.attack_id}`}
                      />
                    </div>

                    <div className="col-span-4 min-w-0">
                      <Link
                        to={`/profile/${encodeURIComponent(a.target_username)}`}
                        className="font-heading font-bold text-foreground hover:text-primary transition-colors block text-sm truncate"
                        data-testid={`attack-user-${a.attack_id}`}
                      >
                        {a.target_username}
                      </Link>
                      {a.note && (
                        <div className="text-xs text-mutedForeground truncate font-heading mt-0.5">
                          {a.note}
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
                        <span className={`px-2 py-0.5 rounded-md font-heading font-bold uppercase ${
                          a.status === 'searching' 
                            ? 'bg-secondary text-mutedForeground border border-border' 
                            : 'bg-primary/20 text-primary border border-primary/30'
                        }`}>
                          {a.status}
                        </span>
                        {a.can_travel && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => onTravel(a.location_state)}
                            className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-heading font-bold transition-colors disabled:opacity-50"
                            data-testid={`attack-travel-${a.attack_id}`}
                          >
                            <Plane size={12} />
                            Travel
                          </button>
                        )}
                        {a.can_attack && onFillKillTarget && (
                          <button
                            type="button"
                            onClick={() => onFillKillTarget(a.target_username)}
                            className="inline-flex items-center gap-1 text-red-400 hover:text-red-300 font-heading font-bold transition-colors disabled:opacity-50"
                            data-testid={`attack-kill-${a.attack_id}`}
                            title="Fill username into Kill User form"
                          >
                            <Crosshair size={12} />
                            Kill
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="col-span-3 text-sm text-mutedForeground font-heading">
                      {a.status === 'found' && a.location_state ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin size={14} className="text-primary" />
                          <span className="text-foreground">{a.location_state}</span>
                        </span>
                      ) : (
                        <span className="text-mutedForeground/60">Searching...</span>
                      )}
                    </div>

                    <div className="col-span-4 text-right text-xs text-mutedForeground font-heading">
                      <span className="inline-flex items-center gap-1.5 justify-end">
                        <Clock size={14} />
                        {formatDateTime(a.expires_at || a.search_started)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile: Cards */}
            <div className="md:hidden space-y-3">
              {attacks.map((a) => (
                <div key={a.attack_id} className="atk-row bg-zinc-800/30 rounded-lg p-4 border border-zinc-700/30 space-y-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedAttackIds.includes(a.attack_id)}
                      onChange={() => toggleSelected(a.attack_id)}
                      className="w-4 h-4 accent-primary cursor-pointer mt-1"
                      data-testid={`attack-select-${a.attack_id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/profile/${encodeURIComponent(a.target_username)}`}
                        className="font-heading font-bold text-foreground hover:text-primary transition-colors block text-base truncate"
                      >
                        {a.target_username}
                      </Link>
                      {a.note && (
                        <div className="text-sm text-mutedForeground font-heading mt-0.5">
                          {a.note}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-1 rounded-md text-xs font-heading font-bold uppercase ${
                      a.status === 'searching' 
                        ? 'bg-secondary text-mutedForeground border border-border' 
                        : 'bg-primary/20 text-primary border border-primary/30'
                    }`}>
                      {a.status}
                    </span>
                    
                    {a.status === 'found' && a.location_state && (
                      <span className="inline-flex items-center gap-1 text-sm text-foreground font-heading">
                        <MapPin size={14} className="text-primary" />
                        {a.location_state}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {a.can_travel && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => onTravel(a.location_state)}
                        className="flex-1 bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 rounded-md px-3 py-2 text-sm font-heading font-bold uppercase transition-all disabled:opacity-50 active:scale-95 touch-manipulation inline-flex items-center justify-center gap-1.5"
                      >
                        <Plane size={14} />
                        Travel
                      </button>
                    )}
                    {a.can_attack && onFillKillTarget && (
                      <button
                        type="button"
                        onClick={() => onFillKillTarget(a.target_username)}
                        className="flex-1 bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 rounded-md px-3 py-2 text-sm font-heading font-bold uppercase transition-all disabled:opacity-50 active:scale-95 touch-manipulation inline-flex items-center justify-center gap-1.5"
                        title="Fill username into Kill User form"
                      >
                        <Crosshair size={14} />
                        Kill
                      </button>
                    )}
                  </div>

                  <div className="text-xs text-mutedForeground font-heading flex items-center gap-1.5">
                    <Clock size={12} />
                    Expires: {formatDateTime(a.expires_at || a.search_started)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        
        {attacks.length > 0 && (
          <p className="text-xs text-mutedForeground font-heading italic pt-2">
            💡 Searches complete automatically. Location revealed when target is found.
          </p>
        )}
      </div>
      <div className="atk-art-line text-primary mx-4" />
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
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
    <div className={`${styles.panel} border-2 border-primary/30 rounded-lg shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden`}>
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-4 md:px-6 py-4 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-2">
          <MapPin size={18} />
          Travel to {destination}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-mutedForeground hover:text-primary transition-colors p-1"
          aria-label="Close"
        >
          <span className="text-xl">×</span>
        </button>
      </div>
      
      <div className="p-4 md:p-6">
        {countdown != null && countdown > 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">🚗</div>
            <p className="text-base font-heading font-bold text-primary mb-2">
              Traveling to {destination}...
            </p>
            <p className="text-4xl font-heading font-bold text-foreground tabular-nums">
              {countdown}s
            </p>
          </div>
        ) : !travelInfo ? (
          <div className="py-8 text-center text-sm text-mutedForeground font-heading">
            Loading travel options...
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={() => onTravel('airport')}
              disabled={loading || travelInfo.carrying_booze || (travelInfo.user_points ?? 0) < (travelInfo.airport_cost ?? 10)}
              className="w-full flex items-center justify-between bg-gradient-to-r from-primary/20 to-yellow-600/20 hover:from-primary/30 hover:to-yellow-600/30 border-2 border-primary/50 px-4 py-3 rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
            >
              <span className="flex items-center gap-2">
                <Plane size={18} className="text-primary" />
                <span className="text-sm font-heading font-bold text-primary">Airport</span>
              </span>
              <span className="text-xs text-primary font-heading flex items-center gap-1.5">
                {travelInfo.airport_time > 0 ? `${travelInfo.airport_time}s` : 'Instant'} · {travelInfo.airport_cost ?? 10} pts
                {travelInfo.airports?.some((a) => a.you_own) && (
                  <span className="text-[10px] text-amber-400/90 font-normal">(5% owner discount)</span>
                )}
              </span>
            </button>
            
            {travelInfo.carrying_booze && (
              <p className="text-xs text-amber-400 font-heading">
                ⚠️ Car only while carrying booze
              </p>
            )}
            
            {travelInfo?.custom_car && (
              <button
                onClick={() => onTravel('custom')}
                disabled={loading}
                className="w-full flex items-center justify-between bg-secondary hover:bg-secondary/80 border border-border hover:border-primary/30 px-4 py-3 rounded-md transition-all disabled:opacity-50 active:scale-95 touch-manipulation"
              >
                <span className="flex items-center gap-2">
                  <Zap size={18} className="text-primary" />
                  <span className="text-sm font-heading font-bold text-foreground">{travelInfo.custom_car.name}</span>
                </span>
                <span className="text-xs text-mutedForeground font-heading">
                  {travelInfo.custom_car.travel_time}s
                </span>
              </button>
            )}
            
            {(travelInfo?.cars || []).slice(0, 3).map((car) => (
              <button
                key={car.user_car_id}
                onClick={() => onTravel(car.user_car_id)}
                disabled={loading}
                className="w-full flex items-center justify-between bg-secondary hover:bg-secondary/80 border border-border hover:border-primary/30 px-4 py-3 rounded-md transition-all disabled:opacity-50 active:scale-95 touch-manipulation"
              >
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  <Car size={18} className="text-primary shrink-0" />
                  <span className="text-sm font-heading truncate text-foreground">{car.name}</span>
                </span>
                <span className="text-xs text-mutedForeground font-heading whitespace-nowrap ml-2">
                  {car.travel_time}s
                </span>
              </button>
            ))}
            
            {(!travelInfo?.cars || travelInfo.cars.length === 0) && !travelInfo?.custom_car && (
              <div className="text-center py-4 text-sm text-mutedForeground font-heading">
                <Car size={32} className="mx-auto text-primary/30 mb-2" />
                <p>No cars available</p>
                <p className="text-xs mt-1">Steal some cars or use airport</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
);

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
      <div className={`${styles.panel} border-2 border-primary/30 rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] overflow-auto`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-4 md:px-6 py-4 bg-primary/8 border-b border-primary/20 flex items-center justify-between sticky top-0">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-2">
            <Calculator size={18} />
            Bullet Calculator
          </h2>
          <div className="flex items-center gap-3">
            <Link
              to="/inbox?filter=attack"
              className="text-xs font-heading font-bold text-primary hover:text-primary/80 uppercase tracking-wide transition-colors inline-flex items-center gap-1.5"
            >
              <FileText size={14} />
              Witness Statements
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="text-mutedForeground hover:text-primary transition-colors p-1"
              aria-label="Close"
            >
              <span className="text-xl">×</span>
            </button>
          </div>
        </div>
        
        <div className="p-4 md:p-6 space-y-4">
          <div>
            <label className="block text-sm text-mutedForeground font-heading mb-2">
              Target Username
            </label>
            <input
              type="text"
              value={calcTarget}
              onChange={(e) => setCalcTarget(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
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
            className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-lg font-heading font-bold uppercase tracking-widest py-3 text-sm shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
            data-testid="bullet-calc-run"
          >
            {calcLoading ? '⏳ Calculating...' : '🔢 Calculate Bullets'}
          </button>

          {calcResult && (
            <div className="bg-secondary/50 border border-border rounded-md overflow-hidden">
              <div className="px-4 py-2.5 bg-secondary/30 border-b border-border">
                <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">
                  Results
                </h3>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-mutedForeground font-heading">Bullets Required:</span>
                  <span className="text-2xl font-heading font-bold text-primary tabular-nums">
                    {Number(calcResult.bullets_required || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-mutedForeground font-heading">Inflation:</span>
                  <span className="text-base font-heading font-bold text-foreground">
                    {Number(calcResult.inflation_pct ?? 0)}%
                  </span>
                </div>
                <div className="pt-3 border-t border-border text-sm text-mutedForeground font-heading space-y-1">
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
            <p className="text-sm text-mutedForeground font-heading italic text-center py-4">
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
  const [targetUsername, setTargetUsername] = useState('');
  const [note, setNote] = useState('');
  const [attacks, setAttacks] = useState([]);
  const [selectedAttackIds, setSelectedAttackIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [show, setShow] = useState('all');
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
  const [deathMessage, setDeathMessage] = useState('');
  const [makePublic, setMakePublic] = useState(false);
  const [inflationPct, setInflationPct] = useState(0);
  const [bulletsToUse, setBulletsToUse] = useState('');
  const [calcTarget, setCalcTarget] = useState('');
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcResult, setCalcResult] = useState(null);
  const [showCalcModal, setShowCalcModal] = useState(false);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [userBullets, setUserBullets] = useState(0);
  const [travelModalDestination, setTravelModalDestination] = useState(null);
  const [travelInfo, setTravelInfo] = useState(null);
  const [travelSubmitLoading, setTravelSubmitLoading] = useState(false);
  const [travelCountdown, setTravelCountdown] = useState(null);

  // Pre-fill search and kill form from hitlist link
  useEffect(() => {
    const t = searchParams.get('target');
    if (t && typeof t === 'string' && t.trim()) {
      const trimmed = t.trim();
      setTargetUsername(trimmed);
      setKillUsername(trimmed);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('target');
        return next;
      }, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshAttacks();
    const interval = setInterval(refreshAttacks, 10000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchInflation();
    fetchBullets();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/events/active').then((r) => {
      setEvent(r.data?.event ?? null);
      setEventsEnabled(!!r.data?.events_enabled);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (travelCountdown == null || travelCountdown <= 0) return;
    const t = setInterval(() => {
      setTravelCountdown((c) => {
        if (c <= 1) {
          clearInterval(t);
          refreshUser();
          refreshAttacks();
          setTravelModalDestination(null);
          return null;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [travelCountdown]);

  const fetchBullets = async () => {
    try {
      const res = await api.get('/auth/me');
      setUserBullets(res.data?.bullets ?? 0);
    } catch (e) {}
  };

  const fetchInflation = async () => {
    try {
      const res = await api.get('/attack/inflation');
      setInflationPct(Number(res.data?.inflation_pct ?? 0));
    } catch (e) {}
  };

  const refreshAttacks = async () => {
    try {
      const response = await api.get('/attack/list');
      setAttacks(response.data.attacks || []);
    } catch (error) {}
  };

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
    setLoading(true);
    try {
      const response = await api.post('/attack/search', { target_username: targetUsername, note });
      toast.success(response.data.message);
      setTargetUsername('');
      setNote('');
      await refreshAttacks();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to search target');
    } finally {
      setLoading(false);
    }
  };

  const openTravelModal = (locationState) => {
    setTravelModalDestination(locationState || null);
    setTravelInfo(null);
    if (locationState) {
      api.get('/travel/info').then((r) => setTravelInfo(r.data)).catch(() => setTravelInfo(null));
    }
  };

  const handleTravelFromModal = async (method) => {
    if (!travelModalDestination) return;
    setTravelSubmitLoading(true);
    try {
      const response = await api.post('/travel', { destination: travelModalDestination, travel_method: method });
      const travelTime = response.data?.travel_time ?? 0;
      if (travelTime <= 0) {
        toast.success(response.data?.message || `Traveled to ${travelModalDestination}`);
        setTravelModalDestination(null);
        refreshUser();
        await refreshAttacks();
      } else {
        toast.success(response.data?.message || `Traveling to ${travelModalDestination}`);
        setTravelCountdown(travelTime);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Travel failed');
    } finally {
      setTravelSubmitLoading(false);
    }
  };

  const executeAttack = async (attackId, extra = null) => {
    setLoading(true);
    try {
      const payload = extra ? { attack_id: attackId, ...extra } : { attack_id: attackId };
      const response = await api.post('/attack/execute', payload);
      if (response.data.success) {
        const rewardMoney = response.data.rewards?.money;
        toast.success(response.data.message, {
          description: rewardMoney != null ? `Rewards: $${Number(rewardMoney).toLocaleString()}` : undefined,
        });
      } else if (response.data.first_bodyguard) {
        const bg = response.data.first_bodyguard;
        toast.warning(response.data.message, {
          action: {
            label: 'Search',
            onClick: async () => {
              setLoading(true);
              try {
                const res = await api.post('/attack/search', { target_username: bg.search_username, note: '' });
                toast.success(res.data?.message || 'Search started');
                await refreshAttacks();
              } catch (err) {
                toast.error(err.response?.data?.detail || 'Failed to search');
              } finally {
                setLoading(false);
              }
            },
          },
        });
      } else {
        toast.error(response.data.message);
      }
      refreshUser();
      fetchBullets();
      await refreshAttacks();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to execute attack');
    } finally {
      setLoading(false);
    }
  };

  const killByUsername = async () => {
    const username = (killUsername || '').trim();
    if (!username) {
      toast.error('Enter a username');
      return;
    }

    const found = attacks.filter((a) => (a.target_username || '').toLowerCase() === username.toLowerCase() && a.status === 'found');
    const best = found.find((a) => a.can_attack) || found[0];

    if (!best) {
      setLoading(true);
      try {
        const res = await api.post('/attack/search', { target_username: username, note: 'kill' });
        toast.success(res.data.message || 'Searching...');
        await refreshAttacks();
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Failed to search target');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!best.can_attack) {
      toast.error('Travel first (target found in another city).');
      return;
    }

    const bulletNum = bulletsToUse !== "" && bulletsToUse != null ? parseInt(bulletsToUse, 10) : NaN;
    if (Number.isNaN(bulletNum) || bulletNum < 1) {
      toast.error('Enter how many bullets to use (at least 1).');
      return;
    }
    const extra = { death_message: deathMessage, make_public: makePublic, bullets_to_use: bulletNum };
    await executeAttack(best.attack_id, extra);
    await fetchInflation();
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
      setCalcResult(res.data);
    } catch (error) {
      setCalcResult(null);
      toast.error(error.response?.data?.detail || 'Failed to calculate bullets');
    } finally {
      setCalcLoading(false);
    }
  };

  const foundAndReady = useMemo(() => attacks.filter((a) => a.status === 'found'), [attacks]);
  
  const filteredAttacks = useMemo(() => {
    const t = filterText.trim().toLowerCase();
    return attacks
      .filter((a) => (show === 'all' ? true : a.status === show))
      .filter((a) => {
        if (!t) return true;
        const hay = `${a.target_username || ''} ${a.note || ''}`.toLowerCase();
        return hay.includes(t);
      });
  }, [attacks, filterText, show]);

  const filteredIds = useMemo(() => filteredAttacks.map((a) => a.attack_id), [filteredAttacks]);
  
  const allFilteredSelected = useMemo(
    () => filteredIds.length > 0 && filteredIds.every((id) => selectedAttackIds.includes(id)),
    [filteredIds, selectedAttackIds]
  );

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="attack-page">
      <style>{ATTACK_STYLES}</style>

      {/* Page header */}
      <div className="relative atk-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">The Hit</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">
          Attack
        </h1>
        <p className="text-[10px] text-zinc-500 font-heading italic mt-1">Search, travel, and strike. No witnesses, no mercy.</p>
      </div>

      {eventsEnabled && event && (event.kill_cash !== 1 || event.rank_points !== 1) && event.name && (
        <EventBanner event={event} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Left Column */}
        <div className="space-y-4 md:space-y-6">
          <KillUserCard
            killUsername={killUsername}
            setKillUsername={setKillUsername}
            bulletsToUse={bulletsToUse}
            setBulletsToUse={setBulletsToUse}
            deathMessage={deathMessage}
            setDeathMessage={setDeathMessage}
            makePublic={makePublic}
            setMakePublic={setMakePublic}
            inflationPct={inflationPct}
            userBullets={userBullets}
            foundAndReady={foundAndReady}
            loading={loading}
            onKill={killByUsername}
            onOpenCalc={() => setShowCalcModal(true)}
          />

          <FindUserCard
            targetUsername={targetUsername}
            setTargetUsername={setTargetUsername}
            note={note}
            setNote={setNote}
            loading={loading}
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
          selectedAttackIds={selectedAttackIds}
          toggleSelected={toggleSelected}
          toggleSelectAll={() => toggleSelectAllFiltered(filteredIds)}
          allSelected={allFilteredSelected}
          loading={loading}
          onDelete={deleteSelected}
          onTravel={openTravelModal}
          onFillKillTarget={setKillUsername}
        />
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
