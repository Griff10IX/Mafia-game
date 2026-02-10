import { useState } from 'react';
import { toast } from 'sonner';
import api from '../utils/api';

export default function Landing({ setIsAuthenticated }) {
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
        msg = 'Cannot reach server. Is the backend running? Set REACT_APP_BACKEND_URL in frontend .env (e.g. http://localhost:8000).';
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
    <div className="min-h-screen relative overflow-hidden" data-testid="landing-page">
      {/* Background */}
      <div
        className="absolute inset-0 vintage-filter"
        style={{
          backgroundImage: 'url(https://images.unsplash.com/photo-1576456344355-eaa41dda10ad?w=1920&q=80)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-5xl md:text-6xl font-heading font-bold text-primary mb-2" data-testid="landing-title">
              MAFIA WARS
            </h1>
            <p className="text-foreground/80 text-sm tracking-widest uppercase">Chicago, 1927</p>
          </div>

          {/* Auth Form */}
          <div className="glass-effect rounded-sm p-8">
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setIsLogin(true)}
                data-testid="login-tab"
                className={`flex-1 py-2 rounded-sm uppercase tracking-wider text-sm font-bold transition-smooth ${
                  isLogin
                    ? 'bg-primary text-primaryForeground'
                    : 'bg-transparent text-mutedForeground hover:text-foreground'
                }`}
              >
                Login
              </button>
              <button
                onClick={() => setIsLogin(false)}
                data-testid="register-tab"
                className={`flex-1 py-2 rounded-sm uppercase tracking-wider text-sm font-bold transition-smooth ${
                  !isLogin
                    ? 'bg-primary text-primaryForeground'
                    : 'bg-transparent text-mutedForeground hover:text-foreground'
                }`}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-mutedForeground mb-1.5">Email</label>
                <input
                  type="email"
                  data-testid="email-input"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-input border border-border focus:border-primary rounded-sm h-12 px-4 text-foreground placeholder:text-mutedForeground/50 transition-smooth"
                  placeholder="Enter your email"
                  required
                />
              </div>

              {!isLogin && (
                <div>
                  <label className="block text-sm text-mutedForeground mb-1.5">Username</label>
                  <input
                    type="text"
                    data-testid="username-input"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full bg-input border border-border focus:border-primary rounded-sm h-12 px-4 text-foreground placeholder:text-mutedForeground/50 transition-smooth"
                    placeholder="Choose a username"
                    required={!isLogin}
                  />
                </div>
              )}

              <div>
                <label className="block text-sm text-mutedForeground mb-1.5">Password</label>
                <input
                  type="password"
                  data-testid="password-input"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full bg-input border border-border focus:border-primary rounded-sm h-12 px-4 text-foreground placeholder:text-mutedForeground/50 transition-smooth"
                  placeholder="Enter your password"
                  required
                />
              </div>

              <button
                type="submit"
                data-testid="submit-button"
                disabled={loading}
                className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50 gold-glow"
              >
                {loading ? 'Processing...' : isLogin ? 'Enter the Family' : 'Join the Family'}
              </button>
            </form>
          </div>

          {/* Features */}
          <div className="mt-8 grid grid-cols-2 gap-4 text-center">
            <div className="glass-effect p-4 rounded-sm">
              <div className="text-primary text-2xl font-bold font-mono">11</div>
              <div className="text-xs text-mutedForeground uppercase tracking-wider">Ranks</div>
            </div>
            <div className="glass-effect p-4 rounded-sm">
              <div className="text-primary text-2xl font-bold font-mono">∞</div>
              <div className="text-xs text-mutedForeground uppercase tracking-wider">Opportunities</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
