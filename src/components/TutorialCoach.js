import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  ChevronRight,
  SkipForward,
  GripHorizontal,
  Minus,
  GraduationCap,
  CheckCircle2,
  Gift,
} from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import {
  getTutorialStep,
  TUTORIAL_STEPS,
  TUTORIAL_REWARD_CHIPS,
  TUTORIAL_LOOT_REDIRECT,
} from '../constants/tutorialSteps';
import styles from '../styles/noir.module.css';

const POS_KEY = 'tutorial_coach_pos';
const COLLAPSE_KEY = 'tutorial_coach_collapsed';
const PANEL_W = 380;
const PANEL_H_EST = 320;
const MOBILE_QUERY = '(max-width: 640px)';

const TUTORIAL_COACH_STYLES = `
  @keyframes tut-enter { from { opacity: 0; transform: translateY(12px) scale(0.97); } }
  .tut-enter { animation: tut-enter 0.28s ease-out backwards; }
  @keyframes tut-step-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  .tut-step-in { animation: tut-step-in 0.22s ease-out both; }
  @keyframes tut-pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.75); } }
  .tut-pulse-dot { animation: tut-pulse-dot 1.2s ease-in-out infinite; }
  @keyframes tut-pill-pulse { 0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5); } 70% { box-shadow: 0 0 0 10px rgba(52, 211, 153, 0); } 100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); } }
  .tut-pill-pulse { animation: tut-pill-pulse 1.4s ease-out infinite; }
  .tut-btn { transition: filter 0.15s ease, transform 0.1s ease, background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease; }
  .tut-btn:hover:not(:disabled) { filter: brightness(1.12); }
  .tut-btn:active:not(:disabled) { transform: scale(0.98); }
`;

function statusSnapshot(data) {
  if (!data) return '';
  return [
    data.tutorial_status,
    data.tutorial_step,
    data.tutorial_crime_done ? 1 : 0,
    data.tutorial_gta_done ? 1 : 0,
    data.tutorial_theme_done ? 1 : 0,
    data.eligible ? 1 : 0,
    data.tutorial_enabled ? 1 : 0,
    data.loot_box_free_rare_opens ?? '',
  ].join('|');
}

function seedFromUser(user) {
  if (!user) return null;
  const st = user.tutorial_status;
  if (st !== 'pending' && st !== 'in_progress') return null;
  return {
    tutorial_status: st,
    tutorial_step: user.tutorial_step || 'theme',
    tutorial_crime_done: !!user.tutorial_crime_done,
    tutorial_gta_done: !!user.tutorial_gta_done,
    tutorial_theme_done: !!user.tutorial_theme_done,
    tutorial_rewards_granted: !!user.tutorial_rewards_granted,
    eligible: st === 'pending' || st === 'in_progress',
    loot_box_free_rare_opens: user.loot_box_free_rare_opens,
  };
}

function readPos() {
  try {
    const raw = sessionStorage.getItem(POS_KEY);
    if (!raw) return { x: 0, y: 0 };
    const p = JSON.parse(raw);
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
    return { x, y };
  } catch (_) {
    return { x: 0, y: 0 };
  }
}

function writePos(pos) {
  try {
    sessionStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch (_) { /* ignore */ }
}

function readCollapsed() {
  try {
    return sessionStorage.getItem(COLLAPSE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function writeCollapsed(v) {
  try {
    sessionStorage.setItem(COLLAPSE_KEY, v ? '1' : '0');
  } catch (_) { /* ignore */ }
}

function clampPos(x, y, panelEl) {
  const w = panelEl?.offsetWidth || PANEL_W;
  const h = panelEl?.offsetHeight || PANEL_H_EST;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 600;
  // Position is offset from centered default (translate from center).
  const maxX = Math.max(0, (vw - w) / 2 - 8);
  const maxY = Math.max(0, (vh - h) / 2 - 8);
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  };
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_QUERY).matches
      : false
  ));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);
  return isMobile;
}

