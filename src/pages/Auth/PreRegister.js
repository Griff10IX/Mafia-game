import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Link2, KeyRound, DollarSign, UserPlus, Crosshair, Building2, Car, Wine, BarChart3, Copy } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import { useIpBanGate } from '../../hooks/useIpBanGate';
import IpBannedPanel from '../../components/IpBannedPanel';
import styles from '../../styles/noir.module.css';

const FEATURES = [
  { icon: '🎰', title: 'Deep Casino System', desc: 'Roulette, Blackjack, Dice, Horse Racing, Slots, Video Poker' },
  { icon: '💰', title: 'Organized Crime', desc: 'Team-based heists with equipment tiers and strategic planning' },
  { icon: '🏎️', title: 'Bootleg Racing', desc: 'Unique 1920s themed racing with upgrades and competitions' },
  { icon: '🤝', title: 'Families & Crews', desc: 'Join or create families, rise through the ranks together' },
  { icon: '🥃', title: 'Prohibition Era', desc: 'Authentic 1920s-30s setting with booze runs and speakeasys' },
  { icon: '⚔️', title: 'PvP Combat', desc: 'Attack rivals, defend your turf, hire bodyguards' },
];

export default function PreRegister() {
  const navigate = useNavigate();
  const { ban: ipBan, banned: ipBanned, checking: ipBanChecking } = useIpBanGate();
  const [rewards, setRewards] = useState(null);

  // Track landing page views for admin analytics.
  useEffect(() => {
    if (ipBanned || ipBanChecking) return undefined;
    api.post('/auth/track-login-page-view').catch(() => {});
    return undefined;
  }, [ipBanned, ipBanChecking]);

  useEffect(() => {
    api.get('/auth/preregister/rewards')
      .then((r) => setRewards(r.data?.rewards || null))
      .catch(() => {});
  }, []);

  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);

  const handleCreateAccount = () => {
    if (refFromUrl) {
      navigate(`/register?ref=${encodeURIComponent(refFromUrl)}`);
    } else {
      navigate('/register');
    }
  };

  const copyReferralPlaceholder = () => {
    const url = typeof window !== 'undefined' ? `${window.location.origin}/?ref=YourUsername` : 'https://mafiawars.co.uk/?ref=YourUsername';
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => toast.success('Create account to get your personal link'));
    }
  };

  const handleRedeem = async () => {
    const code = (redeemCodeInput || '').trim();
    if (!code) { toast.error('Enter a code'); return; }
    setRedeemLoading(true);
    try {
      const res = await api.post('/account/redeem', { code });
      const granted = res.data?.granted?.length ? res.data.granted.join(', ') : 'Rewards granted';
      toast.success(`Redeemed: ${granted}`);
      setRedeemCodeInput('');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Create an account first to redeem codes');
    } finally {
      setRedeemLoading(false);
    }
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
              Join the family
            </p>
            <h1 className="text-4xl md:text-5xl font-heading font-black uppercase tracking-wider mb-3" style={{ color: 'var(--noir-foreground)' }}>
              MAFIA WARS
            </h1>
            <p className="text-sm font-heading" style={{ color: 'var(--noir-muted)' }}>
              A text-based organized crime game set in the Prohibition era
            </p>
          </div>

          {ipBanned ? (
            <div className="max-w-md mx-auto fade-up-2">
              <IpBannedPanel ban={ipBan} />
            </div>
          ) : ipBanChecking ? (
            <p className="text-center text-[10px] font-heading uppercase tracking-wider fade-up-2" style={{ color: 'var(--noir-muted)' }}>
              Checking…
            </p>
          ) : (
          <>
          {/* Main Card */}
          <div className={`${styles.panel} rounded-xl overflow-hidden fade-up-2`}>
            {/* Rewards Banner */}
            <div className="p-6 text-center" style={{ background: 'linear-gradient(180deg, rgba(var(--noir-primary-rgb,201,168,76),0.15) 0%, transparent 100%)' }}>
              <h2 className="text-lg font-heading font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--noir-primary)' }}>
                Founding Member Rewards
              </h2>
              <p className="text-xs font-heading mb-4" style={{ color: 'var(--noir-muted)' }}>
                Create a free account to start playing. Referral rewards below reflect current server settings.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 max-w-4xl mx-auto">
                <div className="p-4 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
                  <div className="text-2xl mb-1">💎</div>
                  <div className="text-xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>
                    {rewards?.bonus_respect_points?.toLocaleString() || '1,000'} Respect
                  </div>
                  <div className="text-[10px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
                    Respect points
                  </div>
                </div>
                <div className="p-4 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
                  <div className="text-2xl mb-1">💵</div>
                  <div className="text-xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>
                    ${rewards?.bonus_cash?.toLocaleString() || '50,000'}
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
                    Profile badge &amp; bragging rights
                  </div>
                </div>
                <div className="p-4 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
                  <div className="text-2xl mb-1">🤖</div>
                  <div className="text-xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>
                    {rewards?.auto_rank_trial_hours || 24}hr Trial
                  </div>
                  <div className="text-[10px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
                    Auto Rank Access
                  </div>
                </div>
                <div className="p-4 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
                  <div className="text-2xl mb-1">🎲</div>
                  <div className="text-xl font-heading font-bold" style={{ color: 'var(--noir-primary)' }}>
                    {rewards?.founding_random_tokens || 5} Tokens
                  </div>
                  <div className="text-[10px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-muted)' }}>
                    Random Boost Tokens
                  </div>
                </div>
              </div>
              {(rewards?.founding_passive_blurb || rewards?.founding_passive_bonus_pct != null) && (
                <div
                  className="mt-4 max-w-2xl mx-auto text-left p-3 rounded-md border text-[10px] sm:text-[11px] font-heading leading-relaxed"
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.35)',
                    borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.25)',
                    color: 'var(--noir-muted)',
                  }}
                >
                  <p className="text-primary font-bold uppercase tracking-wider text-[9px] mb-1.5">Founding Member — permanent bonus</p>
                  <p>
                    {rewards?.founding_passive_blurb
                      || `+${rewards.founding_passive_bonus_pct}% on crimes, GTA, OC, hitlist NPCs, properties, family rackets, and missions (with your founder badge).`}
                  </p>
                </div>
              )}
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

          {/* Referral & Redeem — same layout as Referral page */}
          <div className="mt-8 space-y-2 sm:space-y-4 fade-up-3">
            <div className={`${styles.panel} rounded-lg overflow-hidden`}>
              <div className="px-2.5 sm:px-3 py-2 border-b" style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.15)' }}>
                <h2 className="text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--noir-primary)' }}>
                  <Link2 size={14} /> Your referral link
                </h2>
              </div>
              <div className="p-2.5 sm:p-3 space-y-2">
                <p className="text-[9px] sm:text-[10px] font-heading" style={{ color: 'var(--noir-muted)' }}>
                  When someone signs up with this link, they&apos;re linked as referred by you. You earn rewards when they play (game-paid, not taken from them).
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={typeof window !== 'undefined' ? `${window.location.origin}/?ref=YourUsername` : 'https://mafiawars.co.uk/?ref=YourUsername'}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded bg-zinc-900/50 border border-zinc-700/50 text-foreground text-[11px] sm:text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={copyReferralPlaceholder}
                    className="px-3 py-2 rounded-md font-heading font-bold text-[10px] sm:text-xs flex items-center gap-1.5"
                    style={{ backgroundColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.2)', color: 'var(--noir-primary)' }}
                  >
                    <Copy size={12} /> Copy link
                  </button>
                </div>
                <p className="text-[9px] font-heading" style={{ color: 'var(--noir-muted)' }}>Create an account to get your personal referral link.</p>
              </div>
            </div>

            <div className={`${styles.panel} rounded-lg overflow-hidden`}>
              <div className="px-2.5 sm:px-3 py-2 border-b" style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.15)' }}>
                <h2 className="text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--noir-primary)' }}>
                  <KeyRound size={14} /> Redeem a code
                </h2>
              </div>
              <div className="p-2.5 sm:p-3 space-y-2">
                <p className="text-[9px] sm:text-[10px] font-heading" style={{ color: 'var(--noir-muted)' }}>
                  Enter a reward code to claim cash, points, cars, tokens, or loot pieces. Each code can only be used once per account.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={redeemCodeInput}
                    onChange={(e) => setRedeemCodeInput(e.target.value)}
                    placeholder="Enter code"
                    className="flex-1 min-w-0 px-2.5 py-2 rounded bg-zinc-900/50 border border-zinc-700/50 text-foreground text-[11px] sm:text-sm font-mono placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={handleRedeem}
                    disabled={redeemLoading}
                    className="px-3 py-2 rounded-md font-heading font-bold text-[10px] sm:text-xs flex items-center gap-1.5 disabled:opacity-50"
                    style={{ backgroundColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.2)', color: 'var(--noir-primary)' }}
                  >
                    {redeemLoading ? '...' : 'Redeem'}
                  </button>
                </div>
              </div>
            </div>

            <div className={`${styles.panel} rounded-lg overflow-hidden`}>
              <div className="px-2.5 sm:px-3 py-2 border-b" style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.15)' }}>
                <h2 className="text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--noir-primary)' }}>
                  <DollarSign size={14} /> When someone uses your link you earn
                </h2>
              </div>
              <div className="p-2.5 sm:p-3">
                <ul className="text-[9px] sm:text-[10px] font-heading space-y-1 list-disc list-inside" style={{ color: 'var(--noir-muted)' }}>
                  <li>10% of their bullets from melting cars</li>
                  <li>10% of their crime profit (cash)</li>
                  <li>10% of their OC heist profit (cash)</li>
                  <li>10% of their garage scrap profit (cash)</li>
                  <li>10% of their booze profit (cash)</li>
                </ul>
              </div>
            </div>

            <div className={`${styles.panel} rounded-lg overflow-hidden`}>
              <div className="px-2.5 sm:px-3 py-2 border-b" style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.15)' }}>
                <h2 className="text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--noir-primary)' }}>
                  <UserPlus size={14} /> What referred users get
                </h2>
              </div>
              <div className="p-2.5 sm:p-3">
                <p className="text-[9px] sm:text-[10px] font-heading" style={{ color: 'var(--noir-muted)' }}>
                  People who sign up with your link get: free premium rank bar, 500 respect, 18 tokens (non-tradeable), 10% higher crime payouts, and a 10% GTA rare car boost.
                </p>
              </div>
            </div>

            <div className={`${styles.panel} rounded-lg overflow-hidden`}>
              <div className="px-2.5 sm:px-3 py-2 border-b" style={{ borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.15)' }}>
                <h2 className="text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--noir-primary)' }}>
                  <BarChart3 size={14} /> Your earnings
                </h2>
              </div>
              <div className="p-2.5 sm:p-3 space-y-3">
                <p className="text-[9px] sm:text-[10px] font-heading" style={{ color: 'var(--noir-muted)' }}>Example lifetime totals from referred users</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { label: 'Melt bullets', value: '4', valueColor: 'text-amber-400', Icon: Crosshair },
                    { label: 'Crime profit', value: '$6,516', valueColor: 'text-emerald-400', Icon: DollarSign },
                    { label: 'OC profit', value: '$26,424', valueColor: 'text-emerald-400', Icon: Building2 },
                    { label: 'Garage scrap', value: '$4,232', valueColor: 'text-emerald-400', Icon: Car },
                    { label: 'Booze profit', value: '$22,609', valueColor: 'text-emerald-400', Icon: Wine },
                  ].map(({ label, value, valueColor, Icon }) => (
                    <div key={label} className="p-2 sm:p-3 rounded border text-center" style={{ backgroundColor: 'rgba(0,0,0,0.2)', borderColor: 'rgba(var(--noir-primary-rgb,201,168,76),0.15)' }}>
                      <div className={`text-base sm:text-lg font-heading font-bold ${valueColor}`}>{value}</div>
                      <div className="text-[9px] sm:text-[10px] font-heading uppercase tracking-wider flex items-center justify-center gap-1 mt-0.5" style={{ color: 'var(--noir-muted)' }}>
                        <Icon size={10} /> {label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </>
          )}

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
