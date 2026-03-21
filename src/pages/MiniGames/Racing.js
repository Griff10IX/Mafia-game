import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import api, { refreshUser } from "../../utils/api";
import { getApiErrorMessage } from "../../utils/api";
import styles from "../../styles/noir.module.css";
import CircuitRaceView, { TRACKS as CIRCUIT_TRACKS, TrackThumb } from "./CircuitRaceView";

const TRACK_ID_MAP = {
  chicago_board: "chicago",
  daytona_beach: "daytona",
  roosevelt: "roosevelt",
  indianapolis: "indianapolis",
  boardwalk: "boardwalk",
  lakeside: "lakeside",
  harbor: "harbor",
  mountain: "mountain",
  brooklands: "brooklands",
  monza: "monza",
  lemans: "lemans",
  avus: "avus",
  targa: "targa",
};

const TRACKS_FOR_CREATE = [
  { circuitId: "chicago", track_id: "chicago_board", name: "Chicago Board Track", km: 2.4, corners: 8 },
  { circuitId: "daytona", track_id: "daytona_beach", name: "Daytona Beach", km: 3.6, corners: 4 },
  { circuitId: "indianapolis", track_id: "indianapolis", name: "Indianapolis Motor Speedway", km: 4.0, corners: 4 },
  { circuitId: "roosevelt", track_id: "roosevelt", name: "Roosevelt Raceway", km: 2.1, corners: 12 },
  { circuitId: "boardwalk", track_id: "boardwalk", name: "Boardwalk Circuit", km: 3.4, corners: 22 },
  { circuitId: "lakeside", track_id: "lakeside", name: "Lakeside Park", km: 3.8, corners: 14 },
  { circuitId: "harbor", track_id: "harbor", name: "Harbor Front", km: 3.0, corners: 24 },
  { circuitId: "mountain", track_id: "mountain", name: "Mountain Pass", km: 4.8, corners: 22 },
  { circuitId: "brooklands", track_id: "brooklands", name: "Brooklands Banking", km: 6.4, corners: 8 },
  { circuitId: "monza", track_id: "monza", name: "Monza Autodromo", km: 8.0, corners: 14 },
  { circuitId: "lemans", track_id: "lemans", name: "Le Mans Sarthe", km: 10.7, corners: 16 },
  { circuitId: "avus", track_id: "avus", name: "AVUS Speedway", km: 12.0, corners: 4 },
  { circuitId: "targa", track_id: "targa", name: "Targa Florio", km: 14.5, corners: 32 },
];

const WEATHER_OPTIONS = [
  { id: "clear", name: "Clear", icon: "☀️" },
  { id: "night", name: "Night", icon: "🌙" },
  { id: "rain", name: "Rain", icon: "🌧️" },
  { id: "snow", name: "Snow", icon: "❄️" },
  { id: "very_hot", name: "Very Hot", icon: "🔥" },
];
const WEATHER_ID_FOR_API = (id) => id;

function effectiveTyreStock(compound, profile) {
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

function LiveCountdown({ deadline }) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    const tick = () => {
      const dl = new Date(deadline);
      const now = new Date();
      const diff = Math.max(0, Math.ceil((dl - now) / 1000));
      setRemaining(diff > 0 ? `${diff}s` : "Advancing...");
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [deadline]);
  return <span className="text-xs font-heading tabular-nums px-2 py-1 rounded bg-black/30 border border-[var(--noir-border)]" style={{ color: "var(--noir-primary)" }}>{remaining}</span>;
}

