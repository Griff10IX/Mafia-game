import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Trophy, Clock, Target, ArrowLeft } from "lucide-react";
import api from "../utils/api";
import { toast } from "sonner";
import styles from "../styles/noir.module.css";

const DIFFICULTIES = {
  snitch: { label: "Snitch", cols: 9, rows: 9, mines: 10, subtitle: "Small fish", points: 15 },
  capo: { label: "Capo", cols: 16, rows: 16, mines: 40, subtitle: "Made man", points: 30 },
  godfather: { label: "Godfather", cols: 30, rows: 16, mines: 99, subtitle: "Don't look back", points: 60 },
};

const CELL_COLORS = ["", "#d4af37", "#a0c4ff", "#e05c5c", "#9b7fd4", "#e08c5c", "#5ccce0", "#e0e0e0", "#888"];

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

export default function Minesweeper() {
  const [difficulty, setDifficulty] = useState("snitch");
  const [board, setBoard] = useState(() => createBoard(9, 9));
  const [phase, setPhase] = useState("idle");
  const [minesLeft, setMinesLeft] = useState(10);
  const [elapsed, setElapsed] = useState(0);
  const [minesReady, setMinesReady] = useState(false);
  const [deathCell, setDeathCell] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [reward, setReward] = useState(null);
  const timerRef = useRef(null);
  const submittedRef = useRef(false);

  const cfg = DIFFICULTIES[difficulty];

  useEffect(() => {
    fetchLeaderboard();
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
  }, [phase]);

  const submitWin = async () => {
    try {
      const res = await api.post("/minesweeper/win", {
        difficulty,
        time_seconds: elapsed,
      });
      if (res.data?.reward) {
        setReward(res.data.reward);
        toast.success(`You won! +$${res.data.reward.cash?.toLocaleString() || 0} cash`);
      }
      fetchLeaderboard();
    } catch (e) {
      console.error("Failed to submit win", e);
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
    submittedRef.current = false;
  }, [difficulty]);

  const handleDifficulty = (d) => {
    setDifficulty(d);
    resetGame(d);
  };

  const handleReveal = (r, c) => {
    if (phase === "won" || phase === "dead") return;
    let b = board;
    if (!minesReady) {
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
    if (checkWin(newBoard)) setPhase("won");
  };

  const handleFlag = (e, r, c) => {
    e.preventDefault();
    if (phase === "won" || phase === "dead" || board[r][c].revealed) return;
    const newBoard = board.map(row => row.map(cell =>
      cell.r === r && cell.c === c ? { ...cell, flagged: !cell.flagged } : cell
    ));
    setBoard(newBoard);
    setMinesLeft(m => board[r][c].flagged ? m + 1 : m - 1);
  };

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const cellSize = difficulty === "godfather" ? 28 : difficulty === "capo" ? 32 : 38;

  return (
    <div className={styles.pageContent}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        .ms-cell {
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; user-select: none; position: relative;
          border: 1px solid rgba(212,175,55,0.15);
          transition: background 0.1s;
          font-family: 'Crimson Text', serif;
          font-weight: 600;
        }
        .ms-cell.unrevealed {
          background: rgba(212,175,55,0.06);
        }
        .ms-cell.unrevealed:hover {
          background: rgba(212,175,55,0.14);
        }
        .ms-cell.revealed {
          background: rgba(0,0,0,0.35);
          cursor: default;
        }
        .ms-cell.mine-death {
          background: #7a1a1a !important;
        }
        .ms-cell.mine-revealed {
          background: rgba(120,20,20,0.3);
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
        .diff-btn:hover { border-color: rgba(212,175,55,0.7); color: #d4af37; }
        .diff-btn.active {
          background: rgba(212,175,55,0.1);
          border-color: #d4af37;
          color: #d4af37;
        }
        .new-game-btn {
          background: rgba(212,175,55,0.08);
          border: 1px solid rgba(212,175,55,0.5);
          color: #d4af37;
          font-family: 'Cinzel', serif;
          font-size: 12px;
          letter-spacing: 0.12em;
          padding: 8px 24px;
          cursor: pointer;
          transition: all 0.2s;
          text-transform: uppercase;
        }
        .new-game-btn:hover { background: rgba(212,175,55,0.18); border-color: #d4af37; }
        .stat-box {
          background: rgba(0,0,0,0.4);
          border: 1px solid rgba(212,175,55,0.2);
          padding: 6px 16px;
          min-width: 80px;
          text-align: center;
        }
        .overlay-banner {
          position: absolute; left: 0; right: 0;
          top: 50%; transform: translateY(-50%);
          text-align: center;
          background: rgba(10,8,6,0.92);
          border-top: 1px solid rgba(212,175,55,0.4);
          border-bottom: 1px solid rgba(212,175,55,0.4);
          padding: 1.5rem;
          z-index: 10;
          pointer-events: none;
        }
        .board-wrap { position: relative; }
      `}</style>

      {/* Back link */}
      <Link to="/minigames-leaderboard" className="flex items-center gap-1 text-primary text-[10px] font-heading uppercase tracking-wider hover:underline mb-3">
        <ArrowLeft size={12} /> Mini Games Leaderboard
      </Link>

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "rgba(212,175,55,0.5)", marginBottom: 6, textTransform: "uppercase" }}>
          The Family's Game
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: "#d4af37", margin: 0, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Minefield
        </h1>
        <div style={{ fontSize: 11, color: "rgba(212,175,55,0.35)", letterSpacing: "0.2em", marginTop: 4, fontFamily: "'Crimson Text', serif", fontStyle: "italic" }}>
          One wrong move &amp; you're sleeping with the fishes
        </div>
      </div>

      {/* Difficulty */}
      <div style={{ display: "flex", gap: 0, marginBottom: "1.25rem", border: "1px solid rgba(212,175,55,0.15)", justifyContent: "center" }}>
        {Object.entries(DIFFICULTIES).map(([key, d]) => (
          <button key={key} className={`diff-btn${difficulty === key ? " active" : ""}`} onClick={() => handleDifficulty(key)}>
            {d.label}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: "1rem", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
        <div className="stat-box">
          <div style={{ fontSize: 9, color: "rgba(212,175,55,0.5)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 2 }}>Snitches</div>
          <div style={{ fontSize: 20, color: "#d4af37", fontWeight: 700, letterSpacing: "0.05em" }}>
            {String(Math.max(0, minesLeft)).padStart(3, "0")}
          </div>
        </div>

        <button className="new-game-btn" onClick={() => resetGame()}>
          {phase === "dead" ? "Try Again" : phase === "won" ? "New Game" : "Reset"}
        </button>

        <div className="stat-box">
          <div style={{ fontSize: 9, color: "rgba(212,175,55,0.5)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 2 }}>Time</div>
          <div style={{ fontSize: 20, color: "#d4af37", fontWeight: 700, letterSpacing: "0.05em" }}>
            {fmtTime(Math.min(elapsed, 999))}
          </div>
        </div>
      </div>

      {/* Board */}
      <div style={{ display: "flex", justifyContent: "center", overflowX: "auto" }}>
        <div className="board-wrap" style={{ border: "1px solid rgba(212,175,55,0.25)", background: "rgba(0,0,0,0.4)" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cfg.cols}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${cfg.rows}, ${cellSize}px)`,
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
                  onClick={() => handleReveal(cell.r, cell.c)}
                  onContextMenu={(e) => handleFlag(e, cell.r, cell.c)}
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
                  <div style={{ fontSize: 22, color: "#d4af37", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    The Don Approves
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(212,175,55,0.6)", marginTop: 6, fontFamily: "'Crimson Text', serif", fontStyle: "italic" }}>
                    You navigated the field — {fmtTime(elapsed)} — like a true made man.
                  </div>
                  {reward && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#d4af37" }}>
                      +${reward.cash?.toLocaleString()} cash • +{reward.respect} respect
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
        Left click to reveal · Right click to plant a flag
      </div>

      {/* Leaderboard */}
      <section className={`${styles.panel} rounded-lg overflow-hidden mt-6`}>
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
