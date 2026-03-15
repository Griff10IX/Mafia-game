import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../../utils/api";
import { toast } from "sonner";
import styles from "./WhackACopper.module.css";

// ─── Police Officer SVG ───────────────────────────────────────────────────────
const CopSVG = () => (
  <svg width="56" height="72" viewBox="0 0 56 72" xmlns="http://www.w3.org/2000/svg">
    <rect x="10" y="4" width="36" height="18" rx="4" fill="#1e3d7a" stroke="#0f2347" strokeWidth="1"/>
    <rect x="8" y="20" width="40" height="7" rx="3" fill="#172f62" stroke="#0f2347" strokeWidth="1"/>
    <rect x="10" y="20" width="36" height="3" fill="#c9a227"/>
    <polygon points="28,7 29.8,12.5 35.5,12.5 31,15.8 32.8,21.3 28,18 23.2,21.3 25,15.8 20.5,12.5 26.2,12.5" fill="#d4a820" stroke="#8a6010" strokeWidth="0.5"/>
    <ellipse cx="13" cy="41" rx="4" ry="5.5" fill="#c8845a" stroke="#9a5c30" strokeWidth="1"/>
    <ellipse cx="43" cy="41" rx="4" ry="5.5" fill="#c8845a" stroke="#9a5c30" strokeWidth="1"/>
    <ellipse cx="13" cy="41" rx="2" ry="3" fill="#b06a40"/>
    <ellipse cx="43" cy="41" rx="2" ry="3" fill="#b06a40"/>
    <ellipse cx="28" cy="42" rx="15" ry="18" fill="#c8845a" stroke="#9a5c30" strokeWidth="1.2"/>
    <path d="M18 33.5 Q23 32 27 33" fill="none" stroke="#5c3518" strokeWidth="2" strokeLinecap="round"/>
    <path d="M29 33 Q33 32 38 33.5" fill="none" stroke="#5c3518" strokeWidth="2" strokeLinecap="round"/>
    <ellipse cx="22.5" cy="38" rx="4.5" ry="3.2" fill="white"/>
    <ellipse cx="33.5" cy="38" rx="4.5" ry="3.2" fill="white"/>
    <ellipse cx="22.5" cy="38" rx="2.8" ry="2.8" fill="#3d2510"/>
    <ellipse cx="33.5" cy="38" rx="2.8" ry="2.8" fill="#3d2510"/>
    <circle cx="22.5" cy="38" r="1.6" fill="#111"/>
    <circle cx="33.5" cy="38" r="1.6" fill="#111"/>
    <circle cx="23.5" cy="37" r="0.9" fill="white"/>
    <circle cx="34.5" cy="37" r="0.9" fill="white"/>
    <path d="M18.2 36.2 Q22.5 34.5 26.8 36.2" fill="none" stroke="#9a5c30" strokeWidth="0.7"/>
    <path d="M29.2 36.2 Q33.5 34.5 37.8 36.2" fill="none" stroke="#9a5c30" strokeWidth="0.7"/>
    <path d="M28 39 L26 47 Q28 48.5 30 47 Z" fill="#b07048"/>
    <ellipse cx="25.5" cy="47.5" rx="3" ry="2" fill="#a06038"/>
    <ellipse cx="30.5" cy="47.5" rx="3" ry="2" fill="#a06038"/>
    <ellipse cx="25.5" cy="48" rx="1.4" ry="1" fill="#7a4020"/>
    <ellipse cx="30.5" cy="48" rx="1.4" ry="1" fill="#7a4020"/>
    <path d="M21 53 Q28 55.5 35 53" fill="none" stroke="#8a4822" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M22.5 52 Q28 50.5 33.5 52" fill="none" stroke="#aa6040" strokeWidth="0.8"/>
    <rect x="22" y="58" width="12" height="8" rx="3" fill="#c8845a" stroke="#9a5c30" strokeWidth="0.8"/>
    <path d="M8 66 Q8 76 10 84 L46 84 Q48 76 48 66 Q38 60 28 59 Q18 60 8 66Z" fill="#1e3d7a" stroke="#0f2347" strokeWidth="1"/>
    <path d="M22 60 L18 68 L28 64Z" fill="#172f62" stroke="#0f2347" strokeWidth="0.5"/>
    <path d="M34 60 L38 68 L28 64Z" fill="#172f62" stroke="#0f2347" strokeWidth="0.5"/>
    <path d="M25 63 L28 84 L31 63 Q28 61 25 63Z" fill="#0f2347"/>
    <rect x="5" y="64" width="11" height="5" rx="2" fill="#1e3d7a" stroke="#c9a227" strokeWidth="1"/>
    <rect x="40" y="64" width="11" height="5" rx="2" fill="#1e3d7a" stroke="#c9a227" strokeWidth="1"/>
    <rect x="5" y="65.5" width="11" height="1.5" fill="#c9a227"/>
    <rect x="40" y="65.5" width="11" height="1.5" fill="#c9a227"/>
    <polygon points="28,64 30,70 36.5,70 31.5,73.5 33.5,79.5 28,76 22.5,79.5 24.5,73.5 19.5,70 26,70" fill="#d4a820" stroke="#8a6010" strokeWidth="0.6"/>
    <circle cx="28" cy="71.5" r="2.2" fill="#b8960c"/>
  </svg>
);

