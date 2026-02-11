import { useState, useEffect } from 'react';
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  const { cities, games, dice_owners } = data;

  return (
    <div className={`max-w-5xl mx-auto w-full space-y-8 ${styles.pageContent}`} data-testid="states-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">States & Cities</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest mt-1">Travel to any city · hit the casino · HOT/COLD events per city when enabled</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {cities.map((city) => (
          <div
            key={city}
            className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}
            data-testid={`state-card-${city.replace(/\s+/g, '-').toLowerCase()}`}
          >
            {/* City header: name + optional residents + HOT/COLD event placeholder */}
            <div className="px-4 py-3 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <MapPin size={18} className="text-primary shrink-0" />
                <h2 className="text-lg font-heading font-bold text-primary uppercase tracking-wider">{city}</h2>
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs font-heading text-mutedForeground">
                <span>Residents: —</span>
                <span className="text-primary/50">·</span>
                <span data-event-slot>Event: —</span>
              </div>
            </div>

            {/* Casino table: Casino, Owner, Wealth, Max bet */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`${styles.surfaceMuted} text-xs uppercase tracking-widest font-heading text-primary/80`}>
                    <th className="text-left py-2 px-3">Casino</th>
                    <th className="text-left py-2 px-3">Owner</th>
                    <th className="text-left py-2 px-3">Wealth</th>
                    <th className="text-right py-2 px-3">Max bet</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((game) => {
                    const Icon = GAME_ICONS[game.id] || Dice5;
                    const owner = game.id === 'dice' ? (dice_owners || {})[city] : null;
                    return (
                      <tr
                        key={game.id}
                        className="border-b border-primary/10 hover:bg-zinc-800/30 transition-smooth"
                        data-testid={`game-${game.id}-${city.replace(/\s+/g, '-').toLowerCase()}`}
                      >
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <Icon size={16} className="text-primary shrink-0" />
                            <span className="font-heading font-bold text-foreground">{game.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-mutedForeground font-heading">{owner?.username ?? '—'}</td>
                        <td className="py-2 px-3 text-mutedForeground font-heading">{owner?.wealth_rank_name ?? '—'}</td>
                        <td className="py-2 px-3 text-right font-heading font-bold text-primary">{formatMaxBet(game.max_bet)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden">
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Quick tip</span>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-4">
          <p className="text-xs text-mutedForeground font-heading flex items-center gap-2">
            <span className="text-primary">◆</span> Use <strong className="text-foreground">Travel</strong> to move between cities. Casino games in every city from the <strong className="text-foreground">Casino</strong> menu. HOT and COLD city events coming later.
          </p>
        </div>
      </div>
    </div>
  );
}
