import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Globe, RefreshCw, Smartphone, Monitor, LogOut, ShieldAlert, Copy, Users } from 'lucide-react';
import api from '../../utils/api';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import { copyTextToClipboard } from '../../utils/copyToClipboard';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import { warmProfilePrefetchFromUsername } from '../../utils/profileNavPrefetch';

const IP_RULES_CACHE_KEY = 'mafia_ip_rules_v1';

const IPR_STYLES = `
  @keyframes ipr-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .ipr-fade-in { animation: ipr-fade-in 0.35s ease-out both; }
  .ipr-page { display: flex; flex-direction: column; gap: 10px; }
  .ipr-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  }
  .ipr-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--noir-primary);
  }
  .ipr-title svg { color: var(--noir-primary); flex-shrink: 0; }
  .ipr-sub { margin-top: 4px; font-size: 10px; color: var(--noir-muted); }
  .ipr-section { overflow: hidden; }
  .ipr-section-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--gm-border, var(--noir-border));
  }
  .ipr-section-title {
    display: flex; align-items: center; gap: 7px;
    font-size: 10px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--noir-primary);
  }
  .ipr-section-title svg { color: var(--noir-primary); flex-shrink: 0; }
  .ipr-count {
    font-size: 10px; font-weight: 700; color: var(--noir-muted);
    font-variant-numeric: tabular-nums;
  }
  .ipr-body { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .ipr-inset {
    padding: 10px 11px;
    background: var(--gm-card-hover, var(--noir-surface));
    border: 1px solid var(--gm-border, var(--noir-border));
    border-radius: var(--app-surface-radius, 8px);
  }
  .ipr-current {
    border-color: rgba(var(--noir-primary-rgb), 0.35);
    background: rgba(var(--noir-primary-rgb), 0.08);
  }
  .ipr-ip {
    font-size: 12px; font-weight: 700; color: var(--noir-foreground);
    word-break: break-all;
  }
  .ipr-meta {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px;
    margin-top: 5px;
    font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--noir-muted);
  }
  .ipr-badge {
    font-size: 8px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--noir-primary);
  }
  .ipr-chip {
    display: inline-flex; align-items: center;
    padding: 6px 10px;
    font-size: 11px; font-weight: 700;
    color: var(--noir-foreground);
    background: var(--gm-card-hover, var(--noir-surface));
    border: 1px solid var(--gm-border, var(--noir-border));
    border-radius: var(--app-surface-radius, 8px);
  }
  .ipr-chip:hover { color: var(--noir-primary); border-color: rgba(var(--noir-primary-rgb), 0.4); }
  .ipr-row {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;
  }
  .ipr-copy {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px;
    color: var(--noir-muted);
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .ipr-copy:hover { color: var(--noir-primary); }
  .ipr-warn {
    font-size: 11px; line-height: 1.5; color: var(--noir-foreground);
  }
  .ipr-empty { font-size: 11px; color: var(--noir-muted); }
  .ipr-logout {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    height: 28px; padding: 0 10px;
    font-size: 9px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
    cursor: pointer;
  }
  body[data-theme-variant="old_school"] .ipr-inset,
  body[data-theme-variant="old_school"] .ipr-chip {
    border-radius: 0;
    box-shadow: var(--os-bevel);
  }
  body[data-theme-variant="old_school"] .ipr-section-head {
    background: var(--os-metal-face);
    border-bottom-color: var(--os-chrome);
  }
  @media (prefers-reduced-motion: reduce) {
    .ipr-fade-in { animation: none !important; }
  }
`;

