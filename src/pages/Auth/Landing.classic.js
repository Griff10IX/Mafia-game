/**
 * CLASSIC login/register UI (pre-redesign snapshot).
 * Restore via `USE_LANDING_CLASSIC = true` in `src/config/landing.js`.
 * Do not edit unless intentionally updating the classic fallback.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Turnstile } from '@marsidev/react-turnstile';
import api, { getBaseURL, AUTH_ERROR_KEY } from '../../utils/api';
import { parseIpBanFromError } from '../../utils/ipBan';
import { useIpBanGate } from '../../hooks/useIpBanGate';
import IpBannedPanel from '../../components/IpBannedPanel';
import styles from '../../styles/noir.module.css';

const landingGangsterImg = `${process.env.PUBLIC_URL || ''}/images/landing-gangster.png`;

/** Normalize auth redirect / API messages to inactivity-focused copy for the login card. */
function friendlyAuthSessionMessage(msg) {
  const s = String(msg || '').trim();
  const toInactivity =
    'Your session expired due to inactivity or the login time limit. Please log in again.';
  if (
    s === 'Invalid authentication credentials'
    || s === 'Login session is invalid or expired. Please log in again.'
    || s === 'Login session is invalid. Please log in again.'
    || s === 'Your session ended due to inactivity or the login time limit. Please log in again.'
    || s === 'Session expired due to inactivity. Please log in again.'
  ) {
    return toInactivity;
  }
  if (s === 'Your session expired or is no longer valid. Please log in again.') {
    return toInactivity;
  }
  return s;
}

