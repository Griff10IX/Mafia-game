import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import * as THREE from "three";
import api from "../utils/api";
import styles from "../styles/noir.module.css";

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
  // ── FIGHTER INITIALISATION ──────────────────────────────────────────────────
  const init = (s) => ({
    ...s,
    hp: 100, stam: 100, kds: 0,
    // Personality: ranges 0–1
    aggression:  clamp((s.power  - s.defense)  / 60 + 0.42 + rand(-0.12, 0.12), 0.08, 0.95),
    pressure:    clamp((s.speed  - s.defense)  / 80 + 0.38 + rand(-0.1,  0.1),  0.08, 0.90),
    counterpunch:clamp((s.defense - s.power)   / 70 + 0.35 + rand(-0.1,  0.1),  0.05, 0.85),
    // Cut susceptibility: lower defense & chin = more likely to bleed
    cutSus:      clamp(1 - (s.defense||60)/130 + (1-(s.chin||65)/100)*0.3, 0.15, 0.85),
    // Active cuts: null | { loc, severity 0-1 }
    cut: null,
    cutRound: null,   // round first cut opened
    // cumulative cut worsening flag — cuts worsening can cause doctor stoppage
    docStopRisk: 0,
    // momentum: positive = this fighter winning recent exchanges
    momentum: 0,
  });

  const a = init(aS);
  const b = init(bS);
  const events = [];

  // Per-round fight logic
  for (let round=1; round<=12; round++) {
    // More exchanges early (feeling-out rounds), fewer deep in a long fight
    const baseEx = round <= 3 ? 9 : round <= 6 ? 8 : 7;
    const exchanges = baseEx + randInt(-1, 3);

    for (let i=0; i<exchanges; i++) {
      if (a.hp<=0 || b.hp<=0) break;

      // ── FIGHTER A ATTACKS ────────────────────────────────────────────────
      const apt = choosePunch(a);
      // Accuracy: speed advantage, fatigue, momentum (winning builds confidence)
      const aAcc = clamp(
        PUNCH_ACC[apt]
        + (a.speed - b.defense) / 520
        - (1 - a.stam/100) * 0.28        // fatigue tanks accuracy more
        + a.momentum * 0.04              // on a roll = sharper
        + (a.aggression - 0.5) * 0.06,
        0.10, 0.88
      );
      const aL = Math.random() < aAcc;
      let aDmg = 0, aKD = false, aCutEv = null;

      if (aL) {
        const [lo, hi] = PUNCH_DMG[apt];
        // Damage: power, opponent's remaining stamina, momentum
        const baseDmg = rand(lo, hi);
        aDmg = baseDmg * (a.power / 76)
             * (1 + (1 - b.stam/100) * 0.22)   // tired fighters absorb harder
             * (1 + a.momentum * 0.06);
        b.hp = Math.max(0, b.hp - aDmg);

        // Body shots: more stamina drain, less hp damage
        if (apt === "body") {
          b.stam = Math.max(0, b.stam - aDmg * 0.55);
          b.hp = Math.min(100, b.hp + aDmg * 0.25); // give back some hp for body
        }

        // Knockdown: power shots to the head, low chin, low stamina, on the chin
        const kdChance = apt !== "body"
          ? (aDmg / 26) * (1 - b.chin/100) * Math.pow(1 - b.stam/100, 0.7) * (1 + a.power/220)
          : 0;
        if (Math.random() < kdChance && b.hp > 0 && b.kds < 3) {
          b.kds++;
          b.hp = Math.max(1, b.hp - 4);
          aKD = true;
          a.momentum = Math.min(1, a.momentum + 0.4);
          b.momentum = Math.max(-1, b.momentum - 0.4);
        }

        // Cuts: hooks & crosses to the eye/cheek, worsening existing cuts
        if (apt !== "body") {
          const cutBase = PUNCH_CUT[apt] * b.cutSus;
          const cutBoost = b.cut ? 1.8 : 1.0;   // existing cuts re-open more easily
          if (Math.random() < cutBase * cutBoost) {
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
        // Miss: slight stamina cost, opponent momentum boost
        a.momentum = clamp(a.momentum - 0.03, -1, 1);
      }

      a.stam = Math.max(0, a.stam - PUNCH_STAM[apt] * (aL ? 1.0 : 0.38));

      // ── FIGHTER B ATTACKS ────────────────────────────────────────────────
      const bpt = choosePunch(b);
      const bAcc = clamp(
        PUNCH_ACC[bpt]
        + (b.speed - a.defense) / 520
        - (1 - b.stam/100) * 0.28
        + b.momentum * 0.04
        + (b.aggression - 0.5) * 0.06,
        0.10, 0.88
      );
      const bL = Math.random() < bAcc;
      let bDmg = 0, bKD = false, bCutEv = null;

      if (bL) {
        const [lo, hi] = PUNCH_DMG[bpt];
        const baseDmg = rand(lo, hi);
        bDmg = baseDmg * (b.power / 76)
             * (1 + (1 - a.stam/100) * 0.22)
             * (1 + b.momentum * 0.06);
        a.hp = Math.max(0, a.hp - bDmg);

        if (bpt === "body") {
          a.stam = Math.max(0, a.stam - bDmg * 0.55);
          a.hp = Math.min(100, a.hp + bDmg * 0.25);
        }

        const kdChance = bpt !== "body"
          ? (bDmg / 26) * (1 - a.chin/100) * Math.pow(1 - a.stam/100, 0.7) * (1 + b.power/220)
          : 0;
        if (Math.random() < kdChance && a.hp > 0 && a.kds < 3) {
          a.kds++;
          a.hp = Math.max(1, a.hp - 4);
          bKD = true;
          b.momentum = Math.min(1, b.momentum + 0.4);
          a.momentum = Math.max(-1, a.momentum - 0.4);
        }

        if (bpt !== "body") {
          const cutBase = PUNCH_CUT[bpt] * a.cutSus;
          const cutBoost = a.cut ? 1.8 : 1.0;
          if (Math.random() < cutBase * cutBoost) {
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
        b.momentum = clamp(b.momentum - 0.03, -1, 1);
      }

      b.stam = Math.max(0, b.stam - PUNCH_STAM[bpt] * (bL ? 1.0 : 0.38));

      // ── DOCTOR STOPPAGE — severe cut ends fight ─────────────────────────
      // Only outside the first round, only at round breaks (simulated as after exchange bursts)
      const docStop = i === exchanges - 1 && round > 1 && (
        (a.cut && a.cut.severity > 0.78 && a.docStopRisk > 1.4) ||
        (b.cut && b.cut.severity > 0.78 && b.docStopRisk > 1.4)
      );
      if (docStop && !aKD && !bKD) {
        // Determine who gets stopped by cut
        const aCutBad = a.cut && a.cut.severity > 0.78 && a.docStopRisk > 1.4;
        const bCutBad = b.cut && b.cut.severity > 0.78 && b.docStopRisk > 1.4;
        if (aCutBad) a.hp = 0;
        if (bCutBad) b.hp = 0;
      }

      const isFinal = a.hp<=0 || b.hp<=0 || a.kds>=3 || b.kds>=3;

      events.push({
        round,
        hpA: Math.round(a.hp),    hpB: Math.round(b.hp),
        stamA: Math.round(a.stam), stamB: Math.round(b.stam),
        aPunch: apt, aLanded: aL, aDmg: Math.round(aDmg*10)/10, aKD,
        bPunch: bpt, bLanded: bL, bDmg: Math.round(bDmg*10)/10, bKD,
        // cut events this exchange (null if no cut)
        cutA: bCutEv || null,   // cut opened ON fighter A (by B's punch)
        cutB: aCutEv || null,   // cut opened ON fighter B (by A's punch)
        // current cut severity snapshot for renderer
        cutStateA: a.cut ? {...a.cut} : null,
        cutStateB: b.cut ? {...b.cut} : null,
        isFinal,
      });

      if (isFinal) break;
    }

    // ── BETWEEN ROUNDS ────────────────────────────────────────────────────
    // Stamina recovery: cornerwork restores ~14–22% depending on stamina stat
    const aRec = 13 + (a.stamina||62)/100 * 15;
    const bRec = 13 + (b.stamina||62)/100 * 15;
    a.stam = Math.min(100, a.stam + aRec);
    b.stam = Math.min(100, b.stam + bRec);
    // Momentum decays toward neutral between rounds
    a.momentum *= 0.5;
    b.momentum *= 0.5;
    // Cuts swell between rounds — corner can slow it slightly
    if (a.cut) a.cut.severity = Math.min(1, a.cut.severity + 0.04);
    if (b.cut) b.cut.severity = Math.min(1, b.cut.severity + 0.04);

    if (a.hp<=0 || b.hp<=0 || a.kds>=3 || b.kds>=3) break;
  }

  // ── RESULT ────────────────────────────────────────────────────────────────
  let winner=null, reason="Decision";
  if (a.hp<=0 || a.kds>=3) {
    winner="b";
    // Doctor stoppage for cuts uses TKO ruling
    reason = a.kds>=3 ? "TKO" : (a.cut && a.cut.severity > 0.78 ? "TKO" : "KO");
  } else if (b.hp<=0 || b.kds>=3) {
    winner="a";
    reason = b.kds>=3 ? "TKO" : (b.cut && b.cut.severity > 0.78 ? "TKO" : "KO");
  } else {
    winner = "a"; // simplification: player (a) wins decisions
  }
  return {events, winner, reason};
}

// ── BUILD RING ───────────────────────────────────────────────────────────────
function buildRing(scene) {
  const mat = c => new THREE.MeshLambertMaterial({ color: c });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(7,0.15,7),mat(0x4a4540));
  floor.receiveShadow=true; scene.add(floor);
  const lm=new THREE.MeshBasicMaterial({color:0xe8d898,transparent:true,opacity:0.55});
  const cc=new THREE.Mesh(new THREE.RingGeometry(0.67,0.7,32),lm); cc.rotation.x=-Math.PI/2; cc.position.y=0.09; scene.add(cc);
  const postMat=mat(0xd9b85c), capMat=mat(0xfff2aa);
  [[-3.2,-3.2],[3.2,-3.2],[3.2,3.2],[-3.2,3.2]].forEach(([x,z])=>{
    const p=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,3.5,8),postMat); p.position.set(x,1.75,z); p.castShadow=true; scene.add(p);
    const c=new THREE.Mesh(new THREE.SphereGeometry(0.12,8,8),capMat); c.position.set(x,3.56,z); scene.add(c);
  });
  [0.9,1.6,2.3].forEach(y=>{
    const rm=mat(y===1.6?0xab3a3a:0xe8d078);
    // FIX: corrected rotation logic — when z1===z2 rope runs along X-axis → needs rotation.z=PI/2
    //                                — when x1===x2 rope runs along Z-axis → needs rotation.x=PI/2
    [[-3.2,-3.2,3.2,-3.2],[3.2,-3.2,3.2,3.2],[3.2,3.2,-3.2,3.2],[-3.2,3.2,-3.2,-3.2]].forEach(([x1,z1,x2,z2])=>{
      const len=Math.sqrt((x2-x1)**2+(z2-z1)**2);
      const rope=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,len,6),rm);
      rope.position.set((x1+x2)/2,y,(z1+z2)/2);
      if(z1===z2){
        // rope runs along X-axis
        rope.rotation.z=Math.PI/2;
      } else {
        // rope runs along Z-axis
        rope.rotation.x=Math.PI/2;
      }
      scene.add(rope);
    });
  });
  const base=new THREE.Mesh(new THREE.BoxGeometry(9,0.4,9),mat(0x2a2826)); base.position.y=-0.27; scene.add(base);
}

