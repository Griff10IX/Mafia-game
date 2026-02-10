import { useMemo, useState, useEffect } from 'react';
import { Search, Plane, Crosshair, Clock, MapPin, Skull, Calculator } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function Attack() {
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
  const [calcTarget, setCalcTarget] = useState('');
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcResult, setCalcResult] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);

  useEffect(() => {
    refreshAttacks();
    const interval = setInterval(refreshAttacks, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchInflation();
  }, []);

  useEffect(() => {
    api.get('/events/active').then((r) => {
      setEvent(r.data?.event ?? null);
      setEventsEnabled(!!r.data?.events_enabled);
    }).catch(() => {});
  }, []);

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

  const travelToTarget = async (attackId) => {
    setLoading(true);
    try {
      const response = await api.post('/attack/travel', { attack_id: attackId });
      toast.success(response.data.message);
      refreshUser();
      await refreshAttacks();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to travel');
    } finally {
      setLoading(false);
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
    const found = attacks.filter((a) => (a.target_username || '') === username && a.status === 'found');
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

    await executeAttack(best.attack_id, { death_message: deathMessage, make_public: makePublic });
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
    <div className="space-y-6" data-testid="attack-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Kill User · Kill FAQ</div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mt-2">Attack</h1>
          <p className="text-mutedForeground text-sm mt-1">Search, track, travel, and execute hits — multiple operations at once.</p>
        </div>
      </div>

      {eventsEnabled && event && (event.kill_cash !== 1 || event.rank_points !== 1) && event.name && (
        <div className="bg-primary/15 border border-primary rounded-sm p-4">
          <p className="text-sm font-semibold text-primary">Today&apos;s event: {event.name}</p>
          <p className="text-xs text-mutedForeground mt-1">{event.message}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Kill User */}
          <div className="bg-card border border-border rounded-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
                <Skull size={16} className="text-primary" />
                Kill User
              </div>
              <button
                type="button"
                className="text-xs uppercase tracking-wider text-mutedForeground hover:text-primary transition-smooth inline-flex items-center gap-2"
                onClick={() => {
                  setModalTab('calc');
                  setModalOpen(true);
                }}
              >
                <Calculator size={14} />
                Bullet Calculator
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-mutedForeground mb-1">Username</label>
                <input
                  type="text"
                  value={killUsername}
                  onChange={(e) => setKillUsername(e.target.value)}
                  className="w-full bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground placeholder:text-mutedForeground/60"
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
                <label className="block text-xs text-mutedForeground mb-1">Death Message (Optional)</label>
                <textarea
                  value={deathMessage}
                  onChange={(e) => setDeathMessage(e.target.value)}
                  className="w-full bg-input border border-border rounded-sm min-h-24 p-3 text-sm text-foreground placeholder:text-mutedForeground/60"
                  placeholder="Death message (optional)..."
                  data-testid="kill-death-message-inline"
                />
              </div>

              <div className="flex items-center justify-between border border-border rounded-sm px-3 py-2 bg-secondary/20">
                <div className="text-xs text-mutedForeground font-mono">Inflation: {inflationPct}%</div>
                <label className="inline-flex items-center gap-2 text-xs text-mutedForeground">
                  <span className="uppercase tracking-wider">Make Public</span>
                  <input
                    type="checkbox"
                    checked={makePublic}
                    onChange={(e) => setMakePublic(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                    data-testid="kill-make-public-inline"
                  />
                </label>
              </div>

              <button
                type="button"
                disabled={loading || !killUsername.trim()}
                onClick={killByUsername}
                className="w-full bg-destructive text-destructiveForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50"
                data-testid="kill-inline-button"
              >
                {loading ? 'Killing...' : 'Kill'}
              </button>

              <div className="text-xs text-mutedForeground">
                Tip: If you haven't found them yet, this will start a search. Travel is required before a kill.
              </div>
            </div>
          </div>

          {/* Find User */}
          <div className="bg-card border border-border rounded-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Search size={18} className="text-primary" />
              <div className="text-sm font-bold uppercase tracking-widest text-foreground">Find User</div>
            </div>

            <form onSubmit={searchTarget} className="space-y-3">
              <div>
                <label className="block text-xs text-mutedForeground mb-1">Username</label>
                <input
                  type="text"
                  value={targetUsername}
                  onChange={(e) => setTargetUsername(e.target.value)}
                  className="w-full bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground placeholder:text-mutedForeground/60"
                  placeholder="Enter username..."
                  required
                  data-testid="target-username-input"
                />
              </div>
              <div>
                <label className="block text-xs text-mutedForeground mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground placeholder:text-mutedForeground/60"
                  placeholder="E.g. 'big spender', 'rival', 'test'"
                  data-testid="target-note-input"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth gold-glow disabled:opacity-50"
                data-testid="search-target-button"
              >
                {loading ? 'Searching...' : 'Start Search'}
              </button>
              <div className="text-xs text-mutedForeground">
                Searches take time. You can run multiple searches at once and manage them from “My Searches”.
              </div>
            </form>
          </div>
        </div>

        {/* Right Column */}
        <div className="bg-card border border-border rounded-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold uppercase tracking-widest text-foreground">
              My Searches ({attacks.length})
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-mutedForeground">Show:</span>
              <select
                value={show}
                onChange={(e) => setShow(e.target.value)}
                className="bg-input border border-border rounded-sm h-9 px-2 text-xs text-foreground"
                data-testid="attack-show-filter"
              >
                <option value="all">All</option>
                <option value="searching">Searching</option>
                <option value="found">Found</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="flex-1 bg-input border border-border rounded-sm h-9 px-3 text-sm text-foreground placeholder:text-mutedForeground/60"
              placeholder="Filter by username / note"
              data-testid="attack-filter-input"
            />
          </div>

          <div className="flex items-center justify-between gap-3 mb-3">
            <label className="inline-flex items-center gap-2 text-xs text-mutedForeground select-none">
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
              className="px-3 h-9 rounded-sm uppercase tracking-widest font-bold text-xs bg-destructive text-destructiveForeground hover:opacity-90 disabled:opacity-50 transition-smooth"
              data-testid="attack-delete-selected"
            >
              Delete ({selectedAttackIds.length})
            </button>
          </div>

          <div className="border border-border rounded-sm overflow-hidden">
            <div className="grid grid-cols-12 bg-secondary/40 text-xs uppercase tracking-wider text-mutedForeground px-3 py-2">
              <div className="col-span-1"></div>
              <div className="col-span-4">User / Note</div>
              <div className="col-span-3">Location</div>
              <div className="col-span-4 text-right">Expires</div>
            </div>

            {filteredAttacks.length === 0 ? (
              <div className="p-4 text-sm text-mutedForeground">You do not have any active searches.</div>
            ) : (
              filteredAttacks.map((a) => (
                <div key={a.attack_id} className="grid grid-cols-12 px-3 py-3 border-t border-border items-start gap-2">
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
                      className="font-semibold text-foreground truncate hover:underline hover:text-primary transition-smooth block"
                      data-testid={`attack-user-${a.attack_id}`}
                    >
                      {a.target_username}
                    </Link>
                    {a.note && <div className="text-xs text-mutedForeground truncate">{a.note}</div>}
                    <div className="mt-1 inline-flex items-center gap-2 text-[11px] text-mutedForeground">
                      <span className={`px-2 py-0.5 rounded-sm uppercase tracking-wider font-bold ${
                        a.status === 'searching' ? 'bg-secondary text-mutedForeground' : 'bg-primary text-primaryForeground'
                      }`}>
                        {a.status}
                      </span>
                      {a.can_travel && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => travelToTarget(a.attack_id)}
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
                          className="inline-flex items-center gap-1 text-destructive hover:underline disabled:opacity-50"
                          data-testid={`attack-kill-${a.attack_id}`}
                        >
                          <Crosshair size={12} />
                          Kill
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="col-span-3 text-sm text-mutedForeground">
                    {a.status === 'found' && a.location_state ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={14} className="text-primary" />
                        <span className="text-foreground">{a.location_state}</span>
                      </span>
                    ) : (
                      <span className="text-mutedForeground/60">Hidden</span>
                    )}
                  </div>

                  <div className="col-span-4 text-right text-sm text-mutedForeground">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <Clock size={14} />
                      {formatDateTime(a.expires_at || a.search_started)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 text-xs text-mutedForeground">
            Searches take time to complete. Location stays hidden until the target is found.
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setModalOpen(false)}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-card border border-border rounded-sm overflow-hidden shadow-2xl">
              <div className="px-4 py-3 bg-secondary/40 flex items-center justify-between">
                <div className="text-sm font-bold uppercase tracking-widest text-foreground">
                  {modalTab === 'kill' ? 'Kill User:' : 'Bullet Calculator'}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setModalTab('kill')}
                    className={`px-3 py-1 rounded-sm uppercase tracking-widest font-bold transition-smooth ${
                      modalTab === 'kill' ? 'bg-primary text-primaryForeground' : 'text-mutedForeground hover:text-primary'
                    }`}
                  >
                    Kill User
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalTab('calc')}
                    className={`px-3 py-1 rounded-sm uppercase tracking-widest font-bold transition-smooth ${
                      modalTab === 'calc' ? 'bg-primary text-primaryForeground' : 'text-mutedForeground hover:text-primary'
                    }`}
                  >
                    Bullet Calculator
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="ml-2 text-mutedForeground hover:text-primary transition-smooth font-mono"
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
                      <label className="block text-xs text-mutedForeground mb-1">Username</label>
                      <input
                        type="text"
                        value={killUsername}
                        onChange={(e) => setKillUsername(e.target.value)}
                        className="w-full bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground placeholder:text-mutedForeground/60"
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
                      <label className="block text-xs text-mutedForeground mb-1">Death Message (Optional)</label>
                      <textarea
                        value={deathMessage}
                        onChange={(e) => setDeathMessage(e.target.value)}
                        className="w-full bg-input border border-border rounded-sm min-h-24 p-3 text-sm text-foreground placeholder:text-mutedForeground/60"
                        placeholder="Death message (optional)..."
                        data-testid="kill-death-message"
                      />
                    </div>
                    <div className="flex items-center justify-between border border-border rounded-sm px-3 py-2 bg-secondary/20">
                      <div className="text-xs text-mutedForeground font-mono">
                        Inflation: {Number(calcResult?.inflation_pct ?? 0)}%
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs text-mutedForeground">
                        <span className="uppercase tracking-wider">Make Public</span>
                        <input
                          type="checkbox"
                          checked={makePublic}
                          onChange={(e) => setMakePublic(e.target.checked)}
                          className="h-4 w-4 accent-primary"
                          data-testid="kill-make-public"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      disabled={loading || !killUsername.trim()}
                      onClick={killByUsername}
                      className="w-full bg-destructive text-destructiveForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50"
                    >
                      {loading ? 'Killing...' : 'Kill'}
                    </button>
                    <div className="text-xs text-mutedForeground">
                      Tip: If you haven't found them yet, this will start a search. Travel is required before a kill.
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-mutedForeground mb-1">Username</label>
                      <input
                        type="text"
                        value={calcTarget}
                        onChange={(e) => setCalcTarget(e.target.value)}
                        className="w-full bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground"
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
                      className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth gold-glow disabled:opacity-50"
                      data-testid="bullet-calc-run"
                    >
                      {calcLoading ? '...' : 'Calculate'}
                    </button>

                    {calcResult ? (
                      <div className="border border-border rounded-sm overflow-hidden">
                        <div className="grid grid-cols-12 bg-secondary/20 text-xs uppercase tracking-wider text-mutedForeground px-3 py-2">
                          <div className="col-span-6">Estimated</div>
                          <div className="col-span-6 text-right">Inflation</div>
                        </div>
                        <div className="grid grid-cols-12 px-3 py-3 text-sm items-center">
                          <div className="col-span-6 font-mono font-bold text-primary">
                            {Number(calcResult.bullets_required || 0).toLocaleString()} bullets
                          </div>
                          <div className="col-span-6 text-right text-mutedForeground font-mono">
                            {Number(calcResult.inflation_pct ?? 0)}%
                          </div>
                          <div className="col-span-12 mt-2 text-xs text-mutedForeground">
                            You: <span className="text-foreground font-semibold">{calcResult.attacker_rank_name}</span> · {calcResult.weapon_name}
                            <span className="text-mutedForeground/60"> · </span>
                            Target: <span className="text-foreground font-semibold">{calcResult.target_rank_name}</span> · Armour Lv.{calcResult.target_armour_level}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-mutedForeground">
                        Pick a target and calculate bullets needed.
                      </div>
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
