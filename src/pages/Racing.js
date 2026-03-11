import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import api, { refreshUser } from "../utils/api";
import { getApiErrorMessage } from "../utils/api";
import styles from "../styles/noir.module.css";

const RACE_VIEW_KEY = "racing_view_mode"; // "2d" | "3d"
const RACE_DURATION_MS = 5500;
const COMMENTARY = [
  "They're off!",
  "Bootleg run!",
  "Rounding the bend!",
  "At the line!",
  "Checkered flag!",
];

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

/* ─── 2D Race track (lanes + progress bars) ─── */
function RaceRun2D({ participants, resultOrder, onComplete }) {
  const [started, setStarted] = useState(false);
  const [gatesOpen, setGatesOpen] = useState(false);
  const [commentary, setCommentary] = useState("");
  const [positions, setPositions] = useState(() =>
    (participants || []).map((p, i) => ({ id: p.user_id || p.id, pct: 0, delay: i * 80 }))
  );

  useEffect(() => {
    if (!participants?.length || !resultOrder?.length) return;
    setStarted(true);
    setCommentary(COMMENTARY[0]);
    const t1 = setTimeout(() => {
      setGatesOpen(true);
      setCommentary(COMMENTARY[1]);
    }, 600);
    const t2 = setTimeout(() => setCommentary(COMMENTARY[2]), 1500);
    const t3 = setTimeout(() => setCommentary(COMMENTARY[3]), 3500);
    const t4 = setTimeout(() => {
      setCommentary(COMMENTARY[4]);
      const order = resultOrder || [];
      const perStep = 100 / (order.length || 1);
      setPositions(
        order.map((id, idx) => ({
          id,
          pct: 100,
          delay: 0,
          position: idx + 1,
        }))
      );
    }, RACE_DURATION_MS);
    const t5 = setTimeout(() => onComplete?.(), RACE_DURATION_MS + 800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [participants, resultOrder, onComplete]);

  useEffect(() => {
    if (!gatesOpen || !resultOrder?.length) return;
    const order = resultOrder.slice();
    const start = Date.now();
    let raf;
    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / RACE_DURATION_MS);
      const eased = 1 - (1 - t) * (1 - t);
      setPositions(
        order.map((id, idx) => ({
          id,
          pct: eased * 100,
          delay: 0,
          position: idx + 1,
        }))
      );
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gatesOpen, resultOrder]);

  const lanes = (participants || []).map((p) => {
    const pid = p.user_id || p.id;
    const pos = positions.find((x) => x.id === pid) || { pct: 0, position: null };
    return { ...p, pct: pos.pct, position: pos.position };
  }).sort((a, b) => {
    const ap = positions.find((x) => x.id === (a.user_id || a.id));
    const bp = positions.find((x) => x.id === (b.user_id || b.id));
    if (ap?.position != null && bp?.position != null) return ap.position - bp.position;
    return (bp?.pct ?? 0) - (ap?.pct ?? 0);
  });

  return (
    <div className={styles.panel} style={{ padding: "1rem" }}>
      <div className="text-center text-sm font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
        {commentary}
      </div>
      <div className="relative rounded overflow-hidden" style={{ background: "linear-gradient(180deg, #1a3a0a 0%, #2d5a12 50%, #1a3a0a 100%)" }}>
        <div className="py-1 px-2">
          {lanes.map((lane, idx) => (
            <div key={lane.user_id || lane.id} className="flex items-center gap-2 py-1" style={{ height: 36 }}>
              <div
                className="shrink-0 w-24 truncate text-xs font-heading px-1 py-0.5 rounded"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderLeft: `3px solid ${["#d4af37", "#dc2626", "#2563eb", "#16a34a", "#6b7280", "#ec4899"][idx % 6]}`,
                  color: "#eee",
                }}
              >
                {lane.username || lane.car_name || "Racer"}
              </div>
              <div className="flex-1 h-6 rounded overflow-hidden" style={{ background: "rgba(0,0,0,0.3)" }}>
                <div
                  className="h-full rounded transition-all duration-150"
                  style={{
                    width: `${lane.pct}%`,
                    background: "linear-gradient(90deg, #b8860b, #d4af37)",
                  }}
                />
              </div>
              {lane.position != null && (
                <span className="text-xs font-bold" style={{ color: "var(--noir-primary)", width: 24 }}>
                  #{lane.position}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Simple 3D placeholder (optional view) ─── */
function RaceRun3D({ participants, resultOrder, onComplete }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), RACE_DURATION_MS + 500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (done) onComplete?.();
  }, [done, onComplete]);

  return (
    <div className={styles.panel} style={{ padding: "1.5rem", textAlign: "center" }}>
      <div className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
        Road race — 3D view
      </div>
      <div className="text-sm text-[var(--noir-muted)] mb-4">
        Period-accurate board track. Results below.
      </div>
      {resultOrder?.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {resultOrder.map((id, i) => {
            const p = (participants || []).find((x) => (x.user_id || x.id) === id);
            return (
              <span key={id} className="px-2 py-1 rounded surface text-xs">
                #{i + 1} {p?.username || p?.car_name || id}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Racing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const raceIdParam = searchParams.get("race");
  const [profile, setProfile] = useState(null);
  const [cars, setCars] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [openRaces, setOpenRaces] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [comps, setComps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRace, setActiveRace] = useState(null);
  const [raceViewMode, setRaceViewMode] = useState(() => localStorage.getItem(RACE_VIEW_KEY) || "2d");
  const [tab, setTab] = useState("races"); // races | myride | crew | leaderboard | comps
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const [createForm, setCreateForm] = useState({ track_id: "", entry_fee: 0, max_grid: 6 });

  const fetchProfile = useCallback(async () => {
    try {
      const r = await api.get("/racing/profile");
      setProfile(r.data?.profile || null);
      setCars(r.data?.owned_cars || []);
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
        if (race?.state === "open") {
          setActiveRace(race);
          setTab("races");
        } else if (race?.state === "completed") {
          setActiveRace(race);
          setTab("races");
        }
      } catch (_) {}
    })();
  }, [raceIdParam]);

  const handleCreateRace = async () => {
    if (!createForm.track_id) {
      toast.error("Select a track");
      return;
    }
    setCreating(true);
    try {
      const r = await api.post("/racing/races", {
        track_id: createForm.track_id,
        entry_fee: Number(createForm.entry_fee) || 0,
        max_grid: Number(createForm.max_grid) || 6,
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
    if (!carInstanceId) {
      toast.error("Select a racing car first");
      return;
    }
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

  const handleBuyCar = async (racingCarId) => {
    try {
      await api.post("/racing/cars/buy", { racing_car_id: racingCarId });
      await fetchProfile();
      refreshUser();
      toast.success("Racing car purchased");
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
    if (!carInstanceId) {
      toast.error("Select a racing car first");
      return;
    }
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
          Road races • Buy racing cars • Crew upgrades • Purse by position
        </p>
      </div>

      {/* Active race: show run (2D/3D) then results */}
      {activeRace?.state === "completed" && !activeRace._resultsShown && (
        <div className="p-4">
          <div className="flex justify-end gap-2 mb-2">
            <label className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                checked={raceViewMode === "2d"}
                onChange={() => {
                  setRaceViewMode("2d");
                  localStorage.setItem(RACE_VIEW_KEY, "2d");
                }}
              />
              2D
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                checked={raceViewMode === "3d"}
                onChange={() => {
                  setRaceViewMode("3d");
                  localStorage.setItem(RACE_VIEW_KEY, "3d");
                }}
              />
              3D
            </label>
          </div>
          {raceViewMode === "2d" ? (
            <RaceRun2D
              participants={activeRace.participants}
              resultOrder={activeRace.result_order}
              onComplete={() => setActiveRace((r) => (r ? { ...r, _resultsShown: true } : null))}
            />
          ) : (
            <RaceRun3D
              participants={activeRace.participants}
              resultOrder={activeRace.result_order}
              onComplete={() => setActiveRace((r) => (r ? { ...r, _resultsShown: true } : null))}
            />
          )}
        </div>
      )}

      {activeRace?.state === "completed" && activeRace._resultsShown && (
        <div className={styles.panel + " m-4 p-4"}>
          <h2 className="font-heading mb-3" style={{ color: "var(--noir-primary)" }}>
            Race results
          </h2>
          <ul className="space-y-1">
            {(activeRace.result_order || []).map((id, i) => {
              const p = (activeRace.participants || []).find((x) => (x.user_id || x.id) === id);
              const rew = (activeRace.rewards || []).find((r) => r.entrant_id === id);
              return (
                <li key={id} className="flex items-center justify-between py-1 border-b border-[var(--noir-border)] last:border-0">
                  <span>
                    #{i + 1} {p?.username || p?.car_name || id}
                  </span>
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
            onClick={() => {
              setActiveRace(null);
              navigate("/racing", { replace: true });
            }}
          >
            Back to races
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--noir-border)] px-4 gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={"py-2 px-3 text-sm font-heading " + (tab === t.id ? "border-b-2 text-[var(--noir-primary)]" : "text-[var(--noir-muted)]")}
            style={tab === t.id ? { borderBottomColor: "var(--noir-primary)" } : {}}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === "myride" && (
          <>
            <div className={styles.panel + " p-4 mb-4"}>
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
                My racing cars
              </h3>
              {cars.length === 0 ? (
                <p className="text-sm text-[var(--noir-muted)]">Buy a racing car below (separate from garage).</p>
              ) : (
                <ul className="space-y-2">
                  {cars.map((c) => (
                    <li key={c.id} className="flex items-center justify-between p-2 rounded surface">
                      <span>{c.car_name || c.racing_car_id}</span>
                      <span className="text-xs text-[var(--noir-muted)]">Engine {c.engine_level ?? 0} / Tires {c.tires_level ?? 0}</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={styles.btnPrimary + " text-xs"}
                          disabled={selectedInstanceId === c.id}
                          onClick={() => handleSelectCar(c.id)}
                        >
                          {selectedInstanceId === c.id ? "Selected" : "Select"}
                        </button>
                        <button
                          type="button"
                          className={styles.btnGoldDarkText + " text-xs"}
                          onClick={() => handleUpgradeCar(c.id)}
                        >
                          Upgrade
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <RacingCarsShop
              onBuy={handleBuyCar}
              formatMoney={formatMoney}
              styles={styles}
            />
          </>
        )}

        {tab === "crew" && (
          <div className={styles.panel + " p-4"}>
            <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
              Crew upgrades
            </h3>
            <p className="text-sm text-[var(--noir-muted)] mb-4">Spend cash to improve mechanic and pit crew. Bonus applies in races.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3 rounded surface">
                <div className="font-heading">Mechanic</div>
                <div className="text-sm">Level {profile?.mechanic_level ?? 0} / 5</div>
                <button
                  type="button"
                  className={styles.btnPrimary + " mt-2 text-sm"}
                  disabled={(profile?.mechanic_level ?? 0) >= 5}
                  onClick={() => handleUpgradeCrew("mechanic")}
                >
                  Upgrade
                </button>
              </div>
              <div className="p-3 rounded surface">
                <div className="font-heading">Pit</div>
                <div className="text-sm">Level {profile?.pit_level ?? 0} / 5</div>
                <button
                  type="button"
                  className={styles.btnPrimary + " mt-2 text-sm"}
                  disabled={(profile?.pit_level ?? 0) >= 5}
                  onClick={() => handleUpgradeCrew("pit")}
                >
                  Upgrade
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "races" && (
          <>
            {activeRace?.state === "open" && (
              <div className={styles.panel + " p-4 mb-4"}>
                <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
                  Your race: {activeRace.track_name}
                </h3>
                <p className="text-sm text-[var(--noir-muted)]">
                  {activeRace.participants?.length ?? 0} / {activeRace.max_grid} on grid. Entry fee: {formatMoney(activeRace.entry_fee)}.
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

            <div className={styles.panel + " p-4 mb-4"}>
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
                Create race
              </h3>
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
                  <input
                    type="number"
                    min={0}
                    className={styles.input + " w-28"}
                    value={createForm.entry_fee}
                    onChange={(e) => setCreateForm((f) => ({ ...f, entry_fee: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs">Grid size</span>
                  <input
                    type="number"
                    min={2}
                    max={8}
                    className={styles.input + " w-20"}
                    value={createForm.max_grid}
                    onChange={(e) => setCreateForm((f) => ({ ...f, max_grid: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  disabled={creating || !selectedInstanceId}
                  onClick={handleCreateRace}
                >
                  {creating ? "Creating…" : "Create race"}
                </button>
              </div>
              {!selectedInstanceId && (
                <p className="text-xs text-amber-400 mt-2">Select a racing car in My ride first.</p>
              )}
            </div>

            <div className={styles.panel + " p-4"}>
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
                Open races
              </h3>
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
                      <button
                        type="button"
                        className={styles.btnPrimary + " text-sm"}
                        disabled={joiningId === race.id || !selectedInstanceId || race.participants?.some((p) => p.user_id === profile?.user_id)}
                        onClick={() => handleJoinRace(race, selectedInstanceId)}
                      >
                        {joiningId === race.id ? "Joining…" : "Join"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {tab === "leaderboard" && (
          <div className={styles.panel + " p-4"}>
            <h3 className="font-heading mb-3" style={{ color: "var(--noir-primary)" }}>
              Racing leaderboard
            </h3>
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
            </div>
          )}
        )}

        {tab === "comps" && (
          <div className={styles.panel + " p-4"}>
            <h3 className="font-heading mb-3" style={{ color: "var(--noir-primary)" }}>
              Race competitions
            </h3>
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
                    <button
                      type="button"
                      className={styles.btnPrimary + " text-sm"}
                      disabled={!selectedInstanceId}
                      onClick={() => handleEnterComp(comp.id, selectedInstanceId)}
                    >
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

function RacingCarsShop({ onBuy, formatMoney, styles }) {
  const [cars, setCars] = useState([]);
  useEffect(() => {
    api.get("/racing/cars").then((r) => setCars(r.data?.cars || [])).catch(() => {});
  }, []);
  return (
    <div className={styles.panel + " p-4"}>
      <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
        Buy racing car
      </h3>
      <p className="text-xs text-[var(--noir-muted)] mb-3">Racing cars are separate from your garage.</p>
      <div className="grid gap-2">
        {cars.map((car) => (
          <div key={car.id} className="flex items-center justify-between p-2 rounded surface">
            <span>{car.name}</span>
            <span className="text-[var(--noir-primary)]">{formatMoney(car.cost)}</span>
            <button
              type="button"
              className={styles.btnPrimary + " text-xs"}
              onClick={() => onBuy(car.id)}
            >
              Buy
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
