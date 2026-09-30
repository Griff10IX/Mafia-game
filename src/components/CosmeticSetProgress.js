import { publicAsset } from '../utils/publicAssets';

function pieceSrc(image) {
  if (!image) return '';
  return publicAsset(String(image).split('?')[0]);
}

export function CosmeticSetBonusStrip({ bonuses }) {
  if (!Array.isArray(bonuses) || bonuses.length === 0) return null;
  return (
    <div className="rounded-md border border-primary/25 bg-primary/5 px-2 py-1.5">
      <p className="text-[9px] font-heading font-bold uppercase tracking-wider text-primary">Set bonuses</p>
      <ul className="mt-1 space-y-0.5">
        {bonuses.map((b) => (
          <li key={b.id || b.label} className="text-[10px] font-heading text-foreground">
            {b.label}
          </li>
        ))}
      </ul>
      <p className="text-[9px] text-mutedForeground font-heading mt-1">
        Each bonus applies once, even if you finish more than one set of that type.
      </p>
    </div>
  );
}

export function CosmeticSetList({ sets }) {
  if (!Array.isArray(sets) || sets.length === 0) return null;
  return (
    <div className="space-y-2">
      {sets.map((set) => (
        <div
          key={set.id}
          className={`rounded-md border p-2 ${set.complete ? 'border-primary/50 bg-primary/10' : 'border-primary/20 bg-black/25'}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-heading font-bold text-foreground truncate">{set.name}</p>
            <p className="text-[9px] font-heading text-mutedForeground shrink-0">
              {set.owned_count}/{set.total}
              {set.complete ? ' · Complete' : ''}
            </p>
          </div>
          {set.bonus_label ? (
            <p className="text-[9px] text-primary/90 font-heading leading-snug">{set.bonus_label}</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(set.items || []).map((item) => {
              const src = pieceSrc(item.image);
              return (
                <div
                  key={item.id}
                  title={`${item.name || item.id}${item.owned ? '' : ' — missing'}`}
                  className={`w-8 h-8 rounded border overflow-hidden ${item.owned ? 'border-primary/50' : 'border-white/10 opacity-35'}`}
                >
                  {src ? (
                    <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <div className="w-full h-full bg-secondary" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
