import { useState, useEffect, useMemo } from 'react';
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
}) => {
  const bf = bulletFactory;
  const ap = airportSlot1;
  
  // Count owned casinos
  const ownedCount = games.filter(g => (allOwners[g.id] || {})[city]?.username).length;
  
  // Find highest max bet in this city
  const highestBet = Math.max(...games.map(g => getEffectiveMaxBet(g, city)));

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
                  <div className="flex items-center gap-2">
                    <Icon size={12} className={color} />
                    <span className="text-xs font-heading font-bold text-foreground">{game.name}</span>
                    {owner && (
                      <span className="text-[10px] text-mutedForeground">
                        · {owner.username}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs font-heading font-bold tabular-nums ${isTop ? 'text-primary' : 'text-foreground'}`}>
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
                {ap?.owner_username ? (
                  <>
                    <span className="text-mutedForeground">{ap.owner_username}</span>
                    <span className="text-primary font-bold">{ap.price_per_travel} pts</span>
                  </>
                ) : (
                  <>
                    <span className="text-zinc-500">Unclaimed</span>
                    <span className="text-mutedForeground">10 pts</span>
                  </>
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

  useEffect(() => {
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
        // Expand first city by default
        if (res.data?.cities?.[0]) {
          setExpandedCities({ [res.data.cities[0]]: true });
        }
      })
      .catch(() => toast.error('Failed to load states'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.get('/bullet-factory/list').then((r) => setBulletFactories(r.data?.factories ?? [])).catch(() => {});
    api.get('/airports').then((r) => setAirports(r.data?.airports ?? [])).catch(() => {});
  }, []);

  const { cities, games, dice_owners, roulette_owners, blackjack_owners, horseracing_owners } = data;

  const allOwners = {
    dice: dice_owners || {},
    roulette: roulette_owners || {},
    blackjack: blackjack_owners || {},
    horseracing: horseracing_owners || {},
  };

  const highestBets = useMemo(() => {
    const map = {};
    for (const game of games) {
      const bets = cities.map((city) => {
        const ownerMap = allOwners[game.id] || {};
        if (ownerMap[city]?.max_bet != null) return ownerMap[city].max_bet;
        return game.max_bet;
      });
      const max = Math.max(...bets);
      const count = bets.filter((b) => b === max).length;
      map[game.id] = { max, count };
    }
    return map;
  }, [cities, games, allOwners]);

  const getEffectiveMaxBet = (game, city) => {
    const ownerMap = allOwners[game.id] || {};
    if (ownerMap[city]?.max_bet != null) return ownerMap[city].max_bet;
    return game.max_bet;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-sm font-heading">Loading...</div>
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
