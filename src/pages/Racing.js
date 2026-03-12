import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import api, { refreshUser } from "../utils/api";
import { getApiErrorMessage } from "../utils/api";
import styles from "../styles/noir.module.css";
import CircuitRaceView from "./CircuitRaceView";

// ─── track_id → circuit id mapping (backend IDs → CircuitRaceView track ids)
const TRACK_ID_MAP = {
  chicago_board: "chicago",
  daytona_beach: "daytona",
  roosevelt: "roosevelt",
  indianapolis: "indianapolis",
};

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return "$0";
  return `$${Math.trunc(num).toLocaleString()}`;
}

function apiDetail(e) {
  const d = e.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || x.loc?.join(".")).join("; ") || "Error";
  return getApiErrorMessage(e);
}

export default function Racing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const raceIdParam = searchParams.get("race");
  const [profile, setProfile] = useState(null);
  const [cars, setCars] = useState([]);
  const [availableCars, setAvailableCars] = useState([]);
  const [upgradeTradeoffs, setUpgradeTradeoffs] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [openRaces, setOpenRaces] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [comps, setComps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRace, setActiveRace] = useState(null);
  const [tab, setTab] = useState("races");
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const [createForm, setCreateForm] = useState({ track_id: "", entry_fee: 0, max_grid: 6, laps: 3 });

  const fetchProfile = useCallback(async () => {
    try {
      const r = await api.get("/racing/profile");
      setProfile(r.data?.profile || null);
      setCars(r.data?.owned_cars || []);
      setUpgradeTradeoffs(r.data?.upgrade_tradeoffs || null);
    } catch (e) {
      toast.error(apiDetail(e));
    }
  }, []);

  const fetchOpenRaces = useCallback(async () => {
    try {
      const r = await api.get("/racing/races/open");
      setOpenRaces(r.data?.races || []);
    } catch (e) {
      toast.error(apiDetail(e));
    }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const r = await api.get("/racing/leaderboard");
      setLeaderboard(r.data?.leaderboard || []);
    } catch (e) {
      toast.error(apiDetail(e));
    }
  }, []);

  const fetchComps = useCallback(async () => {
    try {
      const r = await api.get("/racing/comps");
      setComps(r.data?.comps || []);
    } catch (e) {
      toast.error(apiDetail(e));
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [carsRes, tracksRes] = await Promise.all([
          api.get("/racing/cars"),
          api.get("/racing/tracks"),
        ]);
        setAvailableCars(carsRes.data?.cars || []);
        setTracks(tracksRes.data?.tracks || []);
        if (tracksRes.data?.tracks?.length && !createForm.track_id)
          setCreateForm((f) => ({ ...f, track_id: tracksRes.data.tracks[0].id }));
      } catch (e) {
        toast.error(apiDetail(e));
      }
      await fetchProfile();
      await fetchOpenRaces();
      await fetchLeaderboard();
      await fetchComps();
      setLoading(false);
    })();
  }, [fetchProfile, fetchOpenRaces, fetchLeaderboard, fetchComps]);

  useEffect(() => {
    if (!raceIdParam) return;
    (async () => {
      try {
        const r = await api.get(`/racing/races/${raceIdParam}`);
        const race = r.data?.race;
        if (race?.state === "open" || race?.state === "completed") {
          setActiveRace(race);
          setTab("races");
        }
      } catch (_) {}
    })();
  }, [raceIdParam]);

  const handleCreateRace = async () => {
    if (!createForm.track_id) { toast.error("Select a track"); return; }
    setCreating(true);
    try {
      const r = await api.post("/racing/races", {
        track_id: createForm.track_id,
        entry_fee: Number(createForm.entry_fee) || 0,
        max_grid: Number(createForm.max_grid) || 6,
        laps: Number(createForm.laps) || 3,
      });
      const race = r.data?.race;
      if (race) {
        setActiveRace(race);
        await fetchOpenRaces();
        await fetchProfile();
        refreshUser();
        toast.success("Race created");
        navigate(`/racing?race=${race.id}`, { replace: true });
      }
    } catch (e) {
      toast.error(apiDetail(e));
    } finally {
      setCreating(false);
    }
  };

  const handleJoinRace = async (race, carInstanceId) => {
    if (!carInstanceId) { toast.error("Select a racing car first"); return; }
    setJoiningId(race.id);
    try {
      await api.post(`/racing/races/${race.id}/join`, { racing_car_instance_id: carInstanceId });
      const r = await api.get(`/racing/races/${race.id}`);
      setActiveRace(r.data?.race);
      await fetchOpenRaces();
      await fetchProfile();
      refreshUser();
      toast.success("Joined race");
      navigate(`/racing?race=${race.id}`, { replace: true });
    } catch (e) {
      toast.error(apiDetail(e));
    } finally {
      setJoiningId(null);
    }
  };

  const handleStartRace = async (race) => {
    try {
      const r = await api.post(`/racing/races/${race.id}/start`);
      setActiveRace(r.data?.race);
      refreshUser();
      toast.success("Race finished");
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleSelectCar = async (instanceId) => {
    try {
      await api.post("/racing/profile/select-car", { racing_car_instance_id: instanceId });
      await fetchProfile();
      toast.success("Car selected");
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleSelectCarByType = async (racingCarId) => {
    try {
      await api.post("/racing/profile/select-car", { racing_car_id: racingCarId });
      await fetchProfile();
      toast.success("Car selected");
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleUpgradeCrew = async (crewType) => {
    try {
      await api.post("/racing/crew/upgrade", { crew_type: crewType });
      await fetchProfile();
      refreshUser();
      toast.success(`${crewType} upgraded`);
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleUpgradeCar = async (instanceId) => {
    try {
      await api.post("/racing/car/upgrade", { racing_car_instance_id: instanceId });
      await fetchProfile();
      refreshUser();
      toast.success("Car upgraded");
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleEnterComp = async (compId, carInstanceId) => {
    if (!carInstanceId) { toast.error("Select a racing car first"); return; }
    try {
      await api.post(`/racing/comps/${compId}/enter`, { racing_car_instance_id: carInstanceId });
      await fetchComps();
      refreshUser();
      toast.success("Entered competition");
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const selectedInstanceId = profile?.selected_racing_car_id;
  const isCreator = activeRace?.created_by != null && activeRace?.created_by === profile?.user_id;
  const canStartRace = activeRace?.state === "open" && isCreator;

  // Derive player car name for the circuit view
  const playerCarName = (() => {
    if (!selectedInstanceId) return "Racing Car";
    const c = cars.find((x) => x.id === selectedInstanceId);
    return c?.car_name || "Racing Car";
  })();

  // Map backend track_id → circuit view track id
  const circuitTrackId = TRACK_ID_MAP[activeRace?.track_id] || "chicago";

  if (loading) {
    return (
      <div className={styles.page}>
        <div className="p-4 text-center text-[var(--noir-muted)]">Loading racing...</div>
      </div>
    );
  }

  const tabs = [
    { id: "races", label: "Races" },
    { id: "myride", label: "My ride" },
    { id: "crew", label: "Crew" },
    { id: "leaderboard", label: "Leaderboard" },
    { id: "comps", label: "Race comps" },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.panelHeader + " px-4 py-3"}>
        <h1 className="text-xl font-heading" style={{ color: "var(--noir-primary)" }}>
          Bootleg runs
        </h1>
        <p className="text-sm text-[var(--noir-muted)] mt-1">
          Road races • Choose car • Crew upgrades • Purse by position
        </p>
      </div>

      {/* ─── ACTIVE RACE: circuit view (replay mode from backend result) ─── */}
      {activeRace?.state === "completed" && !activeRace._resultsShown && (
        <div className="p-4">
          <CircuitRaceView
            mode="replay"
            participants={activeRace.participants || []}
            lap_results={activeRace.lap_results || []}
            pit_stops={activeRace.pit_stops || []}
            laps={activeRace.laps || 3}
            resultOrder={activeRace.result_order || []}
            weather={activeRace.weather || "clear"}
            weather_name={activeRace.weather_name}
            initialTrackId={circuitTrackId}
            playerCarName={playerCarName}
            onComplete={() => setActiveRace((r) => (r ? { ...r, _resultsShown: true } : null))}
          />
        </div>
      )}

      {/* ─── POST-RACE RESULTS (shown after animation completes) ─── */}
      {activeRace?.state === "completed" && activeRace._resultsShown && (
        <div className={styles.panel + " m-4 p-4"}>
          <h2 className="font-heading mb-3" style={{ color: "var(--noir-primary)" }}>
            Race results
          </h2>
          {activeRace.weather_name && (
            <p className="text-xs text-[var(--noir-muted)] mb-2">
              Weather: {activeRace.weather_name} — affected tyres and grip.
            </p>
          )}
          <ul className="space-y-1">
            {(activeRace.result_order || []).map((id, i) => {
              const p = (activeRace.participants || []).find((x) => (x.user_id || x.id) === id);
              const rew = (activeRace.rewards || []).find((r) => r.entrant_id === id);
              return (
                <li key={id} className="flex items-center justify-between py-1 border-b border-[var(--noir-border)] last:border-0">
                  <span>#{i + 1} {p?.username || p?.car_name || id}</span>
                  {rew && (
                    <span className="text-sm text-[var(--noir-muted)]">
                      {formatMoney(rew.cash)} • {rew.rank_points} RP • {rew.racing_rep} rep
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className={styles.btnPrimary + " mt-3"}
            onClick={() => { setActiveRace(null); navigate("/racing", { replace: true }); }}
          >
            Back to races
          </button>
        </div>
      )}

      {/* ─── TABS ─── */}
      <div className="flex border-b border-[var(--noir-border)] px-4 gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id} type="button"
            className={"py-2 px-3 text-sm font-heading whitespace-nowrap " + (tab === t.id ? "border-b-2 text-[var(--noir-primary)]" : "text-[var(--noir-muted)]")}
            style={tab === t.id ? { borderBottomColor: "var(--noir-primary)" } : {}}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4">

        {/* ─── RACES TAB ─── */}
        {tab === "races" && (
          <>
            {/* Active open race panel */}
            {activeRace?.state === "open" && (
              <div className={styles.panel + " p-4 mb-4"}>
                <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
                  Your race: {activeRace.track_name}
                </h3>
                <p className="text-sm text-[var(--noir-muted)]">
                  {activeRace.participants?.length ?? 0} / {activeRace.max_grid} on grid.
                  Entry fee: {formatMoney(activeRace.entry_fee)}.
                </p>
                {canStartRace && (
                  <button
                    type="button"
                    className={styles.btnPrimary + " mt-3"}
                    onClick={() => handleStartRace(activeRace)}
                  >
                    Start race (fill with NPCs)
                  </button>
                )}
              </div>
            )}

            {/* Create race */}
            <div className={styles.panel + " p-4 mb-4"}>
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>Create race</h3>
              <div className="flex flex-wrap gap-3 items-end">
                <label className="flex flex-col gap-1">
                  <span className="text-xs">Track</span>
                  <select
                    className={styles.input}
                    value={createForm.track_id}
                    onChange={(e) => setCreateForm((f) => ({ ...f, track_id: e.target.value }))}
                  >
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs">Entry fee</span>
                  <input type="number" min={0} className={styles.input + " w-28"} value={createForm.entry_fee}
                    onChange={(e) => setCreateForm((f) => ({ ...f, entry_fee: e.target.value }))}/>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs">Grid size</span>
                  <input type="number" min={2} max={8} className={styles.input + " w-20"} value={createForm.max_grid}
                    onChange={(e) => setCreateForm((f) => ({ ...f, max_grid: e.target.value }))}/>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs">Laps</span>
                  <input type="number" min={2} max={5} className={styles.input + " w-16"} value={createForm.laps}
                    onChange={(e) => setCreateForm((f) => ({ ...f, laps: e.target.value }))}/>
                </label>
                <button type="button" className={styles.btnPrimary}
                  disabled={creating || !selectedInstanceId} onClick={handleCreateRace}>
                  {creating ? "Creating…" : "Create race"}
                </button>
              </div>
              {!selectedInstanceId && (
                <p className="text-xs text-amber-400 mt-2">Select a racing car in My ride first.</p>
              )}
            </div>

            {/* Open races */}
            <div className={styles.panel + " p-4"}>
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>Open races</h3>
              {openRaces.length === 0 ? (
                <p className="text-sm text-[var(--noir-muted)]">No open races. Create one above.</p>
              ) : (
                <ul className="space-y-2">
                  {openRaces.map((race) => (
                    <li key={race.id} className="flex items-center justify-between p-2 rounded surface">
                      <div>
                        <span className="font-heading">{race.track_name}</span>
                        <span className="text-xs text-[var(--noir-muted)] ml-2">
                          {race.participants?.length ?? 0}/{race.max_grid} • {formatMoney(race.entry_fee)} entry
                        </span>
                      </div>
                      <button type="button" className={styles.btnPrimary + " text-sm"}
                        disabled={joiningId === race.id || !selectedInstanceId || race.participants?.some((p) => p.user_id === profile?.user_id)}
                        onClick={() => handleJoinRace(race, selectedInstanceId)}>
                        {joiningId === race.id ? "Joining…" : "Join"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {/* ─── MY RIDE TAB ─── */}
        {tab === "myride" && (
          <>
            <div className={styles.panel + " p-4 mb-4"}>
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>Your car</h3>
              {cars.length === 0 ? (
                <p className="text-sm text-[var(--noir-muted)]">Choose a car below. You have one racing car slot.</p>
              ) : (
                <ul className="space-y-2">
                  {cars.map((c) => (
                    <li key={c.id} className="flex items-center justify-between p-2 rounded surface">
                      <span>{c.car_name || c.racing_car_id}</span>
                      <span className="text-xs text-[var(--noir-muted)]">Engine {c.engine_level ?? 0} / Tyres {c.tires_level ?? 0}</span>
                      <div className="flex gap-2">
                        <button type="button" className={styles.btnPrimary + " text-xs"}
                          disabled={selectedInstanceId === c.id} onClick={() => handleSelectCar(c.id)}>
                          {selectedInstanceId === c.id ? "Selected" : "Select"}
                        </button>
                        <button type="button" className={styles.btnGoldDarkText + " text-xs"}
                          onClick={() => handleUpgradeCar(c.id)}>
                          Upgrade
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {upgradeTradeoffs ? (
                <p className="text-xs text-[var(--noir-muted)] mt-3">
                  Engine: {upgradeTradeoffs.engine?.positive} {upgradeTradeoffs.engine?.negative} —
                  Tires: {upgradeTradeoffs.tires?.positive} {upgradeTradeoffs.tires?.negative}
                </p>
              ) : (
                <p className="text-xs text-[var(--noir-muted)] mt-3">
                  Engine: +power −grip — Tires: +grip −power
                </p>
              )}
            </div>
            <div className={styles.panel + " p-4"}>
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>Choose car</h3>
              <p className="text-xs text-[var(--noir-muted)] mb-3">Pick one of the historical race cars. Each has different speed and grip.</p>
              <div className="grid gap-2">
                {availableCars.map((car) => {
                  const isSelected = cars.some((c) => c.racing_car_id === car.id);
                  return (
                    <div key={car.id} className="flex items-center justify-between p-2 rounded surface">
                      <div>
                        <span className="font-heading">{car.name}</span>
                        <span className="text-xs text-[var(--noir-muted)] ml-2">
                          Speed {car.base_speed ?? "—"} • Grip {(car.base_grip != null) ? (car.base_grip * 100).toFixed(0) + "%" : "—"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.btnPrimary + " text-xs"}
                        disabled={isSelected}
                        onClick={() => handleSelectCarByType(car.id)}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ─── CREW TAB ─── */}
        {tab === "crew" && (
          <div className={styles.panel + " p-4"}>
            <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>Crew upgrades</h3>
            <p className="text-sm text-[var(--noir-muted)] mb-4">
              Spend cash to improve your mechanic and pit crew. Bonus applies to every race.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { key: "mechanic_level", label: "Mechanic", type: "mechanic" },
                { key: "pit_level", label: "Pit Crew", type: "pit" },
              ].map(({ key, label, type }) => (
                <div key={type} className="p-3 rounded surface">
                  <div className="font-heading">{label}</div>
                  <div className="text-sm">Level {profile?.[key] ?? 0} / 5</div>
                  <div className="text-xs text-[var(--noir-muted)] mt-1">
                    +{((profile?.[key] ?? 0) * 2)}% speed bonus
                  </div>
                  <button type="button" className={styles.btnPrimary + " mt-2 text-sm"}
                    disabled={(profile?.[key] ?? 0) >= 5}
                    onClick={() => handleUpgradeCrew(type)}>
                    Upgrade
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── LEADERBOARD TAB ─── */}
        {tab === "leaderboard" && (
          <div className={styles.panel + " p-4"}>
            <h3 className="font-heading mb-3" style={{ color: "var(--noir-primary)" }}>Racing leaderboard</h3>
            {leaderboard.length === 0 ? (
              <p className="text-sm text-[var(--noir-muted)]">No results yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--noir-border)]">
                    <th className="text-left py-2">#</th>
                    <th className="text-left py-2">Player</th>
                    <th className="text-right py-2">Wins</th>
                    <th className="text-right py-2">Rep</th>
                    <th className="text-right py-2">Races</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row) => (
                    <tr key={row.user_id} className="border-b border-[var(--noir-border)]">
                      <td className="py-2">{row.rank}</td>
                      <td className="py-2">{row.username}</td>
                      <td className="py-2 text-right">{row.wins}</td>
                      <td className="py-2 text-right">{row.racing_rep}</td>
                      <td className="py-2 text-right">{row.races_completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ─── COMPS TAB ─── */}
        {tab === "comps" && (
          <div className={styles.panel + " p-4"}>
            <h3 className="font-heading mb-3" style={{ color: "var(--noir-primary)" }}>Race competitions</h3>
            {comps.length === 0 ? (
              <p className="text-sm text-[var(--noir-muted)]">No active competitions at the moment.</p>
            ) : (
              <ul className="space-y-2">
                {comps.map((comp) => (
                  <li key={comp.id} className="flex items-center justify-between p-2 rounded surface">
                    <div>
                      <span className="font-heading">{comp.name || comp.track_id || "Competition"}</span>
                      <span className="text-xs text-[var(--noir-muted)] ml-2">
                        Entry: {formatMoney(comp.entry_fee)} • Ends: {comp.end_at ? new Date(comp.end_at).toLocaleDateString() : "—"}
                      </span>
                    </div>
                    <button type="button" className={styles.btnPrimary + " text-sm"}
                      disabled={!selectedInstanceId}
                      onClick={() => handleEnterComp(comp.id, selectedInstanceId)}>
                      Enter
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

