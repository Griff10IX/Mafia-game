import { useEffect, useState } from 'react';
import api from '../utils/api';
import { parseIpBanFromError } from '../utils/ipBan';

/**
 * Gate public auth screens. Hits an existing public GET so middleware 403s include the ban reason.
 * status: 'checking' | 'ok' | 'banned'
 */
export function useIpBanGate() {
  const [status, setStatus] = useState('checking');
  const [ban, setBan] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/auth/login-turnstile-config')
      .then(() => {
        if (cancelled) return;
        setBan(null);
        setStatus('ok');
      })
      .catch((error) => {
        if (cancelled) return;
        const parsed = parseIpBanFromError(error);
        if (parsed) {
          setBan(parsed);
          setStatus('banned');
          return;
        }
        setBan(null);
        setStatus('ok');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, ban, checking: status === 'checking', banned: status === 'banned' };
}
