import { useCallback, useEffect, useRef, useState } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import api from '../utils/api';

export function useAttackTurnstile() {
  const [cfg, setCfg] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [widgetKey, setWidgetKey] = useState(0);
  const [challenge, setChallenge] = useState(null);
  const pendingRef = useRef(null);

  const fetchConfig = useCallback(async () => {
    try {
      const r = await api.get('/attack/turnstile-config');
      const next = r.data || { enabled: false };
      setCfg(next);
      return next;
    } catch (_e) {
      const fallback = { enabled: false };
      setCfg(fallback);
      return fallback;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchConfig().then((next) => {
      if (cancelled) return;
      setCfg(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  const getAttackCaptcha = useCallback(async (action) => {
    const normalizedAction = action === 'search' ? 'search' : 'execute';
    const current = cfg || (await fetchConfig());
    if (!current?.enabled || !current?.site_key || current?.enforce === 'off') {
      return null;
    }
    let nonceData = {};
    try {
      const nonceRes = await api.post(
        '/attack/turnstile-nonce',
        { action: normalizedAction },
        { suppressServerUnavailable: true },
      );
      nonceData = nonceRes.data || {};
    } catch (err) {
      if (current?.enforce === 'enforce') {
        throw err;
      }
      return null;
    }
    if (!nonceData.required || !nonceData.nonce || !nonceData.site_key) {
      return null;
    }
    setCfg((prev) => ({ ...(prev || {}), ...nonceData }));
    return new Promise((resolve, reject) => {
      pendingRef.current = {
        resolve,
        reject,
        action: normalizedAction,
        nonce: nonceData.nonce,
      };
      setChallenge({
        action: normalizedAction,
        nonce: nonceData.nonce,
        siteKey: nonceData.site_key,
      });
      setWidgetKey((k) => k + 1);
      setModalOpen(true);
    });
  }, [cfg, fetchConfig]);

  const onSuccess = (token) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setModalOpen(false);
    setChallenge(null);
    p?.resolve({
      captcha_token: token,
      captcha_nonce: p.nonce,
    });
  };

  const failPending = useCallback((err) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setModalOpen(false);
    setChallenge(null);
    p?.reject(err);
  }, []);

  const onOpenChange = (open) => {
    if (open) return;
    setModalOpen(false);
    setChallenge(null);
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) p.reject(new Error('captcha_cancelled'));
  };

  const captchaModal =
    challenge?.siteKey ? (
      <Dialog open={modalOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md border-red-500/25">
          <DialogHeader>
            <DialogTitle className="font-heading">Attack security check</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground font-heading">
            Quick Cloudflare verification for the attack page. Often there is nothing to click; if a challenge appears,
            complete it and this window will close.
          </p>
          <div className="flex min-h-[1px] justify-center py-2">
            <Turnstile
              key={widgetKey}
              siteKey={challenge.siteKey}
              onSuccess={onSuccess}
              onExpire={() => failPending(new Error('captcha_expired'))}
              onError={() => failPending(new Error('captcha_failed'))}
              options={{
                theme: 'dark',
                appearance: 'interaction-only',
                action: `attack_${challenge.action}`,
                cData: challenge.nonce,
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    ) : null;

  return { getAttackCaptcha, captchaModal, config: cfg };
}
