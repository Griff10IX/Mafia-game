import { Gift } from 'lucide-react';

function splitRewardItems(raw) {
  return String(raw || '')
    .split(/\s*;\s*|,\s+(?=\$?\d)/)
    .map((x) => x.replace(/\.$/, '').trim())
    .filter(Boolean);
}

export function parseRewardInboxMessage(message) {
  if (!message || typeof message !== 'string') return null;
  const text = message.replace(/\s+/g, ' ').trim();
  const split = text.match(/^(You received .+?)(?:\.\s*)?Next reward:\s*(.+)$/i);
  if (!split) return null;

  const receivedBlock = split[1].trim().replace(/\.$/, '');
  let nextBlock = split[2].trim().replace(/\.$/, '');
  let pointsAudit = null;
  const audit = nextBlock.match(/^(.*?)\.\s*Points:\s*(.+)$/i);
  if (audit) {
    nextBlock = audit[1].trim();
    pointsAudit = audit[2].trim();
  }

  const rec = receivedBlock.match(/^You received (.+?)(?: as (.+))?$/i);
  if (!rec) return null;

  const receivedItems = splitRewardItems(rec[1]);
  if (!receivedItems.length) return null;

  const asWhat = (rec[2] || '').trim();
  const freePass = /free game pass/i.test(asWhat) || /free game pass/i.test(receivedBlock);
  const note = asWhat
    .replace(/^a\s+/i, '')
    .replace(/\s*\(([^)]+)\)\s*$/, (_, inner) => (inner ? ` · ${inner}` : ''))
    .trim();

  let nextTier = null;
  let nextItems = [];
  let nextMax = false;
  if (/^max tier reached/i.test(nextBlock)) {
    nextMax = true;
  } else {
    const next = nextBlock.match(/^Tier\s+(\d+)\s+rewards:\s*(.+)$/i);
    if (next) {
      nextTier = next[1];
      nextItems = splitRewardItems(next[2]);
    } else {
      nextItems = splitRewardItems(nextBlock);
    }
  }

  return {
    receivedItems,
    note: note || (freePass ? 'Free Game Pass tier reward' : ''),
    freePass,
    nextTier,
    nextItems,
    nextMax,
    pointsAudit,
  };
}

export function rewardInboxPreview(message) {
  const parsed = parseRewardInboxMessage(message);
  if (!parsed) return null;
  const got = parsed.receivedItems.join(', ');
  if (parsed.nextMax) return `${got} · max tier`;
  if (parsed.nextTier) return `${got} · next T${parsed.nextTier}`;
  return got;
}

function ItemChips({ items, chipClass }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className={`inline-flex items-center px-2 py-1 rounded-md border text-[10px] font-heading font-semibold leading-tight ${chipClass}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function RewardInboxMessage({ message, visual, className = '' }) {
  const parsed = parseRewardInboxMessage(message);
  if (!parsed) return null;

  const card = 'rounded-md border border-border/50 bg-secondary/25';
  const title = 'text-foreground';
  const chip = 'bg-secondary/60 border-border/60 text-foreground';

  return (
    <div className={`space-y-2.5 ${className}`}>
      <div className={`${card} px-3 py-2.5`}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Gift size={12} className={visual?.icon || 'text-emerald-400'} />
          <span className={`text-[9px] font-heading font-bold uppercase tracking-wider ${title}`}>
            Received
          </span>
        </div>
        <ItemChips items={parsed.receivedItems} chipClass={chip} />
        {parsed.note ? (
          <p className="mt-2 text-[10px] text-mutedForeground leading-relaxed">{parsed.note}</p>
        ) : null}
      </div>

      <div className="rounded-md border border-border/50 bg-secondary/25 px-3 py-2.5">
        <p className="text-[9px] font-heading font-bold uppercase tracking-wider text-foreground mb-1.5">
          {parsed.nextMax
            ? 'Next reward'
            : parsed.nextTier
              ? `Next · Tier ${parsed.nextTier}`
              : 'Next reward'}
        </p>
        {parsed.nextMax ? (
          <p className="text-[11px] font-heading font-bold text-foreground">Max tier reached</p>
        ) : (
          <ItemChips items={parsed.nextItems} chipClass="bg-secondary/60 border-border/60 text-foreground" />
        )}
        {parsed.pointsAudit ? (
          <p className="mt-2 text-[10px] text-mutedForeground">Points: {parsed.pointsAudit}</p>
        ) : null}
      </div>
    </div>
  );
}
