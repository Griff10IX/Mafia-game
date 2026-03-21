import { useRef, useState } from 'react';
import { Car, Image as ImageIcon, Upload } from 'lucide-react';
import { filterProfanity } from '../utils/profanityFilter';
import styles from '../styles/noir.module.css';

/** Max file size before base64 (server limit 300KB on full data URL). */
const MAX_IMAGE_FILE_BYTES = 280 * 1024;
const ACCEPT_IMAGE_TYPES = 'image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp';

/** Modal to set custom car image URL (car_id car_custom). Used from Garage and ViewCar. */
export default function CustomCarImageModal({
  car,
  imageUrl,
  setImageUrl,
  onSave,
  onClose,
  saving,
  censorProfanity = false,
}) {
  const fileInputRef = useRef(null);
  const [fileHint, setFileHint] = useState(null);

  if (!car) return null;
  const displayName = censorProfanity ? filterProfanity(car.name) : car.name;

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|gif|webp)$/i.test(f.type)) {
      setFileHint('Only JPEG, PNG, GIF, or WebP picture files are allowed.');
      return;
    }
    if (f.size > MAX_IMAGE_FILE_BYTES) {
      setFileHint(`File too large (max ${Math.round(MAX_IMAGE_FILE_BYTES / 1024)} KB).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      if (typeof url === 'string' && /^data:image\/(jpeg|png|gif|webp);base64,/i.test(url)) {
        setImageUrl(url);
        setFileHint(null);
      } else {
        setFileHint('Could not read image. Try another file.');
      }
    };
    reader.onerror = () => setFileHint('Could not read file.');
    reader.readAsDataURL(f);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className={`${styles.panel} border border-primary/20 rounded-lg shadow-2xl max-w-md w-full overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-4 py-3 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-2">
            <ImageIcon size={16} />
            Custom Car Picture
          </h3>
          <button type="button" onClick={onClose} className="text-mutedForeground hover:text-primary transition-colors">
            <span className="text-lg">×</span>
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <p className="text-sm font-heading font-bold text-foreground">{displayName}</p>
            <p className="text-[10px] text-mutedForeground font-heading leading-snug">
              JPEG, PNG, GIF, or WebP only — no SVG, videos, or executables. Upload a file (safest) or paste a direct image link; the server checks file contents.
            </p>
          </div>

          <div className="aspect-video rounded overflow-hidden bg-secondary border border-border">
            {imageUrl ? (
              <img src={imageUrl} alt={displayName} className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Car size={32} className="text-primary/30" />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_IMAGE_TYPES}
              className="hidden"
              onChange={onPickFile}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2 rounded border border-primary/40 bg-primary/10 text-primary text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-primary/20 transition-colors"
            >
              <Upload size={14} />
              Upload picture file
            </button>
            {fileHint && (
              <p className="text-[10px] text-amber-500 font-heading">{fileHint}</p>
            )}
            <label className="block text-[10px] text-mutedForeground font-heading mb-1">Or paste image URL / data</label>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => { setFileHint(null); setImageUrl(e.target.value); }}
              placeholder="https://…/photo.jpg or data:image/png;base64,…"
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
              autoComplete="off"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-border rounded text-xs font-heading text-foreground hover:bg-secondary/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex-1 bg-primary/20 text-primary rounded px-3 py-1.5 font-heading font-bold uppercase tracking-wide text-xs border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 active:scale-95"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
