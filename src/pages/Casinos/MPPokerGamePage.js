import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, MessageSquare, CheckCircle2, XCircle, UserMinus } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const TURN_SECONDS = 30;
const START_COUNTDOWN = 5;
const TOURNAMENT_REMINDER_COOLDOWN_MS = 600 * 1000;

function tournamentReminderCooldownRemainingMs(sentAtIso, _rerenderTick = 0) {
  void _rerenderTick;
  if (!sentAtIso) return 0;
  const t = new Date(sentAtIso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, TOURNAMENT_REMINDER_COOLDOWN_MS - (Date.now() - t));
}

/** High-contrast on cream card faces; black suits use cool black + light halo in render */
const SUITS = {
  H: { sym: '♥', color: '#b91c1c' },
  D: { sym: '♦', color: '#b91c1c' },
  C: { sym: '♣', color: '#0f172a' },
  S: { sym: '♠', color: '#0f172a' },
};

const STREET_LABELS = { preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${Math.trunc(num).toLocaleString()}`;
}
function formatMoneyFull(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function isPointsTournamentGame(game) {
  return String(game?.buy_in_currency || 'money').toLowerCase() === 'points';
}

function formatTournamentPrizeLike(n, game) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return isPointsTournamentGame(game) ? '0 pts' : '$0';
  if (isPointsTournamentGame(game)) return `${Math.trunc(num).toLocaleString()} pts`;
  return formatMoneyFull(n);
}

function formatDurationShort(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatLastAction(la) {
  if (!la || !la.action) return null;
  const a = la.action;
  const amt = la.amount ?? 0;
  if (a === 'check') return 'Check';
  if (a === 'fold') return 'Fold';
  if (a === 'call') return amt > 0 ? `Call ${formatMoney(amt)}` : 'Call';
  if (a === 'bet') return `Bet ${formatMoney(amt)}`;
  if (a === 'raise') return `Raise ${formatMoney(amt)}`;
  if (a === 'all_in') return `All-in ${formatMoney(amt)}`;
  return null;
}

/* ─── Win Particles ─── */
function WinParticles({ active }) {
  const [particles] = useState(() =>
    Array.from({ length: 24 }, (_, i) => ({
      id: i, left: 4 + Math.random() * 92,
      delay: Math.random() * 0.8, duration: 1.2 + Math.random() * 0.9,
      rotate: Math.random() * 540 - 270,
      emoji: ['🪙', '✨', '🃏', '💰', '♠'][i % 5], size: 14 + Math.random() * 14,
    }))
  );
  if (!active) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-50" aria-hidden>
      {particles.map((p) => (
        <span key={p.id} className="absolute"
          style={{
            left: `${p.left}%`, top: '-5%', fontSize: p.size,
            animation: `pkr-particle ${p.duration}s ease-in forwards`,
            animationDelay: `${p.delay}s`,
            '--p-rotate': `${p.rotate}deg`,
          }}>
          {p.emoji}
        </span>
      ))}
    </div>
  );
}

/** Monospace ranks read more clearly (e.g. 4 vs A) at small sizes than proportional sans. */
const POKER_RANK_FONT =
  'ui-monospace, SFMono-Regular, "Cascadia Mono", "Segoe UI Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace';

function pokerRankLetterSpacing(value) {
  const v = String(value ?? '');
  if (v === '10') return '-0.03em';
  if (v === 'A') return '0.12em';
  if (/^[2-9]$/.test(v)) return '0.06em';
  return '0.04em';
}

function pokerCardAccessibleTitle(card) {
  if (!card?.value || !card?.suit) return undefined;
  const names = { H: 'Hearts', D: 'Diamonds', C: 'Clubs', S: 'Spades' };
  const rank = card.value === 'A' ? 'Ace' : card.value === 'K' ? 'King' : card.value === 'Q' ? 'Queen' : card.value === 'J' ? 'Jack' : card.value;
  return `${rank} of ${names[card.suit] || card.suit}`;
}

/* ─── Playing Card ─── */
function Card({ card, hidden, index = 0, total = 1, small = false, medium = false, straight = false }) {
  const w = small
    ? 'w-[36px] h-[52px] sm:w-[38px] sm:h-[54px]'
    : medium
    ? 'w-[44px] h-[62px] sm:w-[48px] sm:h-[68px]'
    : 'w-[54px] h-[76px] sm:w-[60px] sm:h-[84px]';
  const fan = straight || total <= 1 ? 0 : (index - (total - 1) / 2) * 3;
  const offsetX = straight || total <= 1 ? 0 : (index - (total - 1) / 2) * 2;
  const style = {
    transform: `rotate(${fan}deg) translateX(${offsetX}px)`,
    animationDelay: `${index * 0.08}s`,
    boxShadow: '0 4px 16px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.12) inset',
    flexShrink: 0,
  };
  const textSz = small ? 'text-[11px] sm:text-[12px]' : medium ? 'text-[12px] sm:text-[13px]' : 'text-[14px] sm:text-[16px]';
  const symSz = small ? 'text-[9px] sm:text-[10px]' : medium ? 'text-[10px] sm:text-[11px]' : 'text-[12px] sm:text-[13px]';
  const iconSz = small ? 'text-[17px] sm:text-[19px]' : medium ? 'text-[22px] sm:text-2xl' : 'text-[28px] sm:text-3xl';

  if (hidden) {
    return (
      <div className={`relative ${w} rounded-[6px] overflow-hidden animate-pkr-deal`} style={style}>
        <div
          className="absolute inset-0 rounded-[6px]"
          style={{
            background: 'linear-gradient(145deg,#1a4a8c 0%,#0c2248 48%,#132f5c 100%)',
            border: '2px solid rgba(234,179,8,0.55)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -2px 8px rgba(0,0,0,0.35)',
          }}
        >
          <div
            className="absolute inset-[3px] rounded-[4px]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(255,255,255,0.07) 4px,rgba(255,255,255,0.07) 8px)',
            }}
          >
            <div
              className="absolute inset-[3px] rounded-[3px] border flex items-center justify-center"
              style={{ borderColor: 'rgba(234,179,8,0.45)', boxShadow: 'inset 0 0 14px rgba(0,0,0,0.4)' }}
            >
              <span
                className={`${small ? 'text-[14px] sm:text-base' : medium ? 'text-lg' : 'text-xl'} font-black`}
                style={{ color: 'rgba(250,204,21,0.75)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))' }}
              >
                ♠
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const s = SUITS[card?.suit] || { sym: '?', color: '#475569' };
  const isRed = card?.suit === 'H' || card?.suit === 'D';
  const inkShadow = isRed
    ? '0 0.5px 0 #fff, 0 1px 2px rgba(255,255,255,0.9)'
    : '0 0 0 0.75px #fff, 0 0.5px 0 #fff, 0 1px 3px rgba(255,255,255,0.95)';
  const faceBorder = isRed ? 'rgba(185,28,28,0.85)' : 'rgba(15,23,42,0.55)';
  const rankStyle = {
    color: s.color,
    textShadow: inkShadow,
    fontFamily: POKER_RANK_FONT,
    letterSpacing: pokerRankLetterSpacing(card?.value),
    fontVariantNumeric: 'lining-nums',
    textRendering: 'geometricPrecision',
    WebkitFontSmoothing: 'subpixel-antialiased',
  };
  return (
    <div
      className={`relative ${w} rounded-[6px] overflow-hidden animate-pkr-deal`}
      style={style}
      title={pokerCardAccessibleTitle(card)}
    >
      <div
        className="absolute inset-0 rounded-[6px]"
        style={{
          background: 'linear-gradient(165deg,#ffffff 0%,#f4f4f7 38%,#e6e8ef 100%)',
          border: `2px solid ${faceBorder}`,
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -3px 10px rgba(15,23,42,0.06), 0 0 0 1px rgba(255,255,255,0.35)',
        }}
      >
        <div className="absolute top-1 left-1 leading-[0.95] text-left font-black tabular-nums antialiased" style={rankStyle}>
          <div className={textSz}>{card?.value}</div>
          <div className={`${symSz} mt-px block`}>{s.sym}</div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
          <span
            className={`${iconSz} font-black leading-none antialiased`}
            style={{
              color: s.color,
              textShadow: inkShadow,
              filter: isRed ? 'none' : 'drop-shadow(0 0 1px rgba(255,255,255,0.9))',
            }}
          >
            {s.sym}
          </span>
        </div>
        <div className="absolute bottom-1 right-1 leading-[0.95] text-left font-black tabular-nums rotate-180 antialiased" style={rankStyle}>
          <div className={textSz}>{card?.value}</div>
          <div className={`${symSz} mt-px block`}>{s.sym}</div>
        </div>
      </div>
    </div>
  );
}

const PKR_GOLD_BAR = {
  height: 4,
  background:
    'linear-gradient(90deg,#3d2a12 0%,#5a3e1b 18%,var(--noir-primary-bright) 50%,#8b6914 82%,#3d2a12 100%)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.12) inset',
};

/** Must match backend/routers/casinos/mp_poker.py MP_POKER_TOURNAMENT_LEVEL_SECONDS */
const MP_POKER_TOURNAMENT_LEVEL_SECONDS = 300;

const PKR_TABLE_HUD_PILL_STYLE = {
  background: 'rgba(0,0,0,0.52)',
  border: '1px solid rgba(212,175,55,0.38)',
  color: 'var(--noir-primary)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  boxShadow: '0 2px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
};

/** Largest pot share(s) — main pot / chop. Side-pot-only winners have a lower payout than this max. */
function mpPokerLargestShareWinners(results) {
  if (!results?.length) return [];
  let maxPay = 0;
  for (const r of results) maxPay = Math.max(maxPay, Number(r.payout) || 0);
  if (maxPay <= 0) return [];
  return results.filter((r) => (Number(r.payout) || 0) === maxPay);
}

/** Shared showdown / winner banner (cash table settled or tournament last_hand_showdown). */
function MpPokerHandOutcomePanel({
  results,
  players,
  pot,
  myUserId,
  subtitle,
  tournamentFooter,
  board = [],
  payoutPoints = false,
}) {
  if (!results?.length) return null;
  const myResult = results.find((r) => r.user_id === myUserId);
  const primary = mpPokerLargestShareWinners(results);
  const primaryIds = new Set(primary.map((r) => r.user_id));
  const didWinMainPot = myUserId && primaryIds.has(myUserId);
  const didWinAnyShare = (Number(myResult?.payout) || 0) > 0;
  const winnerLabel = (() => {
    if (!primary.length) return 'Unknown';
    const names = primary.map((w) => {
      if (w.user_id === myUserId) return 'You';
      if (w.user_id === 'dealer') return 'The Dealer';
      return players.find((p) => p.user_id === w.user_id)?.username ?? 'Unknown';
    });
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  })();
  const winnerHand =
    primary.length > 1 ? null : primary.map((w) => w.hand).find((h) => h && String(h).trim()) || null;
  const maxShare = primary.reduce((m, r) => Math.max(m, Number(r.payout) || 0), 0);
  const potLabel = Number(pot) > 0 ? Number(pot) : maxShare;

  const showdownRows = (() => {
    const byUid = new Map();
    for (const r of results) {
      if (!r?.user_id) continue;
      byUid.set(r.user_id, r);
    }
    const rows = [];
    for (const [uid, r] of byUid) {
      const pl = players.find((p) => p.user_id === uid);
      const payout = Number(r.payout) || 0;
      const hc = pl?.hole_cards || [];
      if (!r.hand && hc.length < 1 && payout <= 0) continue;
      rows.push({ uid, r, pl });
    }
    rows.sort((a, b) => {
      const d = (Number(b.r.payout) || 0) - (Number(a.r.payout) || 0);
      if (d) return d;
      const na = (a.pl?.username || '').toLowerCase();
      const nb = (b.pl?.username || '').toLowerCase();
      return na.localeCompare(nb);
    });
    return rows;
  })();

  return (
    <div className="rounded-xl overflow-hidden border-2 animate-pkr-fade" style={{ borderColor: didWinMainPot || didWinAnyShare ? 'var(--noir-primary-bright)' : '#5a3e1b' }}>
      <div style={PKR_GOLD_BAR} />

      <div
        className="p-3 sm:p-5 text-center space-y-2 sm:space-y-3"
        style={{
          background: didWinMainPot
            ? 'linear-gradient(180deg,rgba(212,175,55,0.12),rgba(0,0,0,0.6))'
            : didWinAnyShare
              ? 'linear-gradient(180deg,rgba(52,211,153,0.08),rgba(0,0,0,0.6))'
              : 'linear-gradient(180deg,rgba(248,113,113,0.06),rgba(0,0,0,0.6))',
        }}
      >
        <p className="text-[9px] font-heading uppercase tracking-[0.3em]" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Showdown
        </p>
        {subtitle && (
          <p className="text-[9px] font-heading text-primary/70 -mt-1">{subtitle}</p>
        )}

        <div>
          <p
            className="text-lg sm:text-2xl font-heading font-black uppercase tracking-wider leading-tight px-1"
            style={
              didWinMainPot
                ? {
                    background: 'linear-gradient(180deg,#ffd700,var(--noir-primary-bright))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }
                : didWinAnyShare
                  ? { color: '#6ee7b7' }
                  : { color: '#f87171' }
            }
          >
            {didWinMainPot ? '🏆 You Win' : didWinAnyShare ? 'You won a share' : `${winnerLabel} Wins`}
          </p>
          {primary.length > 1 ? (
            <div className="mt-1 space-y-0.5">
              {primary.map((w) => {
                if (!w.hand) return null;
                const nm =
                  w.user_id === myUserId
                    ? 'You'
                    : players.find((p) => p.user_id === w.user_id)?.username ?? 'Player';
                return (
                  <p
                    key={w.user_id}
                    className="text-xs sm:text-sm font-heading font-bold leading-snug"
                    style={{ color: didWinMainPot ? 'var(--noir-primary)' : 'rgba(255,255,255,0.5)' }}
                  >
                    <span className="text-white/35 uppercase tracking-wider text-[9px] sm:text-[10px] mr-1">Hand</span>
                    {nm}: {w.hand}
                  </p>
                );
              })}
            </div>
          ) : (
            winnerHand && (
              <p className="text-sm sm:text-base font-heading font-bold mt-1 leading-snug px-1" style={{ color: didWinMainPot ? 'var(--noir-primary)' : 'rgba(255,255,255,0.45)' }}>
                <span className="text-white/35 uppercase tracking-wider text-[10px] sm:text-xs block sm:inline sm:mr-1">Winning hand</span>
                {winnerHand}
              </p>
            )
          )}
          {potLabel > 0 && (
            <p className="text-[10px] font-heading mt-1" style={{ color: 'rgba(110,231,183,0.6)' }}>
              {payoutPoints ? 'Prize' : 'Pot'}:{' '}
              <span className="font-bold text-green-400">
                {payoutPoints
                  ? `${Math.trunc(potLabel).toLocaleString()} pts`
                  : formatMoneyFull(potLabel)}
              </span>
            </p>
          )}
        </div>

        {board.length > 0 && (
          <div className="pt-2 border-t border-white/5">
            <p className="text-[8px] font-heading uppercase tracking-wider text-white/35 mb-1.5">Board</p>
            <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
              {board.map((c, i) => (
                <Card key={i} card={c} hidden={false} index={i} total={board.length} small straight />
              ))}
            </div>
          </div>
        )}

        {showdownRows.length > 0 && (
          <div className="pt-2 border-t border-white/5 space-y-2">
            <p className="text-[7px] sm:text-[8px] font-heading uppercase tracking-wider text-white/35 text-center px-1">
              Everyone at showdown — cards and hand
            </p>
            <div className="flex flex-col gap-2 max-h-[min(48vh,280px)] sm:max-h-[min(52vh,340px)] overflow-y-auto pr-0.5 touch-pan-y">
              {showdownRows.map(({ uid, r, pl }) => {
                const payout = Number(r.payout) || 0;
                const pWon = payout > 0;
                const isPrimary = primaryIds.has(uid);
                const isMe = uid === myUserId;
                const pName = isMe ? 'You' : pl?.is_bot ? 'Dealer' : pl?.username ?? 'Player';
                const hc = pl?.hole_cards || [];
                return (
                  <div
                    key={uid}
                    className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0"
                    style={{
                      background: isPrimary ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isPrimary ? 'rgba(212,175,55,0.28)' : 'rgba(255,255,255,0.06)'}`,
                    }}
                  >
                    <div className="flex gap-1 shrink-0">
                      {hc.length > 0 ? (
                        hc.map((c, i) => <Card key={i} card={c} hidden={false} index={i} total={2} small />)
                      ) : (
                        <span className="text-[8px] font-heading text-white/25 px-1 self-center">—</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-[9px] font-heading font-bold leading-tight" style={{ color: pWon ? 'var(--noir-primary)' : 'rgba(255,255,255,0.48)' }}>
                        {pName}
                        {isPrimary ? ' · pot' : ''}
                        {pWon ? ' ✓' : ' ✗'}
                        {payout > 0 && (
                          <span className="text-[7px] font-semibold ml-1" style={{ color: 'rgba(110,231,183,0.85)' }}>
                            +
                            {payoutPoints
                              ? `${Math.trunc(payout).toLocaleString()} pts`
                              : formatMoneyFull(payout)}
                          </span>
                        )}
                      </p>
                      <p className="text-[8px] font-heading mt-0.5 leading-snug" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        <span className="text-white/30 uppercase tracking-wider text-[7px] mr-1">Hand</span>
                        <span style={{ color: pWon ? 'rgba(212,175,55,0.75)' : 'rgba(255,255,255,0.35)' }}>{r.hand || '—'}</span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div
        className="px-3 sm:px-4 py-3 border-t border-primary/20 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
        style={{ background: 'rgba(0,0,0,0.4)' }}
      >
        {tournamentFooter ? (
          <p className="text-[9px] font-heading text-mutedForeground italic text-center sm:text-left">Next hand is live below — good luck.</p>
        ) : (
          <>
            <p className="text-[9px] font-heading text-mutedForeground italic text-center sm:text-left flex-1 min-w-0">
              {didWinMainPot ? 'The pot is yours, Don.' : didWinAnyShare ? 'Side pot shipped — nice pick-up.' : 'Better luck next hand.'}
            </p>
            <Link
              to="/casino/mp-poker"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-lg border-2 text-[9px] font-heading font-bold uppercase tracking-wider active:scale-[0.97] transition-all w-full sm:w-auto min-h-[44px] sm:min-h-0"
              style={{
                background: 'linear-gradient(180deg,var(--noir-primary),#a08020)',
                borderColor: 'var(--noir-primary-bright)',
                color: '#1a1200',
              }}
            >
              ♠ New Hand
            </Link>
          </>
        )}
      </div>
      <div style={PKR_GOLD_BAR} />
    </div>
  );
}

