import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import api from "../../utils/api";
import { startMinigameRun } from "../../utils/minigameRunSession";
import useMinigamePlaysLeft from "../../hooks/useMinigamePlaysLeft";
import { useMinigameCaptcha } from "../../hooks/useMinigameCaptcha";
import { toast } from "sonner";
import styles from "./WhackACopper.module.css";
import {
  DIFF_PRESETS,
  loadSettings,
  saveSettings,
  gridLayout,
  createEngine,
  startEngine,
  tick,
  whack,
  syncFromEngine,
  getGrade,
} from "./whackACopperEngine";

const CopSVG = () => (
  <svg width="56" height="72" viewBox="0 0 56 72" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <rect x="10" y="4" width="36" height="18" rx="4" fill="#1e3d7a" stroke="#0f2347" strokeWidth="1" />
    <rect x="8" y="20" width="40" height="7" rx="3" fill="#172f62" stroke="#0f2347" strokeWidth="1" />
    <rect x="10" y="20" width="36" height="3" fill="#c9a227" />
    <polygon points="28,7 29.8,12.5 35.5,12.5 31,15.8 32.8,21.3 28,18 23.2,21.3 25,15.8 20.5,12.5 26.2,12.5" fill="#d4a820" stroke="#8a6010" strokeWidth="0.5" />
    <ellipse cx="28" cy="42" rx="15" ry="18" fill="#c8845a" stroke="#9a5c30" strokeWidth="1.2" />
    <ellipse cx="22.5" cy="38" rx="4.5" ry="3.2" fill="white" />
    <ellipse cx="33.5" cy="38" rx="4.5" ry="3.2" fill="white" />
    <circle cx="22.5" cy="38" r="1.6" fill="#111" />
    <circle cx="33.5" cy="38" r="1.6" fill="#111" />
    <path d="M21 53 Q28 55.5 35 53" fill="none" stroke="#8a4822" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M8 66 Q8 76 10 84 L46 84 Q48 76 48 66 Q38 60 28 59 Q18 60 8 66Z" fill="#1e3d7a" stroke="#0f2347" strokeWidth="1" />
    <polygon points="28,64 30,70 36.5,70 31.5,73.5 33.5,79.5 28,76 22.5,79.5 24.5,73.5 19.5,70 26,70" fill="#d4a820" stroke="#8a6010" strokeWidth="0.6" />
  </svg>
);

const FX_EMOJIS = ["💥", "⭐", "👊", "💫", "✨"];

const Hole = ({ isUp, isBonked, isWarning, isHittable, flashType, hitBurst, ducking, onWhack }) => {
  const handlePointerDown = useCallback(
    (e) => {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      onWhack();
    },
    [onWhack]
  );

  const clipClass = [
    styles.holeClip,
    flashType === "hit" ? styles.holeClipHit : "",
    flashType === "miss" ? styles.holeClipMiss : "",
    isWarning ? styles.holeClipWarn : "",
    isHittable ? styles.holeClipReady : "",
    ducking ? styles.holeClipDuck : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div
        className={`${styles.hitPad} ${isHittable ? styles.hitPadReady : ""}`}
        onPointerDown={handlePointerDown}
        role="button"
        tabIndex={-1}
        aria-label={isHittable ? "Whack copper" : "Hole"}
      />
      <div className={styles.hole}>
        <div className={clipClass}>
          <div className={styles.holeBg} />
          {isWarning && <div className={styles.warnRing} aria-hidden />}
          {hitBurst && (
            <div className={styles.whackBurst} aria-hidden>
              <span className={styles.whackBurstStar} />
              <span className={styles.whackBurstStar} />
              <span className={styles.whackBurstStar} />
            </div>
          )}
          <div
            className={`${styles.copMover} ${isUp && !isBonked ? styles.copUp : ""} ${isBonked ? styles.copBonked : ""} ${isWarning && isUp && !isBonked ? styles.copPeek : ""}`}
          >
            <CopSVG />
          </div>
          {isBonked && <div className={styles.bonkLabel}>WHACK!</div>}
          <div className={styles.holeDirt} />
        </div>
        <div
          className={`${styles.holeBorder} ${flashType === "hit" ? styles.holeBorderHit : ""} ${isWarning ? styles.holeBorderWarn : ""} ${isHittable ? styles.holeBorderReady : ""}`}
        />
      </div>
    </>
  );
};

