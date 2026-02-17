import { useState, useEffect } from 'react';
import { Settings, UserCog, Coins, Car, Lock, Skull, Bot, Crosshair, Shield, Building2, Zap, Gift, Trash2, Clock, ChevronDown, ChevronRight, ScrollText, Dice5, AlertTriangle } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const ADMIN_STYLES = `
  .admin-fade-in { animation: admin-fade-in 0.4s ease-out both; }
  @keyframes admin-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .admin-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const SECTIONS_KEY = 'admin_sections_collapsed';

function loadCollapsed() {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCollapsed(state) {
  try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(state)); } catch {}
}

export default function Admin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [npcData, setNpcData] = useState({ npcs: [], npcs_enabled: false, npc_count: 0 });
  const [npcCount, setNpcCount] = useState(10);
  const [forceOnlineInfo, setForceOnlineInfo] = useState(null);
  const [boozeRotationSeconds, setBoozeRotationSeconds] = useState(null);
  const [ranks, setRanks] = useState([]);
  const [cars, setCars] = useState([]);
  const [bgTestCount, setBgTestCount] = useState(2);
  const [collapsed, setCollapsed] = useState(() => loadCollapsed());
  const [formData, setFormData] = useState({
    targetUsername: '',
    newRank: 1,
    points: 100,
    bullets: 5000,
    carId: 'car1',
    lockMinutes: 5,
    searchMinutes: 1
  });

  const [eventsEnabled, setEventsEnabled] = useState(true);
  const [allEventsForTesting, setAllEventsForTesting] = useState(false);
  const [todayEvent, setTodayEvent] = useState(null);
  
  const [searchUsername, setSearchUsername] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [deleteUserId, setDeleteUserId] = useState('');
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [dbLoading, setDbLoading] = useState(false);
  const [giveAllPoints, setGiveAllPoints] = useState(100);
  const [giveAllMoney, setGiveAllMoney] = useState(10000);
  const [clearSearchesLoading, setClearSearchesLoading] = useState(false);
  const [dropHumanBgLoading, setDropHumanBgLoading] = useState(false);
  const [resetNpcTimersLoading, setResetNpcTimersLoading] = useState(false);
  const [resetOcTimersLoading, setResetOcTimersLoading] = useState(false);
  
  // Security state
  const [securitySummary, setSecuritySummary] = useState(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [rateLimits, setRateLimits] = useState(null);
  const [rateLimitEdits, setRateLimitEdits] = useState({});

  // Activity & Gambling logs
  const [activityLog, setActivityLog] = useState({ entries: [] });
  const [activityLogLoading, setActivityLogLoading] = useState(false);
  const [activityLogUsername, setActivityLogUsername] = useState('');
  const [gamblingLog, setGamblingLog] = useState({ entries: [] });
  const [gamblingLogLoading, setGamblingLogLoading] = useState(false);
  const [gamblingLogUsername, setGamblingLogUsername] = useState('');
  const [gamblingLogGameType, setGamblingLogGameType] = useState('');
  const [clearGamblingDays, setClearGamblingDays] = useState(30);
  const [clearGamblingLoading, setClearGamblingLoading] = useState(false);

  // Cheat detection
  const [cheatSameIp, setCheatSameIp] = useState(null);
  const [cheatDuplicates, setCheatDuplicates] = useState(null);
  const [cheatLoading, setCheatLoading] = useState(false);
  const [duplicateSuspectsUsername, setDuplicateSuspectsUsername] = useState('');

  const toggleSection = (key) => {
    setCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveCollapsed(next);
      return next;
    });
  };

  const checkAdmin = async () => {
    try {
      const response = await api.get('/admin/check');
      setIsAdmin(response.data.is_admin);
      if (response.data.is_admin) {
        fetchNPCs();
        fetchMeta();
        fetchEventsStatus();
        fetchBoozeRotation();
      }
    } catch { setIsAdmin(false); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { checkAdmin(); }, []);

  const fetchEventsStatus = async () => {
    try {
      const res = await api.get('/admin/events');
      setEventsEnabled(!!res.data?.events_enabled);
      setAllEventsForTesting(!!res.data?.all_events_for_testing);
      setTodayEvent(res.data?.today_event ?? null);
    } catch {
      setEventsEnabled(true);
      setAllEventsForTesting(false);
      setTodayEvent(null);
    }
  };

  const fetchBoozeRotation = async () => {
    try {
      const res = await api.get('/admin/booze-rotation');
      setBoozeRotationSeconds(res.data?.rotation_seconds ?? null);
    } catch {
      setBoozeRotationSeconds(null);
    }
  };

  const handleBoozeRotation15s = async () => {
    try {
      await api.post('/admin/booze-rotation', { seconds: 15 });
      setBoozeRotationSeconds(15);
      toast.success('Booze rotation set to 15 seconds');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set rotation');
    }
  };

  const handleBoozeRotationReset = async () => {
    try {
      await api.post('/admin/booze-rotation', { seconds: null });
      setBoozeRotationSeconds(null);
      toast.success('Booze rotation reset to 3 hours');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to reset rotation');
    }
  };

  const handleToggleEvents = async () => {
    try {
      const res = await api.post('/admin/events/toggle', { enabled: !eventsEnabled });
      setEventsEnabled(!!res.data?.events_enabled);
      toast.success(res.data?.message || 'Events toggled');
      fetchEventsStatus();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const handleToggleAllEventsForTesting = async () => {
    try {
      const res = await api.post('/admin/events/all-for-testing', { enabled: !allEventsForTesting });
      setAllEventsForTesting(!!res.data?.all_events_for_testing);
      toast.success(res.data?.message || 'Toggled');
      fetchEventsStatus();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const fetchMeta = async () => {
    try {
      const [ranksRes, carsRes] = await Promise.all([api.get('/meta/ranks'), api.get('/meta/cars')]);
      setRanks(Array.isArray(ranksRes.data?.ranks) ? ranksRes.data.ranks : []);
      setCars(Array.isArray(carsRes.data?.cars) ? carsRes.data.cars : []);
    } catch { setRanks([]); setCars([]); }
  };

  const fetchNPCs = async () => {
    try {
      const response = await api.get('/admin/npcs');
      setNpcData(response.data);
    } catch {}
  };

  const handleToggleNPCs = async (enabled) => {
    try {
      const response = await api.post('/admin/npcs/toggle', { enabled, count: enabled ? npcCount : 0 });
      toast.success(response.data.message);
      fetchNPCs();
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleChangeRank = async () => {
    const username = (formData.targetUsername || '').trim();
    const rank = formData.newRank != null ? parseInt(formData.newRank, 10) : NaN;
    if (!username) {
      toast.error('Enter a target username');
      return;
    }
    const maxRank = ranks.length > 0 ? Math.max(...ranks.map((r) => r.id)) : 11;
    if (Number.isNaN(rank) || rank < 1 || rank > maxRank) {
      toast.error(`Select a valid rank (1–${maxRank})`);
      return;
    }
    try {
      const response = await api.post(`/admin/change-rank?target_username=${encodeURIComponent(username)}&new_rank=${rank}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleAddPoints = async () => {
    try {
      const response = await api.post(`/admin/add-points?target_username=${formData.targetUsername}&points=${formData.points}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleAddBullets = async () => {
    try {
      const response = await api.post(`/admin/add-bullets?target_username=${formData.targetUsername}&bullets=${formData.bullets}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleAddCar = async () => {
    try {
      const response = await api.post(`/admin/add-car?target_username=${formData.targetUsername}&car_id=${formData.carId}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleLockPlayer = async () => {
    try {
      const response = await api.post(`/admin/lock-player?target_username=${formData.targetUsername}&lock_minutes=${formData.lockMinutes}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleKillPlayer = async () => {
    try {
      const response = await api.post(`/admin/kill-player?target_username=${formData.targetUsername}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleSetSearchTime = async () => {
    try {
      const response = await api.post(`/admin/set-search-time?target_username=${formData.targetUsername}&search_minutes=${formData.searchMinutes}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleSetAllSearchTime5 = async () => {
    if (!window.confirm('Set every user\'s search timer to 5 minutes?')) return;
    try {
      const res = await api.post('/admin/set-all-search-time?search_minutes=5');
      toast.success(res.data?.message || 'Done');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleClearAllSearches = async () => {
    if (!window.confirm('Delete ALL attack searches?')) return;
    setClearSearchesLoading(true);
    try {
      const res = await api.post('/admin/clear-all-searches');
      toast.success(res.data?.message || 'Cleared');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setClearSearchesLoading(false); }
  };

  const handleResetHitlistNpcTimers = async () => {
    if (!window.confirm('Reset hitlist NPC timers for everyone?')) return;
    setResetNpcTimersLoading(true);
    try {
      const res = await api.post('/admin/hitlist/reset-npc-timers');
      toast.success(res.data?.message || 'Reset');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setResetNpcTimersLoading(false); }
  };

  const handleResetAllOcTimers = async () => {
    if (!window.confirm('Reset all OC timers for everyone? Everyone will be able to run Organised Crime immediately.')) return;
    setResetOcTimersLoading(true);
    try {
      const res = await api.post('/admin/oc/reset-all-timers');
      toast.success(res.data?.message || 'Reset');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setResetOcTimersLoading(false); }
  };

  const handleForceOnline = async () => {
    try {
      const res = await api.post('/admin/force-online');
      setForceOnlineInfo(res.data);
      toast.success(res.data?.message || 'Done');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleClearBodyguards = async () => {
    try {
      const res = await api.post(`/admin/bodyguards/clear?target_username=${encodeURIComponent(formData.targetUsername)}`);
      toast.success(res.data?.message || 'Cleared');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleDropAllHumanBodyguards = async () => {
    if (!window.confirm('Remove ALL bodyguards from EVERY user?')) return;
    setDropHumanBgLoading(true);
    try {
      const res = await api.post('/admin/bodyguards/drop-all');
      toast.success(res.data?.message || 'Dropped');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setDropHumanBgLoading(false); }
  };

  const handleGenerateBodyguards = async () => {
    try {
      const res = await api.post('/admin/bodyguards/generate', {
        target_username: formData.targetUsername,
        count: bgTestCount,
        replace_existing: true,
      });
      toast.success(res.data?.message || 'Generated');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleFindDuplicates = async () => {
    setDbLoading(true);
    try {
      const url = searchUsername.trim() ? '/admin/find-duplicates?username=' + encodeURIComponent(searchUsername.trim()) : '/admin/find-duplicates';
      const res = await api.get(url);
      setSearchResults(res.data);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setDbLoading(false); }
  };

  const handleFetchSameIp = async () => {
    setCheatLoading(true);
    setCheatSameIp(null);
    try {
      const res = await api.get('/admin/cheat-detection/same-ip');
      setCheatSameIp(res.data);
      toast.success(res.data?.total_groups ? `${res.data.total_groups} IP group(s) with 2+ accounts` : 'No shared IPs found');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setCheatLoading(false);
    }
  };

  const handleFetchDuplicateSuspects = async () => {
    setCheatLoading(true);
    setCheatDuplicates(null);
    try {
      const url = duplicateSuspectsUsername.trim()
        ? '/admin/cheat-detection/duplicate-suspects?username=' + encodeURIComponent(duplicateSuspectsUsername.trim())
        : '/admin/cheat-detection/duplicate-suspects';
      const res = await api.get(url);
      setCheatDuplicates(res.data);
      toast.success('Duplicate suspects loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setCheatLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUserId.trim()) { toast.error('Enter a user ID'); return; }
    if (!window.confirm('DELETE this user?')) return;
    setDbLoading(true);
    try {
      const res = await api.post('/admin/delete-user/' + encodeURIComponent(deleteUserId.trim()));
      toast.success(res.data?.message || 'Deleted');
      setDeleteUserId('');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setDbLoading(false); }
  };

  const handleWipeAllUsers = async () => {
    if (wipeConfirmText !== 'WIPE ALL') { toast.error('Type "WIPE ALL" to confirm'); return; }
    if (!window.confirm('FINAL WARNING: Delete ALL users?')) return;
    setDbLoading(true);
    try {
      const res = await api.post('/admin/wipe-all-users');
      toast.success(res.data?.message || 'Wiped');
      setWipeConfirmText('');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setDbLoading(false); }
  };

  const handleSeedFamilies = async () => {
    if (!window.confirm('Create 3 test families with 5 users each?')) return;
    try {
      const res = await api.post('/admin/seed-families');
      toast.success(res.data?.message || 'Seeded');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleGiveAllPoints = async () => {
    if (!window.confirm(`Give ${giveAllPoints} points to ALL?`)) return;
    try {
      const res = await api.post(`/admin/give-all-points?points=${giveAllPoints}`);
      toast.success(res.data?.message || 'Done');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleGiveAllMoney = async () => {
    if (!window.confirm(`Give $${giveAllMoney.toLocaleString()} to ALL?`)) return;
    try {
      const res = await api.post(`/admin/give-all-money?amount=${giveAllMoney}`);
      toast.success(res.data?.message || 'Done');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  // Security handlers
  const handleTestTelegram = async () => {
    setSecurityLoading(true);
    try {
      const response = await api.post('/admin/security/test-telegram');
      toast.success(response.data.message || 'Test alert sent to Telegram!');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to send test alert'); }
    finally { setSecurityLoading(false); }
  };

  const handleFetchSecuritySummary = async () => {
    setSecurityLoading(true);
    try {
      const response = await api.get('/admin/security/summary?limit=50');
      setSecuritySummary(response.data);
      toast.success('Security summary loaded');
    } catch (e) { 
      toast.error(e.response?.data?.detail || 'Failed to fetch security summary'); 
      setSecuritySummary(null);
    }
    finally { setSecurityLoading(false); }
  };

  const fetchActivityLog = async () => {
    setActivityLogLoading(true);
    try {
      const params = { limit: 100 };
      if (activityLogUsername.trim()) params.username = activityLogUsername.trim();
      const res = await api.get('/admin/activity-log', { params });
      setActivityLog(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load activity log');
      setActivityLog({ entries: [] });
    } finally {
      setActivityLogLoading(false);
    }
  };

  const fetchGamblingLog = async () => {
    setGamblingLogLoading(true);
    try {
      const params = { limit: 100 };
      if (gamblingLogUsername.trim()) params.username = gamblingLogUsername.trim();
      if (gamblingLogGameType.trim()) params.game_type = gamblingLogGameType.trim();
      const res = await api.get('/admin/gambling-log', { params });
      setGamblingLog(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load gambling log');
      setGamblingLog({ entries: [] });
    } finally {
      setGamblingLogLoading(false);
    }
  };

  const handleClearGamblingLog = async () => {
    if (!window.confirm(`Delete gambling log entries older than ${clearGamblingDays} days?`)) return;
    setClearGamblingLoading(true);
    try {
      const res = await api.post('/admin/gambling-log/clear', null, { params: { days: clearGamblingDays } });
      toast.success(res.data?.message || 'Cleared');
      fetchGamblingLog();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to clear');
    } finally {
      setClearGamblingLoading(false);
    }
  };

  const handleClearOldFlags = async () => {
    if (!window.confirm('Clear security flags older than 30 days?')) return;
    setSecurityLoading(true);
    try {
      const response = await api.post('/admin/security/clear-old-flags', { days: 30 });
      toast.success(response.data.message || 'Old flags cleared');
      setSecuritySummary(null);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setSecurityLoading(false); }
  };

  const handleViewRateLimits = async () => {
    setSecurityLoading(true);
    try {
      const response = await api.get('/admin/security/rate-limits');
      setRateLimits(response.data);
      setRateLimitEdits({});
      toast.success('Rate limits loaded');
    } catch (e) { 
      toast.error(e.response?.data?.detail || 'Failed to fetch rate limits'); 
      setRateLimits(null);
    }
    finally { setSecurityLoading(false); }
  };

  const handleToggleRateLimit = async (endpoint, currentEnabled) => {
    try {
      const response = await api.post(`/admin/security/rate-limits/toggle?endpoint=${encodeURIComponent(endpoint)}&enabled=${!currentEnabled}`);
      toast.success(response.data.message);
      // Refresh the rate limits
      await handleViewRateLimits();
    } catch (e) { 
      toast.error(e.response?.data?.detail || 'Failed to toggle rate limit'); 
    }
  };

  const handleUpdateRateLimit = async (endpoint, newLimit) => {
    if (!newLimit || newLimit < 1 || newLimit > 1000) {
      toast.error('Limit must be between 1 and 1000');
      return;
    }
    try {
      const response = await api.post(`/admin/security/rate-limits/update?endpoint=${encodeURIComponent(endpoint)}&min_interval_sec=${Number(newLimit)}`);
      toast.success(response.data.message);
      // Refresh the rate limits
      await handleViewRateLimits();
    } catch (e) { 
      toast.error(e.response?.data?.detail || 'Failed to update rate limit'); 
    }
  };

  const handleDisableAllLimits = async () => {
    if (!window.confirm('⚠️ Disable ALL rate limits? This removes all protection against spam and exploits.')) return;
    setSecurityLoading(true);
    try {
      const response = await api.post('/admin/security/rate-limits/disable-all');
      toast.success(response.data.message);
      // Refresh the rate limits
      await handleViewRateLimits();
    } catch (e) { 
      toast.error(e.response?.data?.detail || 'Failed to disable rate limits'); 
    }
    finally { setSecurityLoading(false); }
  };

  if (loading) {
    return (
      <div className={`${styles.pageContent}`}>
        <style>{ADMIN_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Settings size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading…</span>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h2 className="text-xl font-heading font-bold text-red-400 mb-2">Access Denied</h2>
          <p className="text-xs text-mutedForeground">Admin privileges required</p>
        </div>
      </div>
    );
  }

  // Reusable components
  const SectionHeader = ({ icon: Icon, title, badge, isCollapsed, onToggle, color = 'text-primary' }) => (
    <button
      type="button"
      onClick={onToggle}
      className="w-full px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between hover:bg-primary/12 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Icon size={14} className={color} />
        <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">{title}</span>
      </div>
      <div className="flex items-center gap-2">
        {badge}
        <span className="text-primary/80">
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </span>
      </div>
    </button>
  );

  const ActionRow = ({ icon: Icon, label, description, children, color = 'text-primary' }) => (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-md bg-zinc-800/30 border border-transparent hover:border-primary/20">
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={14} className={`shrink-0 ${color}`} />
        <div className="min-w-0">
          <div className={`text-sm font-heading font-bold ${color === 'text-red-400' ? 'text-red-400' : 'text-foreground'}`}>{label}</div>
          {description && <div className="text-[10px] text-mutedForeground truncate">{description}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 ml-6 sm:ml-0 shrink-0">
        {children}
      </div>
    </div>
  );

  const Input = ({ ...props }) => (
    <input {...props} className="w-full sm:w-24 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
  );

  const Select = ({ children, ...props }) => (
    <select {...props} className="w-full sm:w-32 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none">
      {children}
    </select>
  );

  const BtnPrimary = ({ children, ...props }) => (
    <button {...props} className="bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 touch-manipulation font-heading">
      {children}
    </button>
  );

  const BtnDanger = ({ children, ...props }) => (
    <button {...props} className="bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-red-500/50 transition-all disabled:opacity-50 touch-manipulation">
      {children}
    </button>
  );

  const BtnSecondary = ({ children, ...props }) => (
    <button {...props} className="bg-zinc-700/50 hover:bg-zinc-600/50 text-foreground rounded px-3 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 transition-all disabled:opacity-50 touch-manipulation">
      {children}
    </button>
  );

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="admin-page">
      <style>{ADMIN_STYLES}</style>
      <div className="relative admin-fade-in">
        <p className="text-[10px] text-zinc-500 font-heading italic">Use with caution</p>
      </div>

      {/* Target Username */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🎯 Target Username</span>
        </div>
        <div className="p-3">
          <input
            type="text"
            value={formData.targetUsername}
            onChange={(e) => setFormData({ ...formData, targetUsername: e.target.value })}
            className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
            placeholder="Enter username for actions below"
          />
        </div>
        <div className="admin-art-line text-primary mx-3" />
      </div>

      {/* NPC Management */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Bot}
          title="NPC Management"
          badge={
            <span className="text-[10px] font-heading">
              <span className={npcData.npcs_enabled ? 'text-emerald-400' : 'text-red-400'}>{npcData.npcs_enabled ? 'On' : 'Off'}</span>
              <span className="text-mutedForeground"> · {npcData.npc_count} active</span>
            </span>
          }
          isCollapsed={collapsed.npcs}
          onToggle={() => toggleSection('npcs')}
        />
        {!collapsed.npcs && (
          <div className="p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input type="number" min="1" max="50" value={npcCount} onChange={(e) => setNpcCount(parseInt(e.target.value) || 10)} placeholder="Count" />
              <BtnPrimary onClick={() => handleToggleNPCs(true)}>Enable NPCs</BtnPrimary>
              <BtnDanger onClick={() => handleToggleNPCs(false)}>Disable</BtnDanger>
            </div>
            {npcData.npcs.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {npcData.npcs.slice(0, 10).map((npc) => (
                  <div key={npc.id} className="flex items-center justify-between px-2 py-1 rounded bg-zinc-800/30 text-[10px] font-heading">
                    <span className="text-foreground font-bold truncate">{npc.username}</span>
                    <span className="text-mutedForeground">{npc.rank_name} · ${npc.money?.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Game Events */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Zap}
          title="Game Events"
          badge={
            <span className="text-[10px] font-heading">
              <span className={eventsEnabled ? 'text-emerald-400' : 'text-red-400'}>{eventsEnabled ? 'On' : 'Off'}</span>
              {todayEvent?.name && <span className="text-mutedForeground"> · {todayEvent.name}</span>}
            </span>
          }
          isCollapsed={collapsed.events}
          onToggle={() => toggleSection('events')}
        />
        {!collapsed.events && (
          <div className="p-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <BtnPrimary onClick={handleToggleEvents}>{eventsEnabled ? 'Disable' : 'Enable'} Events</BtnPrimary>
              <BtnSecondary onClick={handleToggleAllEventsForTesting}>
                {allEventsForTesting ? 'Disable' : 'Enable'} All (Testing)
              </BtnSecondary>
            </div>
            <p className="text-[10px] text-mutedForeground">All events (testing): applies every multiplier at once.</p>
          </div>
        )}
      </div>

      {/* Booze Run rotation (admin test) */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Clock}
          title="Booze Run rotation"
          badge={
            <span className="text-[10px] font-heading">
              {boozeRotationSeconds != null ? (
                <span className="text-amber-400">{boozeRotationSeconds}s (test)</span>
              ) : (
                <span className="text-mutedForeground">3h (normal)</span>
              )}
            </span>
          }
          isCollapsed={collapsed.boozeRun}
          onToggle={() => toggleSection('boozeRun')}
        />
        {!collapsed.boozeRun && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground">Set rotation to 15 seconds for testing; prices and best routes will update every 15s. Reset to use normal 3h.</p>
            <div className="flex flex-wrap gap-2">
              <BtnPrimary onClick={handleBoozeRotation15s}>Set rotation to 15s</BtnPrimary>
              <BtnSecondary onClick={handleBoozeRotationReset}>Reset to 3h</BtnSecondary>
            </div>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Zap}
          title="Quick Actions"
          isCollapsed={collapsed.quick}
          onToggle={() => toggleSection('quick')}
        />
        {!collapsed.quick && (
          <div className="p-2 space-y-1">
            <ActionRow icon={Building2} label="Seed Families" description="Create 3 families with 5 users each">
              <BtnPrimary onClick={handleSeedFamilies}>Seed</BtnPrimary>
            </ActionRow>
            <ActionRow icon={UserCog} label="Force Online" description="Bring offline users online for 1h">
              <BtnPrimary onClick={handleForceOnline}>Force</BtnPrimary>
            </ActionRow>
            <ActionRow icon={Gift} label="Give All Points" description="Give points to all alive accounts">
              <Input type="number" min="1" max="999999999" value={giveAllPoints} onChange={(e) => setGiveAllPoints(parseInt(e.target.value) || 1)} />
              <BtnPrimary onClick={handleGiveAllPoints}>Give</BtnPrimary>
            </ActionRow>
            <ActionRow icon={Gift} label="Give All Money" description="Give money to all alive accounts">
              <Input type="number" min="1" max="999999999" value={giveAllMoney} onChange={(e) => setGiveAllMoney(parseInt(e.target.value) || 10000)} />
              <BtnPrimary onClick={handleGiveAllMoney}>Give</BtnPrimary>
            </ActionRow>
          </div>
        )}
      </div>

      {/* Player Actions */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={UserCog}
          title="Player Actions"
          isCollapsed={collapsed.player}
          onToggle={() => toggleSection('player')}
        />
        {!collapsed.player && (
          <div className="p-2 space-y-1">
            <ActionRow icon={UserCog} label="Change Rank">
              {ranks.length > 0 ? (
                <Select value={String(formData.newRank)} onChange={(e) => setFormData({ ...formData, newRank: parseInt(e.target.value) })}>
                  {ranks.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
                </Select>
              ) : (
                <Input type="number" min="1" max="11" value={formData.newRank} onChange={(e) => setFormData({ ...formData, newRank: parseInt(e.target.value) })} />
              )}
              <BtnPrimary onClick={handleChangeRank}>Set</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Coins} label="Add Points">
              <Input type="number" value={formData.points} onChange={(e) => setFormData({ ...formData, points: parseInt(e.target.value) })} />
              <BtnPrimary onClick={handleAddPoints}>Add</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Crosshair} label="Give Bullets">
              <Input type="number" min="1" value={formData.bullets} onChange={(e) => setFormData({ ...formData, bullets: parseInt(e.target.value) })} />
              <BtnPrimary onClick={handleAddBullets}>Give</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Car} label="Add Car">
              <Select value={formData.carId} onChange={(e) => setFormData({ ...formData, carId: e.target.value })}>
                {cars.length > 0 ? cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>) : Array.from({ length: 20 }, (_, i) => <option key={i} value={`car${i + 1}`}>Car {i + 1}</option>)}
              </Select>
              <BtnPrimary onClick={handleAddCar}>Add</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Lock} label="Lock Player" color="text-red-400">
              <Input type="number" value={formData.lockMinutes} onChange={(e) => setFormData({ ...formData, lockMinutes: parseInt(e.target.value) })} placeholder="Mins" />
              <BtnDanger onClick={handleLockPlayer}>Lock</BtnDanger>
            </ActionRow>

            <ActionRow icon={Skull} label="Kill Player" description="Takes 20% of their money" color="text-red-400">
              <BtnDanger onClick={handleKillPlayer}>Kill</BtnDanger>
            </ActionRow>
          </div>
        )}
      </div>

      {/* Search & Attack Tools */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Clock}
          title="Search & Attack Tools"
          isCollapsed={collapsed.search}
          onToggle={() => toggleSection('search')}
        />
        {!collapsed.search && (
          <div className="p-2 space-y-1">
            <ActionRow icon={Settings} label="Set Search Time" description="Set to 0 to clear override">
              <Input type="number" value={formData.searchMinutes} onChange={(e) => setFormData({ ...formData, searchMinutes: parseInt(e.target.value) })} placeholder="Mins" />
              <BtnPrimary onClick={handleSetSearchTime}>Set</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Settings} label="Set All to 5 mins" description="Affects all users">
              <BtnPrimary onClick={handleSetAllSearchTime5}>Set All</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Trash2} label="Clear All Searches" description="Delete all attack searches" color="text-red-400">
              <BtnDanger onClick={handleClearAllSearches} disabled={clearSearchesLoading}>
                {clearSearchesLoading ? '...' : 'Clear'}
              </BtnDanger>
            </ActionRow>

            <ActionRow icon={Clock} label="Reset Hitlist NPC Timers" description="All users can add NPCs again">
              <BtnPrimary onClick={handleResetHitlistNpcTimers} disabled={resetNpcTimersLoading}>
                {resetNpcTimersLoading ? '...' : 'Reset'}
              </BtnPrimary>
            </ActionRow>

            <ActionRow icon={Clock} label="Reset All OC Timers" description="Clear OC cooldown for everyone; all can run Organised Crime immediately">
              <BtnPrimary onClick={handleResetAllOcTimers} disabled={resetOcTimersLoading}>
                {resetOcTimersLoading ? '...' : 'Reset'}
              </BtnPrimary>
            </ActionRow>
          </div>
        )}
      </div>

      {/* Bodyguard Tools */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Shield}
          title="Bodyguard Tools"
          isCollapsed={collapsed.bodyguards}
          onToggle={() => toggleSection('bodyguards')}
        />
        {!collapsed.bodyguards && (
          <div className="p-2 space-y-1">
            <ActionRow icon={Shield} label="Generate Robots" description="For target user">
              <Input type="number" min="1" max="4" value={bgTestCount} onChange={(e) => setBgTestCount(parseInt(e.target.value) || 1)} />
              <BtnPrimary onClick={handleGenerateBodyguards}>Generate</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Trash2} label="Clear Target's BGs" description="Remove all bodyguards" color="text-red-400">
              <BtnDanger onClick={handleClearBodyguards}>Clear</BtnDanger>
            </ActionRow>

            <ActionRow icon={Trash2} label="Drop ALL Bodyguards" description="Remove from every user" color="text-red-400">
              <BtnDanger onClick={handleDropAllHumanBodyguards} disabled={dropHumanBgLoading}>
                {dropHumanBgLoading ? '...' : 'Drop All'}
              </BtnDanger>
            </ActionRow>
          </div>
        )}
      </div>

      {/* Cheat Detection */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-amber-500/30`}>
        <SectionHeader
          icon={AlertTriangle}
          title="Cheat Detection"
          badge={
            ((cheatSameIp?.total_groups ?? 0) > 0 || ((cheatDuplicates?.by_domain?.length ?? 0) + (cheatDuplicates?.by_similar_username?.length ?? 0)) > 0) && (
              <span className="text-[10px] font-heading text-amber-400">Review below</span>
            )
          }
          isCollapsed={collapsed.cheat}
          onToggle={() => toggleSection('cheat')}
        />
        {!collapsed.cheat && (
          <div className="p-3 space-y-4">
            <div>
              <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Accounts on same IP</div>
              <p className="text-xs text-mutedForeground mb-2">Find users who registered or logged in from the same IP (possible multi-accounts).</p>
              <BtnPrimary onClick={handleFetchSameIp} disabled={cheatLoading}>Load same-IP report</BtnPrimary>
              {cheatSameIp && (
                <div className="mt-3 max-h-64 overflow-y-auto space-y-2">
                  {cheatSameIp.total_groups === 0 ? (
                    <p className="text-xs text-mutedForeground">No IP shared by 2+ accounts.</p>
                  ) : (
                    cheatSameIp.groups?.slice(0, 30).map((g, i) => (
                      <div key={i} className="p-2 rounded bg-zinc-900/50 border border-amber-500/20">
                        <div className="text-[10px] font-heading text-amber-400 mb-1">IP: {g.ip} — {g.count} account(s)</div>
                        <div className="space-y-0.5">
                          {g.accounts.map((a, j) => (
                            <div key={j} className="flex justify-between text-[10px]">
                              <span className="text-foreground font-bold">{a.username}</span>
                              <span className="text-mutedForeground">{a.email}</span>
                              <span className="text-mutedForeground">{a.source}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Duplicate account suspects</div>
              <p className="text-xs text-mutedForeground mb-2">Same email domain or similar usernames (e.g. name1, name2).</p>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  type="text"
                  value={duplicateSuspectsUsername}
                  onChange={(e) => setDuplicateSuspectsUsername(e.target.value)}
                  className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs w-40"
                  placeholder="Filter by username"
                />
                <BtnPrimary onClick={handleFetchDuplicateSuspects} disabled={cheatLoading}>Load duplicate suspects</BtnPrimary>
              </div>
              {cheatDuplicates && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  <div>
                    <div className="text-[10px] font-heading text-primary uppercase mb-1">Same email domain</div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {(cheatDuplicates.by_domain || []).length === 0 ? (
                        <p className="text-xs text-mutedForeground">None</p>
                      ) : (
                        (cheatDuplicates.by_domain || []).map((g, i) => (
                          <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading">{g.domain} — {g.count}</div>
                            {g.accounts?.slice(0, 5).map((a, j) => (
                              <div key={j} className="text-[10px] pl-1">{a.username} · {a.email}</div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-heading text-primary uppercase mb-1">Similar usernames</div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {(cheatDuplicates.by_similar_username || []).length === 0 ? (
                        <p className="text-xs text-mutedForeground">None</p>
                      ) : (
                        (cheatDuplicates.by_similar_username || []).map((g, i) => (
                          <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading">"{g.base}" — {g.count}</div>
                            {g.accounts?.slice(0, 5).map((a, j) => (
                              <div key={j} className="text-[10px] pl-1">{a.username} · {a.email}</div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Security & Anti-Cheat */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Shield}
          title="Security & Anti-Cheat"
          badge={
            securitySummary && (
              <span className="text-[10px] font-heading text-mutedForeground">
                {securitySummary.total_flags || 0} flags · {securitySummary.unique_users_flagged || 0} users
              </span>
            )
          }
          isCollapsed={collapsed.security}
          onToggle={() => toggleSection('security')}
        />
        {!collapsed.security && (
          <div className="p-2 space-y-1">
            <ActionRow icon={Shield} label="Test Telegram" description="Send test alert to Telegram">
              <BtnPrimary onClick={handleTestTelegram} disabled={securityLoading}>
                {securityLoading ? '...' : 'Test'}
              </BtnPrimary>
            </ActionRow>

            <ActionRow icon={Shield} label="View Security Summary" description="Load recent security flags">
              <BtnPrimary onClick={handleFetchSecuritySummary} disabled={securityLoading}>
                {securityLoading ? '...' : 'Load'}
              </BtnPrimary>
            </ActionRow>

            {securitySummary && (
              <div className="mt-2 p-3 rounded bg-zinc-900/50 border border-zinc-700/50 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-mutedForeground">Total Flags:</span>
                    <span className="ml-2 text-foreground font-bold">{securitySummary.total_flags}</span>
                  </div>
                  <div>
                    <span className="text-mutedForeground">Users Flagged:</span>
                    <span className="ml-2 text-foreground font-bold">{securitySummary.unique_users_flagged}</span>
                  </div>
                  <div>
                    <span className="text-mutedForeground">Telegram:</span>
                    <span className={`ml-2 font-bold ${securitySummary.telegram_configured ? 'text-emerald-400' : 'text-red-400'}`}>
                      {securitySummary.telegram_configured ? 'Active' : 'Not Configured'}
                    </span>
                  </div>
                </div>

                {securitySummary.by_type && Object.keys(securitySummary.by_type).length > 0 && (
                  <div>
                    <div className="text-[10px] font-heading text-mutedForeground uppercase mb-1">Flags by Type:</div>
                    <div className="space-y-1">
                      {Object.entries(securitySummary.by_type).map(([type, count]) => (
                        <div key={type} className="flex justify-between text-[10px]">
                          <span className="text-foreground">{type}</span>
                          <span className="text-primary font-bold">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {securitySummary.recent_flags && securitySummary.recent_flags.length > 0 && (
                  <div>
                    <div className="text-[10px] font-heading text-mutedForeground uppercase mb-1">Recent Flags:</div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {securitySummary.recent_flags.slice(0, 10).map((flag, i) => (
                        <div key={i} className="text-[10px] p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                          <div className="flex justify-between mb-1">
                            <span className="text-primary font-bold">{flag.username}</span>
                            <span className="text-mutedForeground">{flag.flag_type}</span>
                          </div>
                          <div className="text-mutedForeground">{flag.reason}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <ActionRow icon={Shield} label="View Rate Limits" description="See rate limiting configuration">
              <BtnPrimary onClick={handleViewRateLimits} disabled={securityLoading}>
                {securityLoading ? '...' : 'View'}
              </BtnPrimary>
            </ActionRow>

            <ActionRow icon={Shield} label="Disable All Limits" description="Emergency: Turn off all rate limiting" color="text-red-400">
              <BtnDanger onClick={handleDisableAllLimits} disabled={securityLoading}>
                {securityLoading ? '...' : 'Disable All'}
              </BtnDanger>
            </ActionRow>

            {rateLimits && rateLimits.rate_limits && (
              <div className="mt-2 p-3 rounded bg-zinc-900/50 border border-zinc-700/50 space-y-2">
                <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Rate limit (min sec between clicks):</div>
                <div className="max-h-64 overflow-y-auto space-y-1.5">
                  {Object.entries(rateLimits.rate_limits).map(([endpoint, val]) => {
                    const minIntervalSec = Array.isArray(val) ? val[0] : (val?.min_interval_sec ?? 1);
                    const enabled = Array.isArray(val) ? val[1] : (val?.enabled ?? false);
                    const editValue = rateLimitEdits[endpoint] !== undefined ? rateLimitEdits[endpoint] : minIntervalSec;
                    const hasChanged = Number(editValue) !== Number(minIntervalSec);
                    
                    return (
                      <div key={endpoint} className="flex flex-col gap-2 text-[10px] p-2 rounded bg-zinc-800/50 border border-zinc-700/30 hover:border-primary/30 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-foreground font-mono text-[11px] truncate mb-0.5">{endpoint}</div>
                          </div>
                          <button
                            onClick={() => handleToggleRateLimit(endpoint, enabled)}
                            className={`shrink-0 px-2 py-1 rounded text-[9px] font-bold transition-all ${
                              enabled 
                                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30' 
                                : 'bg-zinc-700/50 text-mutedForeground hover:bg-zinc-700 border border-zinc-600/30'
                            }`}
                          >
                            {enabled ? 'ON' : 'OFF'}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0.1"
                            max="60"
                            step="0.1"
                            value={editValue}
                            onChange={(e) => setRateLimitEdits({...rateLimitEdits, [endpoint]: parseFloat(e.target.value) || 0.5})}
                            className="flex-1 bg-zinc-900/70 border border-zinc-700/50 rounded px-2 py-1 text-[10px] text-foreground focus:border-primary/50 focus:outline-none"
                          />
                          <span className="text-mutedForeground text-[9px] whitespace-nowrap">sec between clicks</span>
                          {hasChanged && (
                            <button
                              onClick={() => handleUpdateRateLimit(endpoint, editValue)}
                              className="px-2 py-1 rounded text-[9px] font-bold bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 transition-all"
                            >
                              SAVE
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {rateLimits.note && (
                  <p className="text-[9px] text-mutedForeground italic mt-2">💡 {rateLimits.note}</p>
                )}
              </div>
            )}

            <ActionRow icon={Trash2} label="Clear Old Flags" description="Remove flags older than 30 days" color="text-red-400">
              <BtnDanger onClick={handleClearOldFlags} disabled={securityLoading}>
                {securityLoading ? '...' : 'Clear'}
              </BtnDanger>
            </ActionRow>
          </div>
        )}
      </div>

      {/* Activity Log */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={ScrollText}
          title="Activity Log"
          badge={activityLog.entries?.length != null && <span className="text-[10px] font-heading text-mutedForeground">{activityLog.entries.length} entries</span>}
          isCollapsed={collapsed.activityLog}
          onToggle={() => toggleSection('activityLog')}
        />
        {!collapsed.activityLog && (
          <div className="p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={activityLogUsername}
                onChange={(e) => setActivityLogUsername(e.target.value)}
                placeholder="Filter by username"
                className="flex-1 min-w-[120px] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
              />
              <BtnPrimary onClick={fetchActivityLog} disabled={activityLogLoading}>
                {activityLogLoading ? '...' : 'Load'}
              </BtnPrimary>
            </div>
            <div className="max-h-64 overflow-y-auto rounded border border-zinc-700/50">
              <table className="w-full text-[10px] font-heading">
                <thead className="bg-zinc-800/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2 text-mutedForeground uppercase">Time</th>
                    <th className="text-left p-2 text-mutedForeground uppercase">User</th>
                    <th className="text-left p-2 text-mutedForeground uppercase">Action</th>
                    <th className="text-left p-2 text-mutedForeground uppercase">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(activityLog.entries || []).map((e) => (
                    <tr key={e.id} className="border-t border-zinc-700/30 hover:bg-zinc-800/30">
                      <td className="p-2 text-mutedForeground whitespace-nowrap">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</td>
                      <td className="p-2 text-primary font-bold">{e.username || '—'}</td>
                      <td className="p-2">{e.action || '—'}</td>
                      <td className="p-2 text-mutedForeground max-w-[200px] truncate" title={JSON.stringify(e.details || {})}>{e.details ? JSON.stringify(e.details) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(activityLog.entries || []).length === 0 && !activityLogLoading && <p className="text-xs text-mutedForeground">Load to see crimes, forum topics/comments.</p>}
          </div>
        )}
      </div>

      {/* Gambling Log */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Dice5}
          title="Gambling Log"
          badge={gamblingLog.entries?.length != null && <span className="text-[10px] font-heading text-mutedForeground">{gamblingLog.entries.length} entries</span>}
          isCollapsed={collapsed.gamblingLog}
          onToggle={() => toggleSection('gamblingLog')}
        />
        {!collapsed.gamblingLog && (
          <div className="p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={gamblingLogUsername}
                onChange={(e) => setGamblingLogUsername(e.target.value)}
                placeholder="Filter by username"
                className="min-w-[100px] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
              />
              <select
                value={gamblingLogGameType}
                onChange={(e) => setGamblingLogGameType(e.target.value)}
                className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
              >
                <option value="">All games</option>
                <option value="dice">Dice</option>
                <option value="blackjack">Blackjack</option>
                <option value="sports_bet">Sports</option>
              </select>
              <BtnPrimary onClick={fetchGamblingLog} disabled={gamblingLogLoading}>
                {gamblingLogLoading ? '...' : 'Load'}
              </BtnPrimary>
            </div>
            <div className="max-h-64 overflow-y-auto rounded border border-zinc-700/50">
              <table className="w-full text-[10px] font-heading">
                <thead className="bg-zinc-800/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2 text-mutedForeground uppercase">Time</th>
                    <th className="text-left p-2 text-mutedForeground uppercase">User</th>
                    <th className="text-left p-2 text-mutedForeground uppercase">Game</th>
                    <th className="text-left p-2 text-mutedForeground uppercase">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(gamblingLog.entries || []).map((e) => (
                    <tr key={e.id} className="border-t border-zinc-700/30 hover:bg-zinc-800/30">
                      <td className="p-2 text-mutedForeground whitespace-nowrap">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</td>
                      <td className="p-2 text-primary font-bold">{e.username || '—'}</td>
                      <td className="p-2">{e.game_type || '—'}</td>
                      <td className="p-2 text-mutedForeground max-w-[220px] truncate" title={JSON.stringify(e.details || {})}>{e.details ? JSON.stringify(e.details) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-700/30">
              <span className="text-[10px] text-mutedForeground">Clear logs older than</span>
              <input
                type="number"
                min={1}
                value={clearGamblingDays}
                onChange={(e) => setClearGamblingDays(parseInt(e.target.value) || 30)}
                className="w-14 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs"
              />
              <span className="text-[10px] text-mutedForeground">days</span>
              <BtnDanger onClick={handleClearGamblingLog} disabled={clearGamblingLoading}>
                {clearGamblingLoading ? '...' : 'Clear old'}
              </BtnDanger>
            </div>
            {(gamblingLog.entries || []).length === 0 && !gamblingLogLoading && <p className="text-xs text-mutedForeground">Load to see dice, blackjack, sports bets.</p>}
          </div>
        )}
      </div>

      {/* Database Management */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-red-500/30`}>
        <SectionHeader
          icon={Skull}
          title="Database Management"
          color="text-red-400"
          isCollapsed={collapsed.database}
          onToggle={() => toggleSection('database')}
        />
        {!collapsed.database && (
          <div className="p-3 space-y-3">
            {/* Find Duplicates */}
            <div className="space-y-2">
              <label className="text-[10px] text-mutedForeground font-heading uppercase">Find Duplicate Users</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Username (optional)"
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <BtnPrimary onClick={handleFindDuplicates} disabled={dbLoading}>
                  {dbLoading ? '...' : 'Search'}
                </BtnPrimary>
              </div>
              {searchResults && (
                <pre className="max-h-32 overflow-y-auto text-[10px] p-2 rounded bg-zinc-900/50 border border-zinc-700/50 text-mutedForeground">
                  {JSON.stringify(searchResults, null, 2)}
                </pre>
              )}
            </div>

            {/* Delete User */}
            <div className="space-y-2">
              <label className="text-[10px] text-mutedForeground font-heading uppercase">Delete Single User</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="User ID"
                  value={deleteUserId}
                  onChange={(e) => setDeleteUserId(e.target.value)}
                  className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <BtnDanger onClick={handleDeleteUser} disabled={dbLoading}>
                  {dbLoading ? '...' : 'Delete'}
                </BtnDanger>
              </div>
            </div>

            {/* Wipe All */}
            <div className="space-y-2 p-2 rounded border border-red-500/50 bg-red-500/5">
              <label className="text-[10px] text-red-400 font-heading uppercase font-bold">⚠️ WIPE ALL USERS</label>
              <p className="text-[10px] text-red-400/80">Permanently deletes ALL users and game data. Cannot be undone.</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder='Type "WIPE ALL"'
                  value={wipeConfirmText}
                  onChange={(e) => setWipeConfirmText(e.target.value)}
                  className="flex-1 bg-zinc-900/50 border border-red-500/50 rounded px-2 py-1 text-xs text-foreground focus:border-red-500 focus:outline-none"
                />
                <BtnDanger onClick={handleWipeAllUsers} disabled={dbLoading || wipeConfirmText !== 'WIPE ALL'}>
                  {dbLoading ? '...' : 'WIPE'}
                </BtnDanger>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
