import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  { id: "house", label: "House", Icon: Warehouse },
  { id: "raid", label: "Raid", Icon: Swords },
];

const SELL_UNIT_GRAMS = { g: 1, oz: 28, lb: 448, kg: 1000 };
const SELL_BULK_MULT = { g: 1, oz: 1, lb: 1.03, kg: 1.05 };

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
  const [loading, setLoading] = useState(true);
  const [staffPreview, setStaffPreview] = useState(false);
  const [farm, setFarm] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [tab, setTab] = useState("grow");
  const [selectedPlotId, setSelectedPlotId] = useState(null);
  const [strainId, setStrainId] = useState("northern_lights");
  const [soilType, setSoilType] = useState("soil_conventional");
  const [sellUnit, setSellUnit] = useState("g");
  const [sellAmount, setSellAmount] = useState(1);
  const [sellStrain, setSellStrain] = useState("");
  const [shopGroup, setShopGroup] = useState("lighting");
  const [fx, setFx] = useState(null);
  const [fxNonce, setFxNonce] = useState(0);
  const [targets, setTargets] = useState([]);
  const [busy, setBusy] = useState(false);

  const applyFarm = useCallback((f) => {
    setFarm(f);
    if (f?.plots?.length) {
      setSelectedPlotId((prev) => {
        if (prev && f.plots.some((p) => p.id === prev)) return prev;
        return f.plots[0].id;
      });
    }
    const stashKeys = Object.keys(f?.stash || {});
    if (stashKeys.length) setSellStrain((s) => s || stashKeys[0]);
  }, []);

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

  const strainMap = useMemo(() => {
    const m = {};
    (catalog?.strains || []).forEach((s) => {
      m[s.id] = s;
    });
    return m;
  }, [catalog]);

  const unlockedStrains = useMemo(() => {
    const unlocks = new Set(farm?.unlocks || []);
    return (catalog?.strains || []).filter(
      (s) => unlocks.has(s.id) || (s.unlock_house_tier || 0) <= (farm?.house_tier || 0)
    );
  }, [catalog, farm]);

  const sellPreview = useMemo(() => {
    const amount = Number(sellAmount);
    const grams = amount * (SELL_UNIT_GRAMS[sellUnit] || 1);
    const available = Number(farm?.stash?.[sellStrain] || 0);
    const pricePerOz = Number(farm?.street_price_per_oz?.[sellStrain] || 0);
    const gross = Math.floor((grams / 28) * pricePerOz * (SELL_BULK_MULT[sellUnit] || 1));
    const remainingCap = Number(farm?.daily_sold_remaining || 0);
    return {
      grams,
      available,
      payout: Math.min(gross, remainingCap),
      valid: amount > 0 && grams <= available + 1e-6 && pricePerOz > 0 && remainingCap > 0,
      capped: gross > remainingCap,
    };
  }, [farm, sellAmount, sellStrain, sellUnit]);

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Action failed";
      toast.error(typeof detail === "string" ? detail : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const plant = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/plant", {
        plot_id: selectedPlotId,
        strain_id: strainId,
        soil_type: soilType,
      });
      applyFarm(data.farm);
      toast.success("Planted");
      setFx("plant");
      setFxNonce((n) => n + 1);
      setTimeout(() => setFx(null), 400);
    });

  const triggerFx = (kind) => {
    setFx(kind);
    setFxNonce((n) => n + 1);
  };

  const water = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/water", { plot_id: selectedPlotId });
      applyFarm(data.farm);
      triggerFx("water");
      toast.success("Watered");
    });

  const feed = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/feed", { plot_id: selectedPlotId });
      applyFarm(data.farm);
      triggerFx("feed");
      toast.success("Fed");
    });

  const cleanRoom = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/clean-room");
      applyFarm(data.farm);
      triggerFx("clean");
      toast.success(`Grow room cleaned for ${money(data.cost)}`);
    });

  const treatMites = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/treat-mites", { plot_id: selectedPlotId });
      applyFarm(data.farm);
      triggerFx("ipm");
      toast.success(
        `Spider mites treated (${Number(data.treatment_effect_pct || 0).toFixed(0)}% effective) for ${money(data.cost)}`
      );
    });

  const harvest = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/harvest", { plot_id: selectedPlotId });
      applyFarm(data.farm);
      triggerFx("harvest_trim");
      toast.success(`Harvested ${data.grams}g — curing`);
      if (data.leveled_up) toast.success(`Grower level up! Lv ${data.grower_level}`);
    });

  const upgradeEquip = (categoryId) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/upgrade-equipment", { category_id: categoryId });
      applyFarm(data.farm);
      const y = data.yield_hint;
      toast.success(
        y
          ? `Upgraded to Lv ${data.level} (+${Math.round(y * 100)}% yield / level)`
          : `Upgraded to Lv ${data.level}`
      );
    });

  const buySoil = (type) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/buy-soil", { soil_type: type, bags: 1 });
      applyFarm(data.farm);
      toast.success(`Bought ${type.replace(/_/g, " ")} (+${data.added} charges)`);
    });

  const sell = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/sell", {
        strain_id: sellStrain,
        amount: Number(sellAmount),
        unit: sellUnit,
      });
      applyFarm(data.farm);
      toast.success(`Sold for ${money(data.payout)} @ ${money(data.effective_price_per_oz)}/oz`);
      if (data.leveled_up) toast.success(`Grower level up! Lv ${data.grower_level}`);
    });

  const upgradeHouse = (tier) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/upgrade-house", { target_tier: tier });
      applyFarm(data.farm);
      toast.success("House upgraded");
    });

  const loadTargets = () =>
    run(async () => {
      const { data } = await api.get("/weed-empire/raid/targets");
      setTargets(data.targets || []);
    });

  const raid = (targetUserId, sabotage = false) =>
    run(async () => {
      const { data } = await api.post("/weed-empire/raid", { target_user_id: targetUserId, sabotage });
      applyFarm(data.farm);
      if (data.success) {
        const eq = data.stolen?.equipment?.name;
        toast.success(
          `Raid success — cash ${money(data.stolen?.cash || 0)}${eq ? `, stole ${eq}` : ""}`
        );
      } else {
        toast.error(`Raid failed${data.fine ? ` (fine ${money(data.fine)})` : ""}`);
      }
      loadTargets();
    });

  const coolOff = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/cool-off");
      applyFarm(data.farm);
      toast.success("Heat cooled");
    });

  const dealerSell = () =>
    run(async () => {
      const { data } = await api.post("/weed-empire/dealers/sell");
      applyFarm(data.farm);
      toast.success(`Dealers moved product for ${money(data.payout)}`);
    });

  if (loading) {
    return (
      <div className={`${styles.page} p-6 text-sm text-muted-foreground`}>Loading weed empire…</div>
    );
  }

  if (!farm) return null;

  const capPct = Math.min(100, ((farm.daily_sold_usd || 0) / (farm.daily_sold_cap || 1)) * 100);
  const selStrain = strainMap[selectedPlot?.strain_id] || {};
  const cleanlinessPct = Math.max(0, Math.min(100, Number(farm.cleanliness_pct ?? farm.cleanliness ?? 100)));
  const cleanlinessRisk = cleanlinessPct < 30;
  const mitePct = Math.max(0, Math.min(100, Number(selectedPlot?.mite_infestation_pct || 0)));
  const miteInfested = !!selectedPlot?.mite_infested || mitePct > 0;

  return (
    <div className={`${styles.page} max-w-6xl mx-auto px-3 py-4 space-y-4`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-500/80 font-heading">Money</p>
          <h1 className="text-2xl md:text-3xl font-heading text-foreground">Weed Business Empire</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Business cash only — personal wallet cannot fund upgrades.
            {staffPreview ? (
              <span className="ml-2 inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                Staff preview
              </span>
            ) : null}
          </p>
        </div>
        <div className="text-right text-sm">
          <div className="font-heading text-emerald-400 text-lg">{money(farm.business_cash)}</div>
          <div className="text-[10px] text-muted-foreground uppercase">Business cash</div>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
        <div className="rounded border border-border/50 bg-card/40 p-2">
          <div className="text-muted-foreground flex justify-between">
            <span>Grower Lv {farm.grower_level || 1}</span>
            <span>
              {farm.grower_xp || 0}/{farm.grower_xp_to_next || 100} XP
            </span>
          </div>
          <div className="h-1.5 mt-1 rounded bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-amber-500/80"
              style={{ width: `${Math.min(100, farm.grower_xp_pct || 0)}%` }}
            />
          </div>
          <div className="text-[10px] mt-1 text-muted-foreground">Harvest &amp; sell to level up</div>
        </div>
        <div className="rounded border border-border/50 bg-card/40 p-2">
          <div className="text-muted-foreground">House</div>
          <div className="font-heading">{farm.house?.name}</div>
        </div>
        <div className="rounded border border-border/50 bg-card/40 p-2">
          <div className="text-muted-foreground flex justify-between">
            <span>Daily sell cap</span>
            <span>{capPct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 mt-1 rounded bg-zinc-800 overflow-hidden">
            <div className="h-full bg-emerald-500/80" style={{ width: `${capPct}%` }} />
          </div>
          <div className="text-[10px] mt-1 text-muted-foreground">
            {money(farm.daily_sold_usd)} / {money(farm.daily_sold_cap)}
          </div>
        </div>
        <div className="rounded border border-border/50 bg-card/40 p-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-muted-foreground">Heat</div>
            <div className="font-heading">{farm.heat}</div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={coolOff}
            className="text-[10px] uppercase px-2 py-1 rounded border border-border hover:bg-muted/40"
          >
            Cool off
          </button>
        </div>
        <div
          className={`rounded border p-2 ${
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
          <div className="mt-1 text-[9px] text-muted-foreground">
            −{Number(farm.cleanliness?.decay_per_hour || 0).toFixed(2)}%/h · IPM{" "}
            {Number(farm.cleanliness?.mite_resistance_pct || 0).toFixed(0)}% resistance
          </div>
          <button
            type="button"
            disabled={
              busy ||
              cleanlinessPct >= 99.5 ||
              Number(farm.business_cash || 0) < Number(farm.cleanliness?.clean_room_cost || 0)
            }
            onClick={cleanRoom}
            className="mt-1.5 inline-flex items-center gap-1 text-[10px] uppercase text-emerald-300 disabled:opacity-40"
          >
            <Sparkles className="h-3 w-3" /> Clean room · {money(farm.cleanliness?.clean_room_cost || 0)}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              if (id === "raid") loadTargets();
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-heading uppercase tracking-wide border ${
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

      {tab === "grow" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
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
                Yield mult ×{(farm.stats?.yield_mult || 1).toFixed(2)} · Quality ceiling{" "}
                {(farm.stats?.quality_ceiling || 0).toFixed(0)}
              </span>
              {farm.auto_water || farm.auto_feed ? (
                <span className="text-emerald-400/90">
                  Auto{farm.auto_water ? " water" : ""}
                  {farm.auto_water && farm.auto_feed ? " +" : ""}
                  {farm.auto_feed ? " feeders" : ""} on (Irrigation Lv {farm.irrigation_level})
                </span>
              ) : (
                <span>
                  Auto-water at Irrigation Lv {farm.auto_water_at_irrigation || 5}; auto-feeders at Lv{" "}
                  {farm.auto_feed_at_irrigation || 8}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(farm.plots || []).map((p, idx) => {
                const st = p.stage || p.state || "empty";
                const active = p.id === selectedPlotId;
                const growing = p.strain_id && st !== "empty" && st !== "dead";
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlotId(p.id)}
                    className={`text-left rounded border p-2 text-xs ${
                      active ? "border-emerald-500/60 bg-emerald-500/10" : "border-border/40 bg-card/30"
                    }`}
                  >
                    <div className="font-heading">Plot {idx + 1}</div>
                    <div className="text-muted-foreground capitalize">{String(st).replace("_", " ")}</div>
                    {p.strain_id ? (
                      <div className="truncate text-[10px] mt-0.5">{strainMap[p.strain_id]?.name || p.strain_id}</div>
                    ) : null}
                    {growing ? (
                      <div className="mt-1.5 space-y-1">
                        <CareMeter
                          label={st === "harvest_ready" ? "Harvest" : "Grow"}
                          pct={(p.progress || 0) * 100}
                          hoursLeft={st === "harvest_ready" ? 0 : p.hours_to_harvest}
                          colorClass={st === "harvest_ready" ? "bg-amber-500" : "bg-emerald-500"}
                          warn={st === "harvest_ready"}
                          fillUp
                        />
                        <CareMeter
                          label="Water"
                          pct={p.water_pct}
                          hoursLeft={p.water_hours_left}
                          colorClass="bg-sky-500"
                          warn={p.needs_water}
                        />
                        <CareMeter
                          label="Feed"
                          pct={p.feed_pct}
                          hoursLeft={p.feed_hours_left}
                          colorClass="bg-lime-500"
                          warn={p.needs_feed}
                        />
                        {(p.mite_infested || Number(p.mite_infestation_pct) > 0) && (
                          <CareMeter
                            label="Spider mites"
                            pct={p.mite_infestation_pct}
                            colorClass="bg-red-500"
                            warn
                            fillUp
                          />
                        )}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {(selectedPlot?.state === "empty" || !selectedPlot?.strain_id) && (
              <div className="rounded border border-border/50 p-3 space-y-2 bg-card/30">
                <div className="text-xs font-heading uppercase text-muted-foreground">Plant</div>
                <select
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                  value={strainId}
                  onChange={(e) => setStrainId(e.target.value)}
                >
                  {unlockedStrains.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (~{s.base_grow_hours}h · {money(s.base_price_per_oz)}/oz)
                    </option>
                  ))}
                </select>
                <select
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                  value={soilType}
                  onChange={(e) => setSoilType(e.target.value)}
                >
                  <option value="soil_conventional">
                    Conventional soil (stock {farm.soil_stock?.soil_conventional || 0})
                  </option>
                  <option value="soil_organic">
                    Organic soil (stock {farm.soil_stock?.soil_organic || 0})
                  </option>
                  <option value="coco">Coco (stock {farm.soil_stock?.coco || 0})</option>
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={plant}
                  className="w-full py-2 rounded bg-emerald-600/80 hover:bg-emerald-600 text-sm font-heading"
                >
                  Plant (uses soil + seed cost)
                </button>
              </div>
            )}

            {selectedPlot?.strain_id && selectedPlot?.state !== "empty" && (
              <div className="space-y-2">
                <div className="rounded border border-border/40 bg-card/30 p-3 space-y-2">
                  <CareMeter
                    label={
                      selectedPlot.stage === "harvest_ready" || selectedPlot.state === "harvest_ready"
                        ? "Ready to harvest"
                        : "Grow / harvest"
                    }
                    pct={(selectedPlot.progress || 0) * 100}
                    hoursLeft={
                      selectedPlot.stage === "harvest_ready" || selectedPlot.state === "harvest_ready"
                        ? 0
                        : selectedPlot.hours_to_harvest
                    }
                    colorClass={
                      selectedPlot.stage === "harvest_ready" || selectedPlot.state === "harvest_ready"
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }
                    warn={
                      selectedPlot.stage === "harvest_ready" || selectedPlot.state === "harvest_ready"
                    }
                    fillUp
                  />
                  <CareMeter
                    label="Water meter"
                    pct={selectedPlot.water_pct}
                    hoursLeft={selectedPlot.water_hours_left}
                    colorClass="bg-sky-500"
                    warn={selectedPlot.needs_water}
                  />
                  <CareMeter
                    label="Feed meter"
                    pct={selectedPlot.feed_pct}
                    hoursLeft={selectedPlot.feed_hours_left}
                    colorClass="bg-lime-500"
                    warn={selectedPlot.needs_feed}
                  />
                  {miteInfested && (
                    <>
                      <CareMeter
                        label="Spider-mite infestation"
                        pct={mitePct}
                        colorClass="bg-red-500"
                        warn
                        fillUp
                      />
                      <p className="text-[10px] text-red-300">
                        Webbing and feeding damage reduce quality and harvest by{" "}
                        {Math.round(Number(selectedPlot.mite_yield_penalty_pct || 0))}%.
                      </p>
                    </>
                  )}
                  {farm.auto_water || farm.auto_feed ? (
                    <p className="text-[10px] text-emerald-400/90">
                      {farm.auto_water ? "Auto-water active. " : ""}
                      {farm.auto_feed ? "Auto-feeders active." : ""}
                    </p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      Upgrade Irrigation to Lv {farm.auto_water_at_irrigation || 5} for auto-water, Lv{" "}
                      {farm.auto_feed_at_irrigation || 8} for auto-feeders.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || farm.auto_water}
                  onClick={water}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded border border-sky-500/40 text-sky-300 text-xs disabled:opacity-40"
                >
                  <Droplets className="w-3.5 h-3.5" /> {farm.auto_water ? "Auto watering" : "Water"}
                </button>
                <button
                  type="button"
                  disabled={busy || farm.auto_feed}
                  onClick={feed}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded border border-lime-500/40 text-lime-300 text-xs disabled:opacity-40"
                >
                  <Leaf className="w-3.5 h-3.5" /> {farm.auto_feed ? "Auto feeding" : "Feed"}
                </button>
                {miteInfested && (
                  <button
                    type="button"
                    disabled={
                      busy ||
                      Number(farm.business_cash || 0) < Number(selectedPlot.mite_treatment_cost || 0)
                    }
                    onClick={treatMites}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded border border-red-500/50 text-red-300 text-xs disabled:opacity-40"
                  >
                    <Bug className="w-3.5 h-3.5" /> Treat mites · {money(selectedPlot.mite_treatment_cost || 0)}
                  </button>
                )}
                {(selectedPlot.stage === "harvest_ready" || selectedPlot.state === "harvest_ready") && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={harvest}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded bg-amber-600/80 text-xs font-heading"
                  >
                    <Scissors className="w-3.5 h-3.5" /> Harvest / Trim
                  </button>
                )}
                </div>
              </div>
            )}
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
                      {Number(g).toFixed(1)}g ({(Number(g) / 28).toFixed(2)} oz)
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-end pt-2">
              <select
                className="bg-background border border-border rounded px-2 py-1.5 text-sm"
                value={sellStrain}
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
                min={0.1}
                step={0.1}
                value={sellAmount}
                onChange={(e) => setSellAmount(e.target.value)}
                className="w-24 bg-background border border-border rounded px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={!sellStrain}
                onClick={() =>
                  setSellAmount(
                    (
                      Number(farm.stash?.[sellStrain] || 0) /
                      (SELL_UNIT_GRAMS[sellUnit] || 1)
                    ).toFixed(sellUnit === "g" ? 1 : 3)
                  )
                }
                className="px-2 py-1.5 rounded border border-border text-xs text-muted-foreground"
              >
                Max
              </button>
              <select
                className="bg-background border border-border rounded px-2 py-1.5 text-sm"
                value={sellUnit}
                onChange={(e) => setSellUnit(e.target.value)}
              >
                <option value="g">grams</option>
                <option value="oz">oz</option>
                <option value="lb">lb</option>
                <option value="kg">kg</option>
              </select>
              <button
                type="button"
                disabled={busy || !sellStrain || !sellPreview.valid}
                onClick={sell}
                className="px-3 py-1.5 rounded bg-emerald-700/80 text-sm font-heading"
              >
                Sell to street
              </button>
            </div>
            {sellStrain && (
              <p className={`text-xs ${sellPreview.valid ? "text-emerald-400" : "text-amber-400"}`}>
                {sellPreview.grams > sellPreview.available + 1e-6
                  ? `Not enough stash — need ${sellPreview.grams.toFixed(1)}g, have ${sellPreview.available.toFixed(1)}g`
                  : `You receive about ${money(sellPreview.payout)}${sellPreview.capped ? " (daily cap)" : ""}`}
              </p>
            )}
            {(farm.dealers_level || 0) >= 1 ? (
              <button type="button" disabled={busy} onClick={dealerSell} className="text-xs underline text-muted-foreground">
                Run dealers (Lv {farm.dealers_level})
              </button>
            ) : (
              <p className="text-[10px] text-muted-foreground">Dealers unlock after 5 sells.</p>
            )}
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
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground flex items-start gap-2">
            <Shield className="w-4 h-4 shrink-0 mt-0.5" />
            Steal stash, business cash, and equipment (victims must re-buy gear). Grower Lv 1 farms are protected;
            the same eligible grower can only be raided once per day.
            {farm.sabotage_unlocked ? " Sabotage heat spike unlocked." : " Harvest 10 plants to unlock sabotage."}
          </p>
          <button type="button" disabled={busy} onClick={loadTargets} className="text-xs px-2 py-1 border rounded">
            Refresh targets
          </button>
          <div className="space-y-2">
            {targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No raidable growers right now.</p>
            ) : (
              targets.map((t) => (
                <div
                  key={t.user_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/40 px-3 py-2 bg-card/30"
                >
                  <div className="text-sm">
                    <div className="font-heading">{t.username}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Grower Lv {t.grower_level} · Tier {t.house_tier} · stash {t.stash_grams}g · {t.equip_count} gear
                      lines
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => raid(t.user_id, false)}
                      className="text-xs px-2 py-1 rounded bg-red-800/70"
                    >
                      Raid
                    </button>
                    {farm.sabotage_unlocked ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => raid(t.user_id, true)}
                        className="text-xs px-2 py-1 rounded border border-red-500/40"
                      >
                        Raid + sabotage
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
