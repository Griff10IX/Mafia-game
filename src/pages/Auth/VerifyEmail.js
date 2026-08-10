import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

/** One-time verification POST per token. React 18 Strict Mode runs effects twice in dev — without this the 2nd call consumes nothing and shows "invalid link". */
const verifyEmailPostStarted = new Set();

const EMAIL_VERIFIED_STORAGE_KEY = 'mafia:email_verified';

function broadcastEmailVerified() {
  try {
    localStorage.setItem(EMAIL_VERIFIED_STORAGE_KEY, String(Date.now()));
  } catch (_) { /* ignore */ }
  try {
    window.dispatchEvent(new CustomEvent('app:refresh-user'));
  } catch (_) { /* ignore */ }
}

function finishVerified(navigate, setStatus, setMessage, setIsAuthenticated, data) {
  const bullets = Number(data?.reward_bullets ?? 0) || 0;
  const respect = Number(data?.reward_respect_points ?? 0) || 0;
  if (data?.token) {
    localStorage.setItem('token', data.token);
    if (setIsAuthenticated) setIsAuthenticated(true);
  }
  broadcastEmailVerified();
  setStatus('success');
  if (bullets > 0 || respect > 0) {
    setMessage(`Email verified! You received ${bullets.toLocaleString()} bullets and ${respect.toLocaleString()} Respect Points.`);
    toast.success(`You received ${bullets.toLocaleString()} bullets and ${respect.toLocaleString()} Respect Points!`);
  } else {
    setMessage(data?.detail || 'Email verified! Your account is ready.');
    toast.success('Email verified!');
  }
  setTimeout(
    () => navigate('/verify-complete', { replace: true, state: { reward_bullets: bullets, reward_respect_points: respect } }),
    800,
  );
}

