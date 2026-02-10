import { useState, useEffect } from 'react';
import { Building, TrendingUp, DollarSign, Crosshair, Shield } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

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
    <div className="space-y-8" data-testid="properties-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Properties</h1>
        <p className="text-mutedForeground">Invest in businesses to generate passive income</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {properties.map((property) => (
          <div
            key={property.id}
            data-testid={`property-card-${property.id}`}
            className="bg-card border border-border rounded-sm p-6 hover:border-primary/50 transition-smooth"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-heading font-bold text-foreground mb-1">{property.name}</h3>
                <p className="text-sm text-mutedForeground capitalize">{property.property_type}</p>
              </div>
              <Building className="text-primary" size={28} />
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-mutedForeground">Price:</span>
                <span className="text-primary font-mono font-bold">
                  ${property.price.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-mutedForeground">Income/Hour:</span>
                <span className="text-foreground font-mono">
                  ${property.income_per_hour.toLocaleString()}
                </span>
              </div>
              {property.owned && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-mutedForeground">Level:</span>
                    <span className="text-foreground font-mono">
                      {property.level} / {property.max_level}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-mutedForeground">Available:</span>
                    <span className="text-primary font-mono font-bold">
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
                      className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-2.5 transition-smooth gold-glow"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <DollarSign size={18} />
                        Collect Income
                      </div>
                    </button>
                  )}
                  {property.level < property.max_level && (
                    <button
                      onClick={() => buyProperty(property.id)}
                      data-testid={`upgrade-property-${property.id}`}
                      className="w-full bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground rounded-sm font-bold uppercase tracking-wider py-2.5 text-sm transition-smooth"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <TrendingUp size={18} />
                        Upgrade (${(property.price * (property.level + 1)).toLocaleString()})
                      </div>
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => buyProperty(property.id)}
                  data-testid={`buy-property-${property.id}`}
                  className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-2.5 transition-smooth gold-glow"
                >
                  Buy Property
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-sm p-6">
        <h3 className="text-xl font-heading font-semibold text-primary mb-3">Property Investment</h3>
        <ul className="space-y-2 text-sm text-mutedForeground">
          <li>• Properties generate passive income per hour</li>
          <li>• Upgrade properties to increase income generation</li>
          <li>• Income accumulates up to 24 hours maximum</li>
          <li>• Collect income regularly to maximize earnings</li>
        </ul>
      </div>
    </div>
  );
}
