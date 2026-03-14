import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api from "../../utils/api";
import styles from "../../styles/noir.module.css";

// ── FIGHT ENGINE ─────────────────────────────────────────────────────────────
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

// Real punch damage ranges (pro boxing calibrated)
const PUNCH_DMG  = {
  jab:      [3, 8],    // stiff jab / pawing jab range
  cross:    [8, 18],   // power cross
  hook:     [10, 22],  // lead hook — often the KO punch
  uppercut: [11, 24],  // short uppercut at close range
  body:     [6, 14],   // body shot — saps stamina more than hp
};
// Accuracy at full energy vs full defense
const PUNCH_ACC  = { jab:0.70, cross:0.58, hook:0.53, uppercut:0.48, body:0.62 };
// Stamina cost per thrown punch
const PUNCH_STAM = { jab:1.2, cross:2.2, hook:3.0, uppercut:3.2, body:2.6 };
// Cut probability per landed punch (hooks/cross most likely to open cuts)
const PUNCH_CUT  = { jab:0.018, cross:0.030, hook:0.045, uppercut:0.025, body:0.005 };
// Which location gets cut — eyebrow for most, cheek for hooks
const CUT_LOCS   = { jab:"eyebrow", cross:"eyebrow", hook:"cheek", uppercut:"eyebrow", body:"nose" };

function choosePunch(f) {
  const tired   = f.stam < 25;
  const hurt    = f.hp < 35;
  const pressng = f.aggression > 0.5;
  // Tired fighter jabs more, hurt fighter clinches/bodies, aggressive fighter hooks
  const w = {
    jab:      tired ? 50 : hurt ? 35 : pressng ? 20 : 28,
    cross:    tired ? 8  : hurt ? 12 : pressng ? 24 : 22,
    hook:     tired ? 6  : hurt ? 8  : pressng ? 28 : 18,
    uppercut: tired ? 4  : hurt ? 5  : pressng ? 12 : 14,
    body:     tired ? 8  : hurt ? 20 : pressng ? 16 : 18,
  };
  let r = Math.random() * Object.values(w).reduce((a,b)=>a+b,0);
  for (const [k,v] of Object.entries(w)) { r-=v; if(r<=0) return k; }
  return "jab";
}

