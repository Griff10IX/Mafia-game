import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Search, X } from 'lucide-react';
import {
  ADMIN_CATEGORIES,
  ADMIN_ROUTE_GROUPS,
  LAYOUT_STAFF_FAVORITE_IDS,
  ADMIN_ROUTE_GROUP_MAP,
  SEARCHABLE_TOOLS,
  LEGACY_CATEGORY_MAP,
  routesByCategory,
  modStaffRouteGroups,
} from './adminToolMap';
import { useStaffAccessVerify } from './staffAccessVerifyContext';

const normalizeCategoryId = (id) => LEGACY_CATEGORY_MAP[id] || id;

export default function AdminOverview({ isFullAdmin = true }) {
  const navigate = useNavigate();
  const verifyStaffAccess = useStaffAccessVerify();
  const [toolSearch, setToolSearch] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  const visibleGroups = useMemo(
    () => (isFullAdmin ? ADMIN_ROUTE_GROUPS : modStaffRouteGroups()),
    [isFullAdmin],
  );
  const byCategory = useMemo(() => routesByCategory(visibleGroups), [visibleGroups]);
  const favorites = useMemo(
    () => LAYOUT_STAFF_FAVORITE_IDS
      .map((id) => ADMIN_ROUTE_GROUP_MAP[id])
      .filter((g) => g && visibleGroups.some((v) => v.id === g.id)),
    [visibleGroups],
  );

  const filteredTools = useMemo(() => {
    if (!toolSearch.trim()) return [];
    const raw = toolSearch.toLowerCase().trim();
    const words = raw.split(/\s+/).filter(Boolean);
    return SEARCHABLE_TOOLS.filter((tool) => {
      if (!isFullAdmin && tool.adminOnly) return false;
      const label = tool.label.toLowerCase();
      const kws = (tool.keywords || []).map((k) => k.toLowerCase());
      if (label.includes(raw) || kws.some((k) => k.includes(raw))) return true;
      return words.length > 0 && words.every((w) => label.includes(w) || kws.some((kw) => kw.includes(w)));
    })
      .map((tool) => ({ ...tool, categoryId: normalizeCategoryId(tool.categoryId) }))
      .slice(0, 24);
  }, [toolSearch, isFullAdmin]);

  const openTool = async (tool) => {
    if (!(await verifyStaffAccess())) return;
    setToolSearch('');
    setFocused(false);
    if (tool.routePath) {
      navigate(tool.routePath);
      return;
    }
    const cat = normalizeCategoryId(tool.categoryId);
    const hub =
      tool.hubRoute
        || (cat === 'admin-economy-progression' ? 'commerce'
          : cat === 'admin-world-systems' ? 'liveops'
            : cat === 'admin-analytics-monitoring' ? 'logs'
              : 'players');
    navigate(`/tjjeujr3wa/${hub}`);
  };

  const go = async (path) => {
    if (!(await verifyStaffAccess())) return;
    navigate(path);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/25 bg-zinc-950/70 p-4 space-y-3">
        <h2 className="font-heading text-sm uppercase tracking-[0.18em] text-primary">Command center</h2>
        <p className="text-[11px] text-mutedForeground">Search any tool, or open a category below. Heavy panels only load when you enter that hub.</p>
        <div className="relative max-w-xl">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mutedForeground" />
          <input
            ref={inputRef}
            type="text"
            value={toolSearch}
            onChange={(e) => setToolSearch(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filteredTools[0]) {
                e.preventDefault();
                void openTool(filteredTools[0]);
              }
            }}
            placeholder="Search tools…"
            className="w-full min-h-[44px] pl-8 pr-9 py-2 rounded-md border border-primary/30 bg-zinc-900/80 text-sm font-heading text-foreground placeholder:text-mutedForeground focus:border-primary/60 focus:outline-none"
          />
          {toolSearch ? (
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-mutedForeground" onClick={() => { setToolSearch(''); inputRef.current?.focus(); }}>
              <X size={12} />
            </button>
          ) : null}
          {focused && filteredTools.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 z-30 max-h-64 overflow-y-auto rounded-md border border-primary/30 bg-zinc-900 shadow-lg">
              {filteredTools.map((tool, idx) => {
                const category = ADMIN_CATEGORIES.find((c) => c.id === tool.categoryId);
                return (
                  <button
                    key={`${tool.label}-${idx}`}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); void openTool(tool); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-primary/20 border-b border-zinc-800 last:border-b-0"
                  >
                    {category?.icon ? <category.icon size={12} className="text-primary shrink-0" /> : null}
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-heading font-bold truncate">{tool.label}</div>
                      <div className="text-[9px] text-mutedForeground">{category?.label || ''}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {favorites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] font-heading uppercase tracking-widest text-mutedForeground">Favorites</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {favorites.map((g) => {
              const Icon = g.icon;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => void go(`/tjjeujr3wa/${g.id}`)}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-900/60 px-3 py-2.5 text-left hover:border-primary/40 hover:bg-primary/10"
                >
                  {Icon ? <Icon size={14} className="text-primary shrink-0" /> : null}
                  <span className="text-[11px] font-heading font-bold truncate">{g.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {ADMIN_CATEGORIES.map((cat) => {
          const tools = byCategory[cat.id] || [];
          if (!tools.length) return null;
          const CatIcon = cat.icon;
          return (
            <div key={cat.id} className="rounded-xl border border-primary/20 bg-zinc-950/60 overflow-hidden">
              <div className="px-3 py-2.5 border-b border-primary/15 flex items-center gap-2 bg-primary/5">
                {CatIcon ? <CatIcon size={14} className="text-primary" /> : null}
                <span className="text-[11px] font-heading font-bold uppercase tracking-wider text-primary">{cat.label}</span>
              </div>
              <ul className="divide-y divide-zinc-800/80">
                {tools.filter((t) => t.id !== 'overview').map((g) => {
                  const Icon = g.icon;
                  return (
                    <li key={g.id}>
                      <Link
                        to={`/tjjeujr3wa/${g.id}`}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                          e.preventDefault();
                          void go(`/tjjeujr3wa/${g.id}`);
                        }}
                        className="flex items-center gap-2 px-3 py-2 text-[11px] font-heading hover:bg-primary/10"
                      >
                        {Icon ? <Icon size={13} className="text-primary/80 shrink-0" /> : null}
                        <span className="flex-1 truncate text-foreground">{g.label}</span>
                        <ChevronRight size={12} className="text-mutedForeground shrink-0" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
