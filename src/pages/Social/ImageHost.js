import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, Upload, Link2, Trash2, Copy, Loader2 } from 'lucide-react';
import api, { imageHostPublicUrl } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp';

/** Optional max length of longest side (px); server scales down, keeps aspect ratio. */
const MAX_EDGE_OPTIONS = [
  { value: '', label: 'Original size' },
  { value: '400', label: 'Max 400px' },
  { value: '640', label: 'Max 640px' },
  { value: '800', label: 'Max 800px' },
  { value: '1024', label: 'Max 1024px' },
  { value: '1280', label: 'Max 1280px' },
  { value: '1600', label: 'Max 1600px' },
  { value: '1920', label: 'Max 1920px' },
];

export default function ImageHost() {
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState([]);
  const [publicItems, setPublicItems] = useState([]);
  const [publicTotal, setPublicTotal] = useState(0);
  const [publicLoading, setPublicLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [max, setMax] = useState(10);
  const [importUrl, setImportUrl] = useState('');
  const [maxEdge, setMaxEdge] = useState('');
  const [uploadPublic, setUploadPublic] = useState(false);
  const [importPublic, setImportPublic] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState('mine');

  const load = useCallback(async () => {
    try {
      const r = await api.get('/image-host/mine');
      setImages(r.data?.images ?? []);
      setCount(r.data?.count ?? 0);
      setMax(r.data?.max ?? 10);
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to load images');
      setImages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPublic = useCallback(async () => {
    setPublicLoading(true);
    try {
      const r = await api.get('/image-host/public', { params: { limit: 120, skip: 0 } });
      setPublicItems(r.data?.items ?? []);
      setPublicTotal(r.data?.total ?? 0);
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to load public gallery');
      setPublicItems([]);
      setPublicTotal(0);
    } finally {
      setPublicLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadPublic();
  }, [load, loadPublic]);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (count >= max) {
      toast.error(`You already have ${max} images. Delete one first.`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (maxEdge) fd.append('max_edge', maxEdge);
      fd.append('is_public_gallery', uploadPublic ? 'true' : 'false');
      await api.post('/image-host/upload', fd);
      toast.success('Image uploaded');
      await load();
      await loadPublic();
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onImport = async (e) => {
    e?.preventDefault();
    const u = importUrl.trim();
    if (!u) return;
    if (count >= max) {
      toast.error(`You already have ${max} images. Delete one first.`);
      return;
    }
    setImporting(true);
    try {
      const body = { url: u };
      if (maxEdge) body.max_edge = Number(maxEdge);
      body.is_public_gallery = importPublic;
      await api.post('/image-host/import-url', body);
      toast.success('Image imported');
      setImportUrl('');
      await load();
      await loadPublic();
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const copyLink = (publicId) => {
    const url = imageHostPublicUrl(publicId);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => toast.success('Link copied')).catch(() => toast.error('Copy failed'));
    } else {
      toast.error('Clipboard not available');
    }
  };

  const remove = async (publicId) => {
    if (!window.confirm('Delete this hosted image? Links will stop working.')) return;
    try {
      await api.delete(`/image-host/item/${encodeURIComponent(publicId)}`);
      toast.success('Deleted');
      await load();
      await loadPublic();
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Delete failed');
    }
  };

  const setVisibility = async (publicId, isPublic) => {
    try {
      await api.post(`/image-host/item/${encodeURIComponent(publicId)}/visibility`, { is_public_gallery: isPublic });
      toast.success(isPublic ? 'Image is now public' : 'Image is now private');
      await load();
      await loadPublic();
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Failed to update visibility');
    }
  };

  const galleryUrl = (publicId) => {
    const base = imageHostPublicUrl(publicId);
    return base.replace('/image-host/i/', '/image-host/g/');
  };

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/account/dashboard" className="text-mutedForeground hover:text-primary transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary flex items-center gap-2">
              <ImageIcon className="w-5 h-5 sm:w-6 sm:h-6" />
              Image host
            </h1>
            <p className="text-[10px] font-heading text-mutedForeground mt-0.5">
              Host up to {max} pictures (JPEG, PNG, GIF, WebP). Copy direct links for forums, custom cars, etc. Optional resize limits the longest side; animated GIFs keep the original file if you pick a size.
            </p>
          </div>
        </div>
        <span className="text-xs font-heading text-primary font-bold">{count}/{max}</span>
      </div>

      <div className={`${styles.panel} rounded-md border border-primary/20 p-4 space-y-4 mobile-panel`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('mine')}
            className={`px-3 py-1.5 rounded text-[10px] font-heading font-bold uppercase tracking-wider border ${activeTab === 'mine' ? 'border-primary/50 bg-primary/20 text-primary' : 'border-zinc-700/50 text-mutedForeground hover:text-foreground'}`}
          >
            My images
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('public')}
            className={`px-3 py-1.5 rounded text-[10px] font-heading font-bold uppercase tracking-wider border ${activeTab === 'public' ? 'border-primary/50 bg-primary/20 text-primary' : 'border-zinc-700/50 text-mutedForeground hover:text-foreground'}`}
          >
            Public gallery ({publicTotal})
          </button>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center">
          <label className="text-[10px] font-heading text-mutedForeground uppercase tracking-wider shrink-0">Save size</label>
          <select
            value={maxEdge}
            onChange={(e) => setMaxEdge(e.target.value)}
            disabled={uploading || importing || count >= max}
            className={`min-w-[140px] max-w-full h-9 px-2 ${styles.input} text-[11px] font-heading`}
          >
            {MAX_EDGE_OPTIONS.map((o) => (
              <option key={o.value || 'orig'} value={o.value}>{o.label}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-[10px] font-heading text-mutedForeground uppercase tracking-wider">
            <input
              type="checkbox"
              checked={uploadPublic}
              onChange={(e) => setUploadPublic(e.target.checked)}
              disabled={uploading || importing || count >= max}
              className="w-3.5 h-3.5 accent-primary"
            />
            Upload as public
          </label>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onFile} />
          <button
            type="button"
            disabled={uploading || count >= max}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded border border-primary/50 bg-primary/15 text-primary text-xs font-heading font-bold uppercase tracking-wider hover:bg-primary/25 disabled:opacity-40"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Upload file
          </button>
          <form onSubmit={onImport} className="flex-1 flex flex-col sm:flex-row gap-2 min-w-0">
            <input
              type="url"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://…/image.jpg — save from the web"
              className={`flex-1 min-w-0 ${styles.input} h-10 px-3 text-xs font-heading`}
              disabled={importing || count >= max}
            />
            <label className="inline-flex items-center gap-2 text-[10px] font-heading text-mutedForeground uppercase tracking-wider shrink-0">
              <input
                type="checkbox"
                checked={importPublic}
                onChange={(e) => setImportPublic(e.target.checked)}
                disabled={importing || count >= max}
                className="w-3.5 h-3.5 accent-primary"
              />
              Public
            </label>
            <button
              type="submit"
              disabled={importing || count >= max || !importUrl.trim()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded border border-zinc-600 text-foreground text-xs font-heading font-bold uppercase tracking-wider hover:bg-zinc-800 disabled:opacity-40 shrink-0"
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
              Import URL
            </button>
          </form>
        </div>
      </div>

      {activeTab === 'mine' && (loading ? (
        <p className="text-center text-primary font-heading py-8">Loading…</p>
      ) : images.length === 0 ? (
        <p className="text-center text-mutedForeground font-heading text-sm py-8">No images yet. Upload or import one above.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {images.map((img) => {
            const src = imageHostPublicUrl(img.public_id);
            return (
              <div
                key={img.public_id}
                className={`${styles.panel} rounded-md border border-primary/20 overflow-hidden mobile-panel`}
              >
                <div className="bg-zinc-950/90 flex items-center justify-center p-2 min-h-[120px] max-h-[min(42vh,360px)]">
                  <img
                    src={src}
                    alt=""
                    className="max-w-full max-h-[min(42vh,360px)] w-auto h-auto object-contain"
                    loading="lazy"
                  />
                </div>
                <div className="p-3 space-y-2 border-t border-primary/10">
                  {img.resize_max_edge != null && (
                    <p className="text-[9px] font-heading text-primary/90">Saved max side {img.resize_max_edge}px</p>
                  )}
                  <label className="inline-flex items-center gap-2 text-[10px] font-heading text-mutedForeground">
                    <input
                      type="checkbox"
                      checked={img.is_public_gallery === true}
                      onChange={(e) => setVisibility(img.public_id, e.target.checked)}
                      className="w-3.5 h-3.5 accent-primary"
                    />
                    Show in public gallery
                  </label>
                  <p className="text-[9px] font-mono text-mutedForeground break-all line-clamp-2">{src}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyLink(img.public_id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-primary/15 text-primary text-[10px] font-heading font-bold uppercase border border-primary/40"
                    >
                      <Copy size={12} /> Copy link
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(img.public_id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-red-500/40 text-red-400 text-[10px] font-heading font-bold uppercase hover:bg-red-950/30"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {activeTab === 'public' && (publicLoading ? (
        <p className="text-center text-primary font-heading py-8">Loading public gallery…</p>
      ) : publicItems.length === 0 ? (
        <p className="text-center text-mutedForeground font-heading text-sm py-8">No public images yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {publicItems.map((img) => {
            const src = galleryUrl(img.public_id);
            return (
              <div key={`pub-${img.public_id}`} className={`${styles.panel} rounded-md border border-primary/20 overflow-hidden mobile-panel`}>
                <div className="aspect-square bg-zinc-950/90">
                  <img
                    src={src}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="p-2 border-t border-primary/10">
                  <p className="text-[10px] font-heading text-foreground truncate">{img.username || 'Unknown'}</p>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
