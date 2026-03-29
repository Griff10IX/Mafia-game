import { useCallback, useEffect, useRef, useState } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import api from '../utils/api';

/**
 * Cloudflare Turnstile before POST /minigames/run-session/start or /gauntlet/start when admin enables it.
 * Render `captchaModal` once in your page tree. Call `getCaptchaToken()` before starting a run.
 */
export function useMinigameCaptcha() {
  const [cfg, setCfg] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [widgetKey, setWidgetKey] = useState(0);
  const pendingRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/minigames/captcha-config')
      .then((r) => {
        if (!cancelled) setCfg(r.data || {});
      })
      .catch(() => {
        if (!cancelled) setCfg({ enabled: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needsCaptcha = !!(cfg?.enabled && cfg?.site_key);

  const getCaptchaToken = useCallback(() => {
    if (!cfg?.enabled || !cfg?.site_key) {
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      pendingRef.current = { resolve, reject };
      setWidgetKey((k) => k + 1);
      setModalOpen(true);
    });
  }, [cfg]);

  const onSuccess = (token) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    p?.resolve(token);
    setModalOpen(false);
  };

  const onOpenChange = (open) => {
    if (open) return;
    setModalOpen(false);
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) p.reject(new Error('captcha_cancelled'));
  };

  const captchaModal =
    needsCaptcha && cfg?.site_key ? (
      <Dialog open={modalOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md border-primary/20">
          <DialogHeader>
            <DialogTitle className="font-heading">Verify before playing</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground font-heading">
            Complete the check to start this minigame run.
          </p>
          <div className="flex justify-center py-2">
            <Turnstile
              key={widgetKey}
              siteKey={cfg.site_key}
              onSuccess={onSuccess}
              options={{ theme: 'dark' }}
            />
          </div>
        </DialogContent>
      </Dialog>
    ) : null;

  return { getCaptchaToken, captchaModal, needsCaptcha };
}
