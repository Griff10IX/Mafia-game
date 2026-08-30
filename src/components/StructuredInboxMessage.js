import { Bell, Landmark, Leaf, Shield, Trophy } from 'lucide-react';
import { NotificationMessage } from './NotificationMessage';
import { notificationIcon } from '../pages/Social/notificationTypeChrome';

function ItemChips({ items }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center px-2 py-1 rounded-md border border-border/60 bg-secondary/60 text-foreground text-[10px] font-heading font-semibold leading-tight"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function InboxCard({ icon: Icon, iconClass, label, chips, note, children }) {
  return (
    <div className="rounded-md border border-border/50 bg-secondary/25 px-3 py-2.5">
      {label ? (
        <div className="flex items-center gap-1.5 mb-1.5">
          {Icon ? <Icon size={12} className={iconClass || 'text-foreground'} /> : null}
          <span className="text-[9px] font-heading font-bold uppercase tracking-wider text-foreground">
            {label}
          </span>
        </div>
      ) : null}
      {chips?.length ? <ItemChips items={chips} /> : null}
      {note ? (
        <p className={`text-[10px] text-mutedForeground leading-relaxed ${chips?.length ? 'mt-2' : ''}`}>
          {note}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function parseMelt(text) {
  const m = text.match(
    /^You earned (\$[\d,]+) from (.+?)'s treasury for melting \(([^)]+)\)\.\s*Total earned from melt rewards: (\$[\d,]+)\.(.*)$/is,
  );
  if (!m) return null;
  const leftover = m[5].trim();
  return {
    kind: 'melt',
    sections: [
      {
        label: 'Earned',
        Icon: Landmark,
        chips: [m[1]],
        note: `from ${m[2]}'s treasury for melting (${m[3]})`,
      },
      {
        label: 'Total',
        chips: [m[4]],
        note: leftover || 'Lifetime melt rewards from family treasury',
      },
    ],
  };
}

function parseBodyguardHire(text) {
  const token = text.match(/^You hired (.+?) with a free hire token \(slot (\d+)\/(\d+)\)\.(.*)$/is);
  if (token) {
    return {
      kind: 'bodyguard',
      sections: [
        {
          label: 'Hired',
          Icon: Shield,
          chips: [token[1], `Slot ${token[2]}/${token[3]}`, 'Hire token'],
          note: token[4].trim() || undefined,
        },
      ],
    };
  }
  const paid = text.match(/^You hired (.+?) for (\d+) points \(slot (\d+)\/(\d+)\)\.(.*)$/is);
  if (!paid) return null;
  return {
    kind: 'bodyguard',
    sections: [
      {
        label: 'Hired',
        Icon: Shield,
        chips: [paid[1], `${paid[2]} points`, `Slot ${paid[3]}/${paid[4]}`],
        note: paid[5].trim() || undefined,
      },
    ],
  };
}

function parseWeedRaid(text) {
  const failed = text.match(/^(.+?) tried to raid your grow and failed\.?$/i);
  if (failed) {
    return {
      kind: 'weed',
      sections: [
        {
          label: 'Raid failed',
          Icon: Leaf,
          chips: [failed[1]],
          note: 'Tried to raid your grow and failed.',
        },
      ],
    };
  }
  const hit = text.match(
    /^(.+?) raided your grow:\s*stole ([\d.]+)g stash, (\$[\d,]+)(.*)$/is,
  );
  if (!hit) return null;
  const rest = hit[4].trim();
  const equip = rest.match(/took your ([^.]+?)(?:\s*—\s*(.+))?$/i);
  const chips = [`${hit[2]}g stash`, hit[3]];
  let note = rest.replace(/^,\s*/, '').replace(/^\.\s*/, '');
  if (equip) {
    chips.push(equip[1].trim());
    note = equip[2]?.trim() || note;
  }
  return {
    kind: 'weed',
    sections: [
      {
        label: 'Stolen',
        Icon: Leaf,
        chips,
        note: note || `${hit[1]} raided your grow.`,
      },
    ],
  };
}

function parseBulletList(text) {
  if (!text.includes('\n')) return null;
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const bullets = [];
  const prose = [];
  for (const line of lines) {
    const b = line.match(/^[•\-]\s*(.+)$/);
    if (b) {
      const kv = b[1].match(/^([^:]{2,48}):\s*(.+)$/);
      bullets.push(kv ? `${kv[1]}: ${kv[2]}` : b[1]);
    } else {
      prose.push(line);
    }
  }
  if (!bullets.length) return null;
  return {
    kind: 'list',
    sections: [
      {
        label: 'Details',
        body: prose.join('\n\n') || undefined,
        chips: bullets,
      },
    ],
  };
}

function parseRankUp(text) {
  const m = text.match(/rank/i);
  if (!m) return null;
  const money = text.match(/\$[\d,]+/g) || [];
  const bullets = text.match(/(\d[\d,]*)\s+bullets?/i);
  const respect = text.match(/(\d[\d,]*)\s+respect/i);
  const chips = [...money];
  if (bullets) chips.push(`${bullets[1]} bullets`);
  if (respect) chips.push(`${respect[1]} respect`);
  if (!chips.length) return null;
  if (!/promoted|ranked up|you are now|you reached/i.test(text)) return null;
  return {
    kind: 'rank_up',
    sections: [
      {
        label: 'Rank up',
        Icon: Trophy,
        chips,
        note: text,
      },
    ],
  };
}

export function parseStructuredInboxMessage(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  return (
    parseMelt(text)
    || parseBodyguardHire(text)
    || parseWeedRaid(text)
    || parseBulletList(text)
    || parseRankUp(text)
    || {
      kind: 'generic',
      sections: [{ label: 'Details', body: text }],
    }
  );
}

export function structuredInboxPreview(message) {
  const parsed = parseStructuredInboxMessage(message);
  if (!parsed || parsed.kind === 'generic') return null;
  const chips = parsed.sections.flatMap((s) => s.chips || []);
  if (chips.length) return chips.slice(0, 3).join(' · ');
  return null;
}

export function StructuredInboxMessage({ notification, visual, className = '' }) {
  const parsed = parseStructuredInboxMessage(notification?.message);
  if (!parsed) return null;

  const FallbackIcon = notificationIcon(notification) || Bell;
  const iconClass = visual?.icon || 'text-foreground';

  return (
    <div className={`space-y-2.5 ${className}`}>
      {parsed.sections.map((sec, idx) => {
        const Icon = sec.Icon || (idx === 0 ? FallbackIcon : null);
        return (
          <InboxCard
            key={`${sec.label}-${idx}`}
            icon={Icon}
            iconClass={iconClass}
            label={sec.label}
            chips={sec.chips}
            note={sec.note}
          >
            {sec.body ? (
              <p className={`text-[11px] sm:text-sm text-foreground leading-snug whitespace-pre-wrap ${sec.chips?.length || sec.note ? 'mt-2' : ''}`}>
                <NotificationMessage
                  message={sec.body}
                  actorUsername={notification?.actor_username}
                  topicId={notification?.topic_id}
                  topicTitle={notification?.topic_title}
                  commentId={notification?.comment_id}
                  messageLinkTo={notification?.message_link_to}
                  messageLinkLabel={notification?.message_link_label}
                  className="text-inherit"
                />
              </p>
            ) : null}
          </InboxCard>
        );
      })}
    </div>
  );
}
