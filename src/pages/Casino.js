import { Dice1, Spade, Hash, TrendingUp, Target, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from '../styles/noir.module.css';

const GAMES = [
  { to: '/casino/rlt', label: 'Roulette', desc: 'Wheel of fortune', Icon: Dice1, testId: 'play-roulette' },
  { to: '/casino/blackjack', label: 'Blackjack', desc: 'Beat the dealer to 21', Icon: Spade, testId: 'play-blackjack' },
  { to: '/casino/dice', label: 'Dice', desc: 'Roll for riches', Icon: Hash, testId: 'play-dice' },
  { to: '/casino/horseracing', label: 'Horse Racing', desc: 'Bet on the fastest', Icon: TrendingUp, testId: 'play-horse-racing' },
  { to: '/sports-betting', label: 'Sports Betting', desc: 'Live games & results', Icon: Target, testId: 'sports-betting' },
];

export default function Casino() {
  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="casino-page">
      <div>
        <h1 className="text-xl font-heading font-bold text-primary uppercase tracking-widest">Casino</h1>
        <p className="text-[11px] text-mutedForeground font-heading mt-0.5">Test your luck — Roulette, Blackjack, Dice, Horse Racing, Sports</p>
      </div>

      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/30">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-widest">Games</h2>
        </div>
        <div className="p-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {GAMES.map(({ to, label, desc, Icon, testId }) => (
            <Link
              key={to}
              to={to}
              data-testid={testId}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-transparent hover:border-primary/40 bg-secondary/30 hover:bg-primary/10 transition-colors group"
            >
              <div className="p-1.5 rounded bg-primary/20 border border-primary/30 shrink-0">
                <Icon className="text-primary" size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-heading font-bold text-foreground truncate">{label}</p>
                <p className="text-[10px] text-mutedForeground font-heading truncate">{desc}</p>
              </div>
              <ChevronRight className="text-primary shrink-0 opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" size={16} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
