import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import api, { refreshUser } from "../utils/api";
import { getApiErrorMessage } from "../utils/api";
import styles from "../styles/noir.module.css";
import CircuitRaceView, { TRACKS as CIRCUIT_TRACKS, TrackThumb } from "./CircuitRaceView";

const TRACK_ID_MAP = {
  chicago_board: "chicago",
  daytona_beach: "daytona",
  roosevelt: "roosevelt",
  indianapolis: "indianapolis",
};

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
const WEATHER_ID_FOR_API = (id) => (id === "night" ? "clear" : id);

function effectiveTyreStock(compound, profile) {
  if (compound === "full_wet") return profile?.tyre_stock_inter ?? 0;
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

const TYRE_DEFS = [
  { id: "soft", label: "Soft", color: "#e82020" },
  { id: "medium", label: "Med", color: "#e8d020" },
  { id: "hard", label: "Hard", color: "#d0d0c0" },
  { id: "inter", label: "Inter", color: "#20a840" },
  { id: "full_wet", label: "Wet", color: "#2080e8" },
];

const UPGRADE_META = [
  { key: "engine", label: "Engine", color: "#b45309" },
  { key: "tires", label: "Tires", color: "#059669" },
  { key: "aero", label: "Aero", color: "#0284c7", winsNeeded: 1 },
  { key: "reliability", label: "Rel", color: "#7c3aed", winsNeeded: 1 },
  { key: "brakes", label: "Brakes", color: "#e11d48" },
  { key: "gearbox", label: "Gearbox", color: "#ea580c" },
  { key: "cooling", label: "Cooling", color: "#0891b2" },
  { key: "weight", label: "Weight", color: "#64748b", winsNeeded: 2 },
  { key: "fuel", label: "Fuel", color: "#ca8a04" },
];

// ─── Module-level cache ───
let _cached = null;
let _racingLastFetch = 0;
const RACING_REFRESH = 30_000;

function CardHead({ title, right }) {
  return (
    <div className="px-4 py-2.5 border-b border-[var(--noir-border)] flex items-center justify-between gap-2" style={{ background: "rgba(201,164,96,.05)" }}>
      <span className="font-heading font-bold uppercase tracking-[.13em] text-[10px]" style={{ color: "var(--noir-primary)" }}>{title}</span>
      {right}
    </div>
  );
}

function Collapsible({ label, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--noir-border)] rounded overflow-hidden mt-2">
      <button
        type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-heading uppercase tracking-widest hover:bg-[var(--noir-surface)] transition-all"
        style={{ color: "var(--noir-muted)" }}
      >
        <span>{label}{count != null ? ` (${count})` : ""}</span>
        <span style={{ fontSize: 8, transition: "transform .2s", transform: open ? "rotate(180deg)" : "none" }}>&#9660;</span>
      </button>
      {open && <div className="border-t border-[var(--noir-border)]">{children}</div>}
    </div>
  );
}

