import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import api, { refreshUser } from "../utils/api";
import { getApiErrorMessage } from "../utils/api";
import styles from "../styles/noir.module.css";
import CircuitRaceView, { TRACKS as CIRCUIT_TRACKS, TrackThumb } from "./CircuitRaceView";

// ─── track_id → circuit id mapping (backend IDs → CircuitRaceView track ids)
const TRACK_ID_MAP = {
  chicago_board: "chicago",
  daytona_beach: "daytona",
  roosevelt: "roosevelt",
  indianapolis: "indianapolis",
};

// Display info for track grid (km, corners) — backend may not return these
const TRACK_DISPLAY = {
  chicago_board: { km: 2.4, corners: 8 },
  daytona_beach: { km: 3.6, corners: 4 },
  roosevelt: { km: 2.1, corners: 12 },
  indianapolis: { km: 4.0, corners: 4 },
};
// 8 tracks for create form: circuitId for TrackThumb, track_id for API (first 4 = backend; extra 4 map for display only)
const TRACKS_FOR_CREATE = [
  { circuitId: "chicago", track_id: "chicago_board", name: "Chicago Board Track", km: 2.4, corners: 8 },
  { circuitId: "daytona", track_id: "daytona_beach", name: "Daytona Beach", km: 3.6, corners: 4 },
  { circuitId: "indianapolis", track_id: "indianapolis", name: "Indianapolis Motor Speedway", km: 4.0, corners: 4 },
  { circuitId: "roosevelt", track_id: "roosevelt", name: "Roosevelt Raceway", km: 2.1, corners: 12 },
  { circuitId: "boardwalk", track_id: "roosevelt", name: "Boardwalk Circuit", km: 2.8, corners: 16 },
  { circuitId: "lakeside", track_id: "daytona_beach", name: "Lakeside Park", km: 3.2, corners: 10 },
  { circuitId: "harbor", track_id: "chicago_board", name: "Harbor Front", km: 2.5, corners: 20 },
  { circuitId: "mountain", track_id: "indianapolis", name: "Mountain Pass", km: 4.2, corners: 18 },
];