export default function VerifyEmail({ setIsAuthenticated }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('loading'); // 'loading' | 'success' | 'error' | 'unverified' | 'already'
  const [message, setMessage] = useState('');
  const [resendIdentifier, setResendIdentifier] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const ran = useRef(false);

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return;
    const t = setInterval(() => setResendCooldownSeconds((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldownSeconds]);

  useEffect(() => {
    if (ran.current) return;
    const raw = searchParams.get('token');
    const token = raw ? decodeURIComponent(raw.trim()) : null;
    if (token) {
      if (verifyEmailPostStarted.has(token)) return;
      verifyEmailPostStarted.add(token);
      ran.current = true;
      api.post('/auth/verify-email', { token })
        .then((response) => {
          const data = response.data || {};
          // Success when JWT issued OR server confirms verified (e.g. login lock / already verified / reused link).
          const ok =
            !!data.token
            || data.email_verified === true
            || data.user?.email_verified === true
            || (typeof data.detail === 'string' && /verified/i.test(data.detail) && !/failed|invalid|expired/i.test(data.detail));
          if (ok) {
            finishVerified(navigate, setStatus, setMessage, setIsAuthenticated, data);
          } else {
            setStatus('error');
            setMessage(data.detail || 'Verification failed.');
          }
        })
        .catch((err) => {
          verifyEmailPostStarted.delete(token);
          // If link was already used but session is verified, still succeed.
          api.get('/auth/me')
            .then((me) => {
              if (me.data?.email_verified === true) {
                finishVerified(navigate, setStatus, setMessage, setIsAuthenticated, {
                  token: null,
                  email_verified: true,
                  reward_bullets: 0,
                  reward_respect_points: 0,
                  detail: 'Email already verified.',
                });
                return;
              }
              setStatus('error');
              const detail = err.response?.data?.detail;
              setMessage(typeof detail === 'string' ? detail : 'Verification link invalid or expired. Request a new one.');
            })
            .catch(() => {
              setStatus('error');
              const detail = err.response?.data?.detail;
              setMessage(typeof detail === 'string' ? detail : 'Verification link invalid or expired. Request a new one.');
            });
        });
      return;
    }
    ran.current = true;
    api.get('/auth/me')
      .then((response) => {
        const data = response.data;
        if (data && data.email_verified === true) {
          setStatus('already');
          setMessage('Your email is already verified.');
          broadcastEmailVerified();
          return;
        }
        if (data && data.email_verified === false) {
          setStatus('unverified');
          setResendIdentifier(data.username || '');
          setMessage('');
        } else {
          setStatus('error');
          setMessage('Missing verification link. Check your email or request a new one.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Missing verification link. Check your email or request a new one.');
      });
  }, [searchParams, navigate, setIsAuthenticated]);

  const handleResend = async () => {
    const identifier = resendIdentifier?.trim();
    if (!identifier || resendCooldownSeconds > 0) return;
    setResendLoading(true);
    try {
      const response = await api.post('/auth/resend-verification', { email: identifier });
      toast.success(response.data.message || 'If an account exists with that email, a new verification link has been sent.');
      setResendCooldownSeconds(120);
    } catch (err) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map(d => d.msg || d.loc?.join('.')).join('; ')
        : `Failed to resend (${err.response?.status || 'network error'}).`;
      toast.error(msg);
      if (err.response?.status === 429) setResendCooldownSeconds(120);
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div
      className={`relative min-h-screen ${styles.page} ${styles.themeGangsterModern}`}
      style={{
        backgroundImage: `url(${process.env.PUBLIC_URL || ''}/images/landing-bg.png)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute inset-0 bg-black/60 pointer-events-none" aria-hidden />
      <div className="relative min-h-screen flex items-center justify-center px-4">
        <div className={`${styles.panel} rounded-sm p-8 max-w-md w-full text-center`}>
          <h1 className="text-xl font-heading font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--noir-foreground)' }}>
            Verify your email
          </h1>
          {status === 'loading' && (
            <p className="text-sm" style={{ color: 'var(--noir-muted)' }}>Verifying...</p>
          )}
          {status === 'success' && (
            <p className="text-sm" style={{ color: 'var(--noir-primary)' }}>{message}</p>
          )}
          {status === 'already' && (
            <>
              <p className="text-sm mb-4" style={{ color: 'var(--noir-primary)' }}>{message}</p>
              <Link
                to="/account/dashboard"
                className={`${styles.btnPrimary} inline-block px-6 py-2 rounded-sm font-heading font-bold uppercase tracking-wider`}
              >
                Go to dashboard
              </Link>
            </>
          )}
          {status === 'unverified' && (
            <>
              <p className="text-sm mb-3" style={{ color: 'var(--noir-muted)' }}>
                Until verified you cannot do crimes, GTA, organised crime, bank, gambling, dead-alive, or other locked features.
              </p>
              <p className="text-sm mb-4" style={{ color: 'var(--noir-foreground)' }}>
                Check your inbox for the verification link, or request a new one below.
              </p>
              <div className="flex flex-col gap-2 mb-4">
                <input
                  type="text"
                  value={resendIdentifier}
                  onChange={(e) => setResendIdentifier(e.target.value)}
                  placeholder="Email or username"
                  className={`${styles.input} w-full px-3 py-2 rounded-sm font-heading text-sm`}
                  style={{ color: 'var(--noir-foreground)', backgroundColor: 'var(--noir-surface)' }}
                />
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendLoading || resendCooldownSeconds > 0}
                  className={`${styles.btnPrimary} w-full px-6 py-2 rounded-sm font-heading font-bold uppercase tracking-wider disabled:opacity-50`}
                >
                  {resendLoading ? 'Sending…' : resendCooldownSeconds > 0 ? `Resend in ${resendCooldownSeconds}s` : 'Resend verification email'}
                </button>
              </div>
              <Link to="/account/dashboard" className="text-sm font-heading underline" style={{ color: 'var(--noir-primary)' }}>Back to Dashboard</Link>
            </>
          )}
          {status === 'error' && (
            <>
              <p className="text-sm mb-4" style={{ color: 'var(--noir-muted)' }}>{message}</p>
              <Link
                to="/"
                className={`${styles.btnPrimary} inline-block px-6 py-2 rounded-sm font-heading font-bold uppercase tracking-wider`}
              >
                Back to Login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { EMAIL_VERIFIED_STORAGE_KEY };
