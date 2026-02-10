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
      <div>
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mb-2 flex items-center gap-2">
          <Skull size={36} />
          Dead &gt; Alive
        </h1>
        <p className="text-mutedForeground">Recover a portion of your points from a dead account into this account (one-time per dead account).</p>
      </div>

      <div className="bg-card border border-border rounded-sm p-6 max-w-md">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500 mb-4">
          <AlertCircle size={20} />
          <span className="text-sm font-medium">You must be logged into your new account. Enter the credentials of the account that died.</span>
        </div>
        <form onSubmit={handleRetrieve} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Dead account username</label>
            <input
              type="text"
              value={deadUsername}
              onChange={(e) => setDeadUsername(e.target.value)}
              placeholder="Username of dead account"
              className="w-full bg-background border border-border rounded-sm px-3 py-2 text-foreground placeholder:text-mutedForeground"
              data-testid="dead-username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Dead account password</label>
            <input
              type="password"
              value={deadPassword}
              onChange={(e) => setDeadPassword(e.target.value)}
              placeholder="Password of dead account"
              className="w-full bg-background border border-border rounded-sm px-3 py-2 text-foreground placeholder:text-mutedForeground"
              data-testid="dead-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50"
            data-testid="retrieve-submit"
          >
            <KeyRound size={18} />
            {loading ? 'Retrieving...' : 'Retrieve points'}
          </button>
        </form>
      </div>

      <div className="bg-card border border-border rounded-sm p-6 max-w-2xl">
        <h3 className="text-lg font-heading font-semibold text-primary mb-2">How it works</h3>
        <ul className="space-y-2 text-sm text-mutedForeground">
          <li>• When you are killed in an attack, that account becomes <strong className="text-foreground">dead</strong> and cannot be used again.</li>
          <li>• Create a new account and play as normal.</li>
          <li>• Here you can enter your <strong className="text-foreground">dead account</strong> username and password. We will credit this (living) account with a portion of the points that account had when it died.</li>
          <li>• Retrieval is <strong className="text-foreground">one-time per dead account</strong>. After that, the dead account cannot be used for retrieval again.</li>
        </ul>
      </div>
    </div>
  );
}