function RndCountdown({ completes_at, onComplete }) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    const tick = () => {
      const target = new Date(completes_at);
      const now = new Date();
      const diff = Math.max(0, target - now);
      if (diff <= 0) { setRemaining("Complete!"); onComplete?.(); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${s}s`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [completes_at, onComplete]);
  return <span className="text-xs font-heading tabular-nums px-2 py-1 rounded bg-black/30 border border-[var(--noir-border)]" style={{ color: "var(--noir-primary)" }}>{remaining}</span>;
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
  const [createForm, setCreateForm] = useState({ track_id: "", circuitId: "", entry_fee: 0, max_grid: 6, laps: 3, tyre_compound: "medium", weather_id: "clear", interactive: true });
  const [teamCreateName, setTeamCreateName] = useState("");
  const [teamCreateColor, setTeamCreateColor] = useState("#e8d020");
  const [teamCreating, setTeamCreating] = useState(false);
  const [latestAutomated, setLatestAutomated] = useState(_cached?.latestAutomated ?? null);
  const [nextAutoRaceUtc, setNextAutoRaceUtc] = useState(_cached?.nextAutoRaceUtc ?? null);
  const [raceBets, setRaceBets] = useState({ open: [], settled: [] });
  const [raceHistory, setRaceHistory] = useState([]);
  const [seasonStats, setSeasonStats] = useState(null);
  const [trackRecords, setTrackRecords] = useState({});
  const [betOdds, setBetOdds] = useState(null);
  const [bettingRaceId, setBettingRaceId] = useState(null);
  const [betStake, setBetStake] = useState("");
  const [betEntrant, setBetEntrant] = useState("");
  const [placingBet, setPlacingBet] = useState(false);
  const [challenges, setChallenges] = useState({ incoming: [], outgoing: [], completed: [] });
  const [challengeForm, setChallengeForm] = useState({ target_username: "", track_id: "", stake: 0, laps: 3, weather_id: "clear" });
  const [challengeCreating, setChallengeCreating] = useState(false);
  const [driverMarket, setDriverMarket] = useState([]);
  const [myDriver, setMyDriver] = useState(null);
  const [driverLoading, setDriverLoading] = useState(false);
  const [liveRace, setLiveRace] = useState(null);
  /** Leader completed laps from canvas SF crossings; null = not yet reported (show server lap). */
  const [interactiveLeaderLap, setInteractiveLeaderLap] = useState(null);
  /** Fractional race distance from canvas (matches CircuitRaceView race bar). */
  const [interactiveRaceProg, setInteractiveRaceProg] = useState(null);
  const [myDecision, setMyDecision] = useState({ push_level: 3, pit_this_lap: false, pit_compound: "medium", defend: false });
  const [decisionSyncPending, setDecisionSyncPending] = useState(false);
  const lastSentDecisionKey = useRef(null);
  const prevLiveLapRef = useRef(undefined);
  const [rndTree, setRndTree] = useState(null);
  const [rndActive, setRndActive] = useState(null);
  const [rndResearching, setRndResearching] = useState(false);
  const [championship, setChampionship] = useState(null);
  const [champStandings, setChampStandings] = useState(null);
  const [champView, setChampView] = useState("calendar");
  const [isAdmin, setIsAdmin] = useState(false);
  const liveRacePoll = useRef(null);
  const refreshTimer = useRef(null);

  const applyProfile = useCallback((d) => {
    const p = {
      ...(d.profile || {}),
      tyre_stock_soft: d.tyre_stock_soft,
      tyre_stock_medium: d.tyre_stock_medium,
      tyre_stock_hard: d.tyre_stock_hard,
      tyre_stock_inter: d.tyre_stock_inter,
      tyre_stock_full_wet: d.tyre_stock_full_wet,
      tyre_costs: d.tyre_costs || {},
      engine_repair_cost_per_pct: d.engine_repair_cost_per_pct,
      engine_replace_cost: d.engine_replace_cost,
      racing_team_create_cost: d.racing_team_create_cost,
      racing_team_count: d.racing_team_count,
      max_racing_teams: d.max_racing_teams,
      racing_week_ends_utc: d.racing_week_ends_utc,
      racing_season_ends_utc: d.racing_season_ends_utc,
      global_upgrade_cap: d.global_upgrade_cap ?? 26,
      free_engine_repair_available: !!d.free_engine_repair_available,
      crew_bank_debt_limit: d.crew_bank_debt_limit ?? -50000,
      crew_levels_used: d.crew_levels_used ?? 0,
      crew_global_cap: d.crew_global_cap ?? 24,
      crew_tradeoffs: d.crew_tradeoffs || null,
      sponsor: d.sponsor || null,
      sponsor_tiers: d.sponsor_tiers || [],
      racing_rep: d.profile?.racing_rep ?? 0,
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

  const fetchDriverMarket = useCallback(async () => {
    try {
      const { data } = await api.get("/racing/drivers/market");
      setDriverMarket(data.drivers || []);
    } catch {}
  }, []);

  const fetchMyDriver = useCallback(async () => {
    try {
      const { data } = await api.get("/racing/drivers/mine");
      setMyDriver(data.driver || null);
    } catch {}
  }, []);

  const fetchRndTree = useCallback(async () => {
    try {
      const { data } = await api.get("/racing/rnd/tree");
      // Backend returns { tree, active_research, researched } — not "paths"
      setRndTree(data.tree || null);
      setRndActive(data.active_research || null);
    } catch {}
  }, []);

  const fetchChampionship = useCallback(async () => {
    try {
      const { data } = await api.get("/racing/championship");
      setChampionship(data);
    } catch {}
  }, []);

  const fetchChampStandings = useCallback(async () => {
    try {
      const { data } = await api.get("/racing/championship/standings");
      setChampStandings(data);
    } catch {}
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
      fetchMyDriver();
      api.get("/admin/check").then(r => setIsAdmin(!!r.data?.is_admin)).catch(() => {});

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
  }, [applyProfile, fetchMyDriver]);

  const fetchProfile = useCallback(async () => {
    try {
      const r = await api.get("/racing/profile");
      applyProfile(r.data || {});
    } catch (e) { toast.error(apiDetail(e)); }
  }, [applyProfile]);

  const fetchOpenRaces = useCallback(async () => {
    try { const r = await api.get("/racing/races/open"); setOpenRaces(r.data?.races || []); } catch {}
  }, []);

  const fetchBets = useCallback(async () => {
    try { const r = await api.get("/racing/bets"); setRaceBets(r.data || { open: [], settled: [] }); } catch {}
  }, []);

  const fetchHistory = useCallback(async () => {
    try { const r = await api.get("/racing/history"); setRaceHistory(r.data?.history || []); } catch {}
  }, []);

  const fetchSeasonStats = useCallback(async () => {
    try { const r = await api.get("/racing/season-stats"); setSeasonStats(r.data?.season_stats || null); } catch {}
  }, []);

  const fetchTrackRecords = useCallback(async () => {
    try { const r = await api.get("/racing/records"); setTrackRecords(r.data?.records || {}); } catch {}
  }, []);

  const fetchBetOdds = useCallback(async (raceId) => {
    try { const r = await api.get(`/racing/races/${raceId}/odds`); setBetOdds(r.data); } catch {}
  }, []);

  const fetchChallenges = useCallback(async () => {
    try { const r = await api.get("/racing/challenges"); setChallenges(r.data || { incoming: [], outgoing: [], completed: [] }); } catch {}
  }, []);

  const handleCreateChallenge = useCallback(async () => {
    if (!challengeForm.target_username || !challengeForm.track_id) { toast.error("Fill in target and track"); return; }
    setChallengeCreating(true);
    try {
      const r = await api.post("/racing/challenges/create", challengeForm);
      toast.success(r.data?.message || "Challenge sent");
      setChallengeForm(f => ({ ...f, target_username: "" }));
      fetchChallenges();
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setChallengeCreating(false); }
  }, [challengeForm, fetchChallenges]);

  const handleAcceptChallenge = useCallback(async (id) => {
    try {
      const r = await api.post(`/racing/challenges/${id}/accept`);
      toast.success(r.data?.message || "Race is live!");
      if (r.data?.race) {
        setActiveRace(r.data.race);
        setTab("races");
        navigate(`/casino/mini-games/racing?race=${r.data.race_id || r.data.race?.id}`, { replace: true });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      fetchChallenges();
    } catch (e) { toast.error(apiDetail(e)); }
  }, [fetchChallenges, navigate]);

  const handleAdminWipeTeams = async () => {
    if (!window.confirm("ADMIN: This will permanently delete ALL racing teams, cars, upgrades, races, championships, and data. Continue?")) return;
    try {
      const r = await api.post("/racing/admin/wipe-all-teams");
      const d = r.data?.deleted || {};
      toast.success(`Wiped: ${d.profiles ?? 0} profiles, ${d.cars ?? 0} cars, ${d.races ?? 0} races, ${d.championships ?? 0} championships`);
      fetchAll();
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const handleAdminClearCrewBankDebt = async () => {
    if (!window.confirm("ADMIN: Set every negative crew bank to $0? (Positive balances unchanged.)")) return;
    try {
      const r = await api.post("/racing/admin/clear-crew-bank-debt");
      toast.success(r.data?.message || `Updated ${r.data?.modified_count ?? 0} profile(s)`);
      fetchAll();
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const handleDeclineChallenge = useCallback(async (id) => {
    try {
      await api.post(`/racing/challenges/${id}/decline`);
      toast.success("Challenge declined");
      fetchChallenges();
    } catch (e) { toast.error(apiDetail(e)); }
  }, [fetchChallenges]);

  const handlePlaceBet = useCallback(async () => {
    if (!bettingRaceId || !betEntrant || !betStake) return;
    setPlacingBet(true);
    try {
      const r = await api.post("/racing/bets/place", { race_id: bettingRaceId, entrant_id: betEntrant, stake: Number(betStake) });
      toast.success(r.data?.message || "Bet placed");
      setBetStake(""); setBetEntrant(""); setBettingRaceId(null); setBetOdds(null);
      fetchBets();
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setPlacingBet(false); }
  }, [bettingRaceId, betEntrant, betStake, fetchBets]);

  const handleHireDriver = async (driverId) => {
    setDriverLoading(true);
    try {
      await api.post("/racing/drivers/hire", { driver_id: driverId });
      toast.success("Driver hired!");
      fetchDriverMarket();
      fetchMyDriver();
      fetchAll();
    } catch (e) { toast.error(apiDetail(e)); }
    setDriverLoading(false);
  };

  const handleFireDriver = async () => {
    setDriverLoading(true);
    try {
      await api.post("/racing/drivers/fire", {});
      toast.success("Driver released");
      fetchDriverMarket();
      fetchMyDriver();
    } catch (e) { toast.error(apiDetail(e)); }
    setDriverLoading(false);
  };

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

  const RACING_ACTIVE_RACE_KEY = "racing_active_race_id";

  useEffect(() => {
    if (activeRace?.state === "running") {
      try {
        sessionStorage.setItem(RACING_ACTIVE_RACE_KEY, activeRace.id);
        localStorage.setItem(RACING_ACTIVE_RACE_KEY, activeRace.id);
      } catch (_) {}
    } else {
      try {
        sessionStorage.removeItem(RACING_ACTIVE_RACE_KEY);
        localStorage.removeItem(RACING_ACTIVE_RACE_KEY);
      } catch (_) {}
    }
  }, [activeRace?.state, activeRace?.id]);

  useEffect(() => {
    const restoreOrFetchByParam = async (id) => {
      try {
        const r = await api.get(`/racing/races/${id}`);
        const race = r.data?.race;
        if (race?.state === "open" || race?.state === "completed" || race?.state === "running") {
          setActiveRace((prev) => {
            if (prev?.id === race.id && prev?.state === "running" && race.state === "running") {
              if ((prev.qualifying_order?.length ?? 0) > 0) return prev;
            }
            return race;
          });
          setTab("races");
        }
      } catch (_) {}
    };
    if (raceIdParam) {
      restoreOrFetchByParam(raceIdParam);
      return;
    }
    const fromSession = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(RACING_ACTIVE_RACE_KEY) : null;
    const fromLocal = typeof localStorage !== "undefined" ? localStorage.getItem(RACING_ACTIVE_RACE_KEY) : null;
    const storedId = fromSession || fromLocal;
    if (storedId) {
      (async () => {
        try {
          const r = await api.get(`/racing/races/${storedId}`);
          const race = r.data?.race;
          if (race?.state === "running") {
            setActiveRace(race);
            setTab("races");
            navigate(`/casino/mini-games/racing?race=${storedId}`, { replace: true });
          } else {
            try {
              sessionStorage.removeItem(RACING_ACTIVE_RACE_KEY);
              localStorage.removeItem(RACING_ACTIVE_RACE_KEY);
            } catch (_) {}
          }
        } catch (_) {}
      })();
    }
  }, [raceIdParam, navigate]);

  useEffect(() => {
    if (tab === "bets") fetchBets();
    if (tab === "history") { fetchHistory(); fetchSeasonStats(); fetchTrackRecords(); }
    if (tab === "challenges") fetchChallenges();
    if (tab === "garage") { fetchDriverMarket(); fetchMyDriver(); }
    if (tab === "rnd") fetchRndTree();
    if (tab === "championship") { fetchChampionship(); fetchChampStandings(); }
  }, [tab, fetchBets, fetchHistory, fetchSeasonStats, fetchTrackRecords, fetchChallenges, fetchDriverMarket, fetchMyDriver, fetchRndTree, fetchChampionship, fetchChampStandings]);

  useEffect(() => {
    if (liveRacePoll.current) clearInterval(liveRacePoll.current);
    if (!activeRace?.id || activeRace?.mode !== "interactive") return;

    const poll = async () => {
      try {
        const { data } = await api.get(`/racing/races/${activeRace.id}/live`);
        setLiveRace(data);
        if (data.status === "completed" || data.status === "finished") {
          clearInterval(liveRacePoll.current);
          const raceId = activeRace.id;
          setTimeout(async () => {
            try {
              const r = await api.get(`/racing/races/${raceId}`);
              setActiveRace(r.data?.race);
            } catch {}
          }, 4000);
        }
      } catch {}
    };
    poll();
    liveRacePoll.current = setInterval(poll, 2000);
    return () => { if (liveRacePoll.current) clearInterval(liveRacePoll.current); };
  }, [activeRace?.id, activeRace?.mode]);

  useEffect(() => {
    lastSentDecisionKey.current = null;
    prevLiveLapRef.current = undefined;
  }, [activeRace?.id]);

  useEffect(() => {
    const cl = liveRace?.current_lap;
    if (prevLiveLapRef.current !== cl) {
      prevLiveLapRef.current = cl;
      lastSentDecisionKey.current = null;
    }
  }, [liveRace?.current_lap]);

  /** Push strategy to server on change (debounced). No separate confirm — matches live controls. */
  useEffect(() => {
    if (!activeRace?.id || activeRace.mode !== "interactive") return;
    if (!liveRace || liveRace.status !== "running") return;
    const totalLaps = liveRace.total_laps ?? activeRace.laps ?? 3;
    if (liveRace.current_lap >= totalLaps) return;

    const t = setTimeout(async () => {
      const decision = myDecision;
      const key = JSON.stringify({
        push_level: decision.push_level,
        pit_this_lap: decision.pit_this_lap,
        pit_compound: decision.pit_compound,
        defend: decision.defend,
      });
      if (lastSentDecisionKey.current === key) return;
      try {
        setDecisionSyncPending(true);
        await api.post(`/racing/races/${activeRace.id}/decision`, decision);
        lastSentDecisionKey.current = key;
      } catch (e) {
        toast.error(apiDetail(e));
        lastSentDecisionKey.current = null;
      } finally {
        setDecisionSyncPending(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [
    myDecision,
    liveRace?.status,
    liveRace?.current_lap,
    liveRace?.total_laps,
    activeRace?.id,
    activeRace?.mode,
    activeRace?.laps,
  ]);

  useEffect(() => {
    setInteractiveLeaderLap(null);
    setInteractiveRaceProg(null);
  }, [activeRace?.id]);

  const createRacePayload = () => ({
    track_id: createForm.track_id,
    entry_fee: Number(createForm.entry_fee) || 0,
    max_grid: Number(createForm.max_grid) || 6,
    laps: Number(createForm.laps) || 3,
    tyre_compound: createForm.tyre_compound || "medium",
    weather_id: WEATHER_ID_FOR_API(createForm.weather_id || "clear"),
    interactive: true,
  });

  const handleCreateRace = async () => {
    if (!createForm.track_id) { toast.error("Select a track"); return; }
    setCreating(true);
    try {
      const r = await api.post("/racing/races", createRacePayload());
      const race = r.data?.race;
      if (race) {
        setActiveRace(race);
        await fetchOpenRaces();
        await fetchProfile();
        refreshUser();
        toast.success("Race created");
        navigate(`/casino/mini-games/racing?race=${race.id}`, { replace: true });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setCreating(false); }
  };

  const handleCreateAndRaceVsNpcs = async () => {
    if (!createForm.track_id) { toast.error("Select a track"); return; }
    setCreating(true);
    try {
      const r = await api.post("/racing/races", createRacePayload());
      const race = r.data?.race;
      if (race) {
        await api.post(`/racing/races/${race.id}/start`);
        const r2 = await api.get(`/racing/races/${race.id}`);
        const startedRace = r2.data?.race;
        if (!startedRace || startedRace.state !== "running") {
          toast.error("Race could not be started. Please try again.");
          return;
        }
        setTab("races");
        setActiveRace(startedRace);
        navigate(`/casino/mini-games/racing?race=${race.id}`, { replace: true });
        window.scrollTo({ top: 0, behavior: "smooth" });
        toast.success("Race started — run it live");
        fetchOpenRaces();
        fetchProfile();
        refreshUser();
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
      navigate(`/casino/mini-games/racing?race=${race.id}`, { replace: true });
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

  const handleCompleteRace = async (raceId, liveResultOrder = null, liveDnfIds = null) => {
    try {
      const body = {};
      if (Array.isArray(liveResultOrder) && liveResultOrder.length > 0) body.result_order = liveResultOrder;
      if (Array.isArray(liveDnfIds)) body.dnf_ids = liveDnfIds;
      const r = await api.post(`/racing/races/${raceId}/complete`, body);
      try { sessionStorage.removeItem(RACING_ACTIVE_RACE_KEY); localStorage.removeItem(RACING_ACTIVE_RACE_KEY); } catch (_) {}
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

  const handleStartResearch = async (pathId, nodeId) => {
    setRndResearching(true);
    try {
      await api.post("/racing/rnd/research", { path_id: pathId, node_id: nodeId });
      toast.success("Research started!");
      fetchRndTree();
      fetchAll();
    } catch (e) { toast.error(apiDetail(e)); }
    setRndResearching(false);
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
      <div className={`${styles.pageContent} mobile-page-root`}>
        <div className="p-4 text-center text-[var(--noir-muted)]">Loading racing...</div>
      </div>
    );
  }

  const hasTeam = !!(profile?.team_name || "").trim();
  const teamCreateCost = profile?.racing_team_create_cost ?? 25_000_000;

  if (!hasTeam) {
    return (
      <div className={`${styles.pageContent} mobile-page-root overflow-x-hidden space-y-4`} style={{ minHeight: "100%", WebkitOverflowScrolling: "touch" }}>
        <div className="px-4 md:px-4 py-3 border-b border-[var(--noir-border)]" style={{ background: "rgba(201,164,96,.03)" }}>
          <h1 className="text-lg font-heading" style={{ color: "var(--noir-primary)" }}>Bootleg Runs</h1>
          <p className="text-xs text-[var(--noir-muted)] mt-0.5">Create a racing team to enter races.</p>
        </div>
        <div className="px-4 md:px-4 py-4 max-w-md">
          <div className={styles.panel + " mobile-panel overflow-hidden"}>
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
    { id: "challenges", label: "H2H" },
    { id: "bets", label: "Bets" },
    { id: "history", label: "History" },
    { id: "garage", label: "Garage" },
    { id: "crew", label: "Crew" },
    { id: "rnd", label: "R&D" },
    { id: "championship", label: "Champ" },
    { id: "leaderboard", label: "Board" },
    { id: "comps", label: "Comps" },
  ];

  const crewBankPct = Math.min(100, ((profile?.crew_bank ?? 0) / 10000000) * 100);

  return (
    <div className={`${styles.pageContent} mobile-page-root overflow-x-hidden space-y-0`} style={{ minHeight: "100%", WebkitOverflowScrolling: "touch" }}>
      {/* ─── COMPACT HEADER ─── */}
      <div className="px-4 md:px-4 py-2.5 border-b border-[var(--noir-border)]" style={{ background: "rgba(201,164,96,.03)" }}>
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
            {isAdmin && (
              <>
                <button type="button" onClick={handleAdminClearCrewBankDebt}
                  className="text-[9px] font-heading px-2 py-1 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-900/20 transition-colors touch-manipulation min-h-[32px]">
                  Clear crew debt
                </button>
                <button type="button" onClick={handleAdminWipeTeams}
                  className="text-[8px] font-heading px-1.5 py-0.5 rounded border border-red-500/40 text-red-400 hover:bg-red-900/20 transition-colors">
                  Wipe All
                </button>
              </>
            )}
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

      {/* ─── INTERACTIVE RACE HUD ─── */}
      {activeRace?.state === "running" && (activeRace?.mode === "interactive" || activeRace?.interactive) && liveRace && (() => {
        const _carEntries = Object.entries(liveRace.car_states || {}).sort((a, b) => (a[1].position ?? 99) - (b[1].position ?? 99));
        const _tColors = { soft: "#e82020", medium: "#e8d020", hard: "#c0c0b8", inter: "#20a840", full_wet: "#2080e8" };
        const _totLapsHud = liveRace.total_laps || activeRace.laps || 3;
        const _serverLap = liveRace.current_lap ?? 0;
        const _dispLap = interactiveLeaderLap != null
          ? Math.min(interactiveLeaderLap + 1, _totLapsHud)
          : (_serverLap === 0 ? 0 : Math.min(_serverLap + 1, _totLapsHud));
        const _lapProg = interactiveRaceProg != null && _totLapsHud > 0
          ? interactiveRaceProg
          : (_totLapsHud > 0 ? Math.min(1, (liveRace.current_lap || 0) / _totLapsHud) : 0);
        return (
        <div className="px-4 py-3 md:px-3 md:py-3 space-y-3">
          {/* Race Header Bar */}
          <div className={styles.panel + " mobile-panel overflow-hidden"}>
            <div className="flex items-center justify-between px-3 py-2" style={{ background: "linear-gradient(90deg, rgba(212,175,55,0.08), transparent)" }}>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] font-heading uppercase tracking-wider text-red-400">LIVE</span>
                </div>
                <span className="text-xs font-heading text-[var(--noir-primary)]">
                  {_serverLap === 0
                    ? <>Formation <span className="text-[var(--noir-muted)] font-normal">·</span> Q</>
                    : `LAP ${_dispLap}/${_totLapsHud}`}
                </span>
                <span className="text-[10px] text-[var(--noir-muted)]">{liveRace.track?.name}</span>
                {liveRace.weather && liveRace.weather !== "clear" && (
                  <span className="text-[10px] text-blue-400">{liveRace.weather}</span>
                )}
              </div>
              {liveRace.lap_deadline && <LiveCountdown deadline={liveRace.lap_deadline} />}
            </div>
            <div className="h-1 bg-[var(--noir-border)]">
              <div className="h-full bg-[var(--noir-primary)] transition-all duration-1000" style={{ width: `${Math.min(100, _lapProg * 100)}%` }} />
            </div>
          </div>

          {/* Live Race Canvas */}
          <CircuitRaceView
            mode="interactive-live"
            initialTrackId={circuitTrackId}
            weather={liveRace.weather || activeRace.weather || "clear"}
            participants={liveRace.participants || activeRace.participants || []}
            qualifying_order={liveRace.qualifying_order?.length ? liveRace.qualifying_order : (activeRace.qualifying_order || [])}
            currentUserId={profile?.user_id}
            laps={liveRace.total_laps || activeRace.laps || 3}
            liveCarStates={liveRace.car_states}
            liveIncidents={liveRace.incidents}
            livePitStops={liveRace.pit_stops}
            liveCurrentLap={liveRace.current_lap || 0}
            liveTotalLaps={liveRace.total_laps || activeRace.laps || 3}
            lapDeadline={liveRace.lap_deadline}
            onVisualLapChange={(completed, _tot, prog01) => {
              setInteractiveLeaderLap(completed);
              if (prog01 != null) setInteractiveRaceProg(prog01);
            }}
          />

          {/* Timing Tower + Strategy side by side on desktop */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Timing Tower */}
            <div className={styles.panel + " mobile-panel overflow-hidden"}>
              <CardHead title="Timing Tower" />
              <div className="divide-y divide-[var(--noir-border)]">
                {_carEntries.map(([eid, cs], idx) => {
                  const participant = (liveRace.participants || activeRace.participants || []).find(p => (p.user_id || p.id) === eid);
                  const isMe = eid === profile?.user_id;
                  return (
                    <div key={eid} className={"flex items-center gap-2 px-3 py-1.5 text-xs" + (isMe ? " bg-amber-900/10" : "")}
                      style={isMe ? { borderLeft: "2px solid var(--noir-primary)" } : {}}>
                      <span className="w-5 font-heading text-center" style={{ color: idx === 0 ? "#e8c870" : idx === 1 ? "#bbb" : idx === 2 ? "#c07a30" : "var(--noir-muted)" }}>
                        {cs.dnf ? "DNF" : `P${idx + 1}`}
                      </span>
                      <span className="flex-1 truncate" style={{ color: isMe ? "var(--noir-primary)" : "var(--noir-foreground)" }}>
                        {participant?.team_name || participant?.username || eid.slice(0, 8)}
                      </span>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: _tColors[cs.compound] || "#ccc" }} title={cs.compound} />
                      <span className="text-[9px] tabular-nums w-10 text-right" style={{ color: (cs.tyre_wear ?? 100) < 30 ? "#e74c3c" : "var(--noir-muted)" }}>
                        {Math.round(cs.tyre_wear ?? 100)}%
                      </span>
                      <span className="text-[9px] tabular-nums w-10 text-right" style={{ color: (cs.engine_wear ?? 0) > 75 ? "#f59e0b" : "var(--noir-muted)" }}>
                        E:{Math.round(cs.engine_wear ?? 0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Strategy Panel */}
            {liveRace.status === "running" && liveRace.current_lap < liveRace.total_laps ? (
              <div className={styles.panel + " mobile-panel overflow-hidden"}>
                <CardHead title="Strategy" right={
                  <span className={"text-[9px] font-heading " + (decisionSyncPending ? "text-amber-400 animate-pulse" : "text-green-400")}>
                    {decisionSyncPending ? "SYNCING…" : "LIVE"}
                  </span>
                } />
                <div className="p-3 space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-heading uppercase text-[var(--noir-muted)]">Push Level</span>
                      <span className="text-xs font-heading" style={{ color: myDecision.push_level >= 4 ? "#ef4444" : myDecision.push_level <= 2 ? "#22c55e" : "var(--noir-primary)" }}>
                        {["", "Conserve", "Steady", "Normal", "Push", "Max Attack"][myDecision.push_level]}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {[1,2,3,4,5].map(lv => (
                        <button key={lv} type="button"
                          className={"flex-1 py-1.5 text-[10px] font-heading rounded border transition-all " +
                            (myDecision.push_level === lv ? "border-[var(--noir-primary)] bg-amber-900/30 text-[var(--noir-primary)]" : "border-[var(--noir-border)] text-[var(--noir-muted)] hover:bg-[var(--noir-surface)]")}
                          onClick={() => setMyDecision(d => ({...d, push_level: lv}))}>
                          {lv}
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-between text-[7px] text-[var(--noir-muted)] mt-0.5 px-1">
                      <span>Save tyres</span><span>Max speed</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button"
                      className={"flex-1 py-2 text-[10px] font-heading rounded border transition-all " +
                        (myDecision.pit_this_lap ? "border-blue-500 bg-blue-900/30 text-blue-300" : "border-[var(--noir-border)] text-[var(--noir-muted)] hover:bg-[var(--noir-surface)]")}
                      onClick={() => setMyDecision(d => ({...d, pit_this_lap: !d.pit_this_lap}))}>
                      {myDecision.pit_this_lap ? "PIT THIS LAP" : "No Pit"}
                    </button>
                    <button type="button"
                      className={"flex-1 py-2 text-[10px] font-heading rounded border transition-all " +
                        (myDecision.defend ? "border-red-500 bg-red-900/30 text-red-300" : "border-[var(--noir-border)] text-[var(--noir-muted)] hover:bg-[var(--noir-surface)]")}
                      onClick={() => setMyDecision(d => ({...d, defend: !d.defend}))}>
                      {myDecision.defend ? "DEFENDING" : "No Defend"}
                    </button>
                  </div>
                  {myDecision.pit_this_lap && (
                    <div className="flex gap-1">
                      {["soft","medium","hard","inter","full_wet"].map(c => {
                        const labels = { soft: "S", medium: "M", hard: "H", inter: "I", full_wet: "W" };
                        return (
                          <button key={c} type="button"
                            className={"flex-1 py-1 text-[10px] font-heading rounded border transition-all " +
                              (myDecision.pit_compound === c ? "border-[var(--noir-primary)]" : "border-[var(--noir-border)] hover:bg-[var(--noir-surface)]")}
                            style={{ color: _tColors[c], borderColor: myDecision.pit_compound === c ? _tColors[c] : undefined }}
                            onClick={() => setMyDecision(d => ({...d, pit_compound: c}))}>
                            {labels[c]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className={styles.panel + " mobile-panel overflow-hidden"}>
                <CardHead title="Telemetry" />
                <div className="p-3 space-y-2">
                  {_carEntries.filter(([eid]) => eid === profile?.user_id).map(([eid, cs]) => (
                    <div key={eid} className="space-y-2">
                      {[
                        { label: "Tyre Wear", val: cs.tyre_wear ?? 100, color: (cs.tyre_wear ?? 100) < 30 ? "#e74c3c" : "#22c55e" },
                        { label: "Engine", val: 100 - (cs.engine_wear ?? 0), color: (cs.engine_wear ?? 0) > 75 ? "#e74c3c" : "#3b82f6" },
                        { label: "Fuel", val: cs.fuel_pct ?? 100, color: (cs.fuel_pct ?? 100) < 20 ? "#e74c3c" : "#f59e0b" },
                      ].map(bar => (
                        <div key={bar.label}>
                          <div className="flex justify-between text-[9px] mb-0.5">
                            <span className="text-[var(--noir-muted)] font-heading uppercase">{bar.label}</span>
                            <span style={{ color: bar.color }}>{Math.round(bar.val)}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[var(--noir-border)] overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${bar.val}%`, background: bar.color }} />
                          </div>
                        </div>
                      ))}
                      {cs.damage > 0 && (
                        <div className="text-[9px] text-red-400 font-heading">DAMAGE: {Math.round(cs.damage * 100)}%</div>
                      )}
                    </div>
                  ))}
                  {_carEntries.filter(([eid]) => eid === profile?.user_id).length === 0 && (
                    <p className="text-[10px] text-[var(--noir-muted)]">Spectating...</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Incident Feed */}
          {(liveRace.incidents || []).length > 0 && (
            <div className={styles.panel + " mobile-panel overflow-hidden"}>
              <CardHead title="Incidents" />
              <div className="p-2 max-h-32 overflow-y-auto space-y-0.5">
                {(liveRace.incidents || []).slice(-10).reverse().map((inc, i) => {
                  const damagedP = (liveRace.participants || []).find(p => (p.user_id || p.id) === inc.damaged);
                  return (
                    <div key={i} className="text-[9px] text-[var(--noir-muted)] flex gap-1.5">
                      <span className="text-amber-400 font-heading flex-shrink-0">LAP {inc.lap}</span>
                      <span>Contact: {damagedP?.username || damagedP?.team_name || inc.damaged?.slice(0,8)} took {inc.damage_pct}% damage</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Race Finished */}
          {(liveRace.status === "completed" || liveRace.status === "finished") && (
            <div className={styles.panel + " mobile-panel overflow-hidden"}>
              <CardHead title="Checkered Flag!" />
              <div className="p-3 text-center">
                <p className="text-lg font-heading text-[var(--noir-primary)] mb-1">Race Complete</p>
                <p className="text-[10px] text-[var(--noir-muted)]">Final results loading...</p>
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* ─── LIVE RACE: same CircuitRaceView as replay — uses full realism (getCornerMult ~120 mph in corners, brake/accel smoothing, track width, car scale 0.88, final order from backend result_order) ─── */}
      {activeRace?.state === "running" && !(activeRace?.mode === "interactive" || activeRace?.interactive) && (
        <div className="px-4 py-3 md:px-3 md:py-3">
          {activeRace.qualifying_order?.length > 0 && (
            <p className="text-[10px] font-heading uppercase tracking-wider text-[var(--noir-primary)] mb-1.5">Live race — Grid by qualifying</p>
          )}
          <CircuitRaceView
            mode="replay"
            raceId={activeRace.id}
            participants={activeRace.participants || []}
            qualifying_order={activeRace.qualifying_order || []}
            resultOrder={activeRace.result_order || []}
            lap_results={activeRace.lap_results || []}
            pit_stops={activeRace.pit_stops || []}
            tire_wear_after_lap={activeRace.tire_wear_after_lap || {}}
            laps={activeRace.laps || 3}
            weather={activeRace.weather || "clear"}
            weather_name={activeRace.weather_name}
            initialTrackId={circuitTrackId}
            playerCarName={playerCarName}
            playerPitLevel={profile?.pit_level ?? 0}
            currentUserId={profile?.user_id}
            rewards={activeRace.rewards || null}
            onComplete={(resultOrderIds, dnfIds) => handleCompleteRace(activeRace.id, resultOrderIds, dnfIds)}
            onReset={() => { try { sessionStorage.removeItem(RACING_ACTIVE_RACE_KEY); localStorage.removeItem(RACING_ACTIVE_RACE_KEY); } catch (_) {} setActiveRace(null); fetchOpenRaces(); }}
          />
        </div>
      )}

      {/* ─── AUTOMATED RACE REPLAY ─── */}
      {activeRace?.state === "replay" && (
        <div className="px-4 py-3 md:px-3 md:py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-heading uppercase tracking-wider text-[var(--noir-primary)]">
              Replay — {activeRace.track_name} {activeRace.weather_name && `(${activeRace.weather_name})`}
            </p>
            <button
              type="button"
              onClick={() => { try { sessionStorage.removeItem(RACING_ACTIVE_RACE_KEY); localStorage.removeItem(RACING_ACTIVE_RACE_KEY); } catch (_) {} setActiveRace(null); }}
              className="text-[10px] font-heading px-2 py-1 rounded border border-[var(--noir-border)] hover:bg-[var(--noir-surface)] touch-manipulation"
            >
              Close
            </button>
          </div>
          <CircuitRaceView
            mode="replay"
            raceId={activeRace.id}
            participants={activeRace.participants || []}
            qualifying_order={activeRace.qualifying_order || activeRace.result_order || []}
            resultOrder={activeRace.result_order || []}
            lap_results={activeRace.lap_results || []}
            pit_stops={activeRace.pit_stops || []}
            tire_wear_after_lap={activeRace.tire_wear_after_lap || {}}
            laps={activeRace.laps || 3}
            weather={activeRace.weather || "clear"}
            weather_name={activeRace.weather_name}
            initialTrackId={TRACK_ID_MAP[activeRace.track_id] || "chicago"}
            playerCarName={playerCarName}
            playerPitLevel={profile?.pit_level ?? 0}
            currentUserId={profile?.user_id}
            rewards={activeRace.rewards || null}
            onReset={() => { try { sessionStorage.removeItem(RACING_ACTIVE_RACE_KEY); localStorage.removeItem(RACING_ACTIVE_RACE_KEY); } catch (_) {} setActiveRace(null); }}
          />
        </div>
      )}

      {/* ─── POST-RACE RESULTS ─── */}
      {activeRace?.state === "completed" && (
        <div className="px-4 md:px-3">
        <div className={styles.panel + " mobile-panel overflow-hidden mb-3"}>
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
                      <span className="text-[10px] text-[var(--noir-muted)]">{formatMoney(rew.cash)} · {rew.racing_rep}rep</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {(activeRace.incidents || []).length > 0 && (
              <div className="mt-3 pt-2 border-t border-[var(--noir-border)]">
                <p className="text-[10px] font-heading uppercase tracking-wider text-[var(--noir-primary)] mb-1">Race Incidents</p>
                <ul className="space-y-0.5">
                  {activeRace.incidents.map((inc, idx) => {
                    const damagedP = (activeRace.participants || []).find((x) => (x.user_id || x.id) === inc.damaged);
                    return (
                      <li key={idx} className="text-[11px] text-[var(--noir-muted)] flex items-center gap-1.5">
                        <span className="text-red-400 font-bold text-[9px]">LAP {inc.lap}</span>
                        <span>{damagedP?.username || damagedP?.car_name || inc.damaged} took contact damage ({inc.damage_pct}%)</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <button type="button" className={styles.btnPrimary + " mt-3 w-full min-h-[40px] touch-manipulation text-xs"}
              onClick={() => { try { sessionStorage.removeItem(RACING_ACTIVE_RACE_KEY); localStorage.removeItem(RACING_ACTIVE_RACE_KEY); } catch (_) {} setActiveRace(null); fetchProfile(); navigate("/racing", { replace: true }); }}>
              Back to races
            </button>
          </div>
        </div>
        </div>
      )}

      {/* ─── TABS ─── */}
      <div className="flex border-b border-[var(--noir-border)] px-4 md:px-3 gap-1 overflow-x-auto overflow-y-hidden touch-pan-x" style={{ minHeight: 40, WebkitOverflowScrolling: "touch" }}>
        {tabs.map((t) => (
          <button key={t.id} type="button"
            className={"py-2 px-2.5 text-xs font-heading whitespace-nowrap flex-shrink-0 transition-colors " + (tab === t.id ? "border-b-2 text-[var(--noir-primary)]" : "text-[var(--noir-muted)]")}
            style={{ minHeight: 40, borderBottomColor: tab === t.id ? "var(--noir-primary)" : "transparent" }}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 md:px-3 py-3">

        {/* ─── RACES TAB ─── */}
        {tab === "races" && (
          <>
            {/* Automated race card */}
            <div className={styles.panel + " mobile-panel overflow-hidden mb-3"}>
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
                    <button
                      type="button"
                      onClick={() => setActiveRace({ ...latestAutomated, state: "replay" })}
                      className={styles.btnPrimary + " text-[10px] px-3 py-1.5 mb-2 touch-manipulation"}
                    >
                      Watch Replay
                    </button>
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
                              {rew && !isDnf && <span className="text-[9px] text-[var(--noir-muted)]">{formatMoney(rew.cash)}</span>}
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
            <div className={styles.panel + " mobile-panel overflow-hidden mb-3"}>
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

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--noir-border)]">
                  <button type="button" className="text-[10px] font-heading px-2 py-1 rounded border border-[var(--noir-border)] hover:bg-[var(--noir-primary)]/10 touch-manipulation"
                    onClick={() => setCreateForm((f) => ({ ...f, weather_id: WEATHER_OPTIONS[Math.floor(Math.random() * WEATHER_OPTIONS.length)].id }))}>
                    Random weather
                  </button>
                  <button type="button" className={styles.btnPrimary + " min-h-[34px] text-xs touch-manipulation px-3 py-1"}
                    disabled={creating || !createForm.track_id || !selectedInstanceId || (cars.find((c) => c.id === selectedInstanceId)?.engine_wear ?? 0) >= 100 || (effectiveTyreStock(createForm.tyre_compound, profile) < 1)}
                    onClick={handleCreateRace}>
                    {creating ? "Creating…" : "Create race"}
                  </button>
                  <button type="button" className="min-h-[34px] text-xs touch-manipulation px-3 py-1 rounded border border-[var(--noir-primary)] bg-[var(--noir-primary)]/10 text-[var(--noir-primary)] hover:bg-[var(--noir-primary)]/20 font-heading"
                    disabled={creating || !createForm.track_id || !selectedInstanceId || (cars.find((c) => c.id === selectedInstanceId)?.engine_wear ?? 0) >= 100 || (effectiveTyreStock(createForm.tyre_compound, profile) < 1)}
                    onClick={handleCreateAndRaceVsNpcs}
                    title="Create a race and start immediately vs AI opponents">
                    {creating ? "Creating…" : "Create & race vs NPCs"}
                  </button>
                </div>
                {(cars.find((c) => c.id === selectedInstanceId)?.engine_wear ?? 0) >= 100 && (
                  <p className="text-[10px] text-amber-400">Engine at 100% wear — repair in Garage.</p>
                )}
                {effectiveTyreStock(createForm.tyre_compound, profile) < 1 && (
                  <p className="text-[10px] text-amber-400">No {createForm.tyre_compound} tyres — buy in Garage.</p>
                )}
                {!selectedInstanceId && <p className="text-[10px] text-amber-400">Select a car in Garage first.</p>}
              </div>
            </div>

            {/* Active open race */}
            {activeRace?.state === "open" && (
              <div className={styles.panel + " mobile-panel p-3 mb-3"}>
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
            <div className={styles.panel + " mobile-panel overflow-hidden"}>
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
                            onClick={() => handleJoinRace(race, selectedInstanceId, joinTyre)}>
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

        {/* ─── GARAGE TAB ─── */}
        {tab === "garage" && (
          <>
            {/* ─── MY DRIVER ─── */}
            <div className={styles.panel + " mobile-panel overflow-hidden mb-3"}>
              <CardHead title="My Driver" right={myDriver && (
                <button type="button" className={styles.btnPrimary + " text-[9px] px-2 py-0.5"}
                  disabled={driverLoading} onClick={handleFireDriver}>
                  Release
                </button>
              )} />
              <div className="p-3">
                {myDriver ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-heading text-sm" style={{ color: "var(--noir-primary)" }}>{myDriver.name}</span>
                        <span className={`text-[9px] ml-2 px-1.5 py-0.5 rounded font-heading uppercase ${
                          myDriver.tier === "platinum" ? "bg-purple-900/40 text-purple-300" :
                          myDriver.tier === "gold" ? "bg-amber-900/40 text-amber-300" :
                          myDriver.tier === "silver" ? "bg-gray-700/40 text-gray-300" :
                          "bg-orange-900/40 text-orange-400"
                        }`}>{myDriver.tier}</span>
                      </div>
                      <span className="text-[10px] text-[var(--noir-muted)]">{formatMoney(myDriver.salary_per_race)}/race</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { label: "Skill", val: myDriver.skill, color: "#e8c870" },
                        { label: "Consistency", val: myDriver.consistency, color: "#22c55e" },
                        { label: "Racecraft", val: myDriver.racecraft, color: "#3b82f6" },
                        { label: "Wet", val: myDriver.wet_ability, color: "#60a5fa" },
                        { label: "Tyre Mgmt", val: myDriver.tire_management, color: "#a855f7" },
                        { label: "Aggression", val: myDriver.aggression, color: "#ef4444" },
                      ].map(s => (
                        <div key={s.label} className="p-1.5 rounded bg-black/20 text-center">
                          <div className="text-[8px] uppercase text-[var(--noir-muted)]">{s.label}</div>
                          <div className="text-sm font-heading" style={{ color: s.color }}>{s.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--noir-muted)]">No driver hired. Visit the Driver Market below to hire one.</p>
                )}
              </div>
            </div>

            {/* ─── DRIVER MARKET ─── */}
            <div className={styles.panel + " mobile-panel overflow-hidden mb-3"}>
              <CardHead title="Driver Market" right={<span className="text-[9px] text-[var(--noir-muted)]">30 drivers · salary from crew bank</span>} />
              <div className="p-3 space-y-1.5 max-h-[400px] overflow-y-auto">
                {driverMarket.map(d => {
                  const avg = Math.round((d.skill + d.consistency + d.racecraft + d.wet_ability + d.tire_management) / 5);
                  const tierColor = d.tier === "platinum" ? "text-purple-300" : d.tier === "gold" ? "text-amber-300" : d.tier === "silver" ? "text-gray-300" : "text-orange-400";
                  return (
                    <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-[var(--noir-border)] last:border-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-heading text-xs truncate">{d.name}</span>
                          <span className={`text-[8px] font-heading uppercase ${tierColor}`}>{d.tier}</span>
                        </div>
                        <div className="flex gap-2 text-[8px] text-[var(--noir-muted)] mt-0.5">
                          <span>SKL {d.skill}</span>
                          <span>CON {d.consistency}</span>
                          <span>RCR {d.racecraft}</span>
                          <span>WET {d.wet_ability}</span>
                          <span>TYR {d.tire_management}</span>
                          <span>AGG {d.aggression}</span>
                          <span className="text-[var(--noir-primary)]">AVG {avg}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[9px] text-[var(--noir-muted)]">{formatMoney(d.salary_per_race)}/race</span>
                        {d.hired ? (
                          <span className="text-[8px] text-red-400 font-heading">TAKEN</span>
                        ) : (
                          <button type="button" className={styles.btnGoldDarkText + " text-[9px] px-2 py-0.5"}
                            disabled={driverLoading || !!myDriver}
                            onClick={() => handleHireDriver(d.id)}>
                            Hire
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tyre stock — inline badges */}
            <div className={styles.panel + " mobile-panel overflow-hidden mb-3"}>
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
              <div className={styles.panel + " mobile-panel p-3 mb-3"}>
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
                const globalCap = profile?.global_upgrade_cap ?? 26;
                const levelsUsed = c.upgrade_levels_used ?? (engine + tires + aero + reliability + (championship ? 1 : 0) + brakes + gearbox + cooling + weight + fuel);
                const atGlobalCap = levelsUsed >= globalCap;
                const bank = profile?.crew_bank ?? 0;

                const levelMap = { engine, tires, aero, reliability, brakes, gearbox, cooling, weight, fuel };
                const maxMap = {
                  engine: upgradeTradeoffs?.engine?.max ?? 5,
                  tires: upgradeTradeoffs?.tires?.max ?? 5,
                  aero: upgradeTradeoffs?.aero?.max ?? 3,
                  reliability: upgradeTradeoffs?.reliability?.max ?? 3,
                  brakes: upgradeTradeoffs?.brakes?.max ?? 4,
                  gearbox: upgradeTradeoffs?.gearbox?.max ?? 4,
                  cooling: upgradeTradeoffs?.cooling?.max ?? 3,
                  weight: upgradeTradeoffs?.weight?.max ?? 3,
                  fuel: upgradeTradeoffs?.fuel?.max ?? 3,
                };

                const nextETCost = carUpgradeCosts[engine + tires + 1] ?? carUpgradeCosts[carUpgradeCosts.length - 1];
                const repairCost = Math.round((c.engine_wear ?? 0) * (profile?.engine_repair_cost_per_pct ?? 400));
                const replaceCost = profile?.engine_replace_cost ?? 75000;
                const debtFloor = profile?.crew_bank_debt_limit ?? -50000;
                const canRepairWithDebt = profile?.free_engine_repair_available || (bank - repairCost >= debtFloor);
                const canReplaceWithDebt = bank - replaceCost >= debtFloor;

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
                  <div key={c.id} className={styles.panel + " mobile-panel overflow-hidden mb-3"}>
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
                            <div className="text-[9px] font-heading uppercase text-[var(--noir-muted)]" title="Power rating — higher means faster top speed in races (not mph)">Speed (rating)</div>
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
                                disabled={!canRepairWithDebt}
                                onClick={() => handleRepairEngine(c.id)}>
                                {profile?.free_engine_repair_available ? "Free fix" : `Fix ${formatMoney(repairCost)}`}
                              </button>
                              <button type="button" className={styles.btnGoldDarkText + " text-[8px] px-1 py-0.5"}
                                disabled={!canReplaceWithDebt}
                                onClick={() => handleReplaceEngine(c.id)}>
                                New {formatMoney(replaceCost)}
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
            <div className={styles.panel + " mobile-panel overflow-hidden"}>
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
          <div className={styles.panel + " mobile-panel overflow-hidden"}>
            <CardHead title="Crew Upgrades" right={
              <span className="text-[10px] tabular-nums" style={{ color: "var(--noir-primary)" }}>
                Bank: {formatMoney(profile?.crew_bank ?? 0)} · Levels: {profile?.crew_levels_used ?? 0}/{profile?.crew_global_cap ?? 24}
              </span>
            } />
            <div className="p-3">
              <p className="text-[10px] text-[var(--noir-muted)] mb-3">+2% speed/level. Pit Crew also shortens pit time. Total levels capped.</p>
              {isAdmin && (
                <div className="mb-3 p-2 rounded border border-amber-500/30 bg-amber-950/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="text-[9px] text-[var(--noir-muted)]">Admin: reset every team&apos;s negative crew bank to $0 (global).</span>
                  <button type="button" onClick={handleAdminClearCrewBankDebt}
                    className={styles.btnGoldDarkText + " text-[10px] font-heading px-3 py-1.5 whitespace-nowrap touch-manipulation shrink-0"}>
                    Clear all crew bank debt
                  </button>
                </div>
              )}
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

            {/* Sponsor Deal */}
            <div className={styles.panel + " mobile-panel overflow-hidden mt-3"}>
              <CardHead title="Sponsor Deal" right={
                <span className="text-[10px] text-[var(--noir-primary)]">{profile?.sponsor?.name || "None"}</span>
              } />
              <div className="p-3">
                <p className="text-[10px] text-[var(--noir-muted)] mb-2">Earn passive income per race based on your racing rep. Higher rep = better sponsors.</p>
                <div className="text-[11px] mb-2">
                  Current: <span className="text-[var(--noir-primary)] font-semibold">{profile?.sponsor?.name || "None"}</span>
                  {profile?.sponsor?.income_per_race > 0 && (
                    <span className="text-[var(--noir-muted)]"> — ${(profile.sponsor.income_per_race || 0).toLocaleString()} per race</span>
                  )}
                </div>
                <div className="space-y-1">
                  {(profile?.sponsor_tiers || []).map((t, i) => (
                    <div key={i} className="flex items-center justify-between py-0.5 text-[10px]"
                      style={{ opacity: (profile?.racing_rep ?? 0) >= t.min_rep ? 1 : 0.4 }}>
                      <span>{t.name} <span className="text-[var(--noir-muted)]">({t.min_rep}+ rep)</span></span>
                      <span className="text-[var(--noir-primary)]">${(t.income_per_race || 0).toLocaleString()}/race</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── R&D TAB ─── */}
        {tab === "rnd" && (
          <div className="space-y-3">
            {rndActive && (
              <div className={styles.panel + " mobile-panel overflow-hidden"}>
                <div className="p-3 flex items-center gap-3" style={{ background: "rgba(201,164,96,.08)" }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-heading uppercase tracking-wider text-amber-400">Researching</p>
                    <p className="text-sm font-heading truncate" style={{ color: "var(--noir-primary)" }}>{rndActive.node_id?.replace(/_/g, " ")}</p>
                  </div>
                  <RndCountdown completes_at={rndActive.completes_at} onComplete={fetchRndTree} />
                </div>
              </div>
            )}

            {rndTree && Object.entries(rndTree).map(([pathId, path]) => {
              const pathColors = { speed: "#e8c870", reliability: "#22c55e", handling: "#3b82f6" };
              const pathColor = pathColors[pathId] || "var(--noir-primary)";
              return (
                <div key={pathId} className={styles.panel + " mobile-panel overflow-hidden"}>
                  <CardHead title={path.name + " Path"} right={
                    <span className="text-[9px]" style={{ color: pathColor }}>{path.description}</span>
                  } />
                  <div className="p-3 space-y-2">
                    {(path.tiers || []).map((tier) => (
                      <div key={tier.tier}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[8px] font-heading uppercase tracking-widest" style={{ color: "var(--noir-muted)" }}>Tier {tier.tier}</span>
                          <div className="flex-1 h-px" style={{ background: "var(--noir-border)" }} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {(tier.options || []).map(node => {
                            const otherInTier = tier.options.find(o => o.id !== node.id);
                            const otherResearched = otherInTier?.researched;
                            const isLocked = !node.available || otherResearched;
                            const bank = profile?.crew_bank ?? 0;
                            return (
                              <div key={node.id}
                                className={"p-2 rounded border transition-all " + (
                                  node.researched ? "border-green-700 bg-green-900/15" :
                                  node.researching ? "border-amber-600 bg-amber-900/15 animate-pulse" :
                                  isLocked ? "border-[var(--noir-border)] opacity-40" :
                                  "border-[var(--noir-border)] hover:border-[var(--noir-primary)]"
                                )}>
                                <div className="flex items-start justify-between gap-1">
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-heading truncate" style={{ color: node.researched ? "#22c55e" : pathColor }}>{node.name}</p>
                                    <p className="text-[8px] text-[var(--noir-muted)] mt-0.5">{node.desc}</p>
                                  </div>
                                  {node.researched && <span className="text-green-400 text-[10px]">✓</span>}
                                </div>
                                <div className="flex items-center justify-between mt-1.5">
                                  <span className="text-[8px] text-[var(--noir-muted)]">{formatMoney(node.cost)} · {node.research_hours}h</span>
                                  {!node.researched && !node.researching && !isLocked && !rndActive && (
                                    <button type="button" className={styles.btnGoldDarkText + " text-[8px] px-1.5 py-0.5"}
                                      disabled={rndResearching || bank < node.cost}
                                      onClick={() => handleStartResearch(pathId, node.id)}>
                                      Research
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── LEADERBOARD TAB ─── */}
        {tab === "leaderboard" && (
          <div className={styles.panel + " mobile-panel overflow-hidden"}>
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
          <div className={styles.panel + " mobile-panel overflow-hidden"}>
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

        {/* ─── CHAMPIONSHIP TAB ─── */}
        {tab === "championship" && (
          <div className="space-y-3">
            {championship?.next_race && (
              <div className={styles.panel + " mobile-panel overflow-hidden"}>
                <div className="p-3" style={{ background: "linear-gradient(135deg, rgba(201,164,96,.08), transparent)" }}>
                  <p className="text-[8px] font-heading uppercase tracking-widest text-amber-400 mb-1">Next Grand Prix</p>
                  <p className="text-sm font-heading" style={{ color: "var(--noir-primary)" }}>
                    Round {championship.next_race.round} — {championship.next_race.track_name}
                  </p>
                  <p className="text-[10px] text-[var(--noir-muted)] mt-0.5">
                    {new Date(championship.next_race.scheduled_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            )}

            {championship?.my_position && (
              <div className="flex gap-2">
                <div className={styles.panel + " mobile-panel flex-1 p-2 text-center"}>
                  <p className="text-[8px] text-[var(--noir-muted)] uppercase">Driver Standing</p>
                  <p className="text-lg font-heading" style={{ color: "var(--noir-primary)" }}>P{championship.my_position.driver_pos || "—"}</p>
                  <p className="text-[9px] tabular-nums" style={{ color: "var(--noir-muted)" }}>{championship.my_position.driver_points || 0} pts</p>
                </div>
                <div className={styles.panel + " mobile-panel flex-1 p-2 text-center"}>
                  <p className="text-[8px] text-[var(--noir-muted)] uppercase">Constructor</p>
                  <p className="text-lg font-heading" style={{ color: "var(--noir-primary)" }}>P{championship.my_position.constructor_pos || "—"}</p>
                  <p className="text-[9px] tabular-nums" style={{ color: "var(--noir-muted)" }}>{championship.my_position.constructor_points || 0} pts</p>
                </div>
              </div>
            )}

            <div className="flex gap-1">
              {[
                { id: "calendar", label: "Calendar" },
                { id: "drivers", label: "Drivers" },
                { id: "constructors", label: "Teams" },
              ].map(v => (
                <button key={v.id} type="button"
                  className={"flex-1 py-1.5 text-[10px] font-heading rounded border transition-all " +
                    (champView === v.id ? "border-[var(--noir-primary)] bg-amber-900/20 text-[var(--noir-primary)]" : "border-[var(--noir-border)] text-[var(--noir-muted)] hover:bg-[var(--noir-surface)]")}
                  onClick={() => setChampView(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>

            {champView === "calendar" && championship?.championship?.race_calendar && (
              <div className={styles.panel + " mobile-panel overflow-hidden"}>
                <CardHead title={championship.championship.season_name || "Championship"} />
                <div className="divide-y divide-[var(--noir-border)]">
                  {championship.championship.race_calendar.map((round) => (
                    <div key={round.round} className={"flex items-center gap-2 px-3 py-2 text-xs " + (round.completed ? "opacity-60" : "")}>
                      <span className="w-6 font-heading text-center" style={{ color: round.completed ? "#22c55e" : "var(--noir-muted)" }}>
                        {round.completed ? "✓" : `R${round.round}`}
                      </span>
                      <span className="flex-1 truncate" style={{ color: "var(--noir-foreground)" }}>{round.track_name}</span>
                      <span className="text-[9px] tabular-nums text-[var(--noir-muted)]">
                        {new Date(round.scheduled_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {champView === "drivers" && champStandings?.driver_standings && (
              <div className={styles.panel + " mobile-panel overflow-hidden"}>
                <CardHead title="Driver Championship" />
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--noir-border)]">
                      <th className="py-1.5 px-2 text-left text-[9px] text-[var(--noir-muted)]">Pos</th>
                      <th className="py-1.5 px-1 text-left text-[9px] text-[var(--noir-muted)]">Driver</th>
                      <th className="py-1.5 px-1 text-left text-[9px] text-[var(--noir-muted)]">Team</th>
                      <th className="py-1.5 px-1 text-right text-[9px] text-[var(--noir-muted)]">Pts</th>
                      <th className="py-1.5 px-1 text-right text-[9px] text-[var(--noir-muted)]">Wins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {champStandings.driver_standings.map((row, i) => {
                      const isMe = row.user_id === profile?.user_id;
                      return (
                        <tr key={row.user_id} className={"border-b border-[var(--noir-border)] last:border-0" + (isMe ? " bg-amber-900/10" : "")}>
                          <td className="py-1.5 px-2 font-heading" style={{ color: i === 0 ? "#e8c870" : i === 1 ? "#bbb" : i === 2 ? "#c07a30" : "var(--noir-muted)" }}>{i + 1}</td>
                          <td className="py-1.5 px-1 truncate max-w-[100px]" style={{ color: isMe ? "var(--noir-primary)" : "var(--noir-foreground)" }}>{row.driver_name || "—"}</td>
                          <td className="py-1.5 px-1 text-[var(--noir-muted)] truncate max-w-[80px]">{row.team_name || "—"}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums font-heading" style={{ color: "var(--noir-primary)" }}>{row.points}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums">{row.wins}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {champView === "constructors" && champStandings?.constructor_standings && (
              <div className={styles.panel + " mobile-panel overflow-hidden"}>
                <CardHead title="Constructor Championship" />
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--noir-border)]">
                      <th className="py-1.5 px-2 text-left text-[9px] text-[var(--noir-muted)]">Pos</th>
                      <th className="py-1.5 px-1 text-left text-[9px] text-[var(--noir-muted)]">Team</th>
                      <th className="py-1.5 px-1 text-right text-[9px] text-[var(--noir-muted)]">Pts</th>
                      <th className="py-1.5 px-1 text-right text-[9px] text-[var(--noir-muted)]">Wins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {champStandings.constructor_standings.map((row, i) => {
                      const isMe = row.user_id === profile?.user_id;
                      return (
                        <tr key={row.user_id} className={"border-b border-[var(--noir-border)] last:border-0" + (isMe ? " bg-amber-900/10" : "")}>
                          <td className="py-1.5 px-2 font-heading" style={{ color: i === 0 ? "#e8c870" : i === 1 ? "#bbb" : i === 2 ? "#c07a30" : "var(--noir-muted)" }}>{i + 1}</td>
                          <td className="py-1.5 px-1">
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ background: row.team_color || "var(--noir-muted)" }} />
                              <span className={"truncate max-w-[120px]" + (isMe ? " text-[var(--noir-primary)]" : "")}>{row.team_name || "—"}</span>
                            </span>
                          </td>
                          <td className="py-1.5 px-1 text-right tabular-nums font-heading" style={{ color: "var(--noir-primary)" }}>{row.points}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums">{row.wins}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!championship?.championship && (
              <div className={styles.panel + " mobile-panel p-4 text-center"}>
                <p className="text-xs text-[var(--noir-muted)]">No active championship. Create a team and join races to start!</p>
              </div>
            )}
          </div>
        )}

        {/* ─── CHALLENGES (H2H) TAB ─── */}
        {tab === "challenges" && (
          <div>
            <div className={styles.panel + " mobile-panel p-3 mb-3"}>
              <div className="font-heading text-[11px] tracking-[.22em] uppercase text-[var(--noir-primary)] mb-2">Challenge a Player</div>
              <div className="space-y-2">
                <input type="text" value={challengeForm.target_username} onChange={e => setChallengeForm(f => ({ ...f, target_username: e.target.value }))}
                  placeholder="Opponent username" className="w-full min-h-[36px] px-2 text-[11px] bg-transparent border border-[var(--noir-border)] rounded text-[var(--noir-foreground)]" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={challengeForm.track_id} onChange={e => setChallengeForm(f => ({ ...f, track_id: e.target.value }))}
                    className="min-h-[36px] px-2 text-[11px] bg-transparent border border-[var(--noir-border)] rounded text-[var(--noir-foreground)]">
                    <option value="">Track</option>
                    {tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <input type="number" min={0} value={challengeForm.stake} onChange={e => setChallengeForm(f => ({ ...f, stake: Number(e.target.value) || 0 }))}
                    placeholder="Stake $" className="min-h-[36px] px-2 text-[11px] bg-transparent border border-[var(--noir-border)] rounded text-[var(--noir-foreground)]" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" min={2} max={20} value={challengeForm.laps} onChange={e => setChallengeForm(f => ({ ...f, laps: Math.max(2, Math.min(20, Number(e.target.value) || 3)) }))}
                    placeholder="Laps" className="min-h-[36px] px-2 text-[11px] bg-transparent border border-[var(--noir-border)] rounded text-[var(--noir-foreground)]" />
                  <select value={challengeForm.weather_id} onChange={e => setChallengeForm(f => ({ ...f, weather_id: e.target.value }))}
                    className="min-h-[36px] px-2 text-[11px] bg-transparent border border-[var(--noir-border)] rounded text-[var(--noir-foreground)]">
                    {WEATHER_OPTIONS.map(w => <option key={w.id} value={w.id}>{w.icon} {w.name}</option>)}
                  </select>
                </div>
                <button type="button" className={styles.btnPrimary + " w-full text-[11px] min-h-[40px]"} disabled={challengeCreating}
                  onClick={handleCreateChallenge}>{challengeCreating ? "Sending..." : "Send Challenge"}</button>
              </div>
            </div>

            {/* Incoming challenges */}
            {challenges.incoming.length > 0 && (
              <div className={styles.panel + " mobile-panel p-3 mb-3"}>
                <div className="font-heading text-[11px] tracking-[.22em] uppercase text-[var(--noir-primary)] mb-2">Incoming Challenges</div>
                <div className="space-y-2">
                  {challenges.incoming.map(ch => (
                    <div key={ch.id} className={styles.panel + " mobile-panel p-2"}>
                      <div className="text-[11px] font-semibold">{ch.challenger_username} <span className="text-[var(--noir-muted)]">wants to race</span></div>
                      <div className="text-[10px] text-[var(--noir-muted)]">{ch.track_name} · {ch.laps} laps · {ch.weather_name} · ${(ch.stake || 0).toLocaleString()} stake</div>
                      <div className="flex gap-2 mt-1">
                        <button type="button" className={styles.btnPrimary + " text-[10px] px-3 py-1"} onClick={() => handleAcceptChallenge(ch.id)}>Accept</button>
                        <button type="button" className="text-[10px] text-red-400 px-3 py-1 border border-red-400/30 rounded" onClick={() => handleDeclineChallenge(ch.id)}>Decline</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Outgoing challenges */}
            {challenges.outgoing.length > 0 && (
              <div className={styles.panel + " mobile-panel p-3 mb-3"}>
                <div className="font-heading text-[11px] tracking-[.22em] uppercase text-[var(--noir-primary)] mb-2">Outgoing Challenges</div>
                <div className="space-y-1">
                  {challenges.outgoing.map(ch => (
                    <div key={ch.id} className="flex items-center justify-between py-1 border-b border-[var(--noir-border)]">
                      <span className="text-[11px]">vs {ch.target_username} <span className="text-[var(--noir-muted)]">· {ch.track_name} · ${(ch.stake||0).toLocaleString()}</span></span>
                      <span className="text-[10px] text-yellow-400">Pending</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent H2H Results */}
            {challenges.completed.length > 0 && (
              <div className={styles.panel + " mobile-panel p-3"}>
                <div className="font-heading text-[11px] tracking-[.22em] uppercase text-[var(--noir-primary)] mb-2">Recent Results</div>
                <div className="space-y-1">
                  {challenges.completed.map(ch => {
                    const isChallenger = ch.challenger_id === profile?.user_id;
                    const won = ch.winner_id === profile?.user_id;
                    return (
                      <div key={ch.id} className="flex items-center justify-between py-1 border-b border-[var(--noir-border)]">
                        <span className="text-[11px]">
                          vs {isChallenger ? ch.target_username : ch.challenger_username}
                          <span className="text-[var(--noir-muted)]"> · {ch.track_name}</span>
                        </span>
                        <span className={won ? "text-[11px] text-green-400" : "text-[11px] text-red-400"}>{won ? "Won" : "Lost"} ${(ch.stake||0).toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── BETS TAB ─── */}
        {tab === "bets" && (
          <div>
            <div className={styles.panel + " mobile-panel p-3 mb-3"}>
              <div className="font-heading text-[11px] tracking-[.22em] uppercase text-[var(--noir-primary)] mb-2">Place a Bet</div>
              <p className="text-[10px] text-[var(--noir-muted)] mb-3">Bet on who will win an open race. Odds based on car stats and racing rep.</p>
              {openRaces.filter(r => r.state === "open").length === 0 ? (
                <p className="text-[10px] text-[var(--noir-muted)]">No open races to bet on right now.</p>
              ) : (
                <div className="space-y-2">
                  {openRaces.filter(r => r.state === "open").map(race => (
                    <div key={race.id} className={styles.panel + " mobile-panel p-2"}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold">{race.track_name || race.track_id}</span>
                        <span className="text-[9px] text-[var(--noir-muted)]">{race.participants?.length || 0} entrants · ${(race.entry_fee || 0).toLocaleString()} fee</span>
                      </div>
                      {bettingRaceId === race.id && betOdds ? (
                        <div className="space-y-2 mt-2">
                          <div className="grid grid-cols-2 gap-1">
                            {(betOdds.entrants || []).map(e => (
                              <button key={e.entrant_id} type="button"
                                className={"p-1.5 text-[10px] border rounded " + (betEntrant === e.entrant_id ? "border-[var(--noir-primary)] bg-[rgba(201,164,96,.1)]" : "border-[var(--noir-border)]")}
                                onClick={() => setBetEntrant(e.entrant_id)}>
                                <span className="font-semibold">{e.username}</span>
                                <span className="text-[var(--noir-primary)] ml-1">{e.odds}x</span>
                                <span className="text-[var(--noir-muted)] block text-[9px]">{e.car_name}</span>
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <input type="number" min={1} value={betStake} onChange={e => setBetStake(e.target.value)} placeholder="Stake $"
                              className="flex-1 min-h-[36px] px-2 text-[11px] bg-transparent border border-[var(--noir-border)] rounded text-[var(--noir-foreground)]" />
                            <button type="button" className={styles.btnPrimary + " text-[10px] px-3 min-h-[36px]"} disabled={!betEntrant || !betStake || placingBet}
                              onClick={handlePlaceBet}>{placingBet ? "…" : "Place Bet"}</button>
                            <button type="button" className="text-[10px] text-[var(--noir-muted)] px-2 min-h-[36px]"
                              onClick={() => { setBettingRaceId(null); setBetOdds(null); setBetEntrant(""); setBetStake(""); }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className={styles.btnPrimary + " text-[10px] px-3 py-1 mt-1"}
                          onClick={() => { setBettingRaceId(race.id); fetchBetOdds(race.id); }}>View Odds & Bet</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.panel + " mobile-panel p-3 mb-3"}>
              <div className="font-heading text-[11px] tracking-[.22em] uppercase text-[var(--noir-primary)] mb-2">My Bets</div>
              {!raceBets.open.length && !raceBets.settled.length ? (
                <p className="text-[10px] text-[var(--noir-muted)]">No bets yet. Place one on an open race above!</p>
              ) : (
                <>
                  {raceBets.open.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[10px] text-[var(--noir-muted)] uppercase tracking-wider mb-1">Open</div>
                      {raceBets.open.map(b => (
                        <div key={b.id} className="flex items-center justify-between py-1 border-b border-[var(--noir-border)]">
                          <span className="text-[11px]">{b.entrant_username} <span className="text-[var(--noir-primary)]">{b.odds}x</span></span>
                          <span className="text-[10px] text-[var(--noir-muted)]">${(b.stake || 0).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {raceBets.settled.length > 0 && (
                    <div>
                      <div className="text-[10px] text-[var(--noir-muted)] uppercase tracking-wider mb-1">Settled</div>
                      {raceBets.settled.map(b => (
                        <div key={b.id} className="flex items-center justify-between py-1 border-b border-[var(--noir-border)]">
                          <span className="text-[11px]">{b.entrant_username}
                            <span className={b.status === "won" ? "text-green-400 ml-1" : b.status === "refunded" ? "text-yellow-400 ml-1" : "text-red-400 ml-1"}>
                              {b.status === "won" ? `Won $${Math.round(b.stake * b.odds).toLocaleString()}` : b.status === "refunded" ? "Refunded" : "Lost"}
                            </span>
                          </span>
                          <span className="text-[10px] text-[var(--noir-muted)]">${(b.stake || 0).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              <button type="button" className="text-[10px] text-[var(--noir-primary)] mt-2" onClick={fetchBets}>Refresh</button>
            </div>
          </div>
        )}

        {/* ─── HISTORY TAB ─── */}
        {tab === "history" && (
          <div>
            {/* Season Stats Card */}
            <div className={styles.panel + " mobile-panel p-3 mb-3"}>
              <div className="font-heading text-[11px] tracking-[.22em] uppercase text-[var(--noir-primary)] mb-2">Season Stats</div>
              {!seasonStats ? (
                <p className="text-[10px] text-[var(--noir-muted)]">Loading...</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Races", val: seasonStats.total_races },
                    { label: "Wins", val: seasonStats.wins },
                    { label: "Podiums", val: seasonStats.podiums },
                    { label: "DNFs", val: seasonStats.dnfs },
                    { label: "Earnings", val: `$${(seasonStats.total_earnings || 0).toLocaleString()}` },
                    { label: "Rep", val: seasonStats.racing_rep },
                  ].map(s => (
                    <div key={s.label} className={styles.panel + " mobile-panel p-2"}>
                      <div className="text-[14px] font-semibold text-[var(--noir-primary)]">{s.val}</div>
                      <div className="text-[9px] text-[var(--noir-muted)] uppercase tracking-wider">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Track Records Card */}
            <div className={styles.panel + " mobile-panel p-3 mb-3"}>
              <div className="font-heading text-[11px] tracking-[.22em] uppercase text-[var(--noir-primary)] mb-2">Track Records</div>
              {Object.keys(trackRecords).length === 0 ? (
                <p className="text-[10px] text-[var(--noir-muted)]">No records set yet.</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(trackRecords).map(([tid, rec]) => (
                    <div key={tid} className="flex items-center justify-between py-1 border-b border-[var(--noir-border)]">
                      <span className="text-[11px] font-semibold">{rec.track_name}</span>
                      <div className="text-right">
                        {rec.global_best_lap ? (
                          <div className="text-[10px]"><span className="text-[var(--noir-primary)]">{rec.global_best_lap.toFixed(3)}s</span> <span className="text-[var(--noir-muted)]">by {rec.global_holder}</span></div>
                        ) : <div className="text-[10px] text-[var(--noir-muted)]">No record</div>}
                        {rec.personal_best_lap ? (
                          <div className="text-[9px] text-[var(--noir-muted)]">Your best: {rec.personal_best_lap.toFixed(3)}s</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Race History List */}
            <div className={styles.panel + " mobile-panel p-3"}>
              <div className="font-heading text-[11px] tracking-[.22em] uppercase text-[var(--noir-primary)] mb-2">Recent Races</div>
              {raceHistory.length === 0 ? (
                <p className="text-[10px] text-[var(--noir-muted)]">No completed races yet.</p>
              ) : (
                <div className="space-y-1">
                  {raceHistory.map(r => (
                    <div key={r.race_id} className="flex items-center justify-between py-1.5 border-b border-[var(--noir-border)]">
                      <div>
                        <div className="text-[11px] font-semibold">{r.track_name}</div>
                        <div className="text-[9px] text-[var(--noir-muted)]">{r.laps} laps · {r.weather} · {r.num_entrants} cars</div>
                      </div>
                      <div className="text-right">
                        {r.dnf ? (
                          <span className="text-[11px] text-red-400">DNF</span>
                        ) : (
                          <span className="text-[11px]">P{r.position} <span className="text-[var(--noir-primary)]">${(r.cash || 0).toLocaleString()}</span></span>
                        )}
                        <div className="text-[9px] text-[var(--noir-muted)]">{r.completed_at ? new Date(r.completed_at).toLocaleDateString() : ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="text-[10px] text-[var(--noir-primary)] mt-2" onClick={fetchHistory}>Refresh</button>
            </div>
          </div>
        )}
        </div>
    </div>
  );
}