const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const DIFF_PRESETS = {
  easy:   { stayMult: 1.6, speedMult: 0.6, maxCops: 2 },
  medium: { stayMult: 1.0, speedMult: 1.0, maxCops: 3 },
  hard:   { stayMult: 0.6, speedMult: 1.5, maxCops: 4 },
};

const FX_EMOJIS = ["💥", "⭐", "👊", "💫", "✨"];

const GRADE_MAP = {
  S: { min: 500, color: "#d4a820", label: "Outstanding, boss." },
  A: { min: 350, color: "#22aa55", label: "Sharp work." },
  B: { min: 200, color: "#4488ee", label: "Not bad, not bad." },
  C: { min: 100, color: "#cc8800", label: "Could do better." },
  D: { min: 0,   color: "#cc3333", label: "They nearly got away." },
};

function getGrade(score) {
  for (const [g, v] of Object.entries(GRADE_MAP)) {
    if (score >= v.min) return { grade: g, ...v };
  }
  return { grade: "D", ...GRADE_MAP.D };
}

const Hole = ({ holeId, isUp, isBonked, onWhack, flashType }) => {
  const handleInteraction = useCallback((e) => {
    e.preventDefault();
    onWhack(holeId);
  }, [holeId, onWhack]);

  return (
    <div className={styles.hole}>
      <div
        className={`${styles.holeClip} ${flashType === "hit" ? styles.holeClipHit : flashType === "miss" ? styles.holeClipMiss : ""}`}
        onClick={handleInteraction}
        onTouchEnd={handleInteraction}
      >
        <div className={styles.holeBg} />
        <div className={`${styles.copMover} ${isUp ? styles.copUp : ""} ${isBonked ? styles.copBonked : ""}`}>
          <CopSVG />
        </div>
        <div className={styles.holeDirt} />
      </div>
      <div className={`${styles.holeBorder} ${flashType === "hit" ? styles.holeBorderHit : ""}`} />
    </div>
  );
};

const Particle = ({ id, x, y, emoji, pts, comboCount, onDone }) => {
  useEffect(() => {
    const t = setTimeout(() => onDone(id), 750);
    return () => clearTimeout(t);
  }, [id, onDone]);

  const ptsColor = comboCount > 5 ? "#ff4444" : comboCount > 3 ? "#ffaa00" : "#d4a820";

  return (
    <div className={styles.particleWrap} style={{ left: x, top: y }}>
      <div className={styles.fxStar}>{emoji}</div>
      {pts != null && (
        <div className={styles.fxPts} style={{ color: ptsColor }}>
          {comboCount > 1 ? `+${pts} x${comboCount}` : `+${pts}`}
        </div>
      )}
    </div>
  );
};

const EscapedLabel = ({ id, onDone }) => {
  useEffect(() => {
    const t = setTimeout(() => onDone(id), 950);
    return () => clearTimeout(t);
  }, [id, onDone]);
  return <div className={styles.escapedTxt}>ESCAPED!</div>;
};

