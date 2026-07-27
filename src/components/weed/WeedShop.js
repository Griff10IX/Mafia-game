import {
  Lock,
  Sparkles,
  Sprout,
  Lightbulb,
  Tent,
  Droplets,
  Wind,
  Shield,
  Wrench,
} from "lucide-react";

const GROUP_META = [
  { id: "lighting", label: "Lighting", Icon: Lightbulb },
  { id: "medium", label: "Soil / Medium", Icon: Sprout },
  { id: "structure", label: "Structure", Icon: Tent },
  { id: "containers", label: "Pots / Hydro", Icon: Wrench },
  { id: "water", label: "Water", Icon: Droplets },
  { id: "nutrients", label: "Nutrients", Icon: Sparkles },
  { id: "climate", label: "Climate", Icon: Wind },
  { id: "monitoring", label: "Meters", Icon: Wrench },
  { id: "plantwork", label: "Plant work", Icon: Sprout },
  { id: "harvest", label: "Harvest", Icon: Sparkles },
  { id: "power", label: "Power", Icon: Lightbulb },
  { id: "security", label: "Security", Icon: Shield },
];

const TIER_STYLE = {
  starter: "border-zinc-600/50 text-zinc-300",
  mid: "border-sky-500/40 text-sky-300",
  premium: "border-amber-500/40 text-amber-300",
  endgame: "border-emerald-400/50 text-emerald-300",
};

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

export default function WeedShop({
  farm,
  shopGroup,
  setShopGroup,
  busy,
  onUpgrade,
  onBuySoil,
}) {
  const rows = farm?.equipment_shop_status || [];
  const inGroup = rows.filter((r) => r.group === shopGroup);
  const unlockedCount = inGroup.filter((r) => !r.locked || r.owned_level > 0).length;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Business cash only. Premium gear unlocks with <strong>Grower level</strong>, house tier, and
        prerequisite upgrades — locked cards stay visible so you can plan the path.
      </p>

      <div className="flex flex-wrap gap-1">
        {GROUP_META.map(({ id, label, Icon }) => {
          const gRows = rows.filter((r) => r.group === id);
          if (!gRows.length) return null;
          const open = gRows.filter((r) => r.owned_level > 0 || !r.locked).length;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setShopGroup(id)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] uppercase border ${
                shopGroup === id
                  ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10"
                  : "border-border/40 text-muted-foreground"
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
              <span className="opacity-70">
                {open}/{gRows.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="text-[10px] text-muted-foreground">
        {shopGroup}: {unlockedCount}/{inGroup.length} available · Grower Lv {farm?.grower_level || 1}
      </div>

      {shopGroup === "medium" ? (
        <div className="flex flex-wrap gap-2">
          {["soil_conventional", "soil_organic", "coco"].map((type) => {
            const catId = type === "coco" ? "coco_medium" : type;
            const row = rows.find((r) => r.category_id === catId);
            const owned = (row?.owned_level || 0) > 0;
            return (
              <button
                key={type}
                type="button"
                disabled={busy || !owned}
                onClick={() => onBuySoil(type)}
                className="text-xs px-2 py-1 border rounded disabled:opacity-40"
                title={!owned ? "Unlock this soil line first" : "Restock bags"}
              >
                Restock {type.replace(/_/g, " ")}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {inGroup.length === 0 ? (
          <p className="text-sm text-muted-foreground">No gear in this group.</p>
        ) : (
          inGroup.map((row) => {
            const locked = !!row.locked && !(row.owned_level > 0) && !row.needs_rebuy;
            const maxed = !!row.maxed;
            const shownLevel = row.needs_rebuy ? Number(row.rebuy_level || 0) : Number(row.owned_level || 0);
            const pct = row.max_level ? Math.round((shownLevel / row.max_level) * 100) : 0;
            const y = row.stats_per_level?.yield_mult;
            const q = row.stats_per_level?.quality_ceiling;
            return (
              <div
                key={row.category_id}
                className={`rounded-lg border p-3 bg-card/40 ${
                  locked
                    ? "border-border/30 opacity-70"
                    : row.needs_rebuy
                      ? "border-amber-500/40"
                      : "border-border/50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-heading text-sm truncate">{row.name}</span>
                      <span
                        className={`text-[9px] uppercase px-1.5 py-0.5 rounded border ${
                          TIER_STYLE[row.tier] || TIER_STYLE.starter
                        }`}
                      >
                        {row.tier}
                      </span>
                      {row.needs_rebuy ? (
                        <span className="text-[9px] uppercase text-amber-300">Raided · rebuy</span>
                      ) : null}
                      {locked ? (
                        <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-400/90">
                          <Lock className="w-3 h-3" /> Locked
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{row.description}</p>
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>
                          {row.needs_rebuy
                            ? `Saved Lv ${shownLevel}/${row.max_level} (not installed)`
                            : `Lv ${row.owned_level || 0}/${row.max_level}`}
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-1.5 rounded bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full ${
                            locked ? "bg-zinc-600" : row.needs_rebuy ? "bg-amber-500/80" : "bg-emerald-500/80"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5 text-[10px]">
                      {y ? (
                        <span className="text-emerald-400/90">+{Math.round(y * 100)}% yield/lvl</span>
                      ) : null}
                      {q ? <span className="text-sky-300/80">+{q} quality/lvl</span> : null}
                    </div>
                    {locked || (!row.can_upgrade && row.lock_reason) ? (
                      <p className="text-[10px] text-amber-400/80 mt-1.5">{row.lock_reason}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0">
                    {maxed ? (
                      <span className="text-[10px] uppercase text-emerald-400 px-2 py-1.5 border border-emerald-500/30 rounded">
                        MAX
                      </span>
                    ) : row.can_upgrade ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onUpgrade(row.category_id)}
                        className={`text-xs px-3 py-1.5 rounded font-heading ${
                          row.needs_rebuy
                            ? "bg-amber-700/80 hover:bg-amber-600"
                            : "bg-emerald-700/70 hover:bg-emerald-600"
                        }`}
                      >
                        {row.needs_rebuy
                          ? `${row.action_label || `Rebuy Lv ${row.rebuy_level}`} · ${money(row.next_cost)}`
                          : money(row.next_cost)}
                      </button>
                    ) : (
                      <span className="inline-flex items-center justify-center w-9 h-9 rounded border border-border/40 text-muted-foreground">
                        <Lock className="w-4 h-4" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
