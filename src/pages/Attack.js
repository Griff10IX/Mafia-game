import { useMemo, useState, useEffect } from 'react';
import { Search, Plane, Car, Crosshair, Clock, MapPin, Skull, Calculator, Zap, FileText } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function Attack() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [targetUsername, setTargetUsername] = useState('');
  const [note, setNote] = useState('');
  const [attacks, setAttacks] = useState([]);
  const [selectedAttackIds, setSelectedAttackIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [show, setShow] = useState('all'); // all | searching | found
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState('kill'); // kill | calc
  const [killUsername, setKillUsername] = useState('');
  const [deathMessage, setDeathMessage] = useState('');
  const [makePublic, setMakePublic] = useState(false);
  const [inflationPct, setInflationPct] = useState(0);
  const [bulletsToUse, setBulletsToUse] = useState('');
  const [calcTarget, setCalcTarget] = useState('');
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcResult, setCalcResult] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [userBullets, setUserBullets] = useState(0);
  const [travelModalDestination, setTravelModalDestination] = useState(null);
  const [travelInfo, setTravelInfo] = useState(null);
  const [travelSubmitLoading, setTravelSubmitLoading] = useState(false);
  const [travelCountdown, setTravelCountdown] = useState(null);

  // Pre-fill search from hitlist link: /attack?target=Username
  useEffect(() => {
    const t = searchParams.get('target');
    if (t && typeof t === 'string' && t.trim()) {
      setTargetUsername(t.trim());
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('target');
        return next;
      }, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshAttacks();
    const interval = setInterval(refreshAttacks, 10000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchInflation();
    fetchBullets();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/events/active').then((r) => {
      setEvent(r.data?.event ?? null);
      setEventsEnabled(!!r.data?.events_enabled);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (travelCountdown == null || travelCountdown <= 0) return;
    const t = setInterval(() => {
      setTravelCountdown((c) => {
        if (c <= 1) {
          clearInterval(t);
          refreshUser();
          refreshAttacks();
          setTravelModalDestination(null);
          return null;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [travelCountdown]);

  const fetchBullets = async () => {
    try {
      const res = await api.get('/auth/me');
      setUserBullets(res.data?.bullets ?? 0);
    } catch (e) {}
  };

  const fetchInflation = async () => {
    try {
      const res = await api.get('/attack/inflation');
      setInflationPct(Number(res.data?.inflation_pct ?? 0));
    } catch (e) {
      // ignore
    }
  };

  const refreshAttacks = async () => {
    try {
      const response = await api.get('/attack/list');
      setAttacks(response.data.attacks || []);
    } catch (error) {
      // ignore
    }
  };

  const toggleSelected = (attackId) => {
    setSelectedAttackIds((prev) => (
      prev.includes(attackId) ? prev.filter((x) => x !== attackId) : [...prev, attackId]
    ));
  };

  const toggleSelectAllFiltered = (ids) => {
    setSelectedAttackIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((x) => !ids.includes(x));
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const deleteSelected = async (ids) => {
    const toDelete = (ids || []).filter(Boolean);
    if (toDelete.length === 0) return;
    setLoading(true);
    try {
      const res = await api.post('/attack/delete', { attack_ids: toDelete });
      toast.success(res.data?.message || `Deleted ${toDelete.length} search(es)`);
      setSelectedAttackIds((prev) => prev.filter((x) => !toDelete.includes(x)));
      await refreshAttacks();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete searches');
    } finally {
      setLoading(false);
    }
  };

  const searchTarget = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await api.post('/attack/search', { target_username: targetUsername, note });
      toast.success(response.data.message);
      setTargetUsername('');
      setNote('');
      await refreshAttacks();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to search target');
    } finally {
      setLoading(false);
    }
  };

  const openTravelModal = (locationState) => {
    setTravelModalDestination(locationState || null);
    setTravelInfo(null);
    if (locationState) {
      api.get('/travel/info').then((r) => setTravelInfo(r.data)).catch(() => setTravelInfo(null));
    }
  };

  const handleTravelFromModal = async (method) => {
    if (!travelModalDestination) return;
    setTravelSubmitLoading(true);
    try {
      const response = await api.post('/travel', { destination: travelModalDestination, travel_method: method });
      const travelTime = response.data?.travel_time ?? 0;
      if (travelTime <= 0) {
        toast.success(response.data?.message || `Traveled to ${travelModalDestination}`);
        setTravelModalDestination(null);
        refreshUser();
        await refreshAttacks();
      } else {
        toast.success(response.data?.message || `Traveling to ${travelModalDestination}`);
        setTravelCountdown(travelTime);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Travel failed');
    } finally {
      setTravelSubmitLoading(false);
    }
  };

  const executeAttack = async (attackId, extra = null) => {
    setLoading(true);
    try {
      const payload = extra ? { attack_id: attackId, ...extra } : { attack_id: attackId };
      const response = await api.post('/attack/execute', payload);
      if (response.data.success) {
        const rewardMoney = response.data.rewards?.money;
        toast.success(response.data.message, {
          description: rewardMoney != null ? `Rewards: $${Number(rewardMoney).toLocaleString()}` : undefined,
        });
      } else if (response.data.first_bodyguard) {
        const bg = response.data.first_bodyguard;
        toast.warning(response.data.message, {
          action: {
            label: 'Search',
            onClick: async () => {
              setLoading(true);
              try {
                const res = await api.post('/attack/search', { target_username: bg.search_username, note: '' });
                toast.success(res.data?.message || 'Search started');
                await refreshAttacks();
              } catch (err) {
                toast.error(err.response?.data?.detail || 'Failed to search');
              } finally {
                setLoading(false);
              }
            },
          },
        });
      } else {
        toast.error(response.data.message);
      }
      refreshUser();
      fetchBullets();
      await refreshAttacks();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to execute attack');
    } finally {
      setLoading(false);
    }
  };

  const killByUsername = async () => {
    const username = (killUsername || '').trim();
    if (!username) {
      toast.error('Enter a username');
      return;
    }

    // Prefer a found attack that can attack, else any found attack.
    const found = attacks.filter((a) => (a.target_username || '').toLowerCase() === username.toLowerCase() && a.status === 'found');
    const best = found.find((a) => a.can_attack) || found[0];

    if (!best) {
      // Start a search if we haven't found them yet.
      setLoading(true);
      try {
        const res = await api.post('/attack/search', { target_username: username, note: 'kill' });
        toast.success(res.data.message || 'Searching...');
        await refreshAttacks();
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Failed to search target');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!best.can_attack) {
      toast.error('Travel first (target found in another city).');
      return;
    }

    const bulletNum = bulletsToUse !== "" && bulletsToUse != null ? parseInt(bulletsToUse, 10) : NaN;
    if (Number.isNaN(bulletNum) || bulletNum < 1) {
      toast.error('Enter how many bullets to use (at least 1).');
      return;
    }
    const extra = { death_message: deathMessage, make_public: makePublic, bullets_to_use: bulletNum };
    await executeAttack(best.attack_id, extra);
    await fetchInflation();
  };

  const runCalc = async () => {
    const username = (calcTarget || '').trim();
    if (!username) {
      toast.error('Pick a target first');
      return;
    }
    setCalcLoading(true);
    try {
      const res = await api.post('/attack/bullets/calc', { target_username: username });
      setCalcResult(res.data);
    } catch (error) {
      setCalcResult(null);
      toast.error(error.response?.data?.detail || 'Failed to calculate bullets');
    } finally {
      setCalcLoading(false);
    }
  };

  const foundAndReady = useMemo(() => attacks.filter((a) => a.status === 'found'), [attacks]);
  const filteredAttacks = useMemo(() => {
    const t = filterText.trim().toLowerCase();
    return attacks
      .filter((a) => (show === 'all' ? true : a.status === show))
      .filter((a) => {
        if (!t) return true;
        const hay = `${a.target_username || ''} ${a.note || ''}`.toLowerCase();
        return hay.includes(t);
      });
  }, [attacks, filterText, show]);

  const filteredIds = useMemo(() => filteredAttacks.map((a) => a.attack_id), [filteredAttacks]);
  const allFilteredSelected = useMemo(
    () => filteredIds.length > 0 && filteredIds.every((id) => selectedAttackIds.includes(id)),
    [filteredIds, selectedAttackIds]
  );

  return (
    <div className={`space-y-5 ${styles.pageContent}`} data-testid="attack-page">
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-3">
            <Crosshair size={24} className="text-primary/80" />
            Attack
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-sm text-mutedForeground font-heading tracking-wide">Search, track, travel, and execute hits</p>
      </div>

      {eventsEnabled && event && (event.kill_cash !== 1 || event.rank_points !== 1) && event.name && (
        <div className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className={`${styles.panelHeader} px-3 py-2 sm:px-4`}>
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Today&apos;s event</span>
          </div>
          <div className="p-3 sm:p-4">
            <p className="text-sm font-heading font-bold text-primary">{event.name}</p>
            <p className={`text-xs font-heading mt-1 ${styles.textMuted}`}>{event.message}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Kill User */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                  <Skull size={14} /> Kill User
                </span>
                <div className="w-6 h-px bg-primary/50" />
              </div>
              <button
                type="button"
                className="text-xs uppercase tracking-wider text-primary/80 hover:text-primary font-heading inline-flex items-center gap-1"
                onClick={() => { setModalTab('calc'); setModalOpen(true); }}
              >
                <Calculator size={12} /> Calculator
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Username</label>
                <input
                  type="text"
                  value={killUsername}
                  onChange={(e) => setKillUsername(e.target.value)}
                  className={`w-full ${styles.input} h-9 px-3 text-sm placeholder:text-mutedForeground/60 focus:border-primary/50 focus:outline-none`}
                  placeholder="Enter username..."
                  list="found-users-inline"
                  data-testid="kill-username-inline"
                />
                <datalist id="found-users-inline">
                  {foundAndReady.map((a) => (
                    <option key={a.attack_id} value={a.target_username} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">
                  Bullets <span className="text-primary/60">(you have {Number(userBullets).toLocaleString()})</span>
                </label>
                <input
                  type="number"
                  value={bulletsToUse}
                  onChange={(e) => setBulletsToUse(e.target.value)}
                  className={`w-full ${styles.input} h-9 px-3 text-sm placeholder:text-mutedForeground/60 focus:border-primary/50 focus:outline-none`}
                  placeholder="Enter amount (min 1)"
                  min="1"
                  data-testid="kill-bullets-inline"
                />
              </div>
              <div>
                <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Death Message (Optional)</label>
                <textarea
                  value={deathMessage}
                  onChange={(e) => setDeathMessage(e.target.value)}
                  className={`w-full ${styles.input} min-h-20 p-3 text-sm placeholder:text-mutedForeground/60 focus:border-primary/50 focus:outline-none`}
                  placeholder="Death message (optional)..."
                  data-testid="kill-death-message-inline"
                />
              </div>
              <div className={`flex items-center justify-between border border-primary/20 rounded-sm px-3 py-2 ${styles.surfaceMuted}`}>
                <div className="text-xs text-mutedForeground font-heading">Inflation: {inflationPct}%</div>
                <label className="inline-flex items-center gap-2 text-xs text-mutedForeground font-heading">
                  <span className="uppercase tracking-wider">Make Public</span>
                  <input type="checkbox" checked={makePublic} onChange={(e) => setMakePublic(e.target.checked)} className="h-4 w-4 accent-primary" data-testid="kill-make-public-inline" />
                </label>
              </div>
              <button
                type="button"
                disabled={loading || !killUsername.trim() || !bulletsToUse.trim() || parseInt(bulletsToUse, 10) < 1}
                onClick={killByUsername}
                className="w-full bg-gradient-to-r from-red-700 to-red-900 text-white hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-2.5 text-sm border border-red-600/50 disabled:opacity-50 transition-smooth"
                data-testid="kill-inline-button"
              >
                {loading ? 'Killing...' : 'Kill'}
              </button>
              <div className="text-xs text-mutedForeground font-heading italic">Tip: Starts a search if not found. Travel required before kill.</div>
            </div>
          </div>

          {/* Find User */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                  <Search size={14} /> Find User
                </span>
                <div className="flex-1 h-px bg-primary/50" />
              </div>
            </div>
            <form onSubmit={searchTarget} className="p-4 space-y-3">
              <div>
                <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Username</label>
                <input
                  type="text"
                  value={targetUsername}
                  onChange={(e) => setTargetUsername(e.target.value)}
                  className={`w-full ${styles.input} h-9 px-3 text-sm placeholder:text-mutedForeground/60 focus:border-primary/50 focus:outline-none`}
                  placeholder="Enter username..."
                  required
                  data-testid="target-username-input"
                />
              </div>
              <div>
                <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={`w-full ${styles.input} h-9 px-3 text-sm placeholder:text-mutedForeground/60 focus:border-primary/50 focus:outline-none`}
                  placeholder="E.g. big spender, rival"
                  data-testid="target-note-input"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-2.5 text-sm border border-yellow-600/50 disabled:opacity-50 transition-smooth"
                data-testid="search-target-button"
              >
                {loading ? 'Searching...' : 'Start Search'}
              </button>
              <div className="text-xs text-mutedForeground font-heading italic">
                Searches take time. Manage from “My Searches”.
              </div>
            </form>
          </div>
        </div>

        {/* Right Column */}
        <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-px bg-primary/50" />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
                My Searches ({attacks.length})
              </span>
              <div className="flex-1 h-px bg-primary/50" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-mutedForeground font-heading">Show:</span>
              <select
                value={show}
                onChange={(e) => setShow(e.target.value)}
                className={`${styles.surface} border border-primary/20 rounded-sm h-8 px-2 text-xs focus:border-primary/50 focus:outline-none`}
                data-testid="attack-show-filter"
              >
                <option value="all">All</option>
                <option value="searching">Searching</option>
                <option value="found">Found</option>
              </select>
            </div>
          </div>
          <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className={`flex-1 ${styles.input} h-9 px-3 text-sm placeholder:text-mutedForeground/60 focus:border-primary/50 focus:outline-none`}
              placeholder="Filter by username / note"
              data-testid="attack-filter-input"
            />
          </div>

          <div className="flex items-center justify-between gap-3 mb-3">
            <label className="inline-flex items-center gap-2 text-xs text-mutedForeground select-none font-heading">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={() => toggleSelectAllFiltered(filteredIds)}
                className="h-4 w-4 accent-primary"
                data-testid="attack-select-all"
              />
              Select all
            </label>
            <button
              type="button"
              disabled={loading || selectedAttackIds.length === 0}
              onClick={() => deleteSelected(selectedAttackIds)}
              className="px-3 h-8 rounded-sm uppercase tracking-widest font-bold text-xs bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 disabled:opacity-50 transition-smooth"
              data-testid="attack-delete-selected"
            >
              Delete ({selectedAttackIds.length})
            </button>
          </div>

          <div className="border border-primary/20 rounded-sm overflow-hidden">
            <div className={`grid grid-cols-12 ${styles.surfaceMuted} text-xs uppercase tracking-widest font-heading text-primary/80 px-3 py-2 border-b border-primary/20`}>
              <div className="col-span-1"></div>
              <div className="col-span-4">User / Note</div>
              <div className="col-span-3">Location</div>
              <div className="col-span-4 text-right">Expires</div>
            </div>

            {filteredAttacks.length === 0 ? (
              <div className="p-4 text-sm text-mutedForeground font-heading italic">You do not have any active searches.</div>
            ) : (
              filteredAttacks.map((a) => (
                <div key={a.attack_id} className={`grid grid-cols-12 px-3 py-2.5 border-b border-primary/10 items-start gap-2 ${styles.raisedHover} transition-smooth`}>
                  <div className="col-span-1 pt-1">
                    <input
                      type="checkbox"
                      checked={selectedAttackIds.includes(a.attack_id)}
                      onChange={() => toggleSelected(a.attack_id)}
                      className="h-4 w-4 accent-primary"
                      data-testid={`attack-select-${a.attack_id}`}
                    />
                  </div>

                  <div className="col-span-4 min-w-0">
                    <Link
                      to={`/profile/${encodeURIComponent(a.target_username)}`}
                      className="font-heading font-bold text-foreground truncate hover:text-primary transition-smooth block text-sm"
                      data-testid={`attack-user-${a.attack_id}`}
                    >
                      {a.target_username}
                    </Link>
                    {a.note && <div className="text-xs text-mutedForeground truncate font-heading">{a.note}</div>}
                    <div className="mt-1 inline-flex items-center gap-2 text-[11px] text-mutedForeground font-heading flex-wrap">
                      <span className={`px-2 py-0.5 rounded-sm uppercase tracking-wider font-bold ${
                        a.status === 'searching' ? `${styles.surface} text-mutedForeground border border-primary/10` : 'bg-primary/20 text-primary border border-primary/30'
                      }`}>
                        {a.status}
                      </span>
                      {a.can_travel && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => openTravelModal(a.location_state)}
                          className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
                          data-testid={`attack-travel-${a.attack_id}`}
                        >
                          <Plane size={12} />
                          Travel
                        </button>
                      )}
                      {a.can_attack && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => executeAttack(a.attack_id)}
                          className="inline-flex items-center gap-1 text-red-400 hover:underline disabled:opacity-50"
                          data-testid={`attack-kill-${a.attack_id}`}
                        >
                          <Crosshair size={12} />
                          Kill
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="col-span-3 text-sm text-mutedForeground font-heading">
                    {a.status === 'found' && a.location_state ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} className="text-primary" />
                        <span className="text-foreground">{a.location_state}</span>
                      </span>
                    ) : (
                      <span className="text-mutedForeground/60">Hidden</span>
                    )}
                  </div>

                  <div className="col-span-4 text-right text-xs text-mutedForeground font-heading">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <Clock size={14} />
                      {formatDateTime(a.expires_at || a.search_started)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 text-xs text-mutedForeground font-heading italic">
            Searches take time to complete. Location stays hidden until the target is found.
          </div>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/80"
            onClick={() => setModalOpen(false)}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className={`w-full max-w-xl ${styles.panel} border border-primary/40 rounded-sm overflow-hidden shadow-2xl shadow-primary/20`}>
              <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
                <div className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
                  {modalTab === 'kill' ? 'Kill User' : 'Bullet Calculator'}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setModalTab('kill')}
                    className={`px-2 py-1 rounded-sm uppercase tracking-wider font-heading font-bold transition-smooth ${
                      modalTab === 'kill' ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border border-yellow-600/50' : 'text-mutedForeground hover:text-primary'
                    }`}
                  >
                    Kill
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalTab('calc')}
                    className={`px-2 py-1 rounded-sm uppercase tracking-wider font-heading font-bold transition-smooth ${
                      modalTab === 'calc' ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border border-yellow-600/50' : 'text-mutedForeground hover:text-primary'
                    }`}
                  >
                    Calculator
                  </button>
                  <Link
                    to="/inbox?filter=attack"
                    className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs font-heading font-bold uppercase tracking-wider text-primary hover:bg-primary/20 transition-smooth"
                    data-testid="view-witness-statements"
                  >
                    <FileText size={12} />
                    View witness statements
                  </Link>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="ml-2 text-mutedForeground hover:text-primary transition-smooth font-heading"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {modalTab === 'kill' ? (
                  <>
                    <div>
                      <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Username</label>
                      <input
                        type="text"
                        value={killUsername}
                        onChange={(e) => setKillUsername(e.target.value)}
                        className={`w-full ${styles.input} h-9 px-3 text-sm focus:border-primary/50 focus:outline-none`}
                        placeholder="Enter username..."
                        list="found-users"
                        data-testid="kill-username"
                      />
                      <datalist id="found-users">
                        {foundAndReady.map((a) => (
                          <option key={a.attack_id} value={a.target_username} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">
                        Bullets <span className="text-primary/60">(you have {Number(userBullets).toLocaleString()})</span>
                      </label>
                      <input
                        type="number"
                        value={bulletsToUse}
                        onChange={(e) => setBulletsToUse(e.target.value)}
                        className={`w-full ${styles.input} h-9 px-3 text-sm placeholder:text-mutedForeground/60 focus:border-primary/50 focus:outline-none`}
                        placeholder="Enter amount (min 1)"
                        min="1"
                        data-testid="kill-bullets-modal"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Death Message (Optional)</label>
                      <textarea
                        value={deathMessage}
                        onChange={(e) => setDeathMessage(e.target.value)}
                        className={`w-full ${styles.input} min-h-20 p-3 text-sm focus:border-primary/50 focus:outline-none`}
                        placeholder="Death message (optional)..."
                        data-testid="kill-death-message"
                      />
                    </div>
                    <div className={`flex items-center justify-between border border-primary/20 rounded-sm px-3 py-2 ${styles.surfaceMuted}`}>
                      <div className="text-xs text-mutedForeground font-heading">Inflation: {Number(calcResult?.inflation_pct ?? 0)}%</div>
                      <label className="inline-flex items-center gap-2 text-xs text-mutedForeground font-heading">
                        <span className="uppercase tracking-wider">Make Public</span>
                        <input type="checkbox" checked={makePublic} onChange={(e) => setMakePublic(e.target.checked)} className="h-4 w-4 accent-primary" data-testid="kill-make-public" />
                      </label>
                    </div>
                    <button
                      type="button"
                      disabled={loading || !killUsername.trim() || !bulletsToUse.trim() || parseInt(bulletsToUse, 10) < 1}
                      onClick={killByUsername}
                      className="w-full bg-gradient-to-r from-red-700 to-red-900 text-white hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-2.5 text-sm border border-red-600/50 disabled:opacity-50"
                    >
                      {loading ? 'Killing...' : 'Kill'}
                    </button>
                    <div className="text-xs text-mutedForeground font-heading italic">Tip: Enter bullets (min 1). Starts a search if not found. Travel required before kill.</div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Username</label>
                      <input
                        type="text"
                        value={calcTarget}
                        onChange={(e) => setCalcTarget(e.target.value)}
                        className={`w-full ${styles.input} h-9 px-3 text-sm focus:border-primary/50 focus:outline-none`}
                        data-testid="bullet-calc-target"
                        placeholder="Enter username..."
                        list="calc-users"
                      />
                      <datalist id="calc-users">
                        {foundAndReady.map((a) => (
                          <option key={a.attack_id} value={a.target_username} />
                        ))}
                      </datalist>
                    </div>

                    <button
                      type="button"
                      onClick={runCalc}
                      disabled={calcLoading}
                      className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-2.5 text-sm border border-yellow-600/50 disabled:opacity-50"
                      data-testid="bullet-calc-run"
                    >
                      {calcLoading ? '...' : 'Calculate'}
                    </button>

                    {calcResult ? (
                      <div className={`border border-primary/20 rounded-sm overflow-hidden ${styles.surfaceMuted}`}>
                        <div className={`grid grid-cols-12 ${styles.surfaceMuted} text-xs uppercase tracking-widest font-heading text-primary/80 px-3 py-2 border-b border-primary/20`}>
                          <div className="col-span-6">Estimated</div>
                          <div className="col-span-6 text-right">Inflation</div>
                        </div>
                        <div className="grid grid-cols-12 px-3 py-3 text-sm items-center">
                          <div className="col-span-6 font-heading font-bold text-primary">
                            {Number(calcResult.bullets_required || 0).toLocaleString()} bullets
                          </div>
                          <div className="col-span-6 text-right text-mutedForeground font-heading">
                            {Number(calcResult.inflation_pct ?? 0)}%
                          </div>
                          <div className="col-span-12 mt-2 text-xs text-mutedForeground font-heading">
                            You: <span className="text-foreground font-bold">{calcResult.attacker_rank_name}</span> · {calcResult.weapon_name}
                            <span className="text-mutedForeground/60"> · </span>
                            Target: <span className="text-foreground font-bold">{calcResult.target_rank_name}</span> · Armour Lv.{calcResult.target_armour_level}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-mutedForeground font-heading italic">Pick a target and calculate bullets needed.</div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {travelModalDestination && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/80" onClick={() => setTravelModalDestination(null)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className={`w-full max-w-md ${styles.panel} border border-primary/40 rounded-sm overflow-hidden shadow-2xl shadow-primary/20`} onClick={(e) => e.stopPropagation()}>
              <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
                <div className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Travel to {travelModalDestination}</div>
                <button type="button" onClick={() => setTravelModalDestination(null)} className="text-mutedForeground hover:text-primary font-heading" aria-label="Close">✕</button>
              </div>
              <div className="p-4 space-y-2">
                {travelCountdown != null && travelCountdown > 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm font-heading text-primary font-bold">Traveling to {travelModalDestination}…</p>
                    <p className="text-2xl font-heading font-bold text-foreground mt-2 tabular-nums">{travelCountdown}s</p>
                  </div>
                ) : !travelInfo ? (
                  <div className="text-sm text-mutedForeground font-heading py-4 text-center">Loading travel options…</div>
                ) : (
                  <>
                    <button
                      onClick={() => handleTravelFromModal('airport')}
                      disabled={travelSubmitLoading || travelInfo.carrying_booze || (travelInfo.user_points ?? 0) < (travelInfo.airport_cost ?? 10)}
                      className="w-full flex items-center justify-between bg-gradient-to-b from-primary/30 to-primary/10 hover:from-primary/40 hover:to-primary/20 border border-primary/50 px-3 py-2.5 rounded-sm transition-smooth disabled:opacity-50 text-left"
                      data-testid="travel-modal-airport"
                    >
                      <span className="flex items-center gap-2">
                        <Plane size={16} className="text-primary" />
                        <span className="text-sm font-heading font-bold text-primary">Airport</span>
                      </span>
                      <span className="text-xs text-primary/90 font-heading">{(travelInfo.airport_time > 0 ? `${travelInfo.airport_time}s` : 'Instant')} · {travelInfo.airport_cost ?? 10} pts</span>
                    </button>
                    {travelInfo.carrying_booze && <p className="text-xs text-amber-400 font-heading">Car only while carrying booze</p>}
                    {travelInfo?.custom_car && (
                      <button
                        onClick={() => handleTravelFromModal('custom')}
                        disabled={travelSubmitLoading}
                        className={`w-full flex items-center justify-between ${styles.surface} ${styles.raisedHover} border border-primary/30 px-3 py-2 rounded-sm transition-smooth text-left disabled:opacity-50`}
                      >
                        <span className="flex items-center gap-2">
                          <Zap size={16} className="text-primary" />
                          <span className="text-sm font-heading font-bold text-foreground">{travelInfo.custom_car.name}</span>
                        </span>
                        <span className="text-xs text-mutedForeground font-heading">{travelInfo.custom_car.travel_time}s</span>
                      </button>
                    )}
                    {(travelInfo?.cars || []).slice(0, 3).map((car) => (
                      <button
                        key={car.user_car_id}
                        onClick={() => handleTravelFromModal(car.user_car_id)}
                        disabled={travelSubmitLoading}
                        className={`w-full flex items-center justify-between ${styles.surface} ${styles.raisedHover} border border-primary/30 px-3 py-2 rounded-sm transition-smooth text-left disabled:opacity-50`}
                      >
                        <span className="flex items-center gap-2">
                          <Car size={16} className="text-primary" />
                          <span className="text-sm font-heading truncate max-w-[140px] text-foreground">{car.name}</span>
                        </span>
                        <span className="text-xs text-mutedForeground font-heading">{car.travel_time}s</span>
                      </button>
                    ))}
                    {(!travelInfo?.cars || travelInfo.cars.length === 0) && !travelInfo?.custom_car && (
                      <p className="text-xs text-mutedForeground font-heading text-center py-2">No cars. Use airport or steal a car.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
