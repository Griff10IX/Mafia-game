import { useState, useEffect } from 'react';
import { Settings, UserCog, Coins, Car, Lock, Skull, Bot, Crosshair, Shield, Building2, Zap, Trash2 } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

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

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="text-primary text-xl font-heading">Loading...</div></div>;
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
          <p className="text-mutedForeground font-heading">Admin privileges required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="admin-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">Admin Tools</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Use with caution</p>
      </div>

      {/* NPC Management Section */}
      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5" data-testid="npc-management">
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Bot className="text-primary" size={18} />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">NPC Management</span>
            </div>
            <div className="text-xs font-heading text-mutedForeground">
              Status: <span className={`font-bold ${npcData.npcs_enabled ? 'text-emerald-400' : 'text-red-400'}`}>{npcData.npcs_enabled ? 'Enabled' : 'Disabled'}</span>
              <span className="text-primary/50"> · </span>
              Active: <span className="font-bold text-foreground">{npcData.npc_count}</span>
            </div>
          </div>

          <div className="p-4">
            <p className="text-sm text-mutedForeground font-heading mb-4">
              Create test NPCs with random ranks and wealth for testing kills, attacks, and other features.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-6">
                <label className="block text-xs font-heading text-mutedForeground mb-1 uppercase tracking-wider">Number of NPCs</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={npcCount}
                  onChange={(e) => setNpcCount(parseInt(e.target.value) || 10)}
                  className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-6 flex gap-2">
                <button
                  onClick={() => handleToggleNPCs(true)}
                  className="flex-1 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-xs border border-yellow-600/50 transition-smooth"
                >
                  Enable
                </button>
                <button
                  onClick={() => handleToggleNPCs(false)}
                  className="flex-1 bg-zinc-800 border border-red-500/40 text-red-400 hover:bg-red-500/20 rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-xs transition-smooth"
                >
                  Disable
                </button>
              </div>
            </div>

            {npcData.npcs.length > 0 && (
              <div className="mt-4 max-h-40 overflow-y-auto border border-primary/20 rounded-sm overflow-hidden">
                <div className="grid grid-cols-12 bg-zinc-800/50 text-xs font-heading font-bold text-primary/80 uppercase tracking-wider px-3 py-2 border-b border-primary/20">
                  <div className="col-span-4">Name</div>
                  <div className="col-span-3">Rank</div>
                  <div className="col-span-3">Money</div>
                  <div className="col-span-2 text-right">Location</div>
                </div>
                {npcData.npcs.slice(0, 10).map((npc) => (
                  <div key={npc.id} className="grid grid-cols-12 px-3 py-2 border-b border-primary/10 text-xs font-heading hover:bg-zinc-800/30">
                    <div className="col-span-4 text-foreground font-bold truncate">{npc.username}</div>
                    <div className="col-span-3 text-mutedForeground truncate">{npc.rank_name}</div>
                    <div className="col-span-3 text-mutedForeground">${npc.money?.toLocaleString()}</div>
                    <div className="col-span-2 text-right text-mutedForeground truncate">{npc.current_state}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Game events */}
      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden" data-testid="admin-events">
          <div className="px-4 py-2 bg-zinc-800/50 border-b border-primary/20 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Zap className="text-primary" size={18} />
              <span className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">Game events</span>
            </div>
            <div className="text-xs font-heading text-mutedForeground">
              Daily: <span className={`font-bold ${eventsEnabled ? 'text-emerald-400' : 'text-red-400'}`}>{eventsEnabled ? 'On' : 'Off'}</span>
              {todayEvent?.name && <span className="text-primary/50"> · {todayEvent.name}</span>}
              {allEventsForTesting && <span className="text-amber-400 font-bold"> · All (testing) ON</span>}
            </div>
          </div>
          <div className="p-4">
            <p className="text-sm text-mutedForeground font-heading mb-3">
              When enabled, daily events rotate. When disabled, all multipliers are 1x.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={handleToggleEvents}
                className={`rounded-sm font-heading font-bold uppercase tracking-wider py-2 px-4 text-xs transition-smooth ${eventsEnabled ? 'bg-zinc-800 border border-red-500/40 text-red-400 hover:bg-red-500/20' : 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 border border-yellow-600/50'}`}
                data-testid="admin-events-toggle"
              >
                {eventsEnabled ? 'Disable events' : 'Enable events'}
              </button>
              <button
                onClick={handleToggleAllEventsForTesting}
                className={`rounded-sm font-heading font-bold uppercase tracking-wider py-2 px-4 text-xs transition-smooth border ${allEventsForTesting ? 'bg-amber-600/30 border-amber-500/50 text-amber-400 hover:opacity-90' : 'bg-zinc-800 border-primary/30 text-foreground hover:bg-zinc-700'}`}
                data-testid="admin-all-events-testing-toggle"
              >
                {allEventsForTesting ? 'Disable all (testing)' : 'Enable all (testing)'}
              </button>
            </div>
            <p className="text-xs text-mutedForeground font-heading mt-2">
              All events (testing): applies every event multiplier at once.
            </p>
          </div>
        </div>
      </div>

      {/* Seed families */}
      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden">
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center gap-2">
            <Building2 className="text-primary" size={18} />
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Seed test families</span>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
          <div className="p-4">
            <p className="text-sm text-mutedForeground font-heading mb-3">
              Creates 3 families (Corleone, Baranco, Stracci) with 5 members each — 15 test users. Password: <span className="font-bold text-foreground">test1234</span>. Skips existing.
            </p>
            <button
              onClick={handleSeedFamilies}
              className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-2 px-4 text-xs border border-yellow-600/50 transition-smooth"
            >
              Seed 3 families (15 users)
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm p-4">
          <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-2">Target Username</label>
          <input
            type="text"
            value={formData.targetUsername}
            onChange={(e) => setFormData({ ...formData, targetUsername: e.target.value })}
            className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none placeholder:text-mutedForeground"
            placeholder="Enter username"
          />
        </div>
      </div>

      {/* Force Online Section */}
      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden">
          <div className="px-4 py-2 bg-zinc-800/50 border-b border-primary/20 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <UserCog className="text-primary" size={18} />
              <span className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">Force Online</span>
            </div>
            {forceOnlineInfo?.until && (
              <div className="text-xs font-heading text-mutedForeground">
                Until: <span className="font-bold text-foreground">{new Date(forceOnlineInfo.until).toLocaleString()}</span>
              </div>
            )}
          </div>
          <div className="p-4">
            <p className="text-sm text-mutedForeground font-heading mb-3">
              Brings <span className="text-foreground font-bold">offline</span> (alive) users online for <span className="text-foreground font-bold">1 hour</span>.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleForceOnline}
                className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-2 px-4 text-xs border border-yellow-600/50 transition-smooth"
                data-testid="admin-force-online"
              >
                Force Offline Users Online (1h)
              </button>
              {typeof forceOnlineInfo?.updated === 'number' && (
                <div className="text-xs font-heading text-mutedForeground">
                  Updated: <span className="font-bold text-foreground">{forceOnlineInfo.updated}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-3">
            <UserCog className="text-primary" size={20} />
            <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Change Rank</h3>
          </div>
          {ranks.length > 0 ? (
            <select
              value={String(formData.newRank)}
              onChange={(e) => setFormData({ ...formData, newRank: parseInt(e.target.value) })}
              className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none mb-3"
            >
              {ranks.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name} (Rank {r.id})
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min="1"
              max="11"
              value={formData.newRank}
              onChange={(e) => setFormData({ ...formData, newRank: parseInt(e.target.value) })}
              className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none mb-3"
            />
          )}
          <button onClick={handleChangeRank} className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase py-2 text-sm border border-yellow-600/50">Change Rank</button>
        </div>

        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-3">
            <Coins className="text-primary" size={20} />
            <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Add Points</h3>
          </div>
          <input
            type="number"
            value={formData.points}
            onChange={(e) => setFormData({...formData, points: parseInt(e.target.value)})}
            className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none mb-3"
          />
          <button onClick={handleAddPoints} className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase py-2 text-sm border border-yellow-600/50">Add Points</button>
        </div>

        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-3">
            <Crosshair className="text-primary" size={20} />
            <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Give Bullets</h3>
          </div>
          <input
            type="number"
            min="1"
            value={formData.bullets}
            onChange={(e) => setFormData({ ...formData, bullets: parseInt(e.target.value) })}
            className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none mb-3"
          />
          <button onClick={handleAddBullets} className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase py-2 text-sm border border-yellow-600/50">Give Bullets</button>
        </div>

        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-3">
            <Car className="text-primary" size={20} />
            <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Add Car</h3>
          </div>
          <select
            value={formData.carId}
            onChange={(e) => setFormData({...formData, carId: e.target.value})}
            className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none mb-3"
          >
            {cars.length > 0 ? (
              cars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            ) : (
              Array.from({length: 20}, (_, i) => i + 1).map(i => (
                <option key={i} value={`car${i}`}>Car {i}</option>
              ))
            )}
          </select>
          <button onClick={handleAddCar} className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase py-2 text-sm border border-yellow-600/50">Add Car</button>
        </div>

        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="text-red-400" size={20} />
            <h3 className="font-heading font-bold text-red-400 text-sm uppercase tracking-wider">Lock Player</h3>
          </div>
          <input
            type="number"
            value={formData.lockMinutes}
            onChange={(e) => setFormData({...formData, lockMinutes: parseInt(e.target.value)})}
            className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none mb-3 placeholder:text-mutedForeground"
            placeholder="Minutes"
          />
          <button onClick={handleLockPlayer} className="w-full bg-zinc-800 border border-red-500/50 text-red-400 hover:bg-red-500/20 rounded-sm font-heading font-bold uppercase py-2 text-sm">Lock Player</button>
        </div>

        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-3">
            <Skull className="text-red-400" size={20} />
            <h3 className="font-heading font-bold text-red-400 text-sm uppercase tracking-wider">Kill Player</h3>
          </div>
          <p className="text-xs text-mutedForeground font-heading mb-3">Takes 20% of their money</p>
          <button onClick={handleKillPlayer} className="w-full bg-zinc-800 border border-red-500/50 text-red-400 hover:bg-red-500/20 rounded-sm font-heading font-bold uppercase py-2 text-sm">Kill Player</button>
        </div>

        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-3">
            <Settings className="text-primary" size={20} />
            <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Set Search Time</h3>
          </div>
          <input
            type="number"
            value={formData.searchMinutes}
            onChange={(e) => setFormData({...formData, searchMinutes: parseInt(e.target.value)})}
            className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none mb-3 placeholder:text-mutedForeground"
            placeholder="Minutes"
          />
          <button onClick={handleSetSearchTime} className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase py-2 text-sm border border-yellow-600/50">Set Search Time (Persistent)</button>
          <p className="text-xs text-mutedForeground font-heading mt-2">Set to 0 to clear override.</p>
        </div>

        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4 md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="text-primary" size={20} />
            <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Bodyguard Testing</h3>
          </div>
          <p className="text-xs text-mutedForeground font-heading mb-3">
            Clear or generate robot bodyguards for target user.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label className="block text-xs font-heading text-mutedForeground uppercase tracking-wider mb-2">Generate count (1–4)</label>
              <input
                type="number"
                min="1"
                max="4"
                value={bgTestCount}
                onChange={(e) => setBgTestCount(parseInt(e.target.value) || 1)}
                className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div className="md:col-span-8 flex flex-col sm:flex-row gap-2">
              <button
                onClick={handleGenerateBodyguards}
                className="flex-1 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase py-2 text-sm border border-yellow-600/50"
              >
                Generate Robot Bodyguards
              </button>
              <button
                onClick={handleClearBodyguards}
                className="flex-1 bg-zinc-800 border border-red-500/50 text-red-400 hover:bg-red-500/20 rounded-sm font-heading font-bold uppercase py-2 text-sm"
              >
                Drop All Bodyguards
              </button>
            </div>
          </div>
        </div>
        </div>

        {/* Database Management Section */}
        <div className="flex items-center gap-2 mt-8 mb-4">
          <div className="w-6 h-px bg-primary/50" />
          <Settings size={20} className="text-red-400" />
          <h2 className="text-sm font-heading font-bold text-primary/80 uppercase tracking-widest">Database Management</h2>
          <div className="flex-1 h-px bg-primary/30" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Find Duplicates */}
          <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserCog className="text-primary" size={20} />
              <h3 className="font-heading font-bold text-primary text-sm uppercase tracking-wider">Find Duplicate Users</h3>
            </div>
            <input
              type="text"
              placeholder="Search username (or leave empty for all duplicates)"
              value={searchUsername}
              onChange={(e) => setSearchUsername(e.target.value)}
              className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none placeholder:text-mutedForeground mb-3"
            />
            <button
              onClick={handleFindDuplicates}
              disabled={dbLoading}
              className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase py-2 text-sm border border-yellow-600/50 disabled:opacity-50"
            >
              {dbLoading ? 'Searching...' : 'Search'}
            </button>
            {searchResults && (
              <pre className="mt-3 max-h-64 overflow-y-auto text-xs bg-zinc-800/50 border border-primary/20 p-2 rounded-sm text-foreground font-heading whitespace-pre-wrap">
                {JSON.stringify(searchResults, null, 2)}
              </pre>
            )}
          </div>

          {/* Delete Single User */}
          <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4">
            <div className="flex items-center gap-2 mb-3">
              <Skull className="text-red-400" size={20} />
              <h3 className="font-heading font-bold text-red-400 text-sm uppercase tracking-wider">Delete Single User</h3>
            </div>
            <p className="text-xs text-mutedForeground font-heading mb-3">
              Enter a user ID (from Find Duplicates) to permanently delete that account.
            </p>
            <input
              type="text"
              placeholder="User ID"
              value={deleteUserId}
              onChange={(e) => setDeleteUserId(e.target.value)}
              className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-primary/50 focus:outline-none mb-3 placeholder:text-mutedForeground"
            />
            <button
              onClick={handleDeleteUser}
              disabled={dbLoading}
              className="w-full bg-zinc-800 border border-red-500/50 text-red-400 hover:bg-red-500/20 rounded-sm font-heading font-bold uppercase py-2 text-sm disabled:opacity-50"
            >
              {dbLoading ? 'Deleting...' : 'Delete User'}
            </button>
          </div>

          {/* Wipe All Users */}
          <div className="bg-gradient-to-b from-zinc-900 to-black border-2 border-red-500/60 rounded-sm overflow-hidden p-4 md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="text-red-400" size={20} />
              <h3 className="font-heading font-bold text-red-400 uppercase tracking-wider">WIPE ALL USERS</h3>
            </div>
            <p className="text-xs text-red-400/90 font-heading mb-3">
              DANGER: Permanently deletes ALL users, families, bodyguards, cars, properties, attacks, and game data. Cannot be undone.
            </p>
            <input
              type="text"
              placeholder='Type "WIPE ALL" to confirm'
              value={wipeConfirmText}
              onChange={(e) => setWipeConfirmText(e.target.value)}
              className="w-full bg-zinc-800/80 border border-red-500/50 rounded-sm h-10 px-3 text-foreground text-sm font-heading focus:border-red-500 focus:outline-none mb-3 placeholder:text-mutedForeground"
            />
            <button
              onClick={handleWipeAllUsers}
              disabled={dbLoading || wipeConfirmText !== 'WIPE ALL'}
              className="w-full bg-zinc-800 border border-red-500/50 text-red-400 hover:bg-red-500/20 rounded-sm font-heading font-bold uppercase py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {dbLoading ? 'Wiping...' : 'WIPE ALL USERS'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
