import { useState, useEffect, useRef } from 'react';
import api from '../../utils/api';

export default function UserToField({ value, onChange, autoFocus = false, id = 'inbox-to' }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const queryRef = useRef('');
  const wrapRef = useRef(null);

  useEffect(() => {
    const q = (value || '').trim();
    queryRef.current = q;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 1) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get('/users/search', { params: { q, limit: 15 } });
        if (queryRef.current === q) {
          setResults(Array.isArray(res.data?.users) ? res.data.users : []);
          setOpen(true);
        }
      } catch {
        if (queryRef.current === q) setResults([]);
      } finally {
        if (queryRef.current === q) setLoading(false);
      }
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, []);

  const q = (value || '').trim();

  return (
    <div ref={wrapRef} className="relative">
      <label htmlFor={id} className="block text-[10px] font-heading text-mutedForeground mb-1">
        To
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        placeholder="Search username…"
        autoFocus={autoFocus}
        autoComplete="off"
        className="w-full min-h-9 bg-input border border-border rounded px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
      />
      {open && q.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-0.5 max-h-48 overflow-y-auto border border-primary/20 bg-secondary rounded-md shadow-lg">
          {loading && (
            <div className="px-2.5 py-2 text-[10px] font-heading text-mutedForeground">Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-2.5 py-2 text-[10px] font-heading text-mutedForeground">No users found</div>
          )}
          {results.map((u) => (
            <button
              key={u.username}
              type="button"
              onClick={() => {
                onChange(u.username);
                setOpen(false);
                setResults([]);
              }}
              className="flex w-full items-center justify-between gap-2 px-2.5 py-2 min-h-9 text-left border-b border-border/60 last:border-b-0 hover:bg-primary/10 touch-manipulation"
            >
              <span className="truncate text-[11px] font-heading font-bold text-foreground">{u.username}</span>
              <span className="flex gap-1 shrink-0">
                {u.is_dead && (
                  <span className="px-1 py-0.5 rounded text-[9px] font-heading font-bold bg-red-500/20 text-red-400">Dead</span>
                )}
                {u.in_jail && !u.is_dead && (
                  <span className="px-1 py-0.5 rounded text-[9px] font-heading font-bold bg-amber-500/20 text-amber-400">Jail</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