// ── BUILD BOXER ──────────────────────────────────────────────────────────────
function buildBoxer(scene, colorHex, skinHex=0xc8956a) {
  const g=new THREE.Group();
  const m=c=>new THREE.MeshLambertMaterial({color:c});

  const root=new THREE.Group(); g.add(root);

  // Legs
  const legL=new THREE.Group(); legL.position.set(-0.15,0.5,0); root.add(legL);
  {
    const upperLegL = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.58,0.22),m(0x111008));
    upperLegL.position.set(0,-0.29,0); legL.add(upperLegL);
    const lowerLegL = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.1,0.34),m(0x2a1a0a));
    lowerLegL.position.set(0,-0.62,0.06); legL.add(lowerLegL);
  }
  const legR=new THREE.Group(); legR.position.set(0.15,0.5,0); root.add(legR);
  {
    const upperLegR = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.58,0.22),m(0x111008));
    upperLegR.position.set(0,-0.29,0); legR.add(upperLegR);
    const lowerLegR = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.1,0.34),m(0x2a1a0a));
    lowerLegR.position.set(0,-0.62,0.06); legR.add(lowerLegR);
  }

  // Hips
  const hips=new THREE.Mesh(new THREE.BoxGeometry(0.58,0.28,0.3),m(colorHex));
  hips.position.set(0,0.64,0); root.add(hips);

  // Torso
  const torsoG=new THREE.Group(); torsoG.position.set(0,0.9,0); root.add(torsoG);
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.58,0.62,0.31),m(skinHex));
  torso.position.y=0.31; torso.castShadow=true; torsoG.add(torso);

  // Head group
  const headG=new THREE.Group(); headG.position.set(0,0.72,0); torsoG.add(headG);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.12,0.16,8),m(skinHex));
  neck.position.set(0,0.08,0); headG.add(neck);
  const head=new THREE.Mesh(new THREE.BoxGeometry(0.36,0.38,0.36),m(skinHex));
  head.position.y=0.29; head.castShadow=true; headG.add(head);
  const hg=new THREE.Mesh(new THREE.SphereGeometry(0.24,10,8),m(colorHex));
  hg.position.y=0.3; hg.scale.set(1,0.87,1); headG.add(hg);
  const em=new THREE.MeshBasicMaterial({color:0x000000});
  const eL=new THREE.Mesh(new THREE.SphereGeometry(0.042,6,6),em);
  eL.position.set(-0.09,0.32,0.18); headG.add(eL);
  const eR=new THREE.Mesh(new THREE.SphereGeometry(0.042,6,6),em);
  eR.position.set(0.09,0.32,0.18); headG.add(eR);

  // ── CUT / SWELLING GEOMETRY (hidden until activated) ──────────────────────
  const bloodMat = new THREE.MeshBasicMaterial({color:0x8b0000, transparent:true, opacity:0});
  const swellMat = new THREE.MeshLambertMaterial({color:0x9a5050, transparent:true, opacity:0});

  // Left eyebrow cut — small flattened ellipsoid
  const cutEyebrowL = new THREE.Mesh(new THREE.SphereGeometry(0.055,8,6), bloodMat.clone());
  cutEyebrowL.scale.set(1.4,0.5,0.7);
  cutEyebrowL.position.set(-0.10, 0.40, 0.18);
  headG.add(cutEyebrowL);

  // Right eyebrow cut
  const cutEyebrowR = new THREE.Mesh(new THREE.SphereGeometry(0.055,8,6), bloodMat.clone());
  cutEyebrowR.scale.set(1.4,0.5,0.7);
  cutEyebrowR.position.set(0.10, 0.40, 0.18);
  headG.add(cutEyebrowR);

  // Cheek cut (hook target)
  const cutCheek = new THREE.Mesh(new THREE.SphereGeometry(0.048,8,6), bloodMat.clone());
  cutCheek.scale.set(1.2,0.6,0.6);
  cutCheek.position.set(-0.17, 0.28, 0.15);
  headG.add(cutCheek);

  // Nose blood
  const cutNose = new THREE.Mesh(new THREE.SphereGeometry(0.038,6,6), bloodMat.clone());
  cutNose.position.set(0, 0.27, 0.20);
  headG.add(cutNose);

  // Eyebrow swelling (puffy eye)
  const swellEye = new THREE.Mesh(new THREE.SphereGeometry(0.065,8,6), swellMat.clone());
  swellEye.scale.set(1.5,0.6,0.7);
  swellEye.position.set(-0.10, 0.35, 0.17);
  headG.add(swellEye);

  // ── BLOOD DRIP PARTICLES ──────────────────────────────────────────────────
  // Pre-bake a small set of drip trails per cut location
  const drips = [];
  for (let i=0; i<8; i++) {
    const dg = new THREE.BufferGeometry();
    const pts = [];
    // Each drip: 6 points falling downward from cut location
    for (let j=0; j<6; j++) pts.push(rand(-0.06,0.06), 0.38 - j*0.055 - rand(0,0.02), 0.185);
    dg.setAttribute("position", new THREE.Float32BufferAttribute(pts,3));
    const dm = new THREE.LineBasicMaterial({color:0x660000,transparent:true,opacity:0,linewidth:1.5});
    const drip = new THREE.Line(dg, dm);
    drip.position.set(rand(-0.08,0.08), rand(-0.02,0.04), 0);
    headG.add(drip);
    drips.push(drip);
  }

  // Arms
  const armL=new THREE.Group(); armL.position.set(-0.4,0.54,0); torsoG.add(armL);
  const upperArmL=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.44,0.2),m(skinHex));
  upperArmL.position.set(0,-0.22,0); armL.add(upperArmL);
  const faL=new THREE.Group(); faL.position.set(0,-0.47,0); armL.add(faL);
  const forearmL=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.4,0.18),m(skinHex));
  forearmL.position.set(0,-0.2,0); faL.add(forearmL);
  const gloveL=new THREE.Mesh(new THREE.BoxGeometry(0.27,0.29,0.27),m(colorHex));
  gloveL.position.y=-0.45; faL.add(gloveL);

  const armR=new THREE.Group(); armR.position.set(0.4,0.54,0); torsoG.add(armR);
  const upperArmR=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.44,0.2),m(skinHex));
  upperArmR.position.set(0,-0.22,0); armR.add(upperArmR);
  const faR=new THREE.Group(); faR.position.set(0,-0.47,0); armR.add(faR);
  const forearmR=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.4,0.18),m(skinHex));
  forearmR.position.set(0,-0.2,0); faR.add(forearmR);
  const gloveR=new THREE.Mesh(new THREE.BoxGeometry(0.27,0.29,0.27),m(colorHex));
  gloveR.position.y=-0.45; faR.add(gloveR);

  g.position.y=0.25;
  scene.add(g);
  return {
    group:g, root, torsoG, headG, armL, faL, armR, faR, legL, legR, hips,
    // cut/blood refs
    cuts:{ eyebrowL:cutEyebrowL, eyebrowR:cutEyebrowR, cheek:cutCheek, nose:cutNose },
    swell:{ eye:swellEye },
    drips,
    // current cut state for animation
    cutState: { eyebrow:0, cheek:0, nose:0 },
  };
}

