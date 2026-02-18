import { Dice1, Spade, Hash, TrendingUp, Target, ChevronRight, Coins, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from '../styles/noir.module.css';

const CASINO_STYLES = `
  @keyframes cas-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .cas-fade-in { animation: cas-fade-in 0.4s ease-out both; }
  .cas-card { transition: all 0.3s ease; }
  .cas-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .cas-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const GAMES = [
  { to: '/casino/rlt', label: 'Roulette', desc: 'Wheel of fortune', Icon: Dice1, testId: 'play-roulette' },
  { to: '/casino/blackjack', label: 'Blackjack', desc: 'Beat the dealer to 21', Icon: Spade, testId: 'play-blackjack' },
  { to: '/casino/dice', label: 'Dice', desc: 'Roll for riches', Icon: Hash, testId: 'play-dice' },
  { to: '/casino/horseracing', label: 'Horse Racing', desc: 'Bet on the fastest', Icon: TrendingUp, testId: 'play-horse-racing' },
  { to: '/casino/slots', label: 'Slots', desc: 'State-owned · 1 per state', Icon: Coins, testId: 'play-slots' },
  { to: '/casino/videopoker', label: 'Video Poker', desc: 'Jacks or Better', Icon: Spade, testId: 'play-video-poker' },
  { to: '/sports-betting', label: 'Sports Betting', desc: 'Live games & results', Icon: Target, testId: 'sports-betting' },
  { to: '/crack-safe', label: 'Crack the Safe', desc: 'Daily jackpot · 5 numbers', Icon: Lock, testId: 'crack-safe' },
];

export default function Casino() {
  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="casino-page">
      <style>{CASINO_STYLES}</style>

      <div className="relative cas-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">The House</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">Casino</h1>
        <p className="text-[10px] text-zinc-500 font-heading italic mt-1">Roulette, Blackjack, Dice, Horse Racing, Slots, Sports.</p>
      </div>

      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 cas-fade-in`} style={{ animationDelay: '0.03s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Games</h2>
        </div>
        <div className="p-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {GAMES.map(({ to, label, desc, Icon, testId }, idx) => (
            <Link
              key={to}
              to={to}
              data-testid={testId}
              className={`cas-card flex items-center gap-3 px-3 py-2.5 rounded-lg border border-primary/20 bg-secondary/30 hover:bg-primary/10 transition-colors group cas-fade-in`}
              style={{ animationDelay: `${0.05 + idx * 0.02}s` }}
            >
              <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
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
        <div className="cas-art-line text-primary mx-3" />
      </div>
    </div>
  );
}