function simulateFight(aS, bS) {
  const init = (s) => ({
    ...s,
    hp: 100, stam: 100, kds: 0,
    aggression:  clamp((s.power  - s.defense)  / 60 + 0.42 + rand(-0.12, 0.12), 0.08, 0.95),
    pressure:    clamp((s.speed  - s.defense)  / 80 + 0.38 + rand(-0.1,  0.1),  0.08, 0.90),
    counterpunch:clamp((s.defense - s.power)   / 70 + 0.35 + rand(-0.1,  0.1),  0.05, 0.85),
    cutSus:      clamp(1 - (s.defense||60)/130 + (1-(s.chin||65)/100)*0.3, 0.15, 0.85),
    cut: null, cutRound: null, docStopRisk: 0, momentum: 0,
    totalDmgDealt: 0, totalHits: 0, totalThrown: 0,
    consecutiveHits: 0,
  });

  const a = init(aS);
  const b = init(bS);
  const events = [];
  const scorecard = { a: [], b: [] };

  for (let round=1; round<=12; round++) {
    let roundDmgA = 0, roundDmgB = 0, roundKdA = 0, roundKdB = 0;
    const baseEx = round <= 3 ? 9 : round <= 6 ? 8 : 7;
    const exchanges = baseEx + randInt(-1, 3);

    for (let i=0; i<exchanges; i++) {
      if (a.hp<=0 || b.hp<=0) break;

      // Clinch: when both fighters are exhausted, chance of clinch
      if (a.stam < 25 && b.stam < 25 && Math.random() < 0.25) {
        a.stam = Math.min(100, a.stam + 3);
        b.stam = Math.min(100, b.stam + 3);
        events.push({
          type: "clinch", round,
          hpA: Math.round(a.hp), hpB: Math.round(b.hp),
          stamA: Math.round(a.stam), stamB: Math.round(b.stam),
          cutStateA: a.cut ? {...a.cut} : null, cutStateB: b.cut ? {...b.cut} : null,
        });
        continue;
      }

      const apt = choosePunch(a);
      const aAcc = clamp(
        PUNCH_ACC[apt]
        + ((a.accuracy != null ? a.accuracy : 70) - 70) / 400
        + (a.speed - b.defense) / 520
        - (1 - a.stam/100) * 0.28
        + a.momentum * 0.04
        + (a.aggression - 0.5) * 0.06,
        0.10, 0.88
      );
      const aL = Math.random() < aAcc;
      let aDmg = 0, aKD = false, aCutEv = null;
      a.totalThrown++;

      if (aL) {
        const [lo, hi] = PUNCH_DMG[apt];
        aDmg = rand(lo, hi) * (a.power / 76) * (1 + (1 - b.stam/100) * 0.22) * (1 + a.momentum * 0.06);
        a.consecutiveHits++;
        // Combo bonus: 3+ consecutive hits deal extra damage
        if (a.consecutiveHits >= 3) aDmg *= 1.15;
        b.hp = Math.max(0, b.hp - aDmg);
        a.totalHits++;
        a.totalDmgDealt += aDmg;
        roundDmgA += aDmg;

        if (apt === "body") {
          b.stam = Math.max(0, b.stam - aDmg * 0.55);
          b.hp = Math.min(100, b.hp + aDmg * 0.25);
        }

        const hurtMultB = b.hp < 30 ? 2.0 : b.hp < 50 ? 1.4 : 1.0;
        const kdChance = apt !== "body"
          ? (aDmg / 16) * (1 - b.chin/120) * (0.25 + 0.75 * (1 - b.stam/100)) * (1 + a.power/180) * hurtMultB
          : 0;
        if (Math.random() < kdChance && b.hp > 0 && b.kds < 3) {
          b.kds++; b.hp = Math.max(1, b.hp - 6); aKD = true; roundKdA++;
          a.momentum = Math.min(1, a.momentum + 0.4);
          b.momentum = Math.max(-1, b.momentum - 0.4);
        }

        if (apt !== "body") {
          const cutBase = PUNCH_CUT[apt] * b.cutSus;
          if (Math.random() < cutBase * (b.cut ? 1.8 : 1.0)) {
            const loc = CUT_LOCS[apt];
            if (b.cut && b.cut.loc === loc) {
              b.cut.severity = Math.min(1, b.cut.severity + rand(0.12, 0.32));
              b.docStopRisk += b.cut.severity * 0.4;
            } else if (!b.cut) {
              b.cut = { loc, severity: rand(0.15, 0.45) };
              b.cutRound = round;
            }
            aCutEv = { target:"b", loc, severity: b.cut.severity };
          }
        }
        a.momentum = clamp(a.momentum + 0.08, -1, 1);
        b.momentum = clamp(b.momentum - 0.08, -1, 1);
      } else {
        a.consecutiveHits = 0;
        a.momentum = clamp(a.momentum - 0.03, -1, 1);
      }
      a.stam = Math.max(0, a.stam - PUNCH_STAM[apt] * (aL ? 1.0 : 0.38));

      const bpt = choosePunch(b);
      const bAcc = clamp(
        PUNCH_ACC[bpt]
        + ((b.accuracy != null ? b.accuracy : 70) - 70) / 400
        + (b.speed - a.defense) / 520
        - (1 - b.stam/100) * 0.28
        + b.momentum * 0.04
        + (b.aggression - 0.5) * 0.06,
        0.10, 0.88
      );
      const bL = Math.random() < bAcc;
      let bDmg = 0, bKD = false, bCutEv = null;
      b.totalThrown++;

      if (bL) {
        const [lo, hi] = PUNCH_DMG[bpt];
        bDmg = rand(lo, hi) * (b.power / 76) * (1 + (1 - a.stam/100) * 0.22) * (1 + b.momentum * 0.06);
        b.consecutiveHits++;
        if (b.consecutiveHits >= 3) bDmg *= 1.15;
        a.hp = Math.max(0, a.hp - bDmg);
        b.totalHits++;
        b.totalDmgDealt += bDmg;
        roundDmgB += bDmg;

        if (bpt === "body") {
          a.stam = Math.max(0, a.stam - bDmg * 0.55);
          a.hp = Math.min(100, a.hp + bDmg * 0.25);
        }

        const hurtMultA = a.hp < 30 ? 2.0 : a.hp < 50 ? 1.4 : 1.0;
        const kdChance = bpt !== "body"
          ? (bDmg / 16) * (1 - a.chin/120) * (0.25 + 0.75 * (1 - a.stam/100)) * (1 + b.power/180) * hurtMultA
          : 0;
        if (Math.random() < kdChance && a.hp > 0 && a.kds < 3) {
          a.kds++; a.hp = Math.max(1, a.hp - 6); bKD = true; roundKdB++;
          b.momentum = Math.min(1, b.momentum + 0.4);
          a.momentum = Math.max(-1, a.momentum - 0.4);
        }

        if (bpt !== "body") {
          const cutBase = PUNCH_CUT[bpt] * a.cutSus;
          if (Math.random() < cutBase * (a.cut ? 1.8 : 1.0)) {
            const loc = CUT_LOCS[bpt];
            if (a.cut && a.cut.loc === loc) {
              a.cut.severity = Math.min(1, a.cut.severity + rand(0.12, 0.32));
              a.docStopRisk += a.cut.severity * 0.4;
            } else if (!a.cut) {
              a.cut = { loc, severity: rand(0.15, 0.45) };
              a.cutRound = round;
            }
            bCutEv = { target:"a", loc, severity: a.cut.severity };
          }
        }
        b.momentum = clamp(b.momentum + 0.08, -1, 1);
        a.momentum = clamp(a.momentum - 0.08, -1, 1);
      } else {
        b.consecutiveHits = 0;
        b.momentum = clamp(b.momentum - 0.03, -1, 1);
      }
      b.stam = Math.max(0, b.stam - PUNCH_STAM[bpt] * (bL ? 1.0 : 0.38));

      const docStop = i === exchanges - 1 && round > 1 && (
        (a.cut && a.cut.severity > 0.78 && a.docStopRisk > 1.4) ||
        (b.cut && b.cut.severity > 0.78 && b.docStopRisk > 1.4)
      );
      if (docStop && !aKD && !bKD) {
        if (a.cut && a.cut.severity > 0.78 && a.docStopRisk > 1.4) a.hp = 0;
        if (b.cut && b.cut.severity > 0.78 && b.docStopRisk > 1.4) b.hp = 0;
      }

      const isFinal = a.hp<=0 || b.hp<=0 || a.kds>=3 || b.kds>=3;
      const isCombo = (aL && a.consecutiveHits >= 3) || (bL && b.consecutiveHits >= 3);

      events.push({
        round,
        hpA: Math.round(a.hp), hpB: Math.round(b.hp),
        stamA: Math.round(a.stam), stamB: Math.round(b.stam),
        aPunch: apt, aLanded: aL, aDmg: Math.round(aDmg*10)/10, aKD,
        bPunch: bpt, bLanded: bL, bDmg: Math.round(bDmg*10)/10, bKD,
        cutA: bCutEv || null, cutB: aCutEv || null,
        cutStateA: a.cut ? {...a.cut} : null, cutStateB: b.cut ? {...b.cut} : null,
        isFinal, isCombo,
        comboSide: aL && a.consecutiveHits >= 3 ? "a" : bL && b.consecutiveHits >= 3 ? "b" : null,
        comboCount: aL && a.consecutiveHits >= 3 ? a.consecutiveHits : bL && b.consecutiveHits >= 3 ? b.consecutiveHits : 0,
      });

      if (isFinal) break;
    }

    // Check if the fight ended mid-round (KO/TKO)
    const fightOver = a.hp <= 0 || b.hp <= 0 || a.kds >= 3 || b.kds >= 3;

    if (fightOver) {
      // For a clean KO (HP=0 but no KD was registered on the final blow),
      // inject a synthetic knockdown so the canvas shows a proper drop animation
      const lastEv = events[events.length - 1];
      if (lastEv && !lastEv.aKD && !lastEv.bKD && (a.hp <= 0 || b.hp <= 0)) {
        if (b.hp <= 0) lastEv.aKD = true;
        if (a.hp <= 0) lastEv.bKD = true;
      }
      break;
    }

    // 10-point must scoring (only for completed rounds, not KO rounds)
    let scoreA = 10, scoreB = 10;
    if (roundDmgA > roundDmgB * 1.2) scoreB = 9;
    else if (roundDmgB > roundDmgA * 1.2) scoreA = 9;
    else if (roundDmgA > roundDmgB) scoreB = 9;
    else if (roundDmgB > roundDmgA) scoreA = 9;
    else { scoreA = 10; scoreB = 10; }
    if (roundKdA > 0) scoreB = Math.max(7, scoreB - roundKdA);
    if (roundKdB > 0) scoreA = Math.max(7, scoreA - roundKdB);
    scorecard.a.push(scoreA);
    scorecard.b.push(scoreB);

    // Corner advice event
    const cornerAdvice = [];
    if (b.stam < 30) cornerAdvice.push("Work the body, he's tiring");
    else if (a.hp < 40) cornerAdvice.push("Stay behind that jab, be smart");
    if (a.cut && a.cut.severity > 0.5) cornerAdvice.push("Protect that cut");
    if (b.cut && b.cut.severity > 0.4) cornerAdvice.push("Go after that cut");
    const totalScoreA = scorecard.a.reduce((s,v)=>s+v,0);
    const totalScoreB = scorecard.b.reduce((s,v)=>s+v,0);
    if (totalScoreA > totalScoreB) cornerAdvice.push("You're ahead on the cards");
    else if (totalScoreB > totalScoreA && round > 3) cornerAdvice.push("You need this round");
    const advice = cornerAdvice.length ? cornerAdvice[Math.floor(Math.random()*cornerAdvice.length)] : null;

    events.push({
      type: "roundEnd", round,
      hpA: Math.round(a.hp), hpB: Math.round(b.hp),
      stamA: Math.round(a.stam), stamB: Math.round(b.stam),
      cutStateA: a.cut ? {...a.cut} : null, cutStateB: b.cut ? {...b.cut} : null,
      scoreA, scoreB, cornerAdvice: advice,
    });

    // Between-round recovery
    const aRec = 4 + ((a.stamina != null ? a.stamina : 62) / 100) * 8 + ((a.recovery != null ? a.recovery : 62) / 100) * 6;
    const bRec = 4 + ((b.stamina != null ? b.stamina : 62) / 100) * 8 + ((b.recovery != null ? b.recovery : 62) / 100) * 6;
    a.stam = Math.min(100, a.stam + aRec);
    b.stam = Math.min(100, b.stam + bRec);
    a.hp = Math.min(100, a.hp + 1 + ((a.recovery != null ? a.recovery : 62) / 100) * 2);
    b.hp = Math.min(100, b.hp + 1 + ((b.recovery != null ? b.recovery : 62) / 100) * 2);
    a.momentum *= 0.5;
    b.momentum *= 0.5;
    if (a.cut) a.cut.severity = Math.min(1, a.cut.severity + 0.04);
    if (b.cut) b.cut.severity = Math.min(1, b.cut.severity + 0.04);
  }

  let winner=null, reason="Decision";
  if (a.hp<=0 || a.kds>=3) {
    winner="b";
    reason = a.kds>=3 ? "TKO" : (a.cut && a.cut.severity > 0.78 ? "TKO" : "KO");
  } else if (b.hp<=0 || b.kds>=3) {
    winner="a";
    reason = b.kds>=3 ? "TKO" : (b.cut && b.cut.severity > 0.78 ? "TKO" : "KO");
  } else {
    // 10-point must decision with 3 virtual judges
    const totalA = scorecard.a.reduce((s,v)=>s+v,0);
    const totalB = scorecard.b.reduce((s,v)=>s+v,0);
    const jitter = () => randInt(-1, 1);
    const j1a = totalA + jitter(), j1b = totalB + jitter();
    const j2a = totalA + jitter(), j2b = totalB + jitter();
    const j3a = totalA + jitter(), j3b = totalB + jitter();
    const winsA = (j1a > j1b ? 1 : 0) + (j2a > j2b ? 1 : 0) + (j3a > j3b ? 1 : 0);
    const winsB = (j1b > j1a ? 1 : 0) + (j2b > j2a ? 1 : 0) + (j3b > j3a ? 1 : 0);
    if (winsA >= 2) { winner = "a"; reason = winsA === 3 ? "Unanimous decision" : "Split decision"; }
    else if (winsB >= 2) { winner = "b"; reason = winsB === 3 ? "Unanimous decision" : "Split decision"; }
    else { winner = a.totalDmgDealt > b.totalDmgDealt ? "a" : "b"; reason = "Majority decision"; }
  }
  // #region agent log
  fetch('http://127.0.0.1:7258/ingest/609248f0-1675-4861-90ee-f3b15ff725d4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d94f2d'},body:JSON.stringify({sessionId:'d94f2d',location:'Boxing.js:simulateFight',message:'client_fight_result',data:{winner,reason,hpA:a.hp,hpB:b.hp,kdsA:a.kds,kdsB:b.kds},hypothesisId:'A',timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return {
    events, winner, reason, scorecard,
    stats: {
      a: { thrown: a.totalThrown, landed: a.totalHits, dmg: Math.round(a.totalDmgDealt), kds: a.kds },
      b: { thrown: b.totalThrown, landed: b.totalHits, dmg: Math.round(b.totalDmgDealt), kds: b.kds },
    },
  };
}

// ── FIGHTERS DATA ────────────────────────────────────────────────────────────
const FIGHTERS=[
  {name:"Tommy 'The Bull' Moran",  power:82,speed:66,stamina:74,defense:60,accuracy:65,chin:70,recovery:62,color:0x1a4a9a,colorCSS:"#2a5aaa"},
  {name:"Sal 'Switchblade' Ricci", power:68,speed:84,stamina:78,defense:76,accuracy:72,chin:62,recovery:60,color:0x9a1a1a,colorCSS:"#bb2222"},
];

// ── CANVAS FIGHT RENDERER ────────────────────────────────────────────────────
function drawRing(ctx, W, H) {
  const cx = W / 2, cy = H * 0.55;
  const rw = W * 0.82, rh = H * 0.46;
  const rl = cx - rw/2, rt = cy - rh/2, rr = cx + rw/2, rb = cy + rh/2;

  // Crowd silhouette strip
  const crowdH = rt - 4;
  if (crowdH > 10) {
    ctx.fillStyle = "#0e0e14";
    ctx.fillRect(0, 0, W, crowdH);
    for (let i = 0; i < 40; i++) {
      const sx = (i / 40) * W + Math.sin(i * 1.7) * 6;
      const sh = 8 + Math.sin(i * 2.3) * 4;
      ctx.fillStyle = `rgba(${30+i%20},${25+i%15},${35+i%10},0.7)`;
      ctx.beginPath();
      ctx.arc(sx, crowdH - sh/2, 3 + (i%3), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(sx - 2, crowdH - sh/2 + 2, 4, sh/2);
    }
  }

  // Ring floor
  ctx.fillStyle = "#2a2218";
  ctx.fillRect(rl, rt, rw, rh);
  ctx.fillStyle = "#352e20";
  ctx.fillRect(rl + 10, rt + 10, rw - 20, rh - 20);

  // Ropes
  for (let i = 0; i < 3; i++) {
    const ry = rt + rh * (0.12 + i * 0.38);
    ctx.strokeStyle = i === 1 ? "rgba(201,168,76,0.6)" : "rgba(138,122,90,0.4)";
    ctx.lineWidth = i === 1 ? 2 : 1.5;
    ctx.beginPath(); ctx.moveTo(rl - 3, ry); ctx.lineTo(rr + 3, ry); ctx.stroke();
  }

  // Corner posts
  const posts = [[rl, rt], [rr, rt], [rl, rb], [rr, rb]];
  const pc = ["#c9a84c", "#bb2222", "#bb2222", "#c9a84c"];
  posts.forEach(([x, y], i) => {
    ctx.fillStyle = pc[i]; ctx.fillRect(x-3, y-3, 6, 6);
  });

  ctx.strokeStyle = "rgba(201,168,76,0.2)"; ctx.lineWidth = 1;
  ctx.strokeRect(rl, rt, rw, rh);
  return { rl, rt, rr, rb, rw, rh, cx, cy };
}

function drawFighter(ctx, x, y, facing, anim, progress, color, hp) {
  ctx.save();
  ctx.translate(x, y);
  const s = facing === "right" ? 1 : -1;
  ctx.scale(s, 1);

  const bob = Math.sin(performance.now() / 280) * 2;
  const isIdle = anim === "idle";
  const isHit = anim === "hit";
  const isPunch = ["jab","cross","hook","uppercut","body"].includes(anim);
  const isDown = anim === "down" || anim === "ko";
  const hitShake = isHit ? Math.sin(progress * 20) * 3 : 0;
  const downAngle = isDown
    ? (anim === "ko" ? (Math.PI / 2.5) : Math.min(1, progress * 3) * (Math.PI / 2.5))
    : 0;

  if (isDown) {
    ctx.translate(0, 10 * Math.min(1, anim === "ko" ? 1 : progress * 3));
    ctx.rotate(downAngle);
  }

  // Body
  const bodyY = isIdle ? bob : isHit ? bob + hitShake : 0;
  ctx.fillStyle = color;
  ctx.beginPath();
  const bx = -8, by = -24 + bodyY, bw = 16, bh = 28, br = 3;
  ctx.moveTo(bx+br, by); ctx.lineTo(bx+bw-br, by); ctx.quadraticCurveTo(bx+bw, by, bx+bw, by+br);
  ctx.lineTo(bx+bw, by+bh-br); ctx.quadraticCurveTo(bx+bw, by+bh, bx+bw-br, by+bh);
  ctx.lineTo(bx+br, by+bh); ctx.quadraticCurveTo(bx, by+bh, bx, by+bh-br);
  ctx.lineTo(bx, by+br); ctx.quadraticCurveTo(bx, by, bx+br, by);
  ctx.closePath();
  ctx.fill();

  // Head
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, -32 + bodyY, 8, 0, Math.PI * 2);
  ctx.fill();

  // Cut indicator
  if (hp < 50) {
    ctx.fillStyle = "rgba(200,40,40,0.6)";
    ctx.beginPath(); ctx.arc(5, -34 + bodyY, 2, 0, Math.PI * 2); ctx.fill();
  }

  // Legs
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-4, 4 + bodyY); ctx.lineTo(-6, 20 + bodyY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, 4 + bodyY); ctx.lineTo(6, 20 + bodyY); ctx.stroke();

  // Arms & gloves
  const gloveColor = facing === "right" ? "#d4a832" : "#cc3333";
  if (isPunch && progress < 1) {
    const ext = Math.sin(progress * Math.PI);
    let gx = 12, gy = -18 + bodyY;
    if (anim === "jab") { gx = 12 + ext * 22; gy = -20 + bodyY; }
    else if (anim === "cross") { gx = 10 + ext * 26; gy = -18 + bodyY; }
    else if (anim === "hook") { gx = 10 + ext * 18; gy = -22 + bodyY - ext * 4; }
    else if (anim === "uppercut") { gx = 10 + ext * 14; gy = -18 + bodyY - ext * 16; }
    else if (anim === "body") { gx = 10 + ext * 20; gy = -10 + bodyY; }
    // Lead arm (punching)
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(6, -18 + bodyY); ctx.lineTo(gx, gy); ctx.stroke();
    ctx.fillStyle = gloveColor;
    ctx.beginPath(); ctx.arc(gx, gy, 4, 0, Math.PI * 2); ctx.fill();
    // Rear arm (guard)
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-4, -18 + bodyY); ctx.lineTo(-6, -26 + bodyY); ctx.stroke();
    ctx.fillStyle = gloveColor;
    ctx.beginPath(); ctx.arc(-6, -26 + bodyY, 3.5, 0, Math.PI * 2); ctx.fill();
  } else {
    // Guard position
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(6, -18 + bodyY); ctx.lineTo(10, -26 + bodyY); ctx.stroke();
    ctx.fillStyle = gloveColor;
    ctx.beginPath(); ctx.arc(10, -26 + bodyY, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-4, -18 + bodyY); ctx.lineTo(-2, -28 + bodyY); ctx.stroke();
    ctx.fillStyle = gloveColor;
    ctx.beginPath(); ctx.arc(-2, -28 + bodyY, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  // Hit flash
  if (isHit && progress < 0.3) {
    ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - progress/0.3)})`;
    ctx.beginPath(); ctx.arc(0, -20 + bodyY, 14, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

function drawHitParticles(ctx, particles, now) {
  particles.forEach(p => {
    const age = (now - p.born) / 1000;
    if (age > p.life) return;
    const frac = age / p.life;
    const px = p.x + p.vx * age;
    const py = p.y + p.vy * age + 40 * age * age;
    ctx.fillStyle = `rgba(255,${200 + Math.floor(Math.random()*55)},100,${1-frac})`;
    ctx.beginPath(); ctx.arc(px, py, 2*(1-frac), 0, Math.PI*2); ctx.fill();
  });
}

function drawRoundCard(ctx, W, H, roundNum, progress) {
  if (progress <= 0 || progress > 1) return;
  const alpha = progress < 0.15 ? progress/0.15 : progress > 0.85 ? (1-progress)/0.15 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(W * 0.3, H * 0.35, W * 0.4, H * 0.18);
  ctx.strokeStyle = "rgba(201,168,76,0.6)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(W * 0.3, H * 0.35, W * 0.4, H * 0.18);
  ctx.fillStyle = "#c9a84c";
  ctx.font = "bold 18px Cinzel,serif";
  ctx.textAlign = "center";
  ctx.fillText(`ROUND ${roundNum}`, W/2, H * 0.35 + H * 0.12);
  ctx.restore();
}

function drawKOCountdown(ctx, W, H, count) {
  if (count == null || count <= 0) return;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, W, H);
  const pulse = 1 + Math.sin(performance.now() / 150) * 0.08;
  ctx.translate(W/2, H * 0.42);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = "#ff4444";
  ctx.font = "bold 48px Cinzel,serif";
  ctx.textAlign = "center";
  ctx.fillText(String(count), 0, 0);
  ctx.font = "12px Cinzel,serif";
  ctx.fillStyle = "#e0d0b0";
  ctx.fillText("DOWN!", 0, 22);
  ctx.restore();
}

function drawCanvasBars(ctx, W, H, state, nameA, nameB) {
  const barW = W * 0.32, barH = 6, gap = 10;
  const y = H - 30;

  // Fighter A bars (left)
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(gap, y, barW, barH);
  ctx.fillStyle = state.hpA > 30 ? "#c9a84c" : "#cc4444";
  ctx.fillRect(gap, y, barW * (state.hpA / 100), barH);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(gap, y + barH + 2, barW, 4);
  ctx.fillStyle = "#3a8aaa";
  ctx.fillRect(gap, y + barH + 2, barW * (state.stamA / 100), 4);
  ctx.fillStyle = "#c9a84c"; ctx.font = "bold 9px Cinzel,serif"; ctx.textAlign = "left";
  ctx.fillText(nameA, gap, y - 4);

  // Fighter B bars (right)
  const rx = W - gap - barW;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(rx, y, barW, barH);
  ctx.fillStyle = state.hpB > 30 ? "#bb3333" : "#cc4444";
  ctx.fillRect(rx + barW * (1 - state.hpB / 100), y, barW * (state.hpB / 100), barH);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(rx, y + barH + 2, barW, 4);
  ctx.fillStyle = "#3a8aaa";
  ctx.fillRect(rx + barW * (1 - state.stamB / 100), y + barH + 2, barW * (state.stamB / 100), 4);
  ctx.fillStyle = "#bb3333"; ctx.font = "bold 9px Cinzel,serif"; ctx.textAlign = "right";
  ctx.fillText(nameB, W - gap, y - 4);

  // Round
  ctx.fillStyle = "#c9a84c"; ctx.font = "bold 11px Cinzel,serif"; ctx.textAlign = "center";
  ctx.fillText(`R${state.round}/12`, W/2, y + 4);
}

// ── COMPONENT ─────────────────────────────────────────────────────────────────
export default function Boxing3D() {
  const refs = useRef({ fight: null });
  const [arenaFightResult, setArenaFightResult] = useState(null);
  const [liveCommentary, setLiveCommentary] = useState([]);
  const commentaryEndRef = useRef(null);
  const streamTimeoutsRef = useRef([]);

  const [hpA,setHpA]=useState(100);
  const [hpB,setHpB]=useState(100);
  const [stamA,setStamA]=useState(100);
  const [stamB,setStamB]=useState(100);
  const [round,setRound]=useState(1);
  const [gameState,setGameState]=useState("idle");
  const [winText,setWinText]=useState("");
  const [actionText,setActionText]=useState("");
  const [koCount,setKoCount]=useState(null); // null | { count:number, side:"a"|"b", name:string, tko:boolean }

  const [npcs, setNpcs] = useState([]);
  const [npcFightState, setNpcFightState] = useState(null);
  const npcPollRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [effective, setEffective] = useState(null);
  const [drills, setDrills] = useState({});
  const [gymInfo, setGymInfo] = useState(null);
  const [coachInfo, setCoachInfo] = useState(null);
  const [gearInfo, setGearInfo] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const [me, setMe] = useState(null);
  const [opponentName, setOpponentName] = useState("");
  const [liveMatches, setLiveMatches] = useState([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [bets, setBets] = useState([]);
  const [league, setLeague] = useState(null);
  const [betStake, setBetStake] = useState(10000);
  const [drillTick, setDrillTick] = useState(0); // force re-render every 1s for cooldown countdown
  const [narrowLayout, setNarrowLayout] = useState(typeof window !== "undefined" && window.innerWidth < 768);

  const { matchId: arenaMatchId } = useParams();
  const navigate = useNavigate();
  const [arenaMatchDetail, setArenaMatchDetail] = useState(null);
  const [betweenRoundsTick, setBetweenRoundsTick] = useState(0);
  const [arenaServerResult, setArenaServerResult] = useState(null);
  const arenaStartedRef = useRef(false);
  const prevArenaMatchIdRef = useRef(undefined);
  const arenaMatchDetailRef = useRef(null);

  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const fightStateRef = useRef({
    fighterA: { anim: "idle", animStart: 0, punchType: null, landed: false },
    fighterB: { anim: "idle", animStart: 0, punchType: null, landed: false },
    hpA: 100, hpB: 100, stamA: 100, stamB: 100, round: 1,
    showRoundCard: false, roundCardNum: 0, roundCardStart: 0,
    koCountdown: null, hitParticles: [], finished: false,
  });
  const [speedMult, setSpeedMult] = useState(1);
  const speedMultRef = useRef(1);

  const flashMsg=(msg,ms=1600)=>{ setActionText(msg); setTimeout(()=>setActionText(""),ms); };
  const getErr = (e) => e?.response?.data?.detail || e?.message || "Something went wrong";

  // When returning from arena to gym: clear npc fight state (so buttons work) and refresh match list
  useEffect(() => {
    const wasInArena = prevArenaMatchIdRef.current != null && prevArenaMatchIdRef.current !== "";
    prevArenaMatchIdRef.current = arenaMatchId;
    if (wasInArena && !arenaMatchId) {
      setNpcFightState(null);
      setArenaFightResult(null);
      refreshMatches();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when leaving arena (arenaMatchId clears)
  }, [arenaMatchId]);

  useEffect(() => {
    if (!arenaMatchId) return;
    setArenaServerResult(null);
    arenaStartedRef.current = false;
    api.get(`/boxing/matches/${arenaMatchId}`).then((r) => {
      setArenaMatchDetail(r.data?.match || null);
      arenaMatchDetailRef.current = r.data?.match || null;
    }).catch(() => setArenaMatchDetail(null));
  }, [arenaMatchId]);

  useEffect(() => {
    if (!arenaMatchId) return;
    const poll = () => {
      api.get(`/boxing/matches/${arenaMatchId}`).then((r) => {
        const m = r.data?.match;
        if (m) {
          setArenaMatchDetail(m);
          arenaMatchDetailRef.current = m;
          if (m.state === "finished") {
            const sr = { winner: m.winner, finish_reason: m.finish_reason || "" };
            setArenaServerResult(sr);
            const clientSide = arenaFightResult?.winner;
            const clientWinnerId = clientSide === "a" ? m?.a_id : clientSide === "b" ? m?.b_id : null;
            const match = clientWinnerId === m?.winner;
            fetch('http://127.0.0.1:7258/ingest/609248f0-1675-4861-90ee-f3b15ff725d4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d94f2d'},body:JSON.stringify({sessionId:'d94f2d',location:'Boxing.js:poll',message:'server_vs_client',data:{server_winner:sr.winner,client_winner_side:clientSide,client_winner_id:clientWinnerId,match_result_same:match},hypothesisId:'A',timestamp:Date.now()})}).catch(()=>{});
          }
          // Keep HP and round in sync with server so bar and "End of round" are correct
          const hp = m.hp || {};
          const serverRound = m.round ?? 1;
          setHpA(hp.a != null ? hp.a : 100);
          setHpB(hp.b != null ? hp.b : 100);
          setRound(serverRound);
        }
      }).catch(() => {});
    };
    // Poll every 1s so we catch "counting" and "finished" quickly (count start + 10-count KO)
    const id = setInterval(poll, 1000);
    poll();
    return () => clearInterval(id);
  }, [arenaMatchId]);

  useEffect(() => {
    if (!arenaMatchId || !arenaMatchDetail?.id) return;
    const s = arenaMatchDetail.state;
    if (s !== "running" && s !== "counting") return;
    const id = setInterval(() => setBetweenRoundsTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [arenaMatchId, arenaMatchDetail?.id, arenaMatchDetail?.state]);

  useEffect(() => {
    if (!arenaMatchId || !arenaMatchDetail?.id || arenaStartedRef.current) return;
    arenaStartedRef.current = true;
    const baseA = FIGHTERS[0];
    const baseB = FIGHTERS[1];
    const scaleStat = (v, base) => {
      const n = Number(v || 1);
      if (!Number.isFinite(n)) return base;
      return Math.max(45, Math.min(95, 45 + n * 3));
    };
    const youStats = effective || profile || null;
    const opponentName = arenaMatchDetail.b_username || "";
    const npc = (npcs || []).find((n) => n.name === opponentName) || (npcs && npcs[0]) || null;
    const simA = youStats ? {
      name: (me?.username ? `${me.username.toUpperCase()}` : baseA.name),
      power: scaleStat(youStats.power, baseA.power),
      speed: scaleStat(youStats.speed, baseA.speed),
      stamina: scaleStat(youStats.stamina, baseA.stamina),
      defense: scaleStat(youStats.defense, baseA.defense),
      accuracy: scaleStat(youStats.accuracy, baseA.accuracy ?? 65),
      chin: scaleStat(youStats.chin ?? 1, 65),
      recovery: scaleStat(youStats.recovery ?? 1, baseA.recovery ?? 62),
    } : baseA;
    const simB = npc ? {
      name: npc.name,
      power: scaleStat(npc.power, baseB.power),
      speed: scaleStat(npc.speed, baseB.speed),
      stamina: scaleStat(npc.stamina, baseB.stamina),
      defense: scaleStat(npc.defense, baseB.defense),
      accuracy: scaleStat(npc.accuracy, baseB.accuracy ?? 72),
      chin: scaleStat(npc.chin ?? npc.accuracy ?? 5, 60),
      recovery: scaleStat(npc.recovery ?? 5, baseB.recovery ?? 60),
    } : baseB;
    const result = simulateFight(simA, simB);
    result.nameA = simA.name;
    result.nameB = simB.name;
    setArenaFightResult(result);
    // Bars and round will be driven by live commentary stream
    setGameState("done");
    const wName = result.winner === "a" ? result.nameA : result.winner === "b" ? result.nameB : "";
    setWinText(result.reason === "Draw" ? "DRAW" : `${wName.split(" ")[0]} WINS — ${result.reason}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arenaMatchId, arenaMatchDetail?.id, npcs?.length]);

  useEffect(() => {
    let cancelled = false;
    api.get("/auth/me").then((r) => { if (!cancelled) setMe(r.data || null); }).catch(() => {});
    api.get("/boxing/npcs").then((r) => { if (!cancelled) setNpcs(r.data?.npcs || []); }).catch(() => {});
    const loadMeta = async () => {
      try {
        setLoadingMeta(true);
        const [profRes, gymRes, coachRes, gearRes] = await Promise.all([
          api.get("/boxing/profile"),
          api.get("/boxing/gym"),
          api.get("/boxing/coaches"),
          api.get("/boxing/gear"),
        ]);
        if (cancelled) return;
        setProfile(profRes.data?.profile || null);
        setEffective(profRes.data?.effective || null);
        setDrills(profRes.data?.drills || {});
        setGymInfo(gymRes.data || null);
        setCoachInfo(coachRes.data || null);
        setGearInfo(gearRes.data || null);
        setMetaError("");
      } catch (e) {
        if (!cancelled) setMetaError(getErr(e));
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    };
    loadMeta();
    const loadMatches = async () => {
      try {
        setMatchesLoading(true);
        const [liveRes, betsRes, leagueRes] = await Promise.all([
          api.get("/boxing/matches/live"),
          api.get("/boxing/bets/my-bets"),
          api.get("/boxing/league?period=weekly"),
        ]);
        if (cancelled) return;
        setLiveMatches(liveRes.data?.matches || []);
        setBets(betsRes.data?.bets || []);
        setLeague(leagueRes.data || null);
        setMatchError("");
      } catch (e) {
        if (!cancelled) setMatchError(getErr(e));
      } finally {
        if (!cancelled) setMatchesLoading(false);
      }
    };
    loadMatches();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const ref = npcPollRef;
    return () => { if (ref.current) clearInterval(ref.current); };
  }, []);

  useEffect(() => {
    if (!profile || !Object.keys(drills || {}).length) return;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
    const interval = isMobile ? 2000 : 1000; // 2s on mobile to reduce re-renders and lag
    let id;
    const tick = () => {
      if (document.visibilityState === "visible") setDrillTick((k) => k + 1);
    };
    id = setInterval(tick, interval);
    return () => clearInterval(id);
  }, [profile, drills]);

  useEffect(() => {
    const check = () => setNarrowLayout(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const startNpcFight = async (npc) => {
    if (npcFightState && !npcFightState.result) return;
    setNpcFightState({ matchId: null, npcName: npc.name });
    try {
      const createRes = await api.post("/boxing/matches/create", { opponent_username: npc.name });
      const matchId = createRes.data?.match_id;
      if (!matchId) throw new Error("No match id");
      await api.post("/boxing/matches/ready", { match_id: matchId, ready: true });
      setNpcFightState((s) => ({ ...s, matchId }));
      await refreshMatches();
      navigate(`/boxing/arena/${matchId}`);
      return;
    } catch (e) {
      setMatchError(getErr(e));
      setNpcFightState({ result: "error", npcName: npc.name, message: e?.response?.data?.detail || e?.message || "Failed" });
    }
  };

  const clearNpcResult = () => setNpcFightState(null);

  const handleTrain = async (drillId) => {
    setBusyAction(`train:${drillId}`);
    try {
      const res = await api.post("/boxing/train", { drill_id: drillId });
      setProfile(res.data?.profile || null);
      setEffective(res.data?.effective || null);
      setDrills((d) => ({ ...(d || {}), ...(res.data?.drills || {}) }));
      setMetaError("");
    } catch (e) {
      setMetaError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };

  const handleGymUpgrade = async () => {
    setBusyAction("gym_upgrade");
    try {
      const res = await api.post("/boxing/gym/upgrade");
      setProfile(res.data?.profile || null);
      setEffective(res.data?.effective || null);
      const gymRes = await api.get("/boxing/gym");
      setGymInfo(gymRes.data || null);
      setMetaError("");
    } catch (e) {
      setMetaError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };

  const handleGymMove = async (gymId) => {
    setBusyAction(`gym_move:${gymId}`);
    try {
      const res = await api.post("/boxing/gym/move", { gym_id: gymId });
      setProfile(res.data?.profile || null);
      setEffective(res.data?.effective || null);
      const gymRes = await api.get("/boxing/gym");
      setGymInfo(gymRes.data || null);
      setMetaError("");
    } catch (e) {
      setMetaError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };

  const handleCoachHire = async (coachId) => {
    setBusyAction(`coach:${coachId}`);
    try {
      const res = await api.post("/boxing/coach/hire", { coach_id: coachId });
      setProfile(res.data?.profile || null);
      setEffective(res.data?.effective || null);
      const coachRes = await api.get("/boxing/coaches");
      setCoachInfo(coachRes.data || null);
      setMetaError("");
    } catch (e) {
      setMetaError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };

  const handleCoachFire = async () => {
    setBusyAction("coach_fire");
    try {
      const res = await api.post("/boxing/coach/fire");
      setProfile(res.data?.profile || null);
      setEffective(res.data?.effective || null);
      const coachRes = await api.get("/boxing/coaches");
      setCoachInfo(coachRes.data || null);
      setMetaError("");
    } catch (e) {
      setMetaError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };

  const handleGearBuy = async (gearId) => {
    setBusyAction(`buy:${gearId}`);
    try {
      await api.post("/boxing/gear/buy", { gear_id: gearId });
      const gearRes = await api.get("/boxing/gear");
      setGearInfo(gearRes.data || null);
      setMetaError("");
    } catch (e) {
      setMetaError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };

  const handleGearEquip = async (slot, gearId) => {
    setBusyAction(`equip:${slot}:${gearId || "none"}`);
    try {
      const res = await api.post("/boxing/gear/equip", { slot, gear_id: gearId || null });
      setProfile(res.data?.profile || null);
      setEffective(res.data?.effective || null);
      const gearRes = await api.get("/boxing/gear");
      setGearInfo(gearRes.data || null);
      setMetaError("");
    } catch (e) {
      setMetaError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };

  const refreshMatches = async () => {
    try {
      setMatchesLoading(true);
      const [liveRes, betsRes, leagueRes] = await Promise.all([
        api.get("/boxing/matches/live"),
        api.get("/boxing/bets/my-bets"),
        api.get("/boxing/league?period=weekly"),
      ]);
      setLiveMatches(liveRes.data?.matches || []);
      setBets(betsRes.data?.bets || []);
      setLeague(leagueRes.data || null);
      setMatchError("");
    } catch (e) {
      setMatchError(getErr(e));
    } finally {
      setMatchesLoading(false);
    }
  };

  const handleCreateMatch = async () => {
    const name = (opponentName || "").trim();
    if (!name) return;
    setBusyAction("create_match");
    try {
      await api.post("/boxing/matches/create", { opponent_username: name });
      setOpponentName("");
      await refreshMatches();
    } catch (e) {
      setMatchError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };

  const handleReadyMatch = async (matchId, ready) => {
    setBusyAction(`ready:${matchId}`);
    try {
      await api.post("/boxing/matches/ready", { match_id: matchId, ready });
      await refreshMatches();
    } catch (e) {
      setMatchError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };

  const handlePlaceBet = async (matchId, fighter) => {
    setBusyAction(`bet:${matchId}:${fighter}`);
    try {
      await api.post("/boxing/bets/place", { match_id: matchId, fighter, stake: Number(betStake) || 0 });
      await refreshMatches();
    } catch (e) {
      setMatchError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };

  const handleJoinMatch = async (matchId) => {
    setBusyAction(`join:${matchId}`);
    try {
      await api.post("/boxing/matches/join", { match_id: matchId });
      await refreshMatches();
    } catch (e) {
      setMatchError(getErr(e));
    } finally {
      setBusyAction("");
    }
  };


  const gold = "var(--noir-primary)";
  const crimson = "#b5463c"; // opponent accent (contrast)

  const commentaryLinesToStream = useMemo(() => {
    const res = arenaFightResult;
    if (!res || !res.events || !res.events.length) return [];
    const nameA = res.nameA || "Fighter A";
    const nameB = res.nameB || "Fighter B";
    const cap = (s) => (s && s[0].toUpperCase() + s.slice(1)) || s;
    const lines = [];
    let lastRound = 0;
    const events = res.events;
    for (let idx = 0; idx < events.length; idx++) {
      const ev = events[idx];

      // Clinch events
      if (ev.type === "clinch") {
        if (ev.round !== lastRound) { lastRound = ev.round; lines.push({ type: "round", text: `Round ${ev.round}`, round: ev.round, ev }); }
        lines.push({ type: "clinch", text: "They clinch in the center of the ring. Ref breaks them apart.", ev });
        continue;
      }
      // Round-end events (scorecard + corner)
      if (ev.type === "roundEnd") {
        const scoreStr = `${ev.scoreA}-${ev.scoreB}`;
        lines.push({ type: "roundEnd", text: `— End of Round ${ev.round} (${scoreStr}) —`, ev });
        if (ev.cornerAdvice) lines.push({ type: "corner", text: `Corner: "${ev.cornerAdvice}"`, ev });
        // Cut warnings between rounds
        if (ev.cutStateA && ev.cutStateA.severity > 0.5) {
          const sev = ev.cutStateA.severity > 0.7 ? "getting worse — doctor may check it" : "swelling up";
          lines.push({ type: "cutWarn", text: `Cut over ${nameA}'s ${ev.cutStateA.loc} is ${sev}.`, ev });
        }
        if (ev.cutStateB && ev.cutStateB.severity > 0.5) {
          const sev = ev.cutStateB.severity > 0.7 ? "getting worse — doctor may check it" : "swelling up";
          lines.push({ type: "cutWarn", text: `Cut over ${nameB}'s ${ev.cutStateB.loc} is ${sev}.`, ev });
        }
        continue;
      }

      if (ev.round !== lastRound) {
        lastRound = ev.round;
        lines.push({ type: "round", text: `Round ${ev.round}`, round: ev.round, ev });
      }

      if (ev.aLanded) {
        lines.push({ type: "exchange", text: `${nameA} lands a ${cap(ev.aPunch)} for ${ev.aDmg} damage.`, side: "a", ev });
      } else {
        lines.push({ type: "exchange", text: `${nameA} misses with a ${cap(ev.aPunch)}.`, side: "a", ev });
      }
      if (ev.isCombo && ev.comboSide === "a") {
        lines.push({ type: "combo", text: `Beautiful ${ev.comboCount}-punch combo from ${nameA}!`, side: "a", ev });
      }
      if (ev.bLanded) {
        lines.push({ type: "exchange", text: `${nameB} lands a ${cap(ev.bPunch)} for ${ev.bDmg} damage.`, side: "b", ev });
      } else {
        lines.push({ type: "exchange", text: `${nameB} misses with a ${cap(ev.bPunch)}.`, side: "b", ev });
      }
      if (ev.isCombo && ev.comboSide === "b") {
        lines.push({ type: "combo", text: `Beautiful ${ev.comboCount}-punch combo from ${nameB}!`, side: "b", ev });
      }
      if (ev.aKD) lines.push({ type: "kd", text: `KNOCKDOWN! ${nameA} drops ${nameB}!`, side: "b", ev });
      if (ev.bKD) lines.push({ type: "kd", text: `KNOCKDOWN! ${nameB} puts ${nameA} on the canvas!`, side: "a", ev });
      if (ev.cutA) {
        const sev = ev.cutA.severity > 0.6 ? "Bad cut" : "Cut";
        lines.push({ type: "cut", text: `${sev} opened over ${nameA}'s ${ev.cutA.loc}!`, side: "a", ev });
      }
      if (ev.cutB) {
        const sev = ev.cutB.severity > 0.6 ? "Bad cut" : "Cut";
        lines.push({ type: "cut", text: `${sev} opened over ${nameB}'s ${ev.cutB.loc}!`, side: "b", ev });
      }
    }
    const winnerName = res.winner === "a" ? nameA : res.winner === "b" ? nameB : "";
    lines.push({ type: "result", text: res.reason === "Draw" ? "Draw." : `Fight over. ${winnerName} wins by ${res.reason}.` });
    return lines;
  }, [arenaFightResult]);

  // Keep speedMultRef in sync
  useEffect(() => { speedMultRef.current = speedMult; }, [speedMult]);

  // Stream commentary line-by-line and drive canvas animations
  useEffect(() => {
    if (!arenaFightResult?.events?.length || commentaryLinesToStream.length === 0) return;
    setLiveCommentary([]);
    setHpA(100); setHpB(100); setStamA(100); setStamB(100); setRound(1);
    fightStateRef.current = {
      fighterA: { anim: "idle", animStart: 0 }, fighterB: { anim: "idle", animStart: 0 },
      hpA: 100, hpB: 100, stamA: 100, stamB: 100, round: 1,
      showRoundCard: false, roundCardNum: 0, roundCardStart: 0,
      koCountdown: null, hitParticles: [], finished: false,
    };
    const baseDelays = { round: 320, exchange: 90, roundEnd: 140, kd: 1800, cut: 200, result: 650, clinch: 220, corner: 260, combo: 200, cutWarn: 200 };
    let i = 0;
    const schedule = () => {
      if (i >= commentaryLinesToStream.length) return;
      const line = commentaryLinesToStream[i];
      const baseMs = baseDelays[line.type] ?? 90;
      const ms = Math.max(20, baseMs / speedMultRef.current);
      const t = setTimeout(() => {
        setLiveCommentary((prev) => [...prev, line]);
        const fs = fightStateRef.current;
        const now = performance.now();
        if (line.ev) {
          fs.hpA = line.ev.hpA; fs.hpB = line.ev.hpB;
          fs.stamA = line.ev.stamA ?? fs.stamA; fs.stamB = line.ev.stamB ?? fs.stamB;
          fs.round = line.ev.round;
          setHpA(line.ev.hpA); setHpB(line.ev.hpB);
          setStamA(line.ev.stamA ?? fs.stamA); setStamB(line.ev.stamB ?? fs.stamB);
          setRound(line.ev.round);
        }
        // Drive canvas fighter animations
        if (line.type === "exchange" && line.side === "a" && line.ev) {
          fs.fighterA = { anim: line.ev.aPunch, animStart: now, landed: line.ev.aLanded };
          if (line.ev.aLanded) fs.fighterB = { anim: "hit", animStart: now };
          if (line.ev.aLanded) {
            for (let k=0;k<5;k++) fs.hitParticles.push({ x: canvasRef.current ? canvasRef.current.width * 0.57 : 365, y: canvasRef.current ? canvasRef.current.height * 0.38 : 200, vx: (Math.random()-0.5)*80, vy: -25-Math.random()*35, life: 0.5+Math.random()*0.3, born: now });
          }
        } else if (line.type === "exchange" && line.side === "b" && line.ev) {
          fs.fighterB = { anim: line.ev.bPunch, animStart: now, landed: line.ev.bLanded };
          if (line.ev.bLanded) fs.fighterA = { anim: "hit", animStart: now };
          if (line.ev.bLanded) {
            for (let k=0;k<5;k++) fs.hitParticles.push({ x: canvasRef.current ? canvasRef.current.width * 0.43 : 275, y: canvasRef.current ? canvasRef.current.height * 0.38 : 200, vx: (Math.random()-0.5)*80, vy: -25-Math.random()*35, life: 0.5+Math.random()*0.3, born: now });
          }
        } else if (line.type === "kd") {
          const side = line.side;
          if (side === "a") { fs.fighterA = { anim: "down", animStart: now }; fs.koCountdown = { side: "a", count: 0, start: now }; }
          if (side === "b") { fs.fighterB = { anim: "down", animStart: now }; fs.koCountdown = { side: "b", count: 0, start: now }; }
        } else if (line.type === "round") {
          fs.showRoundCard = true; fs.roundCardNum = line.round; fs.roundCardStart = now;
          fs.fighterA = { anim: "idle", animStart: now }; fs.fighterB = { anim: "idle", animStart: now };
          fs.koCountdown = null;
          setTimeout(() => { fs.showRoundCard = false; }, 1200 / speedMultRef.current);
        } else if (line.type === "result") {
          fs.finished = true;
          if (arenaFightResult.winner === "a") fs.fighterB = { anim: "ko", animStart: now };
          else if (arenaFightResult.winner === "b") fs.fighterA = { anim: "ko", animStart: now };
        }
        i++;
        schedule();
      }, ms);
      streamTimeoutsRef.current.push(t);
    };
    schedule();
    return () => { streamTimeoutsRef.current.forEach(clearTimeout); streamTimeoutsRef.current = []; };
  }, [arenaFightResult, commentaryLinesToStream]);

  // Canvas animation loop
  useEffect(() => {
    if (!arenaMatchId) return;
    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) { animFrameRef.current = requestAnimationFrame(render); return; }
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      const now = performance.now();
      const fs = fightStateRef.current;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#12121a"; ctx.fillRect(0, 0, W, H);

      const ring = drawRing(ctx, W, H);
      const fAx = ring.rl + ring.rw * 0.40, fAy = ring.rt + ring.rh * 0.55;
      const fBx = ring.rl + ring.rw * 0.60, fBy = ring.rt + ring.rh * 0.55;

      // Fighter animations — down/ko hold much longer than punches
      const punchDur = 350;
      const downDur = 1700;
      const koDur = 99999;
      const durA = (fs.fighterA.anim === "down") ? downDur : (fs.fighterA.anim === "ko") ? koDur : punchDur;
      const durB = (fs.fighterB.anim === "down") ? downDur : (fs.fighterB.anim === "ko") ? koDur : punchDur;
      const progA = fs.fighterA.animStart ? Math.min(1, (now - fs.fighterA.animStart) / durA) : 1;
      const progB = fs.fighterB.animStart ? Math.min(1, (now - fs.fighterB.animStart) / durB) : 1;
      const animA = progA >= 1 ? "idle" : fs.fighterA.anim;
      const animB = progB >= 1 ? "idle" : fs.fighterB.anim;

      drawFighter(ctx, fAx, fAy, "right", animA, progA, "rgba(180,155,90,0.85)", fs.hpA);
      drawFighter(ctx, fBx, fBy, "left", animB, progB, "rgba(180,60,50,0.85)", fs.hpB);
      drawHitParticles(ctx, fs.hitParticles, now);
      fs.hitParticles = fs.hitParticles.filter(p => (now - p.born)/1000 < p.life);

      const nameA = arenaMatchDetail?.a_username || me?.username || "You";
      const nameB = arenaMatchDetail?.b_username || "Opponent";
      drawCanvasBars(ctx, W, H, fs, nameA, nameB);

      if (fs.showRoundCard) {
        const rp = Math.min(1, (now - fs.roundCardStart) / 1200);
        drawRoundCard(ctx, W, H, fs.roundCardNum, rp);
      }
      if (fs.koCountdown) {
        const elapsed = (now - fs.koCountdown.start) / 1000;
        const count = Math.min(10, Math.floor(elapsed * 3.5) + 1);
        if (elapsed < 3.2) drawKOCountdown(ctx, W, H, count);
        else fs.koCountdown = null;
      }

      animFrameRef.current = requestAnimationFrame(render);
    };
    animFrameRef.current = requestAnimationFrame(render);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [arenaMatchId, arenaMatchDetail, me]);

  // Auto-scroll commentary to bottom as new lines appear
  useEffect(() => {
    commentaryEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [liveCommentary]);

  const fightLogLines = liveCommentary.length > 0 ? liveCommentary : null;

  if (arenaMatchId) {
    const nameA = arenaMatchDetail?.a_username || me?.username || "You";
    const nameB = arenaMatchDetail?.b_username || "Opponent";
    const m = arenaMatchDetail;
    const matchOver = m?.state === "finished" || gameState === "done";
    const showPostFight = matchOver && arenaFightResult && liveCommentary.length > 0;
    const statsA = arenaFightResult?.stats?.a;
    const statsB = arenaFightResult?.stats?.b;
    const sc = arenaFightResult?.scorecard;
    return (
      <div className={styles.page} style={{height:"100vh",overflow:"hidden",fontFamily:"'Cinzel',serif",display:"flex",flexDirection:"column"}}>
        <div className={styles.pageContent} style={{padding:"6px 10px",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid var(--noir-border-light)",minHeight:40}}>
          <Link to="/boxing" className={styles.btnPrimary} style={{padding:"8px 12px",minHeight:40,fontSize:10,textDecoration:"none",touchAction:"manipulation"}}>← Back</Link>
          <div style={{fontSize:11,letterSpacing:"0.12em",color:gold}}>{nameA} vs {nameB}</div>
          <div style={{display:"flex",gap:3}}>
            {[1,2,4].map(s=>(
              <button key={s} onClick={()=>setSpeedMult(s)} style={{
                padding:"6px 10px",minHeight:36,fontSize:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,
                background: speedMult===s ? "rgba(201,168,76,0.25)" : "rgba(255,255,255,0.03)",
                color: speedMult===s ? "#f0e0b0" : "#8a7a5a", cursor:"pointer", touchAction:"manipulation",
              }}>x{s}</button>
            ))}
          </div>
        </div>
        <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",background:"#12121a"}}>
          <div style={{position:"relative",width:"100%",maxWidth:720,margin:"0 auto",aspectRatio:"16/9",flexShrink:0}}>
            <canvas ref={canvasRef} width={640} height={360}
              style={{width:"100%",height:"100%",display:"block",borderBottom:"1px solid rgba(201,168,76,0.15)"}}
            />
          </div>
          <div style={{flex:1,overflow:"auto",padding:"8px 12px",fontSize:10,lineHeight:1.5,color:"#e0d0b0",minHeight:0}}>
            {!arenaFightResult && <div style={{textAlign:"center",color:"var(--noir-muted)",paddingTop:12}}>Simulating fight…</div>}
            {arenaFightResult && liveCommentary.length === 0 && <div style={{textAlign:"center",color:"var(--noir-muted)",paddingTop:12}}>Live commentary…</div>}
            {fightLogLines && fightLogLines.map((item, i) => (
              <div key={i} style={{
                marginBottom: item.type === "round" ? 6 : 1,
                fontWeight: item.type === "round" ? 700 : 400,
                color: item.type === "round" ? gold
                  : item.type === "kd" ? "#ff8888"
                  : item.type === "cut" || item.type === "cutWarn" ? "#cc6666"
                  : item.type === "combo" ? "#ffcc44"
                  : item.type === "clinch" ? "#88aacc"
                  : item.type === "corner" ? "#8aaa6a"
                  : item.type === "roundEnd" ? "#aa9a6a"
                  : item.type === "result" ? gold
                  : "#c8b898",
                fontSize: item.type === "round" ? 11 : item.type === "result" ? 11 : 10,
                fontStyle: item.type === "corner" ? "italic" : undefined,
              }}>{item.text}</div>
            ))}
            <div ref={commentaryEndRef} />
          </div>
          {showPostFight && (
            <div style={{flexShrink:0,padding:"10px 14px",paddingBottom:"max(10px, env(safe-area-inset-bottom))",borderTop:"1px solid rgba(201,168,76,0.2)",background:"rgba(0,0,0,0.6)"}}>
              {winText && <div style={{fontSize:12,color:gold,textAlign:"center",fontWeight:700,marginBottom:6}}>{winText}</div>}
              {matchOver && arenaServerResult && (() => {
                const wn = arenaServerResult.winner === m?.a_id ? nameA : nameB;
                const rs = (arenaServerResult.finish_reason || "decision").replace(/_/g, " ");
                return <div style={{fontSize:9,color:"#a09070",textAlign:"center",marginBottom:6}}>Official: {wn} wins by {rs}</div>;
              })()}
              {statsA && statsB && (
                <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:4,fontSize:9,color:"#d0c090",maxWidth:420,margin:"0 auto"}}>
                  <div style={{textAlign:"right"}}>{statsA.landed}/{statsA.thrown} ({statsA.thrown?Math.round(statsA.landed/statsA.thrown*100):0}%)</div>
                  <div style={{textAlign:"center",color:"#7a6a4a"}}>Punches</div>
                  <div>{statsB.landed}/{statsB.thrown} ({statsB.thrown?Math.round(statsB.landed/statsB.thrown*100):0}%)</div>
                  <div style={{textAlign:"right"}}>{statsA.dmg}</div>
                  <div style={{textAlign:"center",color:"#7a6a4a"}}>Total Dmg</div>
                  <div>{statsB.dmg}</div>
                  <div style={{textAlign:"right"}}>{statsA.kds}</div>
                  <div style={{textAlign:"center",color:"#7a6a4a"}}>Knockdowns</div>
                  <div>{statsB.kds}</div>
                </div>
              )}
              {sc && sc.a.length > 0 && (
                <div style={{marginTop:6,maxWidth:420,margin:"6px auto 0"}}>
                  <div style={{fontSize:9,color:"#7a6a4a",textAlign:"center",marginBottom:2}}>Scorecard</div>
                  <div style={{display:"flex",justifyContent:"center",gap:4,flexWrap:"wrap",fontSize:9}}>
                    {sc.a.map((sa, ri) => (
                      <div key={ri} style={{textAlign:"center",padding:"2px 4px",background:"rgba(255,255,255,0.03)",borderRadius:2,minWidth:28}}>
                        <div style={{color:"#7a6a4a"}}>R{ri+1}</div>
                        <div style={{color:sa > sc.b[ri] ? gold : sa < sc.b[ri] ? crimson : "#888"}}>{sa}-{sc.b[ri]}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{textAlign:"center",fontSize:10,color:gold,marginTop:4}}>
                    {sc.a.reduce((s,v)=>s+v,0)} - {sc.b.reduce((s,v)=>s+v,0)}
                  </div>
                </div>
              )}
            </div>
          )}
          {!showPostFight && winText && (
            <div style={{flexShrink:0,padding:"6px 10px",paddingBottom:"max(6px, env(safe-area-inset-bottom))",borderTop:"1px solid rgba(201,168,76,0.2)",background:"rgba(0,0,0,0.5)",textAlign:"center"}}>
              <div style={{fontSize:11,color:gold,fontWeight:700}}>{winText}</div>
            </div>
          )}
        </div>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap');
          @keyframes koCountPulse {
            0%   { transform: scale(1.35); opacity:0.4; }
            100% { transform: scale(1.0);  opacity:1; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className={styles.page} style={{minHeight:"100vh",fontFamily:"'Cinzel',serif",display:"flex",flexDirection:"column"}}>

      <div className={styles.pageContent} style={{borderBottom:"1px solid var(--noir-border-light)",padding:"10px 18px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:16,letterSpacing:"0.2em",color:"var(--noir-primary)"}}>BOXING GYM & LEAGUE</div>
          <div style={{fontSize:9,color:"var(--noir-muted)",letterSpacing:"0.12em"}}>TRAIN • UPGRADE • FIGHT • BET</div>
        </div>
      </div>

      <div className={styles.pageContent} style={{padding:"12px 16px 14px",display:"grid",gridTemplateColumns: narrowLayout ? "1fr" : "minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.2fr)",gap:16}}>
        <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90`} style={{minHeight:140}}>
          <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
            <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">Training & stats</h2>
          </div>
          <div className="p-2.5 sm:p-3">
          {metaError && <div style={{fontSize:10,color:"#ff6666",marginBottom:6}}>{metaError}</div>}
          {loadingMeta && !profile && (
            <div style={{fontSize:10,color:"#9a8a5a"}}>Loading boxing profile…</div>
          )}
          {profile && (
            <>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#bba46a",marginBottom:6}}>
                <span>Rating</span>
                <span>{profile.rating ?? 1000}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:4,fontSize:10,color:"#e0d0a0",marginBottom:8}}>
                {["power","speed","stamina","defense","accuracy","chin","recovery"].map((k)=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",background:"rgba(0,0,0,0.18)",padding:"4px 6px",borderRadius:2}}>
                    <span style={{textTransform:"uppercase",fontSize:9,color:"var(--noir-muted)"}}>{k}</span>
                    <span>{effective?.[k] ?? profile?.[k] ?? 1}</span>
                  </div>
                ))}
              </div>
              <div style={{fontSize:10,color:"var(--noir-muted)",letterSpacing:"0.08em",marginBottom:4}}>DRILLS</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {Object.entries(drills || {}).map(([id, d]) => {
                  const conf = (profile && profile.training && profile.training[id]) || d;
                  const lastAt = conf?.last_at;
                  const cooldownSec = typeof d.cooldown_seconds === "number" ? d.cooldown_seconds : 60;
                  let remainingSec = 0;
                  if (lastAt) {
                    try {
                      const readyAt = new Date(lastAt).getTime() + cooldownSec * 1000;
                      remainingSec = Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
                    } catch (_) { remainingSec = 0; }
                  }
                  const available = remainingSec <= 0;
                  const stamCost = d.stamina_cost != null ? d.stamina_cost : "";
                  const gainsStr = d.gains && typeof d.gains === "object" ? Object.entries(d.gains).map(([k, v]) => `+${v} ${k}`).join(", ") : "";
                  return (
                    <div key={id} style={{display:"flex",flexDirection:"column",gap:2}}>
                      <button
                        onClick={() => available && handleTrain(id)}
                        disabled={busyAction===`train:${id}` || !available}
                        style={{
                          padding:"10px 12px",minHeight:44,fontSize:narrowLayout?11:9,border:"1px solid rgba(201,168,76,0.35)",borderRadius:2,
                          background: available ? "rgba(255,255,255,0.02)" : "rgba(60,50,30,0.3)",
                          color: available ? "#e0d0a0" : "#7a6a4a",
                          cursor: available && busyAction!==`train:${id}` ? "pointer" : "default",
                          touchAction:"manipulation",
                        }}
                      >
                        {d.name || id.replace(/_/g," ")}
                        {available ? <span style={{marginLeft:4,color:"#8a9a6a"}}>Ready</span> : <span style={{marginLeft:4,color:"#6a5a4a"}}>{remainingSec}s</span>}
                      </button>
                      {(stamCost || gainsStr) && (
                        <div style={{fontSize:8,color:"#6a5a4a"}}>
                          {stamCost ? `${stamCost} stam` : ""}{stamCost && gainsStr ? " · " : ""}{gainsStr}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          </div>
        </div>

        <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90`} style={{minHeight:140,display:"flex",flexDirection:"column"}}>
          <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
            <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">Gym</h2>
          </div>
          <div className="p-2.5 sm:p-3 flex-1 flex flex-col gap-3">
          <div>
            {gymInfo && (
              <>
                <div style={{fontSize:11,color:"#e0d0a0",marginBottom:4}}>
                  {gymInfo.gym?.name || "Gym"} — Lv {gymInfo.gym_level ?? 0}
                </div>
                <button
                  onClick={handleGymUpgrade}
                  disabled={busyAction==="gym_upgrade"}
                  style={{padding:narrowLayout?"10px 14px":"4px 9px",minHeight:44,fontSize:narrowLayout?11:9,border:"1px solid rgba(201,168,76,0.45)",borderRadius:2,background:"rgba(201,168,76,0.08)",color:"#e0d0a0",cursor:busyAction==="gym_upgrade"?"wait":"pointer",touchAction:"manipulation"}}
                >
                  Upgrade gym
                </button>
                {gymInfo.gyms && gymInfo.gyms.length > 1 && (
                  <div style={{marginTop:8,fontSize:9,color:"var(--noir-muted)"}}>
                    Move gym:
                    <div style={{marginTop:4,display:"flex",flexWrap:"wrap",gap:4}}>
                      {gymInfo.gyms.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => handleGymMove(g.id)}
                          disabled={busyAction===`gym_move:${g.id}` || g.id===gymInfo.gym?.id}
                          style={{padding:narrowLayout?"10px 12px":"3px 7px",minHeight:44,fontSize:narrowLayout?11:9,border:"1px solid rgba(201,168,76,0.35)",borderRadius:2,background:g.id===gymInfo.gym?.id?"rgba(201,168,76,0.18)":"rgba(255,255,255,0.02)",color:"#e0d0a0",cursor:g.id===gymInfo.gym?.id?"default":"pointer",touchAction:"manipulation"}}
                        >
                          {g.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <div style={{fontSize:11,color:"var(--noir-primary)",letterSpacing:"0.16em",marginBottom:6}}>COACH</div>
            {coachInfo && (
              <>
                <div style={{fontSize:10,color:"var(--noir-muted)",marginBottom:4}}>Hire one coach at a time.</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {coachInfo.coaches?.map((c) => {
                    const isCurrent = coachInfo.coach_id === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => isCurrent ? handleCoachFire() : handleCoachHire(c.id)}
                        disabled={busyAction===`coach:${c.id}` || (busyAction==="coach_fire" && isCurrent)}
                        style={{padding:narrowLayout?"10px 12px":"4px 8px",minHeight:44,fontSize:narrowLayout?11:9,border:"1px solid rgba(201,168,76,0.35)",borderRadius:2,background:isCurrent?"rgba(201,168,76,0.18)":"rgba(255,255,255,0.02)",color:"#e0d0a0",cursor:(busyAction && !isCurrent)?"wait":"pointer",touchAction:"manipulation"}}
                      >
                        {isCurrent ? `FIRE ${c.name}` : c.name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          </div>
        </div>

        <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90`} style={{minHeight:140}}>
          <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
            <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">Gear</h2>
          </div>
          <div className="p-2.5 sm:p-3">
          {gearInfo && (
            <>
              {typeof gearInfo.total_wins === "number" && (
                <div style={{fontSize:10,color:"var(--noir-muted)",marginBottom:6}}>Wins: {gearInfo.total_wins}</div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(100px,1fr))",gap:6,fontSize:10}}>
                {(gearInfo.gear || []).map((g) => {
                  const owned = (gearInfo.owned_ids || []).includes(g.id);
                  const equippedSlot = gearInfo.equipped?.[g.slot];
                  const isEquipped = equippedSlot === g.id;
                  const unlocked = g.unlocked !== false;
                  const winsReq = g.wins_required;
                  const themeLabel = g.theme ? ` · ${g.theme}` : "";
                  const nameLine = (g.name || g.id) + themeLabel;
                  return (
                    <div key={g.id} style={{background: unlocked ? "rgba(255,255,255,0.02)" : "rgba(80,60,40,0.2)",borderRadius:3,padding:"6px 8px",border:isEquipped?"1px solid rgba(201,168,76,0.7)":"1px solid rgba(201,168,76,0.25)",minHeight:72,overflow:"hidden",display:"flex",flexDirection:"column",gap:4}}>
                      <div style={{fontSize:10,color:unlocked ? "#e0d0a0" : "#6a5a4a",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={nameLine}>{nameLine}</div>
                      <div style={{fontSize:9,color:"var(--noir-muted)",flexShrink:0}}>{g.slot}</div>
                      {!unlocked && winsReq != null && <div style={{fontSize:9,color:"#9a7a4a",flexShrink:0}}>Unlock at {winsReq} wins</div>}
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:"auto"}}>
                        {!owned && (
                          <button
                            onClick={() => unlocked && handleGearBuy(g.id)}
                            disabled={busyAction===`buy:${g.id}` || !unlocked}
                            style={{padding:narrowLayout?"8px 10px":"2px 6px",minHeight:narrowLayout?44:28,fontSize:narrowLayout?10:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:unlocked ? "rgba(201,168,76,0.08)" : "rgba(0,0,0,0.2)",color:unlocked ? "#e0d0a0" : "#5a4a3a",cursor:unlocked && busyAction!==`buy:${g.id}` ? "pointer" : "default",touchAction:"manipulation"}}
                          >
                            Buy
                          </button>
                        )}
                        {owned && !isEquipped && (
                          <button
                            onClick={() => unlocked && handleGearEquip(g.slot, g.id)}
                            disabled={busyAction===`equip:${g.slot}:${g.id}` || !unlocked}
                            style={{padding:narrowLayout?"8px 10px":"2px 6px",minHeight:narrowLayout?44:28,fontSize:narrowLayout?10:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:unlocked ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.2)",color:unlocked ? "#e0d0a0" : "#5a4a3a",cursor:unlocked && busyAction!==`equip:${g.slot}:${g.id}` ? "pointer" : "default",touchAction:"manipulation"}}
                          >
                            Equip
                          </button>
                        )}
                        {owned && isEquipped && (
                          <button
                            onClick={() => handleGearEquip(g.slot, null)}
                            disabled={busyAction===`equip:${g.slot}:none`}
                            style={{padding:narrowLayout?"8px 10px":"2px 6px",minHeight:narrowLayout?44:28,fontSize:narrowLayout?10:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:"rgba(201,168,76,0.22)",color:"#e0d0a0",cursor:busyAction===`equip:${g.slot}:none`?"wait":"pointer",touchAction:"manipulation"}}
                          >
                            Unequip
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          </div>
        </div>
      </div>

      <div className={styles.pageContent} style={{padding:"12px 16px 20px",borderTop:"1px solid var(--noir-border-light)",display:"grid",gridTemplateColumns: narrowLayout ? "1fr" : "minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,1.0fr)",gap:16}}>
        <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90`} style={{minHeight:120}}>
          <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20 flex items-center justify-between">
            <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">Matches</h2>
            <button onClick={refreshMatches} disabled={matchesLoading} className={styles.btnPrimary} style={{padding:narrowLayout?"10px 12px":"6px 10px",minHeight:36,fontSize:narrowLayout?11:9,cursor:matchesLoading?"wait":"pointer",touchAction:"manipulation"}}>Refresh</button>
          </div>
          <div className="p-2.5 sm:p-3">
          {matchError && <div style={{fontSize:9,color:"#ff6666",marginBottom:4}}>{matchError}</div>}
          <div style={{display:"flex",gap:4,marginBottom:6,flexWrap:"wrap"}}>
            <input
              value={opponentName}
              onChange={(e)=>setOpponentName(e.target.value)}
              placeholder="Challenge username (leave blank for open match)"
              className={styles.input}
              style={{flex:"0 0 160px",minWidth:120,minHeight:44,padding:"8px 10px",fontSize:narrowLayout?11:9}}
            />
            <button
              onClick={handleCreateMatch}
              disabled={busyAction==="create_match"}
              className={styles.btnPrimary}
              style={{minHeight:44,padding:narrowLayout?"10px 14px":"6px 12px",touchAction:"manipulation",cursor:busyAction==="create_match"?"wait":"pointer"}}
            >
              Start Match
            </button>
          </div>
          {npcs.length > 0 && (
            <div style={{marginBottom:6,fontSize:9,color:"var(--noir-muted)"}}>
              <div style={{marginBottom:2}}>Quick NPC fight:</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                {npcs.map((npc)=>(
                  <button
                    key={npc.id}
                    onClick={()=>startNpcFight(npc)}
                    disabled={npcFightState && !npcFightState.result}
                    className={styles.btnPrimary}
                    style={{padding:narrowLayout?"10px 12px":"6px 10px",minHeight:44,fontSize:narrowLayout?11:8,cursor:npcFightState && !npcFightState.result ? "wait" : "pointer",touchAction:"manipulation"}}
                  >
                    {npc.name}
                  </button>
                ))}
              </div>
              {npcFightState?.matchId && !npcFightState.result && (
                <div style={{marginTop:4,color:"#8a9a6a"}}>Fight vs {npcFightState.npcName} in progress…</div>
              )}
              {npcFightState?.result && npcFightState.result !== "error" && (
                <div style={{marginTop:4,color:npcFightState.result==="win"?"#6a9a4a":npcFightState.result==="loss"?"#aa4444":"var(--noir-muted)"}}>
                  {npcFightState.result==="win"?"You won":npcFightState.result==="loss"?"You lost":"Draw"} vs {npcFightState.npcName}{npcFightState.reason?` (${npcFightState.reason})`:""}
                  <button onClick={clearNpcResult} style={{marginLeft:6,padding:"1px 6px",fontSize:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:"rgba(255,255,255,0.03)",color:"#d4c890",cursor:"pointer"}}>OK</button>
                </div>
              )}
              {npcFightState?.result === "error" && (
                <div style={{marginTop:4,color:"#aa4444"}}>{npcFightState.message} <button onClick={clearNpcResult} style={{marginLeft:6,padding:"1px 6px",fontSize:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:"rgba(255,255,255,0.03)",color:"#d4c890",cursor:"pointer"}}>Dismiss</button></div>
              )}
            </div>
          )}
          <div style={{maxHeight:140,overflowY:"auto",fontSize:9}}>
            {liveMatches.length === 0 && <div style={{color:"#7a6a4a"}}>No pending or live fights.</div>}
            {liveMatches.map((m) => {
              const mine = me && (m.a_username === me.username || m.b_username === me.username);
              const canReady = mine && (m.state==="pending" || m.state==="ready");
              const canJoin = !mine && m.is_open && !m.b_username && (m.state==="pending" || m.state==="ready");
              return (
                <div key={m.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid rgba(201,168,76,0.08)"}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:9,color:mine?"#f5e8c8":"#d0c090"}}>
                      {m.a_username} vs {m.b_username} <span style={{color:"#7a6a4a"}}>• {m.state} R{Math.min(Number(m.round) || 0, Number(m.max_rounds) || 12)}/{m.max_rounds ?? 12}</span>
                    </div>
                    <div style={{fontSize:8,color:"var(--noir-muted)"}}>HP A {m.hp?.a ?? 0}/100 B {m.hp?.b ?? 0}/100 • Odds A {m.odds?.a ?? "-"} / B {m.odds?.b ?? "-"}</div>
                  </div>
                  <div style={{display:"flex",gap:3,flexShrink:0}}>
                    {canJoin && (
                      <button
                        onClick={()=>handleJoinMatch(m.id)}
                        disabled={busyAction===`join:${m.id}`}
                        className={styles.btnPrimary}
                        style={{padding:"2px 5px",fontSize:8,cursor:busyAction===`join:${m.id}`?"wait":"pointer"}}
                      >
                        Join
                      </button>
                    )}
                    {mine && m.state==="running" && (
                      <button
                        onClick={()=>navigate(`/boxing/arena/${m.id}`)}
                        className={styles.btnPrimary}
                        style={{padding:"2px 5px",fontSize:8,cursor:"pointer"}}
                      >
                        Watch
                      </button>
                    )}
                    {canReady && (
                      <button
                        onClick={()=>handleReadyMatch(m.id,true)}
                        disabled={busyAction===`ready:${m.id}`}
                        className={styles.btnPrimary}
                        style={{padding:"2px 5px",fontSize:8,cursor:busyAction===`ready:${m.id}`?"wait":"pointer"}}
                      >
                        Ready
                      </button>
                    )}
                    {!canReady && mine && (
                      <button
                        onClick={()=>handleReadyMatch(m.id,false)}
                        disabled={busyAction===`ready:${m.id}`}
                        className={styles.btnPrimary}
                        style={{padding:"2px 5px",fontSize:8,cursor:busyAction===`ready:${m.id}`?"wait":"pointer"}}
                      >
                        Unready
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </div>

        <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90`} style={{minHeight:140}}>
          <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
            <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">Betting</h2>
          </div>
          <div className="p-2.5 sm:p-3">
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <span style={{fontSize:9,color:"var(--noir-muted)"}}>Stake</span>
            <input
              type="number"
              value={betStake}
              onChange={(e)=>setBetStake(e.target.value)}
              className={styles.input}
              style={{width:90,padding:"3px 6px",fontSize:10}}
            />
          </div>
          <div style={{fontSize:9,color:"#7a6a4a",marginBottom:4}}>Click a fighter to bet:</div>
          <div style={{maxHeight:120,overflowY:"auto",fontSize:10,marginBottom:8}}>
            {liveMatches.length === 0 && <div style={{color:"#7a6a4a"}}>No fights open for betting.</div>}
            {liveMatches.map((m)=>(
              <div key={`bet-${m.id}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:"1px solid rgba(201,168,76,0.1)"}}>
                <div style={{marginRight:6}}>
                  <div style={{color:"#d0c090"}}>{m.a_username} vs {m.b_username}</div>
                  <div style={{fontSize:9,color:"#7a6a4a"}}>Odds A {m.odds?.a ?? "-"} / B {m.odds?.b ?? "-"}</div>
                </div>
                <div style={{display:"flex",gap:4}}>
                  <button
                    onClick={()=>handlePlaceBet(m.id,"a")}
                    disabled={busyAction===`bet:${m.id}:a`}
                    className={styles.btnPrimary}
                    style={{padding:"2px 6px",fontSize:9,cursor:busyAction===`bet:${m.id}:a`?"wait":"pointer"}}
                  >
                    Bet A
                  </button>
                  <button
                    onClick={()=>handlePlaceBet(m.id,"b")}
                    disabled={busyAction===`bet:${m.id}:b`}
                    className={styles.btnPrimary}
                    style={{padding:"2px 6px",fontSize:9,cursor:busyAction===`bet:${m.id}:b`?"wait":"pointer"}}
                  >
                    Bet B
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div style={{fontSize:9,color:"var(--noir-muted)",marginBottom:4}}>My bets</div>
          <div style={{maxHeight:90,overflowY:"auto",fontSize:10}}>
            {bets.length === 0 && <div style={{color:"#7a6a4a"}}>No open or settled bets.</div>}
            {bets.map((b)=>(
              <div key={b.id} style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}>
                <span style={{color:"#d0c090"}}>#{b.match_id.slice(0,6)} • {b.fighter.toUpperCase()}</span>
                <span style={{color:b.status==="won"?"#6a9a4a":b.status==="lost"?"#aa4444":"var(--noir-muted)"}}>{b.status} ${b.stake}</span>
              </div>
            ))}
          </div>
          </div>
        </div>

        <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90`} style={{minHeight:140}}>
          <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
            <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">League (weekly)</h2>
          </div>
          <div className="p-2.5 sm:p-3">
          {league && (
            <div style={{maxHeight:210,overflowY:"auto",fontSize:10}}>
              {league.standings?.slice(0,10).map((row)=>(
                <div key={row.user_id} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid rgba(201,168,76,0.1)",color:row.is_current_user?"#f5e8c8":"#d0c090"}}>
                  <span>#{row.rank} {row.username}</span>
                  <span>{row.points} pts · {row.wins}-{row.losses}</span>
                </div>
              ))}
            </div>
          )}
          {!league && <div style={{fontSize:10,color:"#7a6a4a"}}>League table will appear after fights are recorded.</div>}
          </div>
        </div>
      </div>

      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap');`}</style>
    </div>
  );
}