// ── CANVAS BLOOD SPATTER ─────────────────────────────────────────────────────
// Creates a small blood pool/streak on the canvas at world position (x, z)
function createSpatter(scene, x, z, size=0.08) {
  const pts = [];
  const n = 6 + Math.floor(size * 30);
  for (let i=0; i<n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(0, size);
    pts.push(x + Math.cos(a)*r, 0.082, z + Math.sin(a)*r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const m = new THREE.PointsMaterial({
    color: 0x660000, size: rand(0.022, 0.042),
    transparent: true, opacity: rand(0.55, 0.80),
  });
  const sp = new THREE.Points(g, m);
  scene.add(sp);
  return sp;
}
function applyCuts(bx, cutData, t) {
  if (!cutData || !bx.cuts) return;
  const sev = clamp(cutData.severity, 0, 1);
  const loc = cutData.loc;

  // Heartbeat pulse — blood oozes rhythmically
  const pulse = 0.88 + Math.sin(t * 2.4) * 0.10;

  // Reset all cut meshes each frame
  bx.cuts.eyebrowL.material.opacity = 0;
  bx.cuts.eyebrowR.material.opacity = 0;
  bx.cuts.cheek.material.opacity = 0;
  bx.cuts.nose.material.opacity = 0;
  bx.swell.eye.material.opacity = 0;

  if (loc === "eyebrow") {
    bx.cuts.eyebrowL.material.opacity = clamp(sev * pulse * 1.1, 0, 0.95);
    if (sev > 0.5) bx.cuts.eyebrowR.material.opacity = clamp((sev-0.5)*1.8 * pulse, 0, 0.75);
    bx.swell.eye.material.opacity = clamp(sev * 0.85, 0, 0.70);
    bx.swell.eye.scale.set(1.5 + sev*1.0, 0.6 + sev*0.65, 0.7 + sev*0.4);
  } else if (loc === "cheek") {
    bx.cuts.cheek.material.opacity = clamp(sev * pulse * 1.05, 0, 0.88);
    bx.swell.eye.material.opacity = clamp(sev * 0.45, 0, 0.40);
    bx.swell.eye.scale.set(1.5 + sev*0.4, 0.6 + sev*0.25, 0.7);
  } else if (loc === "nose") {
    bx.cuts.nose.material.opacity = clamp(sev * pulse * 1.3, 0, 0.98);
    if (sev > 0.6) bx.cuts.cheek.material.opacity = clamp((sev-0.6)*1.5, 0, 0.45);
  }

  // Blood drips — each with independent fall phase and speed
  const activeDrips = Math.ceil(sev * bx.drips.length);
  bx.drips.forEach((drip, i) => {
    if (i < activeDrips) {
      const speed = 0.55 + i * 0.12;
      const phase = (t * speed + i * 0.55) % 1.0;
      const fallAmt = Math.pow(phase, 1.4);
      drip.position.y = -fallAmt * 0.14;
      drip.material.opacity = clamp(sev * 0.8 * Math.sin(phase * Math.PI), 0, 0.80);
    } else {
      drip.material.opacity = 0;
    }
  });
}

// ── EASING HELPERS ────────────────────────────────────────────────────────────
function easeOutCubic(t) { return 1 - Math.pow(1-t, 3); }
function easeInOutCubic(t) { return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
function easeOutBack(t,s=1.4) { const c3=s+1; return 1+c3*Math.pow(t-1,3)+s*Math.pow(t-1,2); }

// ── ORTHODOX BOXING STANCE ────────────────────────────────────────────────────
// A (blue) is at -X facing +X  →  s=+1  left=lead right=rear
// B (red) is at +X facing -X   →  s=-1  left=lead right=rear
// In orthodox stance the body is turned ~45° so lead shoulder faces opponent.
// The model's +Z faces the opponent, so:
//   torso.rotation.y is the TURN (positive = turn left shoulder forward for A)
//   Arms: lead=left for both (local left arm extends toward opponent)
function resetGuard(bx, side) {
  const s = side==="a" ? 1 : -1;
  // Torso turned ~40° so lead shoulder points toward opponent
  bx.torsoG.rotation.set(-0.05, 0.40*s, 0);
  bx.headG.rotation.set(0, 0.10*s, 0);
  bx.hips.rotation.set(0, 0.18*s, 0);
  // Lead (left) arm: raised, elbow bent, glove at chin height
  bx.armL.rotation.set(-0.65, 0.06*s,  0.20*s);
  bx.faL.rotation.set(0.75, 0, 0);
  // Rear (right) arm: tighter to chin, elbow close to body
  bx.armR.rotation.set(-0.50, -0.08*s, -0.28*s);
  bx.faR.rotation.set(0.85, 0, 0);
  // Legs: lead leg forward (negative Z in local space), feet shoulder-width
  bx.legL.rotation.set(-0.12, 0, 0);  // lead leg slightly forward
  bx.legR.rotation.set( 0.10, 0, 0);  // rear leg slightly back
  bx.root.position.set(0, 0, 0);
  bx.group.rotation.z = 0;
}

// ── SMOOTH PUNCH ANIMATIONS ───────────────────────────────────────────────────
// p = 0→1 (full cycle: wind-up → extension → retraction)
// Punches extend toward +Z (toward opponent) in local space.
// Step-in is handled by txA/txB in the render loop — NOT by root.position.z here,
// to prevent the model origin from ever crossing the midpoint.
function applyPunch(bx, type, p, side) {
  const s = side==="a" ? 1 : -1;
  // Split the cycle: first 45% extend, last 55% retract (snap out, pull back slower)
  const extP   = clamp(p / 0.45, 0, 1);
  const retP   = clamp((p - 0.45) / 0.55, 0, 1);
  const ext    = p < 0.45 ? easeOutCubic(extP) : 1 - easeInOutCubic(retP);
  // Secondary motion — body parts that lag behind (follow-through)
  const lag    = p < 0.45 ? easeOutCubic(clamp(p/0.6,0,1)) : 1 - easeOutCubic(retP);
  resetGuard(bx, side);

  switch(type) {
    case "jab": {
      // Lead (left) arm snaps straight forward. Shoulder rotates, chin tucks.
      bx.armL.rotation.x  = -0.65 - ext*1.45;   // arm drives forward/up
      bx.armL.rotation.y  =  ext*0.12*s;         // slight inward path
      bx.armL.rotation.z  = (0.20 - ext*0.18)*s; // elbow tightens
      bx.faL.rotation.x   =  0.75 - ext*0.68;    // forearm straightens
      // Shoulder follows through — torso rotates slightly with jab
      bx.torsoG.rotation.y = 0.40*s - lag*0.20*s;
      bx.torsoG.rotation.z = lag*0.04*s;
      // Head tucks down behind lead shoulder
      bx.headG.rotation.x  = lag*0.08;
      bx.headG.rotation.y  = 0.10*s - lag*0.06*s;
      // Lead leg pushes off
      bx.legL.rotation.x   = -0.12 - ext*0.10;
      break;
    }
    case "cross": {
      // Rear (right) hand — pivot from back foot, full hip+shoulder rotation
      bx.armR.rotation.x   = -0.50 - ext*1.55;
      bx.armR.rotation.y   = -ext*0.18*s;
      bx.armR.rotation.z   = (-0.28 + ext*0.26)*s; // elbow clears, fist rotates
      bx.faR.rotation.x    =  0.85 - ext*0.78;
      // Large hip drive — the cross gets all its power from rotation
      bx.hips.rotation.y   =  0.18*s + lag*0.38*s;
      bx.torsoG.rotation.y =  0.40*s + lag*0.42*s; // shoulder comes forward
      bx.torsoG.rotation.x = -lag*0.06;
      bx.torsoG.rotation.z = -lag*0.07*s;           // shoulder dips into punch
      // Lead (guard) arm pulls back as counterweight
      bx.armL.rotation.x   = -0.65 + lag*0.18;
      bx.armL.rotation.y   =  0.06*s - lag*0.05*s;
      // Rear foot pivots
      bx.legR.rotation.x   =  0.10 + ext*0.14;
      bx.legR.rotation.y   =  ext*0.10*s;
      break;
    }
    case "hook": {
      // Lead hook — elbow rises to shoulder height, horizontal arc, hip torque
      // Wind-up: elbow rises and body coils; Release: whip through
      const coil   = clamp(p * 2.5, 0, 1);         // quick coil at start
      const whip   = ext;
      bx.armL.rotation.x   = -0.65 - whip*0.10;    // elbow level with shoulder
      bx.armL.rotation.z   = (0.20 + whip*1.20)*s; // sweeps horizontally
      bx.armL.rotation.y   =  whip*0.35*s;
      bx.faL.rotation.x    =  0.75 - whip*0.55;    // forearm stays roughly horizontal
      bx.faL.rotation.z    =  whip*0.15*s;
      // Torso whip is the engine — rear leg drives it
      bx.torsoG.rotation.y =  0.40*s - lag*0.62*s;
      bx.hips.rotation.y   =  0.18*s - lag*0.28*s;
      bx.torsoG.rotation.z =  lag*0.10*s;
      bx.torsoG.rotation.x =  lag*0.04;
      // Rear arm swings back for balance
      bx.armR.rotation.z   = (-0.28 - lag*0.20)*s;
      bx.legL.rotation.x   = -0.12 - whip*0.08;
      bx.legR.rotation.x   =  0.10 + whip*0.12;
      break;
    }
    case "uppercut": {
      // Rear uppercut — dip + drive upward, fist travels arc under guard
      const dip    = easeOutCubic(clamp(p * 3.0, 0, 1));  // fast dip
      const drive  = easeOutBack(clamp((p - 0.18) / 0.55, 0, 1), 0.8);
      const driveE = clamp((p - 0.18) / 0.55, 0, 1);
      bx.torsoG.rotation.x  =  dip*0.28 - easeInOutCubic(driveE)*0.22; // dip then rise
      bx.torsoG.rotation.y  =  0.40*s + easeInOutCubic(driveE)*0.38*s;
      bx.hips.rotation.y    =  0.18*s + easeInOutCubic(driveE)*0.24*s;
      // Rear arm scoops upward — starts low, finishes high
      bx.armR.rotation.x    = -0.50 - dip*0.45 + drive*1.65; // net: drives high
      bx.armR.rotation.z    = (-0.28 + easeInOutCubic(driveE)*0.22)*s;
      bx.faR.rotation.x     =  0.85 - dip*0.3 - easeInOutCubic(driveE)*0.95;
      // Lead arm dips with body then rises for guard
      bx.armL.rotation.x    = -0.65 - dip*0.20 + easeInOutCubic(driveE)*0.15;
      // Rear leg explodes upward
      bx.legR.rotation.x    =  0.10 + dip*0.18;
      bx.root.position.y    =  easeOutBack(clamp(driveE*1.3,0,1), 0.6) * 0.07;
      break;
    }
    case "body": {
      // Body shot — deep knee bend, torso drops, hooks into the ribs
      const dip    = easeOutCubic(clamp(p * 2.2, 0, 1));
      const retDip = 1 - easeInOutCubic(clamp((p - 0.45) / 0.55, 0, 1));
      const dipVal = p < 0.45 ? dip : retDip;
      bx.torsoG.rotation.x  =  ext*0.48;            // big forward lean
      bx.torsoG.rotation.y  =  0.40*s - ext*0.30*s;
      bx.torsoG.rotation.z  =  ext*0.10*s;
      bx.hips.rotation.y    =  0.18*s - ext*0.16*s;
      // Lead arm digs low — elbow flares out
      bx.armL.rotation.x    = -0.65 - ext*0.85;
      bx.armL.rotation.z    = (0.20 + ext*0.55)*s;
      bx.armL.rotation.y    =  ext*0.15*s;
      bx.faL.rotation.x     =  0.75 - ext*0.30;
      // Both knees bend — simulated with leg rotations
      bx.legL.rotation.x    = -0.12 + dipVal*0.32;
      bx.legR.rotation.x    =  0.10 + dipVal*0.30;
      bx.root.position.y    = -dipVal * 0.11;        // whole body sinks
      break;
    }
  }
}

// ── IDLE GUARD — realistic boxing bounce with weight shift ────────────────────
function applyIdle(bx, t, side) {
  const s = side==="a" ? 1 : -1;
  resetGuard(bx, side);
  // Primary bounce — weight transfer between feet
  const bounce  = Math.sin(t * 3.8) * 0.028;
  const sway    = Math.sin(t * 2.5) * 0.018;      // lateral weight shift
  const breathe = Math.sin(t * 1.1) * 0.008;      // slow breathing chest rise
  bx.root.position.y = bounce;
  bx.root.position.x = sway;
  // Legs alternate — lead steps forward, rear pushes off
  bx.legL.rotation.x = -0.12 + Math.sin(t * 3.8 + 0.8) * 0.10;
  bx.legR.rotation.x =  0.10 + Math.sin(t * 3.8) * 0.10;
  // Arms subtly move with breathing/balance
  bx.armL.rotation.x = -0.65 + Math.sin(t * 3.8 + 0.4) * 0.04;
  bx.armR.rotation.x = -0.50 + Math.sin(t * 3.8 + 1.2) * 0.03;
  // Head bobs and subtly watches opponent
  bx.headG.rotation.x = breathe * 0.5;
  bx.torsoG.rotation.x = -0.05 + breathe;
}

// ── HIT REACTIONS — snappy snap with exponential decay ────────────────────────
function applyHit(bx, type, intensity, age, side) {
  const s = side==="a" ? 1 : -1;
  // Fast snap then slow fade
  const decay = Math.exp(-age * 11) * intensity;
  const slow  = Math.exp(-age * 4)  * intensity * 0.3; // lingering sway
  switch(type) {
    case "jab":
      bx.headG.rotation.y += -decay * 0.55 * s;   // head snaps away
      bx.headG.rotation.z +=  decay * 0.22 * s;
      bx.torsoG.rotation.y += -slow * 0.18 * s;
      break;
    case "cross":
      bx.headG.rotation.y += -decay * 0.75 * s;   // bigger snap
      bx.headG.rotation.x +=  decay * 0.20;
      bx.headG.rotation.z +=  decay * 0.30 * s;
      bx.torsoG.rotation.y += -slow * 0.22 * s;
      bx.torsoG.rotation.z +=  slow * 0.08 * s;
      break;
    case "hook":
      bx.headG.rotation.y += -decay * 1.0 * s;    // hard snap to side
      bx.headG.rotation.z +=  decay * 0.45 * s;
      bx.torsoG.rotation.y += -slow * 0.30 * s;
      bx.torsoG.rotation.z +=  slow * 0.12 * s;
      break;
    case "uppercut":
      bx.headG.rotation.x +=  decay * 0.65;        // head snaps back and up
      bx.headG.rotation.z +=  decay * 0.15 * s;
      bx.torsoG.rotation.x += -slow * 0.20;
      break;
    case "body":
      bx.torsoG.rotation.x +=  decay * 0.50;       // body folds
      bx.torsoG.rotation.y += -slow * 0.14 * s;
      bx.headG.rotation.x  +=  slow  * 0.18;
      break;
  }
}

// ── KNOCKDOWN (get-up after ~3s) ─────────────────────────────────────────────
function applyKnockdown(bx, t, side) {
  const f=clamp(t,0,1);
  const tipAngle = (side==="a"?-1:1)*f*1.45;
  bx.group.rotation.z = tipAngle;
  const yLift = Math.abs(Math.sin(tipAngle)) * 0.55;
  bx.group.position.y = 0.25 + yLift * f;
  bx.torsoG.rotation.x=f*0.55;
  bx.armL.rotation.x=-0.35+f*1.1;
  bx.armR.rotation.x=-0.35+f*0.8;
}

// ── KO FALL — multi-phase collapse ───────────────────────────────────────────
// phase 0-0.15: stagger back (still upright, lurching)
// phase 0.15-0.45: knees buckle, body crumples forward-sideways
// phase 0.45-0.75: torso crashes to canvas with impact
// phase 0.75-1.0:  body settles / slight bounce, arm flops out
function applyKOFall(bx, t, side) {
  const s = side==="a" ? 1 : -1;
  resetGuard(bx, side);

  if (t < 0.15) {
    // Stagger — head snaps back, body lurches
    const f = t / 0.15;
    bx.headG.rotation.x = f * 0.55;
    bx.headG.rotation.z = f * 0.18 * s;
    bx.torsoG.rotation.x = -f * 0.2;          // lean back
    bx.torsoG.rotation.z = f * 0.08 * s;
    bx.root.position.x = f * 0.18 * s;        // stumble sideways
    bx.root.position.z = f * 0.12;            // stumble back
    bx.armL.rotation.x = -0.35 + f * 0.4;
    bx.armR.rotation.x = -0.35 + f * 0.4;
    bx.group.position.y = 0.25;
  } else if (t < 0.45) {
    // Buckle — knees give way, whole body sinks and tips
    const f = (t - 0.15) / 0.30;
    const ease = f * f;                        // accelerate as gravity takes over
    bx.torsoG.rotation.x = -0.2 + ease * 0.9; // tips forward
    bx.torsoG.rotation.z = (0.08 + ease * 0.6) * s;
    bx.headG.rotation.x = 0.55 - ease * 0.3;
    bx.headG.rotation.z = (0.18 + ease * 0.2) * s;
    bx.legL.rotation.x = ease * 0.5;
    bx.legR.rotation.x = ease * 0.5;
    bx.armL.rotation.x = 0.05 + ease * 0.6;
    bx.armR.rotation.x = 0.05 + ease * 0.3;
    bx.armL.rotation.z = (0.24 + ease * 0.8) * s;
    // Sink toward canvas
    bx.group.position.y = 0.25 - ease * 0.15;
    bx.root.position.x = (0.18 + ease * 0.22) * s;
    bx.root.position.z = 0.12 + ease * 0.1;
    // Begin tipping group
    bx.group.rotation.z = -ease * 0.7 * s;
  } else if (t < 0.75) {
    // Impact — slam to canvas
    const f = (t - 0.45) / 0.30;
    const ease = 1 - Math.pow(1 - f, 2);      // decelerate at impact
    const fullTip = 1.52;
    bx.group.rotation.z = -(0.7 + ease * (fullTip - 0.7)) * s;
    // Y: compute canvas-resting height from tip angle
    const tip = Math.abs(0.7 + ease * (fullTip - 0.7));
    bx.group.position.y = 0.25 + Math.sin(tip) * 0.52;
    // Arms fly out on impact
    bx.torsoG.rotation.x = 0.7 + ease * 0.4;
    bx.armL.rotation.x = 0.65 + ease * 0.7;
    bx.armR.rotation.x = 0.35 + ease * 0.5;
    bx.armL.rotation.z = (1.04 - ease * 0.3) * s;
    bx.armR.rotation.z = (-0.24 - ease * 0.6) * s;
    bx.faL.rotation.x = -0.2 + ease * 0.5;
    bx.faR.rotation.x = ease * 0.4;
    bx.headG.rotation.x = 0.25 + ease * 0.45;
    bx.legL.rotation.x = 0.5 + ease * 0.3;
    bx.legR.rotation.x = 0.5 + ease * 0.2;
    bx.root.position.x = 0.4 * s;
  } else {
    // Settle — slight bounce, arm flop, body at rest on canvas
    const f = (t - 0.75) / 0.25;
    const bounce = Math.sin(f * Math.PI) * 0.04 * (1 - f); // small bounce
    const fullTip = 1.52;
    bx.group.rotation.z = -fullTip * s;
    bx.group.position.y = 0.25 + Math.sin(fullTip) * 0.52 + bounce;
    bx.torsoG.rotation.x = 1.1;
    bx.armL.rotation.x = 1.35 + bounce * 3;   // arm bounces on canvas
    bx.armR.rotation.x = 0.85;
    bx.armL.rotation.z = 0.74 * s;
    bx.armR.rotation.z = -0.84 * s;
    bx.faL.rotation.x = 0.3;
    bx.faR.rotation.x = 0.4;
    bx.headG.rotation.x = 0.7;
    bx.legL.rotation.x = 0.8;
    bx.legR.rotation.x = 0.7;
    bx.root.position.x = 0.4 * s;
  }
}

// ── KO FLOOR — static rest pose on canvas ────────────────────────────────────
function applyKOFloor(bx, side) {
  applyKOFall(bx, 1.0, side); // just use settle phase statically
}

// ── VICTORY POSE — winner raises both hands ───────────────────────────────────
function applyVictoryPose(bx, t, side) {
  const s = side==="a" ? 1 : -1;
  const f = clamp(t * 1.8, 0, 1);
  const sway = Math.sin(t * 2.2) * 0.03;
  resetGuard(bx, side);
  // Both arms raise high — left punches sky, right follows
  bx.armL.rotation.x = -0.35 - f * 1.65;
  bx.armR.rotation.x = -0.35 - f * 1.55;
  bx.armL.rotation.z = (0.24 - f * 0.5) * s;
  bx.armR.rotation.z = (-0.24 + f * 0.5) * s;
  bx.faL.rotation.x = 0.55 - f * 0.4;
  bx.faR.rotation.x = 0.55 - f * 0.4;
  bx.torsoG.rotation.y = sway;
  bx.torsoG.rotation.x = -f * 0.12;          // slight proud lean-back
  bx.headG.rotation.x = -f * 0.08;
  bx.group.position.y = 0.25;
  bx.group.rotation.z = 0;
}

// ── FIGHTERS DATA ────────────────────────────────────────────────────────────
const FIGHTERS=[
  {name:"Tommy 'The Bull' Moran",  power:82,speed:66,stamina:74,defense:60,chin:70,color:0x1a4a9a,colorCSS:"#2a5aaa"},
  {name:"Sal 'Switchblade' Ricci", power:68,speed:84,stamina:78,defense:76,chin:62,color:0x9a1a1a,colorCSS:"#bb2222"},
];

// ── COMPONENT ─────────────────────────────────────────────────────────────────
export default function Boxing3D() {
  const canvasRef = useRef(null);
  const refs = useRef({
    renderer:null, scene:null, camera:null,
    bA:null, bB:null,
    fight:null,
    clock: new THREE.Clock(false),
    phase:"idle",
    evIdx:0,
    evTimer:0,
    pA:null,
    pB:null,
    hA:null,
    hB:null,
    kdA:0,
    kdB:0,
    xA:-0.90, xB:0.90,
    txA:-0.90, txB:0.90,
    // KO sequence
    koPhase: null,   // null | { side:"a"|"b", t:0, stage:"fall"|"count"|"done", count:0, countTimer:0, isTKO:false }
    victoryT: 0,
    // live cut state — updated from events, read every frame by applyCuts
    cutStateA: null,   // null | { loc, severity }
    cutStateB: null,
    // blood splatter particles on canvas
    spatters: [],
  });

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

  const { matchId: arenaMatchId } = useParams();
  const navigate = useNavigate();
  const [arenaMatchDetail, setArenaMatchDetail] = useState(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [arenaServerResult, setArenaServerResult] = useState(null);
  const arenaStartedRef = useRef(false);
  const prevArenaMatchIdRef = useRef(undefined);

  const flashMsg=(msg,ms=1600)=>{ setActionText(msg); setTimeout(()=>setActionText(""),ms); };
  const getErr = (e) => e?.response?.data?.detail || e?.message || "Something went wrong";

  // When returning from arena to gym: clear npc fight state (so buttons work) and refresh match list
  useEffect(() => {
    const wasInArena = prevArenaMatchIdRef.current != null && prevArenaMatchIdRef.current !== "";
    prevArenaMatchIdRef.current = arenaMatchId;
    if (wasInArena && !arenaMatchId) {
      setNpcFightState(null);
      refreshMatches();
    }
  }, [arenaMatchId]);

  useEffect(() => {
    if (!arenaMatchId) return;
    setArenaServerResult(null);
    arenaStartedRef.current = false;
    api.get(`/boxing/matches/${arenaMatchId}`).then((r) => {
      setArenaMatchDetail(r.data?.match || null);
    }).catch(() => setArenaMatchDetail(null));
  }, [arenaMatchId]);

  useEffect(() => {
    if (!arenaMatchId) return;
    const poll = () => {
      api.get(`/boxing/matches/${arenaMatchId}`).then((r) => {
        const m = r.data?.match;
        if (m && m.state === "finished") setArenaServerResult({ winner: m.winner, finish_reason: m.finish_reason || "" });
      }).catch(() => {});
    };
    const id = setInterval(poll, 2000);
    poll();
    return () => clearInterval(id);
  }, [arenaMatchId]);

  useEffect(() => {
    if (!arenaMatchId || !sceneReady || !refs.current.bA || !arenaMatchDetail || arenaStartedRef.current) return;
    arenaStartedRef.current = true;
    const opponentName = arenaMatchDetail.b_username || "";
    const npc = (npcs || []).find((n) => n.name === opponentName) || (npcs && npcs[0]) || null;
    startFight(npc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arenaMatchId, sceneReady, arenaMatchDetail?.id, npcs?.length]);

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
    return () => { if (npcPollRef.current) clearInterval(npcPollRef.current); };
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

  useEffect(()=>{
    if(!arenaMatchId) return;
    const canvas=canvasRef.current; if(!canvas) return;
    setSceneReady(false);
    const W=canvas.clientWidth||640, H=canvas.clientHeight||440;

    const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H,false);
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.toneMapping=THREE.ReinhardToneMapping;
    renderer.toneMappingExposure=2.4;

    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0x1e1e2e);
    scene.fog=new THREE.FogExp2(0x141420,0.012);

    const camera=new THREE.PerspectiveCamera(52,W/H,0.1,80);
    camera.position.set(0,2.9,7.4); camera.lookAt(0,1.1,0);

    scene.add(new THREE.AmbientLight(0x554d48,1.9));
    const spot=new THREE.SpotLight(0xfff8e8,8.5,32,Math.PI/3.6,0.25);
    spot.position.set(0,10,1); spot.target.position.set(0,0,0);
    spot.castShadow=true; spot.shadow.mapSize.set(1024,1024);
    scene.add(spot); scene.add(spot.target);
    const fl1=new THREE.PointLight(0xd9b85c,1.8,22); fl1.position.set(-6,5,4); scene.add(fl1);
    const fl2=new THREE.PointLight(0xa03030,1.0,18); fl2.position.set(6,5,4); scene.add(fl2);
    const fl3=new THREE.PointLight(0x5a6070,0.9,16); fl3.position.set(0,2,-5); scene.add(fl3);

    buildRing(scene);

    const bA=buildBoxer(scene,FIGHTERS[0].color,0xc8956a);
    const bB=buildBoxer(scene,FIGHTERS[1].color,0xb07850);
    bA.group.position.set(-0.90,0.25,0);
    bB.group.position.set(0.90,0.25,0);
    // FIX: boxers face each other correctly
    // Boxer model faces +Z by default. A is at -X, needs to face +X → rotation.y = +PI/2
    // B is at +X, needs to face -X → rotation.y = -PI/2
    bA.group.rotation.y = Math.PI/2;
    bB.group.rotation.y = -Math.PI/2;

    // Crowd
    const cg=new THREE.BufferGeometry();
    const cp=[]; for(let i=0;i<500;i++){const a=Math.random()*Math.PI*2,r=8+Math.random()*7;cp.push(r*Math.cos(a),1.2+Math.random()*4,r*Math.sin(a));}
    cg.setAttribute("position",new THREE.Float32BufferAttribute(cp,3));
    const crowd=new THREE.Points(cg,new THREE.PointsMaterial({color:0xc9a84c,size:0.14,transparent:true,opacity:0.28}));
    scene.add(crowd);

    const r=refs.current;
    r.renderer=renderer; r.scene=scene; r.camera=camera;
    r.bA=bA; r.bB=bB; r.crowd=crowd;
    r.spatters=[]; r.cutStateA=null; r.cutStateB=null;
    r.clock.start();
    setSceneReady(true);

    const onResize=()=>{
      const w=canvas.clientWidth,h=canvas.clientHeight;
      renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
    };
    window.addEventListener("resize",onResize);

    const PUNCH_SPEED=2.6; // smoother, more visible punches

    let raf;
    const loop=()=>{
      raf=requestAnimationFrame(loop);
      const dt=Math.min(r.clock.getDelta(),0.05);
      const t=r.clock.getElapsedTime();
      if(!r.bA||!r.bB){renderer.render(scene,camera);return;}
      const {bA,bB}=r;

      crowd.rotation.y+=0.0006;

      r.xA=lerp(r.xA,r.txA,dt*9);
      r.xB=lerp(r.xB,r.txB,dt*9);
      bA.group.position.x=r.xA;
      bB.group.position.x=r.xB;

      if(r.phase==="idle"||r.phase==="done"){
        // In done phase: winner celebrates, loser stays on floor
        if(r.phase==="done" && r.koPhase){
          const ko=r.koPhase;
          const downBx = ko.side==="a"?bA:bB;
          const upBx   = ko.side==="a"?bB:bA;
          applyKOFloor(downBx, ko.side);
          r.victoryT += dt;
          applyVictoryPose(upBx, r.victoryT, ko.side==="a"?"b":"a");
        } else {
          applyIdle(bA,t,"a"); applyIdle(bB,t,"b");
        }
        renderer.render(scene,camera); return;
      }

      // ── KO SEQUENCE PHASE ──────────────────────────────────────────────────
      if(r.phase==="ko"){
        const ko=r.koPhase;
        const downBx = ko.side==="a"?bA:bB;
        const upBx   = ko.side==="a"?bB:bA;

        if(ko.stage==="fall"){
          ko.t += dt / 1.1;  // fall takes 1.1 seconds
          applyKOFall(downBx, clamp(ko.t,0,1), ko.side);
          // winner backs away to neutral corner
          if(ko.side==="a"){ r.txA=-(1.8); r.txB=1.6; }
          else              { r.txB=1.8;  r.txA=-1.6; }
          applyIdle(upBx, t, ko.side==="a"?"b":"a");
          if(ko.t >= 1.0){
            ko.stage="count";
            ko.count=0;
            ko.countTimer=0.85;  // first count after ~0.85s
            // snap to floor pose
            applyKOFloor(downBx, ko.side);
          }
        } else if(ko.stage==="count"){
          applyKOFloor(downBx, ko.side);
          applyIdle(upBx, t, ko.side==="a"?"b":"a");
          ko.countTimer -= dt;
          if(ko.countTimer <= 0){
            ko.count++;
            setKoCount({ count: ko.count, side: ko.side,
              name: (ko.side==="a" ? r.fight?.nameA : r.fight?.nameB) || "FIGHTER",
              tko: ko.isTKO });
            // TKO: ref waves off at 8 (fighter can't defend), else full 10
            const stopAt = ko.isTKO ? 8 : 10;
            if(ko.count >= stopAt){
              ko.stage="done";
              setKoCount(null);
              r.phase="done";
              r.victoryT=0;
              setGameState("done");
              const res=r.fight;
              const nameA=res?.nameA||FIGHTERS[0].name;
              const nameB=res?.nameB||FIGHTERS[1].name;
              const winSide = ko.side==="a"?"b":"a";
              const wName = winSide==="a"?nameA:nameB;
              setWinText(`${wName.split(" ")[0]} WINS — ${ko.isTKO?"TKO":"KO"}`);
            } else {
              // Real boxing count rhythm: slightly slower at 8-9-10
              const slow = ko.count >= 7 ? 1.3 : 1.0;
              ko.countTimer = slow;
            }
          }
        }
        renderer.render(scene,camera);
        return;
      }

      // ── NORMAL KNOCKDOWNS (get-up variety) — blocked during KO ──
      if(r.kdA>0 && r.phase==="fighting"){
        r.kdA-=dt;
        const getUp=r.kdA<0.7;
        const prog=getUp?1-(r.kdA/0.7):clamp((2.8-r.kdA)/0.6,0,1);
        applyKnockdown(bA,prog,"a");
        r.txA=-1.65;
        if(r.kdA<=0){bA.group.rotation.z=0;bA.group.position.y=0.25;r.txA=-1.05;}
      } else if(r.phase==="fighting") { bA.group.position.y=0.25; bA.group.rotation.z=0; }

      if(r.kdB>0 && r.phase==="fighting"){
        r.kdB-=dt;
        const getUp=r.kdB<0.7;
        const prog=getUp?1-(r.kdB/0.7):clamp((2.8-r.kdB)/0.6,0,1);
        applyKnockdown(bB,prog,"b");
        r.txB=1.65;
        if(r.kdB<=0){bB.group.rotation.z=0;bB.group.position.y=0.25;r.txB=1.05;}
      } else if(r.phase==="fighting") { bB.group.position.y=0.25; bB.group.rotation.z=0; }

      // ── PUNCH ANIMATIONS — blocked during KO ──
      let aPunching=false, bPunching=false;

      if(r.pA&&r.kdA<=0&&r.phase==="fighting"){
        aPunching=true;
        r.pA.p=Math.min(1,r.pA.p+dt*PUNCH_SPEED);
        applyPunch(bA,r.pA.type,r.pA.p,"a");
        // Step in but never past -0.58 — keeps ~1.16 unit gap (no headbutting)
        const stepA = r.pA.type==="body"?0.16 : r.pA.type==="hook"?0.18 : 0.22;
        r.txA = -0.76 + Math.sin(r.pA.p*Math.PI) * stepA;
        if(r.pA.p>=1){r.pA=null; r.txA=-0.90;}
      }
      if(r.pB&&r.kdB<=0&&r.phase==="fighting"){
        bPunching=true;
        r.pB.p=Math.min(1,r.pB.p+dt*PUNCH_SPEED);
        applyPunch(bB,r.pB.type,r.pB.p,"b");
        const stepB = r.pB.type==="body"?0.16 : r.pB.type==="hook"?0.18 : 0.22;
        r.txB = 0.76 - Math.sin(r.pB.p*Math.PI) * stepB;
        if(r.pB.p>=1){r.pB=null; r.txB=0.90;}
      }

      // ── HIT REACTIONS ──
      if(r.hA){
        r.hA.age+=dt;
        applyHit(bA,r.hA.type,r.hA.intensity,r.hA.age,"a");
        if(r.hA.age>0.75) r.hA=null;
      }
      if(r.hB){
        r.hB.age+=dt;
        applyHit(bB,r.hB.type,r.hB.intensity,r.hB.age,"b");
        if(r.hB.age>0.75) r.hB=null;
      }

      if(!aPunching&&r.kdA<=0&&r.phase==="fighting") applyIdle(bA,t,"a");
      if(!bPunching&&r.kdB<=0&&r.phase==="fighting") applyIdle(bB,t,"b");

      // ── EVENT DISPATCH ──
      if(r.phase==="fighting"&&r.fight){
        r.evTimer-=dt;
        if(r.evTimer<=0&&!r.pA&&!r.pB&&r.evIdx<r.fight.events.length){
          const ev=r.fight.events[r.evIdx++];
          setHpA(ev.hpA); setHpB(ev.hpB); setStamA(ev.stamA); setStamB(ev.stamB); setRound(ev.round);

          // ── FINAL EVENT — go straight to KO/TKO/Decision, no more punches ──
          if(ev.isFinal && (r.fight.reason==="KO"||r.fight.reason==="TKO")){
            // Show the finishing punch animation for the winner only, no reply
            const res = r.fight;
            const downSide = res.winner==="a" ? "b" : "a";
            // Only queue the winning punch, block the loser's punch
            if(downSide==="b" && r.kdA<=0) r.pA={type:ev.aPunch,p:0};
            if(downSide==="a" && r.kdB<=0) r.pB={type:ev.bPunch,p:0};
            // Hit reaction on the loser
            const hitDelay = 170;
            if(downSide==="b" && ev.aLanded) setTimeout(()=>{ r.hB={type:ev.aPunch,intensity:2.0,age:0}; },hitDelay);
            if(downSide==="a" && ev.bLanded) setTimeout(()=>{ r.hA={type:ev.bPunch,intensity:2.0,age:0}; },hitDelay);
            // After winning punch finishes, start KO sequence
            // Duration = 1/PUNCH_SPEED seconds for punch + small buffer
            const koDelay = Math.round((1/2.6 + 0.35) * 1000);
            setTimeout(()=>{
              if(r.phase!=="fighting") return; // guard against double-fire
              r.pA=null; r.pB=null; r.kdA=0; r.kdB=0; // kill any lingering timers
              r.phase="ko";
              const downName = downSide==="a"?(res.nameA||FIGHTERS[0].name):(res.nameB||FIGHTERS[1].name);
              r.koPhase={ side:downSide, t:0, stage:"fall", count:0, countTimer:0, isTKO:res.reason==="TKO" };
              flashMsg(`💥 ${downName.split(" ")[0].toUpperCase()} IS DOWN!`, 2200);
            }, koDelay);
            // Set a long evTimer so nothing else fires while we wait
            r.evTimer=999;
            return; // skip normal event processing below
          }

          // ── NORMAL EVENT ──
          if(r.kdA<=0) r.pA={type:ev.aPunch,p:0};
          setTimeout(()=>{ if(r.kdB<=0&&r.phase==="fighting") r.pB={type:ev.bPunch,p:0}; },110);

          if(ev.aLanded) setTimeout(()=>{ if(r.phase==="fighting") r.hB={type:ev.aPunch,intensity:clamp(ev.aDmg/13,0.3,1.6),age:0}; },170);
          if(ev.bLanded) setTimeout(()=>{ if(r.phase==="fighting") r.hA={type:ev.bPunch,intensity:clamp(ev.bDmg/13,0.3,1.6),age:0}; },270);

          // ── CUT EVENTS — update live cut state & create canvas blood ──
          if(ev.cutA) {
            r.cutStateA = ev.cutA;   // { loc, severity } — cut on fighter A
            const bxPos = r.bA?.group?.position;
            if(bxPos && r.scene) {
              const sz = 0.05 + ev.cutA.severity * 0.10;
              const sp = createSpatter(r.scene, bxPos.x + rand(-0.15,0.15), bxPos.z + rand(-0.15,0.15), sz);
              r.spatters.push(sp);
            }
            const aName = (r.fight?.nameA||FIGHTERS[0].name).split(" ")[0];
            flashMsg(`🩸 ${aName.toUpperCase()} CUT — ${ev.cutA.loc.toUpperCase()}`, 1400);
          }
          if(ev.cutB) {
            r.cutStateB = ev.cutB;   // cut on fighter B
            const bxPos = r.bB?.group?.position;
            if(bxPos && r.scene) {
              const sz = 0.05 + ev.cutB.severity * 0.10;
              const sp = createSpatter(r.scene, bxPos.x + rand(-0.15,0.15), bxPos.z + rand(-0.15,0.15), sz);
              r.spatters.push(sp);
            }
            const bName = (r.fight?.nameB||FIGHTERS[1].name).split(" ")[0];
            flashMsg(`🩸 ${bName.toUpperCase()} CUT — ${ev.cutB.loc.toUpperCase()}`, 1400);
          }
          // Always sync persistent cut state from snapshot (covers worsening cuts with no new flash)
          if(ev.cutStateA) r.cutStateA = ev.cutStateA;
          if(ev.cutStateB) r.cutStateB = ev.cutStateB;

          // Mid-fight knockdowns (get-up variety — not the final KO)
          if(ev.aKD && !ev.isFinal){ setTimeout(()=>{ if(r.phase==="fighting"){r.kdA=2.9;r.txA=-1.65;} },200); const na=(r.fight.nameA||FIGHTERS[0].name).split(" ")[0].toUpperCase(); flashMsg(`⚡ ${na} IS DOWN!`); }
          if(ev.bKD && !ev.isFinal){ setTimeout(()=>{ if(r.phase==="fighting"){r.kdB=2.9;r.txB=1.65;} },200); const nb=(r.fight.nameB||FIGHTERS[1].name).split(" ")[0].toUpperCase(); flashMsg(`⚡ ${nb} IS DOWN!`); }

          if(!ev.aKD&&ev.aLanded&&ev.aDmg>14) flashMsg(`💥 ${(r.fight.nameA||FIGHTERS[0].name).split("'")[1]?.split("'")[0] || (r.fight.nameA||FIGHTERS[0].name).split(" ")[0]} lands big!`,900);
          else if(!ev.bKD&&ev.bLanded&&ev.bDmg>14) flashMsg(`💢 ${(r.fight.nameB||FIGHTERS[1].name).split("'")[1]?.split("'")[0] || (r.fight.nameB||FIGHTERS[1].name).split(" ")[0]} fires back!`,900);

          const kdDelay=(ev.aKD||ev.bKD)?3.1:0;
          r.evTimer=0.38+Math.random()*0.22+kdDelay;
        }

        // ── FIGHT OVER — decision (non KO/TKO) ──
        if(r.evIdx>=r.fight.events.length&&!r.pA&&!r.pB&&r.evTimer<500){
          const res=r.fight;
          if(res.reason!=="KO"&&res.reason!=="TKO"){
            r.phase="done"; setGameState("done");
            const nameA=res.nameA||FIGHTERS[0].name; const nameB=res.nameB||FIGHTERS[1].name;
            const wName=res.winner==="a"?nameA:res.winner==="b"?nameB:"";
            setWinText(res.reason==="Draw"?"DRAW":`${wName.split(" ")[0]} WINS — ${res.reason}`);
          }
        }
      }

      // ── APPLY CUTS & BLOOD EVERY FRAME ──
      if(r.bA && r.cutStateA) applyCuts(r.bA, r.cutStateA, t);
      if(r.bB && r.cutStateB) applyCuts(r.bB, r.cutStateB, t);

      // KO blood pool — grow a large spatter under downed fighter
      if(r.phase==="ko" && r.koPhase?.stage==="count" && r.scene) {
        const ko = r.koPhase;
        const downBxGroup = ko.side==="a" ? r.bA?.group : r.bB?.group;
        if(downBxGroup && Math.random() < dt * 0.35) {
          const sp = createSpatter(r.scene, downBxGroup.position.x + rand(-0.08,0.08), downBxGroup.position.z + rand(-0.08,0.08), 0.06);
          r.spatters.push(sp);
        }
      }

      renderer.render(scene,camera);
    };
    loop();

    return()=>{ setSceneReady(false); cancelAnimationFrame(raf); window.removeEventListener("resize",onResize); renderer.dispose(); };
  },[arenaMatchId]);

  const startFight = (npcForB) => {
    const baseA = FIGHTERS[0];
    const baseB = FIGHTERS[1];

    const scaleStat = (v, base) => {
      const n = Number(v || 1);
      if (!Number.isFinite(n)) return base;
      return Math.max(45, Math.min(95, 45 + n * 3));
    };

    const youStats = effective || profile || null;
    const npc = npcForB != null ? npcForB : (npcs && npcs[0]) || null;

    const simA = youStats ? {
      name: (me?.username ? `${me.username.toUpperCase()}` : baseA.name),
      power: scaleStat(youStats.power, baseA.power),
      speed: scaleStat(youStats.speed, baseA.speed),
      stamina: scaleStat(youStats.stamina, baseA.stamina),
      defense: scaleStat(youStats.defense, baseA.defense),
      chin: 65,
    } : baseA;

    const simB = npc ? {
      name: npc.name,
      power: scaleStat(npc.power, baseB.power),
      speed: scaleStat(npc.speed, baseB.speed),
      stamina: scaleStat(npc.stamina, baseB.stamina),
      defense: scaleStat(npc.defense, baseB.defense),
      chin: scaleStat(npc.accuracy ?? 5, 60),
    } : baseB;

    const result=simulateFight(simA, simB);
    result.nameA = simA.name;
    result.nameB = simB.name;
    const r=refs.current;
    r.fight=result; r.phase="fighting"; r.evIdx=0; r.evTimer=0.6;
    r.cutStateA=null; r.cutStateB=null; r.spatters=[];
    r.pA=null; r.pB=null; r.hA=null; r.hB=null;
    r.kdA=0; r.kdB=0; r.xA=-0.90; r.xB=0.90; r.txA=-0.90; r.txB=0.90;
    r.koPhase=null; r.victoryT=0;
    setKoCount(null);
    // FIX: also apply corrected rotations in startFight reset
    if(r.bA){r.bA.group.position.set(-0.90,0.25,0);r.bA.group.rotation.set(0,Math.PI/2,0);}
    if(r.bB){r.bB.group.position.set(0.90,0.25,0);r.bB.group.rotation.set(0,-Math.PI/2,0);}
    setHpA(100);setHpB(100);setStamA(100);setStamB(100);setRound(1);
    setGameState("fighting");setWinText("");setActionText("");
  };

  const gold="#d4af37",crimson="#b5463c";

  const Bar=({val,flip,color})=>(
    <div style={{height:5,background:"rgba(255,255,255,0.07)",borderRadius:2,overflow:"hidden"}}>
      <div style={{width:`${val}%`,height:"100%",background:color,borderRadius:2,transition:"width 0.3s",marginLeft:flip?"auto":undefined}}/>
    </div>
  );

  if (arenaMatchId) {
    const nameA = arenaMatchDetail?.a_username || me?.username || "You";
    const nameB = arenaMatchDetail?.b_username || "Opponent";
    return (
      <div className={styles.page} style={{height:"100vh",overflow:"hidden",fontFamily:"'Cinzel',serif",display:"flex",flexDirection:"column"}}>
        <div className={styles.pageContent} style={{padding:"6px 12px",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid var(--noir-border-light)"}}>
          <Link to="/boxing" className={styles.btnGoldDarkText} style={{padding:"4px 10px",fontSize:10,textDecoration:"none"}}>← Back to gym</Link>
          <div style={{fontSize:12,letterSpacing:"0.12em",color:gold}}>{nameA} vs {nameB}</div>
          <div style={{width:70}}/>
        </div>
        <div style={{flex:1,minHeight:0,position:"relative",display:"flex",flexDirection:"column"}}>
          <canvas
            ref={canvasRef}
            style={{width:"100%",height:"100%",minHeight:200,display:"block",background:"#181822"}}
          />
          <div style={{position:"absolute",left:0,right:0,bottom:0,padding:"4px 10px 6px",background:"linear-gradient(transparent,rgba(0,0,0,0.9))",pointerEvents:"none",flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",maxWidth:640,margin:"0 auto",gap:8}}>
              <div style={{width:90,fontSize:9,color:gold}}>{nameA}</div>
              <div style={{flex:1,padding:"0 8px",minWidth:0}}>
                <Bar val={hpA} flip={false} color={gold} />
                <div style={{fontSize:8,color:"#8a7a4a",marginTop:1}}>HP {hpA}/100</div>
              </div>
              <div style={{fontSize:10,color:"#c9a84c",minWidth:44,textAlign:"center"}}>R{round}/12</div>
              <div style={{flex:1,padding:"0 8px",minWidth:0}}>
                <Bar val={hpB} flip={true} color={crimson} />
                <div style={{fontSize:8,color:"#8a7a4a",marginTop:1,textAlign:"right"}}>HP {hpB}/100</div>
              </div>
              <div style={{width:90,fontSize:9,color:crimson,textAlign:"right"}}>{nameB}</div>
            </div>
            {actionText && <div style={{fontSize:10,color:"#fff",textAlign:"center",marginTop:3}}>{actionText}</div>}
            {gameState==="done" && winText && <div style={{fontSize:12,color:gold,textAlign:"center",marginTop:3,fontWeight:700}}>{winText}</div>}
          </div>
          {/* KO COUNT OVERLAY — centred on canvas, not in bottom bar */}
          {koCount && (
            <div style={{
              position:"absolute", inset:0, display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center", pointerEvents:"none",
            }}>
              {/* Darkening vignette */}
              <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.55) 100%)"}}/>
              {/* Count box */}
              <div style={{
                position:"relative", textAlign:"center",
                animation:"koCountPulse 0.18s ease-out",
              }}>
                <div style={{
                  fontSize:"clamp(18px,4vw,28px)", letterSpacing:"0.35em", color:"#c9a84c",
                  fontFamily:"'Cinzel',serif", textShadow:"0 0 18px rgba(201,168,76,0.7)",
                  marginBottom:4,
                }}>
                  {koCount.tko ? "REF STOPS FIGHT" : "REFEREE COUNT"}
                </div>
                <div style={{
                  fontSize:"clamp(64px,14vw,110px)", fontWeight:700, lineHeight:1,
                  fontFamily:"'Cinzel',serif", color:"#fff",
                  textShadow:"0 0 40px rgba(255,80,80,0.9), 0 4px 0 rgba(0,0,0,0.8)",
                  letterSpacing:"0.05em",
                }}>
                  {koCount.count}
                </div>
                <div style={{
                  fontSize:"clamp(11px,2.2vw,16px)", letterSpacing:"0.2em", color:"#e0d0a0",
                  marginTop:6, textShadow:"0 2px 8px rgba(0,0,0,0.8)",
                }}>
                  {koCount.name.toUpperCase()} IS DOWN
                </div>
                {koCount.count >= 8 && !koCount.tko && (
                  <div style={{
                    fontSize:"clamp(10px,2vw,13px)", color:"#ff8888", marginTop:6,
                    letterSpacing:"0.15em", animation:"koCountPulse 0.3s ease-out",
                  }}>
                    {koCount.count === 8 ? "CAN HE BEAT THE COUNT?" : koCount.count === 9 ? "LAST CHANCE!" : ""}
                  </div>
                )}
              </div>
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
          <div style={{fontSize:16,letterSpacing:"0.2em",color:gold}}>BOXING GYM & LEAGUE</div>
          <div style={{fontSize:9,color:"#6a5a3a",letterSpacing:"0.12em"}}>TRAIN • UPGRADE • FIGHT • BET</div>
        </div>
      </div>

      <div className={styles.pageContent} style={{padding:"18px 20px 12px",display:"grid",gridTemplateColumns:"minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.2fr)",gap:16}}>
        <div className={styles.panel} style={{padding:12,minHeight:140}}>
          <div style={{fontSize:11,color:gold,letterSpacing:"0.16em",marginBottom:6}}>TRAINING & STATS</div>
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
                {["power","speed","stamina","defense","accuracy"].map((k)=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",background:"rgba(0,0,0,0.18)",padding:"4px 6px",borderRadius:2}}>
                    <span style={{textTransform:"uppercase",fontSize:9,color:"#8a7a4a"}}>{k}</span>
                    <span>{effective?.[k] ?? profile?.[k] ?? 1}</span>
                  </div>
                ))}
              </div>
              <div style={{fontSize:10,color:"#8a7a4a",letterSpacing:"0.08em",marginBottom:4}}>DRILLS</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {Object.entries(drills || {}).map(([id, d]) => {
                  const conf = (profile && profile.training && profile.training[id]) || d;
                  const lastAt = conf?.last_at;
                  return (
                    <button
                      key={id}
                      onClick={() => handleTrain(id)}
                      disabled={busyAction===`train:${id}`}
                      style={{padding:"4px 8px",fontSize:9,border:"1px solid rgba(201,168,76,0.35)",borderRadius:2,background:"rgba(255,255,255,0.02)",color:"#e0d0a0",cursor:busyAction===`train:${id}`?"wait":"pointer"}}
                    >
                      {d.name || id.replace(/_/g," ")}
                      {lastAt && <span style={{marginLeft:4,color:"#777"}}>• trained</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className={styles.panel} style={{padding:12,minHeight:140,display:"flex",flexDirection:"column",gap:10}}>
          <div>
            <div style={{fontSize:11,color:gold,letterSpacing:"0.16em",marginBottom:6}}>GYM</div>
            {gymInfo && (
              <>
                <div style={{fontSize:11,color:"#e0d0a0",marginBottom:4}}>
                  {gymInfo.gym?.name || "Gym"} — Lv {gymInfo.gym_level ?? 0}
                </div>
                <button
                  onClick={handleGymUpgrade}
                  disabled={busyAction==="gym_upgrade"}
                  style={{padding:"4px 9px",fontSize:9,border:"1px solid rgba(201,168,76,0.45)",borderRadius:2,background:"rgba(201,168,76,0.08)",color:"#e0d0a0",cursor:busyAction==="gym_upgrade"?"wait":"pointer"}}
                >
                  Upgrade gym
                </button>
                {gymInfo.gyms && gymInfo.gyms.length > 1 && (
                  <div style={{marginTop:8,fontSize:9,color:"#8a7a4a"}}>
                    Move gym:
                    <div style={{marginTop:4,display:"flex",flexWrap:"wrap",gap:4}}>
                      {gymInfo.gyms.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => handleGymMove(g.id)}
                          disabled={busyAction===`gym_move:${g.id}` || g.id===gymInfo.gym?.id}
                          style={{padding:"3px 7px",fontSize:9,border:"1px solid rgba(201,168,76,0.35)",borderRadius:2,background:g.id===gymInfo.gym?.id?"rgba(201,168,76,0.18)":"rgba(255,255,255,0.02)",color:"#e0d0a0",cursor:g.id===gymInfo.gym?.id?"default":"pointer"}}
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
            <div style={{fontSize:11,color:gold,letterSpacing:"0.16em",marginBottom:6}}>COACH</div>
            {coachInfo && (
              <>
                <div style={{fontSize:10,color:"#8a7a4a",marginBottom:4}}>Hire one coach at a time.</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {coachInfo.coaches?.map((c) => {
                    const isCurrent = coachInfo.coach_id === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => isCurrent ? handleCoachFire() : handleCoachHire(c.id)}
                        disabled={busyAction===`coach:${c.id}` || (busyAction==="coach_fire" && isCurrent)}
                        style={{padding:"4px 8px",fontSize:9,border:"1px solid rgba(201,168,76,0.35)",borderRadius:2,background:isCurrent?"rgba(201,168,76,0.18)":"rgba(255,255,255,0.02)",color:"#e0d0a0",cursor:(busyAction && !isCurrent)?"wait":"pointer"}}
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

        <div className={styles.panel} style={{padding:12,minHeight:140}}>
          <div style={{fontSize:11,color:gold,letterSpacing:"0.16em",marginBottom:6}}>GEAR</div>
          {gearInfo && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:6,fontSize:10}}>
              {gearInfo.gear?.map((g) => {
                const owned = (gearInfo.owned_ids || []).includes(g.id);
                const equippedSlot = gearInfo.equipped?.[g.slot];
                const isEquipped = equippedSlot === g.id;
                return (
                  <div key={g.id} style={{background:"rgba(255,255,255,0.02)",borderRadius:3,padding:"4px 6px",border:isEquipped?"1px solid rgba(201,168,76,0.7)":"1px solid rgba(201,168,76,0.25)"}}>
                    <div style={{fontSize:10,color:"#e0d0a0"}}>{g.name}</div>
                    <div style={{fontSize:9,color:"#8a7a4a",marginBottom:3}}>{g.slot}</div>
                    <div style={{display:"flex",gap:4}}>
                      {!owned && (
                        <button
                          onClick={() => handleGearBuy(g.id)}
                          disabled={busyAction===`buy:${g.id}`}
                          style={{padding:"2px 6px",fontSize:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:"rgba(201,168,76,0.08)",color:"#e0d0a0",cursor:busyAction===`buy:${g.id}`?"wait":"pointer"}}
                        >
                          Buy
                        </button>
                      )}
                      {owned && !isEquipped && (
                        <button
                          onClick={() => handleGearEquip(g.slot, g.id)}
                          disabled={busyAction===`equip:${g.slot}:${g.id}`}
                          style={{padding:"2px 6px",fontSize:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:"rgba(255,255,255,0.02)",color:"#e0d0a0",cursor:busyAction===`equip:${g.slot}:${g.id}`?"wait":"pointer"}}
                        >
                          Equip
                        </button>
                      )}
                      {owned && isEquipped && (
                        <button
                          onClick={() => handleGearEquip(g.slot, null)}
                          disabled={busyAction===`equip:${g.slot}:none`}
                          style={{padding:"2px 6px",fontSize:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:"rgba(201,168,76,0.22)",color:"#e0d0a0",cursor:busyAction===`equip:${g.slot}:none`?"wait":"pointer"}}
                        >
                          Unequip
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className={styles.pageContent} style={{padding:"12px 20px 26px",borderTop:"1px solid var(--noir-border-light)",display:"grid",gridTemplateColumns:"minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,1.0fr)",gap:16}}>
        <div className={styles.panel} style={{padding:12,minHeight:140}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <div style={{fontSize:11,color:gold,letterSpacing:"0.16em"}}>MATCHES</div>
            <button onClick={refreshMatches} disabled={matchesLoading} className={styles.btnGoldDarkText} style={{padding:"2px 8px",fontSize:9,cursor:matchesLoading?"wait":"pointer"}}>Refresh</button>
          </div>
          {matchError && <div style={{fontSize:10,color:"#ff6666",marginBottom:6}}>{matchError}</div>}
          <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
            <input
              value={opponentName}
              onChange={(e)=>setOpponentName(e.target.value)}
              placeholder="Challenge username (leave blank for open match)"
              className={styles.input}
              style={{flex:"0 0 180px",minWidth:140,padding:"4px 6px",fontSize:10}}
            />
            <button
              onClick={handleCreateMatch}
              disabled={busyAction==="create_match"}
              className={styles.btnPrimary}
              style={{padding:"4px 10px",fontSize:10,cursor:busyAction==="create_match"?"wait":"pointer"}}
            >
              Start Match
            </button>
          </div>
          {npcs.length > 0 && (
            <div style={{marginBottom:8,fontSize:9,color:"#8a7a4a"}}>
              <div style={{marginBottom:4}}>Quick NPC fight:</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {npcs.map((npc)=>(
                  <button
                    key={npc.id}
                    onClick={()=>startNpcFight(npc)}
                    disabled={npcFightState && !npcFightState.result}
                    className={styles.btnGoldDarkText}
                    style={{padding:"3px 8px",fontSize:9,cursor:npcFightState && !npcFightState.result ? "wait" : "pointer"}}
                  >
                    {npc.name}
                  </button>
                ))}
              </div>
              {npcFightState?.matchId && !npcFightState.result && (
                <div style={{marginTop:4,color:"#8a9a6a"}}>Fight vs {npcFightState.npcName} in progress…</div>
              )}
              {npcFightState?.result && npcFightState.result !== "error" && (
                <div style={{marginTop:4,color:npcFightState.result==="win"?"#6a9a4a":npcFightState.result==="loss"?"#aa4444":"#8a7a4a"}}>
                  {npcFightState.result==="win"?"You won":npcFightState.result==="loss"?"You lost":"Draw"} vs {npcFightState.npcName}{npcFightState.reason?` (${npcFightState.reason})`:""}
                  <button onClick={clearNpcResult} style={{marginLeft:6,padding:"1px 6px",fontSize:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:"rgba(255,255,255,0.03)",color:"#d4c890",cursor:"pointer"}}>OK</button>
                </div>
              )}
              {npcFightState?.result === "error" && (
                <div style={{marginTop:4,color:"#aa4444"}}>{npcFightState.message} <button onClick={clearNpcResult} style={{marginLeft:6,padding:"1px 6px",fontSize:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:"rgba(255,255,255,0.03)",color:"#d4c890",cursor:"pointer"}}>Dismiss</button></div>
              )}
            </div>
          )}
          <div style={{maxHeight:180,overflowY:"auto",fontSize:10}}>
            {liveMatches.length === 0 && <div style={{color:"#7a6a4a"}}>No pending or live fights.</div>}
            {liveMatches.map((m) => {
              const mine = me && (m.a_username === me.username || m.b_username === me.username);
              const canReady = mine && (m.state==="pending" || m.state==="ready");
              const canJoin = !mine && m.is_open && !m.b_username && (m.state==="pending" || m.state==="ready");
              return (
                <div key={m.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid rgba(201,168,76,0.1)"}}>
                  <div>
                    <div style={{color:mine?"#f5e8c8":"#d0c090"}}>
                      {m.a_username} vs {m.b_username} <span style={{color:"#7a6a4a"}}>• {m.state} R{m.round}/{m.max_rounds}</span>
                    </div>
                    <div style={{fontSize:9,color:"#6a5a3a"}}>HP {m.hp?.a ?? 0}/{m.hp?.b ?? 0} • Odds A {m.odds?.a ?? "-"} / B {m.odds?.b ?? "-"}</div>
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    {canJoin && (
                      <button
                        onClick={()=>handleJoinMatch(m.id)}
                        disabled={busyAction===`join:${m.id}`}
                        className={styles.btnPrimary}
                        style={{padding:"2px 6px",fontSize:9,cursor:busyAction===`join:${m.id}`?"wait":"pointer"}}
                      >
                        Join
                      </button>
                    )}
                    {mine && m.state==="running" && (
                      <button
                        onClick={()=>navigate(`/boxing/arena/${m.id}`)}
                        className={styles.btnGoldDarkText}
                        style={{padding:"2px 6px",fontSize:9,cursor:"pointer"}}
                      >
                        Watch
                      </button>
                    )}
                    {canReady && (
                      <button
                        onClick={()=>handleReadyMatch(m.id,true)}
                        disabled={busyAction===`ready:${m.id}`}
                        className={styles.btnPrimary}
                        style={{padding:"2px 6px",fontSize:9,cursor:busyAction===`ready:${m.id}`?"wait":"pointer"}}
                      >
                        Ready
                      </button>
                    )}
                    {!canReady && mine && (
                      <button
                        onClick={()=>handleReadyMatch(m.id,false)}
                        disabled={busyAction===`ready:${m.id}`}
                        className={styles.btnGoldDarkText}
                        style={{padding:"2px 6px",fontSize:9,cursor:busyAction===`ready:${m.id}`?"wait":"pointer"}}
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

        <div className={styles.panel} style={{padding:12,minHeight:140}}>
          <div style={{fontSize:11,color:gold,letterSpacing:"0.16em",marginBottom:6}}>BETTING</div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <span style={{fontSize:9,color:"#8a7a4a"}}>Stake</span>
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
                    className={styles.btnGoldDarkText}
                    style={{padding:"2px 6px",fontSize:9,cursor:busyAction===`bet:${m.id}:b`?"wait":"pointer"}}
                  >
                    Bet B
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div style={{fontSize:9,color:"#8a7a4a",marginBottom:4}}>My bets</div>
          <div style={{maxHeight:90,overflowY:"auto",fontSize:10}}>
            {bets.length === 0 && <div style={{color:"#7a6a4a"}}>No open or settled bets.</div>}
            {bets.map((b)=>(
              <div key={b.id} style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}>
                <span style={{color:"#d0c090"}}>#{b.match_id.slice(0,6)} • {b.fighter.toUpperCase()}</span>
                <span style={{color:b.status==="won"?"#6a9a4a":b.status==="lost"?"#aa4444":"#8a7a4a"}}>{b.status} ${b.stake}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.panel} style={{padding:12,minHeight:140}}>
          <div style={{fontSize:11,color:gold,letterSpacing:"0.16em",marginBottom:6}}>LEAGUE (WEEKLY)</div>
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

      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap');`}</style>
    </div>
  );
}
