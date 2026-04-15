import { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from './ui/sonner';
import { GripVertical } from 'lucide-react';
import api from '../utils/api';
import { getThemeUiPlatform } from '../utils/themePlatform';

const TOAST_POSITION_KEY = 'toast_position';
const TOAST_CLOSE_KEY = 'toast_close_button';
const TOAST_CUSTOM_X_KEY = 'toast_custom_x';
const TOAST_CUSTOM_Y_KEY = 'toast_custom_y';
const KILL_TOAST_STYLE_KEY = 'kill_toast_style';

function loadToastPosition() {
  try {
    const v = localStorage.getItem(TOAST_POSITION_KEY);
    if (['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'custom'].includes(v)) return v;
  } catch (_) {}
  return 'bottom-center';
}

function loadToastCloseButton() {
  try {
    const v = localStorage.getItem(TOAST_CLOSE_KEY);
    if (v === 'false') return false;
  } catch (_) {}
  return true;
}

function loadToastCustomXY() {
  try {
    const x = parseInt(localStorage.getItem(TOAST_CUSTOM_X_KEY), 10);
    const y = parseInt(localStorage.getItem(TOAST_CUSTOM_Y_KEY), 10);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  } catch (_) {}
  const h = typeof window !== 'undefined' ? window.innerHeight : 600;
  return { x: 16, y: h - 120 };
}

function saveToastCustomXY(x, y) {
  const rx = Math.round(x);
  const ry = Math.round(y);
  try {
    localStorage.setItem(TOAST_CUSTOM_X_KEY, String(rx));
    localStorage.setItem(TOAST_CUSTOM_Y_KEY, String(ry));
    window.dispatchEvent(new Event('toast-prefs-changed'));
  } catch (_) {}
  api.patch('/profile/theme', { toast_custom_x: rx, toast_custom_y: ry, theme_platform: getThemeUiPlatform() }).catch(() => {});
}

function loadToastStyle() {
  try {
    const v = localStorage.getItem(KILL_TOAST_STYLE_KEY);
    if (v === 'banner' || v === 'popup') return v;
  } catch (_) {}
  return 'popup';
}

/** Banner-style toast classNames matching Attack page KillNotificationBanner */
const BANNER_TOAST_CLASSNAMES = {
  toast: 'group toast app-toast rounded-md border px-3 py-2 font-heading shadow-lg',
  title: 'text-[11px] font-heading font-bold',
  description: 'text-[10px] font-heading text-mutedForeground mt-0.5',
  success: 'bg-primary/10 border-primary/30 text-primary',
  error: 'bg-destructive/10 border-destructive/30 text-destructive',
  warning: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
  default: 'bg-muted/20 border-border text-foreground',
  actionButton: 'px-2 py-1 text-[10px] font-heading font-bold uppercase tracking-wider rounded border border-current opacity-80 hover:opacity-100',
  cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
};

export function ThemedToaster() {
  const [toastPosition, setToastPosition] = useState(loadToastPosition);
  const [closeButton, setCloseButton] = useState(loadToastCloseButton);
  const [customXY, setCustomXY] = useState(loadToastCustomXY);
  const [toastStyle, setToastStyle] = useState(loadToastStyle);
  const customXYRef = useRef(customXY);
  customXYRef.current = customXY;
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, elX: 0, elY: 0 });

  useEffect(() => {
    const handler = () => {
      setToastPosition(loadToastPosition());
      setCloseButton(loadToastCloseButton());
      setCustomXY(loadToastCustomXY());
    };
    window.addEventListener('toast-prefs-changed', handler);
    return () => window.removeEventListener('toast-prefs-changed', handler);
  }, []);

  useEffect(() => {
    const handler = () => setToastStyle(loadToastStyle());
    window.addEventListener('kill-toast-style-changed', handler);
    return () => window.removeEventListener('kill-toast-style-changed', handler);
  }, []);

  const handleDragStart = useCallback((e) => {
    if (toastPosition !== 'custom') return;
    setDragging(true);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    setDragStart({ x: clientX, y: clientY, elX: customXY.x, elY: customXY.y });
  }, [toastPosition, customXY]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - dragStart.x;
      const dy = clientY - dragStart.y;
      const newX = Math.max(0, Math.min(window.innerWidth - 100, dragStart.elX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 80, dragStart.elY + dy));
      const next = { x: newX, y: newY };
      setCustomXY(next);
      customXYRef.current = next;
    };
    const onEnd = () => {
      setDragging(false);
      const { x, y } = customXYRef.current;
      saveToastCustomXY(x, y);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [dragging, dragStart]);

  const isBanner = toastStyle === 'banner';
  const isCustom = !isBanner && toastPosition === 'custom';
  const position = isBanner ? 'top-center' : (isCustom ? 'bottom-center' : toastPosition);
  const offset = isCustom ? 0 : (position.startsWith('bottom') ? 'max(16px, env(safe-area-inset-bottom, 16px))' : 'max(16px, env(safe-area-inset-top, 16px))');

  const toasterStyle = isCustom
    ? {
        position: 'fixed',
        left: customXY.x,
        top: customXY.y,
        right: 'auto',
        bottom: 'auto',
        transform: 'none',
      }
    : undefined;

  const toastOptions = isBanner
    ? { classNames: BANNER_TOAST_CLASSNAMES }
    : undefined;

  return (
    <>
      {isCustom && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drag to move toast position"
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          style={{
            position: 'fixed',
            left: customXY.x,
            top: customXY.y,
            zIndex: 99999,
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'grab',
            color: 'var(--noir-primary)',
            backgroundColor: 'var(--noir-content)',
            border: '1px solid rgba(var(--noir-primary-rgb), 0.3)',
            borderRadius: 4,
            opacity: 0.7,
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleDragStart(e)}
        >
          <GripVertical size={14} />
        </div>
      )}
      <Toaster
        position={position}
        offset={offset}
        closeButton={closeButton}
        style={toasterStyle}
        toastOptions={toastOptions}
        limit={3}
      />
    </>
  );
}
