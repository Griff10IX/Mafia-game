import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronRight, SkipForward } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import { getTutorialStep } from '../constants/tutorialSteps';
import styles from '../styles/noir.module.css';

/**
 * Floating new-player tutorial coach. Mount after rules_accepted when status is pending/in_progress.
 */
export default function TutorialCoach({
  user,
  onOpenTheme,
  onStatusChange,
}) {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [finishPanel, setFinishPanel] = useState(null);
  const startedRef = useRef(false);
  const pollRef = useRef(null);

  const applyStatus = useCallback((data) => {
    setStatus(data);
    if (typeof onStatusChange === 'function') onStatusChange(data);
  }, [onStatusChange]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.get('/tutorial/status');
      applyStatus(res.data);
      return res.data;
    } catch (_) {
      return null;
    }
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
            });
          }
        } catch (e) {
          startedRef.current = false;
          if (e.response?.status === 400) {
            await loadStatus();
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadStatus, applyStatus]);

  // Poll gates while on crime/GTA steps
  useEffect(() => {
    const step = status?.tutorial_step;
    const needsPoll = status?.tutorial_status === 'in_progress'
      && (step === 'crimes' || step === 'gta');
    if (!needsPoll) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return undefined;
    }
    pollRef.current = setInterval(() => { loadStatus(); }, 2500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.tutorial_status, status?.tutorial_step, loadStatus]);

  // Refresh after crime/GTA activity via user money/points refresh events
  useEffect(() => {
    const onRefresh = () => { loadStatus(); };
    window.addEventListener('app:refresh-user', onRefresh);
    return () => window.removeEventListener('app:refresh-user', onRefresh);
  }, [loadStatus]);

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
        // Keep parent status in_progress until redirect so this finish panel stays mounted.
        if (typeof onStatusChange === 'function' && (rewards.loot_box_free_rare_opens != null || rewards.granted)) {
          onStatusChange({
            ...(status || {}),
            tutorial_status: 'in_progress',
            loot_box_free_rare_opens: rewards.loot_box_free_rare_opens,
          });
        }
        refreshUser();
        const redirect = data.redirect || rewards.redirect || '/loot-box?tier=rare&tutorial=1';
        setTimeout(() => {
          applyStatus({
            tutorial_status: 'completed',
            tutorial_step: 'missions',
            eligible: false,
          });
          navigate(redirect);
        }, 1200);
        return;
      }
      applyStatus({
        ...(status || {}),
        tutorial_status: data.tutorial_status || 'in_progress',
        tutorial_step: data.tutorial_step,
        eligible: true,
      });
      await loadStatus();
      refreshUser();
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
  if (finishPanel) {
    return (
      <div
        className="fixed z-[105] bottom-4 right-4 left-4 sm:left-auto sm:w-[360px] rounded-xl border shadow-2xl p-4"
        style={{
          borderColor: 'rgba(var(--noir-primary-rgb), 0.35)',
          backgroundColor: 'var(--noir-content)',
        }}
        role="status"
      >
        <h3 className="text-sm font-heading font-bold uppercase tracking-wider text-primary">
          Rewards granted
        </h3>
        <p className="text-[11px] text-mutedForeground font-heading mt-1.5 leading-relaxed">
          Open your free Rare loot box — redirecting you now.
        </p>
        <button
          type="button"
          className="mt-3 w-full py-2 rounded-lg text-xs font-heading font-bold uppercase border"
          style={{ borderColor: 'var(--noir-primary)', color: 'var(--noir-primary)' }}
          onClick={() => navigate('/loot-box?tier=rare&tutorial=1')}
        >
          Open Rare box
        </button>
      </div>
    );
  }

  const st = status?.tutorial_status;
  if (st !== 'pending' && st !== 'in_progress') return null;
  if (status && status.eligible === false && st !== 'in_progress') return null;

  const step = getTutorialStep(status?.tutorial_step || 'theme');
  const themeAlreadyChosen = (() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('app_initial_theme_chosen') === '1';
    } catch (_) {
      return false;
    }
  })();
  const gateOk = (() => {
    if (step.gate === 'theme') return Boolean(status?.tutorial_theme_done) || themeAlreadyChosen;
    if (step.gate === 'crime') return Boolean(status?.tutorial_crime_done);
    if (step.gate === 'gta') return Boolean(status?.tutorial_gta_done);
    return true;
  })();

  return (
    <div
      className={`${styles.panel} fixed z-[105] bottom-4 right-4 left-4 sm:left-auto sm:w-[360px] rounded-xl border shadow-2xl overflow-hidden`}
      style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.3)' }}
      data-testid="tutorial-coach"
      role="dialog"
      aria-label="New player tutorial"
    >
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2" style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.15)', background: 'rgba(var(--noir-primary-rgb), 0.06)' }}>
        <span className="text-[10px] font-heading font-bold uppercase tracking-wider text-primary">
          Tutorial · {step.title}
        </span>
        <button
          type="button"
          onClick={handleSkip}
          disabled={busy}
          className="p-1 rounded text-mutedForeground hover:text-foreground disabled:opacity-50"
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
              className="flex-1 min-w-[7rem] py-2 px-3 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border"
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
              className="py-2 px-3 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border"
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
            className="flex items-center gap-1 py-2 px-2.5 rounded-lg text-[10px] font-heading uppercase tracking-wider border disabled:opacity-50"
            style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-muted)' }}
          >
            <SkipForward size={12} />
            Skip
          </button>
          <button
            type="button"
            onClick={() => handleAdvance(step.gate === 'theme' ? { theme_done: true } : {})}
            disabled={busy || !gateOk}
            className="flex-1 flex items-center justify-center gap-1 py-2 px-3 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border disabled:opacity-40"
            style={{
              borderColor: gateOk ? 'var(--noir-primary)' : 'var(--noir-border-mid)',
              color: gateOk ? 'var(--noir-primary)' : 'var(--noir-muted)',
            }}
          >
            {step.nextLabel || 'Next'}
            <ChevronRight size={12} />
          </button>
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
    } catch (__) { /* ignore */ }
    return false;
  }
}
