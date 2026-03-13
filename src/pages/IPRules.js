import { useState, useEffect, useCallback } from 'react';
import { Globe, RefreshCw, Smartphone, Monitor } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function DeviceIcon({ type }) {
  if (type === 'Mobile' || type === 'Tablet') return <Smartphone size={14} className="opacity-70" />;
  return <Monitor size={14} className="opacity-70" />;
}

export default function IPRules() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchIpInfo = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await api.get('/auth/ip-info');
      setData(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load address info');
      setData({
        current_ip: '',
        accounts_from_current_ip: [],
        your_signin_ips: [],
        current_device_type: null,
        last_device_type: null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchIpInfo(false);
  }, [fetchIpInfo]);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') fetchIpInfo(false);
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [fetchIpInfo]);

  if (loading && !data) {
    return (
      <div className={styles.pageContent}>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Globe size={22} className="opacity-40 animate-pulse" style={{ color: 'var(--noir-primary)' }} />
          <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--noir-primary)', borderTopColor: 'transparent' }} />
          <span className="text-[10px] font-heading uppercase tracking-[0.25em]" style={{ color: 'var(--noir-primary)' }}>Loading...</span>
        </div>
      </div>
    );
  }

  const currentIp = (data?.current_ip || '').trim();
  const accountsFromIp = data?.accounts_from_current_ip || [];
  const rawYourIps = data?.your_signin_ips || [];
  const yourIps = currentIp
    ? [currentIp, ...rawYourIps.filter((ip) => (ip || '').trim() !== currentIp)]
    : rawYourIps;
  const currentDeviceType = data?.current_device_type || null;
  const lastDeviceType = data?.last_device_type || null;

  const handleRefresh = () => fetchIpInfo(true);

  return (
    <div className={styles.pageContent}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Globe size={20} style={{ color: 'var(--noir-primary)' }} />
          <h1 className="text-lg font-heading font-bold uppercase tracking-wider" style={{ color: 'var(--noir-foreground)' }}>
            IP & Devices
          </h1>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-heading uppercase tracking-wider border transition-opacity disabled:opacity-50"
          style={{ backgroundColor: 'var(--noir-surface)', borderColor: 'var(--noir-border-light)', color: 'var(--noir-foreground)' }}
          title="Refresh IP and device info"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div
        className="rounded-lg border p-4 mb-6"
        style={{
          backgroundColor: 'var(--noir-content)',
          borderColor: 'var(--noir-border-light)',
        }}
      >
        <p className="text-sm font-heading leading-relaxed" style={{ color: 'var(--noir-foreground)' }}>
          You must not move money, points, or casino winnings, sell cars, or take part in organised jobs with anyone who shares your current connection address. Running more than one active character at a time is not allowed. Anyone suspected of multiple active accounts may have all of them terminated, with wealth subject to seizure.
        </p>
      </div>

      <div
        className="rounded-lg border p-4 mb-6"
        style={{
          backgroundColor: 'var(--noir-content)',
          borderColor: 'var(--noir-border-light)',
        }}
      >
        <h2 className="text-xs font-heading font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--noir-primary)' }}>
          Accounts signed in from this address
        </h2>
        {currentIp ? (
          <>
            <p className="text-sm font-heading mb-2 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: 'var(--noir-foreground)' }}>
              <span style={{ color: 'var(--noir-primary)' }}>{currentIp}</span>
              {currentDeviceType && (
                <span className="flex items-center gap-1.5 text-xs font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
                  <DeviceIcon type={currentDeviceType} />
                  {currentDeviceType}
                </span>
              )}
            </p>
            {lastDeviceType && lastDeviceType !== currentDeviceType && (
              <p className="text-xs font-heading mb-2" style={{ color: 'var(--noir-muted)' }}>
                Last login was from: {lastDeviceType}
              </p>
            )}
            <ul className="space-y-1">
              {accountsFromIp.length ? (
                accountsFromIp.map((username) => (
                  <li
                    key={username}
                    className="px-2 py-1.5 rounded text-sm font-heading"
                    style={{ backgroundColor: 'var(--noir-surface)', color: 'var(--noir-foreground)' }}
                  >
                    {username}
                  </li>
                ))
              ) : (
                <li className="text-sm font-heading" style={{ color: 'var(--noir-muted)' }}>None</li>
              )}
            </ul>
          </>
        ) : (
          <p className="text-sm font-heading" style={{ color: 'var(--noir-muted)' }}>Unable to detect current address.</p>
        )}
      </div>

      <div
        className="rounded-lg border p-4"
        style={{
          backgroundColor: 'var(--noir-content)',
          borderColor: 'var(--noir-border-light)',
        }}
      >
        <h2 className="text-xs font-heading font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--noir-primary)' }}>
          Addresses you&apos;ve signed in from
        </h2>
        <ul className="space-y-1">
          {yourIps.length ? (
            yourIps.map((ip) => (
              <li
                key={ip}
                className="px-2 py-1.5 rounded text-sm font-heading flex items-center gap-2"
                style={{ backgroundColor: 'var(--noir-surface)', color: 'var(--noir-foreground)' }}
              >
                <span>{ip}</span>
                {ip === currentIp && (
                  <span className="text-[10px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-primary)' }}>
                    Current
                  </span>
                )}
              </li>
            ))
          ) : (
            <li className="text-sm font-heading" style={{ color: 'var(--noir-muted)' }}>None recorded.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
