import { useState } from 'react';
import { Spade } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import { useAuthUser } from '../../context/AuthContext';
import { notifyBlackjackCardBackChanged } from '../../utils/blackjackCardBack';
import { publicAsset } from '../../utils/publicAssets';

function patchAuthUser(patch) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app:refresh-user', { detail: { patch, skipFetch: true } }));
}

export default function BlackjackCardsSettings() {
  const user = useAuthUser();
  const [saving, setSaving] = useState(false);
  const owned = Array.isArray(user?.blackjack_card_backs) ? user.blackjack_card_backs : [];
  const equippedId = user?.blackjack_card_back_id || null;

  const equip = async (backId) => {
    setSaving(true);
    try {
      const res = await api.patch('/profile/blackjack-card-back', { back_id: backId || '' });
      const data = res.data || {};
      patchAuthUser({
        blackjack_card_back_id: data.blackjack_card_back_id ?? null,
        blackjack_card_back: data.blackjack_card_back ?? null,
        blackjack_card_backs_owned: data.blackjack_card_backs_owned ?? user?.blackjack_card_backs_owned,
        blackjack_card_backs: data.blackjack_card_backs ?? user?.blackjack_card_backs,
      });
      notifyBlackjackCardBackChanged();
      toast.success(backId ? 'Card back equipped' : 'Default card back');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not update card back');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`${styles.panel} mobile-panel rounded-lg overflow-hidden`}>
      <div className="px-3 py-2.5 border-b border-primary/20 flex items-center gap-2">
        <Spade size={14} className="text-primary" />
        <span className="text-[10px] font-heading uppercase tracking-wider text-primary font-bold">
          Blackjack card backs
        </span>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-[10px] text-mutedForeground font-heading leading-snug">
          Equip a face-down card design for solo and multiplayer blackjack. Ultra Rare opens can grant custom backs.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <button
            type="button"
            disabled={saving}
            onClick={() => equip('')}
            className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border ${!equippedId ? 'border-primary/60 bg-primary/10' : 'border-primary/20'}`}
            title="Default navy"
          >
            <div
              className="w-[64px] h-[92px] rounded-lg overflow-hidden"
              style={{ background: 'linear-gradient(135deg,#1a3a7a,#0d2255)', border: '2px solid #2a4a9a' }}
            >
              <div className="w-full h-full flex items-center justify-center text-primary/40 text-lg">♠</div>
            </div>
            <span className="text-[10px] font-heading text-mutedForeground">Default</span>
          </button>
          {owned.map((b) => {
            const id = b?.id;
            const src = b?.image ? publicAsset(String(b.image).split('?')[0]) : null;
            const on = equippedId === id;
            return (
              <button
                key={id}
                type="button"
                disabled={saving || !id}
                onClick={() => equip(id)}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border ${on ? 'border-primary/60 bg-primary/10' : 'border-primary/20'}`}
                title={b?.name || id}
              >
                <div className="w-[64px] h-[92px] rounded-lg overflow-hidden border border-white/10">
                  {src ? (
                    <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <div className="w-full h-full bg-secondary" />
                  )}
                </div>
                <span className="text-[10px] font-heading text-mutedForeground max-w-[72px] truncate">
                  {b?.name || id}
                </span>
              </button>
            );
          })}
        </div>
        {!owned.length ? (
          <p className="text-[10px] text-mutedForeground font-heading pt-1">
            No custom backs yet — keep opening Ultra Rare loot boxes.
          </p>
        ) : null}
      </div>
    </section>
  );
}
