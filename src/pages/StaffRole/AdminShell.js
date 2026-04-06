import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Search, User } from 'lucide-react';
import Admin from './Admin';
import { ADMIN_ROUTE_GROUP_MAP, ADMIN_ROUTE_GROUPS } from './adminToolMap';

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
  };

  if (!section) return <Navigate to="/staffrole/admin/overview" replace />;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-primary/25 bg-gradient-to-br from-zinc-900/85 via-zinc-900/65 to-zinc-800/55 p-3 md:p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-heading text-primary text-lg md:text-xl tracking-wide uppercase">Admin Command Center</h1>
              <p className="text-xs text-mutedForeground">Route-based tooling with consolidated sections and legacy-compatible anchors.</p>
            </div>
            <div className="hidden md:block text-[10px] text-mutedForeground font-heading uppercase tracking-wider">{routeGroup?.label}</div>
          </div>

          <div className="rounded-lg border border-primary/25 bg-zinc-950/45 p-2.5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <User size={14} className="text-primary" />
              <span className="text-[11px] font-heading uppercase text-mutedForeground tracking-wider">Target Player Context</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={targetPlayer}
                onChange={(e) => setTargetPlayer(e.target.value)}
                placeholder="username"
                className="h-8 w-44 rounded border border-zinc-700 bg-zinc-900 px-2 text-xs"
              />
              <button type="button" onClick={applyPlayerContext} className="h-8 px-3 rounded border border-primary/40 bg-primary/20 text-primary text-xs font-heading">
                Set Context
              </button>
              <button type="button" onClick={quickJumpToTarget} className="h-8 px-3 rounded border border-zinc-700 bg-zinc-900/70 text-xs font-heading inline-flex items-center gap-1">
                <Search size={12} />
                Jump
              </button>
            </div>
          </div>

          <nav className="sticky top-2 z-20 rounded-lg border border-primary/20 bg-zinc-950/75 backdrop-blur px-2 py-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-10 gap-1.5">
              {ADMIN_ROUTE_GROUPS.map((group) => {
                const active = group.id === routeGroup?.id;
                return (
                  <Link
                    key={group.id}
                    to={routeFor(group.id)}
                    className={`rounded-md border px-2 py-1.5 text-[11px] font-heading transition ${
                      active
                        ? 'border-primary/60 bg-primary/20 text-primary'
                        : 'border-zinc-700/70 bg-zinc-900/55 text-mutedForeground hover:text-foreground hover:border-primary/40'
                    }`}
                    title={group.description}
                  >
                    {group.label}
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
