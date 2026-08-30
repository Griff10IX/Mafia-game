import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Landmark, ShieldCheck, ArrowRightLeft, Clock, Coins, ChevronDown, ChevronRight, Copy, Lock, Send } from 'lucide-react';
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
  @keyframes bank-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .bank-fade-in { animation: bank-fade-in 0.35s ease-out both; }

  .bk-page { display: flex; flex-direction: column; gap: 10px; }

  .bk-section {
    position: relative;
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.06);
    background:
      linear-gradient(180deg, rgba(28,28,32,0.96) 0%, rgba(12,12,14,0.98) 100%);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.05),
      0 10px 28px rgba(0,0,0,0.38);
  }
  .bk-section::before {
    content: '';
    position: absolute; inset: 0 auto 0 0; width: 3px;
    background: linear-gradient(180deg, rgba(var(--noir-primary-rgb),0.75), rgba(var(--noir-primary-rgb),0.12));
    pointer-events: none;
  }

  .bk-section-head {
    width: 100%;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 12px 10px 14px;
    text-align: left;
    background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent);
    border: 0;
    cursor: pointer;
  }
  .bk-section-head:hover { background: linear-gradient(180deg, rgba(var(--noir-primary-rgb),0.08), transparent); }
  .bk-section-title {
    display: flex; align-items: center; gap: 8px; min-width: 0;
    font-family: inherit;
    font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
    color: rgba(236,236,240,0.92);
  }
  .bk-section-title svg { color: rgb(var(--noir-primary-rgb)); flex-shrink: 0; }
  .bk-section-meta {
    font-size: 10px; color: var(--noir-muted);
    white-space: nowrap;
  }
  .bk-section-meta strong { color: rgba(236,236,240,0.88); font-weight: 700; }
  .bk-chevron { color: rgba(var(--noir-primary-rgb),0.7); flex-shrink: 0; }

  .bk-body { padding: 12px 12px 12px 14px; display: flex; flex-direction: column; gap: 10px; }

  .bk-label {
    display: block;
    font-size: 9px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
    color: rgba(var(--noir-primary-rgb),0.72);
    margin-bottom: 5px;
  }
  .bk-field {
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border-radius: 6px;
    background: rgba(0,0,0,0.42);
    border: 1px solid rgba(255,255,255,0.06);
    box-shadow: inset 0 2px 6px rgba(0,0,0,0.4);
    color: var(--noir-foreground);
    font-size: 12px;
  }
  .bk-field:focus {
    outline: none;
    border-color: rgba(var(--noir-primary-rgb),0.45);
    box-shadow: inset 0 2px 6px rgba(0,0,0,0.4), 0 0 0 1px rgba(var(--noir-primary-rgb),0.18);
  }

  .bk-ledger {
    border-radius: 7px;
    padding: 10px 11px;
    background: rgba(0,0,0,0.28);
    border: 1px solid rgba(255,255,255,0.05);
  }
  .bk-ledger-row {
    display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
    font-size: 11px;
    padding: 3px 0;
  }
  .bk-ledger-row span { color: var(--noir-muted); }
  .bk-ledger-row strong { color: rgba(236,236,240,0.9); font-weight: 700; }
  .bk-ledger-row.bk-total {
    margin-top: 6px; padding-top: 7px;
    border-top: 1px solid rgba(255,255,255,0.06);
  }
  .bk-ledger-row.bk-total strong { color: rgb(var(--noir-primary-rgb)); font-size: 13px; }

  .bk-vault {
    position: relative;
    border-radius: 8px;
    padding: 12px 12px 11px;
    background:
      radial-gradient(ellipse at 20% 0%, rgba(var(--noir-primary-rgb),0.16), transparent 55%),
      rgba(0,0,0,0.35);
    border: 1px solid rgba(255,255,255,0.06);
  }
  .bk-vault-label {
    font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--noir-muted); margin-bottom: 4px;
  }
  .bk-vault-amt {
    font-size: 20px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1;
    color: rgb(var(--noir-primary-rgb));
    text-shadow: 0 0 18px rgba(var(--noir-primary-rgb),0.25);
  }
  .bk-vault-bar {
    margin-top: 10px; height: 4px; border-radius: 99px; overflow: hidden;
    background: rgba(255,255,255,0.06);
  }
  .bk-vault-bar > i {
    display: block; height: 100%; border-radius: inherit;
    background: linear-gradient(90deg, rgba(var(--noir-primary-rgb),0.45), rgb(var(--noir-primary-rgb)));
  }

  .bk-btn {
    width: 100%;
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    height: 38px;
    border: 0; border-radius: 6px;
    font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
    cursor: pointer;
  }
  .bk-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .bk-btn-ghost {
    background: rgba(255,255,255,0.04);
    color: rgba(236,236,240,0.88);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .bk-btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.07); }

  .bk-note { font-size: 10px; color: var(--noir-muted); line-height: 1.4; }
  .bk-empty {
    padding: 22px 12px;
    text-align: center;
    font-size: 12px;
    color: var(--noir-muted);
  }

  .bk-row {
    border-radius: 7px;
    padding: 10px 11px;
    background: rgba(0,0,0,0.22);
    border: 1px solid rgba(255,255,255,0.04);
  }
  .bk-row + .bk-row { margin-top: 7px; }

  @media (prefers-reduced-motion: reduce) {
    .bank-fade-in { animation: none !important; }
  }
