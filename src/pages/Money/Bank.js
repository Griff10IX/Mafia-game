import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Landmark, ShieldCheck, ArrowRightLeft, Clock, Coins, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import { copyTextToClipboard } from '../../utils/copyToClipboard';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import styles from '../../styles/noir.module.css';
import { formatGameDateTimeShort as formatDateTime } from '../../utils/gameDateTime';

const BANK_CACHE_KEY = 'mafia_bank_v1';

const BANK_STYLES = `
  @keyframes bank-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .bank-fade-in { animation: bank-fade-in 0.4s ease-out both; }
  @keyframes bank-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .bank-scale-in { animation: bank-scale-in 0.35s ease-out both; }
  @keyframes bank-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .bank-glow { animation: bank-glow 4s ease-in-out infinite; }
  .bank-card { transition: all 0.3s ease; }
  .bank-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .bank-row { transition: all 0.2s ease; }
  .bank-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .bank-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

// Utility functions
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

const InterestBankCard = ({
  overview,
  meta,
  depositAmount,
  onDepositAmountChange,
  durationHours,
  onDurationChange,
  preview,
  onDeposit,
  hideHeader = false
}) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 bank-card bank-fade-in ${!hideHeader ? 'mobile-panel' : ''}`}>
    {!hideHeader && (
      <>
        <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none bank-glow" />
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Landmark size={14} className="text-primary" />
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">
              Interest Bank
            </span>
          </div>
          <span className="text-[9px] text-mutedForeground">
            Cash: <span className="font-bold text-foreground">{formatMoney(overview?.cash_on_hand)}</span>
          </span>
        </div>
      </>
    )}
    <div className="p-2 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[9px] font-heading text-mutedForeground mb-0.5 uppercase tracking-wider">
            Amount
          </label>
          <FormattedNumberInput
            value={depositAmount}
            onChange={onDepositAmountChange}
            placeholder="e.g. 250,000"
            className="w-full bg-input border border-border rounded h-8 px-2 text-[11px] text-foreground focus:border-primary/50 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[9px] font-heading text-mutedForeground mb-0.5 uppercase tracking-wider">
            Duration
          </label>
          <select
            value={String(durationHours)}
            onChange={(e) => onDurationChange(parseInt(e.target.value, 10))}
            className="w-full bg-input border border-border rounded h-8 px-2 text-[11px] text-foreground focus:border-primary/50 focus:outline-none"
          >
            {(Array.isArray(meta?.interest_options) ? meta.interest_options : []).map((o) => (
              <option key={o.hours} value={String(o.hours)}>
                {o.hours}h ({Math.round(Number(o.rate) * 10000) / 100}%)
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-secondary border border-primary/20 rounded p-2">
        <div className="flex items-center gap-1 text-[9px] font-heading text-primary mb-1.5">
          <Clock size={12} />
          Preview
        </div>
        <div className="space-y-1 text-[10px] font-heading">
          <div className="flex justify-between">
            <span className="text-mutedForeground">Interest rate</span>
            <span className="font-bold text-foreground">{(preview.rate * 100).toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mutedForeground">Estimated interest</span>
            <span className="font-bold text-foreground">{formatMoney(preview.interest)}</span>
          </div>
          <div className="flex justify-between pt-1.5 border-t border-border">
            <span className="text-mutedForeground">Total at maturity</span>
            <span className="font-bold text-primary text-[11px]">{formatMoney(preview.total)}</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onDeposit}
        className="w-full bg-primary/20 text-primary rounded font-heading font-bold uppercase tracking-wide py-2 text-[10px] border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation"
      >
        💰 Deposit
      </button>
    </div>
    <div className="bank-art-line text-primary mx-2" />
  </div>
);

const SwissBankCard = ({
  overview,
  swissAmount,
  onSwissAmountChange,
  onDeposit,
  onWithdraw,
  hideHeader = false
}) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 bank-card bank-fade-in ${!hideHeader ? 'mobile-panel' : ''}`} style={{ animationDelay: '0.05s' }}>
    {!hideHeader && (
      <>
        <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none bank-glow" />
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <ShieldCheck size={14} className="text-primary" />
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">
              Swiss Bank
            </span>
          </div>
          <span className="text-[9px] text-mutedForeground">
            Limit: <span className="font-bold text-foreground">{formatMoney(overview?.swiss_limit)}</span>
          </span>
        </div>
      </>
    )}
    <div className="p-2 space-y-2">
      <div className="bg-secondary border border-primary/20 rounded p-2">
        <div className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-0.5">
          Swiss Balance
        </div>
        <div className="text-[13px] font-heading font-bold text-primary">
          {formatMoney(overview?.swiss_balance)}
        </div>
      </div>

      <div>
        <label className="block text-[9px] font-heading text-mutedForeground mb-0.5 uppercase tracking-wider">
          Amount
        </label>
        <FormattedNumberInput
          value={swissAmount}
          onChange={onSwissAmountChange}
          placeholder="e.g. 100,000"
          className="w-full bg-input border border-border rounded h-8 px-2 text-[11px] text-foreground focus:border-primary/50 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={onDeposit}
          className="bg-primary/20 text-primary rounded font-heading font-bold uppercase tracking-wide py-1.5 text-[10px] border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation"
        >
          Deposit
        </button>
        <button
          type="button"
          onClick={onWithdraw}
          className="bg-secondary text-foreground border border-border hover:border-primary/30 rounded font-heading font-bold uppercase tracking-wide py-1.5 text-[10px] transition-all touch-manipulation"
        >
          Withdraw
        </button>
      </div>
    </div>
    <div className="bank-art-line text-primary mx-2" />
  </div>
);

const DepositCard = ({ deposit, onClaim, delay = 0 }) => {
  const left = timeLeft(deposit.matures_at);
  const matured = !!deposit.matured;
  const claimed = !!deposit.claimed_at;
  const canClaim = matured && !claimed;

  return (
    <div className={`${styles.panel} border border-primary/20 rounded-md p-2 bank-row bank-fade-in`} style={{ animationDelay: `${delay}s` }}>
      <div className="space-y-1.5 md:space-y-0 md:flex md:items-center md:justify-between md:gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-mutedForeground">Principal</span>
            <span className="text-[11px] font-heading font-bold text-foreground">
              {formatMoney(deposit.principal)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-mutedForeground">
              {(Number(deposit.interest_rate || 0) * 100).toFixed(2)}% rate
            </span>
            <span className="text-[9px] text-mutedForeground">
              {formatDateTime(deposit.matures_at)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between md:flex-col md:items-end gap-1.5">
          <div className="text-[10px] font-heading">
            {claimed ? (
              <span className="text-mutedForeground">Claimed</span>
            ) : matured ? (
              <span className="text-primary font-bold">✓ Matured</span>
            ) : (
              <span className="text-mutedForeground">{left || '—'}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onClaim(deposit.id)}
            disabled={!canClaim}
            className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation font-heading"
          >
            Claim
          </button>
        </div>
      </div>
    </div>
  );
};

const SendMoneyCard = ({
  transferTo,
  onTransferToChange,
  transferAmount,
  onTransferAmountChange,
  transferNum,
  cashOnHand = 0,
  onSend,
  sending = false,
  hideHeader = false
}) => {
  const cash = Math.trunc(Number(cashOnHand ?? 0));
  const insufficient = transferNum > 0 && transferNum > cash;
  return (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 bank-card bank-fade-in ${!hideHeader ? 'mobile-panel' : ''}`}>
    {!hideHeader && (
      <>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
          <div className="flex items-center gap-1">
            <ArrowRightLeft size={14} className="text-primary" />
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">
              Send Money
            </span>
          </div>
        </div>
      </>
    )}
    <div className="p-2 space-y-2">
      <div>
        <label className="block text-[9px] font-heading text-mutedForeground mb-0.5 uppercase tracking-wider">
          To Username
        </label>
        <input
          value={transferTo}
          onChange={(e) => onTransferToChange(e.target.value)}
          placeholder="username..."
          className="w-full bg-input border border-border rounded h-8 px-2 text-[11px] text-foreground focus:border-primary/50 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-[9px] font-heading text-mutedForeground mb-0.5 uppercase tracking-wider">
          Amount
        </label>
        <FormattedNumberInput
          value={transferAmount}
          onChange={onTransferAmountChange}
          placeholder="e.g. 50,000"
          className="w-full bg-input border border-border rounded h-8 px-2 text-[11px] text-foreground focus:border-primary/50 focus:outline-none"
        />
        <div className="mt-1 text-[9px] text-mutedForeground">
          Available: <span className="font-bold text-foreground">{formatMoney(cash)}</span>
          {' · '}
          You will send: <span className="font-bold text-foreground">{formatMoney(transferNum)}</span>
        </div>
        {insufficient && (
          <p className="text-[9px] text-amber-500 font-heading">Not enough cash on hand for this amount.</p>
        )}
      </div>
      <button
        type="button"
        onClick={onSend}
        disabled={sending || insufficient}
        className="w-full bg-primary/20 text-primary rounded font-heading font-bold uppercase tracking-wide py-2 text-[10px] border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? 'Sending...' : '📤 Send'}
      </button>
    </div>
    <div className="bank-art-line text-primary mx-2" />
  </div>
  );
};

