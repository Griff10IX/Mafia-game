import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Trophy, Clock, Target, ArrowLeft } from "lucide-react";
import api from "../../utils/api";
import { toast } from "sonner";
import { startMinigameRun } from "../../utils/minigameRunSession";
import useMinigamePlaysLeft from "../../hooks/useMinigamePlaysLeft";
import { useMinigameCaptcha } from "../../hooks/useMinigameCaptcha";
import styles from "../../styles/noir.module.css";

const DIFFICULTIES = {
  snitch: { label: "Snitch", cols: 9, rows: 9, mines: 10, subtitle: "Small fish", points: 15 },
  capo: { label: "Capo", cols: 16, rows: 16, mines: 40, subtitle: "Made man", points: 30 },
  godfather: { label: "Godfather", cols: 30, rows: 16, mines: 99, subtitle: "Don't look back", points: 60 },
};

const CELL_COLORS = ["", "var(--noir-primary)", "#a0c4ff", "#e05c5c", "#9b7fd4", "#e08c5c", "#5ccce0", "#e0e0e0", "#888"];

function createBoard(rows, cols) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({
      r, c, mine: false, revealed: false, flagged: false, count: 0,
    }))
  );
}

function placeMines(board, rows, cols, mineCount, safeR, safeC) {
  const newBoard = board.map(row => row.map(cell => ({ ...cell })));
  let placed = 0;
  while (placed < mineCount) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (!newBoard[r][c].mine && !(Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1)) {
      newBoard[r][c].mine = true;
      placed++;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!newBoard[r][c].mine) {
        let count = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && newBoard[nr][nc].mine) count++;
          }
        newBoard[r][c].count = count;
      }
    }
  }
  return newBoard;
}

function revealCells(board, rows, cols, startR, startC) {
  const newBoard = board.map(row => row.map(cell => ({ ...cell })));
  const queue = [[startR, startC]];
  const visited = new Set();
  while (queue.length > 0) {
    const [r, c] = queue.shift();
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    const cell = newBoard[r][c];
    if (cell.revealed || cell.flagged || cell.mine) continue;
    cell.revealed = true;
    if (cell.count === 0) {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if (dr !== 0 || dc !== 0) queue.push([r + dr, c + dc]);
    }
  }
  return newBoard;
}

function checkWin(board) {
  return board.every(row => row.every(cell => cell.mine ? !cell.revealed : cell.revealed));
}

function countFlags(board) {
  return board.reduce((sum, row) => sum + row.filter(cell => cell.flagged && !cell.revealed).length, 0);
}

