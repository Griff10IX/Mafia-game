import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Dice5, Spade, Trophy, CircleDot, Users, Plane, Shield, ChevronRight, ChevronDown } from 'lucide-react';

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
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const STATES_STYLES = `
  @keyframes st-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .st-fade-in { animation: st-fade-in 0.4s ease-out both; }
  @keyframes st-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .st-glow { animation: st-glow 4s ease-in-out infinite; }
  .st-corner::before, .st-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .st-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .st-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .st-card { transition: all 0.3s ease; }
  .st-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .st-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
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

// ============================================================================
// CITY CARD
// ============================================================================

const GAMES_WITH_BUYBACK = ['dice', 'blackjack', 'slots'];

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
}) => {
  const bf = bulletFactory;
  const ap = airportSlot1;
  const airportUnclaimed = !ap?.owner_username || ap.owner_username === 'Unclaimed';
  const canClaimAirport = airportUnclaimed && (userCurrentCity === city || userCurrentCity === null);
  
  // Count owned casinos
  const ownedCount = games.filter(g => g && (allOwners[g.id] || {})[city]?.username).length;
  // Highest max bet and buy-back in this city
  const highestBet = games.length ? Math.max(...games.map(g => getEffectiveMaxBet(g, city))) : 0;
  const buyBacks = games.filter(g => GAMES_WITH_BUYBACK.includes(g?.id)).map(g => getEffectiveBuyBack(g, city)).filter(n => n != null && Number(n) > 0);
  const highestBuyBack = buyBacks.length ? Math.max(...buyBacks.map(Number)) : null;

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 st-card st-corner st-fade-in`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      {/* Header - Always visible */}
      <button
        onClick={onToggle}
        className="w-full px-2 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between hover:bg-primary/12 transition-colors"
      >
        <div className="flex items-center gap-1">
          <MapPin size={10} className="text-primary" />
          <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">{city}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[9px]">
            <span className="text-mutedForeground">{ownedCount}/{games.length} owned</span>
            {highestBuyBack != null && (
              <span className="text-primary font-bold">{Number(highestBuyBack).toLocaleString()} pts</span>
            )}
            <span className="text-primary font-bold">Max: {formatMaxBet(highestBet)}</span>
          </div>
          {expanded ? <ChevronDown size={10} className="text-primary" /> : <ChevronRight size={10} className="text-primary" />}
        </div>
      </button>

      {expanded && (
        <>
          {/* Casino Games */}
          <div className="p-1.5 space-y-0.5">
            <div className="text-[8px] text-mutedForeground uppercase tracking-wider px-1 mb-0.5">🎰 Casinos</div>
            {games.map((game) => {
              const Icon = GAME_ICONS[game.id] || Dice5;
              const color = GAME_COLORS[game.id] || 'text-primary';
              const owner = (allOwners[game.id] || {})[city] || null;
              const effectiveBet = getEffectiveMaxBet(game, city);
              const isTop = isHighestBet(game, city);
              return (
                <div
                  key={game.id}
                  className={`flex items-center justify-between px-1.5 py-1 rounded transition-colors ${isTop ? 'bg-primary/10' : 'bg-zinc-800/30'}`}
                >
                  <div className="flex items-center gap-1 flex-wrap min-w-0">
                    <Icon size={10} className={color} />
                    <span className="text-[10px] font-heading font-bold text-foreground">{game.name}</span>
                    {game.id === 'slots' ? (
                      <>
                        {owner?.username ? (
                          <span className="text-[9px] text-mutedForeground">· <Link to={`/profile/${encodeURIComponent(owner.username)}`} className="text-primary hover:underline font-heading">{owner.username}</Link></span>
                        ) : (
                          <span className="text-[9px] text-zinc-500">State owned</span>
                        )}
                        {owner?.next_draw_at && (
                          <span className="text-[8px] text-mutedForeground">· Next draw: {formatNextDraw(owner.next_draw_at) || '—'}</span>
                        )}
                      </>
                    ) : owner ? (
                      <span className="text-[9px] text-mutedForeground">· <Link to={`/profile/${encodeURIComponent(owner.username)}`} className="text-primary hover:underline font-heading">{owner.username}</Link></span>
                    ) : (
                      <span className="text-[9px] text-zinc-500">Unclaimed</span>
                    )}
                    {(game.id === 'dice' || game.id === 'blackjack' || game.id === 'slots') && owner?.buy_back_reward != null && Number(owner.buy_back_reward) > 0 && (
                      <span className="text-[8px] text-amber-400/90">Buy-back: {Number(owner.buy_back_reward).toLocaleString()} pts</span>
                    )}
                  </div>
                  <span className={`text-[10px] font-heading font-bold tabular-nums shrink-0 ${isTop ? 'text-primary' : 'text-foreground'}`}>
                    {formatMaxBet(effectiveBet)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Properties */}
          <div className="border-t border-zinc-700/30 p-1.5 space-y-0.5">
            <div className="text-[8px] text-mutedForeground uppercase tracking-wider px-1 mb-0.5">🏭 Properties</div>
            
            {/* Armoury (bullets, armour, weapons — one per state; produce & buy at Armour & Weapons) */}
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
                    {claimingCity === city ? '...' : 'Take over'}
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
  const [data, setData] = useState({ cities: [], games: [] });
  const [loading, setLoading] = useState(true);
  const [bulletFactories, setBulletFactories] = useState([]);
  const [airports, setAirports] = useState([]);
  const [expandedCities, setExpandedCities] = useState({});
  const [claimingCity, setClaimingCity] = useState(null);
  const [userCurrentCity, setUserCurrentCity] = useState(null);

  const fetchUserCity = useCallback(() => {
    api.get('/auth/me').then((r) => setUserCurrentCity(r.data?.current_state ?? null)).catch(() => setUserCurrentCity(null));
  }, []);
  useEffect(() => { fetchUserCity(); }, [fetchUserCity]);
  useEffect(() => {
    const onFocus = () => fetchUserCity();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchUserCity]);

  const fetchStates = useCallback(() => {
    setLoading(true);
    api.get('/states')
      .then((res) => {
        setData({
          cities: res.data?.cities ?? [],
          games: res.data?.games ?? [],
          dice_owners: res.data?.dice_owners ?? {},
          roulette_owners: res.data?.roulette_owners ?? {},
          blackjack_owners: res.data?.blackjack_owners ?? {},
          horseracing_owners: res.data?.horseracing_owners ?? {},
          videopoker_owners: res.data?.videopoker_owners ?? {},
          slots_owners: res.data?.slots_owners ?? {},
        });
        // Expand all cities by default
        const citiesList = res.data?.cities ?? [];
        if (citiesList.length) {
          const all = {};
          citiesList.forEach(c => { all[c] = true; });
          setExpandedCities(all);
        }
      })
      .catch(() => toast.error('Failed to load states'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchStates(); }, [fetchStates]);

  useEffect(() => {
    api.get('/bullet-factory/list').then((r) => setBulletFactories(r.data?.factories ?? [])).catch(() => {});
    api.get('/airports').then((r) => setAirports(r.data?.airports ?? [])).catch(() => {});
  }, []);

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
      fetchUserCity();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim');
    } finally {
      setClaimingCity(null);
    }
  };

  if (loading) {
    return (
      <div className={`space-y-2 ${styles.pageContent}`}>
        <style>{STATES_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <MapPin size={22} className="text-primary/40 animate-pulse" />
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[9px] font-heading uppercase tracking-[0.2em]">Loading states...</span>
        </div>
      </div>
    );
  }

  if (cities.length === 0) {
    return (
      <div className={`space-y-2 ${styles.pageContent}`} data-testid="states-page">
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
    <div className={`space-y-2 ${styles.pageContent}`} data-testid="states-page">
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
        <div className="h-px bg-gradient-to-r from-primary/40 via-primary/20 to-transparent mb-2" />
      </div>

      {/* City Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 st-fade-in" style={{ animationDelay: '0.08s' }}>
        {cities.map((city) => (
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
          />
        ))}
      </div>

      {/* Info */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 st-fade-in`} style={{ animationDelay: '0.1s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">ℹ️ Info</span>
        </div>
        <div className="p-2">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1"><span className="text-primary shrink-0">•</span>Use Travel to move between cities</li>
            <li className="flex items-start gap-1"><span className="text-primary shrink-0">•</span>Access Casino games from the Casino menu</li>
            <li className="flex items-start gap-1"><span className="text-primary shrink-0">•</span>Highest max bets highlighted in gold</li>
            <li className="flex items-start gap-1"><span className="text-primary shrink-0">•</span>HOT/COLD city events coming soon</li>
          </ul>
        </div>
        <div className="st-art-line text-primary mx-2.5" />
      </div>
    </div>
  );
}
