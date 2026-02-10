import { useEffect, useMemo, useState } from 'react';
import { Landmark, ShieldCheck, ArrowRightLeft, Clock, Coins } from 'lucide-react';
import { toast } from 'sonner';
import api, { refreshUser } from '../utils/api';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatNumber(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '0';
  return Math.trunc(num).toLocaleString();
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function timeLeft(iso) {
  if (!iso) return null;
  const until = new Date(iso);
  const now = new Date();
  const ms = until - now;
  if (!(ms > 0)) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function Bank() {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ interest_options: [] });
  const [overview, setOverview] = useState(null);

  const [depositAmount, setDepositAmount] = useState('');
  const [durationHours, setDurationHours] = useState(24);

  const [swissAmount, setSwissAmount] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [m, o] = await Promise.all([api.get('/bank/meta'), api.get('/bank/overview')]);
      setMeta(m.data || { interest_options: [] });
      setOverview(o.data);
    } catch (e) {
      toast.error('Failed to load bank');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const option = useMemo(() => {
    const opts = Array.isArray(meta?.interest_options) ? meta.interest_options : [];
    return opts.find((x) => Number(x?.hours) === Number(durationHours)) || null;
  }, [meta, durationHours]);

  const amountNum = useMemo(() => {
    const n = parseInt(String(depositAmount || '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }, [depositAmount]);

  const preview = useMemo(() => {
    const rate = Number(option?.rate ?? 0);
    const interest = Math.round(amountNum * rate);
    return { rate, interest, total: amountNum + interest };
  }, [amountNum, option]);

  const doDeposit = async () => {
    const amount = amountNum;
    if (!amount || amount <= 0) return toast.error('Enter an amount');
    try {
      const res = await api.post('/bank/interest/deposit', { amount, duration_hours: durationHours });
      toast.success(res.data?.message || 'Deposit created');
      setDepositAmount('');
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to deposit');
    }
  };

  const claimDeposit = async (depositId) => {
    try {
      const res = await api.post('/bank/interest/claim', { deposit_id: depositId });
      toast.success(res.data?.message || 'Claimed');
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim');
    }
  };

  const swissNum = useMemo(() => {
    const n = parseInt(String(swissAmount || '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }, [swissAmount]);

  const swissDeposit = async () => {
    if (!swissNum || swissNum <= 0) return toast.error('Enter an amount');
    try {
      const res = await api.post('/bank/swiss/deposit', { amount: swissNum });
      toast.success(res.data?.message || 'Deposited');
      setSwissAmount('');
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const swissWithdraw = async () => {
    if (!swissNum || swissNum <= 0) return toast.error('Enter an amount');
    try {
      const res = await api.post('/bank/swiss/withdraw', { amount: swissNum });
      toast.success(res.data?.message || 'Withdrew');
      setSwissAmount('');
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const transferNum = useMemo(() => {
    const n = parseInt(String(transferAmount || '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }, [transferAmount]);

  const sendMoney = async () => {
    const to = (transferTo || '').trim();
    if (!to) return toast.error('Enter a username');
    if (!transferNum || transferNum <= 0) return toast.error('Enter an amount');
    try {
      const res = await api.post('/bank/transfer', { to_username: to, amount: transferNum });
      toast.success(res.data?.message || 'Sent');
      setTransferTo('');
      setTransferAmount('');
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to send');
    }
  };

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="bank-loading">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  const deposits = Array.isArray(overview?.deposits) ? overview.deposits : [];
  const transfers = Array.isArray(overview?.transfers) ? overview.transfers : [];

  return (
    <div className="space-y-6" data-testid="bank-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">Bank</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Interest · Swiss · Send money</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Interest Bank */}
        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5">
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Landmark size={18} className="text-primary" />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Interest Bank</span>
            </div>
            <span className="text-xs font-heading text-primary/90">Cash: <span className="font-bold text-foreground">{formatMoney(overview?.cash_on_hand)}</span></span>
          </div>

          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-6">
                <label className="block text-xs font-heading text-mutedForeground mb-1 uppercase tracking-wider">Amount</label>
                <input
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="e.g. 250000"
                  className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-6">
                <label className="block text-xs font-heading text-mutedForeground mb-1 uppercase tracking-wider">Duration</label>
                <select
                  value={String(durationHours)}
                  onChange={(e) => setDurationHours(parseInt(e.target.value, 10))}
                  className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none"
                >
                  {(Array.isArray(meta?.interest_options) ? meta.interest_options : []).map((o) => (
                    <option key={o.hours} value={String(o.hours)}>
                      {o.hours} hours ({Math.round(Number(o.rate) * 10000) / 100}%)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border border-primary/20 rounded-sm p-3 bg-zinc-800/50">
              <div className="text-xs font-heading text-primary/80 flex items-center gap-2">
                <Clock size={14} className="text-primary" />
                Preview
              </div>
              <div className="mt-2 grid grid-cols-12 gap-2 text-xs font-heading">
                <div className="col-span-6 text-mutedForeground">Interest rate</div>
                <div className="col-span-6 text-right font-bold text-foreground">{(preview.rate * 100).toFixed(2)}%</div>
                <div className="col-span-6 text-mutedForeground">Estimated interest</div>
                <div className="col-span-6 text-right font-bold text-foreground">{formatMoney(preview.interest)}</div>
                <div className="col-span-6 text-mutedForeground">Total at maturity</div>
                <div className="col-span-6 text-right font-bold text-primary">{formatMoney(preview.total)}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={doDeposit}
              className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth"
            >
              Deposit
            </button>
          </div>
        </div>

        {/* Swiss Bank */}
        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5">
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-primary" />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Swiss Bank</span>
            </div>
            <span className="text-xs font-heading text-primary/90">Limit: <span className="font-bold text-foreground">{formatMoney(overview?.swiss_limit)}</span></span>
          </div>

          <div className="p-4 space-y-3">
            <div className="border border-primary/20 rounded-sm p-3 bg-zinc-800/50">
              <div className="text-xs font-heading text-mutedForeground uppercase tracking-wider">Swiss balance</div>
              <div className="text-lg font-heading font-bold text-primary">{formatMoney(overview?.swiss_balance)}</div>
            </div>

            <div>
              <label className="block text-xs font-heading text-mutedForeground mb-1 uppercase tracking-wider">Amount</label>
              <input
                value={swissAmount}
                onChange={(e) => setSwissAmount(e.target.value)}
                placeholder="e.g. 100000"
                className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={swissDeposit}
                className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-xs border border-yellow-600/50 transition-smooth"
              >
                Deposit
              </button>
              <button
                type="button"
                onClick={swissWithdraw}
                className="bg-zinc-800 border border-primary/30 text-foreground hover:bg-zinc-700 rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-xs transition-smooth"
              >
                Withdraw
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Active Deposits */}
      <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden">
        <div className="px-4 py-2 bg-zinc-800/50 border-b border-primary/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins size={18} className="text-primary" />
            <span className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">Interest Deposits</span>
          </div>
          <span className="text-xs font-heading text-mutedForeground">{deposits.length} total</span>
        </div>

        {deposits.length === 0 ? (
          <div className="p-4 text-sm text-mutedForeground font-heading">No deposits yet.</div>
        ) : (
          <div>
            <div className="grid grid-cols-12 bg-zinc-800/50 text-xs font-heading font-bold text-primary/80 uppercase tracking-wider px-4 py-2 border-b border-primary/20">
              <div className="col-span-3">Principal</div>
              <div className="col-span-2">Rate</div>
              <div className="col-span-3">Matures</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Action</div>
            </div>
            {deposits.map((d) => {
              const left = timeLeft(d.matures_at);
              const matured = !!d.matured;
              const claimed = !!d.claimed_at;
              const canClaim = matured && !claimed;
              return (
                <div key={d.id} className="grid grid-cols-12 px-4 py-2.5 border-b border-primary/10 text-xs items-center font-heading hover:bg-zinc-800/30 transition-smooth">
                  <div className="col-span-3 font-bold text-foreground">{formatMoney(d.principal)}</div>
                  <div className="col-span-2 text-mutedForeground">{(Number(d.interest_rate || 0) * 100).toFixed(2)}%</div>
                  <div className="col-span-3 text-mutedForeground">{formatDateTime(d.matures_at)}</div>
                  <div className="col-span-2">
                    {claimed ? (
                      <span className="text-mutedForeground">Claimed</span>
                    ) : matured ? (
                      <span className="text-primary font-bold">Matured</span>
                    ) : (
                      <span className="text-mutedForeground">{left || '—'}</span>
                    )}
                  </div>
                  <div className="col-span-2 text-right">
                    <button
                      type="button"
                      onClick={() => claimDeposit(d.id)}
                      disabled={!canClaim}
                      className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-[11px] font-heading font-bold uppercase tracking-wider border border-yellow-600/50 transition-smooth disabled:opacity-50"
                    >
                      Claim
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Transfers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5">
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <div className="flex items-center gap-2">
              <ArrowRightLeft size={18} className="text-primary" />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Send Money</span>
            </div>
          </div>

          <div className="p-4 space-y-3">
            <div>
              <label className="block text-xs font-heading text-mutedForeground mb-1 uppercase tracking-wider">To username</label>
              <input
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                placeholder="username..."
                className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-heading text-mutedForeground mb-1 uppercase tracking-wider">Amount</label>
              <input
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                placeholder="e.g. 50000"
                className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-10 px-3 text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none"
              />
              <div className="mt-1 text-xs text-mutedForeground font-heading">
                You will send: <span className="font-bold text-foreground">{formatMoney(transferNum)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={sendMoney}
              className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth"
            >
              Send
            </button>
          </div>
        </div>

        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden">
          <div className="px-4 py-2 bg-zinc-800/50 border-b border-primary/20 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">Sent / Received</span>
            <span className="text-xs font-heading text-mutedForeground">{transfers.length} recent</span>
          </div>

          {transfers.length === 0 ? (
            <div className="p-4 text-sm text-mutedForeground font-heading">No transfers yet.</div>
          ) : (
            <div>
              <div className="grid grid-cols-12 bg-zinc-800/50 text-xs font-heading font-bold text-primary/80 uppercase tracking-wider px-4 py-2 border-b border-primary/20">
                <div className="col-span-4">Type</div>
                <div className="col-span-4">User</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-2 text-right">Time</div>
              </div>
              {transfers.map((t) => (
                <div key={t.id} className="grid grid-cols-12 px-4 py-2.5 border-b border-primary/10 text-xs items-center font-heading hover:bg-zinc-800/30 transition-smooth">
                  <div className="col-span-4">
                    <span className={t.direction === 'sent' ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {t.direction === 'sent' ? 'Sent' : 'Received'}
                    </span>
                  </div>
                  <div className="col-span-4 text-mutedForeground truncate">
                    {t.direction === 'sent' ? t.to_username : t.from_username}
                  </div>
                  <div className="col-span-2 text-right font-bold text-foreground">{formatMoney(t.amount)}</div>
                  <div className="col-span-2 text-right text-mutedForeground">{formatDateTime(t.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

