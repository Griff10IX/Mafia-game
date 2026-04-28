import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Dice5, Spade, Trophy, CircleDot, Users, Plane, Shield, ChevronRight, ChevronDown } from 'lucide-react';
import FamilyEmblem from '../../components/FamilyEmblem';

/** Slot machine icon: three reel windows, same outline style as Spade/CircleDot/Dice5 */
function SlotsIcon({ size = 10, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2" y="4" width="5" height="14" rx="1" />
      <rect x="9.5" y="4" width="5" height="14" rx="1" />
      <rect x="17" y="4" width="5" height="14" rx="1" />
    </svg>
  );
}
import api, { apiRequestWith429Retry } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const STATES_STYLES = `
  @keyframes st-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .st-fade-in { animation: st-fade-in 0.4s ease-out both; }
  .st-card { transition: all 0.3s ease; }
  .st-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .st-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  .st-city-hero-shine { pointer-events: none; background: linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.04) 40%, transparent 65%); }
`;

function formatMaxBet(n) {
  if (n == null) return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatNextDraw(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return null;
  }
}

const GAME_ICONS = {
  blackjack: Spade,
  horseracing: Trophy,
  roulette: CircleDot,
  dice: Dice5,
  videopoker: Spade,
  slots: SlotsIcon,
};

const GAME_COLORS = {
  blackjack: 'text-red-400',
  horseracing: 'text-emerald-400',
  roulette: 'text-blue-400',
  dice: 'text-purple-400',
  videopoker: 'text-cyan-400',
  slots: 'text-amber-400',
};

/** Per-city abstract hero (no external art); hue shifts from name so neighbors don’t look identical. */
function cityHeroBackground(city, climateBand) {
  let h = 0;
  const s = String(city || '');
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  const hue2 = (hue + 48) % 360;
  if (climateBand === 'hot') {
    return `linear-gradient(128deg, hsl(${hue} 42% 16%) 0%, hsl(${(hue + 22) % 360} 48% 20%) 42%, hsl(32 55% 18%) 100%)`;
  }
  if (climateBand === 'cold') {
    return `linear-gradient(128deg, hsl(${hue2} 35% 12%) 0%, hsl(205 40% 16%) 48%, hsl(222 32% 11%) 100%)`;
  }
  return `linear-gradient(128deg, hsl(${hue} 18% 12%) 0%, hsl(${(hue + 40) % 360} 14% 14%) 55%, hsl(220 12% 10%) 100%)`;
}

function climateCardShell(climateBand) {
  if (climateBand === 'hot') {
    return 'border-amber-500/40 shadow-[0_0_0_1px_rgba(245,158,11,0.12),0_12px_40px_rgba(0,0,0,0.35)]';
  }
  if (climateBand === 'cold') {
    return 'border-sky-500/45 shadow-[0_0_0_1px_rgba(56,189,248,0.12),0_12px_40px_rgba(0,0,0,0.35)]';
  }
  return 'border-primary/20';
}

// ============================================================================
// CITY CARD
// ============================================================================

const GAMES_WITH_BUYBACK = ['dice', 'blackjack', 'roulette', 'horseracing', 'videopoker', 'slots'];

