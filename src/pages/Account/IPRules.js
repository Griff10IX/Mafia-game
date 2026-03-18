import { useState, useEffect, useCallback } from 'react';
import { Globe, RefreshCw, Smartphone, Monitor, LogOut } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

function DeviceIcon({ type }) {
  if (type === 'Mobile' || type === 'Tablet') return <Smartphone size={14} className="opacity-70" />;
  return <Monitor size={14} className="opacity-70" />;
}

function formatLastUsed(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const sameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
        sessions: [],
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
      <div className={`${styles.pageContent} space-y-2 mobile-page-root`}>
        <div className="flex flex-col items-center justify-center min-h-[30vh] gap-2">
          <Globe size={18} className="text-primary opacity-40 animate-pulse" />
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-[9px] font-heading uppercase tracking-wider text-primary">Loading...</span>
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
  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];

  const handleRefresh = () => fetchIpInfo(true);

  const handleRevokeSession = async (sessionId) => {
    try {
      await api.post('/auth/sessions/revoke', { session_id: sessionId });
      toast.success('Session logged out');
      fetchIpInfo(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to revoke session');
    }
  };

  return (
    <div className={`${styles.pageContent} space-y-2 mobile-page-root`}>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading uppercase tracking-wider border border-primary/30 bg-primary/10 text-primary transition-opacity disabled:opacity-50 hover:bg-primary/15"
          title="Refresh IP and device info"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Rules</span>
        </div>
        <p className="p-2 text-[10px] font-heading text-foreground leading-snug">
          You must not move money, points, or casino winnings, sell cars, or take part in organised jobs with anyone who shares your current connection address. Running more than one active character at a time is not allowed. Anyone suspected of multiple active accounts may have all of them terminated, with wealth subject to seizure.
        </p>
      </div>

      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Accounts from this address</span>
        </div>
        <div className="p-2 space-y-1">
          {currentIp ? (
            <>
              <p className="text-[10px] font-heading flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-primary font-medium">{currentIp}</span>
                {currentDeviceType && (
                  <span className="flex items-center gap-1 text-[9px] font-heading uppercase tracking-wider text-mutedForeground">
                    <DeviceIcon type={currentDeviceType} />
                    {currentDeviceType}
                  </span>
                )}
              </p>
              {lastDeviceType && lastDeviceType !== currentDeviceType && (
                <p className="text-[9px] font-heading text-mutedForeground">Last login: {lastDeviceType}</p>
              )}
              <ul className="space-y-0.5">
                {accountsFromIp.length ? (
                  accountsFromIp.map((username) => (
                    <li key={username} className="px-2 py-1 rounded text-[10px] font-heading bg-secondary/50 text-foreground">
                      {username}
                    </li>
                  ))
                ) : (
                  <li className="text-[10px] font-heading text-mutedForeground">None</li>
                )}
              </ul>
            </>
          ) : (
            <p className="text-[10px] font-heading text-mutedForeground">Unable to detect current address.</p>
          )}
        </div>
      </div>

      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
            {sessions.length ? 'Sessions (IP & devices)' : "Addresses you've signed in from"}
          </span>
        </div>
        <div className="p-2 space-y-0.5">
          {sessions.length > 0 ? (
            <ul className="space-y-0.5">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="px-2 py-1 rounded text-[10px] font-heading flex flex-wrap items-center justify-between gap-1.5 bg-secondary/30"
                >
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-foreground">
                  <span>{s.ip || '—'}</span>
                  {s.device_type && (
                    <span className="flex items-center gap-0.5 text-[9px] uppercase tracking-wider text-mutedForeground">
                      <DeviceIcon type={s.device_type} />
                      {s.device_type}
                    </span>
                  )}
                  <span className="text-[9px] text-mutedForeground">Last: {formatLastUsed(s.last_used_at)}</span>
                  {s.is_current && <span className="text-[9px] font-bold text-primary uppercase">Current</span>}
                </div>
                {!s.is_current && s.id && (
                  <button
                    type="button"
                    onClick={() => handleRevokeSession(s.id)}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-heading uppercase border border-border text-mutedForeground hover:text-foreground transition-colors"
                    title="Log out this session"
                  >
                    <LogOut size={10} />
                    Log out
                  </button>
                )}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-0.5">
              {yourIps.length ? (
                yourIps.map((ip) => (
                  <li
                    key={ip}
                    className="px-2 py-1 rounded text-[10px] font-heading flex items-center gap-1.5 bg-secondary/30 text-foreground"
                  >
                    <span>{ip}</span>
                    {ip === currentIp && <span className="text-[9px] font-bold text-primary uppercase">Current</span>}
                  </li>
                ))
              ) : (
                <li className="text-[10px] font-heading text-mutedForeground">None recorded.</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
