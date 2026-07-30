import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Droplets,
  Bug,
  Leaf,
  Lightbulb,
  Package,
  Scissors,
  Shield,
  ShoppingCart,
  Sparkles,
  Swords,
  Users,
  Warehouse,
} from "lucide-react";
import api from "../../utils/api";
import WeedEmpire3D from "../../components/weed/WeedEmpire3D";
import WeedShop from "../../components/weed/WeedShop";
import styles from "../../styles/noir.module.css";

const TABS = [
  { id: "grow", label: "Grow", Icon: Leaf },
  { id: "shop", label: "Equipment", Icon: ShoppingCart },
  { id: "stash", label: "Stash / Sell", Icon: Package },
  { id: "crew", label: "Crew", Icon: Users },
  { id: "house", label: "House", Icon: Warehouse },
  { id: "raid", label: "Raid", Icon: Swords },
];

const SELL_UNIT_GRAMS = { g: 1, oz: 28, lb: 448, kg: 1000 };
const SELL_BULK_MULT = { g: 1, oz: 1, lb: 1.03, kg: 1.05 };

function weedActionCodePayload(data) {
  const name = String(data?.action_code_name || "");
  const token = name && typeof data?.[name] === "string" ? data[name] : "";
  return name && token ? { action_code_name: name, [name]: token } : {};
}

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

function shortReadyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "soon";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay
    ? `today at ${time}`
    : date.toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function CareMeter({ label, pct, hoursLeft, colorClass, warn, fillUp = false }) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  const ready = fillUp && (warn || v >= 99.5);
  const bar = fillUp
    ? colorClass
    : v > 50
      ? colorClass
      : v > 25
        ? "bg-amber-500"
        : "bg-red-500";
  const hoursLabel =
    hoursLeft == null
      ? ""
      : ready || (fillUp && Number(hoursLeft) <= 0)
        ? " · ready"
        : ` · ${Number(hoursLeft).toFixed(1)}h`;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between gap-2 text-[10px]">
        <span className={warn || ready ? "text-amber-300" : "text-muted-foreground"}>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {v.toFixed(0)}%{hoursLabel}
        </span>
      </div>
      <div className="h-1.5 rounded bg-zinc-800 overflow-hidden">
        <div className={`h-full transition-all ${bar}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export default function WeedEmpire() {
  const navigate = useNavigate();
  const actionCodeRef = useRef({});
  const [loading, setLoading] = useState(true);
  const [staffPreview, setStaffPreview] = useState(false);
  const [farm, setFarm] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [tab, setTab] = useState("grow");
  const [selectedPlotId, setSelectedPlotId] = useState(null);
  const [selectedPlotIds, setSelectedPlotIds] = useState([]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [strainId, setStrainId] = useState("northern_lights");
  const [soilType, setSoilType] = useState("soil_conventional");
  const [sellUnit, setSellUnit] = useState("g");
  const [sellAmount, setSellAmount] = useState(1);
  const [sellStrain, setSellStrain] = useState("");
  const [shopGroup, setShopGroup] = useState("lighting");
  const [fx, setFx] = useState(null);
  const [fxNonce, setFxNonce] = useState(0);
  const [targets, setTargets] = useState([]);
  const [raidMeta, setRaidMeta] = useState({
    raid_cooldown_hours: 3,
    raid_cooldown_scope: "per_target",
    raid_unlocked: true,
    required_grower_level: 5,
    required_target_grower_level: 5,
  });
  const [raidFx, setRaidFx] = useState(null);
  const [bustModal, setBustModal] = useState(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawConfirm, setWithdrawConfirm] = useState(null); // null | { amount, label }
  const [bankAmount, setBankAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const farmUpdatedAtRef = useRef("");

  const applyFarm = useCallback((f, { force = false } = {}) => {
    if (!f) return;
    const nextAt = String(f.updated_at || "");
    const prevAt = farmUpdatedAtRef.current;
    // Ignore stale /status polls that would restore stash after a sell.
    // Always apply forced updates from sell / other mutations.
    if (!force && prevAt && nextAt && nextAt < prevAt) {
      return;
    }
    if (nextAt) farmUpdatedAtRef.current = nextAt;
    setFarm({
      ...f,
      stash: { ...(f.stash || {}) },
      curing: [...(f.curing || [])],
    });
    if (f?.plots?.length) {
      const ids = new Set(f.plots.map((p) => p.id));
      setSelectedPlotIds((prev) => {
        const kept = (prev || []).filter((id) => ids.has(id));
        if (kept.length) return kept;
        return [f.plots[0].id];
      });
      setSelectedPlotId((prev) => {
        if (prev && ids.has(prev)) return prev;
        return f.plots[0].id;
      });
    }
    const stashKeys = Object.keys(f?.stash || {});
    setSellStrain((s) => {
      if (s && stashKeys.includes(s)) return s;
      return stashKeys[0] || "";
    });
  }, []);

  const run = async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Action failed";
      toast.error(typeof detail === "string" ? detail : "Action failed");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const [flagsRes, staffRes, statusRes] = await Promise.all([
        api.get("/store/item-flags").catch(() => ({ data: {} })),
        api.get("/auth/staff-flags").catch(() => ({ data: {} })),
        api.get("/weed-empire/status"),
      ]);
      const live = !!flagsRes.data?.flags?.weed_empire;
      const isStaff = !!(staffRes.data?.is_admin || staffRes.data?.is_moderator || staffRes.data?.has_admin_email);
      if (!live && !isStaff) {
        toast.error("Not available yet");
        navigate("/dashboard", { replace: true });
        return;
      }
      setStaffPreview(!live && isStaff);
      applyFarm(statusRes.data?.farm);
      setCatalog(statusRes.data?.catalog);
      actionCodeRef.current = weedActionCodePayload(statusRes.data);
      const dailyCash = statusRes.data?.exclusive_daily_cash;
      if (dailyCash?.cash) {
        toast.success(`Acapulco Gold: $${Number(dailyCash.cash).toLocaleString()} cash credited`);
      }
      if (statusRes.data?.bust) {
        setBustModal(statusRes.data.bust);
        const fled = statusRes.data.bust?.assistant_fled;
        toast.error(
          fled
            ? "Heat bust — jailed 5 minutes. Raid-protected 6 hours. Assistant fled; rehire required."
            : "Heat bust — jailed 5 minutes. Raid-protected 6 hours. Exclusive strains kept."
        );
      }
      if (statusRes.data?.assistant_run?.message) {
        toast.message(statusRes.data.assistant_run.message);
      }
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Failed to load";
      toast.error(typeof detail === "string" ? detail : "Not available yet");
      navigate("/dashboard", { replace: true });
    } finally {
      setLoading(false);
    }
  }, [applyFarm, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab !== "grow") return undefined;
    const refresh = window.setInterval(async () => {
      try {
        const { data } = await api.get("/weed-empire/status");
        applyFarm(data?.farm);
        actionCodeRef.current = weedActionCodePayload(data);
      } catch {
        // Keep the current view if a background refresh briefly fails.
      }
    }, 60000);
    return () => window.clearInterval(refresh);
  }, [tab, applyFarm]);

  const selectedPlot = useMemo(
    () => (farm?.plots || []).find((p) => p.id === selectedPlotId) || farm?.plots?.[0],
    [farm, selectedPlotId]
  );

  const selectedIdSet = useMemo(() => new Set(selectedPlotIds), [selectedPlotIds]);

  const selectedPlots = useMemo(() => {
    const plots = farm?.plots || [];
    if (!selectedPlotIds.length) return selectedPlot ? [selectedPlot] : [];
    return selectedPlotIds.map((id) => plots.find((p) => p.id === id)).filter(Boolean);
  }, [farm, selectedPlotIds, selectedPlot]);

  const isPlantablePlot = (p) => !p || p.state === "empty" || p.state === "dead" || !p.strain_id;
  const isGrowingPlot = (p) =>
    p?.strain_id && p.state !== "empty" && p.state !== "dead";
  const isReadyPlot = (p) =>
    p?.stage === "harvest_ready" || p?.state === "harvest_ready";

  const plantableSelected = useMemo(
    () => selectedPlots.filter(isPlantablePlot),
    [selectedPlots]
  );
  const growingSelected = useMemo(
    () => selectedPlots.filter(isGrowingPlot),
    [selectedPlots]
  );
  const readySelected = useMemo(
    () => selectedPlots.filter(isReadyPlot),
    [selectedPlots]
  );
  const miteSelected = useMemo(
    () =>
      growingSelected.filter(
        (p) => !!p.mite_infested || Number(p.mite_infestation_pct || 0) > 0
      ),
    [growingSelected]
  );

  const togglePlotSelect = (plotId) => {
    setSelectedPlotId(plotId);
    if (!multiSelect) {
      setSelectedPlotIds([plotId]);
      return;
    }
    setSelectedPlotIds((prev) => {
      if (prev.includes(plotId)) {
        if (prev.length <= 1) return prev;
        return prev.filter((id) => id !== plotId);
      }
      return [...prev, plotId];
    });
  };

  const selectPlotsBy = (predicate) => {
    const ids = (farm?.plots || []).filter(predicate).map((p) => p.id);
    if (!ids.length) {
      toast.message("No matching pots");
      return;
    }
    setMultiSelect(true);
    setSelectedPlotIds(ids);
    setSelectedPlotId(ids[0]);
  };

  const strainMap = useMemo(() => {
    const m = {};
    (catalog?.strains || []).forEach((s) => {
      m[s.id] = s;
    });
    return m;
  }, [catalog]);

  const unlockedStrains = useMemo(() => {
    const unlocks = new Set(farm?.unlocks || []);
    const exclusiveOwned = new Set(farm?.exclusive_strain_ids || []);
    const gpOwned = new Set(farm?.game_pass_strain_ids || []);
    const growerLv = Number(farm?.grower_level || 1);
    const minExclusiveLv = Number(
      farm?.exclusive_min_grower_level || catalog?.exclusive_min_grower_level || 2
    );
    return (catalog?.strains || []).filter((s) => {
      if (s.loot_exclusive) {
        return exclusiveOwned.has(s.id) && growerLv >= minExclusiveLv;
      }
      if (s.game_pass_strain) {
        return gpOwned.has(s.id);
      }
      return unlocks.has(s.id) || (s.unlock_house_tier || 0) <= (farm?.house_tier || 0);
    });
  }, [catalog, farm]);

  const ownedExclusiveStrains = useMemo(() => farm?.exclusive_strains || [], [farm]);
  const ownedGamePassStrains = useMemo(() => farm?.game_pass_strains || [], [farm]);

  const sellPreview = useMemo(() => {
    const amount = Number(sellAmount);
    const grams = Number.isFinite(amount) && amount > 0 ? amount * (SELL_UNIT_GRAMS[sellUnit] || 1) : 0;
    const stashKeys = Object.keys(farm?.stash || {});
    const strainKey = sellStrain && farm?.stash?.[sellStrain] != null ? sellStrain : stashKeys[0] || "";
    const available = Number(farm?.stash?.[strainKey] || 0);
    // Allow 1-decimal UI rounding (e.g. 0.099g shown/typed as 0.1g) — backend clamps to stash.
    const enough =
      grams > 0 &&
      (grams <= available + 1e-6 || (grams <= available + 0.05 && Math.round(grams * 10) === Math.round(available * 10)));
    const sellGrams = enough && grams > available ? available : grams;
    const pricePerOz = Number(farm?.street_price_per_oz?.[strainKey] || 0);
    const gross = Math.floor((sellGrams / 28) * pricePerOz * (SELL_BULK_MULT[sellUnit] || 1));
    const remainingCap = Number(farm?.daily_sold_remaining || 0);
    // Dust amounts can floor to $0 — still allow clearing full stash for $1 (matches backend).
    const clearingDust = enough && available > 0 && sellGrams >= available - 1e-6 && gross <= 0;
    const payout = Math.min(clearingDust ? 1 : gross, remainingCap);
    let hint = "";
    if (!strainKey || available <= 0) hint = "No stash selected";
    else if (!(amount > 0)) hint = "Enter an amount or tap Max";
    else if (!enough) hint = `Not enough stash — need ${grams.toFixed(2)}g, have ${available.toFixed(2)}g`;
    else if (!(remainingCap > 0)) hint = "Daily sell cap reached";
    else if (!(pricePerOz > 0)) hint = "No street price for this strain";
    else if (!(payout > 0)) hint = "Sale too small for street price — try a bit more, or use Max";
    else hint = `You receive about ${money(payout)}${gross > remainingCap ? " (daily cap)" : ""}`;
    return {
      grams: sellGrams,
      requestedGrams: grams,
      available,
      strainKey,
      payout,
      valid: amount > 0 && enough && pricePerOz > 0 && remainingCap > 0 && payout > 0,
      capped: !clearingDust && gross > remainingCap,
      hint,
    };
  }, [farm, sellAmount, sellStrain, sellUnit]);

  const plant = ({ scavengedSeed = false } = {}) =>
    run(async () => {
      const ids = scavengedSeed
        ? [(plantableSelected[0] || selectedPlot)?.id].filter(Boolean)
        : plantableSelected.map((p) => p.id);
      if (!ids.length) {
        toast.error("Select empty pots to plant");
        return;
      }
      const { data } = await api.post("/weed-empire/plant", {
        plot_ids: ids,
        plot_id: ids[0],
        strain_id: scavengedSeed ? "ditch_weed" : strainId,
        soil_type: scavengedSeed ? "soil_conventional" : soilType,
        ...(scavengedSeed ? actionCodeRef.current : {}),
      });
      applyFarm(data.farm, { force: true });
      const n = Number(data.planted || ids.length);
      toast.success(
        data.scavenged_seed
          ? "Found some rough seeds — Ditch Weed planted"
          : n > 1
            ? `Planted ${n} pots`
            : "Planted"
      );
      setFx("plant");
      setFxNonce((x) => x + 1);
      setTimeout(() => setFx(null), 400);
    });

  const triggerFx = (kind) => {
    setFx(kind);
    setFxNonce((n) => n + 1);
  };

  const water = () =>
    run(async () => {
      const ids = growingSelected.map((p) => p.id);
      if (!ids.length) {
        toast.error("Select growing pots to water");
        return;
      }
      const { data } = await api.post("/weed-empire/water", { plot_ids: ids, plot_id: ids[0] });
      applyFarm(data.farm, { force: true });
      triggerFx("water");
      toast.success(Number(data.tended || ids.length) > 1 ? `Watered ${data.tended} pots` : "Watered");
    });

  const feed = () =>
    run(async () => {
      const ids = growingSelected.map((p) => p.id);
      if (!ids.length) {
        toast.error("Select growing pots to feed");
        return;
      }
      const { data } = await api.post("/weed-empire/feed", { plot_ids: ids, plot_id: ids[0] });
      applyFarm(data.farm, { force: true });
      triggerFx("feed");
      toast.success(Number(data.tended || ids.length) > 1 ? `Fed ${data.tended} pots` : "Fed");
    });

  const cleanRoom = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/clean-room");
      applyFarm(data.farm, { force: true });
      triggerFx("clean");
      toast.success(`Grow room cleaned for ${money(data.cost)}`);
    });

  const treatMites = () =>
    run(async () => {
      const ids = miteSelected.map((p) => p.id);
      if (!ids.length) {
        toast.error("Select pots with mites to treat");
        return;
      }
      const { data } = await api.post("/weed-empire/treat-mites", { plot_ids: ids, plot_id: ids[0] });
      applyFarm(data.farm, { force: true });
      triggerFx("ipm");
      const n = Number(data.treated || ids.length);
      toast.success(
        n > 1
          ? `Treated mites on ${n} pots (${Number(data.treatment_effect_pct || 0).toFixed(0)}%) for ${money(data.cost)}`
          : `Spider mites treated (${Number(data.treatment_effect_pct || 0).toFixed(0)}% effective) for ${money(data.cost)}`
      );
    });

  const harvest = () =>
    run(async () => {
      const ids = readySelected.map((p) => p.id);
      if (!ids.length) {
        toast.error("Select ready pots to harvest");
        return;
      }
      const { data } = await api.post("/weed-empire/harvest", {
        plot_ids: ids,
        plot_id: ids[0],
        ...actionCodeRef.current,
      });
      applyFarm(data.farm, { force: true });
      triggerFx("harvest_trim");
      const n = Number(data.harvested || ids.length);
      toast.success(
        n > 1 ? `Harvested ${n} pots · ${data.grams}g — curing` : `Harvested ${data.grams}g — curing`
      );
      if (data.leveled_up) toast.success(`Grower level up! Lv ${data.grower_level}`);
    });

  const upgradeEquip = (categoryId) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/upgrade-equipment", { category_id: categoryId });
      applyFarm(data.farm, { force: true });
      if (data.rebought) {
        toast.success(`Rebought at Lv ${data.level}`);
        return;
      }
      const y = data.yield_hint;
      toast.success(
        y
          ? `Upgraded to Lv ${data.level} (+${Math.round(y * 100)}% yield / level)`
          : `Upgraded to Lv ${data.level}`
      );
    });

  const buySoil = (type, bags = 1) =>
    run(async () => {
      const n = Math.max(1, Math.min(50, Number(bags) || 1));
      const { data } = await api.post("/weed-empire/buy-soil", { soil_type: type, bags: n });
      applyFarm(data.farm, { force: true });
      toast.success(`Bought ${type.replace(/_/g, " ")} (+${data.added} charges)`);
    });

  const sell = () =>
    run(async () => {
      const sid =
        sellPreview.strainKey ||
        sellStrain ||
        Object.keys(farm?.stash || {})[0] ||
        "";
      if (!sid) {
        toast.error("No stash to sell");
        return;
      }
      if (sid !== sellStrain) setSellStrain(sid);
      const { data } = await api.post("/weed-empire/sell", {
        strain_id: sid,
        amount: Number(sellAmount),
        unit: sellUnit,
        ...actionCodeRef.current,
      });
      applyFarm(data.farm, { force: true });
      const left = Number(data.farm?.stash?.[sid] || 0);
      if (left <= 0) setSellAmount(0);
      else if (Number(sellAmount) > left) {
        setSellAmount(sellUnit === "g" ? Math.floor(left * 10) / 10 : Number((left / (SELL_UNIT_GRAMS[sellUnit] || 1)).toFixed(2)));
      }
      toast.success(`Sold for ${money(data.payout)} @ ${money(data.effective_price_per_oz)}/oz`);
      if (data.leveled_up) toast.success(`Grower level up! Lv ${data.grower_level}`);
    });

  const upgradeHouse = (tier) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/upgrade-house", { target_tier: tier });
      applyFarm(data.farm, { force: true });
      toast.success("House upgraded");
    });

  const loadTargets = () =>
    run(async () => {
      const { data } = await api.get("/weed-empire/raid/targets");
      setTargets(data.targets || []);
      setRaidMeta({
        raid_cooldown_hours: data.raid_cooldown_hours || 3,
        raid_cooldown_scope: data.raid_cooldown_scope || "per_target",
        raid_unlocked: data.raid_unlocked !== false,
        required_grower_level: data.required_grower_level || 5,
        required_target_grower_level: data.required_target_grower_level || 5,
      });
    });

  const raid = (targetUserId, sabotage = false) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/raid", {
        target_user_id: targetUserId,
        sabotage,
        ...actionCodeRef.current,
      });
      applyFarm(data.farm, { force: true });
      const tid = data.target_user_id || targetUserId;
      if (tid && data.raid_available_at) {
        setTargets((list) =>
          list.map((t) =>
            t.user_id === tid
              ? { ...t, raid_ready: false, raid_available_at: data.raid_available_at }
              : t
          )
        );
      }
      if (data.success) {
        const eq = data.stolen?.equipment?.name;
        const grams = data.stolen?.grams_total;
        setRaidFx({ at: Date.now(), grams, eq });
        window.setTimeout(() => setRaidFx(null), 1800);
        toast.success(
          `Raid success — ${grams != null ? `${Number(grams).toFixed(0)}g, ` : ""}cash ${money(data.stolen?.cash || 0)}${eq ? `, ${eq}` : ""}`
        );
      } else {
        toast.error(`Raid failed${data.fine ? ` (fine ${money(data.fine)})` : ""}`);
      }
    });

  const coolOff = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/cool-off");
      applyFarm(data.farm, { force: true });
      if (data.cleared) {
        toast.success(`Heat cleared (−${data.cleared}) for ${money(data.cost)}`);
      } else {
        toast.success("Heat already cool");
      }
    });

  const withdrawCash = (amount) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/withdraw", { amount: Math.floor(Number(amount)) });
      applyFarm(data.farm, { force: true });
      setWithdrawAmount("");
      setWithdrawConfirm(null);
      toast.success(`Withdrew ${money(data.withdrawn)} to personal money`);
    });

  const requestWithdraw = (amount, label = "Withdraw") => {
    const n = Math.floor(Number(amount));
    if (!(n > 0)) return;
    setWithdrawConfirm({ amount: n, label });
  };

  const expandSafetyBank = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/safety-bank/expand");
      applyFarm(data.farm, { force: true });
      toast.success(`Safety Deposit +${money(data.added_capacity)} for ${money(data.cost)}`);
    });

  const depositSafetyBank = (amount) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/safety-bank/deposit", {
        amount: Math.floor(Number(amount)),
      });
      applyFarm(data.farm, { force: true });
      setBankAmount("");
      toast.success(`Deposited ${money(data.deposited)} to Safety Deposit`);
    });

  const withdrawSafetyBank = (amount) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/safety-bank/withdraw", {
        amount: Math.floor(Number(amount)),
      });
      applyFarm(data.farm, { force: true });
      setBankAmount("");
      toast.success(`Moved ${money(data.withdrawn)} back to business cash`);
    });

  const dealerSell = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/dealers/sell", actionCodeRef.current);
      applyFarm(data.farm, { force: true });
      toast.success(`Dealers moved product for ${money(data.payout)}`);
    });

  const upgradeDealers = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/upgrade-dealers");
      applyFarm(data.farm, { force: true });
      toast.success(`Dealers now Lv ${data.farm?.dealers_level}`);
    });

  const hireAssistant = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/assistant/hire");
      applyFarm(data.farm, { force: true });
      toast.success("Worker hired");
    });

  const setAssistantMode = (mode, slot = 0) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/assistant/mode", { mode, slot });
      applyFarm(data.farm, { force: true });
      if (data.assistant_run?.message) toast.message(data.assistant_run.message);
    });

  const setAssistantEnabled = (enabled, slot = 0) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/assistant/enabled", { enabled, slot });
      applyFarm(data.farm, { force: true });
      if (data.assistant_run?.message) toast.message(data.assistant_run.message);
    });

  const setAssistantPlantPrefs = (slot, strain_id, soil_type) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/assistant/plant-prefs", {
        slot,
        strain_id,
        soil_type,
      });
      applyFarm(data.farm, { force: true });
      if (data.assistant_run?.message) toast.message(data.assistant_run.message);
      else toast.success("Plant prefs saved");
    });

  const equipStolen = (index) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/stolen-equipment/equip", { index });
      applyFarm(data.farm, { force: true });
      toast.success(`Equipped ${data.equipped?.name || "gear"}`);
    });

  if (loading) {
    return (
      <div className={`${styles.pageContent} mobile-page-root p-6 text-sm text-muted-foreground`}>
        Loading weed empire…
      </div>
    );
  }

  if (!farm) return null;

  const capPct = Math.min(100, ((farm.daily_sold_usd || 0) / (farm.daily_sold_cap || 1)) * 100);
  const selStrain = strainMap[selectedPlot?.strain_id] || {};
  const plantStrain = strainMap[strainId] || {};
  const plantSeedCost = Number(plantStrain.seed_cost || 0);
  const plantCount = Math.max(1, plantableSelected.length || (isPlantablePlot(selectedPlot) ? 1 : 0));
  const plantTotalSeedCost = plantSeedCost * plantCount;
  const selectedSoilStock = Number(farm.soil_stock?.[soilType] || 0);
  const canAffordPlant =
    plantableSelected.length > 0 &&
    Number(farm.business_cash || 0) >= plantTotalSeedCost &&
    selectedSoilStock >= plantCount;
  const miteTreatCost = miteSelected.reduce(
    (sum, p) => sum + Number(p.mite_treatment_cost || 0),
    0
  );
  const raidUnlocked = Number(farm.grower_level || 1) >= Number(raidMeta.required_grower_level || 5);
  const assistant = farm.assistant || {};
  const heatHigh = Number(farm.heat || 0) >= Number(farm.heat_bust_threshold || 95);
  const coolCost = Number(farm.cool_off_cost || 0);
  const heatBand = farm.heat_gain_rate_band || [3, 8];
  const heatBandLo = Number(heatBand[0] ?? 3);
  const heatBandHi = Number(heatBand[1] ?? 8);
  const reserveCash = Number(farm.business_cash_reserve || 50000);
  const dailyWithdrawCap = Number(farm.daily_withdraw_cap || 250_000_000);
  const dailyWithdrawRemaining = Math.max(
    0,
    Number(farm.daily_withdraw_remaining ?? dailyWithdrawCap - Number(farm.daily_withdrawn_usd || 0))
  );
  const afterReserve = Math.max(0, Number(farm.business_cash || 0) - reserveCash);
  const withdrawable = Math.max(
    0,
    Number(farm.withdrawable_cash ?? Math.min(afterReserve, dailyWithdrawRemaining))
  );
  const cleanlinessPct = Math.max(0, Math.min(100, Number(farm.cleanliness_pct ?? farm.cleanliness ?? 100)));
  const cleanlinessRisk = cleanlinessPct < 30;
  const mitePct = Math.max(0, Math.min(100, Number(selectedPlot?.mite_infestation_pct || 0)));
  const miteInfested = !!selectedPlot?.mite_infested || mitePct > 0;

  return (
    <div className={`${styles.pageContent} mobile-page-root max-w-6xl mx-auto px-3 py-4 space-y-4`}>
      <header className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-500/80 font-heading">Money</p>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-heading text-foreground">Weed Business Empire</h1>
          <p className="text-xs text-muted-foreground mt-1 hidden sm:block">
            Upgrades use business cash only. Personal withdraw is fixed at {money(dailyWithdrawCap)}/day (keep{" "}
            {money(reserveCash)} in the business). Sell cap upgrades are separate — Points Store.
            {staffPreview ? (
              <span className="ml-2 inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                Staff preview
              </span>
            ) : null}
          </p>
          {staffPreview ? (
            <span className="mt-1 sm:hidden inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
              Staff preview
            </span>
          ) : null}
        </div>
        <div className="w-full sm:w-auto sm:text-right text-sm space-y-1.5 sm:min-w-[11rem]">
          <div className="flex items-baseline justify-between sm:justify-end gap-2">
            <div className="text-[10px] text-muted-foreground uppercase sm:hidden">Business cash</div>
            <div className="font-heading text-emerald-400 text-lg tabular-nums">{money(farm.business_cash)}</div>
          </div>
          <div className="hidden sm:block text-[10px] text-muted-foreground uppercase">Business cash</div>
          <div className="text-[10px] text-muted-foreground">
            Withdrawable {money(withdrawable)}
            <span className="block sm:inline sm:before:content-['·_']">
              Daily left {money(dailyWithdrawRemaining)} / {money(dailyWithdrawCap)}
            </span>
          </div>
          <div className="flex flex-wrap sm:justify-end gap-1">
            <input
              type="number"
              min={1}
              max={withdrawable || undefined}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Amount"
              disabled={busy || withdrawable <= 0}
              className="flex-1 sm:flex-none w-auto sm:w-24 min-w-0 rounded border border-border/50 bg-zinc-900/80 px-2 py-1 text-xs tabular-nums min-h-10 disabled:opacity-40"
            />
            <button
              type="button"
              disabled={busy || withdrawable <= 0 || !(Number(withdrawAmount) > 0)}
              onClick={() => requestWithdraw(withdrawAmount, "Withdraw")}
              className="text-[10px] uppercase px-2.5 py-1 rounded border border-emerald-500/40 text-emerald-300 tap-feedback min-h-10 disabled:opacity-40"
            >
              Withdraw
            </button>
            <button
              type="button"
              disabled={busy || withdrawable <= 0}
              onClick={() => requestWithdraw(withdrawable, "Max withdraw")}
              className="text-[10px] uppercase px-2.5 py-1 rounded bg-emerald-800/70 tap-feedback min-h-10 disabled:opacity-40"
            >
              Max
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded border border-border/50 bg-card/40 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
              Daily sell cap
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {Number(farm.daily_cap_bonus_tiers || 0)}/{Number(farm.daily_cap_bonus_max_tiers || 19)} tiers
            </span>
          </div>
          <div className="font-heading text-sm tabular-nums text-foreground">
            {money(farm.daily_sold_usd)} / {money(farm.daily_sold_cap)}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Street &amp; dealer sales only. Base {money(farm.daily_sell_cap_base || 250_000_000)}; +
            {money(farm.daily_sell_cap_step || 250_000_000)} per Points Store buy (max{" "}
            {money(5_000_000_000)}). Withdraw stays {money(dailyWithdrawCap)}/day.
          </p>
          {farm.daily_cap_next_cost_points != null ? (
            <Link
              to="/game/store?tab=upgrades#store-weed-daily-cap"
              className="inline-flex text-[10px] uppercase text-emerald-300 hover:underline"
            >
              Upgrade in Points Store · {farm.daily_cap_next_cost_points} pts
            </Link>
          ) : (
            <span className="text-[10px] text-emerald-400/80 uppercase">Sell cap maxed</span>
          )}
        </div>

        <div className="rounded border border-border/50 bg-card/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> Safety Deposit
            </div>
            {farm.safety_bank_unlocked ? (
              <span className="text-[10px] text-emerald-400/90 uppercase">Unlocked</span>
            ) : (
              <span className="text-[10px] text-amber-300/90 uppercase">Locked</span>
            )}
          </div>
          {!farm.safety_bank_unlocked ? (
            <>
              <p className="text-[10px] text-muted-foreground">
                Raid- and bust-safe vault. Unlock once in Points Store (
                {farm.safety_bank_unlock_points || 500} pts), then expand capacity with weed business cash.
              </p>
              <Link
                to="/game/store?tab=upgrades#store-weed-safety-deposit"
                className="inline-flex text-[10px] uppercase text-emerald-300 hover:underline"
              >
                Unlock in Points Store · {farm.safety_bank_unlock_points || 500} pts
              </Link>
            </>
          ) : (
            <>
              <div className="text-sm tabular-nums font-heading">
                {money(farm.safety_bank_cash)}{" "}
                <span className="text-muted-foreground text-xs font-normal">
                  / {money(farm.safety_bank_capacity)} capacity
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Survives raids and heat busts. Expand: {money(farm.safety_bank_unit_cost || 10_000_000)}{" "}
                business → +{money(farm.safety_bank_unit_capacity || 25_000_000)} (max{" "}
                {money(5_000_000_000)}).
              </p>
              {Number(farm.safety_bank_capacity || 0) <= 0 && (
                <p className="text-[10px] text-amber-300/90">
                  No capacity yet — hit Expand once to unlock room for deposits.
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                <input
                  type="number"
                  min={1}
                  value={bankAmount}
                  onChange={(e) => setBankAmount(e.target.value)}
                  placeholder="Amount"
                  disabled={busy}
                  className="flex-1 min-w-[5rem] rounded border border-border/50 bg-zinc-900/80 px-2 py-1 text-xs tabular-nums min-h-10 disabled:opacity-40"
                />
                <button
                  type="button"
                  disabled={
                    busy ||
                    !(Number(bankAmount) > 0) ||
                    Number(farm.business_cash || 0) < Number(bankAmount) ||
                    Number(farm.safety_bank_capacity || 0) -
                      Number(farm.safety_bank_cash || 0) <
                      Number(bankAmount)
                  }
                  onClick={() => depositSafetyBank(bankAmount)}
                  className="text-[10px] uppercase px-2.5 py-1 rounded border border-emerald-500/40 text-emerald-300 tap-feedback min-h-10 disabled:opacity-40"
                >
                  Deposit
                </button>
                <button
                  type="button"
                  disabled={busy || !(Number(bankAmount) > 0) || Number(farm.safety_bank_cash || 0) < Number(bankAmount)}
                  onClick={() => withdrawSafetyBank(bankAmount)}
                  className="text-[10px] uppercase px-2.5 py-1 rounded border border-border/60 tap-feedback min-h-10 disabled:opacity-40"
                >
                  To business
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !farm.safety_bank_can_expand ||
                    Number(farm.business_cash || 0) < Number(farm.safety_bank_unit_cost || 10_000_000)
                  }
                  onClick={expandSafetyBank}
                  className="text-[10px] uppercase px-2.5 py-1 rounded bg-emerald-800/70 tap-feedback min-h-10 disabled:opacity-40"
                >
                  Expand +{money(farm.safety_bank_unit_capacity || 25_000_000)} ·{" "}
                  {money(farm.safety_bank_unit_cost || 10_000_000)}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {ownedGamePassStrains.length > 0 && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider font-heading text-emerald-300">
            Game Pass strains (permanent)
          </div>
          <ul className="space-y-1 text-xs">
            {ownedGamePassStrains.map((ex) => (
              <li key={ex.strain_id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-heading text-foreground">{ex.name}</span>
                <span className="text-muted-foreground">{ex.buff_label}</span>
                <span className="text-emerald-400/90 text-[10px]">Unlocked</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted-foreground">
            Yours forever from VIP Game Pass. Plant from empty pots. Not stolen on kill (unlike loot exclusives).
            {Number(farm.upgrade_cost_mult || 1) < 0.999 ? (
              <> Upgrade discount active (−{Math.round((1 - Number(farm.upgrade_cost_mult)) * 100)}%).</>
            ) : null}
          </p>
        </div>
      )}

      {ownedExclusiveStrains.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider font-heading text-amber-300">
            Loot exclusive strains
          </div>
          <ul className="space-y-1 text-xs">
            {ownedExclusiveStrains.map((ex) => (
              <li key={ex.strain_id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-heading text-foreground">{ex.name}</span>
                <span className="text-muted-foreground">{ex.buff_label}</span>
                {!ex.active ? (
                  <span className="text-amber-300/90 text-[10px]">
                    Needs Grower Lv {ex.requires_grower_level || 2}+ to plant / activate
                  </span>
                ) : (
                  <span className="text-emerald-400/90 text-[10px]">Active</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted-foreground">
            1 of each in the whole game. Loot grants at most one special — more only by killing holders.
            Ownership and that strain's stash move if someone kills you.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
        <div className="rounded border border-border/50 bg-card/40 p-2">
          <div className="text-muted-foreground flex justify-between gap-1">
            <span className="truncate">Lv {farm.grower_level || 1}</span>
            <span className="tabular-nums shrink-0">
              {farm.grower_xp || 0}/{farm.grower_xp_to_next || 100}
            </span>
          </div>
          <div className="h-1.5 mt-1 rounded bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-amber-500/80"
              style={{ width: `${Math.min(100, farm.grower_xp_pct || 0)}%` }}
            />
          </div>
          <div className="text-[10px] mt-1 text-muted-foreground truncate">{farm.house?.name}</div>
        </div>
        <div className="rounded border border-border/50 bg-card/40 p-2">
          <div className="text-muted-foreground flex justify-between">
            <span>Sell cap</span>
            <span className="tabular-nums">{capPct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 mt-1 rounded bg-zinc-800 overflow-hidden">
            <div className="h-full bg-emerald-500/80" style={{ width: `${capPct}%` }} />
          </div>
          <div className="text-[10px] mt-1 text-muted-foreground truncate tabular-nums">
            {money(farm.daily_sold_usd)} / {money(farm.daily_sold_cap)}
            {farm.daily_cap_next_cost_points != null ? " · Store +" : " · max"}
          </div>
        </div>
        <div
          className={`col-span-2 sm:col-span-1 rounded border p-2 flex items-center justify-between gap-2 ${
            heatHigh ? "border-red-500/60 bg-red-950/30" : "border-border/50 bg-card/40"
          }`}
        >
          <div className="min-w-0">
            <div className="text-muted-foreground">Heat</div>
            <div className={`font-heading tabular-nums ${heatHigh ? "text-red-300" : ""}`}>{farm.heat}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5">
              +{heatBandLo.toFixed(1)}–{heatBandHi.toFixed(1)}%/h
              {heatHigh ? " · bust risk" : ""}
            </div>
          </div>
          <button
            type="button"
            disabled={busy || Number(farm.heat || 0) < 0.5 || Number(farm.business_cash || 0) < coolCost}
            onClick={coolOff}
            className="shrink-0 text-[10px] uppercase px-2.5 py-1.5 rounded border border-border hover:bg-muted/40 tap-feedback touch-manipulation active:scale-[0.97] min-h-10 disabled:opacity-40"
          >
            Clear · {money(coolCost)}
          </button>
        </div>
        <div
          className={`col-span-2 sm:col-span-1 lg:col-span-2 rounded border p-2 ${
            cleanlinessRisk ? "border-red-500/50 bg-red-950/20" : "border-emerald-500/30 bg-card/40"
          }`}
        >
          <CareMeter
            label={cleanlinessRisk ? "Cleanliness · mite risk" : "Cleanliness · safe"}
            pct={cleanlinessPct}
            colorClass={cleanlinessRisk ? "bg-red-500" : "bg-emerald-500"}
            warn={cleanlinessRisk}
            fillUp
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="text-[9px] text-muted-foreground truncate">
              −{Number(farm.cleanliness?.decay_per_hour || 0).toFixed(2)}%/h · IPM{" "}
              {Number(farm.cleanliness?.mite_resistance_pct || 0).toFixed(0)}%
            </div>
            <button
              type="button"
              disabled={
                busy ||
                cleanlinessPct >= 99.5 ||
                Number(farm.business_cash || 0) < Number(farm.cleanliness?.clean_room_cost || 0)
              }
              onClick={cleanRoom}
              className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase text-emerald-300 disabled:opacity-40 min-h-9 px-1"
            >
              <Sparkles className="h-3 w-3" /> Clean · {money(farm.cleanliness?.clean_room_cost || 0)}
            </button>
          </div>
        </div>
      </div>

      <div className="-mx-3 px-3 overflow-x-auto overscroll-x-contain">
        <div className="flex gap-1 min-w-max pb-0.5">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                if (id === "raid" && raidUnlocked) loadTargets();
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded text-xs font-heading uppercase tracking-wide border shrink-0 tap-feedback touch-manipulation min-h-10 ${
                tab === id
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                  : "border-border/40 text-muted-foreground hover:bg-muted/30"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "grow" && (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2">
          {/* Mobile order: Grow (3D) → water/care → pots */}
          <div className="order-1 space-y-3">
            <WeedEmpire3D
              lightClass={farm.active_light_class || "cfl"}
              stage={selectedPlot?.stage || selectedPlot?.state || "empty"}
              progress={selectedPlot?.progress || 0}
              budMeshKey={selStrain.bud_mesh_key || "dense"}
              strainType={selStrain.type || "hybrid"}
              quality={selectedPlot?.quality || 50}
              equipment={farm.equipment || {}}
              houseTier={farm.house_tier || 0}
              houseId={farm.house?.id || "closet"}
              autoWater={!!farm.auto_water}
              autoFeed={!!farm.auto_feed}
              curingCount={(farm.curing || []).length}
              cleanlinessPct={cleanlinessPct}
              miteInfestationPct={mitePct}
              miteInfested={miteInfested}
              fx={fx === "plant" ? null : fx}
              fxNonce={fxNonce}
              onFxDone={() => setFx(null)}
            />
            <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Lightbulb className="w-3 h-3 text-amber-400" />
                {String(farm.active_light_class || "cfl").toUpperCase()} glow
              </span>
              <span>
                Yield ×{(farm.stats?.yield_mult || 1).toFixed(2)} · Quality{" "}
                {(farm.stats?.quality_ceiling || 0).toFixed(0)}
              </span>
            </div>
          </div>

          <div className="order-2 space-y-3">
            {/* Care / water meters sit directly under the grow view */}
            {growingSelected.length > 0 && (
              <div className="space-y-2">
                <div className="rounded border border-border/40 bg-card/30 p-3 space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xs font-heading uppercase text-muted-foreground">
                      {selectedPlotIds.length > 1
                        ? `${selectedPlotIds.length} pots selected`
                        : `Pot ${(farm.plots || []).findIndex((p) => p.id === selectedPlotId) + 1 || 1}`}
                    </div>
                    <div className="text-xs text-foreground truncate">
                      {selectedPlotIds.length > 1
                        ? `${growingSelected.length} growing`
                        : selStrain.name || selectedPlot?.strain_id}
                    </div>
                  </div>
                  {isGrowingPlot(selectedPlot) ? (
                    <>
                      <CareMeter
                        label={
                          isReadyPlot(selectedPlot) ? "Ready to harvest" : "Grow"
                        }
                        pct={(selectedPlot.progress || 0) * 100}
                        hoursLeft={
                          isReadyPlot(selectedPlot) ? 0 : selectedPlot.hours_to_harvest
                        }
                        colorClass={isReadyPlot(selectedPlot) ? "bg-amber-500" : "bg-emerald-500"}
                        warn={isReadyPlot(selectedPlot)}
                        fillUp
                      />
                      <CareMeter
                        label="Water"
                        pct={selectedPlot.water_pct}
                        hoursLeft={selectedPlot.water_hours_left}
                        colorClass="bg-sky-500"
                        warn={selectedPlot.needs_water}
                      />
                      <CareMeter
                        label="Feed"
                        pct={selectedPlot.feed_pct}
                        hoursLeft={selectedPlot.feed_hours_left}
                        colorClass="bg-lime-500"
                        warn={selectedPlot.needs_feed}
                      />
                      {miteInfested && (
                        <>
                          <CareMeter
                            label="Spider mites"
                            pct={mitePct}
                            colorClass="bg-red-500"
                            warn
                            fillUp
                          />
                          <p className="text-[10px] text-red-300">
                            Harvest cut ~{Math.round(Number(selectedPlot.mite_yield_penalty_pct || 0))}%.
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Focus pot is empty — meters show the last tapped growing pot when selected.
                    </p>
                  )}
                  {farm.auto_water || farm.auto_feed ? (
                    <p className="text-[10px] text-emerald-400/90">
                      {farm.auto_water ? "Auto-water on. " : ""}
                      {farm.auto_feed ? "Auto-feed on." : ""}
                    </p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      Auto-water at Irrigation Lv {farm.auto_water_at_irrigation || 5}; feeders at Lv{" "}
                      {farm.auto_feed_at_irrigation || 8}.
                    </p>
                  )}
                  {selectedPlotIds.length > 1 ? (
                    <p className="text-[10px] text-muted-foreground">
                      Actions apply to all selected pots that qualify.
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy || farm.auto_water || growingSelected.length < 1}
                    onClick={water}
                    className="inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded border border-sky-500/40 text-sky-300 text-xs disabled:opacity-40 tap-feedback touch-manipulation active:scale-[0.97] min-h-11"
                  >
                    <Droplets className="w-3.5 h-3.5" />{" "}
                    {farm.auto_water
                      ? "Auto"
                      : growingSelected.length > 1
                        ? `Water ×${growingSelected.length}`
                        : "Water"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || farm.auto_feed || growingSelected.length < 1}
                    onClick={feed}
                    className="inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded border border-lime-500/40 text-lime-300 text-xs disabled:opacity-40 tap-feedback touch-manipulation active:scale-[0.97] min-h-11"
                  >
                    <Leaf className="w-3.5 h-3.5" />{" "}
                    {farm.auto_feed
                      ? "Auto"
                      : growingSelected.length > 1
                        ? `Feed ×${growingSelected.length}`
                        : "Feed"}
                  </button>
                  {miteSelected.length > 0 && (
                    <button
                      type="button"
                      disabled={busy || Number(farm.business_cash || 0) < miteTreatCost}
                      onClick={treatMites}
                      className="col-span-2 inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded border border-red-500/50 text-red-300 text-xs disabled:opacity-40 tap-feedback touch-manipulation active:scale-[0.97] min-h-11"
                    >
                      <Bug className="w-3.5 h-3.5" /> Treat mites
                      {miteSelected.length > 1 ? ` ×${miteSelected.length}` : ""} · {money(miteTreatCost)}
                    </button>
                  )}
                  {readySelected.length > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={harvest}
                      className="col-span-2 inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded bg-amber-600/80 text-xs font-heading tap-feedback touch-manipulation active:scale-[0.97] min-h-11"
                    >
                      <Scissors className="w-3.5 h-3.5" />{" "}
                      {readySelected.length > 1
                        ? `Harvest / Trim ×${readySelected.length}`
                        : "Harvest / Trim"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {plantableSelected.length > 0 && (
              <div className="rounded border border-border/50 p-3 space-y-3 bg-card/30">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-heading uppercase text-muted-foreground">
                      {plantableSelected.some((p) => p.state === "dead") ? "Replant" : "Plant"}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {plantableSelected.length > 1
                        ? `${plantableSelected.length} empty pots selected`
                        : `Pot ${(farm.plots || []).findIndex((p) => p.id === plantableSelected[0]?.id) + 1 || 1}${
                            plantableSelected[0]?.state === "dead" ? " · crop lost" : " · empty"
                          }`}
                    </p>
                  </div>
                  {farm.scavenged_seed_available ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => plant({ scavengedSeed: true })}
                      className="shrink-0 text-[10px] uppercase px-2.5 py-1.5 rounded border border-amber-500/50 bg-amber-500/15 text-amber-200 min-h-10 tap-feedback"
                    >
                      Scavenge $0
                    </button>
                  ) : null}
                </div>

                {plantableSelected.some((p) => p.state === "dead") && (
                  <p className="text-xs text-red-300/80">
                    Uses a fresh seed and soil charge; restarts at seedling.
                  </p>
                )}

                <label className="block space-y-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Seed</span>
                  <select
                    className="w-full bg-background border border-border rounded px-2.5 py-2.5 text-sm min-h-11"
                    value={strainId}
                    onChange={(e) => setStrainId(e.target.value)}
                  >
                    {unlockedStrains.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.loot_exclusive ? "★ " : s.game_pass_strain ? "◆ " : ""}
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="rounded border border-border/40 bg-black/20 px-1.5 py-1.5">
                    <div className="text-muted-foreground text-[9px] uppercase">
                      Seed{plantCount > 1 ? ` ×${plantCount}` : ""}
                    </div>
                    <div className="font-heading text-foreground tabular-nums">
                      {money(plantTotalSeedCost)}
                    </div>
                  </div>
                  <div className="rounded border border-border/40 bg-black/20 px-1.5 py-1.5">
                    <div className="text-muted-foreground text-[9px] uppercase">Grow</div>
                    <div className="font-heading text-foreground">~{plantStrain.base_grow_hours || "?"}h</div>
                  </div>
                  <div className="rounded border border-border/40 bg-black/20 px-1.5 py-1.5">
                    <div className="text-muted-foreground text-[9px] uppercase">Street</div>
                    <div className="font-heading text-foreground tabular-nums truncate">
                      {money(plantStrain.base_price_per_oz)}/oz
                    </div>
                  </div>
                </div>
                {plantStrain?.loot_exclusive && (
                  <p className="text-[10px] text-amber-200/90">
                    Exclusive: {plantStrain.exclusive_buff_label || "farm buff while owned"} · Grower Lv{" "}
                    {farm.exclusive_min_grower_level || 2}+
                  </p>
                )}
                {plantStrain?.game_pass_strain && (
                  <p className="text-[10px] text-emerald-200/90">
                    Game Pass: {plantStrain.exclusive_buff_label || "permanent unlock"}
                  </p>
                )}

                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Soil</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: "soil_conventional", label: "Basic" },
                      { id: "soil_organic", label: "Organic" },
                      { id: "coco", label: "Coco" },
                    ].map((opt) => {
                      const stock = Number(farm.soil_stock?.[opt.id] || 0);
                      const active = soilType === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setSoilType(opt.id)}
                          className={`rounded border px-1.5 py-2 text-center min-h-11 tap-feedback touch-manipulation active:scale-[0.97] ${
                            active
                              ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
                              : "border-border/50 text-muted-foreground"
                          }`}
                        >
                          <div className="text-[11px] font-heading">{opt.label}</div>
                          <div
                            className={`text-[10px] tabular-nums ${
                              stock < plantCount ? "text-amber-300" : ""
                            }`}
                          >
                            {stock} left
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {selectedSoilStock < plantCount && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        buySoil(soilType, Math.max(1, Math.ceil((plantCount - selectedSoilStock) / 4)))
                      }
                      className="w-full text-xs py-2 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 min-h-10 tap-feedback"
                    >
                      Buy soil — need {plantCount - selectedSoilStock} more for {plantCount} pots
                    </button>
                  )}
                </div>

                {!canAffordPlant &&
                selectedSoilStock >= plantCount &&
                Number(farm.business_cash || 0) < plantTotalSeedCost ? (
                  <p className="text-xs text-amber-300">
                    Need {money(plantTotalSeedCost - Number(farm.business_cash || 0))} more business cash
                    {plantCount > 1 ? ` for ${plantCount} pots` : ""}.
                  </p>
                ) : null}

                <button
                  type="button"
                  disabled={busy || !canAffordPlant}
                  onClick={plant}
                  className="w-full py-3 rounded bg-emerald-600/80 hover:bg-emerald-600 text-sm font-heading tap-feedback touch-manipulation active:scale-[0.97] min-h-12 disabled:opacity-40"
                >
                  {plantCount > 1
                    ? `Plant ${plantCount} pots — ${money(plantTotalSeedCost)} + ${plantCount} soil`
                    : `Plant — ${money(plantSeedCost)} + 1 soil`}
                </button>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-heading">
                  Pots · {(farm.plots || []).length}
                  {selectedPlotIds.length > 1 ? ` · ${selectedPlotIds.length} selected` : ""}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {(farm.plots || []).filter((p) => isPlantablePlot(p)).length} empty
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setMultiSelect((v) => {
                      if (v && selectedPlotId) setSelectedPlotIds([selectedPlotId]);
                      return !v;
                    });
                  }}
                  className={`text-[10px] uppercase px-2 py-1 rounded border tap-feedback min-h-8 ${
                    multiSelect
                      ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
                      : "border-border/50 text-muted-foreground"
                  }`}
                >
                  Multi {multiSelect ? "on" : "off"}
                </button>
                <button
                  type="button"
                  onClick={() => selectPlotsBy(isPlantablePlot)}
                  className="text-[10px] uppercase px-2 py-1 rounded border border-border/50 text-muted-foreground tap-feedback min-h-8"
                >
                  All empty
                </button>
                <button
                  type="button"
                  onClick={() => selectPlotsBy(isReadyPlot)}
                  className="text-[10px] uppercase px-2 py-1 rounded border border-amber-500/40 text-amber-200/90 tap-feedback min-h-8"
                >
                  All ready
                </button>
                <button
                  type="button"
                  onClick={() => selectPlotsBy(isGrowingPlot)}
                  className="text-[10px] uppercase px-2 py-1 rounded border border-border/50 text-muted-foreground tap-feedback min-h-8"
                >
                  All growing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMultiSelect(false);
                    if (selectedPlotId) setSelectedPlotIds([selectedPlotId]);
                  }}
                  className="text-[10px] uppercase px-2 py-1 rounded border border-border/50 text-muted-foreground tap-feedback min-h-8"
                >
                  Clear
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mb-1.5">
                {multiSelect
                  ? "Multi on — tap pots to add/remove."
                  : "Tap a pot, or use All empty / Multi for bulk plant."}
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {(farm.plots || []).map((p, idx) => {
                  const st = p.stage || p.state || "empty";
                  const active = selectedIdSet.has(p.id);
                  const focused = p.id === selectedPlotId;
                  const ready = st === "harvest_ready";
                  const growing = p.strain_id && st !== "empty" && st !== "dead";
                  const needsCare = !!(p.needs_water || p.needs_feed || p.mite_infested);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlotSelect(p.id)}
                      className={`relative text-left rounded border px-1.5 py-1.5 min-h-[3.25rem] tap-feedback touch-manipulation active:scale-[0.97] ${
                        active
                          ? focused
                            ? "border-emerald-500/70 bg-emerald-500/15 ring-1 ring-emerald-400/40"
                            : "border-emerald-500/50 bg-emerald-500/10"
                          : ready
                            ? "border-amber-500/50 bg-amber-500/10"
                            : needsCare
                              ? "border-red-500/40 bg-card/40"
                              : "border-border/40 bg-card/30"
                      }`}
                    >
                      <div className="text-[10px] font-heading leading-tight">#{idx + 1}</div>
                      <div className="text-[9px] text-muted-foreground capitalize truncate leading-tight">
                        {String(st).replace(/_/g, " ")}
                      </div>
                      {p.strain_id ? (
                        <div className="truncate text-[9px] text-foreground/80 leading-tight mt-0.5">
                          {strainMap[p.strain_id]?.name || p.strain_id}
                        </div>
                      ) : null}
                      {growing ? (
                        <div className="mt-1 h-1 rounded bg-zinc-800 overflow-hidden">
                          <div
                            className={`h-full ${ready ? "bg-amber-500" : "bg-emerald-500/80"}`}
                            style={{ width: `${Math.min(100, (p.progress || 0) * 100)}%` }}
                          />
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "shop" && (
        <WeedShop
          farm={farm}
          shopGroup={shopGroup}
          setShopGroup={setShopGroup}
          busy={busy}
          onUpgrade={upgradeEquip}
          onBuySoil={buySoil}
        />
      )}

      {tab === "stash" && (
        <div className="space-y-4">
          <div className="rounded border border-border/40 p-3 bg-card/30">
            <div className="text-xs font-heading uppercase text-muted-foreground mb-2">Curing</div>
            {(farm.curing || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No batches curing.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {farm.curing.map((b) => (
                  <li key={b.id}>
                    {strainMap[b.strain_id]?.name || b.strain_id}: {b.grams}g (ready {shortReadyDate(b.ready_at)})
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded border border-border/40 p-3 bg-card/30 space-y-2">
            <div className="text-xs font-heading uppercase text-muted-foreground">Stash / Sell (g · oz · lb · kg)</div>
            <div className="text-sm space-y-1">
              {Object.keys(farm.stash || {}).length === 0 ? (
                <p className="text-muted-foreground">Empty stash.</p>
              ) : (
                Object.entries(farm.stash).map(([sid, g]) => (
                  <div key={sid} className="flex justify-between gap-2">
                    <span>{strainMap[sid]?.name || sid}</span>
                    <span>
                      {Number(g) < 1 ? Number(g).toFixed(2) : Number(g).toFixed(1)}g (
                      {(Number(g) / 28).toFixed(2)} oz)
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-end pt-2">
              <select
                className="bg-background border border-border rounded px-2 py-1.5 text-sm"
                value={sellPreview.strainKey || sellStrain || Object.keys(farm.stash || {})[0] || ""}
                onChange={(e) => setSellStrain(e.target.value)}
              >
                {Object.keys(farm.stash || {}).map((sid) => (
                  <option key={sid} value={sid}>
                    {strainMap[sid]?.name || sid}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0.01}
                step={sellUnit === "g" ? 0.1 : 0.01}
                value={sellAmount}
                onChange={(e) => setSellAmount(e.target.value)}
                className="w-24 bg-background border border-border rounded px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={!sellPreview.strainKey && !Object.keys(farm.stash || {}).length}
                onClick={() => {
                  const sid =
                    sellPreview.strainKey ||
                    (sellStrain && farm.stash?.[sellStrain] != null
                      ? sellStrain
                      : Object.keys(farm.stash || {})[0] || "");
                  if (sid && sid !== sellStrain) setSellStrain(sid);
                  const avail = Number(farm.stash?.[sid] || 0);
                  const unitMult = SELL_UNIT_GRAMS[sellUnit] || 1;
                  const maxInUnit = avail / unitMult;
                  if (sellUnit === "g") {
                    // Floor to 0.1g so Max never rounds above stash (toFixed rounds up).
                    const floored = Math.floor(maxInUnit * 10 + 1e-9) / 10;
                    setSellAmount(floored > 0 ? floored.toFixed(1) : String(maxInUnit));
                  } else {
                    const floored = Math.floor(maxInUnit * 1000 + 1e-9) / 1000;
                    setSellAmount(floored > 0 ? floored.toFixed(3) : String(maxInUnit));
                  }
                }}
                className="px-2 py-1.5 rounded border border-border text-xs text-muted-foreground"
              >
                Max
              </button>
              <select
                className="bg-background border border-border rounded px-2 py-1.5 text-sm"
                value={sellUnit}
                onChange={(e) => {
                  const nextUnit = e.target.value;
                  const sid =
                    sellPreview.strainKey ||
                    (sellStrain && farm.stash?.[sellStrain] != null
                      ? sellStrain
                      : Object.keys(farm.stash || {})[0] || "");
                  const avail = Number(farm.stash?.[sid] || 0);
                  const prevGrams =
                    Number(sellAmount) > 0
                      ? Number(sellAmount) * (SELL_UNIT_GRAMS[sellUnit] || 1)
                      : 0;
                  setSellUnit(nextUnit);
                  // Keep sellable grams when switching units; if amount was 0, leave for Max.
                  if (prevGrams > 0 && avail > 0) {
                    const inUnit = Math.min(prevGrams, avail) / (SELL_UNIT_GRAMS[nextUnit] || 1);
                    const decimals = nextUnit === "g" ? 1 : 3;
                    const factor = 10 ** decimals;
                    const floored = Math.floor(inUnit * factor + 1e-9) / factor;
                    setSellAmount(floored > 0 ? floored.toFixed(decimals) : String(inUnit));
                  }
                }}
              >
                <option value="g">grams</option>
                <option value="oz">oz</option>
                <option value="lb">lb</option>
                <option value="kg">kg</option>
              </select>
              <button
                type="button"
                disabled={busy || !sellPreview.valid}
                onClick={sell}
                className="px-3 py-1.5 rounded bg-emerald-700/80 text-sm font-heading tap-feedback touch-manipulation active:scale-[0.97] min-h-10"
              >
                Sell to street
              </button>
            </div>
            {(sellPreview.strainKey || Object.keys(farm.stash || {}).length > 0) && (
              <p className={`text-xs ${sellPreview.valid ? "text-emerald-400" : "text-amber-400"}`}>
                {sellPreview.hint}
              </p>
            )}
            {(farm.dealers_level || 0) >= 1 ? (
              <div className="space-y-2 rounded border border-border/40 p-2 bg-card/20">
                <div className="text-xs text-muted-foreground">
                  Dealer Lv {farm.dealers_level} / {farm.max_dealers_level || 20}
                  {farm.dealer_drip_fraction != null
                    ? ` · drip ~${Math.round(Number(farm.dealer_drip_fraction) * 100)}%`
                    : ""}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={dealerSell}
                    className="text-xs px-3 py-1.5 rounded border border-border tap-feedback touch-manipulation active:scale-[0.97] min-h-10"
                  >
                    Run dealers
                  </button>
                  {farm.dealers_upgrade_cost != null ? (
                    <button
                      type="button"
                      disabled={busy || Number(farm.business_cash || 0) < Number(farm.dealers_upgrade_cost)}
                      onClick={upgradeDealers}
                      className="text-xs px-3 py-1.5 rounded bg-emerald-800/60 tap-feedback touch-manipulation active:scale-[0.97] min-h-10 disabled:opacity-40"
                    >
                      Upgrade · {money(farm.dealers_upgrade_cost)}
                    </button>
                  ) : (
                    <span className="text-[10px] text-emerald-400 self-center">Dealers maxed</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">Dealers unlock after 5 sells.</p>
            )}
            {(farm.stolen_equipment || []).length > 0 ? (
              <div className="space-y-1 rounded border border-amber-500/30 p-2">
                <div className="text-[10px] uppercase text-amber-300">Stolen gear inventory</div>
                {(farm.stolen_equipment || []).map((item, idx) => (
                  <div key={`${item.category_id}-${idx}`} className="flex justify-between gap-2 text-xs">
                    <span>
                      {item.name || item.category_id} Lv {item.level}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => equipStolen(idx)}
                      className="underline text-emerald-300 min-h-10 tap-feedback"
                    >
                      Equip
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {tab === "crew" && (
        <div className="space-y-3 max-w-lg">
          <div className="rounded border border-border/50 bg-card/40 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              <h2 className="font-heading text-sm uppercase tracking-wide">
                Crew · {assistant.hired_count || 0}/{assistant.max_workers || 2}
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Hire up to 2 workers. Each runs one job: harvest, plant seeds, cool heat, or sell via dealers (25% of
              dealer payout). Plant mode uses the strain &amp; soil you pick and pays from weed business cash (auto-buys
              soil bags if stock runs out).
            </p>
            {(assistant.workers || []).map((w) =>
              w.hired ? (
                <div key={w.slot} className="rounded border border-border/40 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-heading uppercase">{w.label || `Worker ${w.slot + 1}`}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setAssistantEnabled(!w.enabled, w.slot)}
                      className={`text-[10px] uppercase px-3 py-1.5 rounded border min-h-10 tap-feedback ${
                        w.enabled
                          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {w.enabled ? "On" : "Off"}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: "harvest", label: "Harvest" },
                      { id: "plant", label: "Plant" },
                      { id: "cool_heat", label: "Cool heat" },
                      { id: "sell_dealer", label: "Sell to dealer" },
                    ].map((m) => {
                      const locked = m.id === "sell_dealer" && Number(farm.dealers_level || 0) < 1;
                      const active = w.mode === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={busy || locked}
                          onClick={() => setAssistantMode(m.id, w.slot)}
                          className={`text-xs px-2 py-2 rounded border min-h-11 tap-feedback touch-manipulation active:scale-[0.97] disabled:opacity-40 ${
                            active
                              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                              : "border-border/50 text-muted-foreground"
                          }`}
                        >
                          {m.label}
                          {m.id === "sell_dealer" ? (
                            <span className="block text-[9px] opacity-80">
                              uses Dealer Lv {farm.dealers_level || 0}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {w.mode === "plant" ? (
                    <div className="space-y-1.5 rounded border border-border/30 bg-black/20 p-2">
                      <div className="text-[10px] uppercase text-muted-foreground">Auto-plant loadout</div>
                      <select
                        className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs min-h-10"
                        value={w.plant_strain_id || "northern_lights"}
                        disabled={busy}
                        onChange={(e) =>
                          setAssistantPlantPrefs(w.slot, e.target.value, w.plant_soil_type || "soil_conventional")
                        }
                      >
                        {unlockedStrains.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.loot_exclusive ? "★ " : ""}
                            {s.name} (seed {money(s.seed_cost)})
                          </option>
                        ))}
                      </select>
                      <select
                        className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs min-h-10"
                        value={w.plant_soil_type || "soil_conventional"}
                        disabled={busy}
                        onChange={(e) =>
                          setAssistantPlantPrefs(w.slot, w.plant_strain_id || "northern_lights", e.target.value)
                        }
                      >
                        <option value="soil_conventional">
                          Conventional soil (stock {farm.soil_stock?.soil_conventional || 0})
                        </option>
                        <option value="soil_organic">
                          Organic soil (stock {farm.soil_stock?.soil_organic || 0})
                        </option>
                        <option value="coco">Coco (stock {farm.soil_stock?.coco || 0})</option>
                      </select>
                      <p className="text-[10px] text-muted-foreground">
                        Fills every empty pot it can afford in one go (seed + soil from business cash). If it stops early,
                        check Last — usually not enough cash for that strain (e.g. Granddaddy Purple is pricey).
                      </p>
                    </div>
                  ) : null}
                  {w.last_run?.message ? (
                    <p
                      className={`text-[11px] ${
                        w.last_run?.stop_reason &&
                        !["No empty plots", "Stopped after filling available plots"].includes(w.last_run.stop_reason)
                          ? "text-amber-300"
                          : "text-muted-foreground"
                      }`}
                    >
                      Last: {w.last_run.message}
                    </p>
                  ) : null}
                </div>
              ) : null
            )}
            {assistant.can_hire !== false && assistant.hire_cost != null ? (
              <button
                type="button"
                disabled={busy || Number(farm.business_cash || 0) < Number(assistant.hire_cost)}
                onClick={hireAssistant}
                className="text-xs px-3 py-2 rounded bg-emerald-700/80 tap-feedback touch-manipulation active:scale-[0.97] min-h-11 disabled:opacity-40"
              >
                Hire worker {(assistant.hired_count || 0) + 1} · {money(assistant.hire_cost)}
              </button>
            ) : (assistant.hired_count || 0) >= (assistant.max_workers || 2) ? (
              <p className="text-[10px] text-emerald-400">Crew full (2/2)</p>
            ) : null}
          </div>
        </div>
      )}

      {tab === "house" && (
        <div className="space-y-2">
          {(catalog?.houses || []).map((h) => {
            const owned = (farm.house_tier || 0) >= h.tier;
            const next = (farm.house_tier || 0) + 1 === h.tier;
            return (
              <div
                key={h.id}
                className={`rounded border p-3 ${owned ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/40"}`}
              >
                <div className="flex justify-between gap-2">
                  <div>
                    <div className="font-heading">
                      Tier {h.tier}: {h.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {h.plots} plots · {h.description}
                    </div>
                  </div>
                  {owned ? (
                    <span className="text-[10px] uppercase text-emerald-400">Owned</span>
                  ) : next ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => upgradeHouse(h.tier)}
                      className="text-xs px-3 py-1.5 rounded bg-emerald-700/70"
                    >
                      Buy {money(h.cost)}
                    </button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Locked</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "raid" && (
        <div className="space-y-3 relative">
          {raidFx ? (
            <div className="pointer-events-none absolute inset-x-0 -top-1 z-10 flex justify-center">
              <div className="rounded-full border border-emerald-400/40 bg-emerald-950/90 px-3 py-1 text-[11px] text-emerald-200 shadow-lg animate-pulse">
                Raid hit
                {raidFx.grams != null ? ` · ${Number(raidFx.grams).toFixed(0)}g` : ""}
                {raidFx.eq ? ` · ${raidFx.eq}` : ""}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground flex items-start gap-2">
            <Shield className="w-4 h-4 shrink-0 mt-0.5" />
            Reach Grower Lv {raidMeta.required_grower_level || 5} to raid or be raided. Success steals the full stash,
            cash, and one gear line (they keep their upgrade
            level — rebuy in Equipment to restore it; you equip the stolen piece later if your house is too small).
            Cooldown is {raidMeta.raid_cooldown_hours || 3}h per target — you can still raid other growers. After a heat
            bust, growers are raid-protected for {farm.bust_raid_immune_hours || 6}h. Target security caps your odds —
            fully maxed security = 25% success (75% fail).
            {farm.sabotage_unlocked ? " Sabotage heat spike unlocked." : " Harvest 10 plants to unlock sabotage."}
          </p>
          {farm.raid_immune && farm.raid_immune_until ? (
            <p className="text-xs text-emerald-300/90">
              You are raid-protected until {shortReadyDate(farm.raid_immune_until)} (post-bust).
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy || !raidUnlocked}
            onClick={loadTargets}
            className="text-xs px-2 py-1 border rounded disabled:opacity-40 tap-feedback touch-manipulation active:scale-[0.97] min-h-10"
          >
            Refresh targets
          </button>
          <div className="space-y-2">
            {!raidUnlocked ? (
              <p className="text-sm text-amber-300">
                Reach Grower Level {raidMeta.required_grower_level || 5} to unlock raids.
              </p>
            ) : targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No raidable growers right now.</p>
            ) : (
              targets.map((t) => {
                const targetReady = t.raid_ready !== false;
                return (
                  <div
                    key={t.user_id}
                    className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2 rounded border border-border/40 px-3 py-2.5 bg-card/30"
                  >
                    <div className="text-sm min-w-0">
                      <div className="font-heading truncate">{t.username}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Grower Lv {t.grower_level} · Tier {t.house_tier} · stash {t.stash_grams}g · {t.equip_count} gear
                        lines
                        {t.raid_success_chance != null
                          ? ` · ~${Math.round(Number(t.raid_success_chance) * 100)}% success`
                          : ""}
                        {t.security_fully_upgraded ? " · max security" : ""}
                      </div>
                      {!targetReady ? (
                        <div
                          className={`text-[11px] mt-0.5 ${
                            t.raid_immune ? "text-sky-300" : "text-amber-300"
                          }`}
                        >
                          {t.raid_immune && t.raid_immune_until
                            ? `Post-bust protection — raidable ${shortReadyDate(
                                // If attacker also has cooldown, show the later unlock time
                                t.raid_available_at &&
                                  new Date(t.raid_available_at) > new Date(t.raid_immune_until)
                                  ? t.raid_available_at
                                  : t.raid_immune_until
                              )}`
                            : t.raid_available_at
                              ? `Cooldown — ready ${shortReadyDate(t.raid_available_at)}`
                              : "Not raidable yet"}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busy || !targetReady}
                        onClick={() => raid(t.user_id, false)}
                        className="text-xs px-3 py-2 rounded bg-red-800/70 min-h-11 tap-feedback touch-manipulation active:scale-[0.97] disabled:opacity-40"
                      >
                        Raid
                      </button>
                      {farm.sabotage_unlocked ? (
                        <button
                          type="button"
                          disabled={busy || !targetReady}
                          onClick={() => raid(t.user_id, true)}
                          className="text-xs px-3 py-2 rounded border border-amber-500/40 text-amber-200 min-h-11 tap-feedback touch-manipulation active:scale-[0.97] disabled:opacity-40"
                        >
                          + Sabotage
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {bustModal ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded border border-red-500/40 bg-zinc-950 p-4 space-y-3 shadow-xl">
            <h2 className="font-heading text-lg text-red-300">Heat bust</h2>
            <p className="text-sm text-muted-foreground">
              Sustained heat cooked the op. You&apos;re in jail for 5 minutes and unbustable for that whole time
              (nobody can bust you out). Raid-protected for {bustModal?.raid_immune_hours || farm?.bust_raid_immune_hours || 6}{" "}
              hours — nobody can raid you. House dropped a tier, gear halved, stash wiped
              {bustModal?.assistant_fled ? ", and your assistant fled — you&apos;ll need to rehire" : ""}. Safety
              Deposit cash is kept. Exclusive strain ownership is safe — plant a free ditch weed seed when
              you&apos;re out.
            </p>
            <button
              type="button"
              onClick={() => setBustModal(null)}
              className="w-full text-xs uppercase py-2.5 rounded bg-emerald-700/80 min-h-11 tap-feedback"
            >
              Got it — restart seed ready
            </button>
          </div>
        </div>
      ) : null}

      {withdrawConfirm ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded border border-emerald-500/40 bg-zinc-950 p-4 space-y-3 shadow-xl">
            <h2 className="font-heading text-lg text-emerald-300">Confirm withdraw</h2>
            <p className="text-sm text-muted-foreground">
              Move {money(withdrawConfirm.amount)} from weed business cash to your personal money? Daily
              personal withdraw is capped at {money(dailyWithdrawCap)} (this does not use the sell cap).
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setWithdrawConfirm(null)}
                className="flex-1 text-xs uppercase py-2.5 rounded border border-border/60 min-h-11 tap-feedback disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => withdrawCash(withdrawConfirm.amount)}
                className="flex-1 text-xs uppercase py-2.5 rounded bg-emerald-700/80 min-h-11 tap-feedback disabled:opacity-40"
              >
                Confirm {withdrawConfirm.label || "Withdraw"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
