import { Dice1, Spade, Hash, TrendingUp, Target } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Casino() {
  return (
    <div className="space-y-8" data-testid="casino-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Casino</h1>
        <p className="text-mutedForeground">Test your luck in the underground casino</p>
      </div>

      <div
        className="relative h-64 rounded-sm overflow-hidden vintage-filter mb-8"
        style={{
          backgroundImage: 'url(https://images.unsplash.com/photo-1745473383212-59428c1156bc?w=1920&q=80)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent"></div>
        <div className="absolute bottom-6 left-6">
          <h2 className="text-3xl font-heading font-bold text-primary">The Roaring Twenties</h2>
          <p className="text-foreground/80 text-sm">Where fortunes are made and lost</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link
          to="/casino/rlt"
          className="bg-card border border-border rounded-sm p-6 hover:border-primary/50 transition-smooth group block"
          data-testid="play-roulette"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-2xl font-heading font-bold text-foreground mb-2">Roulette</h3>
              <p className="text-sm text-mutedForeground">Classic wheel of fortune</p>
            </div>
            <Dice1 className="text-primary group-hover:rotate-180 transition-transform duration-500" size={32} />
          </div>
          <span className="block w-full bg-primary text-primaryForeground text-center rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth">
            Play Roulette
          </span>
        </Link>

        <Link
          to="/casino/blackjack"
          className="bg-card border border-border rounded-sm p-6 hover:border-primary/50 transition-smooth group block"
          data-testid="play-blackjack"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-2xl font-heading font-bold text-foreground mb-2">Blackjack</h3>
              <p className="text-sm text-mutedForeground">Beat the dealer to 21</p>
            </div>
            <Spade className="text-primary group-hover:scale-110 transition-transform" size={32} />
          </div>
          <span className="block w-full bg-primary text-primaryForeground text-center rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth">
            Play Blackjack
          </span>
        </Link>

        <Link
          to="/casino/dice"
          className="bg-card border border-border rounded-sm p-6 hover:border-primary/50 transition-smooth group block"
          data-testid="play-dice"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-2xl font-heading font-bold text-foreground mb-2">Dice</h3>
              <p className="text-sm text-mutedForeground">Roll for riches</p>
            </div>
            <Hash className="text-primary group-hover:rotate-45 transition-transform" size={32} />
          </div>
          <span className="block w-full bg-primary text-primaryForeground text-center rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth">
            Play Dice
          </span>
        </Link>

        <Link
          to="/casino/horseracing"
          className="bg-card border border-border rounded-sm p-6 hover:border-primary/50 transition-smooth group block"
          data-testid="play-horse-racing"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-2xl font-heading font-bold text-foreground mb-2">Horse Racing</h3>
              <p className="text-sm text-mutedForeground">Bet on the fastest horse</p>
            </div>
            <TrendingUp className="text-primary group-hover:translate-x-2 transition-transform" size={32} />
          </div>
          <span className="block w-full bg-primary text-primaryForeground text-center rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth">
            Play Horse Racing
          </span>
        </Link>

        <Link
          to="/sports-betting"
          className="bg-card border border-border rounded-sm p-6 hover:border-primary/50 transition-smooth group block"
          data-testid="sports-betting"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-2xl font-heading font-bold text-foreground mb-2">Sports Betting</h3>
              <p className="text-sm text-mutedForeground">Live games & results</p>
            </div>
            <Target className="text-primary group-hover:scale-110 transition-transform" size={32} />
          </div>
          <span className="block w-full bg-primary text-primaryForeground text-center rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth">
            Place Bets
          </span>
        </Link>
      </div>

      <div className="bg-card border border-border rounded-sm p-6">
        <h3 className="text-xl font-heading font-semibold text-primary mb-3">Casino Games</h3>
        <p className="text-sm text-mutedForeground">
          The casino is under construction. Classic prohibition-era games coming soon, including Roulette, 
          Blackjack, Dice, and Horse Racing. Check back later to test your luck!
        </p>
      </div>
    </div>
  );
}
