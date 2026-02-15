import { useState, useEffect, useMemo, useCallback } from 'react';
import { MapPin, Dice5, Spade, Trophy, CircleDot, Users, Factory, Plane, Shield, ChevronRight, ChevronDown } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatMaxBet(n) {
  if (n == null) return '—';
  const num = Number(n);
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(0)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toLocaleString()}`;
}

const GAME_ICONS = {
  blackjack: Spade,
  horseracing: Trophy,
  roulette: CircleDot,
  dice: Dice5,
};

const GAME_COLORS = {
  blackjack: 'text-red-400',
  horseracing: 'text-emerald-400',
  roulette: 'text-blue-400',
  dice: 'text-purple-400',
};

// ============================================================================
// CITY CARD
// ============================================================================

const CityCard = ({
  city,
  games,
  allOwners,
  getEffectiveMaxBet,
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
  
  // Find highest max bet in this city (guard empty games)
  const highestBet = games.length ? Math.max(...games.map(g => getEffectiveMaxBet(g, city))) : 0;

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      {/* Header - Always visible */}
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between hover:bg-primary/15 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-primary" />
          <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wide">{city}</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-mutedForeground">{ownedCount}/{games.length} owned</span>
            <span className="text-primary font-bold">Max: {formatMaxBet(highestBet)}</span>
          </div>
          {expanded ? <ChevronDown size={14} className="text-primary" /> : <ChevronRight size={14} className="text-primary" />}
        </div>
      </button>

      {expanded && (
        <>
          {/* Casino Games */}
          <div className="p-2 space-y-1">
            <div className="text-[9px] text-mutedForeground uppercase tracking-wider px-1 mb-1">🎰 Casinos</div>
            {games.map((game) => {
              const Icon = GAME_ICONS[game.id] || Dice5;
              const color = GAME_COLORS[game.id] || 'text-primary';
              const owner = (allOwners[game.id] || {})[city] || null;
              const effectiveBet = getEffectiveMaxBet(game, city);
              const isTop = isHighestBet(game, city);
              return (
                <div
                  key={game.id}
                  className={`flex items-center justify-between px-2 py-1.5 rounded transition-colors ${isTop ? 'bg-primary/10' : 'bg-zinc-800/30'}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Icon size={12} className={color} />
                    <span className="text-xs font-heading font-bold text-foreground">{game.name}</span>
                    {owner ? (
                      <span className="text-[10px] text-mutedForeground">· {owner.username}</span>
                    ) : (
                      <span className="text-[10px] text-zinc-500">Unclaimed</span>
                    )}
                    {(game.id === 'dice' || game.id === 'blackjack') && owner?.buy_back_reward != null && Number(owner.buy_back_reward) > 0 && (
                      <span className="text-[9px] text-amber-400/90">Buy-back: {Number(owner.buy_back_reward).toLocaleString()} pts</span>
                    )}
                  </div>
                  <span className={`text-xs font-heading font-bold tabular-nums shrink-0 ${isTop ? 'text-primary' : 'text-foreground'}`}>
                    {formatMaxBet(effectiveBet)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Properties */}
          <div className="border-t border-zinc-700/30 p-2 space-y-1">
            <div className="text-[9px] text-mutedForeground uppercase tracking-wider px-1 mb-1">🏭 Properties</div>
            
            {/* Bullet Factory */}
            <div className="flex items-center justify-between px-2 py-1.5 bg-zinc-800/30 rounded">
              <div className="flex items-center gap-2">
                <Factory size={12} className="text-orange-400" />
                <span className="text-xs font-heading text-foreground">Bullet Factory</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                {bf?.owner_username ? (
                  <>
                    <span className="text-mutedForeground">{bf.owner_username}</span>
                    <span className="text-primary font-bold">${bf.price_per_bullet?.toLocaleString()}/ea</span>
                    <span className="text-foreground">{bf.accumulated_bullets} 🔫</span>
                  </>
                ) : (
                  <span className="text-zinc-500">Unclaimed</span>
                )}
              </div>
            </div>
            
            {/* Airport */}
            <div className="flex items-center justify-between px-2 py-1.5 bg-zinc-800/30 rounded">
              <div className="flex items-center gap-2">
                <Plane size={12} className="text-sky-400" />
                <span className="text-xs font-heading text-foreground">Airport</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                {ap?.owner_username && ap.owner_username !== 'Unclaimed' ? (
                  <>
                    <span className="text-mutedForeground">{ap.owner_username}</span>
                    <span className="text-primary font-bold">{ap.price_per_travel} pts</span>
                  </>
                ) : canClaimAirport && onClaimAirport ? (
                  <button
                    type="button"
                    onClick={() => onClaimAirport(city)}
                    disabled={claimingCity === city}
                    className="px-2 py-0.5 rounded bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
                  >
                    {claimingCity === city ? '...' : 'Take over'}
                  </button>
                ) : (
                  <span className="text-[10px]">
                    <span className="text-zinc-500">Unclaimed</span>
                    {airportUnclaimed && userCurrentCity && userCurrentCity !== city && (
                      <span className="text-zinc-600 ml-1">(Must be in {city})</span>
                    )}
                  </span>
                )}
              </div>
            </div>
            
            {/* Armoury */}
            <div className="flex items-center justify-between px-2 py-1.5 bg-zinc-800/20 rounded opacity-60">
              <div className="flex items-center gap-2">
                <Shield size={12} className="text-zinc-400" />
                <span className="text-xs font-heading text-zinc-400">Armoury</span>
              </div>
              <span className="text-[10px] text-amber-400">Coming soon</span>
            </div>
          </div>
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
    <div className="grid grid-cols-4 gap-2">
      <div className="p-2.5 rounded-md bg-zinc-800/30 border border-zinc-700/30 text-center">
        <div className="text-[9px] text-mutedForeground uppercase">Cities</div>
        <div className="text-lg font-heading font-bold text-foreground">{cities.length}</div>
      </div>
      <div className="p-2.5 rounded-md bg-zinc-800/30 border border-zinc-700/30 text-center">
        <div className="text-[9px] text-mutedForeground uppercase">Casinos</div>
        <div className="text-lg font-heading font-bold text-foreground">{ownedCasinos}/{totalCasinos}</div>
      </div>
      <div className="p-2.5 rounded-md bg-zinc-800/30 border border-zinc-700/30 text-center">
        <div className="text-[9px] text-mutedForeground uppercase">Factories</div>
        <div className="text-lg font-heading font-bold text-foreground">{ownedFactories}/{cities.length}</div>
      </div>
      <div className="p-2.5 rounded-md bg-zinc-800/30 border border-zinc-700/30 text-center">
        <div className="text-[9px] text-mutedForeground uppercase">Airports</div>
        <div className="text-lg font-heading font-bold text-foreground">{ownedAirports}/{cities.length}</div>
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
  }), [data.dice_owners, data.roulette_owners, data.blackjack_owners, data.horseracing_owners]);

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
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-sm font-heading">Loading...</div>
      </div>
    );
  }

  if (cities.length === 0) {
    return (
      <div className={`space-y-3 ${styles.pageContent}`} data-testid="states-page">
        <h1 className="text-xl font-heading font-bold text-primary">🗺️ States & Cities</h1>
        <div className="p-6 rounded-md border border-primary/20 bg-zinc-800/30 text-center">
          <p className="text-sm text-mutedForeground mb-3">Couldn&apos;t load states. Make sure you&apos;re logged in.</p>
          <button type="button" onClick={fetchStates} className="px-4 py-2 rounded bg-primary/20 border border-primary/50 text-primary text-sm font-heading uppercase hover:bg-primary/30">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${styles.pageContent}`} data-testid="states-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary flex items-center gap-2">
            🗺️ States & Cities
          </h1>
          <p className="text-xs text-mutedForeground">Travel · Casino · Properties</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={expandAll} className="text-[10px] text-mutedForeground hover:text-foreground">Expand all</button>
          <span className="text-zinc-600">|</span>
          <button onClick={collapseAll} className="text-[10px] text-mutedForeground hover:text-foreground">Collapse all</button>
        </div>
      </div>

      {/* Stats Overview */}
      <StatsOverview 
        cities={cities} 
        games={games} 
        allOwners={allOwners} 
        bulletFactories={bulletFactories}
        airports={airports}
      />

      {/* City Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {cities.map((city) => (
          <CityCard
            key={city}
            city={city}
            games={games}
            allOwners={allOwners}
            getEffectiveMaxBet={getEffectiveMaxBet}
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
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">ℹ️ Info</span>
        </div>
        <div className="p-3">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Use Travel to move between cities</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Access Casino games from the Casino menu</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Highest max bets highlighted in gold</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>HOT/COLD city events coming soon</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