export default function Minesweeper() {
  const { getCaptchaToken, captchaModal } = useMinigameCaptcha();
  const { playsLeft, maxPlays, canPlay, updateFromStart, refresh: refreshPlays, applyPlaysLeftPayload } = useMinigamePlaysLeft("minesweeper");
  const [difficulty, setDifficulty] = useState("snitch");
  const [board, setBoard] = useState(() => createBoard(9, 9));
  const [phase, setPhase] = useState("idle");
  const [minesLeft, setMinesLeft] = useState(10);
  const [elapsed, setElapsed] = useState(0);
  const [minesReady, setMinesReady] = useState(false);
  const [deathCell, setDeathCell] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [reward, setReward] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [compactUi, setCompactUi] = useState(false);
  const timerRef = useRef(null);
  const submittedRef = useRef(false);
  const runSessionRef = useRef(null);
  const firstRevealLockRef = useRef(false);
  const msDeadSyncRef = useRef(false);
  const flagTouchTimerRef = useRef(null);
  const suppressRevealRef = useRef(false);

  const cfg = DIFFICULTIES[difficulty];

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setCompactUi(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const res = await api.get("/minesweeper/leaderboard");
      setLeaderboard(res.data?.leaderboard || []);
    } catch (e) {
      console.error("Failed to load leaderboard", e);
    }
  };

  useEffect(() => {
    if (phase === "playing") {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [phase]);

  useEffect(() => {
    if (phase === "won" && !submittedRef.current) {
      submittedRef.current = true;
      submitWin();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run only when phase becomes "won"; submitWin uses current closure
  }, [phase]);

  useEffect(() => {
    if (phase !== "dead") {
      msDeadSyncRef.current = false;
      return;
    }
    if (msDeadSyncRef.current) return;
    if (runSessionRef.current) {
      msDeadSyncRef.current = true;
      refreshPlays();
    }
  }, [phase, refreshPlays]);

  const DIFF_REWARDS = { snitch: { cash: 1250, respect: 5 }, capo: { cash: 3750, respect: 15 }, godfather: { cash: 12500, respect: 50 } };
  const submitWin = async () => {
    setSubmitError("");
    try {
      const res = await api.post("/minesweeper/win", {
        difficulty,
        time_seconds: elapsed,
        session_id: runSessionRef.current,
      });
      if (res.data?.ok) {
        const dr = DIFF_REWARDS[difficulty] || { cash: 0, respect: 0 };
        setReward(dr);
        toast.success(`You won! +$${dr.cash.toLocaleString()} cash`);
      }
      fetchLeaderboard();
      if (res.data?.plays_left != null) applyPlaysLeftPayload(res.data);
      else refreshPlays();
    } catch (e) {
      console.error("Failed to submit win", e);
      const msg = e.response?.data?.detail || e.message || "Could not verify this win.";
      setSubmitError(msg);
      toast.error(msg);
      refreshPlays();
    }
  };

  const resetGame = useCallback((diff = difficulty) => {
    const c = DIFFICULTIES[diff];
    setBoard(createBoard(c.rows, c.cols));
    setPhase("idle");
    setMinesLeft(c.mines);
    setElapsed(0);
    setMinesReady(false);
    setDeathCell(null);
    setReward(null);
    setSubmitError("");
    submittedRef.current = false;
    runSessionRef.current = null;
    firstRevealLockRef.current = false;
    suppressRevealRef.current = false;
    clearTimeout(flagTouchTimerRef.current);
  }, [difficulty]);

  const handleDifficulty = (d) => {
    setDifficulty(d);
    resetGame(d);
  };

  const handleReveal = async (r, c) => {
    if (phase === "won" || phase === "dead") return;
    let b = board;
    if (!minesReady) {
      if (!canPlay) { toast.error("Play limit reached for this 2-hour window."); return; }
      if (firstRevealLockRef.current) return;
      let captchaToken = null;
      try {
        captchaToken = await getCaptchaToken();
      } catch (c) {
        if (c?.message === "captcha_cancelled") return;
        throw c;
      }
      firstRevealLockRef.current = true;
      try {
        const run = await startMinigameRun("minesweeper", { difficulty }, captchaToken);
        runSessionRef.current = run.session_id;
        updateFromStart(run);
      } catch (e) {
        firstRevealLockRef.current = false;
        toast.error(e.response?.data?.detail || e.message || "Could not start game");
        return;
      }
      b = placeMines(board, cfg.rows, cfg.cols, cfg.mines, r, c);
      setMinesReady(true);
      setPhase("playing");
    }
    const cell = b[r][c];
    if (cell.revealed || cell.flagged) return;
    if (cell.mine) {
      const revealed = b.map(row => row.map(cl => cl.mine ? { ...cl, revealed: true } : cl));
      setBoard(revealed);
      setPhase("dead");
      setDeathCell({ r, c });
      return;
    }
    const newBoard = revealCells(b, cfg.rows, cfg.cols, r, c);
    setBoard(newBoard);
    if (checkWin(newBoard)) {
      setMinesLeft(0);
      setPhase("won");
    }
  };

  const handleFlag = (e, r, c) => {
    e?.preventDefault?.();
    if (phase === "won" || phase === "dead" || board[r][c].revealed) return;
    const newBoard = board.map(row => row.map(cell =>
      cell.r === r && cell.c === c ? { ...cell, flagged: !cell.flagged } : cell
    ));
    setBoard(newBoard);
    setMinesLeft(Math.max(0, cfg.mines - countFlags(newBoard)));
  };

  const handleCellClick = (r, c) => {
    if (suppressRevealRef.current) {
      suppressRevealRef.current = false;
      return;
    }
    void handleReveal(r, c);
  };

  const handleTouchStart = (r, c) => {
    clearTimeout(flagTouchTimerRef.current);
    suppressRevealRef.current = false;
    flagTouchTimerRef.current = setTimeout(() => {
      suppressRevealRef.current = true;
      handleFlag(null, r, c);
      if (navigator.vibrate) navigator.vibrate(18);
    }, 420);
  };

  const clearFlagTouch = () => {
    clearTimeout(flagTouchTimerRef.current);
  };

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const cellSize = compactUi
    ? difficulty === "godfather" ? 22 : difficulty === "capo" ? 26 : 34
    : difficulty === "godfather" ? 28 : difficulty === "capo" ? 32 : 38;

  return (
    <div className={`${styles.pageContent} mobile-page-root`}>
      {captchaModal}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        .ms-cell {
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; user-select: none; position: relative;
          border: 1px solid rgba(212,175,55,0.14);
          transition: transform 0.12s ease, background 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
          font-family: 'Crimson Text', serif;
          font-weight: 600;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .ms-cell::after {
          content: "";
          position: absolute;
          inset: 2px;
          border-radius: 3px;
          pointer-events: none;
          opacity: 0.45;
          background: linear-gradient(135deg, rgba(255,255,255,0.08), transparent 46%, rgba(0,0,0,0.18));
        }
        .ms-cell.unrevealed {
          background: linear-gradient(145deg, rgba(85,60,25,0.78), rgba(23,18,12,0.92));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -2px 0 rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.35);
        }
        .ms-cell.unrevealed:hover {
          background: linear-gradient(145deg, rgba(120,86,32,0.86), rgba(34,25,15,0.96));
          border-color: rgba(212,175,55,0.4);
          transform: translateY(-1px);
        }
        .ms-cell.revealed {
          background: radial-gradient(circle at 50% 45%, rgba(21,18,14,0.78), rgba(0,0,0,0.55));
          border-color: rgba(255,255,255,0.06);
          cursor: default;
          box-shadow: inset 0 0 12px rgba(0,0,0,0.36);
        }
        .ms-cell.mine-death {
          background: radial-gradient(circle, #f87171 0%, #7a1a1a 48%, #250707 100%) !important;
          border-color: rgba(248,113,113,0.8);
          box-shadow: 0 0 18px rgba(248,113,113,0.45), inset 0 0 18px rgba(0,0,0,0.6);
        }
        .ms-cell.mine-revealed {
          background: radial-gradient(circle, rgba(120,20,20,0.62), rgba(30,8,8,0.92));
          border-color: rgba(248,113,113,0.28);
        }
        .diff-btn {
          background: transparent;
          border: 1px solid rgba(212,175,55,0.3);
          color: rgba(212,175,55,0.6);
          font-family: 'Cinzel', serif;
          font-size: 11px;
          letter-spacing: 0.1em;
          padding: 6px 14px;
          cursor: pointer;
          transition: all 0.2s;
          text-transform: uppercase;
        }
        .diff-btn:hover { border-color: rgba(212,175,55,0.7); color: var(--noir-primary); }
        .diff-btn.active {
          background: linear-gradient(180deg, rgba(212,175,55,0.16), rgba(212,175,55,0.05));
          border-color: var(--noir-primary);
          color: var(--noir-primary);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 0 18px rgba(212,175,55,0.08);
        }
        .new-game-btn {
          background: rgba(212,175,55,0.08);
          border: 1px solid rgba(212,175,55,0.5);
          color: var(--noir-primary);
          font-family: 'Cinzel', serif;
          font-size: 12px;
          letter-spacing: 0.12em;
          padding: 8px 24px;
          cursor: pointer;
          transition: all 0.2s;
          text-transform: uppercase;
        }
        .new-game-btn:hover { background: rgba(212,175,55,0.18); border-color: var(--noir-primary); }
        .stat-box {
          background: linear-gradient(180deg, rgba(0,0,0,0.58), rgba(0,0,0,0.34));
          border: 1px solid rgba(212,175,55,0.2);
          padding: 6px 16px;
          min-width: 80px;
          text-align: center;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(0,0,0,0.22);
        }
        .overlay-banner {
          position: absolute; left: 0; right: 0;
          top: 50%; transform: translateY(-50%);
          text-align: center;
          background: linear-gradient(180deg, rgba(10,8,6,0.96), rgba(0,0,0,0.9));
          border-top: 1px solid rgba(212,175,55,0.4);
          border-bottom: 1px solid rgba(212,175,55,0.4);
          padding: 1.5rem;
          z-index: 10;
          pointer-events: none;
          box-shadow: 0 12px 36px rgba(0,0,0,0.65);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .board-shell {
          display: flex;
          justify-content: center;
          overflow-x: auto;
          padding: 10px 0 14px;
          scrollbar-color: rgba(212,175,55,0.45) rgba(0,0,0,0.25);
        }
        .board-wrap {
          position: relative;
          border: 1px solid rgba(212,175,55,0.32);
          background:
            radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.1), transparent 45%),
            linear-gradient(180deg, rgba(14,10,7,0.96), rgba(0,0,0,0.82));
          box-shadow: 0 14px 48px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.06);
          padding: 6px;
        }
        @media (max-width: 640px) {
          .diff-btn { flex: 1; padding: 8px 7px; font-size: 9px; }
          .new-game-btn { width: 100%; min-height: 42px; }
          .stat-box { flex: 1; min-width: 118px; }
          .overlay-banner { padding: 1rem 0.75rem; }
        }
      `}</style>

      {/* Back link */}
      <Link to="/minigames-leaderboard" className="flex items-center gap-1 text-primary text-[10px] font-heading uppercase tracking-wider hover:underline mb-3">
        <ArrowLeft size={12} /> Mini Games Leaderboard
      </Link>

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: compactUi ? "1rem" : "1.5rem" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "rgba(212,175,55,0.5)", marginBottom: 6, textTransform: "uppercase" }}>
          The Family's Game
        </div>
        <h1 style={{ fontSize: compactUi ? 24 : 28, fontWeight: 900, color: "var(--noir-primary)", margin: 0, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Minefield
        </h1>
        <div style={{ fontSize: 11, color: "rgba(212,175,55,0.35)", letterSpacing: "0.2em", marginTop: 4, fontFamily: "'Crimson Text', serif", fontStyle: "italic" }}>
          One wrong move &amp; you're sleeping with the fishes
        </div>
        {playsLeft != null && (
          <div style={{ fontSize: 10, letterSpacing: '0.15em', marginTop: 6, color: canPlay ? 'rgba(212,175,55,0.5)' : '#dc2626', fontWeight: canPlay ? 400 : 700 }}>
            {playsLeft}/{maxPlays} PLAYS LEFT
          </div>
        )}
      </div>

      {/* Difficulty */}
      <div style={{ display: "flex", gap: 0, marginBottom: compactUi ? "0.9rem" : "1.25rem", border: "1px solid rgba(212,175,55,0.15)", justifyContent: "center" }}>
        {Object.entries(DIFFICULTIES).map(([key, d]) => (
          <button key={key} className={`diff-btn${difficulty === key ? " active" : ""}`} onClick={() => handleDifficulty(key)}>
            <span>{d.label}</span>
            {!compactUi && <span style={{ display: "block", fontSize: 8, opacity: 0.55, marginTop: 2 }}>{d.mines} mines</span>}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: "1rem", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
        <div className="stat-box">
          <div style={{ fontSize: 9, color: "rgba(212,175,55,0.5)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 2 }}>Mines left</div>
          <div style={{ fontSize: 20, color: "var(--noir-primary)", fontWeight: 700, letterSpacing: "0.05em" }}>
            {String(Math.max(0, minesLeft)).padStart(3, "0")}
          </div>
        </div>

        <button className="new-game-btn" onClick={() => resetGame()}>
          {phase === "dead" ? "Try Again" : phase === "won" ? "New Game" : "Reset"}
        </button>

        <div className="stat-box">
          <div style={{ fontSize: 9, color: "rgba(212,175,55,0.5)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 2 }}>Time</div>
          <div style={{ fontSize: 20, color: "var(--noir-primary)", fontWeight: 700, letterSpacing: "0.05em" }}>
            {fmtTime(Math.min(elapsed, 999))}
          </div>
        </div>
      </div>

      {/* Board */}
      <div className="board-shell">
        <div className="board-wrap">
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cfg.cols}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${cfg.rows}, ${cellSize}px)`,
            gap: compactUi ? 1 : 2,
          }}>
            {board.map(row => row.map(cell => {
              const isDeath = deathCell && cell.r === deathCell.r && cell.c === deathCell.c;
              const isMineRevealed = cell.mine && cell.revealed && !isDeath;
              let cls = "ms-cell";
              if (cell.revealed) cls += isDeath ? " mine-death" : isMineRevealed ? " mine-revealed" : " revealed";
              else cls += " unrevealed";

              return (
                <div
                  key={`${cell.r}-${cell.c}`}
                  className={cls}
                  style={{ width: cellSize, height: cellSize, fontSize: cellSize * 0.42 }}
                  onClick={() => handleCellClick(cell.r, cell.c)}
                  onContextMenu={(e) => handleFlag(e, cell.r, cell.c)}
                  onTouchStart={() => handleTouchStart(cell.r, cell.c)}
                  onTouchEnd={clearFlagTouch}
                  onTouchCancel={clearFlagTouch}
                  title={cell.revealed ? undefined : "Tap to reveal. Long press or right click to flag."}
                >
                  {cell.flagged && !cell.revealed && (
                    <span style={{ fontSize: cellSize * 0.48 }}>🚩</span>
                  )}
                  {cell.revealed && cell.mine && (
                    <span style={{ fontSize: cellSize * 0.48 }}>💣</span>
                  )}
                  {cell.revealed && !cell.mine && cell.count > 0 && (
                    <span style={{ color: CELL_COLORS[cell.count], fontWeight: 700 }}>{cell.count}</span>
                  )}
                </div>
              );
            }))}
          </div>

          {(phase === "won" || phase === "dead") && (
            <div className="overlay-banner">
              {phase === "won" ? (
                <>
                  <div style={{ fontSize: 22, color: "var(--noir-primary)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    The Don Approves
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(212,175,55,0.6)", marginTop: 6, fontFamily: "'Crimson Text', serif", fontStyle: "italic" }}>
                    You navigated the field — {fmtTime(elapsed)} — like a true made man.
                  </div>
                  {!reward && !submitError && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "rgba(212,175,55,0.6)" }}>
                      Verifying the payout...
                    </div>
                  )}
                  {reward && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--noir-primary)" }}>
                      +${reward.cash?.toLocaleString()} cash • +{reward.respect} respect
                    </div>
                  )}
                  {submitError && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>
                      Win not paid: {submitError}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 22, color: "#c0392b", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    You're Dead
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(192,57,43,0.7)", marginTop: 6, fontFamily: "'Crimson Text', serif", fontStyle: "italic" }}>
                    They found the wire. The family sends their regards.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer hint */}
      <div style={{ marginTop: "1rem", fontSize: 11, color: "rgba(212,175,55,0.3)", letterSpacing: "0.12em", textAlign: "center", fontFamily: "'Crimson Text', serif" }}>
        Tap to reveal · Long press or right click to plant a flag
      </div>

      {/* Leaderboard */}
      <section className={`${styles.panel} mobile-panel rounded-lg overflow-hidden mt-6`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
          <Trophy size={14} className="text-primary" />
          <div>
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Fastest Wins</h2>
            <p className="text-[8px] text-zinc-500 font-heading">Quickest times by difficulty</p>
          </div>
        </div>
        <div className="p-2 space-y-1">
          {leaderboard.length === 0 ? (
            <p className="text-[10px] text-mutedForeground italic py-3 text-center font-heading">No wins yet. Be the first!</p>
          ) : (
            leaderboard.map((entry, i) => (
              <div
                key={`${entry.user_id}-${entry.difficulty}-${i}`}
                className={`flex items-center gap-2 p-2 rounded-sm border ${styles.surfaceMuted} border-primary/10`}
              >
                <div className={`flex items-center justify-center w-6 h-6 rounded-sm font-heading font-bold text-[10px] shrink-0 ${
                  i === 0 ? 'bg-gradient-to-b from-yellow-400 to-yellow-600 text-yellow-900'
                  : i === 1 ? 'bg-gradient-to-b from-zinc-400 to-zinc-600 text-zinc-900'
                  : i === 2 ? 'bg-gradient-to-b from-amber-600 to-amber-800 text-amber-100'
                  : `${styles.surface} text-mutedForeground border border-primary/20`
                }`}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/profile/${encodeURIComponent(entry.username)}`} className="font-heading font-medium text-foreground text-xs hover:text-primary">
                    {entry.username}
                  </Link>
                  <div className="flex items-center gap-2 text-[9px] text-zinc-500 font-heading">
                    <span className="text-primary font-bold">{fmtTime(entry.time_seconds)}</span>
                    <span>•</span>
                    <span className="capitalize">{entry.difficulty}</span>
                  </div>
                </div>
                <Clock size={12} className="text-primary/50" />
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
