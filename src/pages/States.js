import { useState, useEffect, useMemo } from 'react';
import { MapPin, Dice5, Spade, Trophy, CircleDot, Users, Calendar, Factory, Plane, Shield } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatMaxBet(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString()}`;
}

const GAME_ICONS = {
  blackjack: Spade,
  horseracing: Trophy,
  roulette: CircleDot,
  dice: Dice5,
};

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = () => (
  <div>
    <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2 flex items-center gap-3">
      <MapPin className="w-8 h-8 md:w-10 md:h-10" />
      States & Cities
    </h1>
    <p className="text-sm text-mutedForeground">
      Travel · Casino · City Events
    </p>
  </div>
);

const CityCard = ({
  city,
  games,
  allOwners,
  getEffectiveMaxBet,
  isHighestBet,
  bulletFactory,
  airportSlot1,
}) => {
  const bf = bulletFactory;
  const ap = airportSlot1;
  return (
    <div
      className="bg-card rounded-md overflow-hidden border border-primary/20"
      data-testid={`state-card-${city.replace(/\s+/g, '-').toLowerCase()}`}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <MapPin size={18} className="text-primary" />
            <h2 className="text-base md:text-lg font-heading font-bold text-primary uppercase tracking-wide">
              {city}
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-mutedForeground font-heading">
          <div className="flex items-center gap-1.5">
            <Users size={14} className="text-primary/60" />
            <span>Residents: —</span>
          </div>
          <span className="text-primary/30">•</span>
          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-primary/60" />
            <span>Event: —</span>
          </div>
        </div>
      </div>

      {/* Casino */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/30 text-xs uppercase tracking-wider font-heading text-primary/80 border-b border-border">
              <th className="text-left py-2 px-4">Casino</th>
              <th className="text-left py-2 px-4">Owner</th>
              <th className="text-left py-2 px-4">Wealth</th>
              <th className="text-right py-2 px-4">Max Bet</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {games.map((game) => {
              const Icon = GAME_ICONS[game.id] || Dice5;
              const owner = (allOwners[game.id] || {})[city] || null;
              const effectiveBet = getEffectiveMaxBet(game, city);
              const isTop = isHighestBet(game, city);
              return (
                <tr
                  key={game.id}
                  className="hover:bg-secondary/30 transition-colors"
                  data-testid={`game-${game.id}-${city.replace(/\s+/g, '-').toLowerCase()}`}
                >
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-primary/20 border border-primary/30">
                        <Icon size={14} className="text-primary" />
                      </div>
                      <span className="font-heading font-bold text-foreground">{game.name}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-mutedForeground font-heading">{owner?.username ?? '—'}</td>
                  <td className="py-2.5 px-4 text-mutedForeground font-heading">{owner?.wealth_rank_name ?? '—'}</td>
                  <td className={`py-2.5 px-4 text-right font-heading font-bold tabular-nums ${isTop ? 'text-primary' : 'text-foreground'}`}>
                    {formatMaxBet(effectiveBet)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: Casino cards */}
      <div className="md:hidden divide-y divide-border">
        {games.map((game) => {
          const Icon = GAME_ICONS[game.id] || Dice5;
          const owner = (allOwners[game.id] || {})[city] || null;
          const effectiveBet = getEffectiveMaxBet(game, city);
          const isTop = isHighestBet(game, city);
          return (
            <div
              key={game.id}
              className="p-4 space-y-2 hover:bg-secondary/30 transition-colors"
              data-testid={`game-${game.id}-${city.replace(/\s+/g, '-').toLowerCase()}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-md bg-primary/20 border border-primary/30">
                    <Icon size={16} className="text-primary" />
                  </div>
                  <span className="font-heading font-bold text-foreground">{game.name}</span>
                </div>
                <span className={`font-heading font-bold text-sm tabular-nums ${isTop ? 'text-primary' : 'text-foreground'}`}>
                  {formatMaxBet(effectiveBet)}
                </span>
              </div>
              {owner && (
                <div className="flex items-center gap-4 text-sm text-mutedForeground font-heading pl-10">
                  <div>Owner: <span className="text-foreground">{owner.username}</span></div>
                  <div>{owner.wealth_rank_name}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Property: 1 Bullet Factory, 1 Airport, 1 Armoury per state — our style */}
      <div className="border-t border-primary/30">
        <div className="px-4 py-2 bg-primary/5 border-b border-primary/20">
          <h3 className="text-xs font-heading font-bold text-primary/90 uppercase tracking-widest">Property</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-heading">
            <thead>
              <tr className="bg-secondary/20 text-xs uppercase tracking-wider text-primary/80 border-b border-border">
                <th className="text-left py-1.5 px-3">Property</th>
                <th className="text-left py-1.5 px-3">Owner</th>
                <th className="text-left py-1.5 px-3">Prices</th>
                <th className="text-left py-1.5 px-3">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-secondary/20 transition-colors">
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-primary/20 border border-primary/30">
                      <Factory size={12} className="text-primary" />
                    </div>
                    <span className="font-heading font-bold text-foreground">Bullet Factory</span>
                  </div>
                </td>
                <td className="py-2 px-3 text-mutedForeground font-heading">{bf?.owner_username ?? 'Unclaimed'}</td>
                <td className="py-2 px-3 text-primary font-heading">{bf?.price_per_bullet != null ? `$${Number(bf.price_per_bullet).toLocaleString()}` : '—'}</td>
                <td className="py-2 px-3 text-foreground font-heading">{bf?.accumulated_bullets != null ? `${bf.accumulated_bullets} Bullets` : '—'}</td>
              </tr>
              <tr className="hover:bg-secondary/20 transition-colors">
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-primary/20 border border-primary/30">
                      <Plane size={12} className="text-primary" />
                    </div>
                    <span className="font-heading font-bold text-foreground">Airport</span>
                  </div>
                </td>
                <td className="py-2 px-3 text-mutedForeground font-heading">{ap?.owner_username ?? 'Unclaimed'}</td>
                <td className="py-2 px-3 text-primary font-heading">{ap?.price_per_travel != null ? `${ap.price_per_travel} pts` : '10 pts'}</td>
                <td className="py-2 px-3 text-mutedForeground">—</td>
              </tr>
              <tr className="hover:bg-secondary/20 transition-colors bg-primary/5">
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-primary/20 border border-primary/30">
                      <Shield size={12} className="text-primary" />
                    </div>
                    <span className="font-heading font-bold text-foreground">Armoury</span>
                  </div>
                </td>
                <td className="py-2 px-3 text-mutedForeground">—</td>
                <td className="py-2 px-3 text-mutedForeground">—</td>
                <td className="py-2 px-3 text-amber-400/90 text-xs font-heading">Coming soon</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const InfoCard = () => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        ℹ️ Quick Info
      </h3>
    </div>
    <div className="p-4">
      <div className="space-y-2 text-sm text-mutedForeground font-heading leading-relaxed">
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            Use <strong className="text-foreground">Travel</strong> to move between cities and explore different locations.
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            Access <strong className="text-foreground">Casino</strong> games in every city from the Casino menu.
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            <strong className="text-primary">Highest max bets</strong> are highlighted in gold.
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span className="text-mutedForeground/70">
            HOT and COLD city events coming soon.
          </span>
        </p>
      </div>
    </div>
  </div>
);