const TransferCard = ({ transfer, delay = 0 }) => {
  const isCar = !!transfer.car_name;
  const isQt = transfer.transfer_kind === 'quicktrade';
  const line1 = transfer.direction === 'sent' ? '📤 Sent' : '📥 Received';
  const line2 = isCar
    ? (transfer.direction === 'sent'
      ? (transfer.to_username === 'Dealer' ? `Car: ${transfer.car_name}` : `To: ${transfer.to_username} · ${transfer.car_name}`)
      : `From: ${transfer.from_username} · Sold: ${transfer.car_name}`)
    : isQt
      ? (transfer.direction === 'sent'
        ? `Quick Trade · To: ${transfer.to_username}`
        : `Quick Trade · From: ${transfer.from_username}`)
      : (transfer.direction === 'sent' ? `To: ${transfer.to_username}` : `From: ${transfer.from_username}`);
  const amountStr = formatMoney(transfer.amount);
  const when = formatDateTime(transfer.created_at);
  const copySummary = isCar
    ? (transfer.direction === 'sent'
      ? `Sent ${amountStr} (car: ${transfer.car_name}) to ${transfer.to_username} · ${when}`
      : `Received ${amountStr} for car ${transfer.car_name} from ${transfer.from_username} · ${when}`)
    : isQt
      ? (transfer.direction === 'sent'
        ? `Quick Trade: sent ${amountStr} to ${transfer.to_username} · ${when}`
        : `Quick Trade: received ${amountStr} from ${transfer.from_username} · ${when}`)
      : (transfer.direction === 'sent'
        ? `Sent ${amountStr} to ${transfer.to_username} · ${when}`
        : `Received ${amountStr} from ${transfer.from_username} · ${when}`);

  const onCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyTextToClipboard(copySummary);
    if (ok) toast.success('Copied to clipboard');
    else toast.error('Could not copy');
  };

  return (
  <div className={`${styles.panel} border border-primary/20 rounded-md p-2 bank-row bank-fade-in`} style={{ animationDelay: `${delay}s` }}>
    <div className="flex items-center justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className={`text-[10px] font-heading font-bold mb-0.5 ${
          transfer.direction === 'sent' ? 'text-red-400' : 'text-emerald-400'
        }`}>
          {line1}
        </div>
        <div className="text-[9px] text-mutedForeground truncate">
          {line2}
        </div>
      </div>
      <div className="flex items-start gap-1 shrink-0">
        <button
          type="button"
          onClick={onCopy}
          className="p-1 rounded-md border border-transparent text-mutedForeground hover:text-primary hover:bg-primary/15 hover:border-primary/25 transition-colors touch-manipulation"
          title="Copy amount, user & date"
          aria-label="Copy transfer details"
        >
          <Copy size={14} />
        </button>
        <div className="text-right min-w-0">
          <div className="text-[11px] font-heading font-bold text-foreground">
            {amountStr}
          </div>
          <div className="text-[9px] text-mutedForeground whitespace-nowrap">
            {when}
          </div>
        </div>
      </div>
    </div>
  </div>
  );
};

// Main component
export default function Bank() {
  const bankBoot = readSessionJson(BANK_CACHE_KEY);
  const [meta, setMeta] = useState(() => bankBoot?.meta ?? { interest_options: [] });
  const [overview, setOverview] = useState(() => bankBoot?.overview ?? null);

  const [depositAmount, setDepositAmount] = useState('');
  const [durationHours, setDurationHours] = useState(24);

  const [swissAmount, setSwissAmount] = useState('');
  const location = useLocation();
  const [transferTo, setTransferTo] = useState(location.state?.transferTo ?? '');
  const sendMoneyRef = useRef(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [sending, setSending] = useState(false);

  const COLLAPSED_KEY = 'mafia_bank_collapsed';
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (_) {}
    return {};
  });
  const toggleSection = (id) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };
  const isCollapsed = (id) => !!collapsedSections[id];

  const fetchAll = useCallback(async (silent = false) => {
    try {
      const [m, o] = await Promise.all([api.get('/bank/meta'), api.get('/bank/overview')]);
      const nextMeta = m.data ?? { interest_options: [] };
      const nextOverview = o.data ?? null;
      setMeta(nextMeta);
      setOverview(nextOverview);
      writeSessionJson(BANK_CACHE_KEY, { meta: nextMeta, overview: nextOverview });
    } catch (e) {
      if (!silent) {
        toast.error('Failed to load bank');
        setMeta({ interest_options: [] });
        setOverview(null);
      }
    }
  }, []);

  useEffect(() => {
    const c = readSessionJson(BANK_CACHE_KEY);
    fetchAll(!!c?.overview);
  }, [fetchAll]);

  useEffect(() => {
    const id = setInterval(() => fetchAll(true), 60_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  useEffect(() => {
    const to = location.state?.transferTo;
    if (to && typeof to === 'string') {
      setTransferTo(to);
      setCollapsedSections((prev) => ({ ...prev, sendMoney: false }));
      setTimeout(() => {
        sendMoneyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }
  }, [location.state?.transferTo]);

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
    if (sending) return;
    const to = (transferTo || '').trim();
    if (!to) return toast.error('Enter a username');
    if (!transferNum || transferNum <= 0) return toast.error('Enter an amount');
    const cash = Math.trunc(Number(overview?.cash_on_hand ?? 0));
    if (transferNum > cash) {
      return toast.error(`Not enough cash (you have ${formatMoney(cash)}, tried to send ${formatMoney(transferNum)}).`);
    }
    setSending(true);
    try {
      const res = await api.post('/bank/transfer', { to_username: to, amount: transferNum });
      toast.success(res.data?.message || 'Sent');
      setTransferTo('');
      setTransferAmount('');
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const deposits = Array.isArray(overview?.deposits) ? overview.deposits.filter((d) => !d.claimed_at) : [];
  const transfers = Array.isArray(overview?.transfers) ? overview.transfers : [];

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="bank-page">
      <style>{BANK_STYLES}</style>

      <p className="text-[9px] text-zinc-500 font-heading italic">Interest deposits, Swiss account, and transfers.</p>
      <AutoRefreshNote seconds={60} />

      <div className="space-y-2">
        <div className="relative rounded-md overflow-hidden border border-primary/20 bank-fade-in mobile-panel">
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <button
            type="button"
            onClick={() => toggleSection('interestBank')}
            className="w-full px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1 text-left hover:bg-primary/12 transition-colors"
          >
            <div className="flex items-center gap-1 min-w-0">
              <span className="shrink-0 text-primary/80">{isCollapsed('interestBank') ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
              <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Interest Bank</span>
            </div>
            <span className="text-[9px] text-mutedForeground shrink-0">Cash: <span className="font-bold text-foreground">{formatMoney(overview?.cash_on_hand)}</span></span>
          </button>
          {!isCollapsed('interestBank') && (
            <div>
              <InterestBankCard
                overview={overview}
                meta={meta}
                depositAmount={depositAmount}
                onDepositAmountChange={setDepositAmount}
                durationHours={durationHours}
                onDurationChange={setDurationHours}
                preview={preview}
                onDeposit={doDeposit}
                hideHeader
              />
            </div>
          )}
        </div>

        <div className="relative rounded-md overflow-hidden border border-primary/20 bank-fade-in mobile-panel" style={{ animationDelay: '0.05s' }}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <button
            type="button"
            onClick={() => toggleSection('swissBank')}
            className="w-full px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1 text-left hover:bg-primary/12 transition-colors"
          >
            <div className="flex items-center gap-1 min-w-0">
              <span className="shrink-0 text-primary/80">{isCollapsed('swissBank') ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
              <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Swiss Bank</span>
            </div>
            <span className="text-[9px] text-mutedForeground shrink-0">Limit: <span className="font-bold text-foreground">{formatMoney(overview?.swiss_limit)}</span></span>
          </button>
          {!isCollapsed('swissBank') && (
            <div>
              <SwissBankCard
                overview={overview}
                swissAmount={swissAmount}
                onSwissAmountChange={setSwissAmount}
                onDeposit={swissDeposit}
                onWithdraw={swissWithdraw}
                hideHeader
              />
            </div>
          )}
        </div>
      </div>

      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 bank-fade-in mobile-panel`} style={{ animationDelay: '0.1s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <button
          type="button"
          onClick={() => toggleSection('interestDeposits')}
          className="w-full px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center gap-1 text-left hover:bg-primary/12 transition-colors"
        >
          <span className="shrink-0 text-primary/80">{isCollapsed('interestDeposits') ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
          <div className="flex items-center gap-1 flex-1">
            <Coins size={14} className="text-primary" />
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Interest Deposits</span>
          </div>
          <span className="text-[9px] text-mutedForeground">{deposits.length} total</span>
        </button>
        {!isCollapsed('interestDeposits') && (
          <>
            {deposits.length === 0 ? (
              <div className="p-4 text-[10px] text-mutedForeground font-heading text-center">
                No deposits yet.
              </div>
            ) : (
              <div className="p-2 space-y-1.5">
                {deposits.map((d, i) => (
                  <DepositCard key={d.id} deposit={d} onClaim={claimDeposit} delay={i * 0.03} />
                ))}
              </div>
            )}
            <div className="bank-art-line text-primary mx-2" />
          </>
        )}
      </div>

      <div className="space-y-2">
        <div className={`relative ${styles.panel} border border-primary/20 rounded-md overflow-hidden bank-fade-in mobile-panel`} style={{ animationDelay: '0.1s' }}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <button
            type="button"
            ref={sendMoneyRef}
            onClick={() => toggleSection('sendMoney')}
            className="w-full px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center gap-1 text-left hover:bg-primary/12 transition-colors"
          >
            <span className="shrink-0 text-primary/80">{isCollapsed('sendMoney') ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Send Money</span>
          </button>
          {!isCollapsed('sendMoney') && (
            <div>
              <SendMoneyCard
                transferTo={transferTo}
                onTransferToChange={setTransferTo}
                transferAmount={transferAmount}
                onTransferAmountChange={setTransferAmount}
                transferNum={transferNum}
                cashOnHand={overview?.cash_on_hand}
                onSend={sendMoney}
                sending={sending}
                hideHeader
              />
            </div>
          )}
        </div>

        <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 bank-fade-in mobile-panel`} style={{ animationDelay: '0.15s' }}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <button
            type="button"
            onClick={() => toggleSection('transfers')}
            className="w-full px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center gap-1 text-left hover:bg-primary/12 transition-colors"
          >
            <span className="shrink-0 text-primary/80">{isCollapsed('transfers') ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider flex-1">Sent / Received</span>
            <span className="text-[9px] text-mutedForeground">{transfers.length} recent</span>
          </button>
          {!isCollapsed('transfers') && (
            <>
              {transfers.length === 0 ? (
                <div className="p-4 text-[10px] text-mutedForeground font-heading text-center">
                  No transfers yet.
                </div>
              ) : (
                <div className="p-2 space-y-1.5">
                  {transfers.map((t, i) => (
                    <TransferCard key={t.id} transfer={t} delay={i * 0.03} />
                  ))}
                </div>
              )}
              <div className="bank-art-line text-primary mx-2" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
