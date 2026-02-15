import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../utils/api';
import styles from '../styles/noir.module.css';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const tokenFromUrl = searchParams.get('token');
    if (tokenFromUrl) {
      setToken(tokenFromUrl);
    }
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!token) {
      toast.error('Invalid reset token');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const response = await api.post('/auth/password-reset/confirm', {
        token,
        new_password: password,
      });
      
      toast.success(response.data.message || 'Password reset successfully!');
      setTimeout(() => navigate('/'), 2000);
    } catch (error) {
      const msg = error.response?.data?.detail || 'Failed to reset password';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
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
              <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary uppercase tracking-[0.2em] md:tracking-[0.25em]">
                MAFIA WARS
              </h1>
              <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-l from-transparent to-primary/70" />
            </div>
            <p className="text-primary/90 text-xs font-heading tracking-[0.35em] uppercase">Reset Password</p>
          </div>

          {/* Reset Form */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-2xl shadow-primary/10`}>
            <div className="px-4 py-3 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider text-center">Create New Password</h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {!token && (
                <div className={`${styles.panel} rounded-sm p-3 bg-red-500/10 border border-red-500/30`}>
                  <p className="text-xs text-red-400 font-heading text-center">
                    ⚠️ No reset token found. Please use the link from your email.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1.5">
                  Reset Token
                </label>
                <input
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className={`w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                  placeholder="Paste your reset token"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1.5">
                  New Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                  placeholder="Enter new password (min 6 chars)"
                  required
                  minLength={6}
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1.5">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                  placeholder="Confirm new password"
                  required
                  minLength={6}
                />
              </div>

              {password && confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-400 font-heading">Passwords do not match</p>
              )}

              <button
                type="submit"
                disabled={loading || !token || password !== confirmPassword}
                className={`w-full ${styles.btnPrimary} hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 transition-smooth disabled:opacity-50`}
              >
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>

              <div className="text-center">
                <Link to="/" className="text-xs text-primary/70 hover:text-primary font-heading uppercase tracking-wider">
                  ← Back to Login
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
