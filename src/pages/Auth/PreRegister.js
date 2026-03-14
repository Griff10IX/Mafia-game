import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../utils/api';
import styles from '../../styles/noir.module.css';

const FEATURES = [
  { icon: '🎰', title: 'Deep Casino System', desc: 'Roulette, Blackjack, Dice, Horse Racing, Slots, Video Poker' },
  { icon: '💰', title: 'Organized Crime', desc: 'Team-based heists with equipment tiers and strategic planning' },
  { icon: '🏎️', title: 'Bootleg Racing', desc: 'Unique 1920s themed racing with upgrades and competitions' },
  { icon: '👨‍👩‍👧‍👦', title: 'Families & Crews', desc: 'Join or create families, rise through the ranks together' },
  { icon: '🥃', title: 'Prohibition Era', desc: 'Authentic 1920s-30s setting with booze runs and speakeasys' },
  { icon: '⚔️', title: 'PvP Combat', desc: 'Attack rivals, defend your turf, hire bodyguards' },
];

export default function PreRegister() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [rewards, setRewards] = useState(null);
  const [launchStatus, setLaunchStatus] = useState({ loginLocked: false, lockUntil: null, lockMessage: null });
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    // Get launch status from the same endpoint as Landing page
    api.get('/auth/launch-status')
      .then((r) => {
        setLaunchStatus({
          loginLocked: !!r.data?.login_locked,
          lockUntil: r.data?.lock_until || null,
          lockMessage: r.data?.lock_message || null,
        });
      })
      .catch(() => {});

    api.get('/auth/preregister/stats')
      .then((r) => {
        setStats(r.data);
        setRewards(r.data?.rewards);
      })
      .catch(() => {});
  }, []);

  const calculateCountdown = useCallback(() => {
    if (!launchStatus.lockUntil) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    const target = new Date(launchStatus.lockUntil).getTime();
    const now = Date.now();
    const diff = Math.max(0, target - now);
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return { days, hours, minutes, seconds };
  }, [launchStatus.lockUntil]);

  useEffect(() => {
    if (!launchStatus.lockUntil) return;
    setCountdown(calculateCountdown());
    const interval = setInterval(() => setCountdown(calculateCountdown()), 1000);
    return () => clearInterval(interval);
  }, [launchStatus.lockUntil, calculateCountdown]);

  const handleCreateAccount = () => {
    // Navigate to dedicated register route that bypasses preregister redirect
    navigate('/register');
  };

  return (
    <div
      className={`relative min-h-screen ${styles.page}`}
      style={{
        backgroundImage: `url(${process.env.PUBLIC_URL || ''}/images/landing-bg.png)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
      }}
    >
      <style>{`
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(201,168,76,0.3); }
          50% { box-shadow: 0 0 40px rgba(201,168,76,0.5); }
        }
        .fade-up { animation: fade-up 0.5s ease both; }
        .fade-up-1 { animation: fade-up 0.5s 0.1s ease both; }
        .fade-up-2 { animation: fade-up 0.5s 0.2s ease both; }
        .fade-up-3 { animation: fade-up 0.5s 0.3s ease both; }
        .pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
      `}</style>

      <div className="absolute inset-0 bg-black/70 pointer-events-none" />

      <div className="relative min-h-screen flex flex-col items-center justify-start px-4 py-8 md:py-12">
        <div className="w-full max-w-4xl">

          {/* Header */}
          <div className="text-center mb-8 fade-up">
            <p className="text-[10px] font-heading uppercase tracking-[0.4em] mb-2" style={{ color: 'var(--noir-primary)', opacity: 0.6 }}>
              Pre-Register Now
            </p>
            <h1 className="text-4xl md:text-5xl font-heading font-black uppercase tracking-wider mb-3" style={{ color: 'var(--noir-foreground)' }}>
              MAFIA WARS
            </h1>
            <p className="text-sm font-heading" style={{ color: 'var(--noir-muted)' }}>
              A text-based organized crime game set in the Prohibition era
            </p>
          </div>

          {/* Countdown */}
          {launchStatus.lockUntil && (
            <div className="mb-8 fade-up-1">
              <p className="text-center text-[10px] font-heading uppercase tracking-wider mb-3" style={{ color: 'var(--noir-primary)' }}>
                Game Launches In
              </p>
              <div className="grid grid-cols-4 gap-2 max-w-md mx-auto">
                {[
                  { value: countdown.days, label: 'Days' },
                  { value: countdown.hours, label: 'Hours' },
                  { value: countdown.minutes, label: 'Mins' },
                  { value: countdown.seconds, label: 'Secs' },
                ].map(({ value, label }) => (
                  <div
                    key={label}
                    className="flex flex-col items-center p-3 rounded"
                    style={{ backgroundColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.1)' }}
                  >
                    <span className="text-2xl md:text-3xl font-heading font-bold tabular-nums" style={{ color: 'var(--noir-primary)' }}>
                      {String(value).padStart(2, '0')}
                    </span>
                    <span className="text-[8px] font-heading uppercase tracking-wider mt-1" style={{ color: 'var(--noir-muted)' }}>
                      {label}
                    </span>
                  </div>
                ))}
              </div>
              {launchStatus.lockMessage && (
                <p className="text-center text-xs font-heading mt-3" style={{ color: 'var(--noir-muted)' }}>
                  {launchStatus.lockMessage}
                </p>
              )}
            </div>
          )}

          {/* Main Card */}
          <div className={`${styles.panel} rounded-xl overflow-hidden fade-up-2`}>
            {/* Rewards Banner */}
            <div className="p-6 text-center" style={{ background: 'linear-gradient(180deg, rgba(var(--noir-primary-rgb,201,168,76),0.15) 0%, transparent 100%)' }}>
              <h2 className="text-lg font-heading font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--noir-primary)' }}>
                Founding Member Rewards
              </h2>
              <p className="text-xs font-heading mb-4" style={{ color: 'var(--noir-muted)' }}>
                Create your account now and receive these exclusive rewards on launch day
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                <div className="p-4 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
                  <div className="text-2xl mb-1">💎</div>
                  <div className="text-xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>
                    {rewards?.bonus_points?.toLocaleString() || '500'} Points
                  </div>
                  <div className="text-[10px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
                    Premium Currency
                  </div>
                </div>
                <div className="p-4 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
                  <div className="text-2xl mb-1">💵</div>
                  <div className="text-xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>
                    ${rewards?.bonus_cash?.toLocaleString() || '5,000'}
                  </div>
                  <div className="text-[10px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
                    Starting Cash Boost
                  </div>
                </div>
                <div className="p-4 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
                  <div className="text-2xl mb-1">🏆</div>
                  <div className="text-xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>
                    {rewards?.badge || 'Founding Member'}
                  </div>
                  <div className="text-[10px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
                    Exclusive Badge
                  </div>
                </div>
              </div>
            </div>

            {/* Create Account CTA */}
            <div className="p-6 border-t text-center" style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.15)' }}>
              <h3 className="text-base font-heading font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--noir-foreground)' }}>
                Secure Your Username
              </h3>
              <p className="text-xs font-heading mb-4" style={{ color: 'var(--noir-muted)' }}>
                Create your account now to lock in your username and claim founding member rewards when we launch
              </p>
              <button
                onClick={handleCreateAccount}
                className={`${styles.btnPrimary} pulse-glow px-8 py-4 font-heading font-bold uppercase tracking-wider text-base`}
              >
                Create Your Account
              </button>
              <p className="text-[10px] font-heading mt-3" style={{ color: 'var(--noir-muted)' }}>
                Login will be available when the game launches
              </p>
            </div>

            {/* Stats */}
            {stats && (
              <div className="grid grid-cols-2 border-t" style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.1)' }}>
                <div className="p-4 text-center border-r" style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.1)' }}>
                  <div className="text-2xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>
                    {stats.registered_accounts?.toLocaleString() || 0}
                  </div>
                  <div className="text-[9px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
                    Accounts Pre-Registered
                  </div>
                </div>
                <div className="p-4 text-center">
                  <div className="text-2xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>
                    {stats.registered_accounts > 0 ? Math.min(100, stats.registered_accounts) : 0}
                  </div>
                  <div className="text-[9px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
                    Founding Members
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Features Grid */}
          <div className="mt-8 fade-up-3">
            <h3 className="text-center text-[10px] font-heading uppercase tracking-wider mb-4" style={{ color: 'var(--noir-primary)' }}>
              Game Features
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className={`${styles.panel} p-4 rounded-lg`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{feature.icon}</span>
                    <div>
                      <h4 className="font-heading font-bold text-sm mb-1" style={{ color: 'var(--noir-foreground)' }}>
                        {feature.title}
                      </h4>
                      <p className="text-[10px] font-heading" style={{ color: 'var(--noir-muted)' }}>
                        {feature.desc}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 text-center">
            <p className="text-[10px] font-heading uppercase tracking-[0.2em]" style={{ color: 'var(--noir-primary)', opacity: 0.4 }}>
              Omertà — Silence is the first rule
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
