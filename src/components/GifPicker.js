import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function getGifUrl(gif) {
  const img = gif?.images;
  if (!img) return null;
  return img.fixed_height?.url || img.downsized_medium?.url || img.original?.url || null;
}

export default function GifPicker({ onSelect, onClose, className = '' }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const search = useCallback(async (q) => {
    if (!q) {
      setGifs([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/giphy/search', { params: { q } });
      setGifs(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Search failed';
      setError(msg);
      setGifs([]);
      toast.error(typeof msg === 'string' ? msg : 'GIF search failed. If you see "Giphy not configured", add GIPHY_API_KEY to backend .env.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debouncedQuery) search(debouncedQuery);
    else setGifs([]);
  }, [debouncedQuery, search]);

  return (
    <div className={`rounded-md border border-primary/20 ${styles.panel} overflow-hidden ${className}`}>
      <div className="p-2 border-b border-primary/20 flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIFs..."
          className={`flex-1 ${styles.input} rounded px-3 py-1.5 text-sm border border-primary/30 focus:border-primary/50 focus:outline-none`}
          autoFocus
        />
        {onClose && (
          <button type="button" onClick={onClose} className="text-xs font-heading text-mutedForeground hover:text-primary px-2 py-1">
            Close
          </button>
        )}
      </div>
      <div className="p-2 max-h-36 overflow-y-auto">
        {error && <p className="text-sm text-red-400 font-heading py-1.5">{error}</p>}
        {loading && <p className="text-sm text-mutedForeground font-heading py-1.5">Loading...</p>}
        {!loading && !error && gifs.length === 0 && debouncedQuery && (
          <p className="text-sm text-mutedForeground font-heading py-1.5">No GIFs found</p>
        )}
        {!loading && gifs.length > 0 && (
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-0.5">
            {gifs.map((gif) => {
              const url = getGifUrl(gif);
              if (!url) return null;
              return (
                <button
                  key={gif.id}
                  type="button"
                  onClick={() => onSelect(url)}
                  className="aspect-square rounded overflow-hidden border border-primary/20 hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 max-w-[64px] max-h-[64px] mx-auto"
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
