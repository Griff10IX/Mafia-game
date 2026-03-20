/**
 * One-line hint for pages that poll or revalidate in the background.
 * Pass `seconds` for the default sentence, or `children` for custom copy.
 */
export default function AutoRefreshNote({ seconds, children, className = '' }) {
  const text =
    children ??
    (seconds != null
      ? `Automatically refreshes every ${seconds} seconds in the background.`
      : null);
  if (!text) return null;
  return (
    <p className={`text-[9px] text-zinc-500/90 font-heading italic ${className}`.trim()}>
      {text}
    </p>
  );
}
