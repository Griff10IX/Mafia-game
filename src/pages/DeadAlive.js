import { useState } from 'react';
import { Skull, KeyRound, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

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
    <div className="space-y-6" data-testid="dead-alive-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
            <Skull size={28} />
            Dead &gt; Alive
          </h1>
          <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest max-w-xl">
          Recover a portion of points from a dead account into this account (one-time per dead account).
        </p>
      </div>

      <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden max-w-md shadow-lg shadow-primary/5">
        <div className="px-4 py-3 bg-amber-500/20 border-b border-amber-500/40 flex items-center gap-2">
          <AlertCircle size={18} className="text-amber-400 shrink-0" />
          <span className="text-sm font-heading font-bold text-amber-200">You must be logged into your new account. Enter the credentials of the account that died.</span>
        </div>
        <form onSubmit={handleRetrieve} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-heading font-bold text-primary/80 uppercase tracking-wider mb-1">Dead account username</label>
            <input
              type="text"
              value={deadUsername}
              onChange={(e) => setDeadUsername(e.target.value)}
              placeholder="Username of dead account"
              className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm px-3 py-2 text-foreground font-heading placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none"
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
              className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm px-3 py-2 text-foreground font-heading placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none"
              data-testid="dead-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth disabled:opacity-50"
            data-testid="retrieve-submit"
          >
            <KeyRound size={18} />
            {loading ? 'Retrieving...' : 'Retrieve points'}
          </button>
        </form>
      </div>

      <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden max-w-2xl">
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">How it works</h3>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-6">
          <ul className="space-y-2 text-sm text-mutedForeground font-heading">
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">◆</span> When you are killed in an attack, that account becomes <strong className="text-foreground">dead</strong> and cannot be used again.</li>
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">◆</span> Create a new account and play as normal.</li>
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">◆</span> Here enter your <strong className="text-foreground">dead account</strong> username and password. We credit this (living) account with a portion of the points that account had when it died.</li>
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">◆</span> Retrieval is <strong className="text-foreground">one-time per dead account</strong>. After that, the dead account cannot be used for retrieval again.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
