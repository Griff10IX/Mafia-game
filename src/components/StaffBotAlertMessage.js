import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { copyTextToClipboard } from '../utils/copyToClipboard';

const SECTION_RE = /^—\s*(.+?)\s*—$/;

function parseKeyValue(line) {
  const idx = line.indexOf(':');
  if (idx <= 0 || idx > 52) return null;
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  if (!value || key.length < 2) return null;
  if (/POSTed|receive|scripts|throttled|stored in Mongo|Legitimate clients/i.test(key)) return null;
  return { key, value };
}

export function parseStaffBotAlert(message) {
  if (!message || typeof message !== 'string') return null;

  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  let summary = null;
  const description = [];
  const overview = [];
  const sections = [];
  let currentSection = null;

  for (const line of lines) {
    const sec = line.match(SECTION_RE);
    if (sec) {
      if (!summary) {
        summary = sec[1];
        continue;
      }
      currentSection = { title: sec[1], items: [], prose: [] };
      sections.push(currentSection);
      continue;
    }

    const kv = parseKeyValue(line);
    if (kv) {
      if (currentSection) currentSection.items.push(kv);
      else overview.push(kv);
      continue;
    }

    if (currentSection) currentSection.prose.push(line);
    else description.push(line);
  }

  if (!summary) return null;
  return { summary, description, overview, sections };
}

export function staffBotAlertPreview(message) {
  const parsed = parseStaffBotAlert(message);
  if (!parsed) return null;

  const user = parsed.overview.find((i) => i.key === 'User' || i.key.startsWith('User '));
  const username = user?.value?.match(/^([^(]+)/)?.[1]?.trim();
  const bits = [
    parsed.summary.replace(/\s*\(anti-bot\)\s*/i, '').trim(),
    username,
  ].filter(Boolean);
  return bits.join(' · ');
}

function FactRow({ item, linkProfile }) {
  const username = item.key.startsWith('User') ? item.value.match(/^([^(]+)/)?.[1]?.trim() : null;
  const copyable = ['IP', 'Account email'].includes(item.key) || item.key.includes('event id');

  const onCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyTextToClipboard(item.value);
    if (ok) toast.success('Copied');
    else toast.error('Could not copy');
  };

  const mono = copyable
    || item.key.includes('Agent')
    || item.key.includes('id')
    || item.key.startsWith('CF-')
    || item.key.startsWith('X-Forwarded');

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-3 py-1.5 border-b border-border/35 last:border-0">
      <dt className="text-[9px] font-heading font-bold uppercase tracking-wider text-mutedForeground shrink-0 sm:w-[10rem]">
        {item.key}
      </dt>
      <dd className={`text-[10px] sm:text-[11px] text-foreground break-all flex-1 flex items-start gap-1 ${mono ? 'font-mono' : ''}`}>
        <span className="flex-1 min-w-0">
          {linkProfile && username ? (
            <>
              <Link
                to={`/profile/${encodeURIComponent(username)}`}
                onClick={(e) => e.stopPropagation()}
                className="text-primary hover:underline font-heading font-bold"
              >
                {username}
              </Link>
              {item.value.slice(username.length)}
            </>
          ) : (
            item.value
          )}
        </span>
        {copyable && (
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 p-0.5 rounded opacity-45 hover:opacity-100 hover:text-primary transition-colors"
            aria-label={`Copy ${item.key}`}
          >
            <Copy size={11} />
          </button>
        )}
      </dd>
    </div>
  );
}

function AlertSection({ title, items, prose, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!items.length && !prose.length) return null;

  return (
    <div className="rounded-md border border-border/50 bg-black/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-secondary/40 transition-colors"
      >
        <span className="text-[9px] font-heading font-bold uppercase tracking-wider text-foreground">
          {title}
          {!open && items.length > 0 ? (
            <span className="ml-1.5 text-mutedForeground font-normal normal-case tracking-normal">
              ({items.length} fields)
            </span>
          ) : null}
        </span>
        {open ? <ChevronDown size={14} className="text-mutedForeground shrink-0" /> : <ChevronRight size={14} className="text-mutedForeground shrink-0" />}
      </button>
      {open && (
        <div className="px-2.5 pb-2 border-t border-border/30">
          {prose.map((p) => (
            <p key={p} className="pt-2 text-[10px] text-mutedForeground leading-relaxed">{p}</p>
          ))}
          {items.length > 0 && (
            <dl className={prose.length ? 'mt-1' : 'pt-1'}>
              {items.map((item) => (
                <FactRow key={`${item.key}:${item.value.slice(0, 24)}`} item={item} linkProfile />
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

export function StaffBotAlertMessage({ message, className = '' }) {
  const parsed = parseStaffBotAlert(message);
  if (!parsed) {
    return <span className={`whitespace-pre-wrap ${className}`}>{message}</span>;
  }

  return (
    <div className={`space-y-2.5 ${className}`}>
      <div className="rounded-md border border-border/50 bg-secondary/25 px-3 py-2.5">
        <p className="text-[11px] font-heading font-bold text-foreground leading-snug">{parsed.summary}</p>
        {parsed.description.map((p) => (
          <p key={p} className="mt-1.5 text-[10px] text-mutedForeground leading-relaxed">{p}</p>
        ))}
      </div>

      {parsed.overview.length > 0 && (
        <div className="rounded-md border border-border/50 bg-secondary/25 px-2.5 py-0.5">
          <dl>
            {parsed.overview.map((item) => (
              <FactRow key={`${item.key}:${item.value.slice(0, 24)}`} item={item} linkProfile />
            ))}
          </dl>
        </div>
      )}

      {parsed.sections.map((sec) => (
        <AlertSection
          key={sec.title}
          title={sec.title}
          items={sec.items}
          prose={sec.prose}
        />
      ))}
    </div>
  );
}