export default function Racing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const raceIdParam = searchParams.get("race");

  const [profile, setProfile] = useState(_cached?.profile ?? null);
  const [cars, setCars] = useState(_cached?.cars ?? []);
  const [availableCars, setAvailableCars] = useState(_cached?.availableCars ?? []);
  const [upgradeTradeoffs, setUpgradeTradeoffs] = useState(_cached?.upgradeTradeoffs ?? null);
  const [upgradesByCar, setUpgradesByCar] = useState(_cached?.upgradesByCar ?? {});
  const [crewCosts, setCrewCosts] = useState(_cached?.crewCosts ?? []);
  const [carUpgradeCosts, setCarUpgradeCosts] = useState(_cached?.carUpgradeCosts ?? []);
  const [tracks, setTracks] = useState(_cached?.tracks ?? []);
  const [openRaces, setOpenRaces] = useState(_cached?.openRaces ?? []);
  const [leaderboard, setLeaderboard] = useState(_cached?.leaderboard ?? []);
  const [comps, setComps] = useState(_cached?.comps ?? []);
  const [loading, setLoading] = useState(!_cached);
  const [activeRace, setActiveRace] = useState(null);
  const [tab, setTab] = useState("races");
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const [joinTyre, setJoinTyre] = useState("medium");
  const [trackFilter, setTrackFilter] = useState("all");
  const [createForm, setCreateForm] = useState({ track_id: "", circuitId: "", entry_fee: 0, max_grid: 6, laps: 3, tyre_compound: "medium", weather_id: "clear" });
  const [teamCreateName, setTeamCreateName] = useState("");
  const [teamCreateColor, setTeamCreateColor] = useState("#e8d020");
  const [teamCreating, setTeamCreating] = useState(false);
  const [latestAutomated, setLatestAutomated] = useState(_cached?.latestAutomated ?? null);
  const [nextAutoRaceUtc, setNextAutoRaceUtc] = useState(_cached?.nextAutoRaceUtc ?? null);
  const refreshTimer = useRef(null);

  const applyProfile = useCallback((d) => {
    const p = {
      ...(d.profile || {}),
      tyre_stock_soft: d.tyre_stock_soft,
      tyre_stock_medium: d.tyre_stock_medium,
      tyre_stock_hard: d.tyre_stock_hard,
      tyre_stock_inter: d.tyre_stock_inter,
      tyre_costs: d.tyre_costs || {},
      engine_repair_cost_per_pct: d.engine_repair_cost_per_pct,
      engine_replace_cost: d.engine_replace_cost,
      racing_team_create_cost: d.racing_team_create_cost,
      racing_team_count: d.racing_team_count,
      max_racing_teams: d.max_racing_teams,
      racing_week_ends_utc: d.racing_week_ends_utc,
      racing_season_ends_utc: d.racing_season_ends_utc,
      global_upgrade_cap: d.global_upgrade_cap ?? 18,
      free_engine_repair_available: !!d.free_engine_repair_available,
      crew_levels_used: d.crew_levels_used ?? 0,
      crew_global_cap: d.crew_global_cap ?? 24,
      crew_tradeoffs: d.crew_tradeoffs || null,
    };
    setProfile(p);
    setCars(d.owned_cars || []);
    setUpgradeTradeoffs(d.upgrade_tradeoffs || null);
    setUpgradesByCar(d.upgrades || {});
    setCrewCosts(Array.isArray(d.crew_costs) ? d.crew_costs : []);
    setCarUpgradeCosts(Array.isArray(d.car_upgrade_costs) ? d.car_upgrade_costs : []);
    if (d.next_automated_race_utc) setNextAutoRaceUtc(d.next_automated_race_utc);
    return p;
  }, []);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [profileRes, carsRes, tracksRes, openRes, lbRes, compsRes, autoRes] = await Promise.all([
        api.get("/racing/profile"),
        api.get("/racing/cars"),
        api.get("/racing/tracks"),
        api.get("/racing/races/open"),
        api.get("/racing/leaderboard"),
        api.get("/racing/comps"),
        api.get("/racing/automated/latest").catch(() => ({ data: {} })),
      ]);
      const prof = applyProfile(profileRes.data || {});
      const avCars = carsRes.data?.cars || [];
      setAvailableCars(avCars);
      const trks = tracksRes.data?.tracks || [];
      setTracks(trks);
      if (trks.length) setCreateForm((f) => (f.track_id ? f : { ...f, track_id: trks[0].id }));
      const or = openRes.data?.races || [];
      setOpenRaces(or);
      const lb = lbRes.data?.leaderboard || [];
      setLeaderboard(lb);
      const cp = compsRes.data?.comps || [];
      setComps(cp);
      const la = autoRes.data?.race || null;
      setLatestAutomated(la);
      const nau = autoRes.data?.next_automated_race_utc || null;
      if (nau) setNextAutoRaceUtc(nau);

      _cached = {
        profile: prof, cars: profileRes.data?.owned_cars || [], availableCars: avCars,
        upgradeTradeoffs: profileRes.data?.upgrade_tradeoffs || null,
        upgradesByCar: profileRes.data?.upgrades || {},
        crewCosts: Array.isArray(profileRes.data?.crew_costs) ? profileRes.data.crew_costs : [],
        carUpgradeCosts: Array.isArray(profileRes.data?.car_upgrade_costs) ? profileRes.data.car_upgrade_costs : [],
        tracks: trks, openRaces: or, leaderboard: lb, comps: cp,
        latestAutomated: la, nextAutoRaceUtc: nau,
      };
      _racingLastFetch = Date.now();
    } catch (e) {
      if (!silent) toast.error(apiDetail(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyProfile]);

  const fetchProfile = useCallback(async () => {
    try {
      const r = await api.get("/racing/profile");
      applyProfile(r.data || {});
    } catch (e) { toast.error(apiDetail(e)); }
  }, [applyProfile]);

  const fetchOpenRaces = useCallback(async () => {
    try { const r = await api.get("/racing/races/open"); setOpenRaces(r.data?.races || []); } catch {}
  }, []);

  useEffect(() => {
    if (_cached && Date.now() - _racingLastFetch < RACING_REFRESH) {
      setLoading(false);
      fetchAll(true);
    } else {
      fetchAll(false);
    }
    refreshTimer.current = setInterval(() => fetchAll(true), RACING_REFRESH);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [fetchAll]);

  useEffect(() => {
    if (!raceIdParam) return;
    (async () => {
      try {
        const r = await api.get(`/racing/races/${raceIdParam}`);
        const race = r.data?.race;
        if (race?.state === "open" || race?.state === "completed" || race?.state === "running") {
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
        tyre_compound: (createForm.tyre_compound === "full_wet" ? "inter" : createForm.tyre_compound) || "medium",
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
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setCreating(false); }
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
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setJoiningId(null); }
  };

  const handleStartRace = async (race) => {
    try {
      const r = await api.post(`/racing/races/${race.id}/start`);
      setActiveRace(r.data?.race);
      refreshUser();
      toast.success("Race started — run it live");
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const handleCompleteRace = async (raceId) => {
    try {
      const r = await api.post(`/racing/races/${raceId}/complete`, {});
      setActiveRace((prev) => (prev?.id === raceId ? { ...r.data?.race, _resultsShown: true } : prev));
      refreshUser();
      fetchProfile();
      toast.success("Race completed");
    } catch (e) { toast.error(apiDetail(e)); }
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
    } catch (err) { toast.error(apiDetail(err)); }
    finally { setTeamCreating(false); }
  };

  const handleSelectCar = async (instanceId) => {
    try { await api.post("/racing/profile/select-car", { racing_car_instance_id: instanceId }); await fetchProfile(); toast.success("Car selected"); }
    catch (e) { toast.error(apiDetail(e)); }
  };

  const handleSelectCarByType = async (racingCarId) => {
    try { await api.post("/racing/profile/select-car", { racing_car_id: racingCarId }); await fetchProfile(); toast.success("Car selected"); }
    catch (e) { toast.error(apiDetail(e)); }
  };

  const handleUpgradeCrew = async (crewType) => {
    try { await api.post("/racing/crew/upgrade", { crew_type: crewType }); await fetchProfile(); refreshUser(); toast.success(`${crewType} upgraded`); }
    catch (e) { toast.error(apiDetail(e)); }
  };

  const handleUpgradeCar = async (instanceId, upgradeType = "engine") => {
    try {
      await api.post("/racing/car/upgrade", { racing_car_instance_id: instanceId, upgrade_type: upgradeType });
      await fetchProfile(); refreshUser();
      toast.success(upgradeType === "engine" || upgradeType === "tires" ? "Car upgraded" : `${upgradeType} upgraded`);
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const handleRepairEngine = async (instanceId) => {
    try {
      const res = await api.post("/racing/engine/repair", { racing_car_instance_id: instanceId });
      await fetchProfile(); refreshUser();
      toast.success(res.data?.free_repair ? "Engine repaired (free this season)" : "Engine repaired");
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const handleReplaceEngine = async (instanceId) => {
    try { await api.post("/racing/engine/replace", { racing_car_instance_id: instanceId }); await fetchProfile(); refreshUser(); toast.success("Engine replaced"); }
    catch (e) { toast.error(apiDetail(e)); }
  };

  const handleBuyTyres = async (compound, quantity = 1) => {
    try { await api.post("/racing/tyres/buy", { compound, quantity }); await fetchProfile(); refreshUser(); toast.success(`Bought ${quantity} ${compound} tyre set(s)`); }
    catch (e) { toast.error(apiDetail(e)); }
  };

  const handleEnterComp = async (compId, carInstanceId) => {
    if (!carInstanceId) { toast.error("Select a racing car first"); return; }
    try { await api.post(`/racing/comps/${compId}/enter`, { racing_car_instance_id: carInstanceId }); await fetchAll(true); refreshUser(); toast.success("Entered competition"); }
    catch (e) { toast.error(apiDetail(e)); }
  };

  const selectedInstanceId = profile?.selected_racing_car_id;
  const isCreator = activeRace?.created_by != null && activeRace?.created_by === profile?.user_id;
  const canStartRace = activeRace?.state === "open" && isCreator;
  const playerCarName = (() => {
    if (!selectedInstanceId) return "Racing Car";
    const c = cars.find((x) => x.id === selectedInstanceId);
    return c?.car_name || "Racing Car";
  })();
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
        <div className="px-4 py-3 border-b border-[var(--noir-border)]" style={{ background: "rgba(201,164,96,.03)" }}>
          <h1 className="text-lg font-heading" style={{ color: "var(--noir-primary)" }}>Bootleg Runs</h1>
          <p className="text-xs text-[var(--noir-muted)] mt-0.5">Create a racing team to enter races.</p>
        </div>
        <div className="p-4 max-w-md">
          <div className={styles.panel + " overflow-hidden"}>
            <CardHead title="Create Your Racing Team" />
            <div className="p-4 space-y-3">
              <p className="text-xs text-[var(--noir-muted)]">
                Cost: <strong style={{ color: "var(--noir-primary)" }}>{formatMoney(teamCreateCost)}</strong> from cash.
                {typeof profile?.racing_team_count === "number" && profile?.max_racing_teams != null && (
                  <span className="ml-2">Teams: <strong>{profile.racing_team_count}/{profile.max_racing_teams}</strong></span>
                )}
              </p>
              <form onSubmit={handleCreateTeam} className="space-y-3">
                <label className="block">
                  <span className="text-[10px] font-heading uppercase tracking-wider text-[var(--noir-muted)]">Team name</span>
                  <input type="text" className={styles.input + " w-full mt-1"} placeholder="e.g. Midnight Runners" value={teamCreateName}
                    onChange={(e) => setTeamCreateName(e.target.value)} maxLength={50} autoComplete="off" />
                </label>
                <label className="block">
                  <span className="text-[10px] font-heading uppercase tracking-wider text-[var(--noir-muted)]">Colour</span>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" className="h-9 w-12 rounded border border-[var(--noir-border)] cursor-pointer"
                      value={teamCreateColor.startsWith("#") ? teamCreateColor : "#" + (teamCreateColor || "e8d020")}
                      onChange={(e) => setTeamCreateColor(e.target.value)} />
                    <input type="text" className={styles.input + " flex-1 font-mono text-xs"} placeholder="#e82020" value={teamCreateColor}
                      onChange={(e) => setTeamCreateColor(e.target.value)} maxLength={7} autoComplete="off" />
                  </div>
                </label>
                <button type="submit" className={styles.btnPrimary + " w-full min-h-[40px] touch-manipulation"}
                  disabled={teamCreating || !(teamCreateName || "").trim() || (profile?.racing_team_count >= (profile?.max_racing_teams ?? 18))}>
                  {profile?.racing_team_count >= (profile?.max_racing_teams ?? 18)
                    ? `At cap (${profile?.racing_team_count ?? 0}/${profile?.max_racing_teams ?? 18})`
                    : teamCreating ? "Creating…" : `Create team (${formatMoney(teamCreateCost)})`}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "races", label: "Races" },
    { id: "myride", label: "My Ride" },
    { id: "crew", label: "Crew" },
    { id: "leaderboard", label: "Board" },
    { id: "comps", label: "Comps" },
  ];

  const crewBankPct = Math.min(100, ((profile?.crew_bank ?? 0) / 10000000) * 100);

  return (
    <div className={styles.page + " overflow-x-hidden"} style={{ minHeight: "100%", WebkitOverflowScrolling: "touch" }}>
      {/* ─── COMPACT HEADER ─── */}
      <div className="px-4 py-2.5 border-b border-[var(--noir-border)]" style={{ background: "rgba(201,164,96,.03)" }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base font-heading truncate" style={{ color: "var(--noir-primary)" }}>Bootleg Runs</h1>
            {profile?.team_name && (
              <span className="text-[10px] text-[var(--noir-muted)] truncate max-w-[140px] hidden sm:inline">
                <span style={{ color: profile?.team_color || "var(--noir-primary)" }}>&#9679;</span> {profile.team_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-[var(--noir-muted)]">Bank</span>
              <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(201,164,96,.12)", border: "1px solid rgba(201,164,96,.15)" }}>
                <div className="h-full rounded-full" style={{ width: `${crewBankPct}%`, background: "linear-gradient(90deg,#a87820,#e8c870)", transition: "width .5s" }} />
              </div>
              <span className="text-[10px] font-heading tabular-nums" style={{ color: "var(--noir-primary)" }}>{formatMoney(profile?.crew_bank ?? 0)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1 text-[9px] text-[var(--noir-muted)] flex-wrap">
          {leaderboard.slice(0, 3).map((row, i) => (
            <span key={row.user_id}>
              <span style={{ color: i === 0 ? "#e8c870" : i === 1 ? "#bbb" : "#c07a30", fontWeight: 700 }}>#{i + 1}</span>{" "}
              {row.username} ({row.wins}W)
            </span>
          ))}
          {profile?.racing_week_ends_utc && <span>Week: {formatRacingEndTime(profile.racing_week_ends_utc)}</span>}
          {profile?.racing_season_ends_utc && <span>Season: {formatRacingEndTime(profile.racing_season_ends_utc)}</span>}
        </div>
      </div>

      {/* ─── ACTIVE RACE: live run ─── */}
      {activeRace?.state === "running" && (
        <div className="p-3">
          {activeRace.qualifying_order?.length > 0 && (
            <p className="text-[10px] font-heading uppercase tracking-wider text-[var(--noir-primary)] mb-1.5">Live race — Grid by qualifying</p>
          )}
          <CircuitRaceView
            mode="live"
            raceId={activeRace.id}
            participants={activeRace.participants || []}
            qualifying_order={activeRace.qualifying_order || []}
            laps={activeRace.laps || 3}
            weather={activeRace.weather || "clear"}
            weather_name={activeRace.weather_name}
            initialTrackId={circuitTrackId}
            playerCarName={playerCarName}
            playerPitLevel={profile?.pit_level ?? 0}
            currentUserId={profile?.user_id}
            onComplete={() => handleCompleteRace(activeRace.id)}
            onReset={() => { setActiveRace(null); fetchOpenRaces(); }}
          />
        </div>
      )}

      {/* ─── POST-RACE RESULTS ─── */}
      {activeRace?.state === "completed" && (
        <div className={styles.panel + " m-3 overflow-hidden"}>
          <CardHead title="Race Results" />
          <div className="p-3">
            {activeRace.weather_name && (
              <p className="text-[10px] text-[var(--noir-muted)] mb-2">Weather: {activeRace.weather_name}</p>
            )}
            <ul className="space-y-0.5">
              {(activeRace.result_order || []).map((id, i) => {
                const p = (activeRace.participants || []).find((x) => (x.user_id || x.id) === id);
                const rew = (activeRace.rewards || []).find((r) => r.entrant_id === id);
                const isDnf = rew?.dnf || (activeRace.dnf_ids || []).includes(id);
                return (
                  <li key={id} className="flex items-center justify-between py-1.5 border-b border-[var(--noir-border)] last:border-0 text-xs">
                    <span>
                      <span className="font-heading mr-1" style={{ color: i === 0 ? "#e8c870" : i === 1 ? "#bbb" : i === 2 ? "#c07a30" : "var(--noir-muted)" }}>#{i + 1}</span>
                      {p?.username || p?.car_name || id}
                      {isDnf && <span className="text-red-400 font-heading ml-1.5">DNF</span>}
                    </span>
                    {rew && !isDnf && (
                      <span className="text-[10px] text-[var(--noir-muted)]">{formatMoney(rew.cash)} · {rew.rank_points}RP · {rew.racing_rep}rep</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" className={styles.btnPrimary + " mt-3 w-full min-h-[40px] touch-manipulation text-xs"}
              onClick={() => { setActiveRace(null); fetchProfile(); navigate("/racing", { replace: true }); }}>
              Back to races
            </button>
          </div>
        </div>
      )}

      {/* ─── TABS ─── */}
      <div className="flex border-b border-[var(--noir-border)] px-3 gap-1 overflow-x-auto overflow-y-hidden touch-pan-x" style={{ minHeight: 40, WebkitOverflowScrolling: "touch" }}>
        {tabs.map((t) => (
          <button key={t.id} type="button"
            className={"py-2 px-2.5 text-xs font-heading whitespace-nowrap flex-shrink-0 transition-colors " + (tab === t.id ? "border-b-2 text-[var(--noir-primary)]" : "text-[var(--noir-muted)]")}
            style={{ minHeight: 40, borderBottomColor: tab === t.id ? "var(--noir-primary)" : "transparent" }}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-3">

        {/* ─── RACES TAB ─── */}
        {tab === "races" && (
          <>
            {/* Automated race card */}
            <div className={styles.panel + " overflow-hidden mb-3"}>
              <CardHead title="Daily Automated Races" right={
                nextAutoRaceUtc && (() => {
                  const d = new Date(nextAutoRaceUtc);
                  const diffMs = d - new Date();
                  const diffH = Math.floor(diffMs / 3600000);
                  const diffM = Math.floor((diffMs % 3600000) / 60000);
                  const t = diffMs > 0 ? (diffH > 0 ? `${diffH}h ${diffM}m` : `${diffM}m`) : "soon";
                  return <span className="text-[10px] tabular-nums" style={{ color: "var(--noir-foreground)" }}>Next: {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ({t})</span>;
                })()
              } />
              <div className="p-3">
                <p className="text-[10px] text-[var(--noir-muted)] mb-2">Two races daily (08:00 & 20:00 UTC). All team owners auto-entered.</p>
                {latestAutomated ? (
                  <>
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <span style={{ color: "var(--noir-foreground)" }}>{latestAutomated.track_name}</span>
                      {latestAutomated.weather_name && <span className="text-[var(--noir-muted)]">{latestAutomated.weather_name}</span>}
                      {latestAutomated.completed_at && (
                        <span className="text-[9px] text-[var(--noir-muted)] ml-auto">
                          {(() => { const h = Math.round((new Date() - new Date(latestAutomated.completed_at)) / 3600000); return h < 1 ? "Just now" : h < 24 ? `${h}h ago` : new Date(latestAutomated.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }); })()}
                        </span>
                      )}
                    </div>
                    <Collapsible label="Latest result" count={(latestAutomated.result_order || []).length} defaultOpen={false}>
                      <div className="p-2 space-y-0.5">
                        {(latestAutomated.result_order || []).slice(0, 5).map((id, i) => {
                          const p = (latestAutomated.participants || []).find((x) => (x.user_id || x.id) === id);
                          const rew = (latestAutomated.rewards || []).find((r) => r.entrant_id === id);
                          const isDnf = rew?.dnf || (latestAutomated.dnf_ids || []).includes(id);
                          const isYou = id === profile?.user_id;
                          return (
                            <div key={id} className="flex items-center justify-between text-xs py-0.5">
                              <span style={{ color: isYou ? "var(--noir-primary)" : "var(--noir-foreground)", fontWeight: isYou ? 700 : 400 }}>
                                #{i + 1} {p?.username || p?.car_name || "?"}{isYou && " (you)"}{isDnf && <span className="text-red-400 ml-1">DNF</span>}
                              </span>
                              {rew && !isDnf && <span className="text-[9px] text-[var(--noir-muted)]">{formatMoney(rew.cash)} · {rew.rank_points}RP</span>}
                            </div>
                          );
                        })}
                      </div>
                    </Collapsible>
                  </>
                ) : (
                  <p className="text-xs text-[var(--noir-muted)]">No results yet. Get a team, car, and tyres.</p>
                )}
              </div>
            </div>

            {/* Create race */}
            <div className={styles.panel + " overflow-hidden mb-3"}>
              <CardHead title="Create Race" right={
                <span className="text-[9px] text-[var(--noir-muted)]">Grid by qualifying lap</span>
              } />
              <div className="p-3 space-y-3">
                {/* Track grid */}
                <div>
                  <div className="text-[9px] font-heading uppercase tracking-wider text-[var(--noir-muted)] mb-1">Track</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {TRACKS_FOR_CREATE.map((t) => {
                      const circuit = CIRCUIT_TRACKS.find((tr) => tr.id === t.circuitId);
                      const sel = createForm.circuitId === t.circuitId;
                      return (
                        <button key={t.circuitId} type="button"
                          onClick={() => setCreateForm((f) => ({ ...f, track_id: t.track_id, circuitId: t.circuitId }))}
                          className={`p-1.5 rounded border text-left transition-all touch-manipulation ${sel ? "border-[var(--noir-primary)] bg-[var(--noir-primary)]/10" : "border-[var(--noir-border)] bg-[var(--noir-surface)] hover:border-[var(--noir-muted)]"}`}>
                          <div className="w-full aspect-[2.2/1] rounded flex items-center justify-center mb-0.5 overflow-hidden" style={{ background: "var(--noir-surface)", border: "1px solid var(--noir-border)" }}>
                            {circuit ? <TrackThumb track={circuit} active={sel} /> : <span className="text-[7px] text-[var(--noir-muted)]">TRACK</span>}
                          </div>
                          <div className="font-heading text-[10px] truncate" style={{ color: "var(--noir-primary)" }}>{t.name}</div>
                          <div className="text-[8px] text-[var(--noir-muted)]">{t.km}km · {t.corners}T</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Conditions / Tyre / Laps — compact row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <div className="text-[9px] font-heading uppercase tracking-wider text-[var(--noir-muted)] mb-1">Conditions</div>
                    <div className="flex flex-wrap gap-1">
                      {WEATHER_OPTIONS.map((w) => (
                        <button key={w.id} type="button" onClick={() => setCreateForm((f) => ({ ...f, weather_id: w.id }))}
                          className={`flex items-center gap-1 px-1.5 py-1 rounded border text-[10px] font-heading touch-manipulation ${createForm.weather_id === w.id ? "border-[var(--noir-primary)] bg-[var(--noir-primary)]/15 text-[var(--noir-primary)]" : "border-[var(--noir-border)] bg-[var(--noir-surface)] text-[var(--noir-muted)]"}`}>
                          <span>{w.icon}</span><span>{w.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-heading uppercase tracking-wider text-[var(--noir-muted)] mb-1">Starting Tyre</div>
                    <div className="flex flex-wrap gap-1">
                      {TYRE_DEFS.map((td) => (
                        <button key={td.id} type="button" onClick={() => setCreateForm((f) => ({ ...f, tyre_compound: td.id }))}
                          className={`flex items-center gap-1 px-1.5 py-1 rounded border text-[10px] touch-manipulation ${createForm.tyre_compound === td.id ? "border-[var(--noir-primary)] bg-[var(--noir-primary)]/10" : "border-[var(--noir-border)] bg-[var(--noir-surface)]"}`}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: td.color }} />
                          <span style={{ color: "var(--noir-primary)" }}>{td.label}</span>
                          <span className="text-[8px] text-[var(--noir-muted)]">({effectiveTyreStock(td.id, profile)})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 items-end">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[9px] text-[var(--noir-muted)]">Laps</span>
                      <input type="number" min={2} max={20} value={createForm.laps}
                        onChange={(e) => setCreateForm((f) => ({ ...f, laps: Math.max(2, Math.min(20, Number(e.target.value) || 2)) }))}
                        className={styles.input + " w-12 text-xs font-heading"} />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[9px] text-[var(--noir-muted)]">Fee</span>
                      <input type="number" min={0} className={styles.input + " w-16 text-xs"} value={createForm.entry_fee}
                        onChange={(e) => setCreateForm((f) => ({ ...f, entry_fee: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[9px] text-[var(--noir-muted)]">Grid</span>
                      <input type="number" min={2} max={8} className={styles.input + " w-10 text-xs"} value={createForm.max_grid}
                        onChange={(e) => setCreateForm((f) => ({ ...f, max_grid: e.target.value }))} />
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-[var(--noir-border)]">
                  <button type="button" className="text-[10px] font-heading px-2 py-1 rounded border border-[var(--noir-border)] hover:bg-[var(--noir-primary)]/10 touch-manipulation"
                    onClick={() => setCreateForm((f) => ({ ...f, weather_id: WEATHER_OPTIONS[Math.floor(Math.random() * WEATHER_OPTIONS.length)].id }))}>
                    Random weather
                  </button>
                  <button type="button" className={styles.btnPrimary + " min-h-[34px] text-xs touch-manipulation px-3 py-1"}
                    disabled={creating || !createForm.track_id || !selectedInstanceId || (cars.find((c) => c.id === selectedInstanceId)?.engine_wear ?? 0) >= 100 || (effectiveTyreStock(createForm.tyre_compound, profile) < 1)}
                    onClick={handleCreateRace}>
                    {creating ? "Creating…" : "Create race"}
                  </button>
                </div>
                {(cars.find((c) => c.id === selectedInstanceId)?.engine_wear ?? 0) >= 100 && (
                  <p className="text-[10px] text-amber-400">Engine at 100% wear — repair in My Ride.</p>
                )}
                {effectiveTyreStock(createForm.tyre_compound, profile) < 1 && (
                  <p className="text-[10px] text-amber-400">No {createForm.tyre_compound} tyres — buy in My Ride.</p>
                )}
                {!selectedInstanceId && <p className="text-[10px] text-amber-400">Select a car in My Ride first.</p>}
              </div>
            </div>

            {/* Active open race */}
            {activeRace?.state === "open" && (
              <div className={styles.panel + " p-3 mb-3"}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-heading text-xs" style={{ color: "var(--noir-primary)" }}>{activeRace.track_name}</span>
                    <span className="text-[10px] text-[var(--noir-muted)] ml-2">
                      {activeRace.participants?.length ?? 0}/{activeRace.max_grid} · {formatMoney(activeRace.entry_fee)} entry
                    </span>
                  </div>
                  {canStartRace && (
                    <button type="button" className={styles.btnPrimary + " text-xs min-h-[32px] touch-manipulation py-1 px-2"}
                      onClick={() => handleStartRace(activeRace)}>Start (fill NPCs)</button>
                  )}
                </div>
              </div>
            )}

            {/* Open races */}
            <div className={styles.panel + " overflow-hidden"}>
              <CardHead title="Open Races" right={
                <select className={styles.input + " text-[10px] py-0.5 w-24"} value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}>
                  <option value="all">All</option>
                  {TRACKS_FOR_CREATE.map(t => <option key={t.circuitId} value={t.track_id}>{t.name}</option>)}
                </select>
              } />
              <div className="p-3">
                <div className="flex flex-wrap items-center gap-1 mb-2">
                  <span className="text-[9px] text-[var(--noir-muted)]">Tyre:</span>
                  {TYRE_DEFS.map((td) => {
                    const stock = effectiveTyreStock(td.id, profile);
                    return (
                      <button key={td.id} type="button" onClick={() => setJoinTyre(td.id)}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border touch-manipulation"
                        style={{
                          borderColor: joinTyre === td.id ? "var(--noir-primary)" : "var(--noir-border)",
                          background: joinTyre === td.id ? "rgba(201,164,96,.1)" : "transparent",
                          color: joinTyre === td.id ? "var(--noir-foreground)" : "var(--noir-muted)",
                        }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: td.color }} />
                        {td.label}
                        <span style={{ fontSize: 8, color: stock < 1 ? "#e74c3c" : "var(--noir-muted)" }}>({stock})</span>
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const filtered = trackFilter === "all" ? openRaces : openRaces.filter(r => r.track_id === trackFilter);
                  return filtered.length === 0 ? (
                    <p className="text-xs text-[var(--noir-muted)]">No open races. Create one above.</p>
                  ) : (
                    <div className="space-y-1">
                      {filtered.map((race) => (
                        <div key={race.id} className="flex items-center justify-between p-2 rounded border border-[var(--noir-border)] bg-[var(--noir-surface)]">
                          <div className="min-w-0">
                            <span className="font-heading text-xs">{race.track_name}</span>
                            <span className="text-[10px] text-[var(--noir-muted)] ml-1.5">
                              {race.participants?.length ?? 0}/{race.max_grid} · {formatMoney(race.entry_fee)}
                              {(race.weather_name || race.weather) && ` · ${race.weather_name ?? WEATHER_OPTIONS.find((w) => w.id === race.weather)?.name ?? race.weather}`}
                            </span>
                          </div>
                          <button type="button" className={styles.btnPrimary + " text-[10px] min-h-[32px] touch-manipulation px-2 py-0.5 flex-shrink-0"}
                            disabled={joiningId === race.id || !selectedInstanceId || race.participants?.some((p) => p.user_id === profile?.user_id) || (cars.find((c) => c.id === selectedInstanceId)?.engine_wear ?? 0) >= 100 || effectiveTyreStock(joinTyre, profile) < 1}
                            onClick={() => handleJoinRace(race, selectedInstanceId, joinTyre === "full_wet" ? "inter" : joinTyre)}>
                            {joiningId === race.id ? "…" : "Join"}
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </>
        )}

        {/* ─── MY RIDE TAB ─── */}
        {tab === "myride" && (
          <>
            {/* Tyre stock — inline badges */}
            <div className={styles.panel + " overflow-hidden mb-3"}>
              <CardHead title="Tyre Stock" right={<span className="text-[9px] text-[var(--noir-muted)]">1 set / race · crew bank</span>} />
              <div className="p-3 flex flex-wrap gap-2">
                {["soft", "medium", "hard", "inter"].map((compound) => {
                  const stock = profile?.[`tyre_stock_${compound}`] ?? 0;
                  const cost = profile?.tyre_costs?.[compound] ?? 500;
                  const bank = profile?.crew_bank ?? 0;
                  const name = compound === "inter" ? "Inter" : compound.charAt(0).toUpperCase() + compound.slice(1);
                  const col = TYRE_DEFS.find(t => t.id === compound)?.color || "#ccc";
                  return (
                    <div key={compound} className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-[var(--noir-border)] bg-[var(--noir-surface)]">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col }} />
                      <span className="text-[10px] font-heading" style={{ color: "var(--noir-primary)" }}>{name}</span>
                      <span className="text-xs font-heading tabular-nums">{stock}</span>
                      <button type="button" className={styles.btnGoldDarkText + " text-[9px] px-1.5 py-0.5"} disabled={bank < cost} onClick={() => handleBuyTyres(compound, 1)}>+1</button>
                      <button type="button" className={styles.btnGoldDarkText + " text-[9px] px-1.5 py-0.5"} disabled={bank < cost * 5} onClick={() => handleBuyTyres(compound, 5)}>+5</button>
                      <span className="text-[8px] text-[var(--noir-muted)]">{formatMoney(cost)}/ea</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Car cards */}
            {cars.length === 0 ? (
              <div className={styles.panel + " p-3 mb-3"}>
                <p className="text-xs text-[var(--noir-muted)]">Choose a car below.</p>
              </div>
            ) : (
              cars.map((c) => {
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
                const globalCap = profile?.global_upgrade_cap ?? 18;
                const levelsUsed = c.upgrade_levels_used ?? (engine + tires + aero + reliability + (championship ? 1 : 0) + brakes + gearbox + cooling + weight + fuel);
                const atGlobalCap = levelsUsed >= globalCap;
                const bank = profile?.crew_bank ?? 0;

                const levelMap = { engine, tires, aero, reliability, brakes, gearbox, cooling, weight, fuel };
                const maxMap = {
                  engine: upgradeTradeoffs?.engine?.max ?? 4,
                  tires: upgradeTradeoffs?.tires?.max ?? 4,
                  aero: upgradeTradeoffs?.aero?.max ?? 2,
                  reliability: upgradeTradeoffs?.reliability?.max ?? 2,
                  brakes: upgradeTradeoffs?.brakes?.max ?? 3,
                  gearbox: upgradeTradeoffs?.gearbox?.max ?? 3,
                  cooling: upgradeTradeoffs?.cooling?.max ?? 2,
                  weight: upgradeTradeoffs?.weight?.max ?? 2,
                  fuel: upgradeTradeoffs?.fuel?.max ?? 2,
                };

                const nextETCost = carUpgradeCosts[engine + tires + 1] ?? carUpgradeCosts[carUpgradeCosts.length - 1];
                const repairCost = Math.round((c.engine_wear ?? 0) * (profile?.engine_repair_cost_per_pct ?? 400));

                const getUpgradeCost = (key) => {
                  if (key === "engine" || key === "tires") return nextETCost ?? 0;
                  if (key === "championship") return upgradeTradeoffs?.championship?.cost ?? 350000;
                  const base = upgradeTradeoffs?.[key]?.cost_base ?? 30000;
                  return base * (levelMap[key] + 1);
                };

                const canUnlock = (m) => {
                  if (!m.winsNeeded) return true;
                  return wins >= m.winsNeeded;
                };

                return (
                  <div key={c.id} className={styles.panel + " overflow-hidden mb-3"}>
                    <CardHead title={c.car_name || c.racing_car_id} right={
                      <button type="button" className={styles.btnPrimary + " text-[9px] px-2 py-0.5"} disabled={selectedInstanceId === c.id} onClick={() => handleSelectCar(c.id)}>
                        {selectedInstanceId === c.id ? "Active" : "Select"}
                      </button>
                    } />
                    <div className="p-3 space-y-3">
                      {/* Stats + Engine wear */}
                      <div className="flex gap-3">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <div className="p-2 rounded bg-black/20 text-center">
                            <div className="text-[9px] font-heading uppercase text-[var(--noir-muted)]">Speed</div>
                            <div className="text-lg font-heading" style={{ color: "var(--noir-primary)" }}>{c.effective_speed ?? 0}</div>
                          </div>
                          <div className="p-2 rounded bg-black/20 text-center">
                            <div className="text-[9px] font-heading uppercase text-[var(--noir-muted)]">Grip</div>
                            <div className="text-lg font-heading" style={{ color: "var(--noir-primary)" }}>{c.effective_grip ?? 0}%</div>
                          </div>
                        </div>
                        <div className="w-28 flex flex-col justify-center">
                          <div className="text-[9px] font-heading uppercase text-[var(--noir-muted)] mb-0.5">Engine</div>
                          <div className="h-3 rounded-full bg-[var(--noir-border)] overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{
                              width: `${Math.min(100, c.engine_wear ?? 0)}%`,
                              backgroundColor: (c.engine_wear ?? 0) >= 100 ? "#dc2626" : (c.engine_wear ?? 0) >= 75 ? "#f59e0b" : "#22c55e",
                            }} />
                          </div>
                          <span className="text-[10px] font-heading tabular-nums mt-0.5" style={{ color: (c.engine_wear ?? 0) >= 75 ? "#f59e0b" : "var(--noir-muted)" }}>
                            {(c.engine_wear ?? 0).toFixed(0)}% wear
                          </span>
                          {(c.engine_wear ?? 0) > 0 && (
                            <div className="flex gap-1 mt-1">
                              <button type="button" className={styles.btnGoldDarkText + " text-[8px] px-1 py-0.5"}
                                disabled={!profile?.free_engine_repair_available && bank < repairCost}
                                onClick={() => handleRepairEngine(c.id)}>
                                {profile?.free_engine_repair_available ? "Free fix" : `Fix ${formatMoney(repairCost)}`}
                              </button>
                              <button type="button" className={styles.btnGoldDarkText + " text-[8px] px-1 py-0.5"}
                                disabled={bank < (profile?.engine_replace_cost ?? 75000)}
                                onClick={() => handleReplaceEngine(c.id)}>
                                New {formatMoney(profile?.engine_replace_cost ?? 75000)}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Upgrade bars — progressive disclosure */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-heading uppercase text-[var(--noir-muted)]">Upgrades</span>
                          <span className="text-[10px] font-heading" style={{ color: atGlobalCap ? "#f59e0b" : "var(--noir-primary)" }}>{levelsUsed}/{globalCap}</span>
                        </div>
                        <div className="space-y-1">
                          {UPGRADE_META.filter(m => canUnlock(m) || levelMap[m.key] > 0).map((m) => {
                            const lv = levelMap[m.key];
                            const mx = maxMap[m.key];
                            const pct = mx > 0 ? (lv / mx) * 100 : 0;
                            const cost = getUpgradeCost(m.key);
                            const maxed = lv >= mx;
                            return (
                              <div key={m.key} className="flex items-center gap-2">
                                <span className="text-[9px] w-12 text-[var(--noir-muted)] truncate">{m.label}</span>
                                <div className="flex-1 h-1.5 rounded-full bg-[var(--noir-border)] overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color, transition: "width .4s" }} />
                                </div>
                                <span className="text-[9px] tabular-nums w-8 text-right" style={{ color: "var(--noir-primary)" }}>{lv}/{mx}</span>
                                {!maxed && !atGlobalCap && (
                                  <button type="button" className={styles.btnGoldDarkText + " text-[8px] px-1.5 py-0.5 flex-shrink-0"}
                                    disabled={bank < cost} onClick={() => handleUpgradeCar(c.id, m.key)}>
                                    +{formatMoney(cost)}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                          {wins >= 3 && !championship && (
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] w-12 text-amber-500 truncate">Champ</span>
                              <span className="text-[9px] text-[var(--noir-muted)] flex-1">+2% speed & grip</span>
                              <button type="button" className={styles.btnGoldDarkText + " text-[8px] px-1.5 py-0.5"}
                                disabled={atGlobalCap || bank < (upgradeTradeoffs?.championship?.cost ?? 350000)}
                                onClick={() => handleUpgradeCar(c.id, "championship")}>
                                {formatMoney(upgradeTradeoffs?.championship?.cost ?? 350000)}
                              </button>
                            </div>
                          )}
                          {championship && <span className="text-[9px] text-amber-500 font-heading">Championship ✓</span>}
                        </div>
                      </div>

                      {/* Trade-offs — collapsed */}
                      {upgradeTradeoffs && (
                        <Collapsible label="How trade-offs work" defaultOpen={false}>
                          <div className="p-3 space-y-1 text-[10px]">
                            {Object.entries(upgradeTradeoffs).map(([key, val]) => (
                              <div key={key} className="flex gap-1.5">
                                <span className="font-heading capitalize w-14" style={{ color: UPGRADE_META.find(m => m.key === key)?.color || "var(--noir-primary)" }}>{key}</span>
                                <span className="text-green-500">{val.positive}</span>
                                {val.negative && <span className="text-red-400">{val.negative}</span>}
                                {val.unlock && <span className="text-[var(--noir-muted)]">({val.unlock})</span>}
                              </div>
                            ))}
                          </div>
                        </Collapsible>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* Car selection — compact */}
            <div className={styles.panel + " overflow-hidden"}>
              <CardHead title="Choose Car" />
              <div className="p-3 space-y-1">
                {availableCars.map((car) => {
                  const isSelected = cars.some((c) => c.racing_car_id === car.id);
                  return (
                    <div key={car.id} className="flex items-center justify-between py-1.5 border-b border-[var(--noir-border)] last:border-0">
                      <div>
                        <span className="font-heading text-xs">{car.name}</span>
                        <span className="text-[10px] text-[var(--noir-muted)] ml-1.5">
                          Spd {car.base_speed ?? "—"} · Grip {car.base_grip != null ? (car.base_grip * 100).toFixed(0) + "%" : "—"}
                        </span>
                      </div>
                      <button type="button" className={styles.btnPrimary + " text-[9px] px-2 py-0.5"} disabled={isSelected}
                        onClick={() => handleSelectCarByType(car.id)}>
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
          <div className={styles.panel + " overflow-hidden"}>
            <CardHead title="Crew Upgrades" right={
              <span className="text-[10px] tabular-nums" style={{ color: "var(--noir-primary)" }}>
                Bank: {formatMoney(profile?.crew_bank ?? 0)} · Levels: {profile?.crew_levels_used ?? 0}/{profile?.crew_global_cap ?? 24}
              </span>
            } />
            <div className="p-3">
              <p className="text-[10px] text-[var(--noir-muted)] mb-3">+2% speed/level. Pit Crew also shortens pit time. Total levels capped.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {(() => {
                  const tradeoffs = profile?.crew_tradeoffs || {};
                  const types = ["mechanic", "pit", ...(Object.keys(tradeoffs).filter((k) => !["mechanic", "pit"].includes(k)))];
                  const atCap = (profile?.crew_levels_used ?? 0) >= (profile?.crew_global_cap ?? 24);
                  return types.map((type) => {
                    const t = tradeoffs[type];
                    if (!t) return null;
                    const key = type === "mechanic" ? "mechanic_level" : type === "pit" ? "pit_level" : `${type}_level`;
                    const level = profile?.[key] ?? 0;
                    const max = t.max ?? 5;
                    const maxed = level >= max;
                    const nextCost = t.costs ? (level < max && t.costs[level + 1] != null ? t.costs[level + 1] : 0) : (t.cost_base ? t.cost_base * (level + 1) : 0);
                    const canAfford = (profile?.crew_bank ?? 0) >= nextCost;
                    return (
                      <div key={type} className="p-2.5 rounded border border-[var(--noir-border)] bg-[var(--noir-surface)]">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-heading text-xs" style={{ color: maxed ? "var(--noir-muted)" : "var(--noir-primary)" }}>{t.label || type}</span>
                          <span className="text-[10px] font-heading tabular-nums" style={{ color: "var(--noir-primary)" }}>{level}/{max}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[var(--noir-border)] overflow-hidden mb-1.5">
                          <div className="h-full rounded-full bg-amber-600" style={{ width: `${max > 0 ? (level / max) * 100 : 0}%`, transition: "width .4s" }} />
                        </div>
                        <p className="text-[9px] text-[var(--noir-muted)] mb-1.5">{t.desc}</p>
                        {!maxed && (
                          <button type="button" className={styles.btnGoldDarkText + " text-[9px] w-full py-1"}
                            disabled={atCap || !canAfford} onClick={() => handleUpgradeCrew(type)}>
                            Upgrade ({formatMoney(nextCost)})
                          </button>
                        )}
                        {maxed && <span className="text-[9px] text-[var(--noir-muted)]">Maxed</span>}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ─── LEADERBOARD TAB ─── */}
        {tab === "leaderboard" && (
          <div className={styles.panel + " overflow-hidden"}>
            <CardHead title="Racing Leaderboard" />
            <div className="p-3">
              {leaderboard.length === 0 ? (
                <p className="text-xs text-[var(--noir-muted)]">No results yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--noir-border)]">
                      <th className="text-left py-1.5 pr-2 text-[10px] font-heading uppercase text-[var(--noir-muted)]">#</th>
                      <th className="text-left py-1.5 text-[10px] font-heading uppercase text-[var(--noir-muted)]">Player</th>
                      <th className="text-right py-1.5 px-1 text-[10px] font-heading uppercase text-[var(--noir-muted)]">W</th>
                      <th className="text-right py-1.5 px-1 text-[10px] font-heading uppercase text-[var(--noir-muted)]">Rep</th>
                      <th className="text-right py-1.5 text-[10px] font-heading uppercase text-[var(--noir-muted)]">Races</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((row) => {
                      const isYou = row.user_id === profile?.user_id;
                      const pos = row.rank;
                      return (
                        <tr key={row.user_id} className="border-b border-[var(--noir-border)]"
                          style={{ background: isYou ? "rgba(201,164,96,.06)" : pos === 1 ? "rgba(201,164,96,.03)" : "transparent" }}>
                          <td className="py-1.5 pr-2">
                            <span className="font-heading" style={{ color: pos === 1 ? "#e8c870" : pos === 2 ? "#bbb" : pos === 3 ? "#c07a30" : "var(--noir-muted)" }}>{pos}</span>
                          </td>
                          <td className="py-1.5" style={{ color: isYou ? "var(--noir-primary)" : "var(--noir-foreground)" }}>
                            {row.username}{isYou && <span className="text-[9px] ml-1" style={{ color: "var(--noir-primary)" }}>(You)</span>}
                          </td>
                          <td className="py-1.5 px-1 text-right tabular-nums">{row.wins}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums">{row.racing_rep}</td>
                          <td className="py-1.5 text-right tabular-nums">{row.races_completed}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ─── COMPS TAB ─── */}
        {tab === "comps" && (
          <div className={styles.panel + " overflow-hidden"}>
            <CardHead title="Race Competitions" />
            <div className="p-3">
              {comps.length === 0 ? (
                <p className="text-xs text-[var(--noir-muted)]">No active competitions.</p>
              ) : (
                <div className="space-y-1">
                  {comps.map((comp) => (
                    <div key={comp.id} className="flex items-center justify-between py-1.5 border-b border-[var(--noir-border)] last:border-0">
                      <div>
                        <span className="font-heading text-xs">{comp.name || comp.track_id || "Competition"}</span>
                        <span className="text-[10px] text-[var(--noir-muted)] ml-1.5">
                          {formatMoney(comp.entry_fee)} · Ends {comp.end_at ? new Date(comp.end_at).toLocaleDateString() : "—"}
                        </span>
                      </div>
                      <button type="button" className={styles.btnPrimary + " text-[9px] px-2 py-0.5"} disabled={!selectedInstanceId}
                        onClick={() => handleEnterComp(comp.id, selectedInstanceId)}>Enter</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
