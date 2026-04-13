import { Globe } from 'lucide-react';

/**
 * Small flag image (flagcdn PNG) — same as Users Online; avoids emoji regional indicators (poor on Windows).
 */
export default function CountryFlagThumb({ code }) {
  const c = (code || '').trim().toLowerCase();
  if (!c || c.length !== 2 || !/^[a-z]{2}$/.test(c)) {
    return (
      <span
        className="inline-flex h-3 w-4 shrink-0 items-center justify-center rounded-[1px] border border-zinc-600/50 bg-zinc-800/70 text-mutedForeground"
        aria-hidden
      >
        <Globe size={10} strokeWidth={2.25} className="opacity-90" />
      </span>
    );
  }
  return (
    <img
      alt=""
      src={`https://flagcdn.com/16x12/${c}.png`}
      srcSet={`https://flagcdn.com/32x24/${c}.png 2x`}
      width={16}
      height={12}
      loading="lazy"
      decoding="async"
      className="h-3 w-4 object-cover rounded-[1px] shrink-0 border border-zinc-600/50"
    />
  );
}