const SegControl = ({ options, value, onChange, disabled }) => (
  <div className={styles.seg}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        disabled={disabled}
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
  const { getCaptchaToken, captchaModal } = useMinigameCaptcha();
  const { playsLeft, maxPlays, canPlay, updateFromStart, refresh: refreshPlays, applyPlaysLeftPayload } =
    useMinigamePlaysLeft("whack_a_copper");

  const initial = useMemo(() => loadSettings(), []);
  const [settings, setSettings] = useState(initial);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [maxCombo, setMaxCombo] = useState(1);
  const [timeLeft, setTimeLeft] = useState(initial.duration);
  const [lives, setLives] = useState(initial.livesMode || 3);
  const [missCount, setMissCount] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [panic, setPanic] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [bestScore, setBestScore] = useState(0);
  const [holeStates, setHoleStates] = useState(() =>
    Array.from({ length: initial.gridSize }, () => ({
      up: false,
      bonked: false,
      warning: false,
      flash: null,
      escaped: false,
      hitBurst: false,
      ducking: false,
      hittable: false,
    }))
  );
  const [particles, setParticles] = useState([]);

  const engineRef = useRef(createEngine(initial));
  const submittedRef = useRef(false);
  const whackSessionRef = useRef(null);
  const rafRef = useRef(null);
  const lastFrameRef = useRef(0);

  const { cols, rows } = gridLayout(settings.gridSize);
  const gridSize = settings.gridSize;
  const livesMode = settings.livesMode;
  const duration = settings.duration;

  const persistSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const triggerShake = useCallback(() => {
    if (!settings.shakeEnabled) return;
    setShaking(true);
    setTimeout(() => setShaking(false), 280);
  }, [settings.shakeEnabled]);

  const applySync = useCallback((snap) => {
    setPhase(snap.phase);
    setScore(snap.score);
    setCombo(snap.combo);
    setMaxCombo(snap.maxCombo);
    setMissCount(snap.missCount);
    setLives(snap.lives);
    setTimeLeft(snap.timeLeft);
    setCountdown(snap.countdown);
    setPanic(snap.panic);
    setHoleStates(snap.holes);
    if (settings.fxEnabled) setParticles(snap.particles);
    else setParticles([]);
  }, [settings.fxEnabled]);

  const submitScore = useCallback(
    async (finalScore) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      try {
        const res = await api.post("/whack-a-copper/score", {
          score: finalScore,
          session_id: whackSessionRef.current,
        });
        if (res.data?.ok) {
          const estCash = finalScore >= 100 ? Math.min(5000, Math.floor(finalScore / 10)) : 0;
          if (estCash > 0) toast.success(`Score submitted! +$${estCash.toLocaleString()} cash`);
          else toast.success("Score submitted!");
        }
        if (res.data?.plays_left != null) applyPlaysLeftPayload(res.data);
        else refreshPlays();
      } catch (e) {
        toast.error(e.response?.data?.detail || "Failed to submit score");
        refreshPlays();
      } finally {
        submittedRef.current = false;
      }
    },
    [refreshPlays, applyPlaysLeftPayload]
  );

  const endGame = useCallback(() => {
    const engine = engineRef.current;
    engine.running = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setBestScore((b) => Math.max(b, engine.score));
    setPhase("over");
    submitScore(engine.score);
  }, [submitScore]);

  const gameLoop = useCallback(
    (now) => {
      const engine = engineRef.current;
      if (!engine.running) return;

      const last = lastFrameRef.current || now;
      const dt = Math.min(50, now - last);
      lastFrameRef.current = now;

      const result = tick(engine, dt, now);
      applySync(syncFromEngine(engine, now));

      if (result.miss) triggerShake();

      if (result.ended) {
        endGame();
        return;
      }

      rafRef.current = requestAnimationFrame(gameLoop);
    },
    [applySync, endGame, triggerShake]
  );

  const startGame = useCallback(async () => {
    if (!canPlay) {
      toast.error("Play limit reached for this 2-hour window.");
      return;
    }

    let captchaToken = null;
    try {
      captchaToken = await getCaptchaToken();
    } catch (c) {
      if (c?.message === "captcha_cancelled") return;
      throw c;
    }
    try {
      const run = await startMinigameRun("whack_a_copper", undefined, captchaToken);
      whackSessionRef.current = run.session_id;
      updateFromStart(run);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message || "Could not start run");
      return;
    }

    submittedRef.current = false;
    const engine = createEngine(settings);
    engineRef.current = engine;
    startEngine(engine, settings);
    setSettingsOpen(false);
    lastFrameRef.current = performance.now();
    applySync(syncFromEngine(engine, lastFrameRef.current));
    rafRef.current = requestAnimationFrame(gameLoop);
  }, [canPlay, settings, getCaptchaToken, updateFromStart, gameLoop, applySync]);

  const handleWhack = useCallback(
    (index) => {
      const now = performance.now();
      const engine = engineRef.current;
      const result = whack(engine, index, now);
      if (!result) return;
      applySync(syncFromEngine(engine, now));
      if (result.bigHit && settings.shakeEnabled) triggerShake();
    },
    [applySync, settings.shakeEnabled, triggerShake]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      engineRef.current.running = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const engine = engineRef.current;
      if (engine.phase !== "playing") return;
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;

      const keyMap9 = { "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 7, "9": 8 };
      const keyMap12 = { ...keyMap9, "0": 9, "-": 10, "=": 11 };
      const map = gridSize === 12 ? keyMap12 : keyMap9;
      if (map[e.key] != null) {
        e.preventDefault();
        handleWhack(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gridSize, handleWhack]);

  const comboBarPct = Math.min(((combo - 1) / 11) * 100, 100);
  const comboColor = combo >= 8 ? "#ff3333" : combo >= 5 ? "#ff8800" : combo >= 3 ? "#cc8800" : "#b8960c";
  const timerPct = duration > 0 ? (timeLeft / duration) * 100 : 0;
  const gradeInfo = getGrade(score);
  const displayMisses = livesMode > 0 ? "❤".repeat(Math.max(0, lives)) : String(missCount);
  const playing = phase === "playing" || phase === "countdown";
  const presetDesc = DIFF_PRESETS[settings.diff]?.label || "Medium";

  return (
    <div
      data-game="whack-a-copper"
      className={`${styles.root} mobile-page-root ${panic ? styles.rootPanic : ""} ${shaking ? styles.rootShake : ""}`}
    >
      {captchaModal}
      <div className={styles.header}>
        <Link to="/casino/mini-games/leaderboard" className="text-primary text-[9px] font-heading uppercase tracking-wider hover:underline block mb-1">
          ← Mini Games Leaderboard
        </Link>
        <div className={styles.wantedStamp}>WANTED</div>
        <h1 className={styles.title}>WHACK-A-COPPER</h1>
        <p className={styles.subtitle}>Tap fast — coppers duck when the ring flashes red</p>
        {playsLeft != null && (
          <p className={`${styles.playsLine} ${canPlay ? "" : styles.playsLineLimit}`}>
            {playsLeft}/{maxPlays} plays left
          </p>
        )}
      </div>

      <div className={styles.hud}>
        <div className={styles.hudCard}>
          <div className={styles.hudLabel}>Score</div>
          <div className={styles.hudVal}>{score}</div>
        </div>
        <div className={styles.hudCard}>
          <div className={styles.hudLabel}>Combo</div>
          <div className={styles.hudVal} style={{ color: comboColor }}>
            x{combo}
          </div>
        </div>
        <div className={styles.hudCard}>
          <div className={styles.hudLabel}>{livesMode > 0 ? "Lives" : "Escaped"}</div>
          <div className={`${styles.hudVal} ${styles.hudValDanger}`}>{displayMisses}</div>
        </div>
        <div className={styles.hudCard}>
          <div className={styles.hudLabel}>Time</div>
          <div className={`${styles.hudVal} ${timeLeft <= 10 ? styles.hudValUrgent : ""}`}>{playing ? timeLeft : duration}</div>
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
        type="button"
        className={`${styles.settingsBtn} ${settingsOpen ? styles.settingsBtnOpen : ""}`}
        onClick={() => setSettingsOpen((o) => !o)}
        disabled={playing}
      >
        SETTINGS
      </button>

      {settingsOpen && !playing && (
        <div className={styles.settingsPanel}>
          <div className={styles.settingsGrid}>
            <div className={styles.settingGroup}>
              <div className={styles.settingLabel}>Difficulty</div>
              <SegControl
                options={Object.values(DIFF_PRESETS).map((p) => ({ value: p.id, label: p.label }))}
                value={settings.diff}
                onChange={(v) => persistSettings({ diff: v })}
              />
            </div>
            <div className={styles.settingGroup}>
              <div className={styles.settingLabel}>Duration</div>
              <SegControl
                options={[
                  { value: 20, label: "20s" },
                  { value: 30, label: "30s" },
                  { value: 60, label: "60s" },
                ]}
                value={settings.duration}
                onChange={(v) => persistSettings({ duration: v })}
              />
            </div>
            <div className={styles.settingGroup}>
              <div className={styles.settingLabel}>Grid</div>
              <SegControl
                options={[
                  { value: 6, label: "2×3" },
                  { value: 9, label: "3×3" },
                  { value: 12, label: "3×4" },
                ]}
                value={settings.gridSize}
                onChange={(v) => persistSettings({ gridSize: v })}
              />
            </div>
            <div className={styles.settingGroup}>
              <div className={styles.settingLabel}>Lives</div>
              <SegControl
                options={[
                  { value: 0, label: "Off" },
                  { value: 3, label: "3" },
                  { value: 5, label: "5" },
                ]}
                value={settings.livesMode}
                onChange={(v) => persistSettings({ livesMode: v })}
              />
            </div>
          </div>
          <p className={styles.settingsHint}>{DIFF_PRESETS[settings.diff]?.label} — red ring = about to escape</p>
          <div className={styles.settingsDivider}>Visual</div>
          <div className={styles.settingsGrid}>
            {[
              ["Screen Shake", "shakeEnabled"],
              ["Hit FX", "fxEnabled"],
              ["Score Popups", "ptsEnabled"],
              ["Panic Mode", "panicEnabled"],
            ].map(([label, key]) => (
              <div key={key} className={styles.toggleRow}>
                <div className={styles.settingLabel}>{label}</div>
                <Toggle checked={settings[key]} onChange={(v) => persistSettings({ [key]: v })} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.gameArea} style={{ "--cols": cols, "--rows": rows }}>
        <div className={styles.boardFrame}>
        <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: gridSize }, (_, i) => {
            const hs = holeStates[i] || {};
            const isHittable = hs.hittable;
            return (
              <div key={i} className={`${styles.holeWrapper} ${isHittable ? styles.holeWrapperReady : ""}`}>
                <Hole
                  isUp={hs.up}
                  isBonked={hs.bonked}
                  isWarning={hs.warning}
                  isHittable={isHittable}
                  flashType={hs.flash}
                  hitBurst={hs.hitBurst}
                  ducking={hs.ducking}
                  onWhack={() => handleWhack(i)}
                />
                {hs.escaped && <div className={styles.escapedTxt}>ESCAPED!</div>}
                {settings.fxEnabled &&
                  particles
                    .filter((p) => p.holeIndex === i)
                    .map((p) => (
                      <div key={p.id} className={styles.particleWrap}>
                        <div className={styles.fxStar}>{FX_EMOJIS[(p.id + i) % FX_EMOJIS.length]}</div>
                        {p.kind === "hit" && <div className={styles.fxWhack}>WHACK</div>}
                        {p.pts != null && (
                          <div
                            className={styles.fxPts}
                            style={{
                              color: p.combo > 5 ? "#ff4444" : p.combo > 3 ? "#ffaa00" : "#d4a820",
                            }}
                          >
                            {p.combo > 1 ? `+${p.pts} x${p.combo}` : `+${p.pts}`}
                          </div>
                        )}
                      </div>
                    ))}
              </div>
            );
          })}
        </div>
        </div>

        {phase === "countdown" && (
          <div className={styles.countdownOverlay}>
            <div className={styles.countdownNum}>{countdown || "GO!"}</div>
          </div>
        )}

        {phase === "idle" && (
          <div className={styles.overlay}>
            <div className={styles.ovBox}>
              <div className={styles.ovTitle}>WHACK·A·COPPER</div>
              <div className={styles.ovMsg}>
                Coppers pop from the holes.
                <br />
                Whack on press — don&apos;t wait for release.
                <br />
                <span className={styles.ovHint}>Keys 1–9 whack holes on 3×3 (PC)</span>
              </div>
              <button type="button" className={styles.ovBtn} onClick={() => void startGame()} disabled={!canPlay}>
                {canPlay ? "TAKE THE JOB" : "LIMIT REACHED"}
              </button>
              <button type="button" className={styles.ovBtnSecondary} onClick={() => setSettingsOpen(true)}>
                SETTINGS ({presetDesc})
              </button>
              <Link to="/casino/mini-games/leaderboard" className={styles.ovBtnSecondary}>
                LEADERBOARD
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
              <button type="button" className={styles.ovBtn} onClick={() => void startGame()} disabled={!canPlay}>
                {canPlay ? "RUN IT AGAIN" : "LIMIT REACHED"}
              </button>
              <button
                type="button"
                className={styles.ovBtnSecondary}
                onClick={() => {
                  setPhase("idle");
                  setSettingsOpen(true);
                }}
              >
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
