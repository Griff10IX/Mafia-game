import { useState, useEffect } from 'react';
import { KeyRound, AlertCircle, Skull, DollarSign, Info, Zap } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const REVIVE_COST = 50000;

const DA_STYLES = `
  .da-fade-in  { animation: da-fade-in 0.5s ease-out both; }
  .da-fade-in2 { animation: da-fade-in 0.5s 0.15s ease-out both; }
  .da-fade-in3 { animation: da-fade-in 0.5s 0.3s ease-out both; }
  @keyframes da-fade-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .da-input:focus {
    outline: none;
    border-color: var(--noir-primary) !important;
    box-shadow: 0 0 0 2px rgba(var(--noir-primary-rgb), 0.15);
  }
`;

export default function DeadAlive() {
  const [deadUsername, setDeadUsername] = useState('');
  const [deadPassword, setDeadPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [reviveEligibility, setReviveEligibility] = useState(null);
  const [reviveUsername, setReviveUsername] = useState('');
  const [revivePassword, setRevivePassword] = useState('');
  const [reviveLoading, setReviveLoading] = useState(false);
  const [reviveSuccess, setReviveSuccess] = useState(null);

  useEffect(() => {
    api.get('/dead-alive/revive-eligibility')
      .then((r) => setReviveEligibility(r.data))
      .catch(() => setReviveEligibility({ can_revive: false, reason: 'Could not load.', dead_accounts_same_email: [] }));
  }, []);

  const handleRevive = async (e) => {
    e.preventDefault();
    const toRevive = (reviveUsername || '').trim();
    if (!toRevive) {
      toast.error('Choose or enter the dead account username to revive.');
      return;
    }
    setReviveLoading(true);
    setReviveSuccess(null);
    try {
      const response = await api.post('/dead-alive/revive', {
        dead_username: toRevive,
        dead_password: revivePassword ? revivePassword : undefined
      });
      toast.success(response.data.message);
      setReviveSuccess(response.data.revived_username);
      setReviveUsername('');
      setRevivePassword('');
      setReviveEligibility((prev) => prev ? { ...prev, can_revive: false, revive_used: true, dead_accounts_same_email: [] } : null);
      // Refetch user so Layout sees is_dead and shows the death screen
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Revive failed.');
    } finally {
      setReviveLoading(false);
    }
  };

  const handleRetrieve = async (e) => {
    e.preventDefault();
    if (!deadUsername.trim() || !deadPassword) {
      toast.error('Enter your dead account credentials, consigliere.');
      return;
    }
    setLoading(true);
    try {
      const response = await api.post('/dead-alive/retrieve', {
        dead_username: deadUsername.trim(),
        dead_password: deadPassword
      });
      toast.success(response.data.message);
      setDeadUsername('');
      setDeadPassword('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Transfer failed — the books do not lie.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`space-y-6 max-w-4xl mx-auto ${styles.pageContent}`} data-testid="dead-alive-page">
      <style>{DA_STYLES}</style>

      {/* ── Header ── */}
      <div className="da-fade-in flex items-start gap-4">
        <div className="shrink-0 mt-0.5">
          <Skull size={28} className="text-red-400" style={{ color: 'var(--noir-foreground)' }} />
        </div>
        <div>
          <h1 className="text-lg font-heading font-bold uppercase tracking-[0.12em] text-primary">
            Dead Man&apos;s Inheritance
          </h1>
          <p className="text-[11px] mt-0.5 leading-relaxed max-w-lg font-heading" style={{ color: 'var(--noir-muted)' }}>
            Even in death, a made man&apos;s debts are honored. Claim what is owed to the family from a fallen account — 99.95% of their fortune, collected once; 0.05% goes to the state head.
          </p>
        </div>
      </div>

      {/* ── Warning banner ── */}
      <div className="da-fade-in flex items-start gap-3 px-4 py-3 rounded border border-primary/30 bg-primary/10 max-w-xl">
        <AlertCircle size={15} className="shrink-0 mt-0.5 text-primary" />
        <p className="text-[11px] font-heading leading-relaxed" style={{ color: 'var(--noir-foreground)' }}>
          You must be <strong className="text-primary">logged into your new account</strong> before proceeding.
          This transfer is one-time only — once claimed, the dead account is sealed forever.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 max-w-3xl">

        {/* ── Transfer Form ── */}
        <div className={`da-fade-in2 relative ${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-5 py-3 border-b border-primary/20 bg-primary/8">
            <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
              Claim the Estate
            </h2>
          </div>

          <form onSubmit={handleRetrieve} className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-heading uppercase tracking-widest" style={{ color: 'var(--noir-muted)' }}>
                Fallen Account — Username
              </label>
              <input
                type="text"
                value={deadUsername}
                onChange={e => setDeadUsername(e.target.value)}
                placeholder="Who has fallen?"
                autoComplete="off"
                className={`da-input w-full ${styles.input} px-3 py-2.5 text-sm rounded transition-all`}
                style={{ color: 'var(--noir-foreground)', fontFamily: 'inherit' }}
                data-testid="dead-username"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-heading uppercase tracking-widest" style={{ color: 'var(--noir-muted)' }}>
                Fallen Account — Password
              </label>
              <input
                type="password"
                value={deadPassword}
                onChange={e => setDeadPassword(e.target.value)}
                placeholder="Their final secret"
                autoComplete="new-password"
                className={`da-input w-full ${styles.input} px-3 py-2.5 text-sm rounded transition-all`}
                style={{ color: 'var(--noir-foreground)', fontFamily: 'inherit' }}
                data-testid="dead-password"
              />
            </div>

            <div className="flex items-center justify-between px-3 py-2 rounded bg-primary/10 border border-primary/20 text-[11px] font-heading" style={{ color: 'var(--noir-foreground)' }}>
              <span style={{ color: 'var(--noir-muted)' }}>Family tithe</span>
              <span>0.05% <span style={{ color: 'var(--noir-muted)' }}>to state head, 99.95% yours</span></span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 py-3 rounded border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary font-heading font-bold uppercase tracking-[0.12em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-[11px] active:scale-[0.98]"
              data-testid="retrieve-submit"
            >
              <KeyRound size={15} />
              {loading ? 'Counting the coins…' : 'Claim Inheritance'}
            </button>
          </form>

          <div className="h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        </div>

        {/* ── How it works ── */}
        <div className={`da-fade-in3 relative ${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-5 py-3 border-b border-primary/20 bg-primary/8">
            <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
              The Old Ways
            </h2>
          </div>

          <div className="p-5 space-y-3.5">
            {[
              {
                icon: <Skull size={14} className="text-red-400 shrink-0 mt-0.5" />,
                text: <>When you are <strong style={{ color: 'var(--noir-foreground)' }}>killed in combat</strong>, that account becomes dead — sealed, unable to play again.</>
              },
              {
                icon: <span className="shrink-0 mt-0.5 text-sm leading-none text-primary">✦</span>,
                text: <>Create a <strong style={{ color: 'var(--noir-foreground)' }}>new account</strong> and return to the streets. The family never truly dies.</>
              },
              {
                icon: <KeyRound size={14} className="shrink-0 mt-0.5 text-primary" />,
                text: <>Enter the dead account&apos;s credentials here. Your new account receives <strong style={{ color: 'var(--noir-foreground)' }}>99.95% of its money & points</strong> — as they stood at time of death.</>
              },
              {
                icon: <DollarSign size={14} className="text-emerald-400 shrink-0 mt-0.5" />,
                text: <>A <strong style={{ color: 'var(--noir-foreground)' }}>0.05% tax</strong> goes to the state head family — same as the casino house edge.</>
              },
              {
                icon: <Info size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--noir-muted)' }} />,
                text: <>This claim is <strong style={{ color: 'var(--noir-foreground)' }}>one-time only</strong>. Once transferred, the dead account is buried and never touched again.</>
              }
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                {item.icon}
                <p className="text-[12px] leading-relaxed font-heading" style={{ color: 'var(--noir-muted)' }}>
                  {item.text}
                </p>
              </div>
            ))}
          </div>

          <div className="h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        </div>
      </div>

      {/* ── Revive a fallen account (50k points, same email, once per email) ── */}
      {reviveEligibility != null && (
        <div className="da-fade-in space-y-3 max-w-3xl">
          <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
            <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-5 py-3 border-b border-primary/20 bg-primary/8">
              <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
                Revive a Fallen Account
              </h2>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-[11px] font-heading leading-relaxed" style={{ color: 'var(--noir-muted)' }}>
                Pay {REVIVE_COST.toLocaleString()} points once to bring back one of your dead accounts (same email, or prove ownership with that account&apos;s password if its email was freed).
                This account will become dead; only your money and points (minus the cost) move to the revived account. No mission or rank transfer. One-time per email.
              </p>
              {reviveEligibility.revive_used && (
                <p className="text-[11px] font-heading text-amber-400" style={{ color: 'var(--noir-foreground)' }}>
                  This email has already used its one-time revive.
                </p>
              )}
              {!reviveEligibility.revive_used && !reviveEligibility.can_revive && reviveEligibility.reason && (
                <p className="text-[11px] font-heading" style={{ color: 'var(--noir-muted)' }}>
                  {reviveEligibility.reason}
                </p>
              )}
              {!reviveEligibility.revive_used && reviveEligibility.can_revive && (
                <form onSubmit={handleRevive} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-heading uppercase tracking-widest" style={{ color: 'var(--noir-muted)' }}>
                      Dead account to revive (same email)
                    </label>
                    {reviveEligibility.dead_accounts_same_email?.length > 0 ? (
                      <select
                        value={reviveUsername}
                        onChange={(e) => setReviveUsername(e.target.value)}
                        className={`da-input w-full ${styles.input} px-3 py-2.5 text-sm rounded transition-all`}
                        style={{ color: 'var(--noir-foreground)', fontFamily: 'inherit' }}
                        data-testid="revive-username-select"
                      >
                        <option value="">Select account</option>
                        {reviveEligibility.dead_accounts_same_email.map((a) => (
                          <option key={a.username} value={a.username}>{a.username}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={reviveUsername}
                        onChange={(e) => setReviveUsername(e.target.value)}
                        placeholder="Username of dead account"
                        autoComplete="off"
                        className={`da-input w-full ${styles.input} px-3 py-2.5 text-sm rounded transition-all`}
                        style={{ color: 'var(--noir-foreground)', fontFamily: 'inherit' }}
                        data-testid="revive-username"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-heading uppercase tracking-widest" style={{ color: 'var(--noir-muted)' }}>
                      Dead account password (required if that account&apos;s email was freed, e.g. after Claim the Estate or new registration with same email)
                    </label>
                    <input
                      type="password"
                      value={revivePassword}
                      onChange={(e) => setRevivePassword(e.target.value)}
                      placeholder="Leave blank if same email still linked"
                      autoComplete="new-password"
                      className={`da-input w-full ${styles.input} px-3 py-2.5 text-sm rounded transition-all`}
                      style={{ color: 'var(--noir-foreground)', fontFamily: 'inherit' }}
                      data-testid="revive-password"
                    />
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded bg-primary/10 border border-primary/20 text-[11px] font-heading" style={{ color: 'var(--noir-foreground)' }}>
                    <span style={{ color: 'var(--noir-muted)' }}>Your points</span>
                    <span>{(reviveEligibility.points_balance ?? 0).toLocaleString()} <span style={{ color: 'var(--noir-muted)' }}>(cost {REVIVE_COST.toLocaleString()})</span></span>
                  </div>
                  <button
                    type="submit"
                    disabled={reviveLoading || !reviveUsername.trim()}
                    className="w-full flex items-center justify-center gap-2.5 py-3 rounded border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary font-heading font-bold uppercase tracking-[0.12em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-[11px] active:scale-[0.98]"
                    data-testid="revive-submit"
                  >
                    <Zap size={15} />
                    {reviveLoading ? 'Reviving…' : `Revive (${REVIVE_COST.toLocaleString()} points)`}
                  </button>
                </form>
              )}
              {reviveSuccess && (
                <p className="text-[11px] font-heading text-primary">
                  Log in as <strong>{reviveSuccess}</strong> to continue.
                </p>
              )}
            </div>
            <div className="h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
          </div>
        </div>
      )}
    </div>
  );
}