// Main component
export default function States() {
  const [data, setData] = useState({ cities: [], games: [] });
  const [loading, setLoading] = useState(true);
  const [bulletFactories, setBulletFactories] = useState([]);
  const [airports, setAirports] = useState([]);

  useEffect(() => {
    api.get('/states')
      .then((res) => setData({
        cities: res.data?.cities ?? [],
        games: res.data?.games ?? [],
        dice_owners: res.data?.dice_owners ?? {},
        roulette_owners: res.data?.roulette_owners ?? {},
        blackjack_owners: res.data?.blackjack_owners ?? {},
        horseracing_owners: res.data?.horseracing_owners ?? {},
      }))
      .catch(() => toast.error('Failed to load states'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.get('/bullet-factory/list').then((r) => setBulletFactories(r.data?.factories ?? [])).catch(() => {});
    api.get('/airports').then((r) => setAirports(r.data?.airports ?? [])).catch(() => {});
  }, []);

  const { cities, games, dice_owners, roulette_owners, blackjack_owners, horseracing_owners } = data;

  // Map game IDs to their owner data
  const allOwners = {
    dice: dice_owners || {},
    roulette: roulette_owners || {},
    blackjack: blackjack_owners || {},
    horseracing: horseracing_owners || {},
  };

  // For each game, find the highest max_bet across all cities.
  // A city gets gold text only if its max_bet is strictly the highest (not tied).
  const highestBets = useMemo(() => {
    const map = {}; // gameId -> { max, count }
    for (const game of games) {
      const bets = cities.map((city) => {
        const ownerMap = allOwners[game.id] || {};
        if (ownerMap[city]?.max_bet != null) {
          return ownerMap[city].max_bet;
        }
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
    if (ownerMap[city]?.max_bet != null) {
      return ownerMap[city].max_bet;
    }
    return game.max_bet;
  };

  const isHighestBet = (game, city) => {
    const bet = getEffectiveMaxBet(game, city);
    const info = highestBets[game.id];
    if (!info) return false;
    return bet === info.max && info.count < cities.length;
  };

  // 1 per state: bullet factory and airport (slot 1) for each city
  const bulletFactoryByState = useMemo(() => {
    const map = {};
    (bulletFactories || []).forEach((f) => { map[f.state] = f; });
    return map;
  }, [bulletFactories]);
  const airportSlot1ByState = useMemo(() => {
    const map = {};
    (airports || []).forEach((a) => {
      if (a.slot === 1) map[a.state] = a;
    });
    return map;
  }, [airports]);

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="states-page">
      <PageHeader />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
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
          />
        ))}
      </div>

      <InfoCard />
    </div>
  );
}
