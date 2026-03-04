import { Link } from 'react-router-dom';
import styles from '../styles/noir.module.css';

export default function VerifyComplete() {
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
            Email verified
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--noir-muted)' }}>
            You&apos;ve verified your email. Your account is ready — you can log in anytime with your email or username.
          </p>
          <Link
            to="/dashboard"
            className={`${styles.btnPrimary} inline-block px-6 py-3 rounded-sm font-heading font-bold uppercase tracking-wider`}
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
