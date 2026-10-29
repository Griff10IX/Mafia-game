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
import { FieldIcon, LandingScene, LiveStreets, MostWanted, STRENGTH_LABELS, passwordStrength, useLandingFeed } from './LandingNoirParts';
import './landingNoir.css';

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

  const [showPassword, setShowPassword] = useState(false);
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

  const feed = useLandingFeed(!ipBanned && !ipBanChecking);

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

  const showStats = presence.online_count != null
    || presence.active_last_week != null
    || presence.families_count != null
    || presence.locked_up != null;
  const strength = passwordStrength(formData.password);

  return (
    <div className="ln-page" data-testid="landing-page" style={LANDING_SKY_VARS}>
      <LandingScene />
      <main className="ln-main">
        <div id="landing-auth-card" className="ln-wrap">
          <header className="ln-brand">
            {bannerEnabled && <p className="ln-banner">{bannerMessage || DEFAULT_BANNER_MESSAGE}</p>}
            <h1 data-testid="landing-title">MAFIA<br />WARS</h1>
            <p className="ln-tag">Build your empire · Enforce omertà</p>
            {showStats && (
              <div className="ln-stats" data-testid="landing-presence" aria-live="polite">
                {presence.online_count != null && (
                  <span className="ln-on"><span className="ln-dot" aria-hidden /><b>{presence.online_count.toLocaleString()}</b>on the streets</span>
                )}
                {presence.active_last_week != null && <span><b>{presence.active_last_week.toLocaleString()}</b>online this week</span>}
                {presence.families_count != null && <span><b>{presence.families_count.toLocaleString()}</b>crews</span>}
                {presence.locked_up != null && <span><b>{presence.locked_up.toLocaleString()}</b>locked up</span>}
              </div>
            )}
          </header>

          {!ipBanned && !ipBanChecking && <MostWanted people={feed.most_wanted} />}

          {ipBanned ? (
            <IpBannedPanel ban={ipBan} />
          ) : ipBanChecking ? (
            <div className="ln-card" data-testid="ip-ban-checking"><p className="ln-checking">Checking…</p></div>
          ) : (
            <div className="ln-card">
              <div className="ln-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={isLogin} onClick={() => setIsLogin(true)} data-testid="login-tab">Log in</button>
                <button type="button" role="tab" aria-selected={!isLogin} onClick={() => setIsLogin(false)} data-testid="register-tab">Join the family</button>
              </div>

              {preregisteredSuccess ? (
                <div className="ln-success">
                  <p>Account created! Check your email to verify, then you can log in.</p>
                  <p className="ln-hint">Share your referral link once you&apos;re in the game</p>
                  <div className="ln-copy">
                    <code>{referralUrl}</code>
                    <button type="button" onClick={copyReferralLink}><Copy size={13} />Copy</button>
                  </div>
                  <button type="button" className="ln-cta ln-secondary" onClick={() => setPreregisteredSuccess(null)}>Done</button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="ln-form" autoComplete="on">
                  {authInlineError && (
                    <div className="ln-error" role="alert">
                      <p className="t">Login issue</p>
                      <p className="m">{authInlineError.message}</p>
                      <div className="row">
                        <span>{authInlineError.status ? `HTTP ${authInlineError.status} · ` : ''}Support code: {authInlineError.supportCode}</span>
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
                        >
                          <Copy size={11} />Copy
                        </button>
                      </div>
                    </div>
                  )}

                  <label htmlFor="landing-email" className="ln-label">{isLogin ? 'Email or username' : 'Email'}</label>
                  <div className="ln-field">
                    <FieldIcon name={isLogin ? 'user' : 'mail'} />
                    <input
                      id="landing-email"
                      name="email"
                      type={isLogin ? 'text' : 'email'}
                      inputMode={isLogin ? undefined : 'email'}
                      autoComplete={isLogin ? 'username' : 'email'}
                      autoCapitalize="none"
                      spellCheck={false}
                      enterKeyHint="next"
                      data-testid="email-input"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="ln-input"
                      placeholder={isLogin ? 'Email or username' : 'you@example.com'}
                      required
                    />
                  </div>

                  {!isLogin && (
                    <>
                      <label htmlFor="landing-username" className="ln-label">Gangster name</label>
                      <div className="ln-field">
                        <FieldIcon name="user" />
                        <input
                          id="landing-username"
                          name="username"
                          type="text"
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          enterKeyHint="next"
                          data-testid="username-input"
                          value={formData.username}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                          maxLength={20}
                          className="ln-input"
                          placeholder="Pick something they'll fear"
                          required
                        />
                      </div>
                      {usernameCheck.status !== 'idle' ? (
                        <p className={`ln-hint ${usernameCheck.status === 'ok' && !usernameCheck.isTaken ? 'ok' : usernameCheck.status === 'checking' ? '' : 'bad'}`}>{usernameCheck.message}</p>
                      ) : (
                        <p className="ln-hint">Shown in-game. Max 20 characters, not your email, no @.</p>
                      )}
                    </>
                  )}

                  <div className="ln-label-row">
                    <label htmlFor="landing-password" className="ln-label">Password</label>
                    {isLogin && <button type="button" className="ln-link" onClick={() => navigate('/forgot-password')}>Forgot?</button>}
                  </div>
                  <div className="ln-field">
                    <FieldIcon name="lock" />
                    <input
                      id="landing-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      enterKeyHint={isLogin ? 'go' : 'next'}
                      data-testid="password-input"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="ln-input ln-has-eye"
                      placeholder={isLogin ? '••••••••' : 'At least 4 letters or numbers'}
                      required
                    />
                    <button type="button" className="ln-eye" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {!isLogin && formData.password && (
                    <div className="ln-strength" data-level={strength}><i /><i /><i /><i /><span>{STRENGTH_LABELS[strength]}</span></div>
                  )}

                  {!isLogin && (
                    <>
                      <label htmlFor="landing-confirm-password" className="ln-label">Confirm password</label>
                      <div className="ln-field">
                        <FieldIcon name="lock" />
                        <input
                          id="landing-confirm-password"
                          name="confirmPassword"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          enterKeyHint="go"
                          data-testid="confirm-password-input"
                          value={formData.confirmPassword}
                          onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                          className="ln-input"
                          placeholder="Type it again"
                          required
                        />
                      </div>
                      {formData.confirmPassword && formData.confirmPassword !== formData.password && (
                        <p className="ln-hint bad">Passwords don&apos;t match yet.</p>
                      )}
                    </>
                  )}

                  {!isLogin && referralCode && (
                    <p className="ln-note">
                      Referred by <b>{referralCode}</b>. You&apos;ll get a free premium rank bar, 500 respect points and bonus tokens (non-tradeable), plus 10% higher crime payouts and a 10% GTA rare car boost.
                    </p>
                  )}
                  {!isLogin && !referralCode && (
                    <div className="ln-perks">
                      <div><b>Free to play</b>No card needed</div>
                      <div><b>Join a family</b>Crews, rackets, wars</div>
                      <div><b>Casinos</b>Own the house</div>
                      <div><b>Rise the ranks</b>From Rat to the top</div>
                    </div>
                  )}

                  {needsLoginCaptcha && (
                    <div className="ln-captcha">
                      <p className="ln-hint">Verify before signing in</p>
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
                    className="ln-cta"
                  >
                    {loading ? 'Checking the books…' : isLogin ? 'Enter the family' : 'Make your name'}
                  </button>

                  {verifySentForEmail && (
                    <div className="ln-resend">
                      <p className="ln-hint">Didn&apos;t receive the email? Send another verification link.</p>
                      <button
                        type="button"
                        className="ln-cta ln-secondary"
                        disabled={resendLoading || resendCooldownSeconds > 0}
                        onClick={handleResendVerification}
                      >
                        {resendLoading
                          ? 'Sending…'
                          : resendCooldownSeconds > 0
                            ? `Resend in ${Math.floor(resendCooldownSeconds / 60)}:${String(resendCooldownSeconds % 60).padStart(2, '0')}`
                            : 'Resend verification email'}
                      </button>
                    </div>
                  )}

                  <p className="ln-alt">
                    {isLogin
                      ? <>New to the streets? <button type="button" onClick={() => setIsLogin(false)}>Make your name</button></>
                      : <>Already made? <button type="button" onClick={() => setIsLogin(true)}>Log in</button></>}
                  </p>
                </form>
              )}
            </div>
          )}

          {!ipBanned && !ipBanChecking && <LiveStreets items={feed.live} rows={3} />}
          <p className="ln-footer">mafiawars.co.uk</p>
        </div>
      </main>
    </div>
  );
}