const SegControl = ({ options, value, onChange }) => (
  <div className={styles.seg}>
    {options.map((o) => (
      <button
        key={o.value}
        className={`${styles.segBtn} ${value === o.value ? styles.segBtnActive : ""}`}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const Toggle = ({ checked, onChange }) => (
  <label className={styles.toggle}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className={styles.toggleTrack} />
  </label>
);

export default function WhackACopper() {
  const [diff, setDiff] = useState("medium");
  const [duration, setDuration] = useState(30);
  const [gridSize, setGridSize] = useState(9);
  const [livesMode, setLivesMode] = useState(3);
  const [shakeEnabled, setShakeEnabled] = useState(true);
  const [fxEnabled, setFxEnabled] = useState(true);
  const [ptsEnabled, setPtsEnabled] = useState(true);
  const [panicEnabled, setPanicEnabled] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [phase, setPhase] = useState("idle");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [maxCombo, setMaxCombo] = useState(1);
  const [timeLeft, setTimeLeft] = useState(30);
  const [lives, setLives] = useState(3);
  const [missCount, setMissCount] = useState(0);
  const [panic, setPanic] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [bestScore, setBestScore] = useState(0);
  const submittedRef = useRef(false);

  const [holeStates, setHoleStates] = useState(() =>
    Array.from({ length: 9 }, () => ({ up: false, bonked: false, flash: null, escaped: false }))
  );

  const [particles, setParticles] = useState([]);
  const particleId = useRef(0);

  const refs = useRef({});
  refs.current.score = score;
  refs.current.combo = combo;
  refs.current.lives = lives;
  refs.current.running = phase === "playing";
  refs.current.gridSize = gridSize;

  const timerRef = useRef(null);
  const waveRef = useRef(null);
  const holeTimers = useRef([]);
  const holeEscapeTimerIds = useRef([]); // per-hole escape timer so we can cancel on whack (avoids race: click vs escape)
  const holeUpRef = useRef(Array(12).fill(false));

  const cols = gridSize === 12 ? 3 : 3;
  const rows = gridSize === 6 ? 2 : gridSize === 12 ? 4 : 3;

  const triggerShake = useCallback(() => {
    if (!shakeEnabled) return;
    setShaking(true);
    setTimeout(() => setShaking(false), 300);
  }, [shakeEnabled]);

  const setHole = useCallback((i, patch) => {
    setHoleStates((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }, []);

  const clearFlash = useCallback((i) => {
    setTimeout(() => setHole(i, { flash: null }), 420);
  }, [setHole]);

  const spawnParticle = useCallback((holeEl, pts, comboCount, showPts) => {
    if (!fxEnabled) return;
    const id = ++particleId.current;
    setParticles((p) => [...p, { id, x: "50%", y: "30%", emoji: FX_EMOJIS[Math.floor(Math.random() * FX_EMOJIS.length)], pts: showPts ? pts : null, comboCount }]);
  }, [fxEnabled]);

  const removeParticle = useCallback((id) => {
    setParticles((p) => p.filter((x) => x.id !== id));
  }, []);

  const submitScore = useCallback(async (finalScore) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    try {
      const res = await api.post("/whack-a-copper/score", { score: finalScore });
      if (res.data?.cash > 0) {
        toast.success(`Score submitted! +$${res.data.cash.toLocaleString()} cash`);
      } else if (finalScore >= 100) {
        toast.success("Score submitted!");
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to submit score");
    } finally {
      submittedRef.current = false;
    }
  }, []);

  const endGame = useCallback(() => {
    refs.current.running = false;
    clearTimeout(timerRef.current);
    clearTimeout(waveRef.current);
    holeTimers.current.forEach(clearTimeout);
    holeTimers.current = [];
    (holeEscapeTimerIds.current || []).forEach((tid) => { if (tid != null) clearTimeout(tid); });
    holeEscapeTimerIds.current = [];
    holeUpRef.current = Array(refs.current.gridSize).fill(false);
    setHoleStates(Array.from({ length: refs.current.gridSize }, () => ({
      up: false, bonked: false, flash: null, escaped: false,
    })));
    setPanic(false);
    const finalScore = refs.current.score;
    setBestScore((b) => Math.max(b, finalScore));
    setPhase("over");
    submitScore(finalScore);
  }, [submitScore]);

  const popUp = useCallback((i) => {
    if (!refs.current.running || holeUpRef.current[i]) return;
    holeUpRef.current[i] = true;
    setHole(i, { up: true, bonked: false });

    const d = DIFF_PRESETS[diff];
    const tier = Math.floor(refs.current.score / 80);
    const stay = Math.max(400, (1500 - tier * 60) * d.stayMult);

    const t = setTimeout(() => {
      if (!holeUpRef.current[i] || !refs.current.running) return;
      holeEscapeTimerIds.current[i] = null;
      holeUpRef.current[i] = false;
      setHole(i, { up: false, flash: "miss", escaped: true });
      clearFlash(i);
      setTimeout(() => setHole(i, { escaped: false }), 1000);

      setMissCount((m) => m + 1);
      setCombo(1);
      if (livesMode > 0) {
        setLives((l) => {
          const next = Math.max(0, l - 1);
          if (next <= 0) setTimeout(endGame, 50);
          return next;
        });
      }
      triggerShake();
    }, stay);
    holeEscapeTimerIds.current[i] = t;
    holeTimers.current.push(t);
  }, [diff, livesMode, setHole, clearFlash, triggerShake, endGame]);

  const scheduleWave = useCallback(() => {
    if (!refs.current.running) return;
    const size = refs.current.gridSize;
    const avail = Array.from({ length: size }, (_, i) => i).filter((i) => !holeUpRef.current[i]);

    if (!avail.length) {
      waveRef.current = setTimeout(scheduleWave, 200);
      return;
    }

    const d = DIFF_PRESETS[diff];
    const tier = Math.floor(refs.current.score / 80);
    const upCount = holeUpRef.current.filter(Boolean).length;
    const count = Math.min(d.maxCops - upCount, avail.length, Math.max(1, tier + 1));

    const picked = avail.sort(() => Math.random() - 0.5).slice(0, Math.max(1, count));
    picked.forEach((i) => popUp(i));

    const delay = Math.max(280, (1000 - tier * 50) * d.speedMult);
    waveRef.current = setTimeout(scheduleWave, delay);
  }, [diff, popUp]);

  const startGame = useCallback(() => {
    holeTimers.current.forEach(clearTimeout);
    holeTimers.current = [];
    (holeEscapeTimerIds.current || []).forEach((tid) => { if (tid != null) clearTimeout(tid); });
    holeEscapeTimerIds.current = Array(gridSize).fill(null);
    clearTimeout(timerRef.current);
    clearTimeout(waveRef.current);
    holeUpRef.current = Array(gridSize).fill(false);
    submittedRef.current = false;

    setScore(0);
    setCombo(1);
    setMaxCombo(1);
    setMissCount(0);
    setTimeLeft(duration);
    setLives(livesMode || 999);
    setPanic(false);
    setShaking(false);
    setParticles([]);
    setHoleStates(Array.from({ length: gridSize }, () => ({
      up: false, bonked: false, flash: null, escaped: false,
    })));
    setSettingsOpen(false);
    setPhase("playing");
    refs.current.running = true;
    refs.current.score = 0;
    refs.current.combo = 1;
    refs.current.lives = livesMode || 999;
  }, [gridSize, duration, livesMode]);

  useEffect(() => {
    if (phase !== "playing") return;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setTimeout(endGame, 100);
          return 0;
        }
        if (panicEnabled && t - 1 <= 10) setPanic(true);
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase, panicEnabled, endGame]);

  useEffect(() => {
    if (phase !== "playing") return;
    const t = setTimeout(scheduleWave, 400);
    return () => {
      clearTimeout(t);
      clearTimeout(waveRef.current);
      holeTimers.current.forEach(clearTimeout);
    };
  }, [phase, scheduleWave]);

  const handleWhack = useCallback((i) => {
    if (phase !== "playing" || !holeUpRef.current[i]) return;
    holeUpRef.current[i] = false;
    const escapeTimerId = holeEscapeTimerIds.current[i];
    if (escapeTimerId != null) {
      clearTimeout(escapeTimerId);
      holeEscapeTimerIds.current[i] = null;
    }

    setHole(i, { up: false, bonked: true, flash: "hit" });
    clearFlash(i);
    setTimeout(() => setHole(i, { bonked: false }), 280);

    setScore((s) => {
      const pts = 10 * refs.current.combo;
      const next = s + pts;
      refs.current.score = next;
      spawnParticle(null, pts, refs.current.combo, ptsEnabled);
      return next;
    });

    setCombo((c) => {
      const next = Math.min(c + 1, 10);
      refs.current.combo = next;
      setMaxCombo((m) => Math.max(m, next));
      if (next >= 5 && shakeEnabled) triggerShake();
      return next;
    });
  }, [phase, setHole, clearFlash, spawnParticle, ptsEnabled, shakeEnabled, triggerShake]);

  const comboBarPct = Math.min(((combo - 1) / 9) * 100, 100);
  const comboColor = combo >= 7 ? "#ff3333" : combo >= 5 ? "#ff8800" : combo >= 3 ? "#cc8800" : "#b8960c";
  const timerPct = (timeLeft / duration) * 100;
  const gradeInfo = getGrade(score);
  const displayMisses = livesMode > 0 ? "❤".repeat(Math.max(0, lives)) : missCount;

  return (
    <div data-game="whack-a-copper" className={`${styles.root} ${panic ? styles.rootPanic : ""} ${shaking ? styles.rootShake : ""}`}>
      <div className={styles.header}>
        <Link to="/casino/mini-games/leaderboard" className="text-primary text-[9px] font-heading uppercase tracking-wider hover:underline block mb-1">
          ← Mini Games Leaderboard
        </Link>
        <div className={styles.wantedStamp}>WANTED</div>
        <h1 className={styles.title}>WHACK-A-COPPER</h1>
        <p className={styles.subtitle}>Silence the fuzz before they blow the whistle</p>
      </div>

      <div className={styles.hud}>
        <div className={styles.hudCard}>
          <div className={styles.hudLabel}>Score</div>
          <div className={styles.hudVal}>{score}</div>
        </div>
        <div className={styles.hudCard}>
          <div className={styles.hudLabel}>Combo</div>
          <div className={styles.hudVal} style={{ color: comboColor }}>x{combo}</div>
        </div>
        <div className={styles.hudCard}>
          <div className={styles.hudLabel}>{livesMode > 0 ? "Lives" : "Escaped"}</div>
          <div className={`${styles.hudVal} ${styles.hudValDanger}`}>{displayMisses}</div>
        </div>
        <div className={styles.hudCard}>
          <div className={styles.hudLabel}>Time</div>
          <div className={`${styles.hudVal} ${timeLeft <= 10 ? styles.hudValUrgent : styles.hudValDanger}`}>
            {timeLeft}
          </div>
        </div>
      </div>

      <div className={styles.comboBarWrap}>
        <div className={styles.comboFill} style={{ width: `${comboBarPct}%`, background: comboColor }} />
      </div>

      <div className={styles.timerBarWrap}>
        <div
          className={styles.timerFill}
          style={{
            width: `${timerPct}%`,
            background: timerPct < 33 ? "#cc3333" : timerPct < 60 ? "#cc8800" : "#2a6040",
          }}
        />
      </div>

      <button
        className={`${styles.settingsBtn} ${settingsOpen ? styles.settingsBtnOpen : ""}`}
        onClick={() => setSettingsOpen((o) => !o)}
      >
        <GearIcon />
        SETTINGS
      </button>

      {settingsOpen && (
        <div className={styles.settingsPanel}>
          <div className={styles.settingsGrid}>
            <div className={styles.settingGroup}>
              <div className={styles.settingLabel}>Difficulty</div>
              <SegControl
                options={[{ value: "easy", label: "Easy" }, { value: "medium", label: "Med" }, { value: "hard", label: "Hard" }]}
                value={diff}
                onChange={setDiff}
              />
            </div>
            <div className={styles.settingGroup}>
              <div className={styles.settingLabel}>Duration</div>
              <SegControl
                options={[{ value: 20, label: "20s" }, { value: 30, label: "30s" }, { value: 60, label: "60s" }]}
                value={duration}
                onChange={setDuration}
              />
            </div>
            <div className={styles.settingGroup}>
              <div className={styles.settingLabel}>Grid</div>
              <SegControl
                options={[{ value: 6, label: "2×3" }, { value: 9, label: "3×3" }, { value: 12, label: "3×4" }]}
                value={gridSize}
                onChange={setGridSize}
              />
            </div>
            <div className={styles.settingGroup}>
              <div className={styles.settingLabel}>Lives</div>
              <SegControl
                options={[{ value: 0, label: "Off" }, { value: 3, label: "3" }, { value: 5, label: "5" }]}
                value={livesMode}
                onChange={setLivesMode}
              />
            </div>
          </div>

          <div className={styles.settingsDivider}>Visual</div>

          <div className={styles.settingsGrid}>
            {[
              ["Screen Shake", shakeEnabled, setShakeEnabled],
              ["Combo FX", fxEnabled, setFxEnabled],
              ["Score Popups", ptsEnabled, setPtsEnabled],
              ["Panic Mode", panicEnabled, setPanicEnabled],
            ].map(([label, val, setter]) => (
              <div key={label} className={styles.toggleRow}>
                <div className={styles.settingLabel}>{label}</div>
                <Toggle checked={val} onChange={setter} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.gameArea} style={{ "--cols": cols, "--rows": rows }}>
        <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: gridSize }, (_, i) => {
            const hs = holeStates[i] || {};
            return (
              <div key={i} className={styles.holeWrapper}>
                <Hole
                  holeId={i}
                  isUp={hs.up}
                  isBonked={hs.bonked}
                  flashType={hs.flash}
                  onWhack={handleWhack}
                />
                <div className={styles.fxLayer}>
                  {hs.escaped && <EscapedLabel key={`esc-${i}`} id={`esc-${i}`} onDone={() => {}} />}
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.particlesOverlay}>
          {particles.map((p) => (
            <Particle key={p.id} {...p} onDone={removeParticle} />
          ))}
        </div>

        {phase === "idle" && (
          <div className={styles.overlay}>
            <div className={styles.ovBox}>
              <div className={styles.ovTitle}>WHACK·A·COPPER</div>
              <div className={styles.ovMsg}>
                The heat&apos;s closing in, boss.<br />
                Send &apos;em back underground before<br />
                they blow the whole operation.
              </div>
              <button className={styles.ovBtn} onClick={startGame}>
                TAKE THE JOB
              </button>
              <Link to="/casino/mini-games/leaderboard" className={styles.ovBtnSecondary}>
                BACK TO MINI GAMES
              </Link>
            </div>
          </div>
        )}

        {phase === "over" && (
          <div className={styles.overlay}>
            <div className={styles.ovBox}>
              <div className={styles.ovTitle}>— JOB COMPLETE —</div>
              <div className={styles.ovMsg}>{gradeInfo.label}</div>
              <div className={styles.ovGrade} style={{ color: gradeInfo.color }}>
                GRADE {gradeInfo.grade}
              </div>
              <div className={styles.ovStats}>
                <div className={styles.ovStat}>
                  <div className={styles.ovStatLabel}>Score</div>
                  <div className={styles.ovStatVal}>{score}</div>
                </div>
                <div className={styles.ovStat}>
                  <div className={styles.ovStatLabel}>Best</div>
                  <div className={styles.ovStatVal}>{bestScore}</div>
                </div>
                <div className={styles.ovStat}>
                  <div className={styles.ovStatLabel}>Escaped</div>
                  <div className={styles.ovStatVal}>{missCount}</div>
                </div>
                <div className={styles.ovStat}>
                  <div className={styles.ovStatLabel}>Max Combo</div>
                  <div className={styles.ovStatVal}>x{maxCombo}</div>
                </div>
              </div>
              <button className={styles.ovBtn} onClick={startGame}>
                RUN IT AGAIN
              </button>
              <button className={styles.ovBtnSecondary} onClick={() => { setSettingsOpen(true); setPhase("idle"); }}>
                SETTINGS
              </button>
              <Link to="/casino/mini-games/leaderboard" className={styles.ovBtnSecondary}>
                EXIT
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
