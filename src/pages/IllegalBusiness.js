import { useState, useEffect, useCallback } from 'react';
import { Building2, Shield, DollarSign, ListChecks, Crosshair } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

export default function IllegalBusiness() {
  const [data, setData] = useState(null);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startTypeId, setStartTypeId] = useState('speakeasy');
  const [startName, setStartName] = useState('');
  const [raidTarget, setRaidTarget] = useState('');
  const [raidState, setRaidState] = useState('');
  const [raidResult, setRaidResult] = useState(null);
  const [claimChoice, setClaimChoice] = useState({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, typesRes] = await Promise.all([
        api.get('/illegal-business').catch((e) => ({ ...e, response: e.response })),
        api.get('/illegal-business/types').catch(() => ({ data: { types: [] } })),
      ]);
      if (typesRes?.data?.types) setTypes(typesRes.data.types);
      if (res.response?.status === 404) {
        setData({ noBusiness: true });
      } else if (res.data) {
        setData(res.data);
      } else {
        toast.error(getApiErrorMessage(res));
      }
    } catch (e) {
      if (e.response?.status === 404) {
        setData({ noBusiness: true });
      } else {
        toast.error(getApiErrorMessage(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleStart = async () => {
    if (saving || !startTypeId) return;
    setSaving(true);
    try {
      await api.post('/illegal-business/start', { type_id: startTypeId, name: startName || undefined });
      toast.success("You've taken over a joint.");
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCollect = async () => {
    if (saving || !data?.business) return;
    setSaving(true);
    try {
      const res = await api.post('/illegal-business/collect');
      toast.success(res.data?.message || 'Collected.');
      if (res.data?.cash != null) refreshUser();
      fetchData();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleHireGuard = async (slotNumber = 1, armourLevel = 0, weaponLevel = 0) => {
    if (saving || !data?.business) return;
    setSaving(true);
    try {
      await api.post('/illegal-business/guards/hire', { slot_number: slotNumber, armour_level: armourLevel, weapon_level: weaponLevel });
      toast.success('Another pair of hands on the door.');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleUpgradeSecurity = async (upgradeId) => {
    if (saving || !data?.business) return;
    setSaving(true);
    try {
      await api.post(`/illegal-business/security/upgrade/${upgradeId}`);
      toast.success('Upgrade installed.');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteMission = async (missionId) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.post(`/illegal-business/missions/${missionId}/complete`);
      toast.success(res.data?.message || 'Mission complete.');
      fetchData();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRaid = async () => {
    if (saving || !raidTarget.trim()) return;
    setSaving(true);
    setRaidResult(null);
    try {
      const res = await api.post('/illegal-business/raid', { target_username: raidTarget.trim(), state: raidState || undefined });
      setRaidResult(res.data);
      toast.success(res.data?.message);
      if (res.data?.loot_cash) refreshUser();
      fetchData();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleClaimKillReward = async (victimId, choice) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.post('/illegal-business/claim-kill-reward', { victim_id: victimId, choice });
      toast.success(res.data?.message);
      if (res.data?.cash) refreshUser();
      fetchData();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.pageContent}>
        <div className="flex items-center justify-center min-h-[200px] text-primary font-heading">Loading...</div>
      </div>
    );
  }

  if (data?.noBusiness) {
    const typeList = types.length ? types : [
      { id: 'stolen_goods_fence', name: 'Stolen goods fence' },
      { id: 'booze_making', name: 'Booze making' },
      { id: 'speakeasy', name: 'Speakeasy' },
      { id: 'numbers_racket', name: 'Numbers racket' },
      { id: 'protection_racket', name: 'Protection racket' },
    ];
    return (
      <div className={styles.pageContent}>
        <div className="max-w-lg mx-auto space-y-4">
          <h1 className="text-xl font-heading font-bold text-primary uppercase tracking-wider">Racket</h1>
          <p className="text-primary/80 text-sm">Only Capo or higher can own an illegal business. Choose a type and start your operation.</p>
          <div className="border border-primary/20 rounded-md p-4 space-y-3 bg-background/50">
            <label className="block text-xs font-heading uppercase text-primary/80">Business type</label>
            <select
              value={startTypeId}
              onChange={(e) => setStartTypeId(e.target.value)}
              className="w-full bg-background border border-primary/30 rounded px-3 py-2 text-primary"
            >
              {typeList.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <label className="block text-xs font-heading uppercase text-primary/80">Name (optional)</label>
            <input
              type="text"
              value={startName}
              onChange={(e) => setStartName(e.target.value)}
              placeholder="e.g. The Hideaway"
              className="w-full bg-background border border-primary/30 rounded px-3 py-2 text-primary"
            />
            <button
              onClick={handleStart}
              disabled={saving}
              className="w-full py-2 bg-primary text-primary-foreground rounded font-heading uppercase text-sm disabled:opacity-50"
            >
              {saving ? 'Starting...' : 'Start business'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const business = data?.business;
  const guards = data?.guards || [];
  const typeInfo = data?.type_info || {};
  const missionsData = data?.missions_completed ?? [];
  const pendingRewards = data?.pending_kill_rewards || [];
  const securityList = data?.security_upgrades_list || [];
  const guardSlots = business?.guard_slots ?? 2;
  const upgradesDone = business?.security_upgrades || [];
  const nextUpgradeIndex = upgradesDone.length;
  const nextUpgrade = nextUpgradeIndex < securityList.length ? securityList[nextUpgradeIndex] : null;

  return (
    <div className={styles.pageContent}>
      <div className="space-y-6">
        <h1 className="text-xl font-heading font-bold text-primary uppercase tracking-wider">Racket</h1>

        {/* Dashboard */}
        <div className="border border-primary/20 rounded-md overflow-hidden bg-background/50">
          <div className="px-4 py-3 border-b border-primary/20 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-heading font-bold text-primary">{business?.name || typeInfo?.name}</span>
              <span className="text-primary/70 text-sm ml-2">({typeInfo?.name}) · {business?.state}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary/80 text-sm">{formatMoney(business?.income_per_hour)}/hr</span>
              <button
                onClick={handleCollect}
                disabled={saving}
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm font-heading uppercase disabled:opacity-50"
              >
                Collect take
              </button>
            </div>
          </div>
          <div className="p-4 text-primary/80 text-sm">
            Level {business?.level ?? 1} · Security {business?.security_level ?? 0} · {guards.length}/{guardSlots} guards
            {business?.type_id === 'booze_making' && business?.booze_per_hour != null && (
              <span className="ml-2">· Booze {business.booze_per_hour}/hr</span>
            )}
          </div>
        </div>

        {/* Pending kill rewards */}
        {pendingRewards.length > 0 && (
          <div className="border border-primary/20 rounded-md p-4 bg-background/50">
            <h2 className="text-sm font-heading font-bold text-primary uppercase mb-2">Claim reward (victim had illegal business)</h2>
            {pendingRewards.map((p) => (
              <div key={p.victim_id} className="flex flex-wrap items-center gap-2 py-2 border-b border-primary/10 last:border-0">
                <span className="text-primary">{p.victim_username} — {formatMoney(p.total_spent)}</span>
                <button
                  onClick={() => handleClaimKillReward(p.victim_id, 'cash')}
                  disabled={saving}
                  className="px-2 py-1 bg-primary/20 text-primary rounded text-xs font-heading disabled:opacity-50"
                >
                  Take cash
                </button>
                {p.moderately_upgraded && (
                  <button
                    onClick={() => handleClaimKillReward(p.victim_id, 'income_boost')}
                    disabled={saving}
                    className="px-2 py-1 bg-primary/20 text-primary rounded text-xs font-heading disabled:opacity-50"
                  >
                    +2% income
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Guards */}
        <div className="border border-primary/20 rounded-md p-4 bg-background/50">
          <h2 className="text-sm font-heading font-bold text-primary uppercase mb-2 flex items-center gap-1"><Shield size={14} /> Muscle</h2>
          <ul className="space-y-1 text-sm text-primary/90">
            {guards.map((g) => (
              <li key={g.id}>Slot {g.slot_number}: armour {g.armour_level}, weapon {g.weapon_level}</li>
            ))}
          </ul>
          {guards.length < guardSlots && (
            <button
              onClick={() => handleHireGuard(guards.length + 1, 0, 0)}
              disabled={saving}
              className="mt-2 px-3 py-1.5 bg-primary/20 text-primary rounded text-sm font-heading disabled:opacity-50"
            >
              Hire guard
            </button>
          )}
        </div>

        {/* Security */}
        <div className="border border-primary/20 rounded-md p-4 bg-background/50">
          <h2 className="text-sm font-heading font-bold text-primary uppercase mb-2">Security</h2>
          {upgradesDone.length > 0 && (
            <p className="text-primary/80 text-sm mb-2">Installed: {upgradesDone.join(', ')}</p>
          )}
          {nextUpgrade && (
            <button
              onClick={() => handleUpgradeSecurity(nextUpgrade.id)}
              disabled={saving}
              className="px-3 py-1.5 bg-primary/20 text-primary rounded text-sm font-heading disabled:opacity-50"
            >
              Upgrade: {nextUpgrade.name} ({formatMoney(nextUpgrade.cost_cash)})
            </button>
          )}
        </div>

        {/* Missions */}
        {data?.missions != null && Array.isArray(data.missions) && data.missions.length > 0 && (
          <div className="border border-primary/20 rounded-md p-4 bg-background/50">
            <h2 className="text-sm font-heading font-bold text-primary uppercase mb-2 flex items-center gap-1"><ListChecks size={14} /> Missions</h2>
            <ul className="space-y-2 text-sm">
              {data.missions.map(({ mission, completed, current, target }) => (
                <li key={mission.id} className="text-primary/90">
                  {mission.title} {completed ? '(done)' : ''}
                  {!completed && target && (
                    <button
                      onClick={() => handleCompleteMission(mission.id)}
                      disabled={saving}
                      className="ml-2 px-2 py-0.5 bg-primary/20 rounded text-xs"
                    >
                      Complete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Raid */}
        <div className="border border-primary/20 rounded-md p-4 bg-background/50">
          <h2 className="text-sm font-heading font-bold text-primary uppercase mb-2 flex items-center gap-1"><Crosshair size={14} /> Hit a joint</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs text-primary/70">Target username</label>
              <input
                type="text"
                value={raidTarget}
                onChange={(e) => setRaidTarget(e.target.value)}
                placeholder="Username"
                className="bg-background border border-primary/30 rounded px-3 py-1.5 text-primary w-40"
              />
            </div>
            <div>
              <label className="block text-xs text-primary/70">State (optional)</label>
              <input
                type="text"
                value={raidState}
                onChange={(e) => setRaidState(e.target.value)}
                placeholder="e.g. Chicago"
                className="bg-background border border-primary/30 rounded px-3 py-1.5 text-primary w-32"
              />
            </div>
            <button
              onClick={handleRaid}
              disabled={saving || !raidTarget.trim()}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded font-heading uppercase text-sm disabled:opacity-50"
            >
              Raid
            </button>
          </div>
          {raidResult && (
            <p className={`mt-2 text-sm ${raidResult.success ? 'text-green-600' : 'text-primary/80'}`}>
              {raidResult.message} {raidResult.loot_cash > 0 && formatMoney(raidResult.loot_cash)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
