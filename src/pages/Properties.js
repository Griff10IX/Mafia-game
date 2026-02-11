import { useState, useEffect } from 'react';
import { Building, TrendingUp, DollarSign, Crosshair, Shield } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy property');
    }
  };

  const collectIncome = async (propertyId) => {
    try {
      const response = await api.post(`/properties/${propertyId}/collect`);
      toast.success(response.data.message);
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to collect income');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="properties-page">
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary tracking-wider uppercase">Properties</h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-mutedForeground font-heading tracking-wide">Invest in businesses to generate passive income</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {properties.map((property) => (
          <div
            key={property.id}
            data-testid={`property-card-${property.id}`}
            className={`${styles.panel} rounded-sm overflow-hidden hover:border-primary/60 transition-smooth shadow-lg shadow-primary/5`}
          >
            {/* Card Header */}
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-heading font-bold text-primary tracking-wide">{property.name}</h3>
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
                        className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-2 text-sm transition-smooth border border-yellow-600/50 shadow-lg shadow-primary/20"
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
                    onClick={() => buyProperty(property.id)}
                    data-testid={`buy-property-${property.id}`}
                    className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-2 text-sm transition-smooth border border-yellow-600/50 shadow-lg shadow-primary/20"
                  >
                    Buy Property
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Info Box */}
      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Investment Tips</h3>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-4">
          <ul className="space-y-1 text-xs text-mutedForeground font-heading">
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Properties generate passive income per hour</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Upgrade properties to increase income generation</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Income accumulates up to 24 hours maximum</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Collect income regularly to maximize earnings</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
