import { useState, useEffect } from 'react';
import { Building, TrendingUp, DollarSign, Lock, Zap, Martini, Factory, Crown } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import ActiveTokenBadge from '../../components/ActiveTokenBadge';

const PROP_STYLES = `
  @keyframes prop-fade-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .prop-fade-in { animation: prop-fade-in 0.35s cubic-bezier(0.25,0.46,0.45,0.94) both; }
  .prop-card { transition: box-shadow 0.25s ease, transform 0.2s ease; }
  .prop-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.35), 0 0 0 1px rgba(var(--noir-primary-rgb),0.2), 0 0 20px rgba(var(--noir-primary-rgb),0.08); transform: translateY(-1px); }
  .prop-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.12; }
  .prop-tip-bullet { animation: prop-fade-in 0.3s ease-out both; }
  details.prop-fade-in summary::-webkit-details-marker { display: none; }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

export default function Properties() {
  const [properties, setProperties] = useState([]);
  const [propertyIncomePerkUntil, setPropertyIncomePerkUntil] = useState(null);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [attackLoading, setAttackLoading] = useState(null); // property_id+username
  const [collectAllLoading, setCollectAllLoading] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetchProperties();
    fetchTargets();
    api.get('/auth/me').then((r) => setUser(r.data)).catch(() => {});
  }, []);

  const fetchProperties = async () => {
    try {
      const response = await api.get('/properties');
      const data = response.data;
      setProperties(Array.isArray(data) ? data : (data?.properties ?? []));
      setPropertyIncomePerkUntil(data?.property_income_perk_until ?? null);
    } catch (error) {
      const detail = error.response?.data?.detail || error.message || 'Unknown error';
      toast.error(`Failed to load properties: ${detail}`);
      setProperties([]);
      setPropertyIncomePerkUntil(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchTargets = async () => {
    try {
      const res = await api.get('/racket/targets');
      setTargets(res.data?.targets ?? []);
    } catch {
      setTargets([]);
    }
  };

  const attackProperty = async (targetUsername, propertyId) => {
    const key = `${targetUsername}-${propertyId}`;
    setAttackLoading(key);
    try {
      const res = await api.post('/racket/extort', { target_username: targetUsername, property_id: propertyId });
      const data = res.data || {};
      if (data.success) {
        toast.success(data.message || `Took ${formatMoney(data.amount)}!`);
        refreshUser();
      } else {
        toast.error(data.message || 'Raid failed.');
      }
      fetchTargets();
      fetchProperties();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Attack failed');
    } finally {
      setAttackLoading(null);
    }
  };

  const buyProperty = async (propertyId) => {
    try {
      const response = await api.post(`/properties/${propertyId}/buy`);
      toast.success(response.data.message);
      refreshUser();
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy property');
    }
  };

  const collectIncome = async (propertyId) => {
    try {
      const response = await api.post(`/properties/${propertyId}/collect`);
      toast.success(response.data.message);
      refreshUser();
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to collect income');
    }
  };

  const collectibleProperties = properties.filter((p) => p.owned && !p.locked);
  const collectAll = async () => {
    if (collectibleProperties.length === 0 || collectAllLoading) return;
    setCollectAllLoading(true);
    let collected = 0;
    let total = 0;
    for (const prop of collectibleProperties) {
      try {
        const res = await api.post(`/properties/${prop.id}/collect`);
        collected++;
        const msg = res.data?.message || '';
        const match = msg.match(/\$([\d,]+(?:\.\d+)?)/);
        if (match) total += parseFloat(match[1].replace(/,/g, '')) || 0;
      } catch {
        toast.error(`Failed to collect from ${prop.name}`);
      }
    }
    if (collected > 0) {
      refreshUser();
      fetchProperties();
      toast.success(total > 0 ? `Collected $${Math.trunc(total).toLocaleString()} from ${collected} propert${collected === 1 ? 'y' : 'ies'}` : `Collected from ${collected} propert${collected === 1 ? 'y' : 'ies'}`);
    }
    setCollectAllLoading(false);
  };

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
        <style>{PROP_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Building size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="properties-page">
      <style>{PROP_STYLES}</style>

      <div className="relative prop-fade-in flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[9px] text-primary/50 font-heading uppercase tracking-[0.25em]">Investments</p>
          <p className="text-[10px] text-zinc-500 font-heading italic">Passive income from businesses.</p>
        </div>
        {user?.properties_until && (
          <ActiveTokenBadge tokenType="properties" untilIso={user.properties_until} compact />
        )}
        {propertyIncomePerkUntil && (() => {
          try {
            const until = new Date(propertyIncomePerkUntil.replace('Z', 'Z'));
            if (until <= new Date()) return null;
            const ms = until - new Date();
            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            return (
              <div className="flex items-center gap-1.5 text-[10px] font-heading text-amber-400/90 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
                <Zap size={10} className="shrink-0" />
                <span>Loot box: 10% property income for 24h ({h}h {m}m left)</span>
              </div>
            );
          } catch {
            return null;
          }
        })()}
        {collectibleProperties.length > 0 && (
          <button
            type="button"
            onClick={collectAll}
            disabled={collectAllLoading}
            className="text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/40 hover:bg-primary/10 rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation flex items-center gap-1.5"
          >
            <DollarSign size={12} />
            {collectAllLoading ? '...' : `Collect all (${collectibleProperties.length})`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {properties.map((property, idx) => (
          <div
            key={property.id}
            data-testid={`property-card-${property.id}`}
            className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 prop-card prop-fade-in mobile-panel`}
            style={{ animationDelay: `${0.02 + idx * 0.04}s` }}
          >
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2 bg-primary/8 border-b border-primary/15 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] truncate">
                  {property.owned_count > 1 ? `${property.owned_count}x ` : ''}{property.name}
                </h3>
                <p className="text-[9px] text-mutedForeground capitalize font-heading tracking-wider">
                  {property.property_type}
                  {property.stack_bonus_pct > 0 && (
                    <span className="ml-1 text-emerald-400/90">
                      · +{property.stack_bonus_pct}% stack
                    </span>
                  )}
                  {property.collection_streak_days > 1 && (
                    <span className="ml-1 text-amber-400/90">
                      · Streak {property.collection_streak_days}d
                    </span>
                  )}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                {property.name.includes('Speakeasy') && <Martini className="text-primary/70" size={16} />}
                {property.name.includes('Casino') && !property.name.includes('Speakeasy') && <Crown className="text-primary/70" size={16} />}
                {property.property_type === 'factory' && <Factory className="text-primary/70" size={16} />}
                <Building className="text-primary/40" size={16} />
              </div>
            </div>

            <div className="p-3">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2 text-[10px] font-heading">
                <span className="text-mutedForeground uppercase tracking-wider">Price</span>
                <span className="text-primary font-bold text-right">${property.price.toLocaleString()}</span>
                <span className="text-mutedForeground uppercase tracking-wider">Income/hr</span>
                <span className="text-foreground text-right">${property.income_per_hour.toLocaleString()}</span>
                {property.locked && property.required_property_name && (
                  <>
                    <span className="col-span-2 flex items-center gap-1 text-amber-400/90 mt-0.5">
                      <Lock size={9} className="shrink-0" /> Requires {property.required_property_name} max
                    </span>
                  </>
                )}
                {property.owned && (
                  <>
                    <span className="text-mutedForeground uppercase tracking-wider">Level</span>
                    <span className="text-foreground text-right">{(property.level ?? 0)}/{(property.max_level ?? 0)}</span>
                    <span className="text-mutedForeground uppercase tracking-wider">Available</span>
                    <span className="text-primary font-bold text-right">${Math.floor(property.available_income ?? 0).toLocaleString()}</span>
                  </>
                )}
              </div>

              {property.owned && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-[9px] font-heading text-mutedForeground mb-0.5">
                    <span>Safe for 24h</span>
                    <span>
                      {(property.hours_since_collect ?? 0).toFixed(1)}h since last collect
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500"
                      style={{
                        width: `${Math.min(100, ((property.hours_since_collect ?? 0) / 24) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                {property.owned ? (
                  <>
                    <button
                      onClick={() => collectIncome(property.id)}
                      data-testid={`collect-income-${property.id}`}
                      className="w-full bg-primary/20 text-primary rounded font-heading font-bold uppercase tracking-wider py-1.5 text-[10px] border border-primary/40 hover:bg-primary/30 transition-all flex items-center justify-center gap-1.5"
                    >
                      <DollarSign size={12} /> Collect
                    </button>
                    {property.level < property.max_level && (
                      <button
                        onClick={() => buyProperty(property.id)}
                        data-testid={`upgrade-property-${property.id}`}
                        className={`w-full ${styles.surface} border border-primary/30 text-primary rounded font-heading font-bold uppercase tracking-wider py-1.5 text-[10px] hover:bg-primary/10 transition-all flex items-center justify-center gap-1.5`}
                      >
                        <TrendingUp size={11} /> Upgrade ${((property.price ?? 0) * ((property.level ?? 0) + 1)).toLocaleString()}
                      </button>
                    )}
                    {property.owned && (
                      <>
                        {property.buff_label && (
                          <div className="text-[9px] text-amber-400/90 font-heading text-center">
                            {property.buff_label}
                          </div>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => !property.locked && buyProperty(property.id)}
                    data-testid={`buy-property-${property.id}`}
                    disabled={property.locked}
                    className={`w-full rounded font-heading font-bold uppercase tracking-wider py-1.5 text-[10px] border transition-all flex items-center justify-center gap-1.5 ${
                      property.locked
                        ? 'bg-zinc-800/50 text-zinc-500 border-zinc-600/50 cursor-not-allowed opacity-70'
                        : 'bg-primary/20 text-primary border-primary/40 hover:bg-primary/30'
                    }`}
                  >
                    {property.locked ? <><Lock size={11} /> Locked</> : 'Buy Property'}
                  </button>
                )}
              </div>
            </div>
            <div className="prop-art-line text-primary mx-3" />
          </div>
        ))}
      </div>

      <details className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 prop-fade-in mobile-panel`} style={{ animationDelay: `${0.02 + properties.length * 0.04}s` }}>
        <summary className="list-none cursor-pointer">
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2 bg-primary/8 border-b border-primary/15 flex items-center justify-between">
            <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Tips</h3>
            <span className="text-[9px] text-mutedForeground font-heading">▼</span>
          </div>
        </summary>
        <div className="p-3">
          <ul className="space-y-0.5 text-[10px] text-mutedForeground font-heading">
            {['Passive income per hour; buy in order, max each to unlock next.', 'Upgrade to boost income; accumulation caps at 24h.', 'Collect regularly to maximize earnings.'].map((tip, i) => (
              <li key={i} className="flex items-center gap-1.5 prop-tip-bullet" style={{ animationDelay: `${i * 0.05}s` }}>
                <span className="text-primary opacity-70">◆</span> {tip}
              </li>
            ))}
          </ul>
        </div>
        <div className="prop-art-line text-primary mx-3" />
      </details>
    </div>
  );
}
