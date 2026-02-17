import { useState } from 'react';
import { Skull, KeyRound, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const DA_STYLES = `
  .da-fade-in { animation: da-fade-in 0.4s ease-out both; }
  @keyframes da-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .da-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

export default function DeadAlive() {
  const [deadUsername, setDeadUsername] = useState('');
  const [deadPassword, setDeadPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRetrieve = async (e) => {
    e.preventDefault();
    if (!deadUsername.trim() || !deadPassword) {
      toast.error('Enter your dead account username and password');
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
      toast.error(error.response?.data?.detail || 'Retrieval failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="dead-alive-page">
      <style>{DA_STYLES}</style>
      <div className="relative da-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Recovery</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-2">
          <Skull size={22} className="text-primary/80" />
          Dead → Alive
        </h1>
        <p className="text-[10px] text-zinc-500 font-heading italic max-w-xl">
          Recover a portion of points from a dead account into this account (one-time per dead account).
        </p>
      </div>

      <div className={`relative ${styles.panel} rounded-lg overflow-hidden max-w-md shadow-lg shadow-primary/5 border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-4 py-2.5 bg-amber-500/15 border-b border-amber-500/30 flex items-center gap-2">
          <AlertCircle size={18} className="text-amber-400 shrink-0" />
          <span className="text-[10px] font-heading font-bold text-amber-200/90">You must be logged into your new account. Enter the credentials of the account that died.</span>
        </div>
        <form onSubmit={handleRetrieve} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1">Dead account username</label>
            <input
              type="text"
              value={deadUsername}
              onChange={(e) => setDeadUsername(e.target.value)}
              placeholder="Username of dead account"
              className={`w-full ${styles.input} px-3 py-2 font-heading placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none`}
              data-testid="dead-username"
            />
          </div>
          <div>
            <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1">Dead account password</label>
            <input
              type="password"
              value={deadPassword}
              onChange={(e) => setDeadPassword(e.target.value)}
              placeholder="Password of dead account"
              className={`w-full ${styles.input} px-3 py-2 font-heading placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none`}
              data-testid="dead-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 transition-smooth disabled:opacity-50"
            data-testid="retrieve-submit"
          >
            <KeyRound size={18} />
            {loading ? 'Retrieving...' : 'Retrieve points'}
          </button>
        </form>
        <div className="da-art-line text-primary mx-3" />
      </div>

      <div className={`relative ${styles.panel} rounded-lg overflow-hidden max-w-2xl border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">How it works</h3>
        </div>
        <div className="p-6">
          <ul className="space-y-2 text-sm text-mutedForeground font-heading">
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">◆</span> When you are killed in an attack, that account becomes <strong className="text-foreground">dead</strong> and cannot be used again.</li>
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">◆</span> Create a new account and play as normal.</li>
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">◆</span> Here enter your <strong className="text-foreground">dead account</strong> username and password. We credit this (living) account with a portion of the points that account had when it died.</li>
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">◆</span> Retrieval is <strong className="text-foreground">one-time per dead account</strong>. After that, the dead account cannot be used for retrieval again.</li>
          </ul>
        </div>
        <div className="da-art-line text-primary mx-3" />
      </div>
    </div>
  );
}
