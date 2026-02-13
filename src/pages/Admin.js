import { useState, useEffect } from 'react';
import { Settings, UserCog, Coins, Car, Lock, Skull, Bot, Crosshair, Shield, Building2, Zap, Gift, Trash2, Clock } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

export default function Admin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [npcData, setNpcData] = useState({ npcs: [], npcs_enabled: false, npc_count: 0 });
  const [npcCount, setNpcCount] = useState(10);
  const [forceOnlineInfo, setForceOnlineInfo] = useState(null);
  const [ranks, setRanks] = useState([]);
  const [cars, setCars] = useState([]);
  const [bgTestCount, setBgTestCount] = useState(2);
  const [formData, setFormData] = useState({
    targetUsername: '',
    newRank: 1,
    points: 100,
    bullets: 5000,
    carId: 'car1',
    lockMinutes: 5,
    searchMinutes: 1
  });

  useEffect(() => {
    checkAdmin();
  }, []);

  const [eventsEnabled, setEventsEnabled] = useState(true);
  const [allEventsForTesting, setAllEventsForTesting] = useState(false);
  const [todayEvent, setTodayEvent] = useState(null);
  
  // Database management state
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

  const checkAdmin = async () => {
    try {
      const response = await api.get('/admin/check');
      setIsAdmin(response.data.is_admin);
      if (response.data.is_admin) {
        fetchNPCs();
        fetchMeta();
        fetchEventsStatus();
      }
    } catch (error) {
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  };

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

  const handleToggleEvents = async () => {
    try {
      const res = await api.post('/admin/events/toggle', { enabled: !eventsEnabled });
      setEventsEnabled(!!res.data?.events_enabled);
      toast.success(res.data?.message || 'Events toggled');
      fetchEventsStatus();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle events');
    }
  };

  const handleToggleAllEventsForTesting = async () => {
    try {
      const res = await api.post('/admin/events/all-for-testing', { enabled: !allEventsForTesting });
      setAllEventsForTesting(!!res.data?.all_events_for_testing);
      toast.success(res.data?.message || 'All events for testing toggled');
      fetchEventsStatus();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle all events for testing');
    }
  };

  const fetchMeta = async () => {
    try {
      const [ranksRes, carsRes] = await Promise.all([
        api.get('/meta/ranks'),
        api.get('/meta/cars'),
      ]);
      setRanks(Array.isArray(ranksRes.data?.ranks) ? ranksRes.data.ranks : []);
      setCars(Array.isArray(carsRes.data?.cars) ? carsRes.data.cars : []);
    } catch (e) {
      // optional; UI will fall back to numeric selects
      setRanks([]);
      setCars([]);
    }
  };

  const fetchNPCs = async () => {
    try {
      const response = await api.get('/admin/npcs');
      setNpcData(response.data);
    } catch (error) {
      console.error('Failed to fetch NPCs');
    }
  };

  const handleToggleNPCs = async (enabled) => {
    try {
      const response = await api.post('/admin/npcs/toggle', {
        enabled,
        count: enabled ? npcCount : 0
      });
      toast.success(response.data.message);
      fetchNPCs();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleChangeRank = async () => {
    try {
      const response = await api.post(`/admin/change-rank?target_username=${formData.targetUsername}&new_rank=${formData.newRank}`);
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleAddPoints = async () => {
    try {
      const response = await api.post(`/admin/add-points?target_username=${formData.targetUsername}&points=${formData.points}`);
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleAddBullets = async () => {
    try {
      const response = await api.post(
        `/admin/add-bullets?target_username=${formData.targetUsername}&bullets=${formData.bullets}`
      );
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleAddCar = async () => {
    try {
      const response = await api.post(`/admin/add-car?target_username=${formData.targetUsername}&car_id=${formData.carId}`);
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleLockPlayer = async () => {
    try {
      const response = await api.post(`/admin/lock-player?target_username=${formData.targetUsername}&lock_minutes=${formData.lockMinutes}`);
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleKillPlayer = async () => {
    try {
      const response = await api.post(`/admin/kill-player?target_username=${formData.targetUsername}`);
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleSetSearchTime = async () => {
    try {
      const response = await api.post(`/admin/set-search-time?target_username=${formData.targetUsername}&search_minutes=${formData.searchMinutes}`);
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleSetAllSearchTime5 = async () => {
    if (!window.confirm('Set every user\'s search timer to 5 minutes? (Affects all users and any active searches.)')) return;
    try {
      const res = await api.post('/admin/set-all-search-time?search_minutes=5');
      toast.success(res.data?.message || 'All search timers set to 5 minutes');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleClearAllSearches = async () => {
    if (!window.confirm('Delete ALL attack searches for every user? This cannot be undone.')) return;
    setClearSearchesLoading(true);
    try {
      const res = await api.post('/admin/clear-all-searches');
      toast.success(res.data?.message || 'All searches cleared');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setClearSearchesLoading(false);
    }
  };

  const handleResetHitlistNpcTimers = async () => {
    if (!window.confirm('Reset hitlist NPC timers for everyone? All users will be able to add NPCs again (3 per 3h from now).')) return;
    setResetNpcTimersLoading(true);
    try {
      const res = await api.post('/admin/hitlist/reset-npc-timers');
      toast.success(res.data?.message || 'Hitlist NPC timers reset');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setResetNpcTimersLoading(false);
    }
  };

  const handleForceOnline = async () => {
    try {
      const res = await api.post('/admin/force-online');
      setForceOnlineInfo(res.data);
      toast.success(res.data?.message || 'Forced offline users online');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleClearBodyguards = async () => {
    try {
      const res = await api.post(`/admin/bodyguards/clear?target_username=${encodeURIComponent(formData.targetUsername)}`);
      toast.success(res.data?.message || 'Cleared bodyguards');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleDropAllHumanBodyguards = async () => {
    if (!window.confirm('Remove all human bodyguard slots from every user? Robot bodyguards will be kept.')) return;
    setDropHumanBgLoading(true);
    try {
      const res = await api.post('/admin/bodyguards/drop-all-human');
      toast.success(res.data?.message || 'Dropped all human bodyguards');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setDropHumanBgLoading(false);
    }
  };

  const handleGenerateBodyguards = async () => {
    try {
      const res = await api.post('/admin/bodyguards/generate', {
        target_username: formData.targetUsername,
        count: bgTestCount,
        replace_existing: true,
      });
      toast.success(res.data?.message || 'Generated bodyguards');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  // Database management handlers
  const handleFindDuplicates = async () => {
    setDbLoading(true);
    try {
      const url = searchUsername.trim()
        ? '/admin/find-duplicates?username=' + encodeURIComponent(searchUsername.trim())
        : '/admin/find-duplicates';
      const res = await api.get(url);
      setSearchResults(res.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to search');
    } finally {
      setDbLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUserId.trim()) {
      toast.error('Enter a user ID');
      return;
    }
    if (!window.confirm('Are you sure you want to DELETE this user? This cannot be undone!')) {
      return;
    }
    setDbLoading(true);
    try {
      const res = await api.post('/admin/delete-user/' + encodeURIComponent(deleteUserId.trim()));
      toast.success(res.data?.message || 'User deleted');
      setDeleteUserId('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete user');
    } finally {
      setDbLoading(false);
    }
  };

  const handleWipeAllUsers = async () => {
    if (wipeConfirmText !== 'WIPE ALL') {
      toast.error('Type "WIPE ALL" to confirm');
      return;
    }
    if (!window.confirm('FINAL WARNING: This will delete ALL users and game data. Are you absolutely sure?')) {
      return;
    }
    setDbLoading(true);
    try {
      const res = await api.post('/admin/wipe-all-users');
      toast.success(res.data?.message || 'All users wiped');
      setWipeConfirmText('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to wipe');
    } finally {
      setDbLoading(false);
    }
  };

  const handleSeedFamilies = async () => {
    if (!window.confirm('Create 3 families (Corleone, Baranco, Stracci) with 5 test users each? Password for all: test1234')) return;
    try {
      const res = await api.post('/admin/seed-families');
      toast.success(res.data?.message || 'Families seeded');
      if (res.data?.users?.length) {
        console.log('Seeded users:', res.data.users);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleGiveAllPoints = async () => {
    if (!window.confirm(`Give ${giveAllPoints} points to ALL alive accounts?`)) return;
    try {
      const res = await api.post(`/admin/give-all-points?points=${giveAllPoints}`);
      toast.success(res.data?.message || 'Points given to all');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleGiveAllMoney = async () => {
    if (!window.confirm(`Give $${giveAllMoney.toLocaleString()} to ALL alive accounts?`)) return;
    try {
      const res = await api.post(`/admin/give-all-money?amount=${giveAllMoney}`);
      toast.success(res.data?.message || 'Money given to all');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className={`text-xl font-heading ${styles.textGold}`}>Loading...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="flex items-center gap-3 justify-center mb-2">
            <div className="h-px w-12 bg-primary/60" />
            <h2 className="text-2xl font-heading font-bold text-red-400">Access Denied</h2>
            <div className="h-px w-12 bg-primary/60" />
          </div>
          <p className={`font-heading ${styles.textMuted}`}>Admin privileges required</p>
        </div>
      </div>
    );
  }

  const panelHeader = `${styles.panelHeader} px-4 py-2 flex items-center justify-between flex-wrap gap-2`;
  const inputClass = `${styles.input} w-full h-10 px-3 text-sm font-heading`;
  const btnPrimary = `${styles.btnPrimary} rounded-sm font-heading font-bold uppercase tracking-wider py-2 px-4 text-xs min-h-[44px]`;
  const btnDanger = `${styles.surface} border border-red-500/50 text-red-400 hover:bg-red-500/10 rounded-sm font-heading font-bold uppercase tracking-wider py-2 px-4 text-xs min-h-[44px]`;

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="admin-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">Admin Tools</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Use with caution</p>
      </div>

      {/* Target user – shared for all actions below */}
      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`}>
          <div className={panelHeader}>
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Target Username</span>
          </div>
          <div className="p-4">
            <input
              type="text"
              value={formData.targetUsername}
              onChange={(e) => setFormData({ ...formData, targetUsername: e.target.value })}
              className={inputClass}
              placeholder="Enter username for actions below"
            />
          </div>
        </div>
      </div>

      {/* NPC Management */}
      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`} data-testid="npc-management">
          <div className={panelHeader}>
            <div className="flex items-center gap-2">
              <Bot className={styles.textGold} size={18} />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">NPC Management</span>
            </div>
            <div className="text-xs font-heading text-mutedForeground">
              Status: <span className={`font-bold ${npcData.npcs_enabled ? 'text-emerald-400' : 'text-red-400'}`}>{npcData.npcs_enabled ? 'Enabled' : 'Disabled'}</span>
              <span className="text-primary/50"> · </span>
              Active: <span className="font-bold text-foreground">{npcData.npc_count}</span>
            </div>
          </div>
          <div className="p-4">
            <p className={`text-sm font-heading mb-4 ${styles.textMuted}`}>
              Create test NPCs with random ranks and wealth for testing kills, attacks, and other features.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-6">
                <label className={`block text-xs font-heading mb-1 uppercase tracking-wider ${styles.textMuted}`}>Number of NPCs</label>
                <input type="number" min="1" max="50" value={npcCount} onChange={(e) => setNpcCount(parseInt(e.target.value) || 10)} className={inputClass} />
              </div>
              <div className="sm:col-span-6 flex gap-2">
                <button onClick={() => handleToggleNPCs(true)} className={`flex-1 ${btnPrimary}`}>Enable</button>
                <button onClick={() => handleToggleNPCs(false)} className={`flex-1 ${btnDanger}`}>Disable</button>
              </div>
            </div>
            {npcData.npcs.length > 0 && (
              <div className={`mt-4 max-h-40 overflow-y-auto rounded-sm overflow-hidden border ${styles.borderGoldLight}`}>
                <div className={`grid grid-cols-12 text-xs font-heading font-bold uppercase tracking-wider px-3 py-2 border-b ${styles.panelHeader}`}>
                  <div className="col-span-4 text-primary/80">Name</div>
                  <div className="col-span-3">Rank</div>
                  <div className="col-span-3">Money</div>
                  <div className="col-span-2 text-right">Location</div>
                </div>
                {npcData.npcs.slice(0, 10).map((npc) => (
                  <div key={npc.id} className={`grid grid-cols-12 px-3 py-2 border-b border-primary/10 text-xs font-heading ${styles.raisedHover}`}>
                    <div className={`col-span-4 font-bold truncate ${styles.textForeground}`}>{npc.username}</div>
                    <div className={`col-span-3 truncate ${styles.textMuted}`}>{npc.rank_name}</div>
                    <div className={`col-span-3 ${styles.textMuted}`}>${npc.money?.toLocaleString()}</div>
                    <div className={`col-span-2 text-right truncate ${styles.textMuted}`}>{npc.current_state}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Game events */}
      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`} data-testid="admin-events">
          <div className={panelHeader}>
            <div className="flex items-center gap-2">
              <Zap className={styles.textGold} size={18} />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Game events</span>
            </div>
            <div className={`text-xs font-heading ${styles.textMuted}`}>
              Daily: <span className={`font-bold ${eventsEnabled ? 'text-emerald-400' : 'text-red-400'}`}>{eventsEnabled ? 'On' : 'Off'}</span>
              {todayEvent?.name && <span className="text-primary/50"> · {todayEvent.name}</span>}
              {allEventsForTesting && <span className="text-amber-400 font-bold"> · All (testing) ON</span>}
            </div>
          </div>
          <div className="p-4">
            <p className={`text-sm font-heading mb-3 ${styles.textMuted}`}>
              When enabled, daily events rotate. When disabled, all multipliers are 1x.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={handleToggleEvents}
                className={`rounded-sm font-heading font-bold uppercase tracking-wider py-2 px-4 text-xs min-h-[44px] ${eventsEnabled ? btnDanger : btnPrimary}`}
                data-testid="admin-events-toggle"
              >
                {eventsEnabled ? 'Disable events' : 'Enable events'}
              </button>
              <button
                onClick={handleToggleAllEventsForTesting}
                className={`rounded-sm font-heading font-bold uppercase tracking-wider py-2 px-4 text-xs min-h-[44px] border ${allEventsForTesting ? 'bg-amber-600/30 border-amber-500/50 text-amber-400 hover:opacity-90' : `${styles.surface} border-primary/30 text-foreground hover:opacity-90`}`}
                data-testid="admin-all-events-testing-toggle"
              >
                {allEventsForTesting ? 'Disable all (testing)' : 'Enable all (testing)'}
              </button>
            </div>
            <p className={`text-xs font-heading mt-2 ${styles.textMuted}`}>
              All events (testing): applies every event multiplier at once.
            </p>
          </div>
        </div>
      </div>

      {/* Seed families */}
      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`}>
          <div className={panelHeader}>
            <div className="flex items-center gap-2">
              <Building2 className={styles.textGold} size={18} />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Seed test families</span>
            </div>
          </div>
          <div className="p-4">
            <p className={`text-sm font-heading mb-3 ${styles.textMuted}`}>
              Creates 3 families (Corleone, Baranco, Stracci) with 5 members each — 15 test users. Password: <span className={`font-bold ${styles.textForeground}`}>test1234</span>. Skips existing.
            </p>
            <button onClick={handleSeedFamilies} className={btnPrimary}>Seed 3 families (15 users)</button>
          </div>
        </div>
      </div>

      {/* Force Online */}
      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`}>
          <div className={panelHeader}>
            <div className="flex items-center gap-2">
              <UserCog className={styles.textGold} size={18} />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Force Online</span>
            </div>
            {forceOnlineInfo?.until && (
              <div className={`text-xs font-heading ${styles.textMuted}`}>
                Until: <span className={`font-bold ${styles.textForeground}`}>{new Date(forceOnlineInfo.until).toLocaleString()}</span>
              </div>
            )}
          </div>
          <div className="p-4">
            <p className={`text-sm font-heading mb-3 ${styles.textMuted}`}>
              Brings <span className={`font-bold ${styles.textForeground}`}>offline</span> (alive) users online for <span className={`font-bold ${styles.textForeground}`}>1 hour</span>.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={handleForceOnline} className={btnPrimary} data-testid="admin-force-online">
                Force Offline Users Online (1h)
              </button>
              {typeof forceOnlineInfo?.updated === 'number' && (
                <div className={`text-xs font-heading ${styles.textMuted}`}>
                  Updated: <span className={`font-bold ${styles.textForeground}`}>{forceOnlineInfo.updated}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Give All Points / Give All Money */}
      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`}>
          <div className={panelHeader}>
            <div className="flex items-center gap-2">
              <Gift className={styles.textGold} size={18} />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Give to All</span>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <p className={`text-sm font-heading ${styles.textMuted}`}>
              Give points or money to <span className={`font-bold ${styles.textForeground}`}>every alive account</span> (excludes dead, NPCs, and bodyguards).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-5">
                <label className={`block text-xs font-heading mb-1 uppercase tracking-wider ${styles.textMuted}`}>Points each</label>
                <input type="number" min="1" value={giveAllPoints} onChange={(e) => setGiveAllPoints(parseInt(e.target.value) || 1)} className={inputClass} />
              </div>
              <div className="sm:col-span-4">
                <button onClick={handleGiveAllPoints} className={`w-full ${btnPrimary}`}>Give Points to All</button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-5">
                <label className={`block text-xs font-heading mb-1 uppercase tracking-wider ${styles.textMuted}`}>Money each ($)</label>
                <input type="number" min="1" value={giveAllMoney} onChange={(e) => setGiveAllMoney(parseInt(e.target.value) || 10000)} className={inputClass} />
              </div>
              <div className="sm:col-span-4">
                <button onClick={handleGiveAllMoney} className={`w-full ${btnPrimary}`}>Give Money to All</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Player actions – use target username above */}
      <div className="flex justify-center">
        <div className="w-full max-w-3xl">
          <h2 className={`text-sm font-heading font-bold uppercase tracking-widest mb-3 ${styles.textGold}`}>Player actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <UserCog className={styles.textGold} size={20} />
                <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Change Rank</h3>
              </div>
              {ranks.length > 0 ? (
                <select value={String(formData.newRank)} onChange={(e) => setFormData({ ...formData, newRank: parseInt(e.target.value) })} className={`${inputClass} mb-3`}>
                  {ranks.map((r) => (<option key={r.id} value={String(r.id)}>{r.name} (Rank {r.id})</option>))}
                </select>
              ) : (
                <input type="number" min="1" max="11" value={formData.newRank} onChange={(e) => setFormData({ ...formData, newRank: parseInt(e.target.value) })} className={`${inputClass} mb-3`} />
              )}
              <button onClick={handleChangeRank} className={`w-full ${btnPrimary}`}>Change Rank</button>
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Coins className={styles.textGold} size={20} />
                <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Add Points</h3>
              </div>
              <input type="number" value={formData.points} onChange={(e) => setFormData({ ...formData, points: parseInt(e.target.value) })} className={`${inputClass} mb-3`} />
              <button onClick={handleAddPoints} className={`w-full ${btnPrimary}`}>Add Points</button>
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Crosshair className={styles.textGold} size={20} />
                <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Give Bullets</h3>
              </div>
              <input type="number" min="1" value={formData.bullets} onChange={(e) => setFormData({ ...formData, bullets: parseInt(e.target.value) })} className={`${inputClass} mb-3`} />
              <button onClick={handleAddBullets} className={`w-full ${btnPrimary}`}>Give Bullets</button>
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Car className={styles.textGold} size={20} />
                <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Add Car</h3>
              </div>
              <select value={formData.carId} onChange={(e) => setFormData({ ...formData, carId: e.target.value })} className={`${inputClass} mb-3`}>
                {cars.length > 0 ? cars.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>)) : Array.from({ length: 20 }, (_, i) => i + 1).map(i => (<option key={i} value={`car${i}`}>Car {i}</option>))}
              </select>
              <button onClick={handleAddCar} className={`w-full ${btnPrimary}`}>Add Car</button>
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Lock className="text-red-400" size={20} />
                <h3 className="font-heading font-bold text-red-400 text-sm uppercase tracking-wider">Lock Player</h3>
              </div>
              <input type="number" value={formData.lockMinutes} onChange={(e) => setFormData({ ...formData, lockMinutes: parseInt(e.target.value) })} className={`${inputClass} mb-3`} placeholder="Minutes" />
              <button onClick={handleLockPlayer} className={`w-full ${btnDanger}`}>Lock Player</button>
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Skull className="text-red-400" size={20} />
                <h3 className="font-heading font-bold text-red-400 text-sm uppercase tracking-wider">Kill Player</h3>
              </div>
              <p className={`text-xs font-heading mb-3 ${styles.textMuted}`}>Takes 20% of their money</p>
              <button onClick={handleKillPlayer} className={`w-full ${btnDanger}`}>Kill Player</button>
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Settings className={styles.textGold} size={20} />
                <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Set Search Time</h3>
              </div>
              <input type="number" value={formData.searchMinutes} onChange={(e) => setFormData({ ...formData, searchMinutes: parseInt(e.target.value) })} className={`${inputClass} mb-3`} placeholder="Minutes" />
              <button onClick={handleSetSearchTime} className={`w-full ${btnPrimary}`}>Set Search Time (Persistent)</button>
              <p className={`text-xs font-heading mt-2 ${styles.textMuted}`}>Set to 0 to clear override.</p>
              <button onClick={handleSetAllSearchTime5} className={`w-full mt-3 ${btnPrimary}`}>Set Everyone to 5 mins</button>
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Trash2 className={styles.textGold} size={20} />
                <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Clear All Searches</h3>
              </div>
              <p className={`text-xs font-heading mb-3 ${styles.textMuted}`}>Remove every attack/search from the database (all users).</p>
              <button onClick={handleClearAllSearches} disabled={clearSearchesLoading} className={`w-full ${btnDanger} disabled:opacity-50`}>
                {clearSearchesLoading ? 'Clearing...' : 'Clear All Searches'}
              </button>
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Clock className={styles.textGold} size={20} />
                <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Reset Hitlist NPC Timers</h3>
              </div>
              <p className={`text-xs font-heading mb-3 ${styles.textMuted}`}>Clear everyone&apos;s &quot;3 per 3 hours&quot; NPC add window. All users can add NPCs again immediately.</p>
              <button onClick={handleResetHitlistNpcTimers} disabled={resetNpcTimersLoading} className={`w-full ${btnPrimary} disabled:opacity-50`}>
                {resetNpcTimersLoading ? 'Resetting...' : "Reset Everyone's NPC Timers"}
              </button>
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4 md:col-span-2`}>
              <div className="flex items-center gap-2 mb-3">
                <Shield className={styles.textGold} size={20} />
                <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Bodyguard Testing</h3>
              </div>
              <p className={`text-xs font-heading mb-3 ${styles.textMuted}`}>Clear or generate robot bodyguards for target user.</p>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-4">
                  <label className={`block text-xs font-heading uppercase tracking-wider mb-2 ${styles.textMuted}`}>Generate count (1–4)</label>
                  <input type="number" min="1" max="4" value={bgTestCount} onChange={(e) => setBgTestCount(parseInt(e.target.value) || 1)} className={inputClass} />
                </div>
                <div className="md:col-span-8 flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button onClick={handleGenerateBodyguards} className={`flex-1 ${btnPrimary}`}>Generate Robot Bodyguards</button>
                    <button onClick={handleClearBodyguards} className={`flex-1 ${btnDanger}`}>Drop All Bodyguards</button>
                  </div>
                  <button onClick={handleDropAllHumanBodyguards} disabled={dropHumanBgLoading} className={`w-full ${btnDanger} disabled:opacity-50`}>
                    {dropHumanBgLoading ? 'Dropping...' : 'Drop All Human Bodyguards'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Database Management */}
      <div className="flex justify-center mt-8">
        <div className="w-full max-w-3xl">
          <h2 className={`text-sm font-heading font-bold uppercase tracking-widest mb-4 ${styles.textGold}`}>Database Management</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <UserCog className={styles.textGold} size={20} />
                <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Find Duplicate Users</h3>
              </div>
              <input
                type="text"
                placeholder="Search username (or leave empty for all duplicates)"
                value={searchUsername}
                onChange={(e) => setSearchUsername(e.target.value)}
                className={`${inputClass} mb-3`}
              />
              <button onClick={handleFindDuplicates} disabled={dbLoading} className={`w-full ${btnPrimary} disabled:opacity-50`}>
                {dbLoading ? 'Searching...' : 'Search'}
              </button>
              {searchResults && (
                <pre className={`mt-3 max-h-64 overflow-y-auto text-xs p-2 rounded-sm font-heading whitespace-pre-wrap border ${styles.surface} ${styles.borderGoldLight}`}>
                  {JSON.stringify(searchResults, null, 2)}
                </pre>
              )}
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Skull className="text-red-400" size={20} />
                <h3 className="font-heading font-bold text-red-400 text-sm uppercase tracking-wider">Delete Single User</h3>
              </div>
              <p className={`text-xs font-heading mb-3 ${styles.textMuted}`}>Enter a user ID (from Find Duplicates) to permanently delete that account.</p>
              <input type="text" placeholder="User ID" value={deleteUserId} onChange={(e) => setDeleteUserId(e.target.value)} className={`${inputClass} mb-3`} />
              <button onClick={handleDeleteUser} disabled={dbLoading} className={`w-full ${btnDanger} disabled:opacity-50`}>
                {dbLoading ? 'Deleting...' : 'Delete User'}
              </button>
            </div>

            <div className={`${styles.panel} rounded-md overflow-hidden p-4 md:col-span-2 border-2 border-red-500/50`}>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="text-red-400" size={20} />
                <h3 className="font-heading font-bold text-red-400 uppercase tracking-wider">WIPE ALL USERS</h3>
              </div>
              <p className="text-xs text-red-400/90 font-heading mb-3">DANGER: Permanently deletes ALL users, families, bodyguards, cars, properties, attacks, and game data. Cannot be undone.</p>
              <input
                type="text"
                placeholder='Type "WIPE ALL" to confirm'
                value={wipeConfirmText}
                onChange={(e) => setWipeConfirmText(e.target.value)}
                className={`${inputClass} mb-3 border-red-500/50`}
              />
              <button
                onClick={handleWipeAllUsers}
                disabled={dbLoading || wipeConfirmText !== 'WIPE ALL'}
                className={`w-full ${btnDanger} disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {dbLoading ? 'Wiping...' : 'WIPE ALL USERS'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