const CityCard = ({
  city,
  games,
  allOwners,
  getEffectiveMaxBet,
  getEffectiveBuyBack,
  isHighestBet,
  bulletFactory,
  airportSlot1,
  expanded,
  onToggle,
  onClaimAirport,
  claimingCity,
  userCurrentCity,
  stateHeads,
  isBoss,
  familyQualifiesForStateHead,
  onClaimState,
  claimingState,
  airportClaimCost,
  climateBand,
}) => {
  const bf = bulletFactory;
  const ap = airportSlot1;
  const airportUnclaimed = !ap?.owner_username || ap.owner_username === 'Unclaimed';
  const canClaimAirport = airportUnclaimed && (userCurrentCity === city || userCurrentCity === null);
  const headFamily = stateHeads && stateHeads[city];
  const stateUnclaimed = !headFamily;
  const canClaimState = stateUnclaimed && isBoss && familyQualifiesForStateHead && onClaimState;

  // Count owned casinos
  const ownedCount = games.filter(g => g && (allOwners[g.id] || {})[city]?.username).length;
  // Highest max bet and buy-back in this city
  const highestBet = games.length ? Math.max(...games.map(g => getEffectiveMaxBet(g, city))) : 0;
  const buyBacks = games.filter(g => GAMES_WITH_BUYBACK.includes(g?.id)).map(g => getEffectiveBuyBack(g, city)).filter(n => n != null && Number(n) > 0);
  const highestBuyBack = buyBacks.length ? Math.max(...buyBacks.map(Number)) : null;

  const shell = climateCardShell(climateBand);
  const headLabel = headFamily
    ? `${headFamily.family_name} (${headFamily.family_tag})`
    : 'Open seat';

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border st-card st-fade-in mobile-panel ${shell}`}>
      {/* Hero strip — climate-tinted “billboard”, not copied from any asset */}
      <button
        type="button"
        onClick={onToggle}
        className="relative w-full text-left min-h-[4.75rem] sm:min-h-[5.25rem] group transition-opacity hover:opacity-[0.98]"
      >
        <div
          className="absolute inset-0"
          style={{ background: cityHeroBackground(city, climateBand) }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/45 to-black/15" aria-hidden />
        <div className="absolute inset-0 st-city-hero-shine opacity-80" aria-hidden />
        <div className="relative flex items-end justify-between gap-2 px-2.5 pb-2 pt-1.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              <MapPin size={12} className="text-amber-200/90 shrink-0" />
              <h2 className="text-sm sm:text-base font-heading font-bold text-white tracking-tight drop-shadow-sm truncate">
                {city}
              </h2>
              {climateBand === 'hot' && (
                <span className="text-[8px] font-heading font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/25 text-amber-200 border border-amber-400/35">
                  Hot
                </span>
              )}
              {climateBand === 'cold' && (
                <span className="text-[8px] font-heading font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-sky-500/20 text-sky-100 border border-sky-400/35">
                  Cold
                </span>
              )}
            </div>
            <p className="text-[9px] text-zinc-300 font-heading truncate">
              Head: <span className="text-zinc-100">{headLabel}</span>
            </p>
            <p className="text-[9px] text-zinc-400 font-heading">
              Tables staffed{' '}
              <span className="text-zinc-200 tabular-nums">
                {ownedCount}/{games.length}
              </span>
              {highestBuyBack != null ? (
                <span className="text-zinc-500">
                  {' '}
                  · Top buy-back <span className="text-amber-200/90 tabular-nums">{Number(highestBuyBack).toLocaleString()} pts</span>
                </span>
              ) : null}
              <span className="text-zinc-500">
                {' '}
                · Ceiling <span className="text-zinc-100 tabular-nums">{formatMaxBet(highestBet)}</span>
              </span>
            </p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-0.5 text-zinc-300 pb-0.5">
            {expanded ? <ChevronDown size={14} className="text-zinc-200" /> : <ChevronRight size={14} className="text-zinc-200" />}
            <span className="text-[8px] font-heading uppercase tracking-wide text-zinc-500 group-hover:text-zinc-400">
              {expanded ? 'Less' : 'Casinos'}
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <>
          {/* Head family / Claim state */}
          <div className="p-1.5 border-b border-zinc-800/60 bg-black/20">
            <div className="text-[8px] text-mutedForeground uppercase tracking-wider px-1 mb-0.5 flex items-center gap-1">
              <Users size={9} /> Head family
            </div>
            <div className="flex items-center justify-between px-1.5 py-1 bg-zinc-900/40 rounded border border-zinc-800/50">
              {headFamily ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <FamilyEmblem
                    emblemPresetId={headFamily.family_emblem_preset_id}
                    avatarUrl={headFamily.family_emblem_avatar_url}
                    size={22}
                  />
                  <span className="text-[10px] font-heading text-foreground truncate">
                    {headFamily.family_name} <span className="text-primary font-bold">({headFamily.family_tag})</span>
                  </span>
                </div>
              ) : canClaimState ? (
                <button
                  type="button"
                  onClick={() => onClaimState(city)}
                  disabled={claimingState === city}
                  className="px-1.5 py-0.5 rounded bg-primary/20 border border-primary/50 text-primary text-[9px] font-heading font-bold uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
                >
                  {claimingState === city ? '...' : 'Claim state'}
                </button>
              ) : (
                <span className="text-[9px] text-zinc-500">Unclaimed</span>
              )}
            </div>
          </div>

          {/* Casinos — table layout (hot = richer accents; cold = quieter) */}
          <div className="p-1.5 border-b border-zinc-800/50 bg-zinc-950/30">
            <div className="text-[8px] text-mutedForeground uppercase tracking-wider px-1 mb-1">Casinos</div>
            <div className="overflow-x-auto rounded border border-zinc-800/60 bg-zinc-950/40">
              <table className="w-full min-w-[280px] text-left border-collapse">
                <thead>
                  <tr
                    className={`text-[8px] font-heading font-bold uppercase tracking-wider border-b ${
                      climateBand === 'cold' ? 'border-sky-950/50 text-zinc-500' : 'border-zinc-700/60 text-zinc-400'
                    }`}
                  >
                    <th className="py-1 px-1.5">Casino</th>
                    <th className="py-1 px-1.5">Owner</th>
                    <th className="py-1 px-1.5">Wealth</th>
                    <th className="py-1 px-1.5 text-right whitespace-nowrap">Max bet</th>
                  </tr>
                </thead>
                <tbody className="text-[10px] font-heading">
                  {games.map((game) => {
                    const Icon = GAME_ICONS[game.id] || Dice5;
                    const color = GAME_COLORS[game.id] || 'text-primary';
                    const owner = (allOwners[game.id] || {})[city] || null;
                    const effectiveBet = getEffectiveMaxBet(game, city);
                    const isTop = isHighestBet(game, city);
                    const hasPlayer = !!(owner && owner.username);
                    const slotsStateOwned = game.id === 'slots' && !owner?.username;
                    const coldMuted = climateBand === 'cold';
                    const hotRow = climateBand === 'hot' && isTop;
                    const wealthName = owner?.wealth_rank_name;
                    const wealthHex = owner?.wealth_rank_color || '#94a3b8';
                    const ownerCell = hasPlayer ? (
                      <Link
                        to={`/profile/${encodeURIComponent(owner.username)}`}
                        className={`hover:underline ${coldMuted ? 'text-zinc-400' : 'text-sky-200/95'}`}
                      >
                        {owner.username}
                      </Link>
                    ) : slotsStateOwned ? (
                      <span className={coldMuted ? 'text-zinc-500' : 'text-zinc-400'}>State</span>
                    ) : (
                      <span className="text-zinc-500">No owner</span>
                    );
                    let wealthCell;
                    if (slotsStateOwned) {
                      wealthCell = <span className="text-zinc-500">—</span>;
                    } else if (!hasPlayer) {
                      wealthCell = <span className="text-zinc-500">—</span>;
                    } else if (coldMuted) {
                      wealthCell = (
                        <span className="text-zinc-500" style={wealthName ? { color: `${wealthHex}99` } : undefined}>
                          {wealthName || 'Unknown'}
                        </span>
                      );
                    } else if (wealthName) {
                      wealthCell = (
                        <span className="font-bold" style={{ color: wealthHex }}>
                          {wealthName}
                        </span>
                      );
                    } else {
                      wealthCell = <span className="text-emerald-300/90 font-semibold">Active</span>;
                    }
                    const betTone = hotRow
                      ? 'text-amber-200 font-bold tabular-nums'
                      : isTop
                        ? 'text-primary font-bold tabular-nums'
                        : coldMuted
                          ? 'text-zinc-500 tabular-nums'
                          : 'text-zinc-200 tabular-nums';
                    return (
                      <tr
                        key={game.id}
                        className={`border-b border-zinc-800/50 last:border-0 ${
                          hotRow ? 'bg-emerald-950/45' : coldMuted && !hasPlayer && !slotsStateOwned ? 'bg-zinc-900/25' : 'bg-transparent'
                        }`}
                      >
                        <td className="py-1 px-1.5 align-top">
                          <div className="flex items-start gap-1 min-w-0">
                            <Icon size={11} className={`${color} shrink-0 mt-0.5`} />
                            <div className="min-w-0">
                              <span className={`font-bold block leading-tight ${coldMuted ? 'text-zinc-300' : 'text-zinc-100'}`}>{game.name}</span>
                              {game.id === 'slots' && owner?.next_draw_at && (
                                <span className="text-[8px] text-zinc-500 block leading-tight mt-0.5">
                                  Draw {formatNextDraw(owner.next_draw_at) || '—'}
                                </span>
                              )}
                              {GAMES_WITH_BUYBACK.includes(game.id) && owner?.buy_back_reward != null && Number(owner.buy_back_reward) > 0 && (
                                <span className="text-[8px] text-amber-500/90 block leading-tight mt-0.5">
                                  Buy-back {Number(owner.buy_back_reward).toLocaleString()} pts
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-1 px-1.5 align-top whitespace-nowrap">{ownerCell}</td>
                        <td className="py-1 px-1.5 align-top whitespace-nowrap">{wealthCell}</td>
                        <td className={`py-1 px-1.5 align-top text-right ${betTone}`}>{formatMaxBet(effectiveBet)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Properties */}
          <div className="border-t border-zinc-700/30 p-1.5 space-y-0.5">
            <div className="text-[8px] text-mutedForeground uppercase tracking-wider px-1 mb-0.5">🏭 Properties</div>
            
            {/* Armoury (bullets, armour, weapons — one per state; produce & buy in Armoury) */}
            <div
              className="flex items-center justify-between px-1.5 py-1 bg-zinc-800/30 rounded"
              title="Bullets, armour & weapons. Produce stock and buy here. Owner earns from bullets sold and from armoury armour/weapon sales (35% margin)."
            >
              <div className="flex items-center gap-1 min-w-0">
                <Shield size={10} className="text-orange-400 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] font-heading text-foreground">Armoury</span>
                  <span className="text-[8px] text-mutedForeground block">Produce & buy · Owner earns from sales</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[9px] shrink-0">
                {bf?.owner_username ? (
                  <>
                    <Link to={`/profile/${encodeURIComponent(bf.owner_username)}`} className="text-primary hover:underline font-heading text-mutedForeground hover:text-primary truncate max-w-[80px]">{bf.owner_username}</Link>
                    <span className="text-primary font-bold">${bf.price_per_bullet != null ? Number(bf.price_per_bullet).toLocaleString() : '—'}/ea</span>
                    <span className="text-foreground">{bf.accumulated_bullets != null ? bf.accumulated_bullets : 0} 🔫</span>
                  </>
                ) : (
                  <span className="text-zinc-500">Unclaimed</span>
                )}
                <Link to="/armour-weapons" className="text-primary hover:underline font-heading text-[9px] font-bold whitespace-nowrap">Manage</Link>
              </div>
            </div>

            {/* Airport */}
            <div className="flex items-center justify-between px-1.5 py-1 bg-zinc-800/30 rounded">
              <div className="flex items-center gap-1">
                <Plane size={10} className="text-sky-400" />
                <span className="text-[10px] font-heading text-foreground">Airport</span>
              </div>
              <div className="flex items-center gap-1 text-[9px]">
                {ap?.owner_username && ap.owner_username !== 'Unclaimed' ? (
                  <>
                    <Link to={`/profile/${encodeURIComponent(ap.owner_username)}`} className="text-primary hover:underline font-heading text-mutedForeground hover:text-primary">{ap.owner_username}</Link>
                    <span className="text-primary font-bold">{ap.price_per_travel} pts</span>
                    <span className="text-[8px] text-amber-400/90" title="Airport owners get 5% off at all airports">5% off</span>
                  </>
                ) : canClaimAirport && onClaimAirport ? (
                  <button
                    type="button"
                    onClick={() => onClaimAirport(city)}
                    disabled={claimingCity === city}
                    className="px-1.5 py-0.5 rounded bg-primary/20 border border-primary/50 text-primary text-[9px] font-heading font-bold uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
                  >
                    {claimingCity === city ? '...' : `Take over (${formatMaxBet(airportClaimCost)})`}
                  </button>
                ) : (
                  <span className="text-[9px]">
                    <span className="text-zinc-500">Unclaimed</span>
                    {airportUnclaimed && userCurrentCity && userCurrentCity !== city && (
                      <span className="text-zinc-600 ml-0.5">(Must be in {city})</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="st-art-line text-primary mx-2.5" />
        </>
      )}
    </div>
  );
};

// ============================================================================
// STATS OVERVIEW
// ============================================================================

const StatsOverview = ({ cities, games, allOwners, bulletFactories, airports }) => {
  const totalCasinos = cities.length * games.length;
  const ownedCasinos = cities.reduce((sum, city) => {
    return sum + games.filter(g => (allOwners[g.id] || {})[city]?.username).length;
  }, 0);
  const ownedFactories = bulletFactories.filter(f => f.owner_username).length;
  const ownedAirports = airports.filter(a => a.owner_username).length;

  return (
    <div className="grid grid-cols-4 gap-1.5">
      <div className="p-1.5 rounded-md bg-zinc-800/30 border border-primary/20 text-center st-card st-fade-in">
        <div className="text-[8px] text-mutedForeground uppercase tracking-[0.1em] font-heading">Cities</div>
        <div className="text-sm font-heading font-bold text-foreground">{cities.length}</div>
      </div>
      <div className="p-1.5 rounded-md bg-zinc-800/30 border border-primary/20 text-center st-card st-fade-in" style={{ animationDelay: '0.03s' }}>
        <div className="text-[8px] text-mutedForeground uppercase tracking-[0.1em] font-heading">Casinos</div>
        <div className="text-sm font-heading font-bold text-foreground">{ownedCasinos}/{totalCasinos}</div>
      </div>
      <div className="p-1.5 rounded-md bg-zinc-800/30 border border-primary/20 text-center st-card st-fade-in" style={{ animationDelay: '0.06s' }}>
        <div className="text-[8px] text-mutedForeground uppercase tracking-[0.1em] font-heading">Armouries</div>
        <div className="text-sm font-heading font-bold text-foreground">{ownedFactories}/{cities.length}</div>
      </div>
      <div className="p-1.5 rounded-md bg-zinc-800/30 border border-primary/20 text-center st-card st-fade-in" style={{ animationDelay: '0.09s' }}>
        <div className="text-[8px] text-mutedForeground uppercase tracking-[0.1em] font-heading">Airports</div>
        <div className="text-sm font-heading font-bold text-foreground">{ownedAirports}/{cities.length}</div>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function States() {
  const [data, setData] = useState({ cities: [], games: [], state_heads: {}, location_climate: null });
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [bulletFactories, setBulletFactories] = useState([]);
  const [airports, setAirports] = useState([]);
  const [airportClaimCost, setAirportClaimCost] = useState(175_000_000);
  const [expandedCities, setExpandedCities] = useState({});
  const [claimingCity, setClaimingCity] = useState(null);
  const [claimingState, setClaimingState] = useState(null);
  const [userCurrentCity, setUserCurrentCity] = useState(null);
  const [familyMy, setFamilyMy] = useState(null);

  const fetchUserCity = useCallback(() => {
    api.get('/auth/me').then((r) => setUserCurrentCity(r.data?.current_state ?? null)).catch(() => setUserCurrentCity(null));
  }, []);
  useEffect(() => { fetchUserCity(); }, [fetchUserCity]);
  useEffect(() => {
    const onFocus = () => fetchUserCity();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchUserCity]);

  const fetchFamilyMy = useCallback(() => {
    apiRequestWith429Retry(() => api.get('/families/my')).then((r) => setFamilyMy(r.data ?? null)).catch(() => setFamilyMy(null));
  }, []);
  useEffect(() => { fetchFamilyMy(); }, [fetchFamilyMy]);

  const fetchStates = useCallback(() => {
    api.get('/states')
      .then((res) => {
        setLoadError(false);
        setData({
          cities: res.data?.cities ?? [],
          games: res.data?.games ?? [],
          dice_owners: res.data?.dice_owners ?? {},
          roulette_owners: res.data?.roulette_owners ?? {},
          blackjack_owners: res.data?.blackjack_owners ?? {},
          horseracing_owners: res.data?.horseracing_owners ?? {},
          videopoker_owners: res.data?.videopoker_owners ?? {},
          slots_owners: res.data?.slots_owners ?? {},
          state_heads: res.data?.state_heads ?? {},
          location_climate: res.data?.location_climate ?? null,
        });
        // Expand all cities by default
        const citiesList = res.data?.cities ?? [];
        if (citiesList.length) {
          const all = {};
          citiesList.forEach(c => { all[c] = true; });
          setExpandedCities(all);
        }
      })
      .catch(() => {
        setLoadError(true);
        toast.error('Failed to load states');
        setData({ cities: [], games: [], state_heads: {}, location_climate: null });
      })
      .finally(() => setHasLoaded(true));
  }, []);

  useEffect(() => { fetchStates(); }, [fetchStates]);

  useEffect(() => {
    api.get('/bullet-factory/list').then((r) => setBulletFactories(r.data?.factories ?? [])).catch(() => setBulletFactories([]));
    api.get('/airports').then((r) => {
      setAirports(r.data?.airports ?? []);
      if (r.data?.claim_cost != null) setAirportClaimCost(Number(r.data.claim_cost));
    }).catch(() => setAirports([]));
  }, []);

  useEffect(() => {
    let lastWakeRefetchAt = 0;
    const onWake = () => {
      const now = Date.now();
      if (now - lastWakeRefetchAt < 2500) return;
      lastWakeRefetchAt = now;
      fetchStates();
      fetchFamilyMy();
      fetchUserCity();
      api.get('/bullet-factory/list').then((r) => setBulletFactories(r.data?.factories ?? [])).catch(() => setBulletFactories([]));
      api.get('/airports').then((r) => {
        setAirports(r.data?.airports ?? []);
        if (r.data?.claim_cost != null) setAirportClaimCost(Number(r.data.claim_cost));
      }).catch(() => setAirports([]));
    };
    const onVisibility = () => {
      if (!document.hidden) onWake();
    };
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onWake);
      window.removeEventListener('pageshow', onWake);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchStates, fetchFamilyMy, fetchUserCity]);

  const cities = useMemo(() => (Array.isArray(data.cities) ? data.cities : []), [data.cities]);
  const games = useMemo(() => (Array.isArray(data.games) ? data.games : []), [data.games]);
  const allOwners = useMemo(() => ({
    dice: data.dice_owners || {},
    roulette: data.roulette_owners || {},
    blackjack: data.blackjack_owners || {},
    horseracing: data.horseracing_owners || {},
    videopoker: data.videopoker_owners || {},
    slots: data.slots_owners || {},
  }), [data.dice_owners, data.roulette_owners, data.blackjack_owners, data.horseracing_owners, data.videopoker_owners, data.slots_owners]);

  const highestBets = useMemo(() => {
    const map = {};
    for (const game of games) {
      if (!game || !game.id) continue;
      const bets = cities.map((city) => {
        const ownerMap = allOwners[game.id] || {};
        if (ownerMap[city]?.max_bet != null) return ownerMap[city].max_bet;
        return game.max_bet ?? 0;
      });
      const max = bets.length ? Math.max(...bets) : 0;
      const count = bets.filter((b) => b === max).length;
      map[game.id] = { max, count };
    }
    return map;
  }, [cities, games, allOwners]);

  const getEffectiveMaxBet = (game, city) => {
    if (!game) return 0;
    const ownerMap = allOwners[game.id] || {};
    if (ownerMap[city]?.max_bet != null) return ownerMap[city].max_bet;
    return game.max_bet ?? 0;
  };

  const getEffectiveBuyBack = (game, city) => {
    if (!game || !GAMES_WITH_BUYBACK.includes(game.id)) return null;
    const ownerMap = allOwners[game.id] || {};
    const v = ownerMap[city]?.buy_back_reward;
    return v != null && Number(v) > 0 ? Number(v) : null;
  };

  const isHighestBet = (game, city) => {
    const bet = getEffectiveMaxBet(game, city);
    const info = highestBets[game.id];
    if (!info) return false;
    return bet === info.max && info.count < cities.length;
  };

  const bulletFactoryByState = useMemo(() => {
    const map = {};
    (bulletFactories || []).forEach((f) => { map[f.state] = f; });
    return map;
  }, [bulletFactories]);

  const airportSlot1ByState = useMemo(() => {
    const map = {};
    (airports || []).forEach((a) => { if (a.slot === 1) map[a.state] = a; });
    return map;
  }, [airports]);

  const toggleCity = (city) => {
    setExpandedCities(prev => ({ ...prev, [city]: !prev[city] }));
  };

  const expandAll = () => {
    const all = {};
    cities.forEach(c => { all[c] = true; });
    setExpandedCities(all);
  };

  const collapseAll = () => setExpandedCities({});

  const handleClaimAirport = async (state) => {
    setClaimingCity(state);
    try {
      await api.post('/airports/claim', { state, slot: 1 });
      toast.success('You now own this airport. Set price in Travel or States.');
      const r = await api.get('/airports');
      setAirports(r.data?.airports ?? []);
      if (r.data?.claim_cost != null) setAirportClaimCost(Number(r.data.claim_cost));
      fetchUserCity();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim');
    } finally {
      setClaimingCity(null);
    }
  };

  const handleClaimState = async (state) => {
    setClaimingState(state);
    try {
      await api.post('/states/claim', { state });
      toast.success(`Your family is now head of ${state}.`);
      fetchStates();
      fetchFamilyMy();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim state');
    } finally {
      setClaimingState(null);
    }
  };

  const isBoss = (familyMy?.my_role || '').toLowerCase() === 'boss';
  const familyQualifiesForStateHead = !!familyMy?.qualifies_for_state_head;
  const stateHeads = data.state_heads || {};

  if (!hasLoaded && cities.length === 0) {
    return (
      <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="states-page">
        <style>{STATES_STYLES}</style>
        <div className="relative st-fade-in">
          <p className="text-[9px] text-zinc-500 font-heading italic">Travel · Casinos · Properties. Who owns what where.</p>
        </div>
      </div>
    );
  }

  if (hasLoaded && loadError && cities.length === 0) {
    return (
      <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="states-page">
        <style>{STATES_STYLES}</style>
        <div className="relative st-fade-in">
          <p className="text-[9px] text-zinc-500 font-heading italic">Travel · Casinos · Properties. Who owns what where.</p>
        </div>
        <div className="relative p-3 rounded-md border border-primary/20 bg-zinc-800/30 text-center st-fade-in" style={{ animationDelay: '0.05s' }}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <p className="text-[11px] text-mutedForeground mb-2">Couldn&apos;t load states. Make sure you&apos;re logged in.</p>
          <button type="button" onClick={fetchStates} className="px-2.5 py-1.5 rounded-md bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading uppercase hover:bg-primary/30">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="states-page">
      <style>{STATES_STYLES}</style>

      {/* Page header */}
      <div className="relative st-fade-in">
        <p className="text-[9px] text-zinc-500 font-heading italic">Travel · Casinos · Properties. Who owns what where.</p>
      </div>
      
      <div className="flex items-center justify-end gap-1 st-fade-in" style={{ animationDelay: '0.03s' }}>
        <button onClick={expandAll} className="text-[9px] text-mutedForeground hover:text-foreground font-heading">Expand all</button>
        <span className="text-zinc-600 text-[9px]">|</span>
        <button onClick={collapseAll} className="text-[9px] text-mutedForeground hover:text-foreground font-heading">Collapse all</button>
      </div>

      {/* Stats Overview */}
      <StatsOverview 
        cities={cities} 
        games={games} 
        allOwners={allOwners} 
        bulletFactories={bulletFactories}
        airports={airports}
      />

      {/* Destinations section */}
      <div className="st-fade-in" style={{ animationDelay: '0.06s' }}>
        <p className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] mb-1">Destinations</p>
        {data.location_climate?.hot && data.location_climate?.cold && (
          <p className="text-[9px] text-mutedForeground font-heading mb-1 leading-snug">
            <span className="text-amber-400/90 font-bold">Hot</span> {data.location_climate.hot} ·{' '}
            <span className="text-sky-400/90 font-bold">Cold</span> {data.location_climate.cold}
            {data.location_climate.period_ends_at && (
              <span className="text-zinc-500">
                {' '}
                · Next shift{' '}
                {(() => {
                  try {
                    const d = new Date(data.location_climate.period_ends_at);
                    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
                  } catch {
                    return '—';
                  }
                })()}
              </span>
            )}
          </p>
        )}
        <div className="h-px bg-gradient-to-r from-primary/40 via-primary/20 to-transparent mb-2" />
      </div>

      {/* City Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 st-fade-in" style={{ animationDelay: '0.08s' }}>
        {cities.map((city) => {
          const bc = data.location_climate?.by_city?.[city];
          const climateBand = bc === 'hot' || bc === 'cold' ? bc : null;
          return (
          <CityCard
            key={city}
            city={city}
            games={games}
            allOwners={allOwners}
            getEffectiveMaxBet={getEffectiveMaxBet}
            getEffectiveBuyBack={getEffectiveBuyBack}
            isHighestBet={isHighestBet}
            bulletFactory={bulletFactoryByState[city]}
            airportSlot1={airportSlot1ByState[city]}
            expanded={!!expandedCities[city]}
            onToggle={() => toggleCity(city)}
            onClaimAirport={handleClaimAirport}
            claimingCity={claimingCity}
            userCurrentCity={userCurrentCity}
            stateHeads={stateHeads}
            isBoss={isBoss}
            familyQualifiesForStateHead={familyQualifiesForStateHead}
            onClaimState={handleClaimState}
            claimingState={claimingState}
            airportClaimCost={airportClaimCost}
            climateBand={climateBand}
          />
          );
        })}
      </div>

      {/* Info */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 st-fade-in mobile-panel`} style={{ animationDelay: '0.1s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">ℹ️ Info</span>
        </div>
        <div className="p-2">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1"><span className="text-primary shrink-0">•</span>Use Travel to move between cities</li>
            <li className="flex items-start gap-1"><span className="text-primary shrink-0">•</span>Access Casino games from the Casino menu</li>
            <li className="flex items-start gap-1"><span className="text-primary shrink-0">•</span>Highest max bet per game is highlighted; in the <span className="text-amber-400/90 font-bold">hot</span> city that row also gets a green tint and amber ceiling figure</li>
            <li className="flex items-start gap-1"><span className="text-primary shrink-0">•</span>Hot/cold rotates every 3h (UTC): easier crimes, GTA, and jail busts plus a little rank XP in the hot city; the opposite in the cold city while you are there</li>
          </ul>
        </div>
        <div className="st-art-line text-primary mx-2.5" />
      </div>
    </div>
  );
}
