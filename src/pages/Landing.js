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
        const base = error.config?.baseURL || process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
        msg = `Cannot reach server. Backend URL: ${base}/api — Set REACT_APP_BACKEND_URL in Vercel (production) or .env (local).`;
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
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-r from-transparent to-primary/70" />
              <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary uppercase tracking-[0.2em] md:tracking-[0.25em]" data-testid="landing-title">
                MAFIA WARS
              </h1>
              <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-l from-transparent to-primary/70" />
            </div>
            <p className="text-primary/90 text-xs font-heading tracking-[0.35em] uppercase">Chicago, 1927</p>
          </div>

          {/* Auth Form */}
          <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-2xl shadow-primary/10">
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex gap-1">
              <button
                onClick={() => setIsLogin(true)}
                data-testid="login-tab"
                className={`flex-1 py-2.5 rounded-sm uppercase tracking-wider text-xs font-heading font-bold transition-smooth border ${
                  isLogin
                    ? 'bg-primary/30 text-primary border-primary/50'
                    : 'bg-transparent text-mutedForeground border-transparent hover:text-foreground hover:border-primary/20'
                }`}
              >
                Login
              </button>
              <button
                onClick={() => setIsLogin(false)}
                data-testid="register-tab"
                className={`flex-1 py-2.5 rounded-sm uppercase tracking-wider text-xs font-heading font-bold transition-smooth border ${
                  !isLogin
                    ? 'bg-primary/30 text-primary border-primary/50'
                    : 'bg-transparent text-mutedForeground border-transparent hover:text-foreground hover:border-primary/20'
                }`}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1.5">Email</label>
                <input
                  type="email"
                  data-testid="email-input"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-12 px-4 text-foreground font-heading placeholder:text-mutedForeground/50 focus:border-primary/50 focus:outline-none transition-smooth"
                  placeholder="Enter your email"
                  required
                />
              </div>

              {!isLogin && (
                <div>
                  <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1.5">Username</label>
                  <input
                    type="text"
                    data-testid="username-input"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-12 px-4 text-foreground font-heading placeholder:text-mutedForeground/50 focus:border-primary/50 focus:outline-none transition-smooth"
                    placeholder="Choose a username"
                    required={!isLogin}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1.5">Password</label>
                <input
                  type="password"
                  data-testid="password-input"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-12 px-4 text-foreground font-heading placeholder:text-mutedForeground/50 focus:border-primary/50 focus:outline-none transition-smooth"
                  placeholder="Enter your password"
                  required
                />
              </div>

              <button
                type="submit"
                data-testid="submit-button"
                disabled={loading}
                className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth disabled:opacity-50"
              >
                {loading ? 'Processing...' : isLogin ? 'Enter the Family' : 'Join the Family'}
              </button>
            </form>
          </div>

          {/* Features */}
          <div className="mt-8 grid grid-cols-2 gap-4 text-center">
            <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm p-4">
              <div className="text-primary text-2xl font-heading font-bold">11</div>
              <div className="text-xs font-heading text-mutedForeground uppercase tracking-widest mt-0.5">Ranks</div>
            </div>
            <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm p-4">
              <div className="text-primary text-2xl font-heading font-bold">∞</div>
              <div className="text-xs font-heading text-mutedForeground uppercase tracking-widest mt-0.5">Opportunities</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
