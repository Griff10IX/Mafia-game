import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronRight, SkipForward } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import { getTutorialStep, TUTORIAL_STEPS } from '../constants/tutorialSteps';
import styles from '../styles/noir.module.css';

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

/**
 * Centered new-player tutorial coach.
 * Mount after rules_accepted when status is pending/in_progress.
 */
export default function TutorialCoach({
  user,
  onOpenTheme,
  onStatusChange,
  themeModalOpen = false,
}) {
  const navigate = useNavigate();
  const [status, setStatus] = useState(() => seedFromUser(user));
  const [busy, setBusy] = useState(false);
  const [finishPanel, setFinishPanel] = useState(null);
  const startedRef = useRef(false);
  const pollRef = useRef(null);
  const redirectTimerRef = useRef(null);
  const statusKeyRef = useRef(statusSnapshot(seedFromUser(user)));
  const onStatusChangeRef = useRef(onStatusChange);
  const loadInFlightRef = useRef(null);
  const refreshDebounceRef = useRef(null);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
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

  // Start once if pending + eligible
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

  // Poll crime/GTA gates only while tab is visible
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

  // Debounced refresh only on gated action steps (crime/GTA)
  useEffect(() => {
    const step = status?.tutorial_step;
    const gated = status?.tutorial_status === 'in_progress'
      && (step === 'crimes' || step === 'gta');
    if (!gated) return undefined;

    const onRefresh = () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        loadStatus();
      }, 400);
    };
    window.addEventListener('app:refresh-user', onRefresh);
    return () => {
      window.removeEventListener('app:refresh-user', onRefresh);
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
  }, [status?.tutorial_status, status?.tutorial_step, loadStatus]);

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
        // Keep parent in_progress until redirect so finish panel stays mounted.
        applyStatus({
          ...(status || {}),
          tutorial_status: 'in_progress',
          tutorial_step: 'missions',
          eligible: true,
          loot_box_free_rare_opens: rewards.loot_box_free_rare_opens
            ?? status?.loot_box_free_rare_opens,
        });
        refreshUser();
        const redirect = data.redirect || rewards.redirect || '/loot-box?tier=rare&tutorial=1';
        if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = setTimeout(() => {
          applyStatus({
            tutorial_status: 'completed',
            tutorial_step: 'missions',
            eligible: false,
          });
          navigate(redirect);
        }, 1100);
        return;
      }
      applyStatus({
        ...(status || {}),
        tutorial_status: data.tutorial_status || 'in_progress',
        tutorial_step: data.tutorial_step,
        tutorial_theme_done: extra.theme_done ? true : status?.tutorial_theme_done,
        eligible: true,
      });
      // Soft refresh parent money/points only when leaving gated steps
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
    const step = getTutorialStep(status?.tutorial_step);
    if (step.primaryCta?.action === 'open_theme') {
      if (typeof onOpenTheme === 'function') onOpenTheme();
      return;
    }
    if (step.route) navigate(step.route);
  };

  if (!user?.rules_accepted) return null;

  // Theme picker sits above the coach — hide coach so they don't stack/fight.
  if (themeModalOpen && !finishPanel) return null;

  if (finishPanel) {
    return (
      <div
        className="fixed z-[105] inset-0 flex items-center justify-center p-4 pointer-events-none"
        role="status"
      >
        <div
          className={`${styles.panel} pointer-events-auto w-full max-w-[min(380px,100%)] rounded-xl border shadow-2xl p-4`}
          style={{
            borderColor: 'rgba(var(--noir-primary-rgb), 0.35)',
            backgroundColor: 'var(--noir-content)',
          }}
        >
          <h3 className="text-sm font-heading font-bold uppercase tracking-wider text-primary">
            Rewards granted
          </h3>
          <p className="text-[11px] text-mutedForeground font-heading mt-1.5 leading-relaxed">
            Open your free Rare loot box — redirecting you now.
          </p>
          <button
            type="button"
            className="mt-3 w-full py-2.5 rounded-lg text-xs font-heading font-bold uppercase border min-h-[44px]"
            style={{ borderColor: 'var(--noir-primary)', color: 'var(--noir-primary)' }}
            onClick={() => navigate('/loot-box?tier=rare&tutorial=1')}
          >
            Open Rare box
          </button>
        </div>
      </div>
    );
  }

  const st = status?.tutorial_status;
  if (st !== 'pending' && st !== 'in_progress') return null;
  if (status && status.eligible === false && st !== 'in_progress') return null;

  const step = getTutorialStep(status?.tutorial_step || 'theme');
  let themeAlreadyChosen = false;
  try {
    themeAlreadyChosen = typeof localStorage !== 'undefined'
      && localStorage.getItem('app_initial_theme_chosen') === '1';
  } catch (_) { /* ignore */ }

  const gateOk = (() => {
    if (step.gate === 'theme') return Boolean(status?.tutorial_theme_done) || themeAlreadyChosen;
    if (step.gate === 'crime') return Boolean(status?.tutorial_crime_done);
    if (step.gate === 'gta') return Boolean(status?.tutorial_gta_done);
    return true;
  })();

  const stepIndex = Math.max(0, TUTORIAL_STEPS.findIndex((s) => s.id === step.id));
  const stepCount = TUTORIAL_STEPS.length;

  return (
    <div
      className="fixed z-[105] inset-0 flex items-center justify-center p-4 pointer-events-none"
      data-testid="tutorial-coach"
    >
      <div
        className={`${styles.panel} pointer-events-auto w-full max-w-[min(380px,100%)] rounded-xl border shadow-2xl overflow-hidden`}
        style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.3)' }}
        role="dialog"
        aria-modal="false"
        aria-label="New player tutorial"
      >
        <div
          className="px-3 py-2 border-b flex items-center justify-between gap-2"
          style={{
            borderColor: 'rgba(var(--noir-primary-rgb), 0.15)',
            background: 'rgba(var(--noir-primary-rgb), 0.06)',
          }}
        >
          <div className="min-w-0">
            <span className="text-[10px] font-heading font-bold uppercase tracking-wider text-primary block truncate">
              Tutorial · {step.title}
            </span>
            <span className="text-[9px] font-heading text-mutedForeground tabular-nums">
              Step {stepIndex + 1} of {stepCount}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            className="p-1.5 rounded text-mutedForeground hover:text-foreground disabled:opacity-50 shrink-0 min-h-[32px] min-w-[32px] flex items-center justify-center"
            title="Skip tutorial"
            aria-label="Skip tutorial"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-3 space-y-3">
          <p className="text-[11px] font-heading leading-relaxed" style={{ color: 'var(--noir-foreground)' }}>
            {step.body}
          </p>
          {!gateOk && (step.gate === 'crime' || step.gate === 'gta') ? (
            <p className="text-[10px] font-heading text-amber-400/90">
              {step.gate === 'crime' ? 'Commit a crime to unlock Next.' : 'Attempt a GTA to unlock Next.'}
            </p>
          ) : null}
          {!gateOk && step.gate === 'theme' ? (
            <p className="text-[10px] font-heading text-amber-400/90">
              Pick Default or Modern to unlock Next.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {step.primaryCta ? (
              <button
                type="button"
                onClick={handlePrimary}
                className="flex-1 min-w-[7rem] py-2.5 px-3 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border min-h-[44px]"
                style={{
                  backgroundColor: 'rgba(var(--noir-primary-rgb), 0.18)',
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
                className="py-2.5 px-3 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border min-h-[44px]"
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
              className="flex items-center gap-1 py-2.5 px-2.5 rounded-lg text-[10px] font-heading uppercase tracking-wider border disabled:opacity-50 min-h-[44px]"
              style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-muted)' }}
            >
              <SkipForward size={12} />
              Skip
            </button>
            <button
              type="button"
              onClick={() => handleAdvance(step.gate === 'theme' ? { theme_done: true } : {})}
              disabled={busy || !gateOk}
              className="flex-1 flex items-center justify-center gap-1 py-2.5 px-3 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border disabled:opacity-40 min-h-[44px]"
              style={{
                borderColor: gateOk ? 'var(--noir-primary)' : 'var(--noir-border-mid)',
                color: gateOk ? 'var(--noir-primary)' : 'var(--noir-muted)',
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
