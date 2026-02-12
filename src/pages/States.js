import { useState, useEffect, useMemo } from 'react';
import { MapPin, Dice5, Spade, Trophy, CircleDot } from 'lucide-react';
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

export default function States() {
  const [data, setData] = useState({ cities: [], games: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/states')
      .then((res) => setData({
        cities: res.data?.cities ?? [],
        games: res.data?.games ?? [],
        dice_owners: res.data?.dice_owners ?? {},
      }))
      .catch(() => toast.error('Failed to load states'))
      .finally(() => setLoading(false));
  }, []);

  const { cities, games, dice_owners } = data;

  // For each game, find the highest max_bet across all cities.
  // A city gets gold text only if its max_bet is strictly the highest (not tied).
  const highestBets = useMemo(() => {
    const map = {}; // gameId -> { max, count }
    for (const game of games) {
      const bets = cities.map((city) => {
        if (game.id === 'dice' && dice_owners?.[city]?.max_bet != null) {
          return dice_owners[city].max_bet;
        }
        return game.max_bet;
      });
      const max = Math.max(...bets);
      const count = bets.filter((b) => b === max).length;
      map[game.id] = { max, count };
    }
    return map;
  }, [cities, games, dice_owners]);

  const getEffectiveMaxBet = (game, city) => {
    if (game.id === 'dice' && dice_owners?.[city]?.max_bet != null) {
      return dice_owners[city].max_bet;
    }
    return game.max_bet;
  };

  const isHighestBet = (game, city) => {
    const bet = getEffectiveMaxBet(game, city);
    const info = highestBets[game.id];
    if (!info) return false;
    // Gold only if this bet equals the max AND it's not the same across ALL cities
    return bet === info.max && info.count < cities.length;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`max-w-5xl mx-auto w-full space-y-6 ${styles.pageContent}`} data-testid="states-page">
      <div className="flex items-center justify-center flex-col gap-1 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">States & Cities</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Travel · Casino · City events</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {cities.map((city) => (
          <div
            key={city}
            className={`${styles.panel} rounded-sm overflow-hidden`}
            data-testid={`state-card-${city.replace(/\s+/g, '-').toLowerCase()}`}
          >
            <div className="px-3 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-primary shrink-0" />
                <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">{city}</h2>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-heading text-mutedForeground">
                <span>Residents: —</span>
                <span className="text-primary/40">·</span>
                <span>Event: —</span>
              </div>
            </div>

            <table className="w-full text-xs">
              <thead>
                <tr className="bg-zinc-800/40 text-[10px] uppercase tracking-widest font-heading text-primary/70">
                  <th className="text-left py-1.5 px-3">Casino</th>
                  <th className="text-left py-1.5 px-3">Owner</th>
                  <th className="text-left py-1.5 px-3">Wealth</th>
                  <th className="text-right py-1.5 px-3">Max Bet</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => {
                  const Icon = GAME_ICONS[game.id] || Dice5;
                  const owner = game.id === 'dice' ? (dice_owners || {})[city] : null;
                  const effectiveBet = getEffectiveMaxBet(game, city);
                  const isTop = isHighestBet(game, city);
                  return (
                    <tr
                      key={game.id}
                      className="border-b border-primary/10 hover:bg-zinc-800/30 transition-smooth"
                      data-testid={`game-${game.id}-${city.replace(/\s+/g, '-').toLowerCase()}`}
                    >
                      <td className="py-1.5 px-3">
                        <div className="flex items-center gap-2">
                          <Icon size={13} className="text-primary/60 shrink-0" />
                          <span className="font-heading font-bold text-foreground">{game.name}</span>
                        </div>
                      </td>
                      <td className="py-1.5 px-3 text-mutedForeground font-heading">{owner?.username ?? '—'}</td>
                      <td className="py-1.5 px-3 text-mutedForeground font-heading">{owner?.wealth_rank_name ?? '—'}</td>
                      <td className={`py-1.5 px-3 text-right font-heading font-bold ${isTop ? 'text-primary' : 'text-foreground'}`}>
                        {formatMaxBet(effectiveBet)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-3 py-1.5 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">Quick tip</span>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="px-3 py-2">
          <p className="text-[11px] text-mutedForeground font-heading flex items-center gap-2">
            <span className="text-primary">◆</span> Use <strong className="text-foreground">Travel</strong> to move between cities. Casino games in every city from the <strong className="text-foreground">Casino</strong> menu. HOT and COLD city events coming later.
          </p>
        </div>
      </div>
    </div>
  );
}
