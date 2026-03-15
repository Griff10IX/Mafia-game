import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { getApiErrorMessage } from "../../utils/api";
import styles from "../../styles/noir.module.css";

const STAT_KEYS = ["power", "speed", "defense", "stamina"];
const STAT_LABELS = { power: "PWR", speed: "SPD", defense: "DEF", stamina: "STA" };
const TABS = ["Fighter", "Fight", "Bets", "Rankings"];

const gold = "var(--noir-primary)";
const goldBright = "var(--noir-primary-bright)";

function StatBar({ label, value, max = 80, color = goldBright }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ width: 36, fontSize: 10, color: "var(--noir-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <div style={{ flex: 1, height: 7, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
      <span style={{ width: 26, textAlign: "right", fontSize: 11, color: "#e0d0a0" }}>{value}</span>
    </div>
  );
}

// ── Canvas fight replay ─────────────────────────────────────────────────────

function drawRing(ctx, W, H) {
  const cx = W / 2, cy = H * 0.52;
  const rw = W * 0.8, rh = H * 0.44;
  const rl = cx - rw / 2, rt = cy - rh / 2, rr = cx + rw / 2, rb = cy + rh / 2;

  ctx.fillStyle = "#0e0e14";
  ctx.fillRect(0, 0, W, rt - 2);

  ctx.fillStyle = "#2a2218";
  ctx.fillRect(rl, rt, rw, rh);
  ctx.fillStyle = "#352e20";
  ctx.fillRect(rl + 8, rt + 8, rw - 16, rh - 16);

  for (let i = 0; i < 3; i++) {
    const ry = rt + rh * (0.15 + i * 0.35);
    ctx.strokeStyle = i === 1 ? "rgba(201,168,76,0.5)" : "rgba(138,122,90,0.3)";
    ctx.lineWidth = i === 1 ? 2 : 1.5;
    ctx.beginPath(); ctx.moveTo(rl - 2, ry); ctx.lineTo(rr + 2, ry); ctx.stroke();
  }

  [[rl, rt], [rr, rt], [rl, rb], [rr, rb]].forEach(([x, y], i) => {
    ctx.fillStyle = i < 2 ? "#c9a84c" : "#aa3333";
    ctx.fillRect(x - 3, y - 3, 6, 6);
  });

  ctx.strokeStyle = "rgba(201,168,76,0.15)";
  ctx.lineWidth = 1;
  ctx.strokeRect(rl, rt, rw, rh);
  return { rl, rt, rr, rb, rw, rh, cx, cy };
}

