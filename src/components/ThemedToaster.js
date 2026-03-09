import { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from './ui/sonner';
import { GripVertical } from 'lucide-react';

const TOAST_POSITION_KEY = 'toast_position';
const TOAST_CLOSE_KEY = 'toast_close_button';
const TOAST_CUSTOM_X_KEY = 'toast_custom_x';
const TOAST_CUSTOM_Y_KEY = 'toast_custom_y';

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
  try {
    localStorage.setItem(TOAST_CUSTOM_X_KEY, String(Math.round(x)));
    localStorage.setItem(TOAST_CUSTOM_Y_KEY, String(Math.round(y)));
    window.dispatchEvent(new Event('toast-prefs-changed'));
  } catch (_) {}
}

export function ThemedToaster() {
  const [toastPosition, setToastPosition] = useState(loadToastPosition);
  const [closeButton, setCloseButton] = useState(loadToastCloseButton);
  const [customXY, setCustomXY] = useState(loadToastCustomXY);
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

  const isCustom = toastPosition === 'custom';
  const position = isCustom ? 'bottom-center' : toastPosition;
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
      />
    </>
  );
}
