import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { invalidateApiCache, getApiErrorMessage } from '../../utils/api';
import { useIpBanGate } from '../../hooks/useIpBanGate';
import IpBannedPanel from '../../components/IpBannedPanel';
import styles from '../../styles/noir.module.css';

export default function StaffLogin({ setIsAuthenticated }) {
  const navigate = useNavigate();
  const { ban: ipBan, banned: ipBanned, checking: ipBanChecking } = useIpBanGate();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      invalidateApiCache();
      const response = await api.post(
        '/auth/login-staff',
        { email: formData.email, password: formData.password },
        { timeout: 120000 },
      );
      if (response.data.verify_required) {
        if (response.data.token) {
          localStorage.setItem('token', response.data.token);
          setIsAuthenticated(true);
          if (response.data.user && response.data.user.rules_accepted === false) {
            navigate('/account/rules-acceptance', { replace: true });
            return;
          }
        }
        toast.success(response.data.message || 'Check your email to verify your account.');
        return;
      }
      localStorage.setItem('token', response.data.token);
      setIsAuthenticated(true);
      if (response.data.user && response.data.user.rules_accepted === false) {
        navigate('/account/rules-acceptance', { replace: true });
        return;
      }
      window.dispatchEvent(new CustomEvent('app:admin-changed'));
      toast.success('Welcome back.');
      navigate('/tjjeujr3wa/overview', { replace: true });
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
      }, 0);
    } catch (error) {
      toast.error(getApiErrorMessage(error) || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`min-h-screen flex items-center justify-center px-4 ${styles.page} ${styles.themeGangsterModern}`}
      style={{ background: 'var(--noir-background)', backgroundImage: 'none' }}
    >
      <div className="w-full max-w-sm">
        <div
          className={`${styles.panel} rounded-xl overflow-hidden p-6`}
          style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.18)' }}
        >
          {ipBanned ? (
            <IpBannedPanel ban={ipBan} />
          ) : ipBanChecking ? (
            <p className="text-center text-[10px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
              Checking…
            </p>
          ) : (
          <>
          <p
            className="text-[8px] font-heading uppercase tracking-[0.5em] mb-4 text-center"
            style={{ color: 'var(--noir-primary)', opacity: 0.6 }}
          >
            Staff Access
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="staff-email"
                className="block text-[10px] font-heading font-bold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--noir-primary)' }}
              >
                Email or Username
              </label>
              <input
                id="staff-email"
                type="text"
                autoComplete="username"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={`w-full ${styles.input} h-12 px-4 font-heading`}
                placeholder="Enter your email or username"
                required
              />
            </div>
            <div>
              <label
                htmlFor="staff-password"
                className="block text-[10px] font-heading font-bold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--noir-primary)' }}
              >
                Password
              </label>
              <input
                id="staff-password"
                type="password"
                autoComplete="current-password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className={`w-full ${styles.input} h-12 px-4 font-heading`}
                placeholder="Enter your password"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className={`w-full ${styles.btnPrimary} hover:opacity-90 active:scale-[0.98] rounded-sm font-heading font-bold uppercase tracking-wider py-3.5 transition-all disabled:opacity-50 touch-manipulation`}
            >
              {loading ? 'Processing…' : 'Enter'}
            </button>
          </form>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-4 w-full text-[9px] font-heading uppercase tracking-wider opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--noir-primary)' }}
          >
            ← Back to main page
          </button>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
