import { useState, useEffect } from 'react';
import { Building, TrendingUp, DollarSign, Lock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const PROP_STYLES = `
  @keyframes prop-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .prop-fade-in { animation: prop-fade-in 0.4s ease-out both; }
  .prop-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .prop-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

export default function Properties() {
  const [properties, setProperties] = useState([]);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [attackLoading, setAttackLoading] = useState(null); // property_id+username

  useEffect(() => {
    fetchProperties();
    fetchTargets();
  }, []);

  const fetchProperties = async () => {
    try {
      const response = await api.get('/properties');
      setProperties(response.data);
    } catch (error) {
      toast.error('Failed to load properties');
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

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
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
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="properties-page">
      <style>{PROP_STYLES}</style>

      <div className="relative prop-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Investments</p>
        <p className="text-[10px] text-zinc-500 font-heading italic">Invest in businesses to generate passive income.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {properties.map((property, idx) => (
          <div
            key={property.id}
            data-testid={`property-card-${property.id}`}
            className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 prop-card prop-fade-in transition-all`}
            style={{ animationDelay: `${0.03 + idx * 0.02}s` }}
          >
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            {/* Card Header */}
            <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">{property.name}</h3>
                  <p className="text-xs text-mutedForeground capitalize font-heading tracking-wider">{property.property_type}</p>
                </div>
                <Building className="text-primary/60" size={24} />
              </div>
            </div>

            {/* Card Body */}
            <div className="p-4">
              <div className="space-y-1 mb-4">
                <div className="flex items-center justify-between text-sm py-1 border-b border-primary/10">
                  <span className="text-mutedForeground font-heading uppercase tracking-wider text-xs">Price:</span>
                  <span className="text-primary font-heading font-bold">
                    ${property.price.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm py-1 border-b border-primary/10">
                  <span className="text-mutedForeground font-heading uppercase tracking-wider text-xs">Income/Hour:</span>
                  <span className="text-foreground font-heading">
                    ${property.income_per_hour.toLocaleString()}
                  </span>
                </div>
                {property.locked && property.required_property_name && (
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-400/90 font-heading py-1 border-b border-primary/10">
                    <Lock size={10} className="shrink-0" />
                    <span>Requires {property.required_property_name} at max level</span>
                  </div>
                )}
                {property.owned && (
                  <>
                    <div className="flex items-center justify-between text-sm py-1 border-b border-primary/10">
                      <span className="text-mutedForeground font-heading uppercase tracking-wider text-xs">Level:</span>
                      <span className="text-foreground font-heading">
                        {property.level} / {property.max_level}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm py-1">
                      <span className="text-mutedForeground font-heading uppercase tracking-wider text-xs">Available:</span>
                      <span className="text-primary font-heading font-bold">
                        ${property.available_income.toFixed(2)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-2">
                {property.owned ? (
                  <>
                    {property.available_income >= 1 && (
                      <button
                        onClick={() => collectIncome(property.id)}
                        data-testid={`collect-income-${property.id}`}
                        className="w-full bg-primary/20 text-primary rounded-sm font-heading font-bold uppercase tracking-widest py-2 text-sm border border-primary/40 hover:bg-primary/30 transition-smooth"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <DollarSign size={16} />
                          Collect Income
                        </div>
                      </button>
                    )}
                    {property.level < property.max_level && (
                      <button
                        onClick={() => buyProperty(property.id)}
                        data-testid={`upgrade-property-${property.id}`}
                        className={`w-full ${styles.surface} ${styles.raisedHover} border border-primary/30 text-primary rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-xs transition-smooth`}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <TrendingUp size={14} />
                          Upgrade (${(property.price * (property.level + 1)).toLocaleString()})
                        </div>
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => !property.locked && buyProperty(property.id)}
                    data-testid={`buy-property-${property.id}`}
                    disabled={property.locked}
                    className={`w-full rounded-sm font-heading font-bold uppercase tracking-widest py-2 text-sm transition-smooth border ${
                      property.locked
                        ? 'bg-zinc-800/50 text-zinc-500 border-zinc-600/50 cursor-not-allowed opacity-70'
                        : 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 shadow-lg'
                    }`}
                  >
                    {property.locked ? (
                      <div className="flex items-center justify-center gap-2">
                        <Lock size={14} />
                        Locked
                      </div>
                    ) : (
                      'Buy Property'
                    )}
                  </button>
                )}
              </div>
            </div>
            <div className="prop-art-line text-primary mx-4" />
          </div>
        ))}
      </div>

      {/* Info Box */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 prop-fade-in`} style={{ animationDelay: '0.1s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Investment Tips</h3>
        </div>
        <div className="p-4">
          <ul className="space-y-1 text-xs text-mutedForeground font-heading">
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Properties generate passive income per hour</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Buy in order — max out each property to unlock the next; first pays least, last pays most</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Upgrade properties to increase income generation</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Income accumulates up to 24 hours maximum</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Collect income regularly to maximize earnings</li>
          </ul>
        </div>
        <div className="prop-art-line text-primary mx-4" />
      </div>
    </div>
  );
}
