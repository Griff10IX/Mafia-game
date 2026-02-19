import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../utils/api';
import styles from '../styles/noir.module.css';

export default function VerifyEmail({ setIsAuthenticated }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('loading'); // 'loading' | 'success' | 'error'
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('Missing verification link. Check your email or request a new link.');
      return;
    }
    ran.current = true;
    api.post('/auth/verify-email', { token })
      .then((response) => {
        if (response.data.token) {
          localStorage.setItem('token', response.data.token);
          if (setIsAuthenticated) setIsAuthenticated(true);
          setStatus('success');
          setMessage('Email verified! Redirecting...');
          setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
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
  }, [searchParams, navigate, setIsAuthenticated]);

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
