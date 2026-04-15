import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Search, User, ChevronDown } from 'lucide-react';
import Admin from './Admin';
import {
  ADMIN_ROUTE_GROUP_MAP,
  ADMIN_ROUTE_GROUPS,
  ADMIN_ROUTE_GROUP_MOBILE_SHORT,
} from './adminToolMap';

function routeFor(groupId) {
  return `/staffrole/admin/${groupId}`;
}

const LEGACY_HASH_TO_ROUTE_GROUP = {
  'admin-players': 'players',
  'admin-moderation': 'moderation',
  'admin-donations': 'commerce',
  'admin-quick': 'commerce',
  'admin-gameworld': 'liveops',
  'admin-testing': 'engineering',
  'admin-database': 'engineering',
  'admin-security': 'safety',
  'admin-cheat': 'safety',
  'admin-analytics': 'analytics',
  'admin-logs': 'logs',
  'admin-staff': 'staff',
};

export default function AdminShell() {
  const { section } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [targetPlayer, setTargetPlayer] = useState('');
  const [targetContextOpen, setTargetContextOpen] = useState(false);

  const routeGroup = useMemo(() => {
    const key = (section || 'overview').toLowerCase();
    return ADMIN_ROUTE_GROUP_MAP[key] || ADMIN_ROUTE_GROUP_MAP.overview;
  }, [section]);

  useEffect(() => {
    if (!section) {
      const hash = (typeof window !== 'undefined' ? (window.location.hash || '').replace('#', '').trim() : '');
      const redirectedSection = LEGACY_HASH_TO_ROUTE_GROUP[hash] || 'overview';
      navigate(`/staffrole/admin/${redirectedSection}`, { replace: true });
    }
  }, [section, navigate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const targetHash = routeGroup?.categoryId || 'admin-operations';
    if (window.location.hash !== `#${targetHash}`) {
      window.location.hash = targetHash;
    }
    const focusGp = new URLSearchParams(location.search).get('focus') === 'game_pass_inspector';
    const scrollId = focusGp ? 'admin-game-pass-inspector' : routeGroup?.anchorId;
    if (scrollId) {
      const delay = focusGp ? 300 : 120;
      window.setTimeout(() => {
        document.getElementById(scrollId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, delay);
    }
  }, [routeGroup, location.pathname, location.search]);

  const quickJumpToTarget = () => {
    if (typeof window === 'undefined') return;
    window.location.hash = 'admin-operations';
    window.setTimeout(() => {
      document.getElementById('admin-target-username')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  };

  const applyPlayerContext = () => {
    const next = (targetPlayer || '').trim();
    if (!next) return;
    navigate(`${routeFor('players')}?target=${encodeURIComponent(next)}`);
    quickJumpToTarget();
    setTargetContextOpen(false);
  };

  if (!section) return <Navigate to="/staffrole/admin/overview" replace />;

  return (
    <div className="space-y-3 md:space-y-4">
      <section className="rounded-xl border border-primary/25 bg-gradient-to-br from-zinc-900/85 via-zinc-900/65 to-zinc-800/55 p-3 md:p-4">
        <div className="flex flex-col gap-2 md:gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="font-heading text-primary text-base sm:text-lg md:text-xl tracking-wide uppercase truncate">
                Admin Command Center
              </h1>
              <p className="hidden sm:block text-xs text-mutedForeground">
                Route-based tooling with consolidated sections and legacy-compatible anchors. Timestamps use UK time (GMT / BST).
              </p>
            </div>
            <div className="hidden md:block shrink-0 text-[10px] text-mutedForeground font-heading uppercase tracking-wider">
              {routeGroup?.label}
            </div>
          </div>

          <div className="rounded-lg border border-primary/25 bg-zinc-950/45 overflow-hidden">
            <button
              type="button"
              className="md:hidden w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left min-h-[44px] border-b border-primary/15"
              onClick={() => setTargetContextOpen((o) => !o)}
              aria-expanded={targetContextOpen}
            >
              <span className="flex items-center gap-2 min-w-0">
                <User size={16} className="text-primary shrink-0" />
                <span className="text-xs font-heading uppercase text-mutedForeground tracking-wider truncate">
                  Target player
                </span>
              </span>
              <ChevronDown
                size={18}
                className={`text-primary/80 shrink-0 transition-transform ${targetContextOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            <div
              className={`${targetContextOpen ? 'block' : 'hidden'} md:block px-3 pb-3 pt-0 md:p-2.5 md:flex md:flex-row md:items-center md:justify-between md:gap-3`}
            >
              <div className="hidden md:flex items-center gap-2 pt-2.5 md:pt-0">
                <User size={14} className="text-primary" />
                <span className="text-[11px] font-heading uppercase text-mutedForeground tracking-wider">
                  Target Player Context
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 pt-3 md:pt-0 w-full md:w-auto">
                <input
                  type="text"
                  value={targetPlayer}
                  onChange={(e) => setTargetPlayer(e.target.value)}
                  placeholder="username"
                  className="h-11 md:h-8 w-full sm:flex-1 sm:min-w-[12rem] md:w-44 rounded border border-zinc-700 bg-zinc-900 px-3 md:px-2 text-sm md:text-xs"
                />
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={applyPlayerContext}
                    className="h-11 md:h-8 flex-1 sm:flex-none px-4 md:px-3 rounded border border-primary/40 bg-primary/20 text-primary text-sm md:text-xs font-heading min-h-[44px] md:min-h-0"
                  >
                    Set context
                  </button>
                  <button
                    type="button"
                    onClick={quickJumpToTarget}
                    className="h-11 md:h-8 px-4 md:px-3 rounded border border-zinc-700 bg-zinc-900/70 text-sm md:text-xs font-heading inline-flex items-center justify-center gap-1.5 min-h-[44px] md:min-h-0 min-w-[44px] md:min-w-0"
                    title="Scroll to target field"
                  >
                    <Search size={16} className="md:w-3 md:h-3" />
                    <span className="md:inline">Jump</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <nav
            className="sticky top-2 z-20 rounded-lg border border-primary/20 bg-zinc-950/90 backdrop-blur px-1.5 py-2 md:px-2"
            aria-label="Admin areas"
          >
            <div className="flex md:hidden gap-1.5 overflow-x-auto pb-0.5 snap-x snap-mandatory touch-pan-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {ADMIN_ROUTE_GROUPS.map((group) => {
                const active = group.id === routeGroup?.id;
                const Icon = group.icon;
                const short = ADMIN_ROUTE_GROUP_MOBILE_SHORT[group.id] || group.label;
                return (
                  <Link
                    key={group.id}
                    to={routeFor(group.id)}
                    className={`snap-start shrink-0 flex flex-col items-center justify-center gap-0.5 min-w-[4.5rem] max-w-[5.5rem] min-h-[48px] px-1.5 py-1 rounded-lg border text-center transition ${
                      active
                        ? 'border-primary/70 bg-primary/25 text-primary shadow-[0_0_12px_rgba(var(--noir-primary-rgb),0.12)]'
                        : 'border-zinc-700/70 bg-zinc-900/55 text-mutedForeground hover:text-foreground hover:border-primary/40'
                    }`}
                    title={group.description}
                  >
                    {Icon && <Icon size={18} className="shrink-0 opacity-95" strokeWidth={2} />}
                    <span className="text-[9px] font-heading font-bold uppercase tracking-wide leading-tight line-clamp-2">
                      {short}
                    </span>
                  </Link>
                );
              })}
            </div>
            <div className="hidden md:grid md:grid-cols-5 xl:grid-cols-10 gap-1.5">
              {ADMIN_ROUTE_GROUPS.map((group) => {
                const active = group.id === routeGroup?.id;
                const Icon = group.icon;
                return (
                  <Link
                    key={group.id}
                    to={routeFor(group.id)}
                    className={`rounded-md border px-2 py-1.5 text-[11px] font-heading transition flex items-center gap-1.5 min-w-0 ${
                      active
                        ? 'border-primary/60 bg-primary/20 text-primary'
                        : 'border-zinc-700/70 bg-zinc-900/55 text-mutedForeground hover:text-foreground hover:border-primary/40'
                    }`}
                    title={group.description}
                  >
                    {Icon && <Icon size={14} className="shrink-0 opacity-90" />}
                    <span className="truncate">{group.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </section>

      <Admin />
    </div>
  );
}