const WEATHER_OPTIONS = [
  { id: "clear", name: "Clear", icon: "☀️" },
  { id: "night", name: "Night", icon: "🌙" },
  { id: "rain", name: "Rain", icon: "🌧️" },
  { id: "snow", name: "Snow", icon: "❄️" },
  { id: "very_hot", name: "Very Hot", icon: "🔥" },
];
// Backend only supports clear, rain, snow, very_hot — map night → clear when creating race
const WEATHER_ID_FOR_API = (id) => (id === "night" ? "clear" : id);
// Inter/Full wet use medium stock until backend supports them
function effectiveTyreStock(compound, profile) {
  if (compound === "inter" || compound === "full_wet") return profile?.tyre_stock_medium ?? 0;
  return profile?.[`tyre_stock_${compound}`] ?? 0;
}

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return "$0";
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatRacingEndTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    const now = new Date();
    const days = Math.ceil((d - now) / (24 * 60 * 60 * 1000));
    if (days < 0) return "ended";
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days < 7) return `in ${days} days`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch (_) {
    return iso?.slice(0, 10) || "";
  }
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
  const [upgradesByCar, setUpgradesByCar] = useState({});
  const [crewCosts, setCrewCosts] = useState([]);
  const [carUpgradeCosts, setCarUpgradeCosts] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [openRaces, setOpenRaces] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [comps, setComps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRace, setActiveRace] = useState(null);
  const [tab, setTab] = useState("races");
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const [joinTyre, setJoinTyre] = useState("medium");
  const [createForm, setCreateForm] = useState({ track_id: "", circuitId: "", entry_fee: 0, max_grid: 6, laps: 3, tyre_compound: "medium", weather_id: "clear" });
  const [teamCreateName, setTeamCreateName] = useState("");
  const [teamCreateColor, setTeamCreateColor] = useState("#e8d020");
  const [teamCreating, setTeamCreating] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const r = await api.get("/racing/profile");
      const d = r.data || {};
      setProfile({
        ...(d.profile || {}),
        tyre_stock_soft: d.tyre_stock_soft,
        tyre_stock_medium: d.tyre_stock_medium,
        tyre_stock_hard: d.tyre_stock_hard,
        tyre_costs: d.tyre_costs || {},
        engine_repair_cost_per_pct: d.engine_repair_cost_per_pct,
        engine_replace_cost: d.engine_replace_cost,
        racing_team_create_cost: d.racing_team_create_cost,
        racing_team_count: d.racing_team_count,
        max_racing_teams: d.max_racing_teams,
        racing_week_ends_utc: d.racing_week_ends_utc,
        racing_season_ends_utc: d.racing_season_ends_utc,
        global_upgrade_cap: d.global_upgrade_cap ?? 18,
        crew_levels_used: d.crew_levels_used ?? 0,
        crew_global_cap: d.crew_global_cap ?? 24,
        crew_tradeoffs: d.crew_tradeoffs || null,
      });
      setCars(d.owned_cars || []);
      setUpgradeTradeoffs(d.upgrade_tradeoffs || null);
      setUpgradesByCar(d.upgrades || {});
      setCrewCosts(Array.isArray(d.crew_costs) ? d.crew_costs : []);
      setCarUpgradeCosts(Array.isArray(d.car_upgrade_costs) ? d.car_upgrade_costs : []);
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
        if (tracksRes.data?.tracks?.length) {
          setCreateForm((f) => (f.track_id ? f : { ...f, track_id: tracksRes.data.tracks[0].id }));
        }
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
        tyre_compound: (createForm.tyre_compound === "inter" || createForm.tyre_compound === "full_wet" ? "medium" : createForm.tyre_compound) || "medium",
        weather_id: WEATHER_ID_FOR_API(createForm.weather_id || "clear"),
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

  const handleJoinRace = async (race, carInstanceId, tyreCompound = "medium") => {
    if (!carInstanceId) { toast.error("Select a racing car first"); return; }
    setJoiningId(race.id);
    try {
      await api.post(`/racing/races/${race.id}/join`, { racing_car_instance_id: carInstanceId, tyre_compound: tyreCompound });
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
      toast.success("Race started — run it live");
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleCompleteRace = async (raceId, resultOrder) => {
    try {
      const r = await api.post(`/racing/races/${raceId}/complete`, { result_order: resultOrder });
      setActiveRace((prev) => (prev?.id === raceId ? { ...r.data?.race, _resultsShown: true } : prev));
      refreshUser();
      fetchProfile();
      toast.success("Race completed");
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleCreateTeam = async (e) => {
    e?.preventDefault();
    const name = (teamCreateName || "").trim();
    let color = (teamCreateColor || "").trim();
    if (!name) { toast.error("Enter a team name"); return; }
    if (color.startsWith("#")) color = color.slice(1);
    if (!/^[0-9a-fA-F]{6}$/.test(color)) { toast.error("Colour must be a 6-character hex code (e.g. e82020)"); return; }
    setTeamCreating(true);
    try {
      await api.post("/racing/team/create", { name, color: "#" + color });
      setTeamCreateName("");
      setTeamCreateColor("#e8d020");
      await fetchProfile();
      refreshUser();
      toast.success("Racing team created");
    } catch (err) {
      toast.error(apiDetail(err));
    } finally {
      setTeamCreating(false);
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

  const handleUpgradeCar = async (instanceId, upgradeType = "engine") => {
    try {
      await api.post("/racing/car/upgrade", { racing_car_instance_id: instanceId, upgrade_type: upgradeType });
      await fetchProfile();
      refreshUser();
      toast.success(upgradeType === "engine" || upgradeType === "tires" ? "Car upgraded" : `${upgradeType} upgraded`);
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleRepairEngine = async (instanceId) => {
    try {
      await api.post("/racing/engine/repair", { racing_car_instance_id: instanceId });
      await fetchProfile();
      refreshUser();
      toast.success("Engine repaired");
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleReplaceEngine = async (instanceId) => {
    try {
      await api.post("/racing/engine/replace", { racing_car_instance_id: instanceId });
      await fetchProfile();
      refreshUser();
      toast.success("Engine replaced");
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleBuyTyres = async (compound, quantity = 1) => {
    try {
      await api.post("/racing/tyres/buy", { compound, quantity });
      await fetchProfile();
      refreshUser();
      toast.success(`Bought ${quantity} ${compound} tyre set(s)`);
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

  const hasTeam = !!(profile?.team_name || "").trim();
  const teamCreateCost = profile?.racing_team_create_cost ?? 25_000_000;

  if (!hasTeam) {
    return (
      <div className={styles.page + " overflow-x-hidden"} style={{ minHeight: "100%", WebkitOverflowScrolling: "touch" }}>
        <div className={styles.panelHeader + " px-4 py-3"}>
          <h1 className="text-xl font-heading" style={{ color: "var(--noir-primary)" }}>
            Bootleg runs
          </h1>
          <p className="text-sm text-[var(--noir-muted)] mt-1">
            Create a racing team to enter races. Name your team and choose a colour.
          </p>
        </div>
        <div className="p-4 max-w-md">
          <div className={styles.panel + " p-4"}>
            <h2 className="font-heading mb-3" style={{ color: "var(--noir-primary)" }}>Create your racing team</h2>
            <p className="text-sm text-[var(--noir-muted)] mb-4">
              Cost: <strong style={{ color: "var(--noir-primary)" }}>{formatMoney(teamCreateCost)}</strong> — paid from your cash. You need a team before you can create or join races.
              {typeof profile?.racing_team_count === "number" && profile?.max_racing_teams != null && (
                <span className="block mt-1">
                  Teams: <strong>{profile.racing_team_count} / {profile.max_racing_teams}</strong>
                  {profile.racing_team_count >= profile.max_racing_teams && " — at cap. Kill a team owner to take their team."}
                </span>
              )}
            </p>
            <form onSubmit={handleCreateTeam} className="space-y-4">
              <label className="block">
                <span className="text-xs font-heading uppercase tracking-wider text-[var(--noir-muted)]">Team name</span>
                <input
                  type="text"
                  className={styles.input + " w-full mt-1"}
                  placeholder="e.g. Midnight Runners"
                  value={teamCreateName}
                  onChange={(e) => setTeamCreateName(e.target.value)}
                  maxLength={50}
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className="text-xs font-heading uppercase tracking-wider text-[var(--noir-muted)]">Colour key</span>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    className="h-10 w-14 rounded border border-[var(--noir-border)] cursor-pointer"
                    value={teamCreateColor.startsWith("#") ? teamCreateColor : teamCreateColor ? "#" + teamCreateColor : "#e8d020"}
                    onChange={(e) => setTeamCreateColor(e.target.value)}
                    title="Team colour"
                  />
                  <input
                    type="text"
                    className={styles.input + " flex-1 font-mono"}
                    placeholder="#e82020"
                    value={teamCreateColor}
                    onChange={(e) => setTeamCreateColor(e.target.value)}
                    maxLength={7}
                    autoComplete="off"
                  />
                </div>
                <p className="text-[10px] text-[var(--noir-muted)] mt-1">Hex colour for your team (e.g. #e82020 or e82020)</p>
              </label>
              <button
                type="submit"
                className={styles.btnPrimary + " w-full min-h-[44px] touch-manipulation"}
                disabled={teamCreating || !(teamCreateName || "").trim() || (profile?.racing_team_count >= (profile?.max_racing_teams ?? 18))}
              >
                {profile?.racing_team_count >= (profile?.max_racing_teams ?? 18)
                  ? `At cap (${profile?.racing_team_count ?? 0}/${profile?.max_racing_teams ?? 18} teams)`
                  : teamCreating ? "Creating…" : `Create team (${formatMoney(teamCreateCost)})`}
              </button>
            </form>
          </div>
        </div>
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
    <div className={styles.page + " overflow-x-hidden"} style={{ minHeight: "100%", WebkitOverflowScrolling: "touch" }}>
      <div className={styles.panelHeader + " px-4 py-3"}>
        <h1 className="text-xl font-heading" style={{ color: "var(--noir-primary)" }}>
          Bootleg runs
        </h1>
        <p className="text-sm text-[var(--noir-muted)] mt-1">
          Road races • Choose car • Crew upgrades • Purse by position
        </p>
        <p className="text-xs mt-2" style={{ color: "var(--noir-primary)" }}>
          Crew bank: {formatMoney(profile?.crew_bank ?? 0)} — race winnings for upgrades
          {profile?.team_name && (
            <span className="ml-3">
              Team: <span style={{ color: profile?.team_color || "var(--noir-primary)" }}>●</span> {profile.team_name}
            </span>
          )}
        </p>
        {(profile?.racing_week_ends_utc || profile?.racing_season_ends_utc) && (
          <p className="text-[10px] text-[var(--noir-muted)] mt-1">
            {profile.racing_week_ends_utc && (
              <span>Week ends: {formatRacingEndTime(profile.racing_week_ends_utc)}</span>
            )}
            {profile.racing_week_ends_utc && profile.racing_season_ends_utc && " • "}
            {profile.racing_season_ends_utc && (
              <span>Season ends: {formatRacingEndTime(profile.racing_season_ends_utc)}</span>
            )}
          </p>
        )}
      </div>

      {/* ─── ACTIVE RACE: live run (state running) ─── */}
      {activeRace?.state === "running" && (
        <div className="p-4">
          {activeRace.qualifying_order?.length > 0 && (
            <p className="text-xs font-heading uppercase tracking-wider text-[var(--noir-primary)] mb-2">
              Live race · Grid order set by qualifying lap
            </p>
          )}
          <CircuitRaceView
            mode="live"
            participants={activeRace.participants || []}
            qualifying_order={activeRace.qualifying_order || []}
            laps={activeRace.laps || 3}
            weather={activeRace.weather || "clear"}
            weather_name={activeRace.weather_name}
            initialTrackId={circuitTrackId}
            playerCarName={playerCarName}
            playerPitLevel={profile?.pit_level ?? 0}
            currentUserId={profile?.user_id}
            onComplete={(resultOrder) => resultOrder && handleCompleteRace(activeRace.id, resultOrder)}
            onReset={() => { setActiveRace(null); fetchOpenRaces(); }}
          />
        </div>
      )}

      {/* ─── POST-RACE RESULTS ─── */}
      {activeRace?.state === "completed" && (
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
              const isDnf = rew?.dnf || (activeRace.dnf_ids || []).includes(id);
              return (
                <li key={id} className="flex items-center justify-between py-1 border-b border-[var(--noir-border)] last:border-0">
                  <span>
                    #{i + 1} {p?.username || p?.car_name || id}
                    {isDnf && <span className="text-red-400 font-heading ml-2">DNF</span>}
                  </span>
                  {rew && !isDnf && (
                    <span className="text-sm text-[var(--noir-muted)]">
                      {formatMoney(rew.cash)} → crew bank • {rew.rank_points} RP • {rew.racing_rep} rep
                    </span>
                  )}
                  {rew && isDnf && <span className="text-xs text-[var(--noir-muted)]">Engine / mechanical</span>}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className={styles.btnPrimary + " mt-3 min-h-[44px] touch-manipulation"}
            onClick={() => { setActiveRace(null); fetchProfile(); navigate("/racing", { replace: true }); }}
          >
            Back to races
          </button>
        </div>
      )}

      {/* ─── TABS ─── */}
      <div className="flex border-b border-[var(--noir-border)] px-4 gap-2 overflow-x-auto overflow-y-hidden touch-pan-x" style={{ minHeight: 44, WebkitOverflowScrolling: "touch" }}>
        {tabs.map((t) => (
          <button
            key={t.id} type="button"
            className={"py-2 px-3 text-sm font-heading whitespace-nowrap flex-shrink-0 " + (tab === t.id ? "border-b-2 text-[var(--noir-primary)]" : "text-[var(--noir-muted)]")}
            style={{ minHeight: 44, borderBottomColor: tab === t.id ? "var(--noir-primary)" : "transparent" }}
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
            {/* Create race — live-race style setup (first so tab always looks like reference) */}
            <div className={styles.panel + " p-4 mb-4"}>
              <h3 className="font-heading text-sm uppercase tracking-wider mb-4" style={{ color: "var(--noir-primary)" }}>
                LIVE RACE - GRID ORDER SET BY QUALIFYING LAP
              </h3>

              {/* SELECT TRACK — 8 tracks in 2×4 grid with outline thumbnails */}
              <div className="mb-6">
                <div className="text-[10px] font-heading uppercase tracking-wider text-[var(--noir-muted)] mb-2">SELECT TRACK</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {TRACKS_FOR_CREATE.map((t) => {
                    const circuit = CIRCUIT_TRACKS[t.circuitId];
                    const selected = createForm.circuitId === t.circuitId;
                    return (
                      <button
                        key={t.circuitId}
                        type="button"
                        onClick={() => setCreateForm((f) => ({ ...f, track_id: t.track_id, circuitId: t.circuitId }))}
                        className={`p-3 rounded-lg border-2 text-left transition-all touch-manipulation ${selected ? "border-[var(--noir-primary)] bg-[var(--noir-primary)]/10" : "border-[var(--noir-border)] bg-[var(--noir-surface)] hover:border-[var(--noir-muted)]"}`}
                      >
                        <div className="w-full aspect-[2.2/1] rounded flex items-center justify-center mb-2 overflow-hidden" style={{ background: "var(--noir-surface)", border: "1px solid var(--noir-border)" }}>
                          {circuit ? <TrackThumb track={circuit} active={selected} /> : <span className="text-[8px] font-heading text-[var(--noir-muted)]">TRACK</span>}
                        </div>
                        <div className="font-heading text-xs truncate" style={{ color: "var(--noir-primary)" }}>{t.name}</div>
                        <div className="text-[10px] text-[var(--noir-muted)]">{t.km}km · {t.corners}T</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* CONDITIONS + YOUR STARTING TYRE + LAPS in one row on desktop */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
                {/* Conditions */}
                <div>
                  <div className="text-[10px] font-heading uppercase tracking-wider text-[var(--noir-muted)] mb-2">CONDITIONS</div>
                  <div className="flex flex-wrap gap-2">
                    {WEATHER_OPTIONS.map((w) => {
                      const sel = createForm.weather_id === w.id;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => setCreateForm((f) => ({ ...f, weather_id: w.id }))}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-heading touch-manipulation ${sel ? "border-[var(--noir-primary)] bg-[var(--noir-primary)]/15 text-[var(--noir-primary)]" : "border-[var(--noir-border)] bg-[var(--noir-surface)] text-[var(--noir-muted)] hover:bg-[var(--noir-border)]/30"}`}
                          title={w.name}
                        >
                          <span>{w.icon}</span>
                          <span>{w.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-[var(--noir-muted)] mt-1.5">
                    {createForm.weather_id === "very_hot" || createForm.weather_id === "rain" ? "Rec: Medium, Hard" : "Pick tyres suited to conditions."}
                  </p>
                </div>

                {/* Your starting tyre — 5 options */}
                <div>
                  <div className="text-[10px] font-heading uppercase tracking-wider text-[var(--noir-muted)] mb-2">YOUR STARTING TYRE</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "soft", label: "Soft", dot: "bg-red-500", desc: "Grippy, faster wear" },
                      { id: "medium", label: "Medium", dot: "bg-amber-400", desc: "Balanced" },
                      { id: "hard", label: "Hard", dot: "bg-gray-500", desc: "Durable, slower" },
                      { id: "inter", label: "Inter", dot: "bg-cyan-400", desc: "Wet conditions" },
                      { id: "full_wet", label: "Full Wet", dot: "bg-blue-600", desc: "Heavy rain" },
                    ].map((tyre) => {
                      const sel = createForm.tyre_compound === tyre.id;
                      return (
                        <button
                          key={tyre.id}
                          type="button"
                          onClick={() => setCreateForm((f) => ({ ...f, tyre_compound: tyre.id }))}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm touch-manipulation ${sel ? "border-[var(--noir-primary)] bg-[var(--noir-primary)]/10" : "border-[var(--noir-border)] bg-[var(--noir-surface)]"}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${tyre.dot}`} />
                          <span style={{ color: "var(--noir-primary)" }}>{tyre.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-[var(--noir-muted)] mt-1">
                    {(["soft", "medium", "hard"].includes(createForm.tyre_compound) && { soft: "Grippy, faster wear", medium: "Balanced", hard: "Durable, slower" }[createForm.tyre_compound]) ||
                      (createForm.tyre_compound === "inter" && "Wet conditions") ||
                      (createForm.tyre_compound === "full_wet" && "Heavy rain")}
                  </p>
                  <p className="text-[10px] text-[var(--noir-muted)]">
                    Stock: {["soft", "medium", "hard"].includes(createForm.tyre_compound) ? (profile?.[`tyre_stock_${createForm.tyre_compound}`] ?? 0) : (profile?.tyre_stock_medium ?? 0)}
                  </p>
                </div>

                {/* Laps + entry/grid */}
                <div>
                  <div className="text-[10px] font-heading uppercase tracking-wider text-[var(--noir-muted)] mb-2">LAPS</div>
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={createForm.laps}
                    onChange={(e) => setCreateForm((f) => ({ ...f, laps: Math.max(2, Math.min(20, Number(e.target.value) || 2)) }))}
                    className={styles.input + " w-20 text-lg font-heading"}
                  />
                  <div className="flex flex-wrap gap-3 mt-3">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--noir-muted)]">Entry fee</span>
                      <input type="number" min={0} className={styles.input + " w-24"} value={createForm.entry_fee}
                        onChange={(e) => setCreateForm((f) => ({ ...f, entry_fee: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--noir-muted)]">Grid size</span>
                      <input type="number" min={2} max={8} className={styles.input + " w-16"} value={createForm.max_grid}
                        onChange={(e) => setCreateForm((f) => ({ ...f, max_grid: e.target.value }))} />
                    </label>
                  </div>
                </div>
              </div>

              {/* Weather randomise + Create race button */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--noir-border)]">
                <button
                  type="button"
                  className="text-xs font-heading px-3 py-2 rounded border border-[var(--noir-border)] hover:bg-[var(--noir-primary)]/10 touch-manipulation"
                  onClick={() => setCreateForm((f) => ({ ...f, weather_id: WEATHER_OPTIONS[Math.floor(Math.random() * WEATHER_OPTIONS.length)].id }))}
                >
                  Randomise weather
                </button>
                <button
                  type="button"
                  className={styles.btnPrimary + " min-h-[44px] touch-manipulation"}
                  disabled={creating || !createForm.track_id || !selectedInstanceId || (cars.find((c) => c.id === selectedInstanceId)?.engine_wear ?? 0) >= 100 || (effectiveTyreStock(createForm.tyre_compound, profile) < 1)}
                  onClick={handleCreateRace}
                >
                  {creating ? "Creating…" : "Create race"}
                </button>
              </div>
              {(cars.find((c) => c.id === selectedInstanceId)?.engine_wear ?? 0) >= 100 && (
                <p className="text-xs text-amber-400 mt-2">Engine at 100% wear. Repair or replace in My ride.</p>
              )}
              {effectiveTyreStock(createForm.tyre_compound, profile) < 1 && (
                <p className="text-xs text-amber-400 mt-2">No {createForm.tyre_compound} tyres in stock. Buy in My ride.</p>
              )}
              {!selectedInstanceId && (
                <p className="text-xs text-amber-400 mt-2">Select a racing car in My ride first.</p>
              )}
            </div>

            {/* Active open race panel — after create form */}
            {activeRace?.state === "open" && (
              <div className={styles.panel + " p-4 mb-4"}>
                <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
                  Your race: {activeRace.track_name}
                </h3>
                <p className="text-sm text-[var(--noir-muted)]">
                  {activeRace.participants?.length ?? 0} / {activeRace.max_grid} on grid.
                  Entry fee: {formatMoney(activeRace.entry_fee)}.
                  {activeRace.weather_name || (WEATHER_OPTIONS.find((w) => w.id === activeRace.weather)?.name) ? (
                    <> Weather: {activeRace.weather_name ?? WEATHER_OPTIONS.find((w) => w.id === activeRace.weather)?.name ?? activeRace.weather}</>
                  ) : null}
                </p>
                {canStartRace && (
                  <button
                    type="button"
                    className={styles.btnPrimary + " mt-3 min-h-[44px] touch-manipulation"}
                    onClick={() => handleStartRace(activeRace)}
                  >
                    Start race (fill with NPCs)
                  </button>
                )}
              </div>
            )}

            {/* Open races */}
            <div className={styles.panel + " p-4"}>
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>Open races</h3>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs text-[var(--noir-muted)]">Tyres when joining:</span>
                <select className={styles.input + " w-24 text-sm"} value={joinTyre} onChange={(e) => setJoinTyre(e.target.value)}>
                  <option value="soft">Soft</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <span className="text-[10px] text-[var(--noir-muted)]">Weather shown per race; pick tyres for conditions.</span>
              </div>
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
                          {race.weather_name || race.weather ? ` • ${race.weather_name ?? WEATHER_OPTIONS.find((w) => w.id === race.weather)?.name ?? race.weather}` : ""}
                        </span>
                      </div>
                      <button type="button" className={styles.btnPrimary + " text-sm min-h-[44px] touch-manipulation"}
                        disabled={joiningId === race.id || !selectedInstanceId || race.participants?.some((p) => p.user_id === profile?.user_id) || (cars.find((c) => c.id === selectedInstanceId)?.engine_wear ?? 0) >= 100 || (profile?.[`tyre_stock_${joinTyre}`] ?? 0) < 1}
                        onClick={() => handleJoinRace(race, selectedInstanceId, joinTyre)}>
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
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>Tyre stock</h3>
              <p className="text-xs text-[var(--noir-muted)] mb-3">One set per race. Buy more below (uses crew bank).</p>
              <div className="flex flex-wrap gap-4">
                {["soft", "medium", "hard"].map((compound) => {
                  const stock = profile?.[`tyre_stock_${compound}`] ?? 0;
                  const cost = profile?.tyre_costs?.[compound] ?? 500;
                  const bank = profile?.crew_bank ?? 0;
                  return (
                    <div key={compound} className="flex items-center gap-2 p-2 rounded border border-[var(--noir-border)] bg-[var(--noir-surface)]">
                      <span className="text-xs font-heading capitalize text-[var(--noir-primary)]">{compound}</span>
                      <span className="text-sm font-heading tabular-nums">{stock}</span>
                      <span className="text-[10px] text-[var(--noir-muted)]">sets</span>
                      <button type="button" className={styles.btnGoldDarkText + " text-xs"} disabled={bank < cost} onClick={() => handleBuyTyres(compound, 1)}>
                        Buy 1 ({formatMoney(cost)})
                      </button>
                      <button type="button" className={styles.btnGoldDarkText + " text-xs"} disabled={bank < cost * 5} onClick={() => handleBuyTyres(compound, 5)}>
                        Buy 5 ({formatMoney(cost * 5)})
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className={styles.panel + " p-4 mb-4"}>
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>Your car</h3>
              {cars.length === 0 ? (
                <p className="text-sm text-[var(--noir-muted)]">Choose a car below. You have one racing car slot.</p>
              ) : (
                <ul className="space-y-4">
                  {cars.map((c) => {
                    const up = upgradesByCar[c.id] || {};
                    const engine = up.engine_level ?? c.engine_level ?? 0;
                    const tires = up.tires_level ?? c.tires_level ?? 0;
                    const aero = up.aero_level ?? 0;
                    const reliability = up.reliability_level ?? 0;
                    const brakes = up.brakes_level ?? 0;
                    const gearbox = up.gearbox_level ?? 0;
                    const cooling = up.cooling_level ?? 0;
                    const weight = up.weight_level ?? 0;
                    const fuel = up.fuel_level ?? 0;
                    const championship = up.championship_upgrade || false;
                    const wins = profile?.wins ?? 0;
                    const canAeroRel = wins >= 1;
                    const canChamp = wins >= 3 && !championship;
                    const canWeight = wins >= 2;
                    const effSpeed = c.effective_speed ?? 0;
                    const effGrip = c.effective_grip ?? 0;
                    const globalCap = profile?.global_upgrade_cap ?? 18;
                    const levelsUsed = c.upgrade_levels_used ?? (engine + tires + aero + reliability + (championship ? 1 : 0) + brakes + gearbox + cooling + weight + fuel);
                    const atGlobalCap = levelsUsed >= globalCap;
                    const maxEngine = upgradeTradeoffs?.engine?.max ?? 4;
                    const maxTires = upgradeTradeoffs?.tires?.max ?? 4;
                    const maxAero = upgradeTradeoffs?.aero?.max ?? 2;
                    const maxRel = upgradeTradeoffs?.reliability?.max ?? 2;
                    const maxBrakes = upgradeTradeoffs?.brakes?.max ?? 3;
                    const maxGearbox = upgradeTradeoffs?.gearbox?.max ?? 3;
                    const maxCooling = upgradeTradeoffs?.cooling?.max ?? 2;
                    const maxWeight = upgradeTradeoffs?.weight?.max ?? 2;
                    const maxFuel = upgradeTradeoffs?.fuel?.max ?? 2;
                    const nextEngineTiresTotal = engine + tires + 1;
                    const nextEngineTiresCost = carUpgradeCosts[nextEngineTiresTotal] ?? carUpgradeCosts[carUpgradeCosts.length - 1];
                    return (
                    <li key={c.id} className="p-4 rounded-lg border border-[var(--noir-border)] bg-[var(--noir-surface)]">
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <div>
                          <h4 className="font-heading text-[var(--noir-primary)]">{c.car_name || c.racing_car_id}</h4>
                          <p className="text-xs text-[var(--noir-muted)] mt-0.5">Current performance (with upgrades & crew)</p>
                        </div>
                        <button type="button" className={styles.btnPrimary + " text-xs"}
                          disabled={selectedInstanceId === c.id} onClick={() => handleSelectCar(c.id)}>
                          {selectedInstanceId === c.id ? "Selected" : "Select"}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="p-2 rounded bg-black/20">
                          <div className="text-[10px] font-heading uppercase text-[var(--noir-muted)]">Speed</div>
                          <div className="text-lg font-heading text-[var(--noir-primary)]">{effSpeed}</div>
                          <div className="text-[10px] text-[var(--noir-muted)]">Higher = faster straights</div>
                        </div>
                        <div className="p-2 rounded bg-black/20">
                          <div className="text-[10px] font-heading uppercase text-[var(--noir-muted)]">Grip</div>
                          <div className="text-lg font-heading text-[var(--noir-primary)]">{effGrip}%</div>
                          <div className="text-[10px] text-[var(--noir-muted)]">Higher = better in corners</div>
                        </div>
                      </div>
                      <div className="mb-3">
                        <div className="text-[10px] font-heading uppercase text-[var(--noir-muted)] mb-1">Engine wear</div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-[var(--noir-border)] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, (c.engine_wear ?? 0))}%`,
                                backgroundColor: (c.engine_wear ?? 0) >= 100 ? "#dc2626" : (c.engine_wear ?? 0) >= 75 ? "#f59e0b" : "#22c55e",
                              }}
                            />
                          </div>
                          <span className="text-xs font-heading text-[var(--noir-primary)] w-10">{(c.engine_wear ?? 0).toFixed(0)}%</span>
                        </div>
                        <p className="text-[10px] text-[var(--noir-muted)] mt-0.5">Every race adds wear. At 100% you must repair or replace. High wear risks DNF. Repairs use crew bank.</p>
                        {((c.engine_wear ?? 0) > 0 && (c.engine_wear ?? 0) < 100) && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            <button type="button" className={styles.btnGoldDarkText + " text-xs"}
                              disabled={(profile?.crew_bank ?? 0) < ((c.engine_wear ?? 0) * (profile?.engine_repair_cost_per_pct ?? 400))}
                              onClick={() => handleRepairEngine(c.id)}>
                              Repair to 0% ({formatMoney(((c.engine_wear ?? 0) * (profile?.engine_repair_cost_per_pct ?? 400)))})
                            </button>
                            <button type="button" className={styles.btnGoldDarkText + " text-xs"}
                              disabled={(profile?.crew_bank ?? 0) < (profile?.engine_replace_cost ?? 75000)}
                              onClick={() => handleReplaceEngine(c.id)}>
                              New engine ({formatMoney(profile?.engine_replace_cost ?? 75000)})
                            </button>
                          </div>
                        )}
                        {(c.engine_wear ?? 0) >= 100 && (
                          <p className="text-amber-400 text-xs mt-2">Engine at 100%. Repair or replace before racing.</p>
                        )}
                        {(c.engine_wear ?? 0) >= 100 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            <button type="button" className={styles.btnPrimary + " text-xs"} disabled={(profile?.crew_bank ?? 0) < (profile?.engine_replace_cost ?? 75000)} onClick={() => handleReplaceEngine(c.id)}>
                              Replace engine ({formatMoney(profile?.engine_replace_cost ?? 75000)})
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="mb-3">
                        <div className="text-[10px] font-heading uppercase text-[var(--noir-muted)] mb-1">Upgrade levels</div>
                        <p className="text-xs text-[var(--noir-primary)] mb-2">Levels used: {levelsUsed} / {globalCap}</p>
                        <div className="flex flex-wrap gap-3 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--noir-muted)] w-14">Engine</span>
                            <div className="w-20 h-2 rounded-full bg-[var(--noir-border)] overflow-hidden">
                              <div className="h-full bg-amber-600 rounded-full" style={{ width: `${(engine / maxEngine) * 100}%` }} />
                            </div>
                            <span className="text-[var(--noir-primary)]">{engine}/{maxEngine}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--noir-muted)] w-14">Tires</span>
                            <div className="w-20 h-2 rounded-full bg-[var(--noir-border)] overflow-hidden">
                              <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${(tires / maxTires) * 100}%` }} />
                            </div>
                            <span className="text-[var(--noir-primary)]">{tires}/{maxTires}</span>
                          </div>
                          {(aero > 0 || canAeroRel) && (
                            <div className="flex items-center gap-2">
                              <span className="text-[var(--noir-muted)] w-14">Aero</span>
                              <div className="w-20 h-2 rounded-full bg-[var(--noir-border)] overflow-hidden">
                                <div className="h-full bg-sky-600 rounded-full" style={{ width: `${(aero / maxAero) * 100}%` }} />
                              </div>
                              <span className="text-[var(--noir-primary)]">{aero}/{maxAero}</span>
                            </div>
                          )}
                          {(reliability > 0 || canAeroRel) && (
                            <div className="flex items-center gap-2">
                              <span className="text-[var(--noir-muted)] w-14">Rel</span>
                              <div className="w-20 h-2 rounded-full bg-[var(--noir-border)] overflow-hidden">
                                <div className="h-full bg-violet-600 rounded-full" style={{ width: `${(reliability / maxRel) * 100}%` }} />
                              </div>
                              <span className="text-[var(--noir-primary)]">{reliability}/{maxRel}</span>
                            </div>
                          )}
                          {championship && <span className="text-amber-500 font-heading">Championship ✓</span>}
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--noir-muted)] w-14">Brakes</span>
                            <div className="w-20 h-2 rounded-full bg-[var(--noir-border)] overflow-hidden">
                              <div className="h-full bg-rose-600 rounded-full" style={{ width: `${(brakes / maxBrakes) * 100}%` }} />
                            </div>
                            <span className="text-[var(--noir-primary)]">{brakes}/{maxBrakes}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--noir-muted)] w-14">Gearbox</span>
                            <div className="w-20 h-2 rounded-full bg-[var(--noir-border)] overflow-hidden">
                              <div className="h-full bg-orange-600 rounded-full" style={{ width: `${(gearbox / maxGearbox) * 100}%` }} />
                            </div>
                            <span className="text-[var(--noir-primary)]">{gearbox}/{maxGearbox}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--noir-muted)] w-14">Cooling</span>
                            <div className="w-20 h-2 rounded-full bg-[var(--noir-border)] overflow-hidden">
                              <div className="h-full bg-cyan-600 rounded-full" style={{ width: `${(cooling / maxCooling) * 100}%` }} />
                            </div>
                            <span className="text-[var(--noir-primary)]">{cooling}/{maxCooling}</span>
                          </div>
                          {(weight > 0 || canWeight) && (
                            <div className="flex items-center gap-2">
                              <span className="text-[var(--noir-muted)] w-14">Weight</span>
                              <div className="w-20 h-2 rounded-full bg-[var(--noir-border)] overflow-hidden">
                                <div className="h-full bg-slate-500 rounded-full" style={{ width: `${(weight / maxWeight) * 100}%` }} />
                              </div>
                              <span className="text-[var(--noir-primary)]">{weight}/{maxWeight}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--noir-muted)] w-14">Fuel</span>
                            <div className="w-20 h-2 rounded-full bg-[var(--noir-border)] overflow-hidden">
                              <div className="h-full bg-yellow-600 rounded-full" style={{ width: `${(fuel / maxFuel) * 100}%` }} />
                            </div>
                            <span className="text-[var(--noir-primary)]">{fuel}/{maxFuel}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          const bank = profile?.crew_bank ?? 0;
                          const aeroCost = canAeroRel && aero < maxAero ? 40000 * (aero + 1) : 0;
                          const relCost = canAeroRel && reliability < maxRel ? 40000 * (reliability + 1) : 0;
                          const champCost = canChamp ? (upgradeTradeoffs?.championship?.cost ?? 350000) : 0;
                          const brakesCost = (upgradeTradeoffs?.brakes?.cost_base ?? 30000) * (brakes + 1);
                          const gearboxCost = (upgradeTradeoffs?.gearbox?.cost_base ?? 30000) * (gearbox + 1);
                          const coolingCost = (upgradeTradeoffs?.cooling?.cost_base ?? 25000) * (cooling + 1);
                          const weightCost = (upgradeTradeoffs?.weight?.cost_base ?? 45000) * (weight + 1);
                          const fuelCost = (upgradeTradeoffs?.fuel?.cost_base ?? 35000) * (fuel + 1);
                          return (
                          <>
                        <button type="button" className={styles.btnGoldDarkText + " text-xs"} title="+4% power, −3% grip per level"
                          disabled={engine >= maxEngine || atGlobalCap || bank < (nextEngineTiresCost ?? 0)}
                          onClick={() => handleUpgradeCar(c.id, "engine")}>Engine+</button>
                        <button type="button" className={styles.btnGoldDarkText + " text-xs"} title="+5% grip, −2% power per level"
                          disabled={tires >= maxTires || atGlobalCap || bank < (nextEngineTiresCost ?? 0)}
                          onClick={() => handleUpgradeCar(c.id, "tires")}>Tires+</button>
                        {canAeroRel && (
                          <>
                            <button type="button" className={styles.btnGoldDarkText + " text-xs"} title="+3% speed, −2% grip (1+ win)"
                              disabled={aero >= maxAero || atGlobalCap || bank < aeroCost}
                              onClick={() => handleUpgradeCar(c.id, "aero")}>Aero+</button>
                            <button type="button" className={styles.btnGoldDarkText + " text-xs"} title="−8% tyre wear, −2% power (1+ win)"
                              disabled={reliability >= maxRel || atGlobalCap || bank < relCost}
                              onClick={() => handleUpgradeCar(c.id, "reliability")}>Rel+</button>
                          </>
                        )}
                        {canChamp && (
                          <button type="button" className={styles.btnGoldDarkText + " text-xs"} title="+2% speed & grip (3+ wins)"
                            disabled={atGlobalCap || bank < champCost}
                            onClick={() => handleUpgradeCar(c.id, "championship")}>Championship</button>
                        )}
                        <button type="button" className={styles.btnGoldDarkText + " text-xs"} title="+2% grip, −1% power per level"
                          disabled={brakes >= maxBrakes || atGlobalCap || bank < brakesCost}
                          onClick={() => handleUpgradeCar(c.id, "brakes")}>Brakes+</button>
                        <button type="button" className={styles.btnGoldDarkText + " text-xs"} title="+2% speed, −1% grip per level"
                          disabled={gearbox >= maxGearbox || atGlobalCap || bank < gearboxCost}
                          onClick={() => handleUpgradeCar(c.id, "gearbox")}>Gearbox+</button>
                        <button type="button" className={styles.btnGoldDarkText + " text-xs"} title="−5% engine wear per level"
                          disabled={cooling >= maxCooling || atGlobalCap || bank < coolingCost}
                          onClick={() => handleUpgradeCar(c.id, "cooling")}>Cooling+</button>
                        {canWeight && (
                          <button type="button" className={styles.btnGoldDarkText + " text-xs"} title="+1% speed & grip per level (2+ wins)"
                            disabled={weight >= maxWeight || atGlobalCap || bank < weightCost}
                            onClick={() => handleUpgradeCar(c.id, "weight")}>Weight+</button>
                        )}
                        <button type="button" className={styles.btnGoldDarkText + " text-xs"} title="+2% power per level"
                          disabled={fuel >= maxFuel || atGlobalCap || bank < fuelCost}
                          onClick={() => handleUpgradeCar(c.id, "fuel")}>Fuel+</button>
                          </>
                          );
                        })()}
                      </div>
                    </li>
                    );
                  })}
                </ul>
              )}
              {/* Trade-offs explainer */}
              {upgradeTradeoffs && (
                <div className="mt-4 p-4 rounded-lg border border-[var(--noir-border)] bg-black/10">
                  <h4 className="font-heading text-sm text-[var(--noir-primary)] mb-2">How trade-offs work</h4>
                  <p className="text-xs text-[var(--noir-muted)] mb-3">Each upgrade improves one stat and reduces another. Balance for your track and tyre strategy.</p>
                  <ul className="space-y-2 text-xs">
                    <li className="flex flex-wrap gap-x-2"><span className="font-heading text-amber-500">Engine:</span> <span className="text-green-500">{upgradeTradeoffs.engine?.positive}</span> <span className="text-red-400">{upgradeTradeoffs.engine?.negative}</span> {upgradeTradeoffs.engine?.per_level && <span className="text-[var(--noir-muted)]">(per level)</span>}</li>
                    <li className="flex flex-wrap gap-x-2"><span className="font-heading text-emerald-500">Tires:</span> <span className="text-green-500">{upgradeTradeoffs.tires?.positive}</span> <span className="text-red-400">{upgradeTradeoffs.tires?.negative}</span> {upgradeTradeoffs.tires?.per_level && <span className="text-[var(--noir-muted)]">(per level)</span>}</li>
                    {upgradeTradeoffs.aero && <li className="flex flex-wrap gap-x-2"><span className="font-heading text-sky-500">Aero:</span> <span className="text-green-500">{upgradeTradeoffs.aero.positive}</span> <span className="text-red-400">{upgradeTradeoffs.aero.negative}</span> <span className="text-[var(--noir-muted)]">— Unlock: {upgradeTradeoffs.aero.unlock}</span></li>}
                    {upgradeTradeoffs.reliability && <li className="flex flex-wrap gap-x-2"><span className="font-heading text-violet-500">Reliability:</span> <span className="text-green-500">{upgradeTradeoffs.reliability.positive}</span> <span className="text-red-400">{upgradeTradeoffs.reliability.negative}</span> <span className="text-[var(--noir-muted)]">— Unlock: {upgradeTradeoffs.reliability.unlock}</span></li>}
                    {upgradeTradeoffs.championship && <li className="flex flex-wrap gap-x-2"><span className="font-heading text-amber-400">Championship:</span> <span className="text-green-500">{upgradeTradeoffs.championship.positive}</span> <span className="text-[var(--noir-muted)]">— Unlock: {upgradeTradeoffs.championship.unlock}</span> {upgradeTradeoffs.championship.cost != null && <span className="text-[var(--noir-primary)]">({formatMoney(upgradeTradeoffs.championship.cost)})</span>}</li>}
                    {upgradeTradeoffs.brakes && <li className="flex flex-wrap gap-x-2"><span className="font-heading text-rose-500">Brakes:</span> <span className="text-green-500">{upgradeTradeoffs.brakes.positive}</span> <span className="text-red-400">{upgradeTradeoffs.brakes.negative}</span> {upgradeTradeoffs.brakes.per_level && <span className="text-[var(--noir-muted)]">(per level)</span>}</li>}
                    {upgradeTradeoffs.gearbox && <li className="flex flex-wrap gap-x-2"><span className="font-heading text-orange-500">Gearbox:</span> <span className="text-green-500">{upgradeTradeoffs.gearbox.positive}</span> <span className="text-red-400">{upgradeTradeoffs.gearbox.negative}</span> {upgradeTradeoffs.gearbox.per_level && <span className="text-[var(--noir-muted)]">(per level)</span>}</li>}
                    {upgradeTradeoffs.cooling && <li className="flex flex-wrap gap-x-2"><span className="font-heading text-cyan-500">Cooling:</span> <span className="text-green-500">{upgradeTradeoffs.cooling.positive}</span> {upgradeTradeoffs.cooling.per_level && <span className="text-[var(--noir-muted)]">(per level)</span>}</li>}
                    {upgradeTradeoffs.weight && <li className="flex flex-wrap gap-x-2"><span className="font-heading text-slate-400">Weight:</span> <span className="text-green-500">{upgradeTradeoffs.weight.positive}</span> <span className="text-[var(--noir-muted)]">— Unlock: {upgradeTradeoffs.weight.unlock}</span> {upgradeTradeoffs.weight.per_level && <span className="text-[var(--noir-muted)]">(per level)</span>}</li>}
                    {upgradeTradeoffs.fuel && <li className="flex flex-wrap gap-x-2"><span className="font-heading text-yellow-500">Fuel:</span> <span className="text-green-500">{upgradeTradeoffs.fuel.positive}</span> {upgradeTradeoffs.fuel.per_level && <span className="text-[var(--noir-muted)]">(per level)</span>}</li>}
                  </ul>
                </div>
              )}
            </div>
            <div className={styles.panel + " p-4"}>
              <h3 className="font-heading mb-2" style={{ color: "var(--noir-primary)" }}>Choose car</h3>
              <p className="text-xs text-[var(--noir-muted)] mb-3">Pick one of the historical race cars. Each has different base speed and grip; upgrades add trade-offs on top.</p>
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
            <p className="text-sm text-[var(--noir-muted)] mb-2">
              Race winnings go to your crew bank. Spend crew bank to improve your team. All crew types add +2% speed per level. Pit Crew also shortens pit stop time. You cannot max every type — total levels are capped.
            </p>
            <p className="text-sm font-heading mb-2" style={{ color: "var(--noir-primary)" }}>
              Crew bank: {formatMoney(profile?.crew_bank ?? 0)}
            </p>
            <p className="text-xs text-[var(--noir-muted)] mb-4">Levels used: {profile?.crew_levels_used ?? 0} / {profile?.crew_global_cap ?? 24}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(() => {
                const tradeoffs = profile?.crew_tradeoffs || {};
                const types = ["mechanic", "pit", ...(Object.keys(tradeoffs).filter((k) => !["mechanic", "pit"].includes(k)))];
                return types.map((type) => {
                  const t = tradeoffs[type];
                  if (!t) return null;
                  const key = type === "mechanic" ? "mechanic_level" : type === "pit" ? "pit_level" : `${type}_level`;
                  const level = profile?.[key] ?? 0;
                  const max = t.max ?? 5;
                  const nextCost = t.costs ? (level < max && t.costs[level + 1] != null ? t.costs[level + 1] : 0) : (t.cost_base ? t.cost_base * (level + 1) : 0);
                  const atCap = (profile?.crew_levels_used ?? 0) >= (profile?.crew_global_cap ?? 24);
                  const canAfford = (profile?.crew_bank ?? 0) >= nextCost;
                  return (
                    <div key={type} className="p-3 rounded surface">
                      <div className="font-heading">{t.label || type}</div>
                      <div className="text-sm">Level {level} / {max}</div>
                      <div className="text-xs text-[var(--noir-muted)] mt-1">{t.desc}</div>
                      {level < max && <div className="text-xs mt-1">Next: {formatMoney(nextCost)}</div>}
                      <button type="button" className={styles.btnPrimary + " mt-2 text-sm"}
                        disabled={level >= max || atCap || !canAfford}
                        onClick={() => handleUpgradeCrew(type)}>
                        Upgrade
                      </button>
                    </div>
                  );
                });
              })()}
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

