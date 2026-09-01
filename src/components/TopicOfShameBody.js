import { Link } from 'react-router-dom';
import { SystemAiInboxMessage } from './SystemAiInboxMessage';

const FALLBACK_INTRO =
  'Posted by System AI. Staff kills, wipes, and IP bans — duration and reason when given. Anyone caught playing with a banned user will be modkilled (wipe). Proof is summarized so it does not help anyone copy the method. Staff only — this topic is locked.';

function tidyText(s) {
  return String(s || '')
    .replace(/\[\/?(?:b|i|u|center|quote|list|hr|size(?:=[^\]]+)?)\]/gi, '')
    .replace(/\[color(?:=[^\]]+)?\]/gi, '')
    .replace(/\[\/color\]/gi, '')
    .replace(/\[\*\]/g, '')
    .replace(/:warning:/gi, '')
    .replace(/\?{2}10/g, '£10')
    .replace(/\s+\?{2,3}\s+/g, ' — ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function parseListItems(body) {
  const items = [];
  const liRe = /\[\*\]([\s\S]*?)(?=\[\*\]|\[\/list\]|$)/gi;
  let m;
  while ((m = liRe.exec(body))) {
    const rawLi = m[1];
    const labelM = rawLi.match(/\[b\]([^:[\[\]]+):\[\/b\]\s*([\s\S]*)/i);
    if (labelM) {
      const text = tidyText(labelM[2]);
      if (text) items.push({ label: tidyText(labelM[1]), text });
    } else {
      const text = tidyText(rawLi);
      if (text) items.push({ label: '', text });
    }
  }
  if (!items.length) {
    const labeled = String(body || '').split(/(?=\[b\][^:[\[\]]+:\[\/b\])/i);
    for (const part of labeled) {
      const labelM = part.match(/\[b\]([^:[\[\]]+):\[\/b\]\s*([\s\S]*)/i);
      if (labelM) {
        const text = tidyText(labelM[2]);
        if (text) items.push({ label: tidyText(labelM[1]), text });
      }
    }
  }
  return items;
}

function parseShameContent(raw) {
  const chunks = String(raw || '')
    .split(/\[hr\]/i)
    .map((s) => s.trim())
    .filter(Boolean);
  let intro = '';
  const entries = [];
  for (const chunk of chunks) {
    const dateMatch = chunk.match(/\[color=#2ECC71\](\d{4}-\d{2}-\d{2})\[\/color\]/i);
    const namesMatch = chunk.match(
      /\[color=#2ECC71\]\d{4}-\d{2}-\d{2}\[\/color\]\[\/b\][\s\S]*?\[b\]([\s\S]*?)\[\/b\]\s*\[\/size\]/i,
    );
    const quoteMatch = chunk.match(/\[quote\]([\s\S]*?)\[\/quote\]/i);
    if (dateMatch) {
      const names = tidyText(namesMatch ? namesMatch[1] : '');
      const body = quoteMatch ? quoteMatch[1] : chunk;
      let items = parseListItems(body);
      if (!items.length) {
        const text = tidyText(quoteMatch ? quoteMatch[1] : chunk);
        if (text) items.push({ label: '', text });
      }
      entries.push({ date: dateMatch[1], names, items });
    } else if (quoteMatch) {
      intro = tidyText(quoteMatch[1]);
    }
  }
  return { intro: intro || FALLBACK_INTRO, entries };
}

function ShameNames({ names }) {
  const parts = String(names || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  if (!parts.length) return 'Staff file';
  return parts.map((name, i) => (
    <span key={`${name}-${i}`}>
      {i > 0 ? <span className="text-zinc-500">, </span> : null}
      <Link
        to={`/profile/${encodeURIComponent(name)}`}
        className="hover:text-amber-300 hover:underline underline-offset-2"
      >
        {name}
      </Link>
    </span>
  ));
}

export default function TopicOfShameBody({ content }) {
  const { intro, entries } = parseShameContent(content);
  return (
    <div className="space-y-4">
      <SystemAiInboxMessage kicker="Staff file" notification={{ message: intro }} bodyClassName="px-4 py-4 space-y-3" />
      {entries.map((entry, i) => (
        <SystemAiInboxMessage
          key={`${entry.date}-${entry.names}-${i}`}
          kicker={entry.date}
          title={<ShameNames names={entry.names} />}
          bodyClassName="px-4 py-4 space-y-3"
        >
          <div className="space-y-3">
            {entry.items.map((item, j) => (
              <div
                key={j}
                className="pb-3 border-b border-amber-500/10 last:border-0 last:pb-0"
              >
                {item.label ? (
                  <p className="text-[10px] font-heading font-bold uppercase tracking-[0.14em] text-amber-400/85 mb-1">
                    {item.label}
                  </p>
                ) : null}
                <p className="text-[12px] sm:text-sm text-zinc-100 leading-relaxed">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </SystemAiInboxMessage>
      ))}
    </div>
  );
}
