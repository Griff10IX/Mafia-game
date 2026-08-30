/**
 * Redesigned login/register landing.
 * To restore the previous UI: set `USE_LANDING_CLASSIC = true` in `src/config/landing.js`.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Turnstile } from '@marsidev/react-turnstile';
import api, { getBaseURL, AUTH_ERROR_KEY } from '../../utils/api';
import { markDeadAliveEstateNudgePending } from '../../utils/deadAliveEstateNudge';
import { seedDashboardSessionFromLogin } from '../../utils/dashboardSessionCache';
import { parseIpBanFromError } from '../../utils/ipBan';
import { useIpBanGate } from '../../hooks/useIpBanGate';
import IpBannedPanel from '../../components/IpBannedPanel';
import styles from '../../styles/noir.module.css';

const landingGangsterImg = `${process.env.PUBLIC_URL || ''}/images/landing-gangster.png`;

/** Login always uses the site sky accent (GhostFace default), even if localStorage has another colour. */
const LANDING_SKY_VARS = {
  '--noir-primary': '#0ea5e9',
  '--noir-primary-bright': '#38bdf8',
  '--noir-primary-dark': '#0284c7',
  '--noir-primary-rgb': '14, 165, 233',
  '--noir-primary-foreground': '#000000',
  '--noir-button-foreground': '#000000',
  '--noir-gradient-1': '#38bdf8',
  '--noir-gradient-2': '#0ea5e9',
  '--noir-gradient-3': '#0284c7',
  '--noir-gradient-4': '#0284c7',
  '--noir-button-gradient-1': '#38bdf8',
  '--noir-button-gradient-2': '#0ea5e9',
  '--noir-button-gradient-3': '#0284c7',
  '--noir-button-gradient-4': '#0284c7',
  '--noir-button-primary-rgb': '14, 165, 233',
  '--noir-button-border': '#38bdf8',
  '--noir-accent-line': '#0ea5e9',
  '--noir-accent-line-dark': '#0284c7',
  '--noir-tab-bg': 'rgba(14, 165, 233, 0.5)',
};

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
  const [presence, setPresence] = useState({
    online_count: null,
    active_last_week: null,
    families_count: null,
    locked_up: null,
  });

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
    let cancelled = false;
    const loadPresence = () => {
      api
        .get('/auth/landing-presence')
        .then((r) => {
          if (cancelled) return;
          const d = r.data || {};
          const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
          setPresence({
            online_count: num(d.online_count),
            active_last_week: num(d.active_last_week),
            families_count: num(d.families_count),
            locked_up: num(d.locked_up),
          });
        })
        .catch(() => {});
    };
    loadPresence();
    const id = setInterval(loadPresence, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
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
          try { seedDashboardSessionFromLogin(response.data.user); } catch (_) { /* ignore */ }
          localStorage.setItem('token', response.data.token);
          setIsAuthenticated(true);
        }
        toast.success(response.data.message || 'Check your email to verify your account.');
        setVerifySentForEmail(formData.email);
        return;
      }
      try { seedDashboardSessionFromLogin(response.data.user); } catch (_) { /* ignore */ }
      localStorage.setItem('token', response.data.token);
      setIsAuthenticated(true);
      markDeadAliveEstateNudgePending();
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
      className={`relative min-h-screen overflow-x-hidden ${styles.page} ${styles.themeGangsterModern}`}
      data-testid="landing-page"
      style={LANDING_SKY_VARS}
    >
      <style>{`
        @keyframes landing-fade-up {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes landing-bg-drift {
          0%   { transform: scale(1.06) translate3d(0, 0, 0); }
          50%  { transform: scale(1.1) translate3d(-1.2%, -0.6%, 0); }
          100% { transform: scale(1.06) translate3d(0, 0, 0); }
        }
        @keyframes landing-shaft {
          0%, 100% { opacity: 0.35; }
          50%      { opacity: 0.65; }
        }
        @keyframes landing-pulse-dot {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 1; transform: scale(1.15); }
        }
        .landing-fade-up   { animation: landing-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .landing-fade-up-1 { animation: landing-fade-up 0.55s 0.1s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .landing-fade-up-2 { animation: landing-fade-up 0.55s 0.2s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .landing-bg-drift  { animation: landing-bg-drift 28s ease-in-out infinite; }
        .landing-shaft     { animation: landing-shaft 7s ease-in-out infinite; }
        .landing-pulse-dot { animation: landing-pulse-dot 2.4s ease-in-out infinite; }
        /* Soften form: darker fields, kill Chrome autofill white/blue flash */
        #landing-auth-card .landing-auth-panel {
          background: linear-gradient(180deg, rgba(14,14,16,0.94) 0%, rgba(8,8,10,0.96) 100%) !important;
          border-color: rgba(14, 165, 233, 0.16) !important;
          box-shadow: 0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.03) !important;
        }
        #landing-auth-card .landing-auth-panel input.landing-field {
          background: rgba(8, 10, 12, 0.92) !important;
          border: 1px solid rgba(255, 255, 255, 0.07) !important;
          color: rgba(220, 228, 236, 0.88) !important;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.45) !important;
          -webkit-text-fill-color: rgba(220, 228, 236, 0.88);
          caret-color: #38bdf8;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        #landing-auth-card .landing-auth-panel input.landing-field::placeholder {
          color: rgba(148, 163, 184, 0.42) !important;
          -webkit-text-fill-color: rgba(148, 163, 184, 0.42);
        }
        #landing-auth-card .landing-auth-panel input.landing-field:focus {
          border-color: rgba(14, 165, 233, 0.4) !important;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(14, 165, 233, 0.18) !important;
          outline: none;
        }
        #landing-auth-card .landing-auth-panel input.landing-field:-webkit-autofill,
        #landing-auth-card .landing-auth-panel input.landing-field:-webkit-autofill:hover,
        #landing-auth-card .landing-auth-panel input.landing-field:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px #0a0c0e inset !important;
          box-shadow: 0 0 0 1000px #0a0c0e inset !important;
          -webkit-text-fill-color: rgba(220, 228, 236, 0.88) !important;
          caret-color: #38bdf8;
          border: 1px solid rgba(255, 255, 255, 0.07) !important;
          transition: background-color 99999s ease-out 0s;
        }
        /* Pin the login-sized stack so Register grows down instead of recentering the page. */
        .landing-auth-stack {
          padding-top: max(2rem, calc(env(safe-area-inset-top, 0px) + 1.5rem), calc(50dvh - 14.75rem));
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-fade-up, .landing-fade-up-1, .landing-fade-up-2,
          .landing-bg-drift, .landing-shaft, .landing-pulse-dot { animation: none !important; }
        }
      `}</style>

      {/* Full-bleed atmosphere */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div
          className="absolute inset-[-4%] landing-bg-drift"
          style={{
            backgroundImage: `url(${process.env.PUBLIC_URL || ''}/images/landing-bg.png)`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
        <div
          className="absolute inset-y-0 right-0 w-[55%] max-w-xl opacity-[0.22] hidden sm:block"
          style={{
            backgroundImage: `url(${landingGangsterImg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center 12%',
            maskImage: 'linear-gradient(90deg, transparent 0%, black 35%, black 100%)',
            WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 35%, black 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(6,6,8,0.55) 0%, rgba(6,6,8,0.72) 42%, rgba(6,6,8,0.92) 100%)',
          }}
        />
        <div
          className="absolute inset-0 landing-shaft"
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 50% -5%, rgba(var(--noir-primary-rgb,14,165,233),0.2) 0%, transparent 60%)',
          }}
        />
      </div>

      <div className="landing-auth-stack relative min-h-[100dvh] flex flex-col items-center justify-start px-4 sm:px-6 pb-8 sm:pb-12 safe-area-pb">
        <div id="landing-auth-card" className="w-full max-w-[26rem] mx-auto flex flex-col mobile-page-root">

          {/* Brand-first hero (no stats / badges / crest overlays) */}
          <header className="text-center mb-7 sm:mb-9 landing-fade-up">
            {bannerEnabled && (
              <p
                className="mb-5 text-[11px] font-heading leading-relaxed px-1"
                style={{ color: 'var(--noir-primary)', opacity: 0.85, whiteSpace: 'pre-line' }}
              >
                {bannerMessage || DEFAULT_BANNER_MESSAGE}
              </p>
            )}
            <h1
              className="font-heading font-black uppercase tracking-[0.18em] text-[clamp(2.35rem,8vw,3.75rem)] leading-none"
              style={{
                color: 'rgba(232, 236, 240, 0.92)',
                textShadow: '0 2px 40px rgba(0,0,0,0.65), 0 0 60px rgba(var(--noir-primary-rgb,14,165,233),0.18)',
              }}
              data-testid="landing-title"
            >
              MAFIA WARS
            </h1>
            <p
              className="mt-3 text-[11px] sm:text-xs font-heading tracking-[0.08em] landing-fade-up-1"
              style={{ color: 'rgba(200,210,220,0.55)' }}
            >
              Build your empire. Enforce omertà.
            </p>
            {(presence.online_count != null
              || presence.active_last_week != null
              || presence.families_count != null
              || presence.locked_up != null) && (
              <div
                className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 sm:gap-x-4 font-heading text-[10px] sm:text-[11px] tracking-wide landing-fade-up-1"
                data-testid="landing-presence"
                aria-live="polite"
              >
                {presence.online_count != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="landing-pulse-dot inline-block h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: '#4ade80', boxShadow: '0 0 8px rgba(74,222,128,0.45)' }}
                      aria-hidden
                    />
                    <span className="tabular-nums font-bold" style={{ color: '#4ade80' }}>
                      {presence.online_count.toLocaleString()}
                    </span>
                    <span style={{ color: 'rgba(180,190,200,0.42)' }}>on the streets</span>
                  </span>
                )}
                {presence.active_last_week != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="tabular-nums font-semibold" style={{ color: 'rgba(210,220,230,0.78)' }}>
                      {presence.active_last_week.toLocaleString()}
                    </span>
                    <span style={{ color: 'rgba(180,190,200,0.42)' }}>online this week</span>
                  </span>
                )}
                {presence.families_count != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="tabular-nums font-semibold" style={{ color: 'rgba(56,189,248,0.85)' }}>
                      {presence.families_count.toLocaleString()}
                    </span>
                    <span style={{ color: 'rgba(180,190,200,0.42)' }}>crews</span>
                  </span>
                )}
                {presence.locked_up != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="tabular-nums font-semibold" style={{ color: 'rgba(251,146,60,0.88)' }}>
                      {presence.locked_up.toLocaleString()}
                    </span>
                    <span style={{ color: 'rgba(180,190,200,0.42)' }}>locked up</span>
                  </span>
                )}
              </div>
            )}
          </header>

          {/* Auth form — hidden while IP-banned (no login/register tabs) */}
          {ipBanned ? (
            <div className="landing-fade-up-2">
              <IpBannedPanel ban={ipBan} />
            </div>
          ) : ipBanChecking ? (
            <div
              className={`landing-fade-up-2 landing-auth-panel overflow-hidden rounded-xl border ${styles.panel}`}
              data-testid="ip-ban-checking"
              style={{
                borderColor: 'rgba(var(--noir-primary-rgb,14,165,233),0.16)',
                background: 'linear-gradient(180deg, rgba(14,14,16,0.94) 0%, rgba(8,8,10,0.96) 100%)',
                boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
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
            className={`landing-fade-up-2 landing-auth-panel overflow-hidden rounded-xl border ${styles.panel}`}
            style={{
              borderColor: 'rgba(var(--noir-primary-rgb,14,165,233),0.16)',
              background: 'linear-gradient(180deg, rgba(14,14,16,0.94) 0%, rgba(8,8,10,0.96) 100%)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
            }}
          >
            <div
              className="px-4 pt-4 pb-0 flex gap-1"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <button
                type="button"
                onClick={() => setIsLogin(true)}
                data-testid="login-tab"
                className={`flex-1 py-2.5 uppercase tracking-wider text-[10px] font-heading font-bold transition-all border-b-2 ${
                  isLogin ? styles.tabActive : 'bg-transparent border-transparent'
                }`}
                style={!isLogin ? { color: 'var(--noir-muted)', borderBottom: '2px solid transparent' } : undefined}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => setIsLogin(false)}
                data-testid="register-tab"
                className={`flex-1 py-2.5 uppercase tracking-wider text-[10px] font-heading font-bold transition-all border-b-2 ${
                  !isLogin ? styles.tabActive : 'bg-transparent border-transparent'
                }`}
                style={isLogin ? { color: 'var(--noir-muted)', borderBottom: '2px solid transparent' } : undefined}
              >
                Register
              </button>
            </div>

            {preregisteredSuccess ? (
              <div className="p-5 sm:p-6 space-y-4">
                <p className="text-sm font-heading text-center" style={{ color: 'var(--noir-foreground)' }}>
                  Account created! Check your email to verify, then you can log in.
                </p>
                <p className="text-[10px] font-heading uppercase tracking-wider text-center" style={{ color: 'var(--noir-primary)', opacity: 0.8 }}>
                  Share your referral link once you&apos;re in the game
                </p>
                <div
                  className="flex items-center gap-2 rounded border p-3"
                  style={{
                    borderColor: 'rgba(var(--noir-primary-rgb,14,165,233),0.2)',
                    backgroundColor: 'rgba(var(--noir-primary-rgb,14,165,233),0.05)',
                  }}
                >
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
              <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4" autoComplete="on">
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

                <div>
                  <label
                    htmlFor="landing-email"
                    className="block text-[10px] font-heading font-bold uppercase tracking-wider mb-1.5"
                    style={{ color: 'rgba(56, 189, 248, 0.72)' }}
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
                    className={`landing-field w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                    placeholder={isLogin ? 'Enter your email or username' : 'Enter your email'}
                    required
                  />
                </div>

                {!isLogin && (
                  <div>
                    <label
                      htmlFor="landing-username"
                      className="block text-[10px] font-heading font-bold uppercase tracking-wider mb-1.5"
                      style={{ color: 'rgba(56, 189, 248, 0.72)' }}
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
                      className={`landing-field w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
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

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="landing-password"
                      className="block text-[10px] font-heading font-bold uppercase tracking-wider"
                      style={{ color: 'rgba(56, 189, 248, 0.72)' }}
                    >
                      Password
                    </label>
                    {isLogin && (
                      <button
                        type="button"
                        onClick={() => navigate('/forgot-password')}
                        className="text-[9px] font-heading uppercase tracking-wider opacity-60 hover:opacity-100 transition-opacity"
                        style={{ color: 'rgba(56, 189, 248, 0.72)' }}
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
                    className={`landing-field w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                    placeholder={isLogin ? 'Enter your password' : 'Choose a password (min 4 letters or numbers)'}
                    required
                  />
                  {!isLogin && (
                    <p className="mt-1 text-[9px] text-mutedForeground font-heading">At least 4 letters or numbers.</p>
                  )}
                </div>

                {!isLogin && (
                  <div>
                    <label
                      htmlFor="landing-confirm-password"
                      className="block text-[10px] font-heading font-bold uppercase tracking-wider mb-1.5"
                      style={{ color: 'rgba(56, 189, 248, 0.72)' }}
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
                      className={`landing-field w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
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

                <button
                  type="submit"
                  data-testid="submit-button"
                  disabled={loading || (needsLoginCaptcha && !loginCaptchaToken)}
                  className={`w-full ${styles.btnPrimary} hover:opacity-90 active:scale-[0.98] rounded-sm font-heading font-bold uppercase tracking-wider py-3.5 transition-all disabled:opacity-50 touch-manipulation`}
                >
                  {loading ? 'Processing…' : isLogin ? 'Enter the Family' : 'Join the Family'}
                </button>

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
          </div>
          )}

          <p
            className="mt-8 text-center font-heading text-[9px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--noir-primary)', opacity: 0.4 }}
          >
            MafiaWars.co.uk
          </p>
        </div>
      </div>
    </div>
  );
}