`;

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

function BankSection({ id, title, icon, meta, collapsed, onToggle, headerRef, children, delay }) {
  return (
    <section className="bk-section bank-fade-in mobile-panel" style={delay ? { animationDelay: delay } : undefined}>
      <button
        type="button"
        ref={headerRef}
        onClick={() => onToggle(id)}
        className="bk-section-head"
      >
        <span className="bk-section-title">
          <span className="bk-chevron">{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
          {icon}
          {title}
        </span>
        {meta ? <span className="bk-section-meta">{meta}</span> : null}
      </button>
      {!collapsed && children}
    </section>
  );
}

const InterestBankCard = ({
  meta,
  depositAmount,
  onDepositAmountChange,
  durationHours,
  onDurationChange,
  preview,
  onDeposit,
}) => (
  <div className="bk-body">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      <div>
        <label className="bk-label">Amount</label>
        <FormattedNumberInput
          value={depositAmount}
          onChange={onDepositAmountChange}
          placeholder="e.g. 250,000"
          className="bk-field"
        />
      </div>
      <div>
        <label className="bk-label">Duration</label>
        <select
          value={String(durationHours)}
          onChange={(e) => onDurationChange(parseInt(e.target.value, 10))}
          className="bk-field"
        >
          {(Array.isArray(meta?.interest_options) ? meta.interest_options : []).map((o) => (
            <option key={o.hours} value={String(o.hours)}>
              {o.hours}h ({Math.round(Number(o.rate) * 10000) / 100}%)
            </option>
          ))}
        </select>
      </div>
    </div>

    <div className="bk-ledger">
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] mb-1.5" style={{ color: 'rgba(var(--noir-primary-rgb),0.8)' }}>
        <Clock size={12} />
        Preview
      </div>
      <div className="bk-ledger-row">
        <span>Interest rate</span>
        <strong>{(preview.rate * 100).toFixed(2)}%</strong>
      </div>
      <div className="bk-ledger-row">
        <span>Estimated interest</span>
        <strong>{formatMoney(preview.interest)}</strong>
      </div>
      <div className="bk-ledger-row bk-total">
        <span>Total at maturity</span>
        <strong>{formatMoney(preview.total)}</strong>
      </div>
    </div>

    <button type="button" onClick={onDeposit} className={`${styles.btnPrimary} bk-btn`}>
      <Lock size={13} />
      Deposit
    </button>
  </div>
);

const SwissBankCard = ({
  overview,
  swissAmount,
  onSwissAmountChange,
  onDeposit,
  onWithdraw,
}) => {
  const bal = Number(overview?.swiss_balance ?? 0);
  const limit = Number(overview?.swiss_limit ?? 0);
  const pct = limit > 0 ? Math.min(100, (bal / limit) * 100) : 0;
  return (
    <div className="bk-body">
      <div className="bk-vault">
        <div className="bk-vault-label">Swiss balance</div>
        <div className="bk-vault-amt">{formatMoney(overview?.swiss_balance)}</div>
        <div className="bk-vault-bar" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div>
        <label className="bk-label">Amount</label>
        <FormattedNumberInput
          value={swissAmount}
          onChange={onSwissAmountChange}
          placeholder="e.g. 100,000"
          className="bk-field"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onDeposit} className={`${styles.btnPrimary} bk-btn`}>
          Deposit
        </button>
        <button type="button" onClick={onWithdraw} className="bk-btn bk-btn-ghost">
          Withdraw
        </button>
      </div>
    </div>
  );
};

const DepositCard = ({ deposit, onClaim }) => {
  const left = timeLeft(deposit.matures_at);
  const matured = !!deposit.matured;
  const claimed = !!deposit.claimed_at;
  const canClaim = matured && !claimed;

  return (
    <div className="bk-row">
      <div className="space-y-1.5 md:space-y-0 md:flex md:items-center md:justify-between md:gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px]" style={{ color: 'var(--noir-muted)' }}>Principal</span>
            <span className="text-[12px] font-bold">{formatMoney(deposit.principal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px]" style={{ color: 'var(--noir-muted)' }}>
              {(Number(deposit.interest_rate || 0) * 100).toFixed(2)}% rate
            </span>
            <span className="text-[10px]" style={{ color: 'var(--noir-muted)' }}>
              {formatDateTime(deposit.matures_at)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between md:flex-col md:items-end gap-1.5">
          <div className="text-[11px] font-heading">
            {claimed ? (
              <span style={{ color: 'var(--noir-muted)' }}>Claimed</span>
            ) : matured ? (
              <span className="font-bold" style={{ color: 'rgb(var(--noir-primary-rgb))' }}>Matured</span>
            ) : (
              <span style={{ color: 'var(--noir-muted)' }}>{left || '—'}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onClaim(deposit.id)}
            disabled={!canClaim}
            className={`${styles.btnPrimary} bk-btn`}
            style={{ width: 'auto', height: 30, padding: '0 12px', fontSize: 10 }}
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
}) => {
  const cash = Math.trunc(Number(cashOnHand ?? 0));
  const insufficient = transferNum > 0 && transferNum > cash;
  return (
    <div className="bk-body">
      <div>
        <label className="bk-label">To username</label>
        <input
          value={transferTo}
          onChange={(e) => onTransferToChange(e.target.value)}
          placeholder="username..."
          className="bk-field"
        />
      </div>
      <div>
        <label className="bk-label">Amount</label>
        <FormattedNumberInput
          value={transferAmount}
          onChange={onTransferAmountChange}
          placeholder="e.g. 50,000"
          className="bk-field"
        />
        <div className="bk-note mt-1.5">
          Available: <strong style={{ color: 'rgba(236,236,240,0.88)' }}>{formatMoney(cash)}</strong>
          {' · '}
          You will send: <strong style={{ color: 'rgba(236,236,240,0.88)' }}>{formatMoney(transferNum)}</strong>
        </div>
        {insufficient && (
          <p className="text-[10px] text-amber-500 mt-1">Not enough cash on hand for this amount.</p>
        )}
      </div>
      <button
        type="button"
        onClick={onSend}
        disabled={sending || insufficient}
        className={`${styles.btnPrimary} bk-btn`}
      >
        <Send size={13} />
        {sending ? 'Sending...' : 'Send'}
      </button>
    </div>
  );
};

const TransferCard = ({ transfer }) => {
  const isCar = !!transfer.car_name;
  const isQt = transfer.transfer_kind === 'quicktrade';
  const line1 = transfer.direction === 'sent' ? 'Sent' : 'Received';
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
    <div className="bk-row">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className={`text-[11px] font-bold mb-0.5 ${
            transfer.direction === 'sent' ? 'text-red-400' : 'text-emerald-400'
          }`}>
            {line1}
          </div>
          <div className="text-[10px] truncate" style={{ color: 'var(--noir-muted)' }}>
            {line2}
          </div>
        </div>
        <div className="flex items-start gap-1 shrink-0">
          <button
            type="button"
            onClick={onCopy}
            className="p-1 rounded-md text-mutedForeground hover:text-primary transition-colors touch-manipulation"
            title="Copy amount, user & date"
            aria-label="Copy transfer details"
          >
            <Copy size={14} />
          </button>
          <div className="text-right min-w-0">
            <div className="text-[12px] font-bold">
              {amountStr}
            </div>
            <div className="text-[10px] whitespace-nowrap" style={{ color: 'var(--noir-muted)' }}>
              {when}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

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
    <div className={`bk-page ${styles.pageContent} mobile-page-root`} data-testid="bank-page">
      <style>{BANK_STYLES}</style>

      <p className="text-[10px] italic" style={{ color: 'var(--noir-muted)' }}>
        Interest deposits, Swiss account, and transfers.
      </p>
      <AutoRefreshNote seconds={60} />

      <BankSection
        id="interestBank"
        title="Interest Bank"
        icon={<Landmark size={14} />}
        meta={<>Cash: <strong>{formatMoney(overview?.cash_on_hand)}</strong></>}
        collapsed={isCollapsed('interestBank')}
        onToggle={toggleSection}
      >
        <InterestBankCard
          meta={meta}
          depositAmount={depositAmount}
          onDepositAmountChange={setDepositAmount}
          durationHours={durationHours}
          onDurationChange={setDurationHours}
          preview={preview}
          onDeposit={doDeposit}
        />
      </BankSection>

      <BankSection
        id="swissBank"
        title="Swiss Bank"
        icon={<ShieldCheck size={14} />}
        meta={<>Limit: <strong>{formatMoney(overview?.swiss_limit)}</strong></>}
        collapsed={isCollapsed('swissBank')}
        onToggle={toggleSection}
        delay="0.04s"
      >
        <SwissBankCard
          overview={overview}
          swissAmount={swissAmount}
          onSwissAmountChange={setSwissAmount}
          onDeposit={swissDeposit}
          onWithdraw={swissWithdraw}
        />
      </BankSection>

      <BankSection
        id="interestDeposits"
        title="Interest Deposits"
        icon={<Coins size={14} />}
        meta={`${deposits.length} total`}
        collapsed={isCollapsed('interestDeposits')}
        onToggle={toggleSection}
        delay="0.08s"
      >
        {deposits.length === 0 ? (
          <div className="bk-empty">No deposits yet.</div>
        ) : (
          <div className="bk-body" style={{ paddingTop: 4 }}>
            {deposits.map((d) => (
              <DepositCard key={d.id} deposit={d} onClaim={claimDeposit} />
            ))}
          </div>
        )}
      </BankSection>

      <BankSection
        id="sendMoney"
        title="Send Money"
        icon={<ArrowRightLeft size={14} />}
        collapsed={isCollapsed('sendMoney')}
        onToggle={toggleSection}
        headerRef={sendMoneyRef}
        delay="0.1s"
      >
        <SendMoneyCard
          transferTo={transferTo}
          onTransferToChange={setTransferTo}
          transferAmount={transferAmount}
          onTransferAmountChange={setTransferAmount}
          transferNum={transferNum}
          cashOnHand={overview?.cash_on_hand}
          onSend={sendMoney}
          sending={sending}
        />
      </BankSection>

      <BankSection
        id="transfers"
        title="Sent / Received"
        icon={<ArrowRightLeft size={14} />}
        meta={`${transfers.length} recent`}
        collapsed={isCollapsed('transfers')}
        onToggle={toggleSection}
        delay="0.14s"
      >
        {transfers.length === 0 ? (
          <div className="bk-empty">No transfers yet.</div>
        ) : (
          <div className="bk-body" style={{ paddingTop: 4 }}>
            {transfers.map((t) => (
              <TransferCard key={t.id} transfer={t} />
            ))}
          </div>
        )}
      </BankSection>
    </div>
  );
}
