import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

export default function VerifyEmail({ setIsAuthenticated }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('loading'); // 'loading' | 'success' | 'error' | 'unverified'
  const [message, setMessage] = useState('');
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
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
    const token = searchParams.get('token');
    if (token) {
      ran.current = true;
      api.post('/auth/verify-email', { token })
        .then((response) => {
          if (response.data.token) {
            localStorage.setItem('token', response.data.token);
            if (setIsAuthenticated) setIsAuthenticated(true);
            setStatus('success');
            const bullets = response.data.reward_bullets ?? 2000;
            const respect = response.data.reward_respect_points ?? 500;
            setMessage(`Email verified! You received ${bullets.toLocaleString()} bullets and ${respect.toLocaleString()} Respect Points.`);
            toast.success(`You received ${bullets.toLocaleString()} bullets and ${respect.toLocaleString()} Respect Points!`);
            window.dispatchEvent(new CustomEvent('app:refresh-user'));
            setTimeout(() => navigate('/verify-complete', { replace: true, state: { reward_bullets: bullets, reward_respect_points: respect } }), 800);
          } else {
            setStatus('error');
            setMessage(response.data.detail || 'Verification failed.');
          }
        })
        .catch((err) => {
          setStatus('error');
          const detail = err.response?.data?.detail;
          setMessage(typeof detail === 'string' ? detail : 'Verification link invalid or expired. Request a new one.');
        });
      return;
    }
    ran.current = true;
    api.get('/auth/me')
      .then((response) => {
        const data = response.data;
        if (data && data.email_verified === false) {
          setStatus('unverified');
          setUnverifiedEmail(data.email || '');
          setMessage('');
        } else {
          setStatus('error');
          setMessage('Missing verification link. Check your email or request a new link.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Missing verification link. Check your email or request a new link.');
      });
  }, [searchParams, navigate, setIsAuthenticated]);

  const handleResend = async () => {
    const email = unverifiedEmail?.trim();
    if (!email || resendCooldownSeconds > 0) return;
    setResendLoading(true);
    try {
      const response = await api.post('/auth/resend-verification', { email });
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
        backgroundImage: `url(${process.env.PUBLIC_URL || ''}/landing-bg.png)`,
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
                  type="email"
                  value={unverifiedEmail}
                  onChange={(e) => setUnverifiedEmail(e.target.value)}
                  placeholder="Your email"
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