function RewardChips({ compact = false }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? 'mt-1' : 'mt-2'}`}>
      {TUTORIAL_REWARD_CHIPS.map((label) => (
        <span
          key={label}
          className="text-[10px] font-heading font-bold uppercase tracking-wide px-2 py-1 rounded border"
          style={{
            borderColor: 'rgba(var(--noir-primary-rgb), 0.35)',
            background: 'rgba(var(--noir-primary-rgb), 0.12)',
            color: 'var(--noir-primary)',
          }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function ProgressSegments({ stepIndex, stepCount }) {
  return (
    <div className="flex items-center gap-1 px-3 pt-2" aria-hidden>
      {Array.from({ length: stepCount }).map((_, i) => (
        <span
          key={i}
          className="h-1 flex-1 rounded-full transition-colors duration-300"
          style={{
            background: i < stepIndex
              ? 'rgba(var(--noir-primary-rgb), 0.8)'
              : i === stepIndex
                ? 'var(--noir-primary)'
                : 'rgba(var(--noir-primary-rgb), 0.18)',
          }}
        />
      ))}
    </div>
  );
}

/**
 * New-player tutorial coach.
 * Desktop: centered draggable panel. Mobile: docked bottom card above the nav bar.
 * Both collapse to a compact pill so the page behind stays usable.
 */
export default function TutorialCoach({
  user,
  onOpenTheme,
  onStatusChange,
  themeModalOpen = false,
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [status, setStatus] = useState(() => seedFromUser(user));
  const [busy, setBusy] = useState(false);
  const [finishPanel, setFinishPanel] = useState(null);
  const [pos, setPos] = useState(readPos);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [gatePulse, setGatePulse] = useState(false);
  const startedRef = useRef(false);
  const pollRef = useRef(null);
  const redirectTimerRef = useRef(null);
  const statusKeyRef = useRef(statusSnapshot(seedFromUser(user)));
  const onStatusChangeRef = useRef(onStatusChange);
  const loadInFlightRef = useRef(null);
  const refreshDebounceRef = useRef(null);
  const panelRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const themeSessionDoneRef = useRef(false);
  const prevGateOkRef = useRef(null);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
  }, []);

  useEffect(() => {
    const onResize = () => {
      setPos((prev) => {
        const next = clampPos(prev.x, prev.y, panelRef.current);
        writePos(next);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const applyStatus = useCallback((data, { notifyParent = true } = {}) => {
    if (!data) return;
    const key = statusSnapshot(data);
    if (key === statusKeyRef.current) return;
    statusKeyRef.current = key;
    setStatus(data);
    if (notifyParent && typeof onStatusChangeRef.current === 'function') {
      onStatusChangeRef.current(data);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    if (loadInFlightRef.current) return loadInFlightRef.current;
    loadInFlightRef.current = (async () => {
      try {
        const res = await api.get('/tutorial/status');
        applyStatus(res.data);
        return res.data;
      } catch (_) {
        return null;
      } finally {
        loadInFlightRef.current = null;
      }
    })();
    return loadInFlightRef.current;
  }, [applyStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadStatus();
      if (cancelled || !data) return;
      if (
        data.tutorial_status === 'pending'
        && data.eligible
        && !startedRef.current
      ) {
        startedRef.current = true;
        try {
          const startRes = await api.post('/tutorial/start');
          if (!cancelled) {
            applyStatus({
              ...data,
              tutorial_status: startRes.data?.tutorial_status || 'in_progress',
              tutorial_step: startRes.data?.tutorial_step || 'theme',
              eligible: true,
              tutorial_ineligible_reason: null,
            });
          }
        } catch (e) {
          startedRef.current = false;
          if (e.response?.status === 400) await loadStatus();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadStatus, applyStatus]);

  useEffect(() => {
    const step = status?.tutorial_step;
    const needsPoll = status?.tutorial_status === 'in_progress'
      && (step === 'crimes' || step === 'gta')
      && !finishPanel;

    const stop = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    if (!needsPoll) {
      stop();
      return undefined;
    }

    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      loadStatus();
    };

    stop();
    pollRef.current = setInterval(tick, 3000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [status?.tutorial_status, status?.tutorial_step, finishPanel, loadStatus]);

  useEffect(() => {
    const step = status?.tutorial_step;
    const gated = status?.tutorial_status === 'in_progress'
      && (step === 'crimes' || step === 'gta');
    if (!gated) return undefined;

    const onRefresh = () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => { loadStatus(); }, 400);
    };
    window.addEventListener('app:refresh-user', onRefresh);
    return () => {
      window.removeEventListener('app:refresh-user', onRefresh);
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
  }, [status?.tutorial_status, status?.tutorial_step, loadStatus]);

  // Theme modal choose advances tutorial — mark this session so Next unlocks after choose.
  useEffect(() => {
    const onChosen = () => {
      themeSessionDoneRef.current = true;
      loadStatus();
    };
    window.addEventListener('app-initial-theme-chosen', onChosen);
    return () => window.removeEventListener('app-initial-theme-chosen', onChosen);
  }, [loadStatus]);

  const step = getTutorialStep(status?.tutorial_step || 'theme');
  const gateOk = (() => {
    if (step.gate === 'theme') {
      return Boolean(status?.tutorial_theme_done) || themeSessionDoneRef.current;
    }
    if (step.gate === 'crime') return Boolean(status?.tutorial_crime_done);
    if (step.gate === 'gta') return Boolean(status?.tutorial_gta_done);
    return true;
  })();
  const isActionGate = step.gate === 'crime' || step.gate === 'gta' || step.gate === 'theme';
  const stepIndex = Math.max(0, TUTORIAL_STEPS.findIndex((s) => s.id === step.id));
  const stepCount = TUTORIAL_STEPS.length;

  // Pulse the collapsed pill when a gate unlocks so the player notices Next is ready.
  useEffect(() => {
    if (prevGateOkRef.current === false && gateOk && isActionGate) {
      setGatePulse(true);
    }
    prevGateOkRef.current = gateOk;
  }, [gateOk, isActionGate]);

  useEffect(() => {
    setGatePulse(false);
    prevGateOkRef.current = null;
  }, [step.id]);

  const statusVisible = !!status;

  // Re-clamp the restored position once the panel has a real measured size
  // (PANEL_H_EST is only a guess before first layout).
  useLayoutEffect(() => {
    if (isMobile || collapsed || !statusVisible) return;
    const panel = panelRef.current;
    if (!panel) return;
    setPos((prev) => {
      const next = clampPos(prev.x, prev.y, panel);
      if (next.x === prev.x && next.y === prev.y) return prev;
      writePos(next);
      return next;
    });
  }, [isMobile, collapsed, statusVisible]);

  const setCollapsedPersist = (v) => {
    setCollapsed(v);
    writeCollapsed(v);
    if (!v) setGatePulse(false);
  };

  const onDragPointerDown = (e) => {
    if (isMobile) return;
    if (e.button != null && e.button !== 0) return;
    // Don't start drag from the header buttons
    if (e.target?.closest?.('[data-tutorial-no-drag]')) return;
    const panel = panelRef.current;
    if (!panel) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
    e.preventDefault();
  };

  const onDragPointerMove = (e) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const next = clampPos(
      dragRef.current.origX + dx,
      dragRef.current.origY + dy,
      panelRef.current,
    );
    setPos(next);
  };

  const onDragPointerUp = (e) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setDragging(false);
    setPos((prev) => {
      const next = clampPos(prev.x, prev.y, panelRef.current);
      writePos(next);
      return next;
    });
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  };

  const goLootBox = useCallback(() => {
    navigate(TUTORIAL_LOOT_REDIRECT);
  }, [navigate]);

  const handleSkip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/tutorial/skip');
      applyStatus({ tutorial_status: 'skipped', eligible: false });
      toast.message('Tutorial skipped');
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not skip tutorial');
    } finally {
      setBusy(false);
    }
  };

  const handleAdvance = async (extra = {}) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.post('/tutorial/advance', { ack: true, ...extra });
      const data = res.data || {};
      if (data.completed) {
        const rewards = data.rewards || {};
        setFinishPanel(rewards);
        if (rewards.granted) {
          const bits = [];
          if (rewards.respect) bits.push(`${Number(rewards.respect).toLocaleString()} respect`);
          if (rewards.robots_hired) bits.push(`${rewards.robots_hired} robot BG${rewards.robots_hired === 1 ? '' : 's'}`);
          if (rewards.free_rare_box) bits.push('free Rare loot box');
          toast.success(bits.length ? `Rewards: ${bits.join(', ')}` : 'Tutorial complete!');
        } else {
          toast.message('Tutorial complete');
        }
        applyStatus({
          ...(status || {}),
          tutorial_status: 'in_progress',
          tutorial_step: 'missions',
          eligible: true,
          loot_box_free_rare_opens: rewards.loot_box_free_rare_opens
            ?? status?.loot_box_free_rare_opens,
        });
        refreshUser();
        const redirect = data.redirect || rewards.redirect || TUTORIAL_LOOT_REDIRECT;
        if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
        // Navigate quickly so query flags aren't lost / coach unmount races.
        redirectTimerRef.current = setTimeout(() => {
          applyStatus({
            tutorial_status: 'completed',
            tutorial_step: 'missions',
            eligible: false,
          });
          navigate(redirect.startsWith('/loot-box')
            ? TUTORIAL_LOOT_REDIRECT
            : redirect);
        }, 280);
        return;
      }
      applyStatus({
        ...(status || {}),
        tutorial_status: data.tutorial_status || 'in_progress',
        tutorial_step: data.tutorial_step,
        tutorial_theme_done: extra.theme_done ? true : status?.tutorial_theme_done,
        eligible: true,
      });
      if (extra.theme_done) themeSessionDoneRef.current = true;
      if (status?.tutorial_step === 'crimes' || status?.tutorial_step === 'gta') {
        refreshUser();
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Cannot continue yet');
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const handlePrimary = () => {
    const s = getTutorialStep(status?.tutorial_step);
    if (s.primaryCta?.action === 'open_theme') {
      if (typeof onOpenTheme === 'function') onOpenTheme();
      return;
    }
    if (s.route) navigate(s.route);
  };

  if (!user?.rules_accepted) return null;
  if (themeModalOpen && !finishPanel) return null;

  const panelStyle = {
    borderColor: 'rgba(var(--noir-primary-rgb), 0.35)',
    backgroundColor: 'var(--noir-content)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.08)',
    ...(isMobile ? {} : { transform: `translate(${pos.x}px, ${pos.y}px)` }),
  };

  if (finishPanel) {
    return (
      <div
        className="fixed z-[105] inset-0 flex items-center justify-center p-4 pointer-events-none"
        role="status"
      >
        <style>{TUTORIAL_COACH_STYLES}</style>
        <div
          ref={panelRef}
          className={`${styles.panel} tut-enter pointer-events-auto w-full max-w-[min(380px,100%)] rounded-xl border overflow-hidden`}
          style={{ ...panelStyle, transform: undefined }}
        >
          <div className="h-1 w-full" style={{ background: 'var(--noir-primary)' }} />
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span
                className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0"
                style={{
                  borderColor: 'rgba(var(--noir-primary-rgb), 0.4)',
                  background: 'rgba(var(--noir-primary-rgb), 0.14)',
                }}
              >
                <Gift size={16} style={{ color: 'var(--noir-primary)' }} aria-hidden />
              </span>
              <h3 className="text-sm font-heading font-bold uppercase tracking-wider text-primary">
                Rewards granted
              </h3>
            </div>
            <p className="text-xs text-mutedForeground font-heading leading-relaxed">
              Open your free Rare loot box now — one free open only.
            </p>
            <RewardChips />
            <button
              type="button"
              className="tut-btn w-full py-2.5 rounded-lg text-xs font-heading font-bold uppercase tracking-wider border min-h-[44px]"
              style={{
                backgroundColor: 'var(--noir-primary)',
                borderColor: 'var(--noir-primary)',
                color: '#141414',
              }}
              onClick={goLootBox}
            >
              Open free Rare box
            </button>
          </div>
        </div>
      </div>
    );
  }

  const st = status?.tutorial_status;
  if (st !== 'pending' && st !== 'in_progress') return null;
  if (status && status.eligible === false && st !== 'in_progress') return null;

  const StepIcon = step.icon || GraduationCap;

  // Keep the pill and the mobile sheet clear of the fixed mobile bottom nav.
  const mobileBottomOffset = 'calc(4.75rem + env(safe-area-inset-bottom, 0px))';

  if (collapsed) {
    const waiting = isActionGate && !gateOk;
    return (
      <div
        className="fixed z-[105] right-3 pointer-events-none"
        style={{ bottom: isMobile ? mobileBottomOffset : '1rem' }}
        data-testid="tutorial-coach"
      >
        <style>{TUTORIAL_COACH_STYLES}</style>
        <button
          type="button"
          onClick={() => setCollapsedPersist(false)}
          className={`tut-btn tut-enter pointer-events-auto flex items-center gap-2 pl-3 pr-3.5 rounded-full border min-h-[44px] shadow-xl ${gatePulse ? 'tut-pill-pulse' : ''}`}
          style={{
            backgroundColor: 'var(--noir-content)',
            borderColor: gatePulse ? 'rgba(52, 211, 153, 0.6)' : 'rgba(var(--noir-primary-rgb), 0.45)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
          }}
          aria-label={`Expand tutorial — step ${stepIndex + 1} of ${stepCount}`}
        >
          <GraduationCap size={16} style={{ color: 'var(--noir-primary)' }} aria-hidden />
          <span className="text-[11px] font-heading font-bold uppercase tracking-wider" style={{ color: 'var(--noir-primary)' }}>
            Tutorial {stepIndex + 1}/{stepCount}
          </span>
          {gatePulse || (isActionGate && gateOk) ? (
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" aria-hidden />
          ) : waiting ? (
            <span className="tut-pulse-dot w-2 h-2 rounded-full bg-amber-400 shrink-0" aria-hidden />
          ) : null}
        </button>
      </div>
    );
  }

  const gateHint = !gateOk
    ? (step.gate === 'crime'
      ? 'Commit a crime to unlock Next.'
      : step.gate === 'gta'
        ? 'Attempt a GTA to unlock Next.'
        : step.gate === 'theme'
          ? 'Pick Default or Modern to unlock Next.'
          : null)
    : null;
  const gateDoneLine = gateOk && isActionGate
    ? (step.gate === 'crime'
      ? 'Crime committed — Next unlocked.'
      : step.gate === 'gta'
        ? 'GTA attempted — Next unlocked.'
        : 'Theme chosen — Next unlocked.')
    : null;

  return (
    <div
      className={isMobile
        ? 'fixed z-[105] inset-x-0 flex justify-center px-2 pointer-events-none'
        : 'fixed z-[105] inset-0 flex items-center justify-center p-4 pointer-events-none'}
      style={isMobile ? { bottom: mobileBottomOffset } : undefined}
      data-testid="tutorial-coach"
    >
      <style>{TUTORIAL_COACH_STYLES}</style>
      <div
        ref={panelRef}
        className={`${styles.panel} tut-enter pointer-events-auto w-full ${isMobile ? 'max-w-[420px] rounded-xl' : 'max-w-[min(380px,100%)] rounded-xl'} border overflow-hidden flex flex-col`}
        style={panelStyle}
        role="dialog"
        aria-modal="false"
        aria-label="New player tutorial"
      >
        <div
          className={`pl-3 pr-1.5 py-1.5 border-b flex items-center justify-between gap-2 select-none ${isMobile ? '' : dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{
            borderColor: 'rgba(var(--noir-primary-rgb), 0.15)',
            background: 'rgba(var(--noir-primary-rgb), 0.08)',
            ...(isMobile ? {} : { touchAction: 'none' }),
          }}
          onPointerDown={isMobile ? undefined : onDragPointerDown}
          onPointerMove={isMobile ? undefined : onDragPointerMove}
          onPointerUp={isMobile ? undefined : onDragPointerUp}
          onPointerCancel={isMobile ? undefined : onDragPointerUp}
          title={isMobile ? undefined : 'Drag to move'}
        >
          <div className="min-w-0 flex items-center gap-2">
            {!isMobile && (
              <GripHorizontal size={14} className="text-primary/70 shrink-0" aria-hidden />
            )}
            <span
              className="w-7 h-7 rounded-md border flex items-center justify-center shrink-0"
              style={{
                borderColor: 'rgba(var(--noir-primary-rgb), 0.4)',
                background: 'rgba(var(--noir-primary-rgb), 0.14)',
              }}
            >
              <StepIcon size={14} style={{ color: 'var(--noir-primary)' }} aria-hidden />
            </span>
            <div className="min-w-0">
              <span className="text-[11px] font-heading font-bold uppercase tracking-wider text-primary block truncate leading-tight">
                {step.title}
              </span>
              <span className="text-[10px] font-heading text-mutedForeground tabular-nums leading-tight">
                Tutorial · Step {stepIndex + 1} of {stepCount}
              </span>
            </div>
          </div>
          <div className="flex items-center shrink-0">
            <button
              type="button"
              data-tutorial-no-drag
              onClick={() => setCollapsedPersist(true)}
              className="rounded text-mutedForeground hover:text-foreground min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
              title="Minimize tutorial"
              aria-label="Minimize tutorial"
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              data-tutorial-no-drag
              onClick={handleSkip}
              disabled={busy}
              className="rounded text-mutedForeground hover:text-foreground disabled:opacity-50 min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
              title="Skip tutorial"
              aria-label="Skip tutorial"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <ProgressSegments stepIndex={stepIndex} stepCount={stepCount} />
        <div
          key={step.id}
          className={`tut-step-in p-3 space-y-3 overflow-y-auto overscroll-contain ${isMobile ? 'max-h-[55vh]' : 'max-h-[70vh]'}`}
        >
          <p className="text-xs font-heading leading-relaxed" style={{ color: 'var(--noir-foreground)' }}>
            {step.body}
          </p>
          {step.tips ? (
            <p className="text-[11px] font-heading leading-snug text-mutedForeground border-l-2 pl-2"
              style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.35)' }}
            >
              {step.tips}
            </p>
          ) : null}
          {step.showRewards ? <RewardChips compact /> : null}
          {gateHint ? (
            <p className="text-[11px] font-heading text-amber-400/90 flex items-center gap-1.5">
              <span className="tut-pulse-dot w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" aria-hidden />
              {gateHint}
            </p>
          ) : null}
          {gateDoneLine ? (
            <p className="text-[11px] font-heading text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 size={13} className="shrink-0" aria-hidden />
              {gateDoneLine}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {step.primaryCta ? (
              <button
                type="button"
                onClick={handlePrimary}
                className="tut-btn flex-1 min-w-[7rem] py-2.5 px-3 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider border min-h-[44px]"
                style={{
                  backgroundColor: 'rgba(var(--noir-primary-rgb), 0.2)',
                  borderColor: 'var(--noir-primary)',
                  color: 'var(--noir-primary)',
                }}
              >
                {step.primaryCta.label}
              </button>
            ) : null}
            {step.secondaryCta?.route ? (
              <button
                type="button"
                onClick={() => navigate(step.secondaryCta.route)}
                className="tut-btn py-2.5 px-3 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider border min-h-[44px]"
                style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-muted)' }}
              >
                {step.secondaryCta.label}
              </button>
            ) : null}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleSkip}
              disabled={busy}
              className="tut-btn flex items-center gap-1 py-2.5 px-2.5 rounded-lg text-[11px] font-heading uppercase tracking-wider border disabled:opacity-50 min-h-[44px]"
              style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-muted)' }}
            >
              <SkipForward size={12} />
              Skip
            </button>
            <button
              type="button"
              onClick={() => handleAdvance(step.gate === 'theme' ? { theme_done: true } : {})}
              disabled={busy || !gateOk}
              className="tut-btn flex-1 flex items-center justify-center gap-1 py-2.5 px-3 rounded-lg text-[11px] font-heading font-bold uppercase tracking-wider border disabled:opacity-40 min-h-[44px]"
              style={{
                backgroundColor: gateOk ? 'var(--noir-primary)' : 'transparent',
                borderColor: gateOk ? 'var(--noir-primary)' : 'var(--noir-border-mid)',
                color: gateOk ? '#141414' : 'var(--noir-muted)',
              }}
            >
              {busy ? '…' : (step.nextLabel || 'Next')}
              {!busy ? <ChevronRight size={12} /> : null}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Call after theme is saved during the tutorial theme step. */
export async function markTutorialThemeDoneAndAdvance() {
  try {
    await api.post('/tutorial/advance', { ack: true, theme_done: true });
    refreshUser();
    return true;
  } catch (_) {
    try {
      await api.post('/tutorial/advance', { theme_done: true });
      refreshUser();
    } catch (__) { /* ignore */ }
    return false;
  }
}
