import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { getBaseURL } from '../utils/api';
import styles from '../styles/noir.module.css';

export default function Landing({ setIsAuthenticated }) {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin
        ? { email: formData.email, password: formData.password }
        : formData;

      const response = await api.post(endpoint, payload);
      localStorage.setItem('token', response.data.token);
      setIsAuthenticated(true);
      toast.success(isLogin ? 'Welcome back!' : 'Account created successfully!');
    } catch (error) {
      let msg;
      if (error.code === 'ERR_NETWORK' || !error.response) {
        const base = error.config?.baseURL || getBaseURL();
        msg = `Cannot reach server. Backend URL: ${base} — Set REACT_APP_BACKEND_URL in Vercel (production) or leave unset for same-origin /api.`;
      } else if (error.response?.data?.detail) {
        const d = error.response.data.detail;
        msg = Array.isArray(d) ? d.map((x) => x.msg || x).join(', ') : d;
      } else if (error.response?.status === 404) {
        msg = `Login endpoint not found (404). Backend may be wrong or not running. URL: ${error.config?.baseURL || '?'}`;
      } else if (error.response?.status) {
        msg = `Login failed (${error.response.status}). ${error.response?.data?.detail || error.response?.statusText || ''}`.trim();
      } else {
        msg = 'Authentication failed';
      }
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`relative min-h-screen ${styles.page} ${styles.themeGangsterModern}`}
      data-testid="landing-page"
      style={{
        backgroundImage: `url(${process.env.PUBLIC_URL || ''}/landing-bg.png)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-black/60 pointer-events-none" aria-hidden />
      <div className="relative min-h-screen flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Logo – same style as sidebar header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="h-px flex-1 max-w-[60px] md:max-w-[100px]" style={{ backgroundColor: 'var(--noir-accent-line)', opacity: 0.5 }} />
              <h1 className="text-4xl md:text-5xl font-heading font-bold uppercase tracking-[0.2em] md:tracking-[0.25em]" style={{ color: 'var(--noir-foreground)' }} data-testid="landing-title">
                MAFIA WARS
              </h1>
              <div className="h-px flex-1 max-w-[60px] md:max-w-[100px]" style={{ backgroundColor: 'var(--noir-accent-line)', opacity: 0.5 }} />
            </div>
            <p className="text-xs font-heading tracking-[0.35em] uppercase" style={{ color: 'var(--noir-muted)' }}>Chicago, 1927</p>
          </div>

          {/* Auth Form – same panel/inputs as other pages */}
          <div className={`${styles.panel} rounded-sm overflow-hidden`}>
            <div className={`px-4 py-2 ${styles.panelHeader} flex gap-1`}>
              <button
                onClick={() => setIsLogin(true)}
                data-testid="login-tab"
                className={`flex-1 py-2.5 rounded-sm uppercase tracking-wider text-xs font-heading font-bold transition-smooth border ${
                  isLogin ? `${styles.tabActive}` : 'bg-transparent border-transparent hover:opacity-90'
                }`}
                style={!isLogin ? { color: 'var(--noir-muted)' } : undefined}
              >
                Login
              </button>
              <button
                onClick={() => setIsLogin(false)}
                data-testid="register-tab"
                className={`flex-1 py-2.5 rounded-sm uppercase tracking-wider text-xs font-heading font-bold transition-smooth border ${
                  !isLogin ? `${styles.tabActive}` : 'bg-transparent border-transparent hover:opacity-90'
                }`}
                style={isLogin ? { color: 'var(--noir-muted)' } : undefined}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4" autoComplete="on">
              <div>
                <label htmlFor="landing-email" className="block text-xs font-heading font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--noir-primary)' }}>Email</label>
                <input
                  id="landing-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  data-testid="email-input"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className={`w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                  placeholder="Enter your email"
                  required
                />
              </div>

              {!isLogin && (
                <div>
                  <label htmlFor="landing-username" className="block text-xs font-heading font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--noir-primary)' }}>Username</label>
                  <input
                    id="landing-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    data-testid="username-input"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className={`w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                    placeholder="Choose a username"
                    required={!isLogin}
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="landing-password" className="block text-xs font-heading font-bold uppercase tracking-wider" style={{ color: 'var(--noir-primary)' }}>Password</label>
                  {isLogin && (
                    <button
                      type="button"
                      onClick={() => navigate('/forgot-password')}
                      className="text-[10px] font-heading uppercase tracking-wider opacity-80 hover:opacity-100 transition-opacity"
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
                  placeholder={isLogin ? 'Enter your password' : 'Choose a password'}
                  required
                />
              </div>

              <button
                type="submit"
                data-testid="submit-button"
                disabled={loading}
                className={`w-full ${styles.btnPrimary} hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 transition-smooth disabled:opacity-50`}
              >
                {loading ? 'Processing...' : isLogin ? 'Enter the Family' : 'Join the Family'}
              </button>
            </form>
          </div>

          {/* Features – same panel style as other pages */}
          <div className="mt-8 grid grid-cols-2 gap-4 text-center">
            <div className={`${styles.panel} rounded-sm p-4`}>
              <div className="text-2xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>11</div>
              <div className={`text-xs font-heading uppercase tracking-widest mt-0.5 ${styles.textMuted}`}>Ranks</div>
            </div>
            <div className={`${styles.panel} rounded-sm p-4`}>
              <div className="text-2xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>∞</div>
              <div className={`text-xs font-heading uppercase tracking-widest mt-0.5 ${styles.textMuted}`}>Opportunities</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