/** Small floating card on the felt: last tournament hand showdown (~5s). */
function MpPokerTournamentHandToast({ snapshot, myUserId, visible, compact }) {
  if (!visible || !snapshot?.results?.length) return null;
  const results = snapshot.results;
  const players = snapshot.players || [];
  const primary = mpPokerLargestShareWinners(results);
  if (!primary.length) return null;
  const primaryIds = new Set(primary.map((p) => p.user_id));
  const winnerLabel = primary.map((w) => {
    if (w.user_id === myUserId) return 'You';
    return players.find((p) => p.user_id === w.user_id)?.username ?? 'Winner';
  }).join(' & ');
  const maxShare = primary.reduce((m, r) => Math.max(m, Number(r.payout) || 0), 0);
  const pot = Number(snapshot.pot) || maxShare;
  const brd = snapshot.board || [];

  const showdownRows = (() => {
    const byUid = new Map();
    for (const r of results) {
      if (!r?.user_id) continue;
      byUid.set(r.user_id, r);
    }
    const rows = [];
    for (const [uid, r] of byUid) {
      const pl = players.find((p) => p.user_id === uid);
      const payout = Number(r.payout) || 0;
      const hc = pl?.hole_cards || [];
      if (!r.hand && hc.length < 1 && payout <= 0) continue;
      rows.push({ uid, r, pl });
    }
    rows.sort((a, b) => (Number(b.r.payout) || 0) - (Number(a.r.payout) || 0));
    return rows;
  })();

  // Outer shell: flex centering only — do NOT put animate-pkr-fade here; its keyframes set
  // `transform` and would override -translate-x-1/2, breaking horizontal center on mobile.
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-[25] flex justify-center px-2 sm:px-3 ${compact ? 'top-[22%]' : 'top-[30%] sm:top-[34%]'}`}
    >
      <div
        className={`animate-pkr-fade w-full max-w-[min(100%,300px)] rounded-lg border shadow-2xl overflow-hidden ${compact ? 'px-1.5 py-1' : 'px-2 py-2'}`}
        style={{
          borderColor: 'rgba(212,175,55,0.6)',
          background: 'linear-gradient(165deg,rgba(15,23,42,0.92),rgba(0,0,0,0.88))',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: '0 20px 56px rgba(0,0,0,0.8), 0 0 0 1px rgba(212,175,55,0.15), 0 0 32px rgba(212,175,55,0.14)',
          maxHeight: compact ? 'min(38vh, 220px)' : 'min(48vh, 320px)',
        }}
      >
      <p className={`font-heading uppercase tracking-[0.2em] text-center ${compact ? 'text-[9px]' : 'text-[10px]'}`} style={{ color: 'rgba(255,255,255,0.4)' }}>
        Hand #{snapshot.hand_number} · Showdown
      </p>
      <p
        className={`text-center font-heading font-black uppercase tracking-wide mt-0.5 truncate px-0.5 ${compact ? 'text-xs' : 'text-[12px] sm:text-sm'}`}
        style={{ color: 'var(--noir-primary-bright)' }}
      >
        {winnerLabel}
      </p>
      {primary.length > 1 ? (
        <div className={`mt-0.5 space-y-0.5 ${compact ? 'px-0.5' : 'px-1'}`}>
          {primary.map((w) =>
            w.hand ? (
              <p
                key={w.user_id}
                className={`text-center font-heading font-bold leading-snug text-white/70 ${compact ? 'text-[11px]' : 'text-[7px]'}`}
              >
                <span className="text-white/35 uppercase tracking-wider mr-0.5">Hand</span>
                {w.user_id === myUserId ? 'You' : players.find((p) => p.user_id === w.user_id)?.username ?? 'Winner'}: {w.hand}
              </p>
            ) : null
          )}
        </div>
      ) : (
        primary[0]?.hand && (
          <p
            className={`text-center font-heading font-bold mt-0.5 px-1 leading-snug text-white/70 ${compact ? 'text-[11px]' : 'text-[8px]'}`}
          >
            <span className="text-white/35 uppercase tracking-wider mr-0.5">Hand</span>
            {primary[0].hand}
          </p>
        )
      )}
      {brd.length > 0 && (
        <div className="flex justify-center gap-1 sm:gap-1.5 mt-0.5 flex-wrap">
          {brd.map((c, i) => (
            <Card key={`b-${i}`} card={c} hidden={false} index={i} total={brd.length} small straight />
          ))}
        </div>
      )}
      {pot > 0 && (
        <p className={`font-heading text-center mt-0.5 ${compact ? 'text-[6px]' : 'text-[7px]'}`} style={{ color: 'rgba(110,231,183,0.8)' }}>
          Pot <span className="font-bold text-emerald-400">{formatMoneyFull(pot)}</span>
        </p>
      )}
      <p className={`font-heading uppercase tracking-wider text-center text-white/30 ${compact ? 'text-[5px] mt-0.5' : 'text-[6px] mt-1'}`}>Cards and hand</p>
      <div className={`mt-0.5 space-y-1 overflow-y-auto pr-0.5 min-h-0 ${compact ? 'max-h-[120px]' : 'max-h-[200px]'}`}>
        {showdownRows.map(({ uid, r, pl }) => {
          const payout = Number(r.payout) || 0;
          const pWon = payout > 0;
          const isPrimary = primaryIds.has(uid);
          const isMe = uid === myUserId;
          const pName = isMe ? 'You' : pl?.is_bot ? 'Dealer' : pl?.username ?? 'Player';
          const hc = pl?.hole_cards || [];
          return (
            <div
              key={uid}
              className={`rounded-md flex gap-1 items-center ${compact ? 'px-1 py-0.5' : 'px-1.5 py-1'}`}
              style={{
                background: isPrimary ? 'rgba(212,175,55,0.1)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isPrimary ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.06)'}`,
              }}
            >
              <div className="flex gap-0.5 shrink-0">
                {hc.length > 0 ? (
                  hc.map((c, i) => <Card key={i} card={c} hidden={false} index={i} total={2} small />)
                ) : (
                  <span className={`font-heading text-white/25 px-0.5 ${compact ? 'text-[6px]' : 'text-[7px]'}`}>—</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`font-heading font-bold truncate leading-tight ${compact ? 'text-[7px]' : 'text-[8px]'}`} style={{ color: pWon ? 'var(--noir-primary-bright)' : 'rgba(255,255,255,0.5)' }}>
                  {pName}
                  {isPrimary ? ' · pot' : ''}
                  {pWon ? ' ✓' : ' ✗'}
                </p>
                <p className={`font-heading leading-snug text-white/45 ${compact ? 'text-[6px] mt-px' : 'text-[7px] mt-0.5'}`}>
                  <span className={`text-white/30 uppercase mr-0.5 ${compact ? 'text-[5px]' : 'text-[6px]'}`}>Hand</span>
                  {r.hand || '—'}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

/** Readable strip below the header: last tournament hand winner + hand + board (API keeps `last_hand_showdown` after re-deal). */
function MpPokerLastHandWinnerBanner({ snapshot, myUserId, payoutPoints = false }) {
  if (!snapshot?.results?.length) return null;
  const results = snapshot.results;
  const players = snapshot.players || [];
  const primary = mpPokerLargestShareWinners(results);
  if (!primary.length) return null;
  const primaryIds = new Set(primary.map((p) => p.user_id));
  const winnerLabel = primary
    .map((w) => {
      if (w.user_id === myUserId) return 'You';
      if (w.user_id === 'dealer') return 'The Dealer';
      return players.find((p) => p.user_id === w.user_id)?.username ?? 'Winner';
    })
    .join(' & ');
  const maxShare = primary.reduce((m, r) => Math.max(m, Number(r.payout) || 0), 0);
  const pot = Number(snapshot.pot) || maxShare;
  const brd = snapshot.board || [];
  const handLines = primary
    .map((w) => {
      const h = w.hand && String(w.hand).trim();
      if (!h) return null;
      const nm =
        w.user_id === myUserId ? 'You' : w.user_id === 'dealer' ? 'Dealer' : players.find((p) => p.user_id === w.user_id)?.username ?? 'Player';
      return { key: w.user_id, nm, h };
    })
    .filter(Boolean);
  const singleHand = primary.length === 1 ? primary[0]?.hand && String(primary[0].hand).trim() : null;

  return (
    <div
      className="rounded-xl border border-primary/35 px-3 py-2.5 sm:py-2 animate-pkr-fade"
      style={{
        background: 'linear-gradient(180deg,rgba(15,23,42,0.92),rgba(0,0,0,0.72))',
        boxShadow: '0 4px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      <p className="text-[10px] font-heading uppercase tracking-[0.2em] text-white/45">
        Last hand #{snapshot.hand_number}
        {pot > 0 && (
          <>
            {' · '}
            {payoutPoints ? 'Prize' : 'Pot'}{' '}
            <span className="text-emerald-400/90 font-bold">
              {payoutPoints ? `${Math.trunc(pot).toLocaleString()} pts` : formatMoneyFull(pot)}
            </span>
          </>
        )}
      </p>
      <p className="text-sm sm:text-base font-heading font-black uppercase tracking-wide mt-1 leading-tight" style={{ color: 'var(--noir-primary-bright)' }}>
        {winnerLabel} {primary.length > 1 ? 'split the pot' : 'wins'}
      </p>
      {singleHand ? (
        <p className="text-xs sm:text-sm font-heading font-bold mt-1 leading-snug" style={{ color: 'rgba(255,255,255,0.88)' }}>
          <span className="text-white/40 uppercase tracking-wider text-[10px] mr-1">Winning hand</span>
          {singleHand}
        </p>
      ) : (
        handLines.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {handLines.map((row) => (
              <p key={row.key} className="text-xs sm:text-sm font-heading font-bold leading-snug" style={{ color: 'rgba(255,255,255,0.85)' }}>
                <span className="text-white/40 font-semibold">{row.nm}:</span> {row.h}
              </p>
            ))}
          </div>
        )
      )}
      {(brd.length > 0 || primary.some((w) => players.find((p) => p.user_id === w.user_id)?.hole_cards?.length)) && (
        <div className="mt-2 flex flex-wrap items-end justify-center gap-2 sm:gap-3">
          {brd.length > 0 && (
            <div className="flex flex-col items-center gap-1">
              <span className="text-[9px] font-heading uppercase tracking-wider text-white/35">Board</span>
              <div className="flex justify-center gap-1">
                {brd.map((c, i) => (
                  <Card key={`lb-${i}`} card={c} hidden={false} index={i} total={brd.length} small straight />
                ))}
              </div>
            </div>
          )}
          {primary.map((w) => {
            const pl = players.find((p) => p.user_id === w.user_id);
            const hc = pl?.hole_cards || [];
            if (!hc.length) return null;
            const nm =
              w.user_id === myUserId ? 'You' : pl?.is_bot ? 'Dealer' : pl?.username ?? 'Winner';
            return (
              <div key={w.user_id} className="flex flex-col items-center gap-1">
                <span
                  className={`text-[9px] font-heading uppercase tracking-wider max-w-[100px] truncate ${primaryIds.has(w.user_id) ? 'text-primary' : 'text-white/35'}`}
                  title={nm}
                >
                  {nm}
                  {primaryIds.has(w.user_id) ? ' · pot' : ''}
                </span>
                <div className="flex gap-0.5 justify-center">
                  {hc.map((c, i) => (
                    <Card key={`${w.user_id}-${i}`} card={c} hidden={false} index={i} total={hc.length} small straight />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Chip Stack ─── */
function ChipStack({ amount, small = false }) {
  if (!amount || amount <= 0) return null;
  const colors = ['#e53e3e', '#3182ce', '#38a169', 'var(--noir-primary)', '#805ad5'];
  const count = Math.min(5, Math.ceil(Math.log10(amount + 1)));
  return (
    <div className="inline-flex flex-col-reverse items-center" style={{ gap: 1 }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-full border border-black/30"
          style={{
            width: small ? 12 : 16, height: small ? 4 : 5,
            background: colors[i % colors.length],
            boxShadow: '0 2px 3px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(0,0,0,0.25)',
            transform: `translateY(${i * (small ? 1 : 1.5)}px)`,
          }} />
      ))}
      {amount > 0 && (
        <span className="text-[7px] font-heading font-bold text-yellow-300 mt-0.5" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
          {formatMoney(amount)}
        </span>
      )}
    </div>
  );
}

/* ─── Turn Timer Arc ─── */
function TurnTimer({ seconds, isMyTurn, compact = false }) {
  const pct = Math.max(0, seconds / TURN_SECONDS);
  const r = compact ? 13 : 16;
  const c = compact ? 16 : 19;
  const svgSz = compact ? 32 : 38;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const urgent = seconds <= 10;
  const color = urgent ? '#f87171' : isMyTurn ? 'var(--noir-primary)' : 'rgba(255,255,255,0.4)';
  const fs = compact ? 8 : 10;
  return (
    <svg width={svgSz} height={svgSz} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth="2.5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.9s linear, stroke 0.3s' }} />
      <text x={c} y={c} textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize={fs} fontWeight="700" fontFamily="Cinzel, serif"
        transform={`rotate(90,${c},${c})`}>{seconds}</text>
    </svg>
  );
}

/* ─── Start Countdown Ring ─── */
function StartCountdown({ seconds }) {
  const pct = Math.max(0, seconds / START_COUNTDOWN);
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="64" height="64" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(212,175,55,0.1)" strokeWidth="3.5" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--noir-primary)" strokeWidth="3.5"
          strokeDasharray={`${pct * circ} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.9s linear' }} />
        <text x="32" y="32" textAnchor="middle" dominantBaseline="central"
          fill="var(--noir-primary)" fontSize="20" fontWeight="700" fontFamily="Cinzel, serif"
          transform="rotate(90,32,32)">{seconds}</text>
      </svg>
      <p className="text-[9px] font-heading font-bold uppercase tracking-[0.2em] animate-pkr-pulse"
        style={{ background: 'linear-gradient(180deg,#ffd700,var(--noir-primary-bright))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        Game Starting…
      </p>
    </div>
  );
}

/* ─── Player Seat (oval layout) ─── */
function PlayerSeat({ p, isMe, isCurrent, showHole, isDealer, seatPos, totalSeats, compact = false, omitHoleOnFelt = false }) {
  const hole = p.hole_cards || [];
  const folded = p.status === 'folded';
  const allIn = p.status === 'all_in';
  const ready = p.ready;
  const waiting = p.status === 'waiting';
  const stack = p.stack ?? 0;
  const bet = p.current_bet ?? 0;
  const lastActionText = formatLastAction(p.last_action);

  let borderColor = 'rgba(90,62,27,0.6)';
  let glow = 'none';
  if (isCurrent) { borderColor = 'var(--noir-primary-bright)'; glow = '0 0 20px rgba(212,175,55,0.35)'; }
  else if (isMe) { borderColor = 'rgba(212,175,55,0.4)'; }
  else if (folded) { borderColor = 'rgba(255,255,255,0.1)'; }

  let statusBadge = null;
  if (folded) statusBadge = { label: 'Folded', color: '#6b7280' };
  else if (allIn) statusBadge = { label: 'All-In', color: '#f59e0b' };
  else if (isCurrent) statusBadge = { label: 'Turn', color: 'var(--noir-primary)' };
  else if (waiting && ready) statusBadge = { label: '✓ Ready', color: '#34d399' };
  else if (waiting) statusBadge = { label: 'Waiting', color: '#6b7280' };

  const cardMedium = !compact && hole.length > 0;
  return (
    <div className={`flex flex-col items-center ${compact ? 'gap-0.5' : 'gap-1'}`} style={{ opacity: folded ? 0.45 : 1, transition: 'opacity 0.3s' }}>
      {/* Cards above/beside seat */}
      <div className="flex items-center gap-0.5 mb-0.5" style={{ minHeight: compact ? 52 : 68 }}>
        {omitHoleOnFelt && hole.length > 0 ? (
          <div
            className="shrink-0 opacity-0 pointer-events-none"
            style={{ width: compact ? 78 : 102, height: compact ? 52 : 68 }}
            aria-hidden
          />
        ) : hole.length === 0 ? (
          <div className={`rounded-[6px] border border-white/10 ${compact ? 'w-[36px] h-[52px] sm:w-[38px] sm:h-[54px]' : 'w-[44px] h-[62px] sm:w-[48px] sm:h-[68px]'}`} style={{ background: 'rgba(0,0,0,0.28)' }} />
        ) : (
          hole.map((c, i) => (
            <Card key={i} card={c} hidden={!showHole} index={i} total={hole.length} small={compact || !cardMedium} medium={cardMedium} />
          ))
        )}
      </div>

      {/* Seat chip */}
      <div className={`relative rounded-xl border-2 transition-all duration-300 ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'}`}
        style={{
          borderColor,
          boxShadow: glow === 'none' ? '0 4px 14px rgba(0,0,0,0.35)' : `${glow}, 0 4px 14px rgba(0,0,0,0.35)`,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          background: isCurrent
            ? 'linear-gradient(180deg,rgba(212,175,55,0.16),rgba(0,0,0,0.55))'
            : 'linear-gradient(180deg,rgba(0,0,0,0.5),rgba(0,0,0,0.38))',
          minWidth: compact ? 62 : 70, maxWidth: compact ? 78 : 90,
        }}>
        {isDealer && (
          <div className={`absolute rounded-full flex items-center justify-center font-black z-10 ${compact ? '-top-1 -right-1 w-4 h-4 text-[6px]' : '-top-2 -right-2 w-5 h-5 text-[7px]'}`}
            style={{ background: 'var(--noir-primary)', color: '#1a1200', border: '1.5px solid #1a1200' }}>D</div>
        )}
        <div className="text-center">
          <div className={`font-heading font-bold truncate ${compact ? 'text-[8px]' : 'text-[9px]'}`}
            style={{ color: isMe ? 'var(--noir-primary)' : 'rgba(255,255,255,0.85)', maxWidth: compact ? 72 : 80 }}>
            {p.username}{isMe ? ' ★' : ''}
          </div>
          <div className={`font-heading ${compact ? 'text-[7px]' : 'text-[8px]'}`} style={{ color: 'rgba(110,231,183,0.6)' }}>
            {formatMoney(stack)}
          </div>
          {statusBadge && (
            <div className={`font-heading font-bold mt-0.5 ${compact ? 'text-[6px]' : 'text-[7px]'}`} style={{ color: statusBadge.color }}>
              {statusBadge.label}
            </div>
          )}
          {lastActionText && !compact && (
            <div className="text-[7px] font-heading mt-0.5 italic" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {lastActionText}
            </div>
          )}
        </div>
      </div>

      {/* Bet chips */}
      {bet > 0 && (
        <div className="mt-0.5">
          <ChipStack amount={bet} small />
        </div>
      )}
      {isMe && p.current_hand_name && !compact && (
        <div className="text-[8px] font-heading font-bold mt-0.5" style={{ color: 'var(--noir-primary)' }}>
          {p.current_hand_name}
        </div>
      )}
    </div>
  );
}

/* ─── Oval Table positions ─── */
function getTablePositions(totalSeats, compact = false) {
  // Returns array of {x, y} as percentages for seat container positioning
  // Arranged around an oval: x 10-90%, y 5-85%
  if (compact && totalSeats === 4) {
    return [
      { x: 50, y: 88 },
      { x: 12, y: 48 },
      { x: 50, y: 11 },
      { x: 88, y: 48 },
    ];
  }
  const positions = {
    2: [{ x: 50, y: 88 }, { x: 50, y: 7 }],
    3: [{ x: 50, y: 88 }, { x: 9, y: 30 }, { x: 91, y: 30 }],
    4: [{ x: 50, y: 88 }, { x: 6, y: 44 }, { x: 50, y: 7 }, { x: 94, y: 44 }],
    5: [{ x: 50, y: 88 }, { x: 6, y: 60 }, { x: 17, y: 11 }, { x: 83, y: 11 }, { x: 94, y: 60 }],
    6: [{ x: 50, y: 88 }, { x: 6, y: 66 }, { x: 6, y: 19 }, { x: 50, y: 5 }, { x: 94, y: 19 }, { x: 94, y: 66 }],
    7: [{ x: 50, y: 88 }, { x: 9, y: 72 }, { x: 4, y: 34 }, { x: 24, y: 5 }, { x: 76, y: 5 }, { x: 96, y: 34 }, { x: 91, y: 72 }],
    8: [{ x: 50, y: 88 }, { x: 11, y: 74 }, { x: 2, y: 48 }, { x: 11, y: 13 }, { x: 50, y: 4 }, { x: 89, y: 13 }, { x: 98, y: 48 }, { x: 89, y: 74 }],
    9: [{ x: 50, y: 88 }, { x: 13, y: 79 }, { x: 2, y: 52 }, { x: 6, y: 21 }, { x: 29, y: 4 }, { x: 71, y: 4 }, { x: 94, y: 21 }, { x: 98, y: 52 }, { x: 87, y: 79 }],
  };
  return positions[totalSeats] || positions[6];
}

/* ══════════════════════════════════════════════════════════
   Main Game Page
   ══════════════════════════════════════════════════════════ */
export default function MPPokerGamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [readyLoading, setReadyLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [kickLoadingUserId, setKickLoadingUserId] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState('');
  const [startSecondsLeft, setStartSecondsLeft] = useState(null);
  const [turnSecondsLeft, setTurnSecondsLeft] = useState(null);
  const [helpPanelOpen, setHelpPanelOpen] = useState(false);
  const [remindLoading, setRemindLoading] = useState(false);
  const [canStaffTournamentRemind, setCanStaffTournamentRemind] = useState(false);
  const [remindCooldownTick, setRemindCooldownTick] = useState(0);
  const [compactUi, setCompactUi] = useState(false);
  const [tournamentToast, setTournamentToast] = useState({ visible: false, snap: null });
  const toastShownHandsRef = useRef(new Set());
  const startTriggeredRef = useRef(false);
  const timeoutTriggeredRef = useRef(null);
  const chatEndRef = useRef(null);
  const myUserIdRef = useRef(null);

  // Track mode in a ref so fetchGame stays stable
  const isModeVsDealerRef = useRef(false);
  // Also track as state for rendering
  const [isVsDealer, setIsVsDealer] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then((r) => {
      const id = r.data?.id ?? null;
      setMyUserId(id);
      myUserIdRef.current = id;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const apply = () => setCompactUi(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    toastShownHandsRef.current.clear();
    setTournamentToast({ visible: false, snap: null });
  }, [gameId]);

  useEffect(() => {
    const hn = game?.last_hand_showdown?.hand_number;
    if (game?.mode !== 'tournament' || game?.status !== 'playing' || hn == null) return;
    const lh = game.last_hand_showdown;
    if (!lh?.results?.length) return;
    const n = Number(hn);
    if (toastShownHandsRef.current.has(n)) return;
    toastShownHandsRef.current.add(n);
    setTournamentToast({ visible: true, snap: lh });
    const id = setTimeout(() => setTournamentToast((prev) => ({ ...prev, visible: false })), 5000);
    return () => clearTimeout(id);
  }, [game?.mode, game?.status, game?.last_hand_showdown?.hand_number]);

  useEffect(() => {
    if (game?.mode !== 'tournament') {
      setCanStaffTournamentRemind(false);
      return;
    }
    api.get('/admin/whoami')
      .then((r) => {
        const d = r.data;
        setCanStaffTournamentRemind(Boolean(d?.is_admin || d?.is_moderator || d?.has_admin_email));
      })
      .catch(() => setCanStaffTournamentRemind(false));
  }, [game?.mode, gameId]);

  useEffect(() => {
    if (!game?.inactive_reminder_sent_at) return undefined;
    const id = setInterval(() => setRemindCooldownTick((n) => n + 1), 20000);
    return () => clearInterval(id);
  }, [game?.inactive_reminder_sent_at]);

  const fetchGame = useCallback(() => {
    // Always start with the generic games endpoint; if vs-dealer use that endpoint
    const endpoint = isModeVsDealerRef.current
      ? '/casino/mp-poker/vs-dealer/game'
      : `/casino/mp-poker/games/${gameId}`;
    api.get(endpoint)
      .then((r) => {
        const g = isModeVsDealerRef.current
          ? (r.data?.game ?? r.data ?? null)
          : (r.data ?? null);
        // Detect mode from first response — set game immediately so UI shows, then keep ref in sync
        if (g?.mode === 'vs_dealer' && !isModeVsDealerRef.current) {
          isModeVsDealerRef.current = true;
          setIsVsDealer(true);
          setFetchError(false);
          setGame(g);
          setTimeout(() => {
            api.get('/casino/mp-poker/vs-dealer/game').then((r2) => {
              const g2 = r2.data?.game ?? r2.data ?? null;
              if (g2) setGame(g2);
            }).catch(() => {});
          }, 50);
          return;
        }
        setFetchError(false);
        setGame((prev) => {
          // Never replace a completed hand with a non-completed state (avoids poll overwriting results)
          if (prev?.status === 'completed' && g?.status !== 'completed') return prev;
          if (g?.status === 'completed' && prev?.status !== 'completed') {
            const uid = myUserIdRef.current;
            const myResult = (g?.results || []).find((res) => res.user_id === uid);
            if ((Number(myResult?.payout) || 0) > 0) {
              setShowWin(true);
              setTimeout(() => setShowWin(false), 4500);
            }
          }
          return g;
        });
      })
      .catch(() => {
        setGame((prev) => {
          if (prev === null) setFetchError(true);
          return prev;
        });
      })
      .finally(() => setHasLoaded(true));
  }, [gameId]);

  // Keep vs-dealer ref in sync with current game (e.g. from location.state or any fetch)
  useEffect(() => {
    if (game?.mode === 'vs_dealer') {
      isModeVsDealerRef.current = true;
      setIsVsDealer(true);
    }
  }, [game?.mode]);

  // Stable poll — only restart when fetchGame itself changes (i.e. gameId/mode changes)
  // Interval speed is managed via ref to avoid restarting the whole interval
  const pollSpeedRef = useRef(3000);
  useEffect(() => {
    fetchGame();
    const t = setInterval(() => {
      fetchGame();
    }, pollSpeedRef.current);
    return () => clearInterval(t);
  }, [fetchGame]);

  // Update poll speed based on game state without restarting interval
  useEffect(() => {
    if (!game) return;
    const allInActive = game.status === 'playing' && (game.players || []).some((p) => p.status === 'all_in');
    const botTurn = isVsDealer && game.current_turn_index === 1 && game.status === 'playing';
    const myAllIn = (game.players || []).find(p => !p.is_bot)?.status === 'all_in';
    pollSpeedRef.current = myAllIn ? 800 : (allInActive || botTurn) ? 1200 : 3000;
  }, [game, isVsDealer]);

  // Start countdown timer
  useEffect(() => {
    if (!game?.all_ready_at || game?.phase !== 'ready') {
      setStartSecondsLeft(null);
      startTriggeredRef.current = false;
      return;
    }
    const compute = () => Math.max(0, Math.ceil(START_COUNTDOWN - (Date.now() - new Date(game.all_ready_at).getTime()) / 1000));
    setStartSecondsLeft(compute());
    const t = setInterval(() => setStartSecondsLeft(compute()), 500);
    return () => clearInterval(t);
  }, [game?.all_ready_at, game?.phase]);

  // Auto-trigger start
  useEffect(() => {
    if (startSecondsLeft !== 0 || game?.phase !== 'ready' || !game?.all_ready_at) return;
    if (startTriggeredRef.current) return;
    startTriggeredRef.current = true;
    api.post(`/casino/mp-poker/games/${gameId}/start`)
      .then((r) => setGame(r.data ?? null))
      .catch(() => { startTriggeredRef.current = false; });
  }, [startSecondsLeft, game?.phase, game?.all_ready_at, gameId]);

  // Turn timer
  useEffect(() => {
    if (!game?.turn_started_at || game?.status !== 'playing') {
      setTurnSecondsLeft(null); return;
    }
    const compute = () => Math.max(0, Math.ceil(TURN_SECONDS - (Date.now() - new Date(game.turn_started_at).getTime()) / 1000));
    setTurnSecondsLeft(compute());
    const t = setInterval(() => setTurnSecondsLeft(compute()), 1000);
    return () => clearInterval(t);
  }, [game?.turn_started_at, game?.status]);

  // Auto-timeout (do not timeout when player is all-in — they can't act; hand should run out instead)
  useEffect(() => {
    if (turnSecondsLeft !== 0 || game?.status !== 'playing') return;
    const players = game?.players || [];
    const currentP = players[game?.current_turn_index];
    if (currentP?.status === 'all_in') return; // all-in: no timeout, wait for run-out
    const key = `${game?.current_turn_index}-${game?.turn_started_at}`;
    if (timeoutTriggeredRef.current === key) return;
    if (players[game?.current_turn_index]?.user_id !== myUserId) return;
    timeoutTriggeredRef.current = key;
    api.post(`/casino/mp-poker/games/${gameId}/timeout`).then((r) => setGame(r.data ?? null)).catch(() => {});
  }, [turnSecondsLeft, game, myUserId, gameId]);

  // Ready notification
  useEffect(() => {
    if (game?.phase === 'ready' && game?.all_ready_at) {
      toast.success('All players ready — game starting!', { duration: 4000 });
    }
  }, [game?.phase, game?.all_ready_at]);

  const act = async (action, amount) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const endpoint = isModeVsDealerRef.current
        ? '/casino/mp-poker/vs-dealer/act'
        : `/casino/mp-poker/games/${gameId}/act`;
      const body = isModeVsDealerRef.current
        ? { action, amount: amount ?? undefined, game_id: gameId || undefined }
        : { action, amount: amount ?? undefined };
      const res = await api.post(endpoint, body);
      // Vs dealer: use response game immediately so check on river → showdown updates UI without getting stuck
      if (isModeVsDealerRef.current && res?.data?.game) {
        const g = res.data.game;
        setGame((prev) => {
          if (g?.status === 'completed' && prev?.status !== 'completed') {
            const uid = myUserIdRef.current;
            const myResult = (g?.results || []).find((r) => r.user_id === uid);
            if ((Number(myResult?.payout) || 0) > 0) {
              setShowWin(true);
              setTimeout(() => setShowWin(false), 4500);
            }
          }
          return g;
        });
        await refreshUser();
        setActionLoading(false);
        return;
      }
      // Multiplayer: use response game immediately so check on river → showdown updates UI without getting stuck
      if (!isModeVsDealerRef.current && res?.data?.id && Array.isArray(res?.data?.players)) {
        const g = res.data;
        setGame((prev) => {
          if (g?.status === 'completed' && prev?.status !== 'completed') {
            const uid = myUserIdRef.current;
            const myResult = (g?.results || []).find((r) => r.user_id === uid);
            if ((Number(myResult?.payout) || 0) > 0) {
              setShowWin(true);
              setTimeout(() => setShowWin(false), 4500);
            }
          }
          return g;
        });
        await refreshUser();
        setActionLoading(false);
        return;
      }
      // Re-fetch after acting — bot may have responded, street may have advanced
      const waitMs = action === 'all_in' ? 900 : 350;
      await new Promise(r => setTimeout(r, waitMs));
      const fetchEndpoint = isModeVsDealerRef.current
        ? '/casino/mp-poker/vs-dealer/game'
        : `/casino/mp-poker/games/${gameId}`;
      const fresh = await api.get(fetchEndpoint);
      const g = isModeVsDealerRef.current
        ? (fresh.data?.game ?? fresh.data ?? null)
        : (fresh.data ?? null);
      if (g) setGame(g);
      await refreshUser();
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Action failed'); }
    finally { setActionLoading(false); }
  };

  const markReady = async () => {
    if (!gameId) return;
    setReadyLoading(true);
    try {
      const res = await api.post(`/casino/mp-poker/games/${gameId}/ready`);
      setGame(res.data ?? null);
      toast.success("You're ready!");
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Failed'); }
    finally { setReadyLoading(false); }
  };

  const cancelGame = async () => {
    setCancelLoading(true);
    try {
      await api.post(`/casino/mp-poker/games/${gameId}/cancel`);
      await refreshUser();
      toast.success('Game cancelled; everyone refunded');
      navigate('/casino/mp-poker');
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not cancel'); }
    finally { setCancelLoading(false); }
  };

  const leaveGame = async () => {
    if (!gameId || leaveLoading) return;
    setLeaveLoading(true);
    try {
      await api.post(`/casino/mp-poker/games/${gameId}/leave`);
      await refreshUser();
      toast.success('You left the table');
      navigate('/casino/mp-poker');
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not leave'); }
    finally { setLeaveLoading(false); }
  };

  const kickUnreadyPlayer = async (targetUserId) => {
    if (!gameId || !targetUserId || kickLoadingUserId) return;
    setKickLoadingUserId(targetUserId);
    try {
      const res = await api.post(`/casino/mp-poker/games/${gameId}/kick`, { user_id: targetUserId });
      setGame(res.data ?? null);
      await refreshUser();
      toast.success('Player removed; buy-in refunded');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not remove player');
    } finally {
      setKickLoadingUserId(null);
    }
  };

  const remindInactivePlayers = async () => {
    if (remindLoading || !gameId) return;
    setRemindLoading(true);
    try {
      const res = await api.post(`/casino/mp-poker/tournaments/${gameId}/remind-inactive`);
      toast.success(res.data?.message || 'Reminders sent');
      fetchGame();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not send reminders');
    } finally {
      setRemindLoading(false);
    }
  };

  const sendChat = (e) => {
    e?.preventDefault();
    if (!gameId) return;
    const msg = chatInput.trim();
    if (!msg || sendingChat) return;
    setSendingChat(true);
    api.post(`/casino/mp-poker/games/${gameId}/chat`, { message: msg })
      .then((r) => { setGame(r.data ?? null); setChatInput(''); chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); })
      .catch(() => {})
      .finally(() => setSendingChat(false));
  };

  // ── Derived ──
  const players = game?.players || [];
  const board = game?.board || [];
  const pot = game?.pot ?? 0;
  const street = game?.street || '';
  const phase = game?.phase || 'lobby';
  const status = game?.status || 'open';
  const currentTurnIndex = game?.current_turn_index ?? -1;
  const myIndex = players.findIndex((p) => p.user_id === myUserId);
  const myPlayer = players[myIndex];
  const isMyTurn = currentTurnIndex >= 0 && currentTurnIndex < players.length &&
    myPlayer?.status !== 'folded' && myPlayer?.status !== 'all_in' &&
    (isVsDealer
      ? !players[currentTurnIndex]?.is_bot
      : players[currentTurnIndex]?.user_id === myUserId);
  const toCall = game?.to_call ?? 0;
  const myCurrentBet = myPlayer?.current_bet ?? 0;
  const needToCall = Math.max(0, toCall - myCurrentBet);
  const bigBlind = Number(game?.big_blind) || 1;
  const minRaise = bigBlind;
  const myStack = myPlayer?.stack ?? 0;
  const showAllCards = street === 'showdown' || status === 'completed';
  /** Your hole cards are already in the page header — skip duplicating them on the felt so they do not stack over the board / turn timer. */
  const heroHoleUsesHeader =
    myIndex >= 0 &&
    status === 'playing' &&
    (phase === 'playing' || isVsDealer) &&
    (street === 'preflop' || street === 'flop' || street === 'turn' || street === 'river');
  const amIPlayer = myIndex >= 0;
  const isSpectating = !isVsDealer && !amIPlayer;
  const amIReady = myPlayer?.ready || false;
  const activePlayers = players.filter((p) => p.status !== 'folded');
  const minPlayersRequired = game?.mode === 'tournament' ? 4 : 2;
  const allReady = players.length >= minPlayersRequired && players.every((p) => p.ready);
  const allReadyAt = game?.all_ready_at;
  const isTournament = game?.mode === 'tournament';
  const blindLevelIndex = Number(game?.blind_level_index || 0);
  const blindLevelStartedAt = game?.blind_level_started_at ? new Date(game.blind_level_started_at).getTime() : null;
  const blindLevelSecondsLeft = (() => {
    if (blindLevelStartedAt == null) return null;
    const elapsedSec = Math.max(0, Math.floor((Date.now() - blindLevelStartedAt) / 1000));
    const secInLevel = elapsedSec % MP_POKER_TOURNAMENT_LEVEL_SECONDS;
    return secInLevel === 0 ? MP_POKER_TOURNAMENT_LEVEL_SECONDS : MP_POKER_TOURNAMENT_LEVEL_SECONDS - secInLevel;
  })();
  const tournamentStatus = game?.tournament_status || null;
  const prizePool = Number(game?.prize_pool || 0);
  const buttonIndex = game?.button_index ?? 0;
  const isCreator = game?.creator_id === myUserId;
  const canLeaveGame = amIPlayer && !isCreator && status === 'open';
  const seatedIds = useMemo(() => new Set(players.map((p) => p.user_id).filter(Boolean)), [players]);
  const imSeated = Boolean(myUserId && seatedIds.has(myUserId));
  const inactiveOthersCount = imSeated
    ? players.filter((p) => p.user_id && !p.ready && p.user_id !== myUserId).length
    : players.filter((p) => p.user_id && !p.ready).length;
  const canRemindTournamentRole = Boolean(
    isTournament && tournamentStatus === 'registration' && status === 'open'
    && (phase === 'lobby' || phase === 'ready') && (isCreator || canStaffTournamentRemind),
  );
  const canHostKickUnready = Boolean(
    status === 'open'
    && (phase === 'lobby' || phase === 'ready')
    && (
      (isTournament && tournamentStatus === 'registration' && game?.approval_status === 'approved' && (isCreator || canStaffTournamentRemind))
      || (!isTournament && game?.mode === 'vs_players' && isCreator)
    ),
  );
  const remindCooldownMs = tournamentReminderCooldownRemainingMs(game?.inactive_reminder_sent_at, remindCooldownTick);
  const canClickRemindInactive = canRemindTournamentRole && inactiveOthersCount > 0 && remindCooldownMs <= 0;
  const remindInactiveTitle = !canRemindTournamentRole
    ? ''
    : inactiveOthersCount <= 0
      ? 'Everyone is ready or there is no one else to remind'
      : remindCooldownMs > 0
        ? (remindCooldownMs >= 60000
          ? `Available in ${Math.ceil(remindCooldownMs / 60000)}m`
          : `Available in ${Math.ceil(remindCooldownMs / 1000)}s`)
        : 'Send inbox reminder to all players who have not tapped Ready';
  const seatOrder = useMemo(() => {
    const total = players.length;
    if (total <= 0) return [];
    const inPlay = status === 'playing' && phase === 'playing';
    if (!inPlay || myIndex < 0) return Array.from({ length: total }, (_, i) => i);
    return Array.from({ length: total }, (_, i) => (myIndex + i) % total);
  }, [players, status, phase, myIndex]);

  // Seat positions on oval table
  const maxSeats = game?.max_players || players.length || 6;
  const tablePositions = getTablePositions(Math.min(9, Math.max(2, players.length || maxSeats)), compactUi);

  // Turn status message for "what's happening" (multiplayer + vs dealer/AI)
  const currentTurnPlayer = currentTurnIndex >= 0 && currentTurnIndex < players.length ? players[currentTurnIndex] : null;
  const turnStatusMessage = (() => {
    if (status !== 'playing' || (phase !== 'playing' && !isVsDealer)) return null;
    if (street === 'showdown' || status === 'completed') return null;
    if (currentTurnIndex < 0) return null;
    const name = currentTurnPlayer?.is_bot ? 'Dealer' : (currentTurnPlayer?.username ?? 'Someone');
    if (myPlayer?.status === 'folded') {
      return isVsDealer && currentTurnPlayer?.is_bot
        ? 'You folded. Dealer is deciding…'
        : `You folded. Waiting for ${name} to check, call, raise, or fold.`;
    }
    if (myPlayer?.status === 'all_in') {
      return `You're all-in. Waiting for the hand to finish.`;
    }
    if (isMyTurn) {
      const actions = needToCall > 0 ? 'call, raise, or fold' : 'check, bet, raise, or fold';
      return `Your turn — ${actions}.`;
    }
    if (isVsDealer && currentTurnPlayer?.is_bot) {
      return 'Dealer is deciding…';
    }
    return `Waiting for ${name} to check, call, raise, or fold.`;
  })();

  if (!hasLoaded && !game) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
        <div className="flex items-center gap-2">
          <Link to="/casino/mp-poker" className="p-1.5 rounded border border-primary/20 text-primary hover:bg-primary/10 transition-colors">
            <ArrowLeft size={16} />
          </Link>
        </div>
      </div>
    );
  }
  if (fetchError || (hasLoaded && !game)) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
        <div className="rounded-xl border p-6 text-center space-y-3" style={{ borderColor: 'rgba(248,113,113,0.25)', background: 'rgba(248,113,113,0.05)' }}>
          <p className="text-sm font-heading font-bold text-red-400 uppercase tracking-wider">Table Not Found</p>
          <p className="text-[10px] text-mutedForeground font-heading">This game may have ended or the link is invalid.</p>
          <div className="flex justify-center gap-2">
            <button onClick={fetchGame} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary font-heading text-[10px] uppercase hover:bg-primary/20">
              ↻ Retry
            </button>
            <Link to="/casino/mp-poker" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary font-heading text-[10px] uppercase hover:bg-primary/20">
              ← Back to Poker
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (status === 'cancelled') {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
        <div className="rounded-xl border p-6 text-center space-y-3" style={{ borderColor: 'rgba(248,113,113,0.25)', background: 'rgba(248,113,113,0.05)' }}>
          <p className="text-sm font-heading font-bold text-red-400 uppercase tracking-wider">Table Cancelled</p>
          <p className="text-[10px] text-mutedForeground font-heading">All buy-ins have been refunded.</p>
          <Link to="/casino/mp-poker"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary font-heading text-[10px] uppercase hover:bg-primary/20">
            ← Back to Poker
          </Link>
        </div>
      </div>
    );
  }

  const feltBg = {
    background:
      'radial-gradient(ellipse 95% 72% at 50% 42%, #12a34a 0%, #0d7a38 38%, #085c28 72%, #052818 100%)',
    boxShadow: 'inset 0 0 100px rgba(0,0,0,0.45), inset 0 -30px 60px rgba(0,0,0,0.2), 0 6px 28px rgba(0,0,0,0.55)',
  };

  return (
    <div className={`pkr-mp-root space-y-2 sm:space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="mp-poker-game-page">
      <style>{`
        @keyframes pkr-deal {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes pkr-particle {
          0%   { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          70%  { opacity: 1; }
          100% { transform: translateY(600px) rotate(var(--p-rotate,180deg)) scale(0.3); opacity: 0; }
        }
        @keyframes pkr-pulse {
          0%,100% { opacity: 0.5; }
          50%     { opacity: 1; }
        }
        @keyframes pkr-fade-in {
          from { opacity:0; transform:translateY(6px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes pkr-ready-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(212,175,55,0); }
          50%     { box-shadow: 0 0 0 8px rgba(212,175,55,0.15); }
        }
        @keyframes pkr-chip-bounce {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-3px); }
        }
        .animate-pkr-deal    { animation: pkr-deal 0.24s cubic-bezier(0.2,0.8,0.3,1) backwards; }
        .animate-pkr-fade    { animation: pkr-fade-in 0.35s ease-out both; }
        .animate-pkr-pulse   { animation: pkr-pulse 1.4s ease-in-out infinite; }
        .animate-pkr-ready   { animation: pkr-ready-pulse 2s ease-in-out infinite; }
        .animate-pkr-chip    { animation: pkr-chip-bounce 1.2s ease-in-out infinite; }
        .pkr-mp-root {
          background:
            radial-gradient(ellipse 100% 70% at 50% -15%, rgba(212,175,55,0.09), transparent 55%),
            radial-gradient(ellipse 80% 50% at 100% 50%, rgba(34,197,94,0.04), transparent 45%),
            radial-gradient(ellipse 80% 50% at 0% 50%, rgba(34,197,94,0.04), transparent 45%);
        }
      `}</style>

      <WinParticles active={showWin} />

      {/* ── Header ── */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 animate-pkr-fade rounded-xl border border-primary/15 px-2 py-2 sm:px-3 sm:py-2.5"
        style={{
          background: 'linear-gradient(180deg,rgba(0,0,0,0.45),rgba(0,0,0,0.28))',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Link to="/casino/mp-poker"
            className="p-1.5 rounded-lg border border-primary/25 text-primary hover:bg-primary/12 transition-colors shrink-0">
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <h1 className="text-base font-heading font-bold text-primary uppercase tracking-wider flex flex-wrap items-center gap-2">
              {isVsDealer ? 'Vs Dealer' : 'Poker Table'}
              {isSpectating && (
                <span className="text-[8px] font-heading font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300 bg-emerald-500/10">
                  Spectating
                </span>
              )}
            </h1>
            <p className="text-[9px] text-mutedForeground font-heading">
              {street ? <span className="text-yellow-400/80 font-bold">{STREET_LABELS[street] || street}</span> : 'Hold\'em'}
              {' · '}Pot <span className="text-primary font-bold">{formatMoneyFull(pot)}</span>
              {game?.hand_number > 0 && ` · Hand #${game.hand_number}`}
            </p>
            {isSpectating && status === 'playing' && (phase === 'playing' || isVsDealer) && street && street !== 'showdown' && (
              <p className="text-[8px] font-heading text-emerald-400/90 mt-0.5">Hole cards stay hidden until showdown.</p>
            )}
            {isTournament && (
              <p className="text-[8px] sm:text-[9px] text-mutedForeground font-heading mt-0.5 max-w-[calc(100vw-4rem)] sm:max-w-none truncate sm:whitespace-normal sm:overflow-visible">
                Tournament · {tournamentStatus || 'registration'}
                {' · '}Prize <span className="text-emerald-400 font-bold">{formatTournamentPrizeLike(prizePool, game)}</span>
                {' · '}Blinds <span className="text-primary/80 font-bold">{formatMoneyFull(game?.small_blind || 0)}/{formatMoneyFull(game?.big_blind || 0)}</span>
                <span className="hidden sm:inline">{' · '}Level {blindLevelIndex + 1}</span>
                {blindLevelSecondsLeft !== null && tournamentStatus === 'running' && (
                  <span className="hidden sm:inline">
                    {' · '}Next level in <span className="text-amber-300 font-bold">{formatDurationShort(blindLevelSecondsLeft)}</span>
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        {/* My hole cards condensed in header when game is active */}
        {myPlayer && (street === 'preflop' || street === 'flop' || street === 'turn' || street === 'river') && (
          <div
            className="flex items-center gap-1 px-2 py-1 rounded-lg shrink-0"
            style={{
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(212,175,55,0.28)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
            <span className="text-[8px] font-heading text-primary/60 mr-1">You</span>
            {(myPlayer.hole_cards || []).map((c, i) => (
              <Card key={i} card={c} hidden={false} index={i} total={2} small />
            ))}
          </div>
        )}
      </div>

      {/* Last-hand winner + cards: persists after re-deal (mobile + desktop); `last_hand_showdown` from API */}
      {isTournament &&
        status === 'playing' &&
        game?.last_hand_showdown?.results?.length > 0 && (
          <MpPokerLastHandWinnerBanner
            snapshot={game.last_hand_showdown}
            myUserId={myUserId}
            payoutPoints={isPointsTournamentGame(game)}
          />
        )}

      {/* ══ LOBBY ══ */}
      {phase === 'lobby' && status === 'open' && (
        <div
          className="rounded-xl overflow-hidden border-2 animate-pkr-fade"
          style={{ borderColor: '#5a3e1b', boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(212,175,55,0.08)' }}
        >
          <div style={PKR_GOLD_BAR} />
          <div className="p-5" style={feltBg}>
            <div className="text-center space-y-4">
              <p className="text-sm font-heading font-bold uppercase tracking-[0.2em]"
                style={{ background: 'linear-gradient(180deg,#ffd700,var(--noir-primary-bright))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Waiting for Players
              </p>
              <p className="text-[9px] font-heading" style={{ color: 'rgba(110,231,183,0.4)' }}>
                {players.length} / {game.max_players} seated
                {game.big_blind && ` · Blinds ${formatMoney(game.small_blind)}/${formatMoney(game.big_blind)}`}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {players.map((p) => (
                  <div key={p.user_id} className="inline-flex items-center gap-1">
                    <span className="px-3 py-1 rounded-full text-[9px] font-heading font-bold"
                      style={{ background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.3)', color: 'var(--noir-primary)' }}>
                      {p.username}
                    </span>
                    {canHostKickUnready && p.user_id && p.user_id !== game.creator_id && !p.ready && (
                      <button
                        type="button"
                        disabled={Boolean(kickLoadingUserId)}
                        onClick={() => kickUnreadyPlayer(p.user_id)}
                        title="Remove player (not ready); refund buy-in"
                        className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md border text-[8px] font-heading font-bold uppercase disabled:opacity-45"
                        style={{ borderColor: 'rgba(248,113,113,0.45)', background: 'rgba(248,113,113,0.1)', color: '#fca5a5' }}
                      >
                        <UserMinus size={10} />
                        {kickLoadingUserId === p.user_id ? '…' : 'Kick'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-2">
                {canRemindTournamentRole && (isCreator || canStaffTournamentRemind) && (
                  <button
                    type="button"
                    disabled={!canClickRemindInactive || remindLoading}
                    title={remindInactiveTitle}
                    onClick={remindInactivePlayers}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-heading font-bold uppercase disabled:opacity-45"
                    style={{ borderColor: 'rgba(45,212,191,0.45)', background: 'rgba(15,23,42,0.5)', color: '#5eead4' }}
                  >
                    {remindLoading ? '…' : 'Send inactive reminder'}
                  </button>
                )}
                {isCreator && (
                  <button type="button" disabled={cancelLoading} onClick={cancelGame}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-heading font-bold uppercase"
                    style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#f87171' }}>
                    <XCircle size={11} />{cancelLoading ? '…' : 'Cancel Table'}
                  </button>
                )}
                {canLeaveGame && (
                  <button type="button" disabled={leaveLoading} onClick={leaveGame}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-heading font-bold uppercase"
                    style={{ borderColor: 'rgba(161,161,170,0.4)', background: 'rgba(39,39,42,0.8)', color: '#e4e4e7' }}>
                    <XCircle size={11} />{leaveLoading ? 'Leaving…' : 'Leave Table'}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div style={PKR_GOLD_BAR} />
        </div>
      )}

      {/* ══ READY PHASE ══ */}
      {phase === 'ready' && (
        <div
          className="rounded-xl overflow-hidden border-2 animate-pkr-fade"
          style={{ borderColor: '#5a3e1b', boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(212,175,55,0.08)' }}
        >
          <div style={PKR_GOLD_BAR} />
          <div className="p-5 space-y-5" style={feltBg}>
            <div className="text-center space-y-1">
              <p className="text-sm font-heading font-bold uppercase tracking-[0.2em]"
                style={{ background: 'linear-gradient(180deg,#ffd700,var(--noir-primary-bright))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {players.length >= (game?.max_players ?? 6) ? 'Table Full — Ready Up!' : 'Ready Up!'}
              </p>
              <p className="text-[9px] font-heading" style={{ color: 'rgba(110,231,183,0.4)' }}>
                {players.length >= 2 ? 'All seated players must ready — then game starts' : 'Need at least 2 players'}
              </p>
            </div>

            {allReady && allReadyAt ? (
              <div className="flex justify-center">
                <StartCountdown seconds={startSecondsLeft ?? START_COUNTDOWN} />
              </div>
            ) : (
              amIPlayer && (
                <div className="flex flex-col items-center gap-2">
                  {amIReady ? (
                    <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-heading font-bold text-[10px] uppercase"
                      style={{ background: 'rgba(52,211,153,0.1)', border: '2px solid rgba(52,211,153,0.35)', color: '#34d399' }}>
                      <CheckCircle2 size={14} /> You're Ready
                    </div>
                  ) : (
                    <button type="button" disabled={readyLoading} onClick={markReady}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border-2 font-heading font-bold text-[11px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50 animate-pkr-ready"
                      style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200', boxShadow: '0 4px 16px rgba(212,175,55,0.3)' }}>
                      <CheckCircle2 size={15} />
                      {readyLoading ? 'Readying…' : "I'm Ready"}
                    </button>
                  )}
                  {canLeaveGame && (
                    <button type="button" disabled={leaveLoading} onClick={leaveGame}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-heading font-bold uppercase"
                      style={{ borderColor: 'rgba(161,161,170,0.4)', background: 'rgba(39,39,42,0.8)', color: '#e4e4e7' }}>
                      <XCircle size={11} />{leaveLoading ? 'Leaving…' : 'Leave Table'}
                    </button>
                  )}
                </div>
              )
            )}

            {/* Player ready grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {players.map((p) => (
                <div key={p.user_id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all"
                  style={{
                    background: p.ready ? 'rgba(52,211,153,0.07)' : 'rgba(0,0,0,0.35)',
                    border: p.ready ? '1px solid rgba(52,211,153,0.25)' : '1px solid rgba(255,255,255,0.07)',
                  }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0 transition-all"
                    style={{ background: p.ready ? '#34d399' : 'rgba(255,255,255,0.15)', boxShadow: p.ready ? '0 0 6px rgba(52,211,153,0.5)' : 'none' }} />
                  <span className="text-[9px] font-heading font-bold truncate min-w-0 flex-1"
                    style={{ color: p.user_id === myUserId ? 'var(--noir-primary)' : 'rgba(255,255,255,0.75)' }}>
                    {p.username}{p.user_id === myUserId ? ' (You)' : ''}
                  </span>
                  {canHostKickUnready && p.user_id && p.user_id !== game.creator_id && !p.ready && (
                    <button
                      type="button"
                      disabled={Boolean(kickLoadingUserId)}
                      onClick={() => kickUnreadyPlayer(p.user_id)}
                      title="Kick — not readied; refund buy-in"
                      className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[7px] font-heading font-bold uppercase disabled:opacity-45"
                      style={{ borderColor: 'rgba(248,113,113,0.45)', color: '#fca5a5' }}
                    >
                      <UserMinus size={9} />
                      {kickLoadingUserId === p.user_id ? '…' : 'Kick'}
                    </button>
                  )}
                  {p.ready && <CheckCircle2 size={10} className="ml-auto shrink-0" style={{ color: '#34d399' }} />}
                </div>
              ))}
            </div>

            {/* Ready progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[8px] font-heading text-mutedForeground">
                <span>{players.filter((p) => p.ready).length} / {players.length} ready</span>
                {!allReady && <span className="animate-pkr-pulse">Waiting for others…</span>}
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${players.length ? (players.filter((p) => p.ready).length / players.length) * 100 : 0}%`,
                    background: 'linear-gradient(90deg,#34d399,#10b981)',
                  }} />
              </div>
            </div>

            {(isCreator || status === 'open') && (
              <div className="flex flex-wrap justify-center gap-2">
                {canRemindTournamentRole && (isCreator || canStaffTournamentRemind) && (
                  <button
                    type="button"
                    disabled={!canClickRemindInactive || remindLoading}
                    title={remindInactiveTitle}
                    onClick={remindInactivePlayers}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-heading font-bold uppercase disabled:opacity-45"
                    style={{ borderColor: 'rgba(45,212,191,0.45)', background: 'rgba(15,23,42,0.5)', color: '#5eead4' }}
                  >
                    {remindLoading ? '…' : 'Send inactive reminder'}
                  </button>
                )}
                <button type="button" disabled={cancelLoading} onClick={cancelGame}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-heading font-bold uppercase"
                  style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#f87171' }}>
                  <XCircle size={11} />{cancelLoading ? '…' : 'Cancel Table'}
                </button>
              </div>
            )}
          </div>
          <div style={PKR_GOLD_BAR} />
        </div>
      )}

      {/* ══ LIVE TABLE (playing + completed) ══ */}
      {(status === 'playing' || status === 'completed') && phase !== 'ready' && (
        <div
          className="rounded-xl border-2 animate-pkr-fade"
          style={{
            borderColor: '#5a3e1b',
            overflow: 'visible',
            boxShadow: '0 10px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(212,175,55,0.1), 0 0 48px rgba(13,122,53,0.08)',
          }}
        >
          <div style={PKR_GOLD_BAR} />

          {/* Felt table with oval player layout */}
          <div
            className={`relative overflow-visible ${compactUi ? 'min-h-[280px] pb-3' : players.length <= 2 ? 'min-h-[340px] sm:min-h-[360px] pb-4' : 'min-h-[360px] sm:min-h-[440px] md:min-h-[480px] pb-4'}`}
            style={feltBg}
          >
            {isTournament && (
              <MpPokerTournamentHandToast
                snapshot={tournamentToast.snap}
                myUserId={myUserId}
                visible={tournamentToast.visible && !compactUi}
                compact={compactUi}
              />
            )}

            {/* Table felt oval */}
            <div
              className="absolute inset-3 sm:inset-5 md:inset-6 rounded-[50%]"
              style={{
                background:
                  'radial-gradient(ellipse 100% 85% at 50% 38%, #14b356 0%, #0f8a3e 42%, #0a6b2e 78%, #064422 100%)',
                border: compactUi ? '4px solid #4a3418' : '6px solid #4a3418',
                boxShadow:
                  'inset 0 0 50px rgba(0,0,0,0.38), inset 0 12px 40px rgba(255,255,255,0.06), 0 0 0 2px var(--noir-primary-bright), 0 4px 20px rgba(0,0,0,0.35)',
              }}
            />

            {/* Pot display in center — z above seat hole cards so the board is never covered by rail seats */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 16 }}>
              <div
                className={`flex flex-col items-center ${compactUi ? 'gap-1' : 'gap-1.5'} max-w-[min(100%,280px)] sm:max-w-none px-1`}
                style={isMyTurn ? { transform: 'translateY(-10px)' } : undefined}
              >
                {board.length > 0 && (
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-center scale-[0.96] sm:scale-100 origin-center">
                    {board.map((c, i) => (
                      <Card
                        key={i}
                        card={c}
                        hidden={false}
                        index={i}
                        total={board.length}
                        small={compactUi || players.length <= 4}
                        medium={!compactUi && players.length > 4}
                        straight
                      />
                    ))}
                  </div>
                )}
                <div
                  className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full font-heading font-bold text-center whitespace-normal ${compactUi ? 'text-[8px] max-w-[min(100%,200px)] leading-tight' : 'text-[9px]'}`}
                  style={PKR_TABLE_HUD_PILL_STYLE}
                >
                  {compactUi && street ? (
                    <>
                      <span className="block opacity-90">{STREET_LABELS[street] || street}</span>
                      <span className="block">Pot {formatMoneyFull(pot)}</span>
                    </>
                  ) : (
                    <>
                      {street ? `${STREET_LABELS[street] || street} · ` : ''}Pot {formatMoneyFull(pot)}
                    </>
                  )}
                </div>
                {myPlayer?.current_hand_name && board.length >= 3 && myPlayer?.status !== 'folded' && (
                  <div
                    className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full font-heading font-bold text-center max-w-[min(100%,260px)] leading-tight ${compactUi ? 'text-[8px]' : 'text-[9px]'}`}
                    style={PKR_TABLE_HUD_PILL_STYLE}
                  >
                    Your hand: {myPlayer.current_hand_name}
                  </div>
                )}
                {status === 'playing' && (phase === 'playing' || isVsDealer) && currentTurnIndex >= 0 && (
                  <div
                    className={`relative flex flex-col items-center gap-0.5 mt-0.5 sm:mt-1 rounded-xl ${compactUi ? 'px-2 py-1' : 'px-3 py-2'}`}
                    style={{
                      background: 'rgba(0,0,0,0.42)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                      border: '1px solid rgba(212,175,55,0.15)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
                    }}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {turnSecondsLeft != null && currentTurnPlayer?.status !== 'all_in' && (
                        <TurnTimer seconds={turnSecondsLeft} isMyTurn={isMyTurn} compact={compactUi} />
                      )}
                      <span
                        className={`font-heading font-bold animate-pkr-pulse text-center leading-tight ${compactUi ? 'text-[8px] max-w-[140px]' : 'text-[9px]'}`}
                        style={{ color: isMyTurn ? 'var(--noir-primary)' : 'rgba(255,255,255,0.55)' }}
                      >
                        {isMyTurn ? '🎴 Your turn' : `${currentTurnPlayer?.is_bot ? 'Dealer' : (currentTurnPlayer?.username ?? '?')}'s turn`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Player seats positioned around oval */}
            {seatOrder.map((playerIdx, displayIdx) => {
              const p = players[playerIdx];
              const pos = tablePositions[displayIdx] || { x: 50, y: 50 };
              // Cards face-up rule: show your own cards; show all at showdown/completed; bots always hidden until then
              const isMyOwnSeat = myUserId && p.user_id === myUserId;
              const showHole = showAllCards || (isMyOwnSeat && !p.is_bot);
              const isDealer = !isVsDealer && playerIdx === buttonIndex;
              const isCurrent = playerIdx === currentTurnIndex;
              return (
                <div key={p.user_id || playerIdx}
                  className="absolute"
                  style={{
                    left: `${pos.x}%`, top: `${pos.y}%`,
                    transform: 'translate(-50%,-50%)',
                    zIndex: isCurrent ? 8 : 5,
                  }}>
                  <PlayerSeat
                    p={p}
                    isMe={p.user_id === myUserId}
                    isCurrent={isCurrent}
                    showHole={showHole}
                    isDealer={isVsDealer ? p.is_bot : isDealer}
                    seatPos={pos}
                    totalSeats={players.length}
                    compact={compactUi}
                    omitHoleOnFelt={Boolean(isMyOwnSeat && heroHoleUsesHeader)}
                  />
                </div>
              );
            })}
          </div>

          <div style={PKR_GOLD_BAR} />
        </div>
      )}

      {/* ══ TURN STATUS (full detail here — avoids duplicating the long message on the felt) ══ */}
      {status === 'playing' && (phase === 'playing' || isVsDealer) && turnStatusMessage && street !== 'showdown' && (
        <div
          className="rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2 text-center border border-primary/25"
          style={{
            background: 'rgba(0,0,0,0.42)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            boxShadow: '0 2px 14px rgba(0,0,0,0.2)',
            borderLeft: '3px solid rgba(212,175,55,0.55)',
          }}
        >
          <p
            className="text-[8px] sm:text-[9px] font-heading leading-snug line-clamp-4 sm:line-clamp-none"
            style={{ color: 'rgba(212,175,55,0.88)' }}
          >
            {turnStatusMessage}
          </p>
        </div>
      )}

      {/* ══ ACTION BAR ══ */}
      {status === 'playing' && (phase === 'playing' || isVsDealer) && isMyTurn && myPlayer?.status !== 'folded' && myPlayer?.status !== 'all_in' && (
        <div
          className="rounded-xl overflow-hidden border-2 animate-pkr-fade"
          style={{ borderColor: '#5a3e1b', boxShadow: '0 8px 28px rgba(0,0,0,0.35)' }}
        >
          <div style={PKR_GOLD_BAR} />
          <div
            className="p-2.5 sm:p-3 space-y-2 sm:space-y-3"
            style={{
              background: 'linear-gradient(180deg,rgba(0,0,0,0.58),rgba(0,0,0,0.46))',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-heading text-primary/60 uppercase tracking-wider">Your Action</span>
              <span className="text-[9px] font-heading text-mutedForeground">
                Stack <span className={`font-bold ${myStack === 0 ? 'text-red-400' : 'text-primary'}`}>{formatMoneyFull(myStack)}</span>
                {needToCall > 0 && myStack > 0 && <span className="text-yellow-400 ml-2">· To call {formatMoneyFull(Math.min(needToCall, myStack))}</span>}
              </span>
            </div>

            {/* Stack = 0 special case: only option is fold or go all-in (already committed) */}
            {myStack === 0 ? (
              <div className="space-y-2">
                <p className="text-[9px] font-heading text-yellow-400/70 text-center">
                  {needToCall > 0 ? 'You have no chips left to call — go all-in or fold.' : 'No chips remaining — check to continue.'}
                </p>
                <div className="flex items-center gap-2 justify-center">
                  <button type="button" disabled={actionLoading} onClick={() => act('fold')}
                    className="px-4 py-2 rounded-lg border font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                    style={{ borderColor: 'rgba(248,113,113,0.5)', background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>
                    Fold
                  </button>
                  {needToCall > 0 ? (
                    <button type="button" disabled={actionLoading} onClick={() => act('all_in')}
                      className="px-5 py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                      style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200' }}>
                      All-In (committed)
                    </button>
                  ) : (
                    <button type="button" disabled={actionLoading} onClick={() => act('check')}
                      className="px-4 py-2 rounded-lg border font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                      style={{ borderColor: 'rgba(161,161,170,0.4)', background: 'rgba(161,161,170,0.08)', color: '#a1a1aa' }}>
                      Check
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Primary actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" disabled={actionLoading} onClick={() => act('fold')}
                    className="px-4 py-2 rounded-lg border font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                    style={{ borderColor: 'rgba(248,113,113,0.5)', background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>
                    Fold
                  </button>
                  {needToCall <= 0 ? (
                    <button type="button" disabled={actionLoading} onClick={() => act('check')}
                      className="px-4 py-2 rounded-lg border font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                      style={{ borderColor: 'rgba(161,161,170,0.4)', background: 'rgba(161,161,170,0.08)', color: '#a1a1aa' }}>
                      Check
                    </button>
                  ) : (
                    <button type="button" disabled={actionLoading} onClick={() => act('call')}
                      className="px-4 py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                      style={{ borderColor: 'var(--noir-primary-bright)', background: 'rgba(212,175,55,0.12)', color: 'var(--noir-primary)' }}>
                      Call {formatMoneyFull(Math.min(needToCall, myStack))}
                    </button>
                  )}
                  <button type="button" disabled={actionLoading} onClick={() => act('all_in')}
                    className="px-4 py-2 rounded-lg border font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                    style={{ borderColor: 'rgba(251,113,133,0.5)', background: 'rgba(251,113,133,0.1)', color: '#fb7185' }}>
                    All-In {formatMoney(myStack)}
                  </button>
                </div>

                {/* Raise row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="number"
                    min={minRaise}
                    max={myStack}
                    value={raiseAmount}
                    onChange={(e) => setRaiseAmount(e.target.value)}
                    placeholder={`Min ${formatMoneyFull(minRaise)}`}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg font-heading text-[10px] focus:outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(212,175,55,0.2)', color: 'inherit', minWidth: 80 }}
                  />
                  <button type="button" disabled={actionLoading || !raiseAmount}
                    onClick={() => { act(needToCall > 0 ? 'raise' : 'bet', parseInt(raiseAmount, 10) || minRaise); setRaiseAmount(''); }}
                    className="px-4 py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                    style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200' }}>
                    {needToCall > 0 ? 'Raise' : 'Bet'}
                  </button>
                  {[0.5, 0.75, 1].map((f) => {
                    const amt = Math.min(myStack, Math.max(minRaise, Math.floor(pot * f)));
                    return (
                      <button key={f} type="button"
                        onClick={() => setRaiseAmount(String(amt))}
                        className="px-2 py-1.5 rounded font-heading text-[8px] uppercase tracking-wider border border-primary/20 text-primary/60 hover:text-primary hover:border-primary/40 transition-colors">
                        {f === 1 ? 'Pot' : `${f * 100}%`}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div style={PKR_GOLD_BAR} />
        </div>
      )}

      {/* ══ ALL-IN WAITING STATE ══ */}
      {status === 'playing' && myPlayer?.status === 'all_in' && street !== 'showdown' && street !== 'completed' && (
        <div
          className="rounded-xl overflow-hidden border-2 animate-pkr-fade"
          style={{ borderColor: '#5a3e1b', boxShadow: '0 8px 28px rgba(0,0,0,0.35)' }}
        >
          <div style={PKR_GOLD_BAR} />
          <div
            className="p-4 text-center space-y-3"
            style={{
              background: 'linear-gradient(180deg,rgba(0,0,0,0.6),rgba(0,0,0,0.48))',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <div className="flex justify-center">
              <div className="w-10 h-10 rounded-full border-2 border-primary/40 flex items-center justify-center animate-pkr-pulse"
                style={{ background: 'rgba(212,175,55,0.1)' }}>
                <span className="text-xl">♠</span>
              </div>
            </div>
            <div>
              <p className="text-sm font-heading font-bold uppercase tracking-[0.2em]"
                style={{ background: 'linear-gradient(180deg,#ffd700,var(--noir-primary-bright))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                All In — Running It Out
              </p>
              <p className="text-[9px] font-heading mt-1 animate-pkr-pulse" style={{ color: 'rgba(110,231,183,0.5)' }}>
                Dealing remaining streets…
              </p>
            </div>
            {board.length > 0 && (
              <div>
                <p className="text-[8px] font-heading uppercase tracking-wider text-white/35 mb-1">Community cards</p>
                <div className="flex justify-center gap-1.5 flex-wrap">
                  {board.map((c, i) => (
                    <Card key={`allin-board-${i}`} card={c} hidden={false} index={i} total={board.length} small straight />
                  ))}
                </div>
              </div>
            )}
            {/* Manual advance fallback for vs-dealer all-in */}
            {isVsDealer && (
              <button type="button" onClick={fetchGame}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all"
                style={{ borderColor: 'rgba(212,175,55,0.35)', background: 'rgba(212,175,55,0.08)', color: 'var(--noir-primary)' }}>
                ↻ Check Result
              </button>
            )}
            {myPlayer?.hole_cards?.length > 0 && (
              <div className="flex justify-center items-end gap-1.5 pt-1">
                <span className="text-[8px] font-heading text-primary/50 self-center mr-1">Your cards</span>
                {myPlayer.hole_cards.map((c, i) => (
                  <Card key={i} card={c} hidden={false} index={i} total={2} />
                ))}
              </div>
            )}
          </div>
          <div style={PKR_GOLD_BAR} />
        </div>
      )}

      {/* ══ RESULTS (completed cash table or tournament) ══ */}
      {((status === 'completed' || phase === 'settled') && (game.results?.length > 0)) && (
        <MpPokerHandOutcomePanel
          results={game.results}
          players={players}
          pot={Math.max(0, ...(game.results || []).map((r) => Number(r.payout) || 0))}
          myUserId={myUserId}
          tournamentFooter={false}
          board={board}
          payoutPoints={isTournament && isPointsTournamentGame(game)}
        />
      )}

      {/* ══ HELP / LEGEND ══ */}
      {(() => {
        const [helpOpen, setHelpOpen] = [helpPanelOpen, setHelpPanelOpen];
        return (
          <div className={`${styles.panel} mobile-panel rounded-xl overflow-hidden border border-primary/20 animate-pkr-fade`}>
            <button type="button" onClick={() => setHelpOpen((o) => !o)}
              className="w-full px-3 py-2.5 border-b border-primary/20 flex items-center justify-between hover:bg-primary/5 transition-colors"
              style={{ background: 'rgba(234,179,8,0.04)' }}>
              <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-1.5">
                ♠ How to Play · Hand Rankings
              </span>
              <span className="text-primary/50 text-[10px]">{helpOpen ? '▲' : '▼'}</span>
            </button>
            {helpOpen && (
              <div className="p-3 space-y-4" style={{ background: 'rgba(0,0,0,0.25)' }}>

                {/* Actions explained */}
                <div>
                  <p className="text-[8px] font-heading font-bold uppercase tracking-[0.2em] mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Your Actions</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {[
                      { label: 'Fold', color: '#f87171', desc: 'Surrender your hand. You lose any chips already bet.' },
                      { label: 'Check', color: '#a1a1aa', desc: 'Pass without betting — only if no one has bet this round.' },
                      { label: 'Call', color: 'var(--noir-primary)', desc: 'Match the current bet to stay in the hand.' },
                      { label: 'Raise / Bet', color: 'var(--noir-primary)', desc: 'Increase the bet. Others must call your raise or fold.' },
                      { label: 'All-In', color: '#fb7185', desc: 'Bet everything you have. You play for the pot up to your stack.' },
                    ].map((a) => (
                      <div key={a.label} className="flex gap-2 items-start px-2.5 py-2 rounded-lg"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <span className="text-[8px] font-heading font-black shrink-0 mt-0.5 w-14" style={{ color: a.color }}>{a.label}</span>
                        <span className="text-[8px] font-heading leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{a.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Streets explained */}
                <div>
                  <p className="text-[8px] font-heading font-bold uppercase tracking-[0.2em] mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>The Streets</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {[
                      { name: 'Pre-Flop', desc: '2 hole cards dealt. First round of betting.' },
                      { name: 'Flop', desc: '3 community cards revealed.' },
                      { name: 'Turn', desc: '4th community card revealed.' },
                      { name: 'River', desc: '5th and final card. Last betting round.' },
                    ].map((s) => (
                      <div key={s.name} className="px-2 py-2 rounded-lg text-center"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="text-[8px] font-heading font-bold mb-0.5" style={{ color: 'var(--noir-primary)' }}>{s.name}</p>
                        <p className="text-[7px] font-heading leading-snug" style={{ color: 'rgba(255,255,255,0.45)' }}>{s.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Hand rankings */}
                <div>
                  <p className="text-[8px] font-heading font-bold uppercase tracking-[0.2em] mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Hand Rankings — Best to Worst</p>
                  <div className="space-y-1">
                    {[
                      { rank: '1', name: 'Straight Flush', example: '9♠ 8♠ 7♠ 6♠ 5♠', desc: 'Five consecutive cards, same suit.' },
                      { rank: '2', name: 'Four of a Kind', example: 'K♠ K♥ K♦ K♣ A', desc: 'Four cards of the same value.' },
                      { rank: '3', name: 'Full House', example: 'J♠ J♥ J♦ 7♠ 7♥', desc: 'Three of a kind + a pair.' },
                      { rank: '4', name: 'Flush', example: 'A♦ J♦ 8♦ 5♦ 2♦', desc: 'Any five cards, same suit.' },
                      { rank: '5', name: 'Straight', example: '8♠ 7♥ 6♦ 5♣ 4♠', desc: 'Five consecutive cards, mixed suits.' },
                      { rank: '6', name: 'Three of a Kind', example: 'Q♠ Q♥ Q♦ 9 3', desc: 'Three cards of the same value.' },
                      { rank: '7', name: 'Two Pair', example: 'A♠ A♥ K♦ K♣ J', desc: 'Two different pairs.' },
                      { rank: '8', name: 'Pair', example: '10♠ 10♥ A K 5', desc: 'Two cards of the same value.' },
                      { rank: '9', name: 'High Card', example: 'A♠ J♥ 9♦ 4♣ 2', desc: 'No combination — highest card plays.' },
                    ].map((h) => (
                      <div key={h.rank} className="flex items-center gap-2 px-2.5 py-1.5 rounded"
                        style={{ background: 'rgba(255,255,255,0.025)' }}>
                        <span className="text-[8px] font-heading font-black w-4 shrink-0 text-center"
                          style={{ color: Number(h.rank) <= 3 ? 'var(--noir-primary)' : Number(h.rank) <= 6 ? 'rgba(212,175,55,0.6)' : 'rgba(255,255,255,0.3)' }}>
                          {h.rank}
                        </span>
                        <span className="text-[8px] font-heading font-bold w-28 shrink-0"
                          style={{ color: Number(h.rank) <= 3 ? 'var(--noir-primary)' : 'rgba(255,255,255,0.7)' }}>
                          {h.name}
                        </span>
                        <span className="text-[7px] font-mono flex-1 hidden sm:block" style={{ color: 'rgba(255,255,255,0.3)' }}>{h.example}</span>
                        <span className="text-[7px] font-heading flex-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{h.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Blinds explained */}
                <div className="px-2.5 py-2 rounded-lg" style={{ background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.1)' }}>
                  <p className="text-[8px] font-heading font-bold mb-1" style={{ color: 'var(--noir-primary)' }}>Blinds</p>
                  <p className="text-[8px] font-heading leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    The Small Blind and Big Blind are forced bets posted before cards are dealt. They rotate each hand to keep action moving. The Big Blind is double the Small Blind.
                    You must at least call the Big Blind to stay in pre-flop.
                  </p>
                </div>

              </div>
            )}
          </div>
        );
      })()}

      {/* ══ CHAT (seated players may send; spectators read-only) ══ */}
      {!isVsDealer && (
        <div data-chat-surface="table" data-chat-game="poker" className={`${styles.panel} mobile-panel rounded-xl overflow-hidden border border-primary/20 animate-pkr-fade`}>
          <div data-chat-part="header" className="px-3 py-2 border-b border-primary/20 flex items-center gap-1.5" style={{ background: 'rgba(234,179,8,0.06)' }}>
            <MessageSquare size={11} className="text-primary" />
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Table Chat</span>
            {isSpectating && (
              <span className="text-[8px] font-heading text-mutedForeground ml-auto">View only</span>
            )}
          </div>
          <div data-chat-part="messages" className="max-h-[72px] sm:max-h-[120px] overflow-y-auto p-2 sm:p-2.5 space-y-1.5" style={{ background: 'rgba(0,0,0,0.2)' }}>
            {(game.chat || []).length === 0
              ? <p className="text-[9px] font-heading text-center py-2" style={{ color: 'rgba(255,255,255,0.15)' }}>No messages yet…</p>
              : (game.chat || []).slice(-30).map((c, i) => (
                  <div key={c.at || i} data-chat-part="message-row" className="text-[9px] font-heading leading-relaxed">
                    <span className="font-semibold" style={{ color: 'var(--noir-primary-bright)' }}>{c.username}:</span>{' '}
                    <span data-chat-part="message-text" className="text-foreground break-words">{c.message}</span>
                  </div>
                ))
            }
            <div ref={chatEndRef} />
          </div>
          {amIPlayer && status !== 'completed' && (
            <form onSubmit={sendChat} data-chat-part="composer" className="p-2 border-t border-primary/20 flex gap-1.5">
              <input type="text" data-chat-part="input" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                placeholder="Say something…" maxLength={200}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[11px] font-heading focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(234,179,8,0.15)', color: 'inherit' }} />
              <button type="submit" data-chat-part="send" disabled={sendingChat || !chatInput.trim()}
                className="px-3 py-1.5 rounded-lg text-[9px] font-heading font-bold uppercase border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 transition-colors">
                {sendingChat ? '…' : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}