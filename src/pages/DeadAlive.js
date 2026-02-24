import { useState } from 'react';
import { KeyRound, AlertCircle, Skull, DollarSign, Info } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const DA_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400;1,600&display=swap');

  .da-root {
    font-family: 'Crimson Text', Georgia, serif;
  }

  /* ── Page fade ── */
  .da-fade-in  { animation: da-fade-in  0.5s ease-out both; }
  .da-fade-in2 { animation: da-fade-in  0.5s 0.15s ease-out both; }
  .da-fade-in3 { animation: da-fade-in  0.5s 0.3s  ease-out both; }
  @keyframes da-fade-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0);    }
  }

  /* ── Ember pulse on skull ── */
  @keyframes da-ember {
    0%,100% { filter: drop-shadow(0 0 4px #dc2626aa); opacity: .85; }
    50%      { filter: drop-shadow(0 0 12px #ef4444cc); opacity: 1;   }
  }
  .da-ember { animation: da-ember 2.8s ease-in-out infinite; }

  /* ── Flicker on badge border ── */
  @keyframes da-flicker {
    0%,100% { opacity: .35; }
    45%     { opacity: .55; }
    50%     { opacity: .2;  }
    55%     { opacity: .55; }
  }
  .da-flicker { animation: da-flicker 4s ease-in-out infinite; }

  /* ── Aged paper texture overlay ── */
  .da-paper {
    background-image:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
    background-repeat: repeat;
  }

  /* ── Decorative corner lines ── */
  .da-corner-tl::before,
  .da-corner-br::after {
    content: '';
    position: absolute;
    width: 20px; height: 20px;
    border-color: #ca8a04;
    border-style: solid;
    opacity: .3;
  }
  .da-corner-tl::before { top: 8px; left: 8px;  border-width: 1px 0 0 1px; }
  .da-corner-br::after  { bottom: 8px; right: 8px; border-width: 0 1px 1px 0; }

  /* ── Input focus glow ── */
  .da-input:focus {
    outline: none;
    border-color: #ca8a04 !important;
    box-shadow: 0 0 0 2px rgba(202,138,4,.12), inset 0 1px 2px rgba(0,0,0,.4);
  }

  /* ── Button shimmer ── */
  .da-btn { position: relative; overflow: hidden; }
  .da-btn::after {
    content: '';
    position: absolute;
    top: 0; left: -100%;
    width: 60%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.06), transparent);
    transition: left 0.5s ease;
  }
  .da-btn:hover::after { left: 140%; }
  .da-btn:active { transform: scale(0.98); }

  /* ── Ornament rule ── */
  .da-rule {
    display: flex; align-items: center; gap: 10px;
    color: #ca8a04;
  }
  .da-rule::before, .da-rule::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, transparent, #ca8a0440, #ca8a0480, #ca8a0440, transparent);
  }

  /* ── Scrollbar ── */
  .da-root ::-webkit-scrollbar       { width: 4px; }
  .da-root ::-webkit-scrollbar-track { background: transparent; }
  .da-root ::-webkit-scrollbar-thumb { background: #ca8a0440; border-radius: 2px; }
`;

export default function DeadAlive() {
  const [deadUsername, setDeadUsername] = useState('');
  const [deadPassword, setDeadPassword] = useState('');
  const [loading, setLoading] = useState(false);

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
    <div className={`da-root space-y-6 ${styles.pageContent}`} data-testid="dead-alive-page">
      <style>{DA_STYLES}</style>

      {/* ── Header ── */}
      <div className="da-fade-in flex items-start gap-4">
        <div className="shrink-0 mt-0.5">
          <Skull size={28} className="text-red-500 da-ember" />
        </div>
        <div>
          <h1 className="text-lg font-bold uppercase tracking-[0.18em] text-yellow-400"
              style={{ fontFamily: 'Cinzel, serif', textShadow: '0 1px 8px rgba(202,138,4,.3)' }}>
            Dead Man's Inheritance
          </h1>
          <p className="text-[11px] text-zinc-400 italic mt-0.5 leading-relaxed max-w-lg" style={{ fontFamily: 'Crimson Text, Georgia, serif' }}>
            Even in death, a made man's debts are honored. Claim what is owed to the family from a fallen account — 95% of their fortune, collected once, taxed five cents on the dollar.
          </p>
        </div>
      </div>

      {/* ── Warning banner ── */}
      <div className="da-fade-in flex items-start gap-3 px-4 py-3 rounded border border-amber-600/30 bg-amber-950/20 max-w-xl">
        <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-amber-200/80 leading-relaxed" style={{ fontFamily: 'Crimson Text, Georgia, serif', fontSize: '12px' }}>
          You must be <strong className="text-amber-200">logged into your new account</strong> before proceeding.
          This transfer is one-time only — once claimed, the dead account is sealed forever.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 max-w-3xl">

        {/* ── Transfer Form ── */}
        <div className={`da-fade-in2 da-paper da-corner-tl da-corner-br relative ${styles.panel} rounded border border-yellow-700/25 shadow-xl shadow-black/40 overflow-hidden`}>
          {/* top accent */}
          <div className="h-px bg-gradient-to-r from-transparent via-yellow-600/60 to-transparent" />

          {/* header */}
          <div className="px-5 py-3 border-b border-yellow-800/20 bg-black/20">
            <div className="da-rule text-[9px] uppercase tracking-[0.2em] text-yellow-600/70"
                 style={{ fontFamily: 'Cinzel, serif' }}>
              <span>Claim the Estate</span>
            </div>
          </div>

          <form onSubmit={handleRetrieve} className="p-5 space-y-4">
            {/* Dead username */}
            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-widest text-yellow-500/70"
                     style={{ fontFamily: 'Cinzel, serif' }}>
                Fallen Account — Username
              </label>
              <input
                type="text"
                value={deadUsername}
                onChange={e => setDeadUsername(e.target.value)}
                placeholder="Who has fallen?"
                autoComplete="off"
                className={`da-input w-full ${styles.input} px-3 py-2.5 text-sm rounded transition-all`}
                style={{ fontFamily: 'Crimson Text, Georgia, serif' }}
                data-testid="dead-username"
              />
            </div>

            {/* Dead password */}
            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-widest text-yellow-500/70"
                     style={{ fontFamily: 'Cinzel, serif' }}>
                Fallen Account — Password
              </label>
              <input
                type="password"
                value={deadPassword}
                onChange={e => setDeadPassword(e.target.value)}
                placeholder="Their final secret"
                autoComplete="new-password"
                className={`da-input w-full ${styles.input} px-3 py-2.5 text-sm rounded transition-all`}
                style={{ fontFamily: 'Crimson Text, Georgia, serif' }}
                data-testid="dead-password"
              />
            </div>

            {/* Tax breakdown */}
            <div className="flex items-center justify-between px-3 py-2 rounded bg-yellow-950/30 border border-yellow-800/20 text-[11px]"
                 style={{ fontFamily: 'Crimson Text, Georgia, serif' }}>
              <span className="text-zinc-400 italic">Family tithe</span>
              <span className="text-zinc-300">5% <span className="text-zinc-500">taken, 95% yours</span></span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="da-btn w-full flex items-center justify-center gap-2.5 py-3 rounded border border-yellow-600/40 bg-yellow-900/20 hover:bg-yellow-900/35 text-yellow-400 font-bold uppercase tracking-[0.15em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-[11px]"
              style={{ fontFamily: 'Cinzel, serif' }}
              data-testid="retrieve-submit"
            >
              <KeyRound size={15} />
              {loading ? 'Counting the coins…' : 'Claim Inheritance'}
            </button>
          </form>

          {/* bottom accent */}
          <div className="h-px bg-gradient-to-r from-transparent via-yellow-600/30 to-transparent" />
        </div>

        {/* ── How it works ── */}
        <div className={`da-fade-in3 da-paper relative ${styles.panel} rounded border border-yellow-700/20 shadow-xl shadow-black/30 overflow-hidden`}>
          <div className="h-px bg-gradient-to-r from-transparent via-yellow-600/40 to-transparent" />

          <div className="px-5 py-3 border-b border-yellow-800/20 bg-black/20">
            <div className="da-rule text-[9px] uppercase tracking-[0.2em] text-yellow-600/70"
                 style={{ fontFamily: 'Cinzel, serif' }}>
              <span>The Old Ways</span>
            </div>
          </div>

          <div className="p-5 space-y-3.5">
            {[
              {
                icon: <Skull size={14} className="text-red-400 shrink-0 mt-0.5" />,
                text: <>When you are <strong className="text-zinc-200">killed in combat</strong>, that account becomes dead — sealed, unable to play again.</>
              },
              {
                icon: <span className="text-yellow-500 shrink-0 mt-0.5 text-sm leading-none">✦</span>,
                text: <>Create a <strong className="text-zinc-200">new account</strong> and return to the streets. The family never truly dies.</>
              },
              {
                icon: <KeyRound size={14} className="text-yellow-500 shrink-0 mt-0.5" />,
                text: <>Enter the dead account's credentials here. Your new account receives <strong className="text-zinc-200">95% of its money & points</strong> — as they stood at time of death.</>
              },
              {
                icon: <DollarSign size={14} className="text-green-400 shrink-0 mt-0.5" />,
                text: <>A <strong className="text-zinc-200">5% tax</strong> is collected by the family — the cost of doing business from the grave.</>
              },
              {
                icon: <Info size={14} className="text-zinc-500 shrink-0 mt-0.5" />,
                text: <>This claim is <strong className="text-zinc-200">one-time only</strong>. Once transferred, the dead account is buried and never touched again.</>
              }
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                {item.icon}
                <p className="text-[12px] text-zinc-400 leading-relaxed italic" style={{ fontFamily: 'Crimson Text, Georgia, serif' }}>
                  {item.text}
                </p>
              </div>
            ))}
          </div>

          <div className="h-px bg-gradient-to-r from-transparent via-yellow-600/20 to-transparent" />
        </div>
      </div>
    </div>
  );
}