export default function Landing({ setIsAuthenticated, defaultTab }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { ban: ipBan, banned: ipBanned, checking: ipBanChecking } = useIpBanGate();
  const [isLogin, setIsLogin] = useState(defaultTab !== 'register');
  const [verifySentForEmail, setVerifySentForEmail] = useState(null);
  const [authInlineError, setAuthInlineError] = useState(null);

  useEffect(() => {
    const msg = sessionStorage.getItem(AUTH_ERROR_KEY);
    if (msg) {
      sessionStorage.removeItem(AUTH_ERROR_KEY);
      const shown = friendlyAuthSessionMessage(msg);
      toast.error(shown);
      setAuthInlineError({
        message: shown,
        status: null,
        supportCode: `AUTH-${Date.now().toString().slice(-6)}`,
      });
    }
    // Optional override: open Register tab when coming from DeathScreen "New Life"
    try {
      const preferredTab = sessionStorage.getItem('landing_default_tab');
      if (preferredTab === 'register') {
        setIsLogin(false);
        sessionStorage.removeItem('landing_default_tab');
      }
    } catch (_) {}
  }, []);

  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [loading, setLoading]                       = useState(false);
  const [resendLoading, setResendLoading]           = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [bannerEnabled, setBannerEnabled]           = useState(false);
  const [bannerMessage, setBannerMessage]           = useState('');
  const [referralCode, setReferralCode]             = useState('');
  const [preregisteredSuccess, setPreregisteredSuccess] = useState(null);
  const [usernameCheck, setUsernameCheck] = useState({
    status: 'idle', // 'idle' | 'checking' | 'ok' | 'error'
    isTaken: null,
    message: '',
  });

  const [loginTurnstileCfg, setLoginTurnstileCfg] = useState(null);
  const [loginCaptchaToken, setLoginCaptchaToken] = useState(null);
  const [loginTurnstileWidgetKey, setLoginTurnstileWidgetKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/auth/login-turnstile-config')
      .then((r) => {
        if (!cancelled) setLoginTurnstileCfg(r.data || { enabled: false });
      })
      .catch((error) => {
        if (cancelled) return;
        if (parseIpBanFromError(error)) return;
        setLoginTurnstileCfg({ enabled: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLoginCaptchaToken(null);
    if (isLogin) {
      setLoginTurnstileWidgetKey((k) => k + 1);
    }
  }, [isLogin]);

  const needsLoginCaptcha =
    isLogin
    && loginTurnstileCfg
    && !!loginTurnstileCfg.enabled
    && !!(loginTurnstileCfg.site_key || '').trim();

  // Track login/landing visits for admin stats.
  useEffect(() => {
    if (ipBanned || ipBanChecking) return undefined;
    if (
      location.pathname === '/login'
      || location.pathname === '/'
      || location.pathname === '/register'
      || location.pathname === '/preregister'
    ) {
      api.post('/auth/track-login-page-view').catch(() => {});
    }
    return undefined;
  }, [location.pathname, ipBanned, ipBanChecking]);

  // Username availability feedback (register tab only)
  useEffect(() => {
    if (ipBanned || ipBanChecking || isLogin) {
      setUsernameCheck({ status: 'idle', isTaken: null, message: '' });
      return;
    }

    const u = (formData.username || '').trim();
    const em = (formData.email || '').trim().toLowerCase();
    if (!u || u.length < 1) {
      setUsernameCheck({ status: 'idle', isTaken: null, message: '' });
      return;
    }
    if (u.includes('@')) {
      setUsernameCheck({
        status: 'error',
        isTaken: null,
        message: "Don't use an email here — pick a character name (no @).",
      });
      return;
    }
    if (em && u.toLowerCase() === em) {
      setUsernameCheck({
        status: 'error',
        isTaken: null,
        message: 'Username must be different from your email.',
      });
      return;
    }

    let cancelled = false;
    setUsernameCheck({ status: 'checking', isTaken: null, message: 'Checking username...' });

    const t = setTimeout(() => {
      api
        .get('/auth/check-username', { params: { username: u } })
        .then((r) => {
          if (cancelled) return;
          const isTaken = !!r.data?.is_taken;
          setUsernameCheck({
            status: 'ok',
            isTaken,
            message: isTaken ? 'Username is taken' : 'Username is available',
          });
        })
        .catch((err) => {
          if (cancelled) return;
          const d = err.response?.data?.detail;
          const msg = typeof d === 'string' ? d : 'Could not check username';
          setUsernameCheck({ status: 'error', isTaken: null, message: msg });
        });
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [formData.username, formData.email, isLogin, ipBanned, ipBanChecking]);

  const DEFAULT_BANNER_MESSAGE = 'Beta round end: March 24 6pm. Full game release March 28th 6pm. This beta lets you try the game and features before launch.';

  // Read ?ref= from URL for referral (e.g. ?ref=Username)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref && (ref.trim()).length > 0) setReferralCode(ref.trim());
  }, []);

  useEffect(() => {
    api.get('/landing-banner')
      .then((r) => {
        setBannerEnabled(!!r.data?.enabled);
        const msg = (r.data?.message || '').trim();
        setBannerMessage(msg || DEFAULT_BANNER_MESSAGE);
      })
      .catch(() => { setBannerEnabled(false); setBannerMessage(''); });
  }, []);

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return;
    const t = setInterval(() => setResendCooldownSeconds((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldownSeconds]);

  const referralUrl = preregisteredSuccess?.username && typeof window !== 'undefined'
    ? `${window.location.origin}/?ref=${encodeURIComponent(preregisteredSuccess.username)}`
    : '';

  const copyReferralLink = () => {
    if (referralUrl && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(referralUrl).then(() => toast.success('Link copied')).catch(() => toast.error('Copy failed'));
    } else {
      toast.error('Copy not supported');
    }
  };

  const handleResendVerification = async () => {
    const email = verifySentForEmail || formData.email;
    if (!email || resendCooldownSeconds > 0) return;
    setResendLoading(true);
    try {
      const response = await api.post('/auth/resend-verification', { email });
      toast.success(response.data.message || 'If an account exists with that email, a new verification link has been sent.');
      setResendCooldownSeconds(120);
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to resend.');
      if (err.response?.status === 429) setResendCooldownSeconds(120);
    } finally {
      setResendLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setVerifySentForEmail(null);
    setAuthInlineError(null);

    if (!isLogin && formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match.');
      setLoading(false);
      return;
    }

    if (!isLogin) {
      const u = (formData.username || '').trim();
      const em = (formData.email || '').trim().toLowerCase();
      if (u.includes('@')) {
        toast.error('Username cannot be an email address. Choose a character name without @.');
        setLoading(false);
        return;
      }
      if (u.length > 20) {
        toast.error('Username must be 20 characters or fewer.');
        setLoading(false);
        return;
      }
      if (em && u.toLowerCase() === em) {
        toast.error('Username must be different from your email.');
        setLoading(false);
        return;
      }
    }

    if (isLogin && needsLoginCaptcha && !(loginCaptchaToken || '').trim()) {
      toast.error('Complete the verification below before logging in.');
      setLoading(false);
      return;
    }

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload  = isLogin
        ? {
            email: formData.email,
            password: formData.password,
            ...(needsLoginCaptcha && loginCaptchaToken ? { captcha_token: loginCaptchaToken } : {}),
          }
        : {
            email: formData.email,
            username: formData.username,
            password: formData.password,
            ...(referralCode ? { referral_code: referralCode } : {}),
          };

      const response = await api.post(endpoint, payload);

      // Pre-registration mode: account created but can't login until launch
      if (response.data.preregistered) {
        const username = response.data.username || formData.username;
        setPreregisteredSuccess({ username });
        setFormData({ email: '', username: '', password: '', confirmPassword: '' });
        toast.success(response.data.message || 'Account created! Check your email to verify your account.');
        return;
      }

      if (response.data.verify_required) {
        if (response.data.token) {
          localStorage.setItem('token', response.data.token);
          setIsAuthenticated(true);
        }
        toast.success(response.data.message || 'Check your email to verify your account.');
        setVerifySentForEmail(formData.email);
        return;
      }
      localStorage.setItem('token', response.data.token);
      setIsAuthenticated(true);
      toast.success(isLogin ? 'Welcome back.' : 'Account created successfully.');
    } catch (error) {
      let msg;
      const prefix = isLogin ? 'Cannot log in: ' : 'Registration failed: ';
      const loginReasonByStatus = {
        400: 'Invalid request. Check email and password.',
        401: 'Invalid email or password. Use Forgot password to reset.',
        403: 'Access denied. Your account may be dead or your IP may be banned.',
        404: 'Login endpoint not found. Backend may be down or misconfigured.',
        422: 'Invalid email or password format. Check your input.',
        423: 'Login is not available until launch.',
        429: 'Too many attempts. Wait a few minutes or use Forgot password.',
        500: 'Server error. Please try again in a moment.',
        503: 'Login verification is temporarily unavailable. Try again later or contact support.',
      };
      if (error.code === 'ERR_NETWORK' || !error.response) {
        const base = error.config?.baseURL || getBaseURL();
        msg = `Cannot reach server. Backend URL: ${base}`;
      } else if (error.response?.data?.detail != null) {
        const d = error.response.data.detail;
        if (typeof d === 'string') {
          msg = d;
        } else if (Array.isArray(d)) {
          msg = d.map((x) => (x && typeof x === 'object' && 'msg' in x ? x.msg : String(x))).filter(Boolean).join('. ') || 'Invalid request';
        } else if (typeof d === 'object' && d !== null && typeof d.message === 'string') {
          msg = d.message;
        } else {
          msg = String(d);
        }
        const skipPrefix = isLogin && (
          msg.startsWith('Cannot log in') || msg.startsWith('Login failed') ||
          msg.startsWith('No account found') || msg.startsWith('Wrong password') ||
          msg.startsWith('Too many failed') || msg.startsWith('Please verify your email') ||
          msg.startsWith('This account is dead') ||
          msg.startsWith('Complete the captcha') || msg.startsWith('Captcha verification') ||
          msg.includes('Captcha is enabled but the server')
        );
        if (!skipPrefix && !msg.startsWith('Registration failed')) msg = `${prefix}${msg}`;
      } else if (error.response?.status === 404) {
        msg = `Login endpoint not found (404). URL: ${error.config?.baseURL || '?'}`;
      } else if (error.response?.status) {
        const status       = error.response.status;
        const statusDetail = error.response?.data?.detail;
        const reason = typeof statusDetail === 'string'
          ? statusDetail
          : (isLogin ? loginReasonByStatus[status] : null) || error.response?.statusText || `Error ${status}`;
        msg = reason.startsWith('Cannot log in') || reason.startsWith('Registration failed')
          ? reason
          : `${prefix}${reason}`.trim();
      } else {
        msg = isLogin ? 'Cannot log in. Please try again.' : 'Registration failed. Please try again.';
      }
      if (error.response?.status === 403 && typeof msg === 'string' && msg.toLowerCase().includes('verify your email')) {
        setVerifySentForEmail(formData.email);
      }
      toast.error(friendlyAuthSessionMessage(msg));
      setAuthInlineError({
        message: friendlyAuthSessionMessage(String(msg || 'Unknown login error')),
        status: error.response?.status || null,
        supportCode: `AUTH-${(error.response?.status || 'X')}-${Date.now().toString().slice(-6)}`,
      });
      if (isLogin && needsLoginCaptcha) {
        setLoginCaptchaToken(null);
        setLoginTurnstileWidgetKey((k) => k + 1);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`relative min-h-screen ${styles.page} ${styles.themeGangsterModern}`}
      data-testid="landing-page"
      style={{
        backgroundImage: `url(${process.env.PUBLIC_URL || ''}/images/landing-bg.png)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
      }}
    >
      <style>{`
        @keyframes landing-fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes crest-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(var(--noir-primary-rgb, 201,168,76), 0.0), 0 4px 20px rgba(0,0,0,.7); }
          50%       { box-shadow: 0 0 0 6px rgba(var(--noir-primary-rgb, 201,168,76), 0.08), 0 4px 20px rgba(0,0,0,.7); }
        }
        @keyframes shaft-drift {
          0%   { opacity: 0.4; }
          50%  { opacity: 0.7; }
          100% { opacity: 0.4; }
        }
        .landing-fade-up    { animation: landing-fade-up 0.5s ease both; }
        .landing-fade-up-1  { animation: landing-fade-up 0.5s 0.08s ease both; }
        .landing-fade-up-2  { animation: landing-fade-up 0.5s 0.16s ease both; }
        .landing-fade-up-3  { animation: landing-fade-up 0.5s 0.24s ease both; }
        .crest-pulse        { animation: crest-pulse 3s ease-in-out infinite; }
      `}</style>

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/65 pointer-events-none" aria-hidden />

      <div className="relative min-h-screen flex items-start md:items-center justify-center px-3 sm:px-4 py-4 sm:py-6 md:py-10 safe-area-pt safe-area-pb">
        <div className="w-full max-w-md mx-auto flex flex-col gap-2 mobile-page-root">
          <div id="landing-auth-card" className="w-full max-w-md mx-auto flex flex-col gap-3 sm:gap-2">
          {/* ── HERO HEADER ─────────────────────────────────────── */}
          {/*   Gold radial glow + vertical shaft lines, no image   */}
          <div
            className="relative rounded-t-xl overflow-hidden flex flex-col items-center justify-center pt-10 pb-10"
            style={{
              background: 'linear-gradient(180deg, rgba(var(--noir-primary-rgb,201,168,76),0.10) 0%, var(--noir-background, #0d0d0d) 100%)',
              borderTop:    '1px solid rgba(var(--noir-primary-rgb,201,168,76),0.22)',
              borderLeft:   '1px solid rgba(var(--noir-primary-rgb,201,168,76),0.22)',
              borderRight:  '1px solid rgba(var(--noir-primary-rgb,201,168,76),0.22)',
            }}
          >
            {/* Light shaft lines */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'repeating-linear-gradient(90deg, transparent 0, transparent 52px, rgba(var(--noir-primary-rgb,201,168,76),0.025) 52px, rgba(var(--noir-primary-rgb,201,168,76),0.025) 54px)',
              }}
            />
            {/* Top-centre glow */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse 90% 60% at 50% -10%, rgba(var(--noir-primary-rgb,201,168,76),0.18) 0%, transparent 65%)',
              }}
            />

            {/* Beta / release banner */}
            {bannerEnabled && (
              <div
                className="relative z-10 mb-4 px-5 py-3 rounded font-heading text-xs leading-relaxed"
                style={{
                  backgroundColor: 'var(--noir-primary)',
                  color: 'var(--noir-background)',
                  whiteSpace: 'pre-line',
                }}
              >
                {bannerMessage || DEFAULT_BANNER_MESSAGE}
              </div>
            )}

            {/* Eyebrow */}
            <p
              className="relative z-10 text-[8px] font-heading uppercase tracking-[0.5em] mb-2 landing-fade-up"
              style={{ color: 'var(--noir-primary)', opacity: 0.6 }}
            >
              La Cosa Nostra
            </p>

            {/* Title */}
            <div className="relative z-10 flex items-center gap-3 landing-fade-up-1">
              <div className="h-px w-10 md:w-16" style={{ backgroundColor: 'var(--noir-accent-line)', opacity: 0.45 }} />
              <h1
                className="text-4xl md:text-5xl font-heading font-black uppercase tracking-[0.2em]"
                style={{
                  color: 'var(--noir-foreground)',
                  textShadow: '0 0 48px rgba(var(--noir-primary-rgb,201,168,76),0.22)',
                }}
                data-testid="landing-title"
              >
                MAFIA WARS
              </h1>
              <div className="h-px w-10 md:w-16" style={{ backgroundColor: 'var(--noir-accent-line)', opacity: 0.45 }} />
            </div>

            {/* Crest seal — overlaps hero/panel boundary */}
            <div
              className="crest-pulse relative z-20 mt-6 w-14 h-14 rounded-full overflow-hidden flex items-center justify-center shrink-0"
              style={{
                background: 'var(--noir-background, #0d0d0d)',
                border: '2px solid var(--noir-primary)',
                marginBottom: '-28px',
              }}
            >
              <img
                src={landingGangsterImg}
                alt=""
                className="w-full h-full object-cover object-[center_15%]"
                decoding="async"
              />
            </div>
          </div>

          {/* ── AUTH PANEL ──────────────────────────────────────── */}
          {ipBanned ? (
            <div className="landing-fade-up-2">
              <IpBannedPanel ban={ipBan} />
            </div>
          ) : ipBanChecking ? (
            <div
              className={`${styles.panel} rounded-b-xl overflow-hidden landing-fade-up-2`}
              data-testid="ip-ban-checking"
              style={{
                borderTop: 'none',
                borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.18)',
              }}
            >
              <p
                className="p-5 text-center text-[10px] font-heading uppercase tracking-wider"
                style={{ color: 'var(--noir-muted)' }}
              >
                Checking…
              </p>
            </div>
          ) : (
          <div
            className={`${styles.panel} rounded-b-xl overflow-hidden landing-fade-up-2`}
            style={{
              borderTop: 'none',
              borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.18)',
            }}
          >
            {/* Tabs */}
            <div
              className={`px-4 pt-8 pb-0 flex gap-1.5 ${styles.panelHeader}`}
              style={{ borderBottom: '1px solid rgba(var(--noir-primary-rgb,201,168,76),0.12)' }}
            >
              <button
                onClick={() => setIsLogin(true)}
                data-testid="login-tab"
                className={`flex-1 py-2.5 rounded-t-md uppercase tracking-wider text-[10px] font-heading font-bold transition-all border-b-2 ${
                  isLogin
                    ? `${styles.tabActive}`
                    : 'bg-transparent border-transparent'
                }`}
                style={!isLogin ? { color: 'var(--noir-muted)', borderBottom: '2px solid transparent' } : undefined}
              >
                Login
              </button>
              <button
                onClick={() => setIsLogin(false)}
                data-testid="register-tab"
                className={`flex-1 py-2.5 rounded-t-md uppercase tracking-wider text-[10px] font-heading font-bold transition-all ${
                  !isLogin
                    ? `${styles.tabActive}`
                    : 'bg-transparent border-transparent'
                }`}
                style={isLogin ? { color: 'var(--noir-muted)', borderBottom: '2px solid transparent' } : undefined}
              >
                Register
              </button>
            </div>

            {/* Pre-registration success - show referral link */}
            {preregisteredSuccess ? (
              <div className="p-6 space-y-4">
                <p className="text-sm font-heading text-center" style={{ color: 'var(--noir-foreground)' }}>
                  Account created! Check your email to verify, then you can log in.
                </p>
                <p className="text-[10px] font-heading uppercase tracking-wider text-center" style={{ color: 'var(--noir-primary)', opacity: 0.8 }}>
                  Share your referral link once you&apos;re in the game
                </p>
                <div className="flex items-center gap-2 rounded border p-3" style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.2)', backgroundColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.05)' }}>
                  <code className="flex-1 truncate text-xs font-mono" style={{ color: 'var(--noir-foreground)' }}>
                    {referralUrl}
                  </code>
                  <button
                    type="button"
                    onClick={copyReferralLink}
                    className={`${styles.btnPrimary} shrink-0 flex items-center gap-1.5 px-3 py-2 rounded font-heading text-[10px] uppercase tracking-wider`}
                  >
                    <Copy size={12} />
                    Copy
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setPreregisteredSuccess(null)}
                  className="w-full py-2.5 rounded font-heading text-[10px] uppercase tracking-wider opacity-70 hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--noir-muted)' }}
                >
                  Done
                </button>
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="p-6 space-y-4" autoComplete="on">
              {authInlineError && (
                <div
                  className="rounded border px-3 py-2 space-y-1"
                  style={{
                    borderColor: 'rgba(239,68,68,0.55)',
                    background: 'rgba(239,68,68,0.08)',
                  }}
                >
                  <p className="text-[11px] font-heading font-bold" style={{ color: 'rgba(248,113,113,1)' }}>
                    Login issue
                  </p>
                  <p className="text-[10px] font-heading" style={{ color: 'var(--noir-foreground)' }}>
                    {authInlineError.message}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] font-heading" style={{ color: 'var(--noir-muted)' }}>
                      {authInlineError.status ? `HTTP ${authInlineError.status} - ` : ''}Support code: {authInlineError.supportCode}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const report = `Login error report | code=${authInlineError.supportCode} | status=${authInlineError.status || 'n/a'} | message=${authInlineError.message}`;
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(report).then(() => toast.success('Error details copied')).catch(() => toast.error('Copy failed'));
                        } else {
                          toast.error('Copy not supported');
                        }
                      }}
                      className="inline-flex items-center gap-1 text-[9px] font-heading uppercase tracking-wider hover:opacity-100 opacity-80"
                      style={{ color: 'var(--noir-primary)' }}
                    >
                      <Copy size={11} />
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {/* Email / username */}
              <div>
                <label
                  htmlFor="landing-email"
                  className="block text-[10px] font-heading font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--noir-primary)' }}
                >
                  {isLogin ? 'Email or Username' : 'Email'}
                </label>
                <input
                  id="landing-email"
                  name="email"
                  type={isLogin ? 'text' : 'email'}
                  autoComplete="username"
                  data-testid="email-input"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className={`w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                  placeholder={isLogin ? 'Enter your email or username' : 'Enter your email'}
                  required
                />
              </div>

              {/* Username — register only */}
              {!isLogin && (
                <div>
                  <label
                    htmlFor="landing-username"
                    className="block text-[10px] font-heading font-bold uppercase tracking-wider mb-1.5"
                    style={{ color: 'var(--noir-primary)' }}
                  >
                    Username
                  </label>
                  <input
                    id="landing-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    data-testid="username-input"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    maxLength={20}
                    className={`w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                    placeholder="Choose a character name (max 20)"
                    required
                  />
                  <p className="mt-1 text-[8px] font-heading leading-snug" style={{ color: 'var(--noir-muted)' }}>
                    Shown in-game; max 20 characters. Must not be your email or contain @.
                  </p>
                  {usernameCheck.status !== 'idle' && (
                    <p
                      className="mt-1 text-[9px] font-heading"
                      style={{
                        color:
                          usernameCheck.status === 'checking'
                            ? 'var(--noir-muted)'
                            : usernameCheck.status === 'error'
                              ? 'rgba(239,68,68,0.9)'
                              : usernameCheck.isTaken
                                ? 'rgba(239,68,68,0.95)'
                                : 'rgba(34,197,94,0.95)',
                      }}
                    >
                      {usernameCheck.message}
                    </p>
                  )}
                </div>
              )}

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="landing-password"
                    className="block text-[10px] font-heading font-bold uppercase tracking-wider"
                    style={{ color: 'var(--noir-primary)' }}
                  >
                    Password
                  </label>
                  {isLogin && (
                    <button
                      type="button"
                      onClick={() => navigate('/forgot-password')}
                      className="text-[9px] font-heading uppercase tracking-wider opacity-60 hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--noir-primary)' }}
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <input
                  id="landing-password"
                  name="password"
                  type="password"
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  data-testid="password-input"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className={`w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                  placeholder={isLogin ? 'Enter your password' : 'Choose a password (min 4 letters or numbers)'}
                  required
                />
                {!isLogin && (
                  <p className="mt-1 text-[9px] text-mutedForeground font-heading">At least 4 letters or numbers.</p>
                )}
              </div>

              {/* Confirm password — register only */}
              {!isLogin && (
                <div>
                  <label
                    htmlFor="landing-confirm-password"
                    className="block text-[10px] font-heading font-bold uppercase tracking-wider mb-1.5"
                    style={{ color: 'var(--noir-primary)' }}
                  >
                    Confirm Password
                  </label>
                  <input
                    id="landing-confirm-password"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    data-testid="confirm-password-input"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    className={`w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                    placeholder="Confirm your password"
                    required
                  />
                </div>
              )}

              {!isLogin && referralCode && (
                <>
                  <p className="text-[10px] font-heading" style={{ color: 'var(--noir-muted)' }}>
                    Referred by {referralCode}
                  </p>
                  <p className="text-[10px] font-heading" style={{ color: 'var(--noir-muted)' }}>
                    You&apos;ll get a free premium rank bar, 500 respect points, and bonus tokens (non-tradeable). Plus 10% higher crime payouts and a 10% GTA rare car boost.
                  </p>
                </>
              )}

              {needsLoginCaptcha && (
                <div className="flex flex-col items-center gap-2 py-1">
                  <p className="text-[10px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
                    Verify before signing in
                  </p>
                  <Turnstile
                    key={loginTurnstileWidgetKey}
                    siteKey={loginTurnstileCfg.site_key}
                    onSuccess={(token) => setLoginCaptchaToken(token)}
                    onExpire={() => {
                      setLoginCaptchaToken(null);
                      setLoginTurnstileWidgetKey((k) => k + 1);
                    }}
                    options={{ theme: 'dark' }}
                  />
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                data-testid="submit-button"
                disabled={loading || (needsLoginCaptcha && !loginCaptchaToken)}
                className={`w-full ${styles.btnPrimary} hover:opacity-90 active:scale-[0.98] rounded-sm font-heading font-bold uppercase tracking-wider py-3.5 transition-all disabled:opacity-50 touch-manipulation`}
              >
                {loading ? 'Processing…' : isLogin ? 'Enter the Family' : 'Join the Family'}
              </button>

              {/* Resend verification */}
              {verifySentForEmail && (
                <div
                  className="pt-3 border-t space-y-2"
                  style={{ borderColor: 'var(--noir-muted)', opacity: 0.85 }}
                >
                  <p className="text-[10px] font-heading" style={{ color: 'var(--noir-muted)' }}>
                    Didn&apos;t receive the email? Send another verification link.
                  </p>
                  <button
                    type="button"
                    disabled={resendLoading || resendCooldownSeconds > 0}
                    onClick={handleResendVerification}
                    className={`w-full ${styles.btnPrimary} opacity-75 hover:opacity-100 rounded-sm font-heading font-bold uppercase tracking-wider py-2.5 text-xs transition-all disabled:opacity-40 touch-manipulation`}
                  >
                    {resendLoading
                      ? 'Sending…'
                      : resendCooldownSeconds > 0
                        ? `Resend in ${Math.floor(resendCooldownSeconds / 60)}:${String(resendCooldownSeconds % 60).padStart(2, '0')}`
                        : 'Resend Verification Email'}
                  </button>
                </div>
              )}
            </form>
            )}

            {/* ── STAT STRIP ─────────────────────────────────── */}
            {/*   4-column grid, same panel style as rest of app  */}
            <div
              className="grid grid-cols-4 border-t"
              style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.1)' }}
            >
              {[
                { val: '13',  lbl: 'Ranks'    },
                { val: '5',   lbl: 'Prestiges' },
                { val: '7+',  lbl: 'Casinos'  },
                { val: '∞',   lbl: 'Ops'      },
              ].map(({ val, lbl }, i) => (
                <div
                  key={lbl}
                  className="flex flex-col items-center justify-center py-3 gap-0.5"
                  style={{
                    borderRight: i < 3 ? '1px solid rgba(var(--noir-primary-rgb,201,168,76),0.08)' : undefined,
                  }}
                >
                  <span
                    className="text-lg font-heading font-bold leading-none"
                    style={{ color: 'var(--noir-primary)' }}
                  >
                    {val}
                  </span>
                  <span
                    className="text-[7px] font-heading uppercase tracking-[0.18em]"
                    style={{ color: 'var(--noir-muted)' }}
                  >
                    {lbl}
                  </span>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* ── TAGLINE ─────────────────────────────────────── */}
          <p
            className="text-center font-heading text-[10px] uppercase tracking-[0.25em] mt-5 landing-fade-up-3"
            style={{ color: 'var(--noir-primary)', opacity: 0.35 }}
          >
            Omertà — silence is the first rule
          </p>

          {/* ── COPYRIGHT ───────────────────────────────────────────────── */}
          <div className="mt-6 flex flex-col items-center gap-2 text-center landing-fade-up-3">
            <div
              className="w-10 h-10 rounded-full overflow-hidden shrink-0 border-2"
              style={{
                borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.35)',
                opacity: 0.85,
              }}
            >
              <img
                src={landingGangsterImg}
                alt=""
                className="w-full h-full object-cover object-[center_15%]"
                decoding="async"
              />
            </div>
            <p
              className="font-heading text-[9px] uppercase tracking-[0.15em]"
              style={{ color: 'var(--noir-primary)', opacity: 0.5 }}
            >
              MafiaWars.co.uk©
            </p>
          </div>

          </div>
        </div>
      </div>
    </div>
  );
}
