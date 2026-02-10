import { Target, TrendingUp, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Ranking() {
  return (
    <div className="space-y-8" data-testid="ranking-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Ranking</h1>
        <p className="text-mutedForeground">Choose how you earn rank points</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          to="/crimes"
          data-testid="goto-crimes"
          className="bg-card border border-border hover:border-primary rounded-sm p-6 transition-smooth group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 rounded-sm flex items-center justify-center group-hover:scale-110 transition-transform">
              <TrendingUp className="text-primary" size={24} />
            </div>
            <div>
              <h3 className="text-xl font-heading font-bold text-foreground">Crimes</h3>
              <p className="text-sm text-mutedForeground">Commit crimes for cash + rank points</p>
            </div>
          </div>
        </Link>

        <Link
          to="/gta"
          data-testid="goto-gta"
          className="bg-card border border-border hover:border-primary rounded-sm p-6 transition-smooth group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 rounded-sm flex items-center justify-center group-hover:scale-110 transition-transform">
              <Target className="text-primary" size={24} />
            </div>
            <div>
              <h3 className="text-xl font-heading font-bold text-foreground">Grand Theft Auto</h3>
              <p className="text-sm text-mutedForeground">Steal cars to earn rank points</p>
            </div>
          </div>
        </Link>

        <Link
          to="/jail"
          data-testid="goto-jail"
          className="bg-card border border-border hover:border-primary rounded-sm p-6 transition-smooth group md:col-span-2"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 rounded-sm flex items-center justify-center group-hover:scale-110 transition-transform">
              <Lock className="text-primary" size={24} />
            </div>
            <div>
              <h3 className="text-xl font-heading font-bold text-foreground">Jail</h3>
              <p className="text-sm text-mutedForeground">Bust players out for rank points</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="bg-card border border-border rounded-sm p-6">
        <h3 className="text-xl font-heading font-semibold text-primary mb-3">Rank Points System</h3>
        <ul className="space-y-2 text-sm text-mutedForeground">
          <li>• Earn rank points from crimes, GTA, killing players, and busting jailed players</li>
          <li>• Rank up requires both money AND rank points</li>
          <li>• Higher ranks unlock better crimes and exclusive features</li>
          <li>• Check your rank progress in the Dashboard</li>
        </ul>
      </div>
    </div>
  );
}
