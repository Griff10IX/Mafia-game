import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../utils/api';
import styles from '../styles/noir.module.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resetToken, setResetToken] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await api.post('/auth/password-reset/request', { email });
      setSubmitted(true);
      
      // For development: show the token (remove in production)
      if (response.data.token) {
        setResetToken(response.data.token);
      }
      
      toast.success(response.data.message || 'If an account exists with that email, a reset link has been sent.');
    } catch (error) {
      const msg = error.response?.data?.detail || 'Failed to send reset email';
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
            <p className="text-primary/90 text-xs font-heading tracking-[0.35em] uppercase">Password Reset</p>
          </div>

          {/* Reset Form */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-2xl shadow-primary/10`}>
            <div className="px-4 py-3 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider text-center">Forgot Password</h2>
            </div>

            {!submitted ? (
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <p className="text-xs text-mutedForeground font-heading">
                  Enter your email address and we'll send you instructions to reset your password.
                </p>

                <div>
                  <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1.5">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`w-full ${styles.input} h-12 px-4 font-heading transition-smooth`}
                    placeholder="Enter your email"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full ${styles.btnPrimary} hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 transition-smooth disabled:opacity-50`}
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>

                <div className="text-center">
                  <Link to="/" className="text-xs text-primary/70 hover:text-primary font-heading uppercase tracking-wider">
                    ← Back to Login
                  </Link>
                </div>
              </form>
            ) : (
              <div className="p-6 space-y-4">
                <div className={`${styles.panel} rounded-sm p-4 bg-primary/5 border border-primary/30`}>
                  <p className="text-xs text-foreground font-heading text-center">
                    ✉️ If an account exists with <span className="text-primary font-bold">{email}</span>, you will receive a password reset email shortly.
                  </p>
                </div>

                {/* Development only: Show token */}
                {resetToken && (
                  <div className={`${styles.panel} rounded-sm p-4 bg-amber-500/10 border border-amber-500/30`}>
                    <p className="text-[10px] text-amber-200/80 font-heading uppercase tracking-wider mb-2">
                      ⚠️ Development Mode
                    </p>
                    <p className="text-xs text-mutedForeground font-heading mb-2">
                      Your reset token (remove this in production):
                    </p>
                    <code className="block text-[10px] text-primary bg-zinc-900/50 p-2 rounded break-all">
                      {resetToken}
                    </code>
                    <Link
                      to={`/reset-password?token=${resetToken}`}
                      className="mt-3 block text-center text-xs text-primary hover:text-primary/80 font-heading uppercase tracking-wider"
                    >
                      Click here to reset password →
                    </Link>
                  </div>
                )}

                <div className="text-center pt-2">
                  <Link to="/" className="text-xs text-primary/70 hover:text-primary font-heading uppercase tracking-wider">
                    ← Back to Login
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
