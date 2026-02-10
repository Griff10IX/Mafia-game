import { useState, useEffect } from 'react';
import { MapPin, Dice5, Spade, Trophy, CircleDot } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

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
    <div className="max-w-5xl mx-auto w-full space-y-8" data-testid="states-page">
      <div className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Locations</div>
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mt-2">States & Cities</h1>
        <p className="text-sm text-mutedForeground mt-2">Travel to any city and hit the casino. HOT and COLD events will apply per city when enabled.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {cities.map((city) => (
          <div
            key={city}
            className="bg-card border border-border rounded-sm overflow-hidden"
            data-testid={`state-card-${city.replace(/\s+/g, '-').toLowerCase()}`}
          >
            {/* City header: name + optional residents + HOT/COLD event placeholder */}
            <div className="px-4 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <MapPin size={20} className="text-primary shrink-0" />
                <h2 className="text-xl font-heading font-bold text-foreground">{city}</h2>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-xs text-mutedForeground">Residents: —</span>
                <span className="text-mutedForeground/60">·</span>
                {/* Placeholder for HOT/COLD events (to be added later) */}
                <span className="text-xs text-mutedForeground" data-event-slot>
                  Event: —
                </span>
              </div>
            </div>

            {/* Casino table: Casino, Owner, Wealth, Max bet */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary/40 text-xs uppercase tracking-wider text-mutedForeground">
                    <th className="text-left py-2.5 px-3 font-semibold">Casino</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Owner</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Wealth</th>
                    <th className="text-right py-2.5 px-3 font-semibold">Max bet</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((game, idx) => {
                    const Icon = GAME_ICONS[game.id] || Dice5;
                    const owner = game.id === 'dice' ? (dice_owners || {})[city] : null;
                    return (
                      <tr
                        key={game.id}
                        className={`border-t border-border/50 ${idx % 2 === 0 ? 'bg-background/30' : 'bg-background/50'}`}
                        data-testid={`game-${game.id}-${city.replace(/\s+/g, '-').toLowerCase()}`}
                      >
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <Icon size={16} className="text-primary shrink-0" />
                            <span className="font-medium text-foreground">{game.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-mutedForeground">{owner?.username ?? '—'}</td>
                        <td className="py-2.5 px-3 text-mutedForeground">{owner?.wealth_rank_name ?? '—'}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-primary">{formatMaxBet(game.max_bet)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-sm p-4">
        <p className="text-sm text-mutedForeground">
          Use <strong className="text-foreground">Travel</strong> to move between cities. Casino games are available in every city from the <strong className="text-foreground">Casino</strong> menu. HOT and COLD city events will be added later.
        </p>
      </div>
    </div>
  );
}