function DeviceIcon({ type }) {
  if (type === 'Mobile' || type === 'Tablet') return <Smartphone size={12} />;
  return <Monitor size={12} />;
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
  const [data, setData] = useState(() => readSessionJson(IP_RULES_CACHE_KEY));
  const [loading, setLoading] = useState(() => readSessionJson(IP_RULES_CACHE_KEY) == null);
  const [revokingId, setRevokingId] = useState(null);

  const fetchIpInfo = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await api.get('/auth/ip-info');
      setData(res.data);
      writeSessionJson(IP_RULES_CACHE_KEY, res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load address info');
      const empty = {
        current_ip: '',
        accounts_from_current_ip: [],
        your_signin_ips: [],
        current_device_type: null,
        last_device_type: null,
        sessions: [],
      };
      setData(empty);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const c = readSessionJson(IP_RULES_CACHE_KEY);
    if (c != null) {
      setData(c);
      setLoading(false);
    } else {
      setLoading(true);
    }
    fetchIpInfo(false);
  }, [fetchIpInfo]);

  useEffect(() => {
    const id = setInterval(() => fetchIpInfo(false), 60_000);
    return () => clearInterval(id);
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
      <div className={`${styles.pageContent} ipr-page mobile-page-root`}>
        <style>{IPR_STYLES}</style>
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
  const currentSession = sessions.find((s) => s.is_current);
  const otherSessions = sessions.filter((s) => !s.is_current);

  const copyIp = async (ip) => {
    if (!ip) return;
    const ok = await copyTextToClipboard(ip);
    if (ok) toast.success('Address copied');
    else toast.error('Could not copy');
  };

  const handleRefresh = () => fetchIpInfo(true);

  const handleRevokeSession = async (sessionId) => {
    setRevokingId(sessionId);
    try {
      await api.post('/auth/sessions/revoke', { session_id: sessionId });
      toast.success('Session logged out');
      fetchIpInfo(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to revoke session');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className={`${styles.pageContent} ipr-page mobile-page-root`} data-page="ip-rules">
      <style>{IPR_STYLES}</style>

      <div className="ipr-head">
        <div>
          <div className="ipr-title">
            <Globe size={15} />
            Connection
          </div>
          <p className="ipr-sub">Addresses, devices, and who else is on this connection.</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className={`${styles.btnPrimary} ipr-logout`}
          title="Refresh IP and device info"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
      <AutoRefreshNote seconds={60}>
        Refreshes every 60 seconds in the background and when you return to this tab.
      </AutoRefreshNote>

      <section className={`${styles.panel} ipr-section ipr-fade-in mobile-panel`}>
        <div className="ipr-section-head">
          <span className="ipr-section-title">
            <ShieldAlert size={13} />
            Rules
          </span>
        </div>
        <div className="ipr-body">
          <p className="ipr-warn">
            Do not move money, points, or casino winnings, sell cars, or run organised jobs with anyone who shares this connection.
            One active character at a time. Multiple live accounts can be terminated, with wealth seized.
          </p>
        </div>
      </section>

      <section className={`${styles.panel} ipr-section ipr-fade-in mobile-panel`} style={{ animationDelay: '0.04s' }}>
        <div className="ipr-section-head">
          <span className="ipr-section-title">
            <Users size={13} />
            This address
          </span>
          <span className="ipr-count">{accountsFromIp.length} account{accountsFromIp.length === 1 ? '' : 's'}</span>
        </div>
        <div className="ipr-body">
          {currentIp ? (
            <>
              <div className="ipr-inset ipr-current">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="ipr-ip">{currentIp}</div>
                    <div className="ipr-meta">
                      {currentDeviceType ? (
                        <span className="inline-flex items-center gap-1">
                          <DeviceIcon type={currentDeviceType} />
                          {currentDeviceType}
                        </span>
                      ) : null}
                      <span className="ipr-badge">Now</span>
                    </div>
                    {lastDeviceType && lastDeviceType !== currentDeviceType ? (
                      <p className="mt-1.5 text-[10px]" style={{ color: 'var(--noir-muted)' }}>
                        Last login: {lastDeviceType}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="ipr-copy"
                    onClick={() => copyIp(currentIp)}
                    title="Copy address"
                    aria-label="Copy address"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>
              {accountsFromIp.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {accountsFromIp.map((username) => (
                    <Link
                      key={username}
                      to={`/account/profile/${encodeURIComponent(username)}`}
                      className="ipr-chip"
                      onPointerDown={() => warmProfilePrefetchFromUsername(username)}
                      onPointerEnter={() => warmProfilePrefetchFromUsername(username)}
                    >
                      {username}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="ipr-empty">No other characters on this address.</p>
              )}
            </>
          ) : (
            <p className="ipr-empty">Unable to detect current address.</p>
          )}
        </div>
      </section>

      <section className={`${styles.panel} ipr-section ipr-fade-in mobile-panel`} style={{ animationDelay: '0.08s' }}>
        <div className="ipr-section-head">
          <span className="ipr-section-title">
            <Monitor size={13} />
            {sessions.length ? 'Sessions' : 'Sign-in addresses'}
          </span>
          <span className="ipr-count">{sessions.length || yourIps.length}</span>
        </div>
        <div className="ipr-body">
          {sessions.length > 0 ? (
            <>
              {currentSession ? (
                <div className="ipr-inset ipr-current ipr-row">
                  <div className="min-w-0">
                    <div className="ipr-ip">{currentSession.ip || '—'}</div>
                    <div className="ipr-meta">
                      {currentSession.device_type ? (
                        <span className="inline-flex items-center gap-1">
                          <DeviceIcon type={currentSession.device_type} />
                          {currentSession.device_type}
                        </span>
                      ) : null}
                      <span>Last {formatLastUsed(currentSession.last_used_at)}</span>
                      <span className="ipr-badge">This device</span>
                    </div>
                  </div>
                </div>
              ) : null}
              {otherSessions.map((s) => (
                <div key={s.id} className="ipr-inset ipr-row">
                  <div className="min-w-0">
                    <div className="ipr-ip">{s.ip || '—'}</div>
                    <div className="ipr-meta">
                      {s.device_type ? (
                        <span className="inline-flex items-center gap-1">
                          <DeviceIcon type={s.device_type} />
                          {s.device_type}
                        </span>
                      ) : null}
                      <span>Last {formatLastUsed(s.last_used_at)}</span>
                    </div>
                  </div>
                  {s.id ? (
                    <button
                      type="button"
                      onClick={() => handleRevokeSession(s.id)}
                      disabled={revokingId === s.id}
                      className={`${styles.surface} ipr-logout`}
                      title="Log out this session"
                    >
                      <LogOut size={11} />
                      {revokingId === s.id ? '…' : 'Log out'}
                    </button>
                  ) : null}
                </div>
              ))}
            </>
          ) : yourIps.length ? (
            yourIps.map((ip) => (
              <div key={ip} className={`ipr-inset ipr-row ${ip === currentIp ? 'ipr-current' : ''}`}>
                <div className="ipr-ip">{ip}</div>
                {ip === currentIp ? <span className="ipr-badge">Now</span> : null}
              </div>
            ))
          ) : (
            <p className="ipr-empty">None recorded.</p>
          )}
        </div>
      </section>
    </div>
  );
}
