import { Link } from 'react-router-dom';
import { ShoppingBag, ChevronRight, Heart, Crosshair, Zap } from 'lucide-react';
import styles from '../../styles/noir.module.css';

function formatInt(n) {
  const num = Number(n ?? 0);
  return Number.isNaN(num) ? '0' : Math.floor(num).toLocaleString();
}

export default function StoreWidget({ user }) {
  const points = Number(user?.points ?? 0);
  const bullets = Number(user?.bullets ?? 0);
  const health = Number(user?.health ?? 100);
  const healthPct = Math.max(0, Math.min(100, Math.round(health)));

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
          <ShoppingBag size={10} />
          Store
        </h2>
        <Link to="/game/store" className="text-[9px] font-heading text-primary hover:text-primary/80 flex items-center gap-0.5">
          Browse <ChevronRight size={10} />
        </Link>
      </div>
      <div className="p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] font-heading">
          <span className="text-mutedForeground">Points</span>
          <span className="font-bold text-primary tabular-nums">{formatInt(points)}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] font-heading">
          <span className="text-mutedForeground flex items-center gap-1">
            <Heart size={10} className="text-primary" /> Health
          </span>
          <span className={`tabular-nums ${healthPct > 50 ? 'text-emerald-400' : healthPct > 25 ? 'text-amber-400' : 'text-red-400'}`}>
            {healthPct}%
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px] font-heading">
          <span className="text-mutedForeground flex items-center gap-1">
            <Crosshair size={10} className="text-primary" /> Bullets
          </span>
          <span className="font-bold text-foreground tabular-nums">{formatInt(bullets)}</span>
        </div>
        <div className="flex flex-wrap gap-1 pt-1">
          <Link
            to="/game/store?tab=upgrades"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/5 hover:bg-primary/15 text-[9px] font-heading text-primary"
          >
            <Zap size={9} /> Upgrades
          </Link>
          <Link
            to="/game/store?tab=bullets"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/5 hover:bg-primary/15 text-[9px] font-heading text-primary"
          >
            <Crosshair size={9} /> Bullets
          </Link>
        </div>
      </div>
    </div>
  );
}
