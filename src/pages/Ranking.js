import { Target, TrendingUp, Lock, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from '../styles/noir.module.css';

export default function Ranking() {
  return (
    <div className={`space-y-8 ${styles.pageContent}`} data-testid="ranking-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Ranking</h1>
        <p className="text-mutedForeground">Choose how you earn rank points</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          to="/crimes"
          data-testid="goto-crimes"
          className={`${styles.panel} rounded-md p-6 transition-smooth group block border border-transparent hover:border-primary/50`}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 rounded-md flex items-center justify-center group-hover:scale-110 transition-transform">
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
          className={`${styles.panel} rounded-md p-6 transition-smooth group block border border-transparent hover:border-primary/50`}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 rounded-md flex items-center justify-center group-hover:scale-110 transition-transform">
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
          className={`${styles.panel} rounded-md p-6 transition-smooth group block border border-transparent hover:border-primary/50`}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 rounded-md flex items-center justify-center group-hover:scale-110 transition-transform">
              <Lock className="text-primary" size={24} />
            </div>
            <div>
              <h3 className="text-xl font-heading font-bold text-foreground">Jail</h3>
              <p className="text-sm text-mutedForeground">Bust players out for rank points</p>
            </div>
          </div>
        </Link>

        <Link
          to="/organised-crime"
          data-testid="goto-organised-crime"
          className={`${styles.panel} rounded-md p-6 transition-smooth group block border border-transparent hover:border-primary/50`}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 rounded-md flex items-center justify-center group-hover:scale-110 transition-transform">
              <Users className="text-primary" size={24} />
            </div>
            <div>
              <h3 className="text-xl font-heading font-bold text-foreground">Organised Crime</h3>
              <p className="text-sm text-mutedForeground">Team heists: Driver, Weapons, Explosives, Hacker — high RP & cash</p>
            </div>
          </div>
        </Link>
      </div>

      <div className={`${styles.panel} rounded-md p-6`}>
        <h3 className="text-xl font-heading font-semibold text-primary mb-3">Rank Points System</h3>
        <ul className="space-y-2 text-sm text-mutedForeground">
          <li>• Earn rank points from crimes, GTA, jail busts, organised crime heists, and killing players</li>
          <li>• Rank up requires both money AND rank points</li>
          <li>• Higher ranks unlock better crimes and exclusive features</li>
          <li>• Check your rank progress in the Dashboard</li>
        </ul>
      </div>
    </div>
  );
}