function drawFighter(ctx, x, y, facing, anim, progress, color, gloveColor) {
  ctx.save();
  ctx.translate(x, y);
  const s = facing === "right" ? 1 : -1;
  ctx.scale(s, 1);

  const bob = Math.sin(performance.now() / 280) * 2;
  const isHit = anim === "hit";
  const isPunch = ["jab", "cross", "hook", "uppercut", "body"].includes(anim);
  const isDown = anim === "down" || anim === "ko";
  const hitShake = isHit ? Math.sin(progress * 20) * 3 : 0;

  if (isDown) {
    const fallProg = anim === "ko" ? 1 : Math.min(1, progress * 3);
    ctx.translate(0, 10 * fallProg);
    ctx.rotate(fallProg * (Math.PI / 2.5));
  }

  const bodyY = isHit ? bob + hitShake : bob;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-5, -24 + bodyY); ctx.lineTo(5, -24 + bodyY);
  ctx.quadraticCurveTo(8, -24 + bodyY, 8, -21 + bodyY);
  ctx.lineTo(8, 4 + bodyY);
  ctx.quadraticCurveTo(8, 7 + bodyY, 5, 7 + bodyY);
  ctx.lineTo(-5, 7 + bodyY);
  ctx.quadraticCurveTo(-8, 7 + bodyY, -8, 4 + bodyY);
  ctx.lineTo(-8, -21 + bodyY);
  ctx.quadraticCurveTo(-8, -24 + bodyY, -5, -24 + bodyY);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -32 + bodyY, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-4, 7 + bodyY); ctx.lineTo(-6, 22 + bodyY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, 7 + bodyY); ctx.lineTo(6, 22 + bodyY); ctx.stroke();

  if (isPunch && progress < 1) {
    const ext = Math.sin(progress * Math.PI);
    let gx = 12, gy = -20 + bodyY;
    if (anim === "jab") { gx = 12 + ext * 22; gy = -20 + bodyY; }
    else if (anim === "cross") { gx = 10 + ext * 26; gy = -18 + bodyY; }
    else if (anim === "hook") { gx = 10 + ext * 18; gy = -22 + bodyY - ext * 4; }
    else if (anim === "uppercut") { gx = 10 + ext * 14; gy = -18 + bodyY - ext * 16; }
    else if (anim === "body") { gx = 10 + ext * 20; gy = -8 + bodyY; }
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(6, -18 + bodyY); ctx.lineTo(gx, gy); ctx.stroke();
    ctx.fillStyle = gloveColor;
    ctx.beginPath(); ctx.arc(gx, gy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-4, -18 + bodyY); ctx.lineTo(-6, -26 + bodyY); ctx.stroke();
    ctx.fillStyle = gloveColor;
    ctx.beginPath(); ctx.arc(-6, -26 + bodyY, 3.5, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(6, -18 + bodyY); ctx.lineTo(10, -26 + bodyY); ctx.stroke();
    ctx.fillStyle = gloveColor;
    ctx.beginPath(); ctx.arc(10, -26 + bodyY, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-4, -18 + bodyY); ctx.lineTo(-2, -28 + bodyY); ctx.stroke();
    ctx.fillStyle = gloveColor;
    ctx.beginPath(); ctx.arc(-2, -28 + bodyY, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  if (isHit && progress < 0.3) {
    ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - progress / 0.3)})`;
    ctx.beginPath(); ctx.arc(0, -20 + bodyY, 14, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

function drawBars(ctx, W, H, hpA, hpB, stamA, stamB, round, nameA, nameB) {
  const barW = W * 0.32, barH = 6, gap = 10, y = H - 28;

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(gap, y, barW, barH);
  ctx.fillStyle = hpA > 30 ? "#c9a84c" : "#cc4444";
  ctx.fillRect(gap, y, barW * Math.max(0, hpA / 100), barH);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(gap, y + barH + 2, barW, 3);
  ctx.fillStyle = "#3a8aaa";
  ctx.fillRect(gap, y + barH + 2, barW * Math.max(0, stamA / 100), 3);
  ctx.fillStyle = "#c9a84c"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "left";
  ctx.fillText(nameA, gap, y - 4);

  const rx = W - gap - barW;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(rx, y, barW, barH);
  ctx.fillStyle = hpB > 30 ? "#bb3333" : "#cc4444";
  ctx.fillRect(rx + barW * (1 - Math.max(0, hpB / 100)), y, barW * Math.max(0, hpB / 100), barH);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(rx, y + barH + 2, barW, 3);
  ctx.fillStyle = "#3a8aaa";
  ctx.fillRect(rx + barW * (1 - Math.max(0, stamB / 100)), y + barH + 2, barW * Math.max(0, stamB / 100), 3);
  ctx.fillStyle = "#bb3333"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "right";
  ctx.fillText(nameB, W - gap, y - 4);

  ctx.fillStyle = "#c9a84c"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`R${round}/12`, W / 2, y + 4);
}

// ── Fight Replay Modal ──────────────────────────────────────────────────────

function FightReplay({ fight, onClose }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const stateRef = useRef(null);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  const [commentary, setCommentary] = useState([]);
  const [finished, setFinished] = useState(false);
  const commentEndRef = useRef(null);

  useEffect(() => { speedRef.current = speed; }, [speed]);

  const nameA = fight?.a_username || "Fighter A";
  const nameB = fight?.b_username || "Fighter B";
  const rounds = fight?.rounds || [];

  useEffect(() => {
    if (!fight || !rounds.length) return;

    const allEvents = [];
    for (const r of rounds) {
      allEvents.push({ type: "roundStart", round: r.round });
      for (const ex of (r.exchanges || [])) {
        allEvents.push({ type: "exchange", round: r.round, ...ex });
      }
      allEvents.push({ type: "roundEnd", round: r.round, hp: r.hp, stam: r.stam, kds: r.kds, dmg: r.dmg });
    }

    stateRef.current = {
      eventIndex: 0, events: allEvents,
      hpA: 100, hpB: 100, stamA: 100, stamB: 100, round: 1,
      fighterA: { anim: "idle", start: 0 },
      fighterB: { anim: "idle", start: 0 },
      lastEventTime: performance.now(), eventDelay: 400,
      done: false,
    };
    setCommentary([]);
    setFinished(false);

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) { animRef.current = requestAnimationFrame(render); return; }
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      const now = performance.now();
      const st = stateRef.current;
      if (!st) { animRef.current = requestAnimationFrame(render); return; }

      const delay = st.eventDelay / speedRef.current;
      if (!st.done && now - st.lastEventTime >= delay && st.eventIndex < st.events.length) {
        const ev = st.events[st.eventIndex];
        st.eventIndex++;
        st.lastEventTime = now;

        if (ev.type === "roundStart") {
          st.round = ev.round;
          st.eventDelay = 600;
          setCommentary(c => [...c, { text: `── Round ${ev.round} ──`, type: "round" }]);
        } else if (ev.type === "exchange") {
          const isA = ev.side === "a";
          const attackerName = isA ? nameA : nameB;
          const defenderName = isA ? nameB : nameA;
          if (ev.landed) {
            if (isA) {
              st.fighterA = { anim: ev.punch, start: now };
              st.fighterB = { anim: "hit", start: now };
            } else {
              st.fighterB = { anim: ev.punch, start: now };
              st.fighterA = { anim: "hit", start: now };
            }
            let line = `${attackerName} lands a ${ev.punch} for ${ev.dmg} dmg`;
            let type = "hit";
            if (ev.knockdown) {
              line += ` — ${defenderName} is DOWN!`;
              type = "knockdown";
              if (isA) st.fighterB = { anim: "down", start: now };
              else st.fighterA = { anim: "down", start: now };
            }
            setCommentary(c => [...c, { text: line, type }]);
          } else {
            if (isA) st.fighterA = { anim: ev.punch, start: now };
            else st.fighterB = { anim: ev.punch, start: now };
            setCommentary(c => [...c, { text: `${attackerName} throws a ${ev.punch} — misses`, type: "miss" }]);
          }
          st.eventDelay = ev.knockdown ? 800 : 300;
        } else if (ev.type === "roundEnd") {
          st.hpA = ev.hp?.a ?? st.hpA;
          st.hpB = ev.hp?.b ?? st.hpB;
          st.stamA = ev.stam?.a ?? st.stamA;
          st.stamB = ev.stam?.b ?? st.stamB;
          setCommentary(c => [...c, {
            text: `End R${ev.round}: ${nameA} HP ${ev.hp?.a ?? "?"} | ${nameB} HP ${ev.hp?.b ?? "?"}`,
            type: "roundEnd",
          }]);
          st.eventDelay = 800;
        }

        if (st.eventIndex >= st.events.length) {
          st.done = true;
          const w = fight.winner_side;
          const winnerName = w === "a" ? nameA : w === "b" ? nameB : null;
          const reason = (fight.reason || "decision").replace(/_/g, " ");
          if (w === "a") st.fighterB = { anim: "ko", start: now };
          else if (w === "b") st.fighterA = { anim: "ko", start: now };
          setCommentary(c => [...c, {
            text: winnerName ? `${winnerName} wins by ${reason}!` : `Fight ends: ${reason}`,
            type: "result",
          }]);
          setFinished(true);
        }
      }

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#12121a";
      ctx.fillRect(0, 0, W, H);

      const ring = drawRing(ctx, W, H);
      const fAx = ring.rl + ring.rw * 0.38;
      const fBx = ring.rl + ring.rw * 0.62;
      const fY = ring.rt + ring.rh * 0.55;

      const punchDur = 300;
      const downDur = 1500;
      const koDur = 99999;

      const durA = st.fighterA.anim === "ko" ? koDur : st.fighterA.anim === "down" ? downDur : punchDur;
      const durB = st.fighterB.anim === "ko" ? koDur : st.fighterB.anim === "down" ? downDur : punchDur;
      const progA = st.fighterA.start ? Math.min(1, (now - st.fighterA.start) / durA) : 1;
      const progB = st.fighterB.start ? Math.min(1, (now - st.fighterB.start) / durB) : 1;
      const animA = progA >= 1 && st.fighterA.anim !== "ko" ? "idle" : st.fighterA.anim;
      const animB = progB >= 1 && st.fighterB.anim !== "ko" ? "idle" : st.fighterB.anim;

      drawFighter(ctx, fAx, fY, "right", animA, progA, "rgba(180,155,90,0.85)", "#d4a832");
      drawFighter(ctx, fBx, fY, "left", animB, progB, "rgba(180,60,50,0.85)", "#cc3333");
      drawBars(ctx, W, H, st.hpA, st.hpB, st.stamA, st.stamB, st.round, nameA, nameB);

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fight]);

  useEffect(() => {
    commentEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [commentary]);

  const skipToEnd = () => {
    const st = stateRef.current;
    if (!st) return;
    st.eventIndex = st.events.length;
    st.done = true;

    const lastRound = rounds[rounds.length - 1];
    if (lastRound) {
      st.hpA = lastRound.hp?.a ?? 0;
      st.hpB = lastRound.hp?.b ?? 0;
      st.stamA = lastRound.stam?.a ?? 0;
      st.stamB = lastRound.stam?.b ?? 0;
      st.round = lastRound.round;
    }
    const w = fight.winner_side;
    if (w === "a") st.fighterB = { anim: "ko", start: performance.now() };
    else if (w === "b") st.fighterA = { anim: "ko", start: performance.now() };

    const lines = [];
    for (const r of rounds) {
      lines.push({ text: `── Round ${r.round} ──`, type: "round" });
      lines.push({ text: `${nameA}: ${r.dmg?.a ?? 0} dmg | ${nameB}: ${r.dmg?.b ?? 0} dmg`, type: "roundEnd" });
    }
    const winnerName = w === "a" ? nameA : w === "b" ? nameB : null;
    const reason = (fight.reason || "decision").replace(/_/g, " ");
    lines.push({ text: winnerName ? `${winnerName} wins by ${reason}!` : `Fight ends: ${reason}`, type: "result" });
    setCommentary(lines);
    setFinished(true);
  };

  const fightStats = fight?.fight_stats;
  const scorecard = fight?.scorecard;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.95)", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 shrink-0" style={{ borderBottom: "1px solid rgba(201,168,76,0.2)" }}>
        <button onClick={onClose} className={styles.btnPrimary} style={{ padding: "10px 16px", minHeight: 44, fontSize: 11 }}>Close</button>
        <div className="text-xs sm:text-sm truncate px-2" style={{ color: gold, letterSpacing: "0.1em" }}>{nameA} vs {nameB}</div>
        <div className="flex gap-1.5">
          {[1, 2, 4].map(s => (
            <button key={s} onClick={() => setSpeed(s)} className="touch-manipulation active:scale-95" style={{
              padding: "8px 12px", minHeight: 44, minWidth: 44, fontSize: 11, border: "1px solid rgba(201,168,76,0.4)", borderRadius: 3,
              background: speed === s ? "rgba(201,168,76,0.25)" : "rgba(255,255,255,0.03)",
              color: speed === s ? "#f0e0b0" : "#8a7a5a", cursor: "pointer",
            }}>x{s}</button>
          ))}
          {!finished && <button onClick={skipToEnd} className="touch-manipulation active:scale-95" style={{ padding: "8px 12px", minHeight: 44, fontSize: 11, border: "1px solid rgba(201,168,76,0.4)", borderRadius: 3, background: "rgba(255,255,255,0.03)", color: "#8a7a5a", cursor: "pointer" }}>Skip</button>}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ position: "relative", width: "100%", maxWidth: 720, margin: "0 auto", aspectRatio: "16/9", flexShrink: 0 }}>
          <canvas ref={canvasRef} width={640} height={360} style={{ width: "100%", height: "100%", display: "block" }} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-2 min-h-0" style={{ fontSize: 11, lineHeight: 1.7, color: "#e0d0b0", textAlign: "center", maxWidth: 720, margin: "0 auto", width: "100%" }}>
          {commentary.map((c, i) => (
            <div key={i} style={{
              marginBottom: c.type === "round" ? 8 : 2,
              fontWeight: c.type === "round" || c.type === "result" ? 700 : 400,
              color: c.type === "round" ? gold : c.type === "knockdown" ? "#ff6666" : c.type === "result" ? gold : c.type === "miss" ? "#7a6a5a" : c.type === "roundEnd" ? "#aa9a6a" : "#c8b898",
              fontSize: c.type === "round" || c.type === "result" ? 12 : 11,
            }}>{c.text}</div>
          ))}
          <div ref={commentEndRef} />
        </div>

        {finished && fightStats && (
          <div className="shrink-0 px-3 sm:px-4 py-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", borderTop: "1px solid rgba(201,168,76,0.2)", background: "rgba(0,0,0,0.6)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "6px 8px", fontSize: 11, color: "#d0c090", maxWidth: 400, margin: "0 auto" }}>
              <div style={{ textAlign: "right" }}>{fightStats.a?.landed}</div>
              <div style={{ textAlign: "center", color: "#7a6a4a" }}>Landed</div>
              <div>{fightStats.b?.landed}</div>
              <div style={{ textAlign: "right" }}>{fightStats.a?.dmg}</div>
              <div style={{ textAlign: "center", color: "#7a6a4a" }}>Total Dmg</div>
              <div>{fightStats.b?.dmg}</div>
              <div style={{ textAlign: "right" }}>{fightStats.a?.kds}</div>
              <div style={{ textAlign: "center", color: "#7a6a4a" }}>Knockdowns</div>
              <div>{fightStats.b?.kds}</div>
            </div>
            {scorecard && scorecard.a?.length > 0 && (
              <div style={{ marginTop: 8, maxWidth: 400, margin: "8px auto 0" }}>
                <div style={{ fontSize: 10, color: "#7a6a4a", textAlign: "center", marginBottom: 3 }}>Scorecard</div>
                <div style={{ display: "flex", justifyContent: "center", gap: 4, flexWrap: "wrap", fontSize: 10 }}>
                  {scorecard.a.map((sa, ri) => (
                    <div key={ri} style={{ textAlign: "center", padding: "3px 5px", background: "rgba(255,255,255,0.03)", borderRadius: 2, minWidth: 30 }}>
                      <div style={{ color: "#7a6a4a" }}>R{ri + 1}</div>
                      <div style={{ color: sa > scorecard.b[ri] ? gold : sa < scorecard.b[ri] ? "#bb3333" : "#888" }}>{sa}-{scorecard.b[ri]}</div>
                    </div>
                  ))}
                </div>
                <div style={{ textAlign: "center", fontSize: 11, color: gold, marginTop: 4 }}>
                  {scorecard.a.reduce((s, v) => s + v, 0)} - {scorecard.b.reduce((s, v) => s + v, 0)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function Boxing() {
  const { matchId: fightIdParam } = useParams();
  const navigate = useNavigate();

  const [tab, setTab] = useState(0);
  const [profile, setProfile] = useState(null);
  const [trainCosts, setTrainCosts] = useState({});
  const [npcs, setNpcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const [challenges, setChallenges] = useState({ incoming: [], outgoing: [] });
  const [challengeTarget, setChallengeTarget] = useState("");
  const [betsData, setBetsData] = useState({ open: [], settled: [] });
  const [betStake, setBetStake] = useState(10000);
  const [leaderboard, setLeaderboard] = useState(null);
  const [history, setHistory] = useState([]);
  const [pendingForBets, setPendingForBets] = useState([]);

  const [replayFight, setReplayFight] = useState(null);

  const err = (e) => getApiErrorMessage(e);

  const loadProfile = useCallback(async () => {
    try {
      const res = await api.get("/boxing/me");
      setProfile(res.data?.profile || null);
      setTrainCosts(res.data?.train_costs || {});
      setNpcs(res.data?.npcs || []);
    } catch (e) {
      setError(err(e));
    }
  }, []);

  const loadChallenges = useCallback(async () => {
    try {
      const res = await api.get("/boxing/challenges");
      setChallenges({ incoming: res.data?.incoming || [], outgoing: res.data?.outgoing || [] });
    } catch {}
  }, []);

  const loadBets = useCallback(async () => {
    try {
      const res = await api.get("/boxing/bets");
      setBetsData({ open: res.data?.open || [], settled: res.data?.settled || [] });
    } catch {}
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await api.get("/boxing/leaderboard?period=weekly");
      setLeaderboard(res.data || null);
    } catch {}
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get("/boxing/history");
      setHistory(res.data?.history || []);
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      try {
        const [profRes, chRes, betsRes, lbRes, histRes] = await Promise.all([
          api.get("/boxing/me"),
          api.get("/boxing/challenges"),
          api.get("/boxing/bets"),
          api.get("/boxing/leaderboard?period=weekly"),
          api.get("/boxing/history"),
        ]);
        if (cancelled) return;
        setProfile(profRes.data?.profile || null);
        setTrainCosts(profRes.data?.train_costs || {});
        setNpcs(profRes.data?.npcs || []);
        setChallenges({ incoming: chRes.data?.incoming || [], outgoing: chRes.data?.outgoing || [] });
        setBetsData({ open: betsRes.data?.open || [], settled: betsRes.data?.settled || [] });
        setLeaderboard(lbRes.data || null);
        setHistory(histRes.data?.history || []);
      } catch (e) {
        if (!cancelled) setError(err(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!fightIdParam) return;
    api.get(`/boxing/fight/${fightIdParam}`).then(r => {
      if (r.data?.fight) setReplayFight(r.data.fight);
    }).catch(() => {});
  }, [fightIdParam]);

  const handleTrain = async (stat) => {
    setBusy(`train:${stat}`);
    setError("");
    try {
      const res = await api.post("/boxing/train", { stat });
      setProfile(res.data?.profile || null);
      setTrainCosts(res.data?.train_costs || {});
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy("");
    }
  };

  const handleAllocate = async (stat) => {
    setBusy(`alloc:${stat}`);
    setError("");
    try {
      const res = await api.post("/boxing/allocate", { stat });
      setProfile(res.data?.profile || null);
      await loadProfile();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy("");
    }
  };

  const handleFightNpc = async (npcId) => {
    setBusy(`npc:${npcId}`);
    setError("");
    try {
      const res = await api.post("/boxing/fight/npc", { npc_id: npcId });
      setProfile(res.data?.profile || null);
      if (res.data?.fight) setReplayFight(res.data.fight);
      loadHistory();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy("");
    }
  };

  const handleChallenge = async () => {
    const name = challengeTarget.trim();
    if (!name) return;
    setBusy("challenge");
    setError("");
    try {
      await api.post("/boxing/fight/challenge", { opponent_username: name });
      setChallengeTarget("");
      loadChallenges();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy("");
    }
  };

  const handleAccept = async (cid) => {
    setBusy(`accept:${cid}`);
    setError("");
    try {
      const res = await api.post("/boxing/fight/accept", { challenge_id: cid });
      setProfile(res.data?.profile || null);
      if (res.data?.fight) setReplayFight(res.data.fight);
      loadChallenges();
      loadHistory();
      loadBets();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy("");
    }
  };

  const handleCancelChallenge = async (cid) => {
    setBusy(`cancel:${cid}`);
    try {
      await api.post("/boxing/fight/cancel", { challenge_id: cid });
      loadChallenges();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy("");
    }
  };

  const handlePlaceBet = async (challengeId, fighter) => {
    setBusy(`bet:${challengeId}:${fighter}`);
    setError("");
    try {
      await api.post("/boxing/bet", { challenge_id: challengeId, fighter, stake: Number(betStake) || 0 });
      loadBets();
      loadChallenges();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy("");
    }
  };

  const xpNext = profile ? (function () {
    const lvl = (profile.level || 1) + 1;
    return lvl <= 50 ? 100 * lvl * (lvl + 1) / 2 : null;
  })() : null;
  const xpPct = profile && xpNext ? Math.min(100, ((profile.xp || 0) / xpNext) * 100) : 0;

  const closeReplay = () => {
    setReplayFight(null);
    if (fightIdParam) navigate("/casino/mini-games/boxing");
  };

  if (replayFight) {
    return <FightReplay fight={replayFight} onClose={closeReplay} />;
  }

  const panelCls = `${styles.panel} rounded-lg overflow-hidden border border-primary/20`;
  const headerCls = "px-3 py-2 bg-primary/5 border-b border-primary/20";

  return (
    <div className={styles.page} style={{ minHeight: "100vh", fontFamily: "'Cinzel', serif" }}>
      <div className={styles.pageContent} style={{ padding: "14px 16px", borderBottom: "1px solid var(--noir-border-light)" }}>
        <div className="text-sm sm:text-base" style={{ letterSpacing: "0.2em", color: gold }}>THE UNDERGROUND RING</div>
        <div style={{ fontSize: 10, color: "var(--noir-muted)", letterSpacing: "0.12em", marginTop: 2 }}>TRAIN &bull; FIGHT &bull; BET &bull; DOMINATE</div>
      </div>

      {/* Tab bar */}
      <div className={styles.pageContent} style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--noir-border-light)" }}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className="touch-manipulation active:scale-95 transition-transform" style={{
            flex: 1, padding: "12px 0", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            background: tab === i ? "rgba(201,168,76,0.1)" : "transparent",
            color: tab === i ? "#f0e0b0" : "var(--noir-muted)",
            border: "none", borderBottom: tab === i ? "2px solid #c9a84c" : "2px solid transparent",
            cursor: "pointer", fontFamily: "inherit", minHeight: 44,
          }}>{t}</button>
        ))}
      </div>

      <div className={styles.pageContent} style={{ padding: "14px 12px" }}>
        {error && <div style={{ fontSize: 11, color: "#ff6666", marginBottom: 10, padding: "8px 12px", background: "rgba(255,60,60,0.08)", borderRadius: 4 }}>{error}</div>}

        {loading && !profile && <div style={{ textAlign: "center", padding: 30, color: "var(--noir-muted)", fontSize: 12 }}>Loading fighter profile...</div>}

        {/* ── TAB 0: FIGHTER ── */}
        {tab === 0 && profile && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {/* Fighter Card */}
            <div className={panelCls}>
              <div className={headerCls}>
                <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Your Fighter</h2>
              </div>
              <div className="p-3 sm:p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div style={{ fontSize: 13, color: "#e0d0a0", fontWeight: 700 }}>Rating {profile.rating || 1000}</div>
                    <div style={{ fontSize: 10, color: "var(--noir-muted)" }}>Level {profile.level || 1}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, color: "#e0d0a0" }}>
                      {profile.wins || 0}W - {profile.losses || 0}L - {profile.draws || 0}D
                    </div>
                    <div style={{ fontSize: 10, color: "var(--noir-muted)" }}>
                      Streak: {profile.streak || 0} | Best: {profile.best_streak || 0} | KOs: {profile.ko_wins || 0}
                    </div>
                  </div>
                </div>

                {/* XP bar */}
                {xpNext && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--noir-muted)", marginBottom: 3 }}>
                      <span>XP</span>
                      <span>{profile.xp || 0} / {xpNext}</span>
                    </div>
                    <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${xpPct}%`, height: "100%", background: "linear-gradient(90deg, #c9a84c, #e8d080)", borderRadius: 3 }} />
                    </div>
                  </div>
                )}

                {STAT_KEYS.map(k => (
                  <StatBar key={k} label={STAT_LABELS[k]} value={profile[k] || 10} />
                ))}

                <div style={{ fontSize: 10, color: "var(--noir-muted)", marginTop: 10 }}>
                  Total earnings: ${(profile.total_earnings || 0).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Training + Allocation */}
            <div className="flex flex-col gap-3 md:gap-4">
              {/* Stat Points */}
              {(profile.stat_points || 0) > 0 && (
                <div className={panelCls}>
                  <div className={headerCls}>
                    <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">
                      Allocate Points ({profile.stat_points})
                    </h2>
                  </div>
                  <div className="p-3 flex flex-wrap gap-2">
                    {STAT_KEYS.map(k => (
                      <button key={k} onClick={() => handleAllocate(k)} disabled={busy === `alloc:${k}`}
                        className={`${styles.btnPrimary} touch-manipulation active:scale-95`}
                        style={{ padding: "10px 16px", minHeight: 44, fontSize: 11, cursor: busy === `alloc:${k}` ? "wait" : "pointer" }}>
                        +1 {STAT_LABELS[k]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Training */}
              <div className={panelCls}>
                <div className={headerCls}>
                  <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Training</h2>
                </div>
                <div className="p-3 sm:p-4">
                  <div style={{ fontSize: 10, color: "var(--noir-muted)", marginBottom: 10 }}>Spend cash to train stats. Cost scales with level.</div>
                  <div className="flex flex-col gap-2">
                    {STAT_KEYS.map(k => {
                      const cost = trainCosts[k] || 0;
                      const atMax = (profile[k] || 10) >= 80;
                      return (
                        <div key={k} className="flex items-center justify-between rounded" style={{ padding: "10px 12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(201,168,76,0.15)" }}>
                          <div>
                            <span style={{ fontSize: 11, color: "#e0d0a0", textTransform: "uppercase" }}>{STAT_LABELS[k]}</span>
                            <span style={{ fontSize: 10, color: "var(--noir-muted)", marginLeft: 8 }}>{profile[k] || 10}/80</span>
                          </div>
                          <button onClick={() => handleTrain(k)}
                            disabled={busy === `train:${k}` || atMax}
                            className={`${styles.btnPrimary} touch-manipulation active:scale-95`}
                            style={{ padding: "8px 14px", minHeight: 44, fontSize: 10, cursor: atMax ? "default" : busy === `train:${k}` ? "wait" : "pointer" }}>
                            {atMax ? "MAX" : `Train $${cost.toLocaleString()}`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Fight History */}
              {history.length > 0 && (
                <div className={panelCls}>
                  <div className={headerCls}>
                    <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Recent Fights</h2>
                  </div>
                  <div className="p-3" style={{ maxHeight: 200, overflowY: "auto" }}>
                    {history.slice(0, 8).map(h => (
                      <div key={h.fight_id} className="flex justify-between py-1.5" style={{ borderBottom: "1px solid rgba(201,168,76,0.08)", fontSize: 10 }}>
                        <span style={{ color: h.result === "win" ? "#6a9a4a" : h.result === "loss" ? "#aa4444" : "#888" }}>
                          {h.result.toUpperCase()} vs {h.opponent}
                        </span>
                        <span style={{ color: "var(--noir-muted)" }}>
                          R{h.rounds} {h.reason}{h.reward > 0 ? ` +$${h.reward.toLocaleString()}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 1: FIGHT ── */}
        {tab === 1 && profile && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {/* NPC Opponents */}
            <div className={panelCls}>
              <div className={headerCls}>
                <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Underground Opponents</h2>
              </div>
              <div className="p-3 flex flex-col gap-2" style={{ maxHeight: 600, overflowY: "auto" }}>
                {npcs.map(npc => (
                  <div key={npc.id} className="flex items-center justify-between rounded" style={{ padding: "10px 12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(201,168,76,0.12)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#e0d0a0", fontWeight: 700 }}>{npc.name}</div>
                      <div style={{ fontSize: 9, color: "var(--noir-muted)", marginTop: 1, fontStyle: "italic" }}>{npc.flavor}</div>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1" style={{ fontSize: 10, color: "#9a8a5a" }}>
                        <span>PWR {npc.power}</span>
                        <span>SPD {npc.speed}</span>
                        <span>DEF {npc.defense}</span>
                        <span>STA {npc.stamina}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 10 }}>
                      <div style={{ fontSize: 10, color: "#6a9a4a", marginBottom: 4 }}>${npc.reward.toLocaleString()}</div>
                      <button onClick={() => handleFightNpc(npc.id)}
                        disabled={busy === `npc:${npc.id}`}
                        className={`${styles.btnPrimary} touch-manipulation active:scale-95`}
                        style={{ padding: "10px 18px", minHeight: 44, fontSize: 11, cursor: busy === `npc:${npc.id}` ? "wait" : "pointer" }}>
                        Fight
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* PvP Challenges */}
            <div className="flex flex-col gap-3 md:gap-4">
              <div className={panelCls}>
                <div className={headerCls}>
                  <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">PvP Challenge</h2>
                </div>
                <div className="p-3 sm:p-4">
                  <div className="flex gap-2 mb-3">
                    <input value={challengeTarget} onChange={e => setChallengeTarget(e.target.value)}
                      placeholder="Username" className={styles.input}
                      style={{ flex: 1, minHeight: 44, padding: "10px 12px", fontSize: 11 }}
                      onKeyDown={e => e.key === "Enter" && handleChallenge()} />
                    <button onClick={handleChallenge} disabled={busy === "challenge" || !challengeTarget.trim()}
                      className={`${styles.btnPrimary} touch-manipulation active:scale-95`}
                      style={{ padding: "10px 16px", minHeight: 44, fontSize: 11, cursor: busy === "challenge" ? "wait" : "pointer" }}>
                      Challenge
                    </button>
                  </div>

                  {challenges.incoming.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 10, color: gold, marginBottom: 6, letterSpacing: "0.1em" }}>INCOMING CHALLENGES</div>
                      {challenges.incoming.map(ch => (
                        <div key={ch.id} className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid rgba(201,168,76,0.08)" }}>
                          <span style={{ fontSize: 11, color: "#e0d0a0" }}>{ch.challenger_username}</span>
                          <button onClick={() => handleAccept(ch.id)}
                            disabled={busy === `accept:${ch.id}`}
                            className={`${styles.btnPrimary} touch-manipulation active:scale-95`}
                            style={{ padding: "8px 14px", minHeight: 44, fontSize: 10, cursor: busy === `accept:${ch.id}` ? "wait" : "pointer" }}>
                            Accept
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {challenges.outgoing.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: "var(--noir-muted)", marginBottom: 6, letterSpacing: "0.1em" }}>OUTGOING CHALLENGES</div>
                      {challenges.outgoing.map(ch => (
                        <div key={ch.id} className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid rgba(201,168,76,0.08)" }}>
                          <span style={{ fontSize: 11, color: "#d0c090" }}>vs {ch.target_username}</span>
                          <button onClick={() => handleCancelChallenge(ch.id)}
                            disabled={busy === `cancel:${ch.id}`}
                            className="touch-manipulation active:scale-95"
                            style={{ padding: "8px 14px", minHeight: 44, fontSize: 10, border: "1px solid rgba(201,168,76,0.3)", borderRadius: 3, background: "rgba(255,255,255,0.03)", color: "#aa7744", cursor: "pointer" }}>
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {challenges.incoming.length === 0 && challenges.outgoing.length === 0 && (
                    <div style={{ fontSize: 10, color: "#7a6a4a", textAlign: "center", padding: 12 }}>No active challenges</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: BETS ── */}
        {tab === 2 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <div className={panelCls}>
              <div className={headerCls}>
                <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Open Fights to Bet On</h2>
              </div>
              <div className="p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span style={{ fontSize: 10, color: "var(--noir-muted)" }}>Stake</span>
                  <input type="number" value={betStake} onChange={e => setBetStake(e.target.value)}
                    className={styles.input} style={{ width: 110, padding: "8px 10px", fontSize: 11, minHeight: 44 }} />
                </div>
                {challenges.incoming.length === 0 && challenges.outgoing.length === 0 && (
                  <div style={{ fontSize: 10, color: "#7a6a4a", textAlign: "center", padding: 12 }}>No pending challenges to bet on</div>
                )}
                {[...challenges.incoming, ...challenges.outgoing].map(ch => (
                  <div key={`bet-${ch.id}`} className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid rgba(201,168,76,0.08)" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#d0c090" }}>{ch.challenger_username} vs {ch.target_username}</div>
                      <div style={{ fontSize: 10, color: "#7a6a4a" }}>Odds: A {ch.odds?.a ?? "-"} / B {ch.odds?.b ?? "-"}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => handlePlaceBet(ch.id, "a")}
                        disabled={!!busy}
                        className={`${styles.btnPrimary} touch-manipulation active:scale-95`}
                        style={{ padding: "8px 12px", minHeight: 44, fontSize: 10 }}>
                        Bet A
                      </button>
                      <button onClick={() => handlePlaceBet(ch.id, "b")}
                        disabled={!!busy}
                        className={`${styles.btnPrimary} touch-manipulation active:scale-95`}
                        style={{ padding: "8px 12px", minHeight: 44, fontSize: 10 }}>
                        Bet B
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={panelCls}>
              <div className={headerCls}>
                <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Your Bets</h2>
              </div>
              <div className="p-3 sm:p-4" style={{ maxHeight: 360, overflowY: "auto" }}>
                {betsData.open.length === 0 && betsData.settled.length === 0 && (
                  <div style={{ fontSize: 10, color: "#7a6a4a", textAlign: "center", padding: 12 }}>No bets yet</div>
                )}
                {betsData.open.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, color: gold, marginBottom: 6 }}>OPEN</div>
                    {betsData.open.map(b => (
                      <div key={b.id} className="flex justify-between py-1.5" style={{ fontSize: 10, borderBottom: "1px solid rgba(201,168,76,0.06)" }}>
                        <span style={{ color: "#d0c090" }}>{b.challenger_username} vs {b.target_username} ({b.fighter.toUpperCase()})</span>
                        <span style={{ color: "var(--noir-muted)" }}>${b.stake?.toLocaleString()} @ {b.odds}x</span>
                      </div>
                    ))}
                  </>
                )}
                {betsData.settled.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, color: "var(--noir-muted)", marginTop: 10, marginBottom: 6 }}>SETTLED</div>
                    {betsData.settled.slice(0, 15).map(b => (
                      <div key={b.id} className="flex justify-between py-1.5" style={{ fontSize: 10, borderBottom: "1px solid rgba(201,168,76,0.06)" }}>
                        <span style={{ color: "#d0c090" }}>{b.fighter.toUpperCase()}</span>
                        <span style={{ color: b.status === "won" ? "#6a9a4a" : b.status === "lost" ? "#aa4444" : "var(--noir-muted)" }}>
                          {b.status} ${b.stake?.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: RANKINGS ── */}
        {tab === 3 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <div className={panelCls}>
              <div className={headerCls}>
                <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Weekly Leaderboard</h2>
              </div>
              <div className="p-3 sm:p-4">
                {!leaderboard && <div style={{ fontSize: 10, color: "#7a6a4a", textAlign: "center", padding: 12 }}>No data yet</div>}
                {leaderboard?.standings?.slice(0, 15).map(row => (
                  <div key={row.user_id} className="flex justify-between py-1.5" style={{
                    borderBottom: "1px solid rgba(201,168,76,0.08)",
                    color: row.is_current_user ? "#f5e8c8" : "#d0c090", fontSize: 11,
                  }}>
                    <span>
                      <span style={{ color: row.rank <= 3 ? gold : "var(--noir-muted)", fontWeight: row.rank <= 3 ? 700 : 400, marginRight: 6 }}>#{row.rank}</span>
                      {row.username}
                    </span>
                    <span>{row.points} pts &bull; {row.wins}W-{row.losses}L</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={panelCls}>
              <div className={headerCls}>
                <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">League Info</h2>
              </div>
              <div className="p-3 sm:p-4" style={{ fontSize: 11, color: "var(--noir-muted)", lineHeight: 1.9 }}>
                <div><strong style={{ color: "#e0d0a0" }}>Points:</strong> 3 per win, +1 bonus for KO/TKO</div>
                <div><strong style={{ color: "#e0d0a0" }}>Weekly Prizes:</strong></div>
                <div style={{ paddingLeft: 12 }}>
                  <div>#1: $5,000</div>
                  <div>#2: $3,000</div>
                  <div>#3: $1,000</div>
                  <div>#4-10: $500</div>
                </div>
                <div style={{ marginTop: 10, fontSize: 10, color: "#7a6a4a" }}>Payouts reset every Monday at midnight UTC.</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap');`}</style>
    </div>
  );
}
