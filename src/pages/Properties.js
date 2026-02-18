import { useState, useEffect } from 'react';
import { Building, TrendingUp, DollarSign, Lock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="properties-page">
      <style>{PROP_STYLES}</style>

      <div className="relative prop-fade-in flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[9px] text-primary/50 font-heading uppercase tracking-[0.25em]">Investments</p>
          <p className="text-[10px] text-zinc-500 font-heading italic">Passive income from businesses.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {properties.map((property, idx) => (
          <div
            key={property.id}
            data-testid={`property-card-${property.id}`}
            className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 prop-card prop-fade-in`}
            style={{ animationDelay: `${0.02 + idx * 0.04}s` }}
          >
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2 bg-primary/8 border-b border-primary/15 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] truncate">{property.name}</h3>
                <p className="text-[9px] text-mutedForeground capitalize font-heading tracking-wider">{property.property_type}</p>
              </div>
              <Building className="text-primary/50 shrink-0" size={18} />
            </div>

            <div className="p-3">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-3 text-[10px] font-heading">
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
                    <span className="text-foreground text-right">{property.level}/{property.max_level}</span>
                    <span className="text-mutedForeground uppercase tracking-wider">Available</span>
                    <span className="text-primary font-bold text-right">${property.available_income.toFixed(2)}</span>
                  </>
                )}
              </div>

              <div className="space-y-1.5">
                {property.owned ? (
                  <>
                    {property.available_income >= 1 && (
                      <button
                        onClick={() => collectIncome(property.id)}
                        data-testid={`collect-income-${property.id}`}
                        className="w-full bg-primary/20 text-primary rounded font-heading font-bold uppercase tracking-wider py-1.5 text-[10px] border border-primary/40 hover:bg-primary/30 transition-all flex items-center justify-center gap-1.5"
                      >
                        <DollarSign size={12} /> Collect
                      </button>
                    )}
                    {property.level < property.max_level && (
                      <button
                        onClick={() => buyProperty(property.id)}
                        data-testid={`upgrade-property-${property.id}`}
                        className={`w-full ${styles.surface} border border-primary/30 text-primary rounded font-heading font-bold uppercase tracking-wider py-1.5 text-[10px] hover:bg-primary/10 transition-all flex items-center justify-center gap-1.5`}
                      >
                        <TrendingUp size={11} /> Upgrade ${(property.price * (property.level + 1)).toLocaleString()}
                      </button>
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

      <details className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 prop-fade-in`} style={{ animationDelay: `${0.02 + properties.length * 0.04}s` }}>
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
