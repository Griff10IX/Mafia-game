import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import api from "../utils/api";

// ── FIGHT ENGINE ─────────────────────────────────────────────────────────────
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

const PUNCH_DMG  = { jab:[4,9], cross:[9,17], hook:[11,21], uppercut:[13,23], body:[7,15] };
const PUNCH_ACC  = { jab:0.73, cross:0.61, hook:0.57, uppercut:0.52, body:0.65 };
const PUNCH_STAM = { jab:1.5, cross:2.5, hook:3.2, uppercut:3.5, body:2.8 };

function choosePunch(f) {
  const tired = f.stam < 30;
  const w = { jab:tired?45:25, cross:tired?10:22, hook:tired?8:20, uppercut:tired?5:15, body:18 };
  let r = Math.random() * Object.values(w).reduce((a,b)=>a+b,0);
  for (const [k,v] of Object.entries(w)) { r-=v; if(r<=0) return k; }
  return "jab";
}

function simulateFight(aS, bS) {
  const a = {...aS, hp:100, stam:100, kds:0};
  const b = {...bS, hp:100, stam:100, kds:0};
  const events = [];
  for (let round=1; round<=12; round++) {
    for (let i=0; i<8+randInt(0,6); i++) {
      if (a.hp<=0||b.hp<=0) break;
      const apt=choosePunch(a), aAcc=clamp(PUNCH_ACC[apt]+(a.speed-b.defense)/400-(1-a.stam/100)*0.2,0.15,0.9);
      const aL=Math.random()<aAcc; let aDmg=0, aKD=false;
      if(aL){const[lo,hi]=PUNCH_DMG[apt];aDmg=rand(lo,hi)*(a.power/80);b.hp=Math.max(0,b.hp-aDmg);if(Math.random()<(aDmg/22)*(1-b.chin/100)*(1-b.stam/100)&&b.hp>0&&b.kds<3){b.kds++;b.hp=Math.max(1,b.hp-6);aKD=true;}}
      a.stam=Math.max(0,a.stam-PUNCH_STAM[apt]*(aL?1:0.5));
      const bpt=choosePunch(b), bAcc=clamp(PUNCH_ACC[bpt]+(b.speed-a.defense)/400-(1-b.stam/100)*0.2,0.15,0.9);
      const bL=Math.random()<bAcc; let bDmg=0, bKD=false;
      if(bL){const[lo,hi]=PUNCH_DMG[bpt];bDmg=rand(lo,hi)*(b.power/80);a.hp=Math.max(0,a.hp-bDmg);if(Math.random()<(bDmg/22)*(1-a.chin/100)*(1-a.stam/100)&&a.hp>0&&a.kds<3){a.kds++;a.hp=Math.max(1,a.hp-6);bKD=true;}}
      b.stam=Math.max(0,b.stam-PUNCH_STAM[bpt]*(bL?1:0.5));
      events.push({round,hpA:Math.round(a.hp),hpB:Math.round(b.hp),stamA:Math.round(a.stam),stamB:Math.round(b.stam),aPunch:apt,aLanded:aL,aDmg:Math.round(aDmg*10)/10,aKD,bPunch:bpt,bLanded:bL,bDmg:Math.round(bDmg*10)/10,bKD});
      if(a.hp<=0||b.hp<=0||a.kds>=3||b.kds>=3) break;
    }
    a.stam=Math.min(100,a.stam+15+(a.stamina/100)*15);
    b.stam=Math.min(100,b.stam+15+(b.stamina/100)*15);
    if(a.hp<=0||b.hp<=0||a.kds>=3||b.kds>=3) break;
  }
  let winner=null,reason="Decision";
  if(a.hp<=0||a.kds>=3){winner="b";reason=a.kds>=3?"TKO":"KO";}
  else if(b.hp<=0||b.kds>=3){winner="a";reason=b.kds>=3?"TKO":"KO";}
  else winner="a";
  return {events,winner,reason};
}

// ── BUILD RING ───────────────────────────────────────────────────────────────
function buildRing(scene) {
  const mat = c => new THREE.MeshLambertMaterial({color:c});
  const floor = new THREE.Mesh(new THREE.BoxGeometry(7,0.15,7),mat(0x1e1008));
  floor.receiveShadow=true; scene.add(floor);
  const lm=new THREE.MeshBasicMaterial({color:0xc9a84c,transparent:true,opacity:0.2});
  const cl=new THREE.Mesh(new THREE.BoxGeometry(6.8,0.02,0.05),lm); cl.position.y=0.09; scene.add(cl);
  const cc=new THREE.Mesh(new THREE.TorusGeometry(0.7,0.03,8,32),lm); cc.rotation.x=-Math.PI/2; cc.position.y=0.09; scene.add(cc);
  const postMat=mat(0xc9a84c), capMat=mat(0xffe066);
  [[-3.2,-3.2],[3.2,-3.2],[3.2,3.2],[-3.2,3.2]].forEach(([x,z])=>{
    const p=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,3.5,8),postMat); p.position.set(x,1.75,z); p.castShadow=true; scene.add(p);
    const c=new THREE.Mesh(new THREE.SphereGeometry(0.12,8,8),capMat); c.position.set(x,3.56,z); scene.add(c);
  });
  [0.9,1.6,2.3].forEach(y=>{
    const rm=mat(y===1.6?0x8b1a1a:0xc9a84c);
    [[-3.2,-3.2,3.2,-3.2],[3.2,-3.2,3.2,3.2],[3.2,3.2,-3.2,3.2],[-3.2,3.2,-3.2,-3.2]].forEach(([x1,z1,x2,z2])=>{
      const len=Math.sqrt((x2-x1)**2+(z2-z1)**2);
      const rope=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,len,6),rm);
      rope.position.set((x1+x2)/2,y,(z1+z2)/2);
      if(z1===z2){rope.rotation.x=Math.PI/2;}else{rope.rotation.z=Math.PI/2;}
      scene.add(rope);
    });
  });
  const base=new THREE.Mesh(new THREE.BoxGeometry(9,0.4,9),mat(0x0a0703)); base.position.y=-0.27; scene.add(base);
}

// ── BUILD BOXER ──────────────────────────────────────────────────────────────
function buildBoxer(scene, colorHex, skinHex=0xc8956a) {
  const g=new THREE.Group();
  const m=c=>new THREE.MeshLambertMaterial({color:c});

  // All parts relative to g (origin = feet level)
  const root=new THREE.Group(); g.add(root); // bob group

  // Legs
  const legL=new THREE.Group(); legL.position.set(-0.15,0.5,0); root.add(legL);
  {
    const upperLegL = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.58,0.22),m(0x111008));
    upperLegL.position.set(0,-0.29,0);
    legL.add(upperLegL);
    const lowerLegL = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.1,0.34),m(0x2a1a0a));
    lowerLegL.position.set(0,-0.62,0.06);
    legL.add(lowerLegL);
  }

  const legR=new THREE.Group(); legR.position.set(0.15,0.5,0); root.add(legR);
  {
    const upperLegR = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.58,0.22),m(0x111008));
    upperLegR.position.set(0,-0.29,0);
    legR.add(upperLegR);
    const lowerLegR = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.1,0.34),m(0x2a1a0a));
    lowerLegR.position.set(0,-0.62,0.06);
    legR.add(lowerLegR);
  }

  // Hips
  const hips=new THREE.Mesh(new THREE.BoxGeometry(0.58,0.28,0.3),m(colorHex)); hips.position.set(0,0.64,0); root.add(hips);

  // Torso group — pivot at waist
  const torsoG=new THREE.Group(); torsoG.position.set(0,0.9,0); root.add(torsoG);
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.58,0.62,0.31),m(skinHex)); torso.position.y=0.31; torso.castShadow=true; torsoG.add(torso);

  // Head group — pivot at neck
  const headG=new THREE.Group(); headG.position.set(0,0.72,0); torsoG.add(headG);
  {
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.12,0.16,8),m(skinHex));
    neck.position.set(0,0.08,0);
    headG.add(neck);
  }
  const head=new THREE.Mesh(new THREE.BoxGeometry(0.36,0.38,0.36),m(skinHex)); head.position.y=0.29; head.castShadow=true; headG.add(head);
  const hg=new THREE.Mesh(new THREE.SphereGeometry(0.24,10,8),m(colorHex)); hg.position.y=0.3; hg.scale.set(1,0.87,1); headG.add(hg);
  const em=new THREE.MeshBasicMaterial({color:0x000000});
  const eL=new THREE.Mesh(new THREE.SphereGeometry(0.042,6,6),em); eL.position.set(-0.09,0.32,0.18); headG.add(eL);
  const eR=new THREE.Mesh(new THREE.SphereGeometry(0.042,6,6),em); eR.position.set(0.09,0.32,0.18); headG.add(eR);

  // Left arm — pivot at shoulder
  const armL=new THREE.Group(); armL.position.set(-0.4,0.54,0); torsoG.add(armL);
  {
    const upperArmL = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.44,0.2),m(skinHex));
    upperArmL.position.set(0,-0.22,0);
    armL.add(upperArmL);
  }
  const faL=new THREE.Group(); faL.position.set(0,-0.47,0); armL.add(faL);
  {
    const forearmL = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.4,0.18),m(skinHex));
    forearmL.position.set(0,-0.2,0);
    faL.add(forearmL);
  }
  const gloveL=new THREE.Mesh(new THREE.BoxGeometry(0.27,0.29,0.27),m(colorHex)); gloveL.position.y=-0.45; faL.add(gloveL);

  // Right arm — pivot at shoulder
  const armR=new THREE.Group(); armR.position.set(0.4,0.54,0); torsoG.add(armR);
  {
    const upperArmR = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.44,0.2),m(skinHex));
    upperArmR.position.set(0,-0.22,0);
    armR.add(upperArmR);
  }
  const faR=new THREE.Group(); faR.position.set(0,-0.47,0); armR.add(faR);
  {
    const forearmR = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.4,0.18),m(skinHex));
    forearmR.position.set(0,-0.2,0);
    faR.add(forearmR);
  }
  const gloveR=new THREE.Mesh(new THREE.BoxGeometry(0.27,0.29,0.27),m(colorHex)); gloveR.position.y=-0.45; faR.add(gloveR);

  g.position.y=0.08;
  scene.add(g);
  return {group:g, root, torsoG, headG, armL, faL, armR, faR, legL, legR, hips};
}

// ── POSES ─────────────────────────────────────────────────────────────────────
// Resets to guard stance
function resetGuard(bx, side) {
  const s=side==="a"?1:-1;
  bx.torsoG.rotation.set(0, 0.12*s, 0);
  bx.headG.rotation.set(0, -0.08*s, 0);
  bx.armL.rotation.set(-0.35, 0.1*s, 0.24*s);
  bx.armR.rotation.set(-0.35, -0.1*s, -0.24*s);
  bx.faL.rotation.set(0.55, 0, 0);
  bx.faR.rotation.set(0.55, 0, 0);
  bx.legL.rotation.set(0,0,0);
  bx.legR.rotation.set(0,0,0);
  bx.root.position.set(0,0,0);
  bx.group.rotation.z=0;
}

// Applies punch with progress p [0..1] (0=guard, 0.5=full, 1=guard again)
function applyPunch(bx, type, p, side) {
  const s=side==="a"?1:-1;
  const e=Math.sin(p*Math.PI); // 0->1->0
  resetGuard(bx, side);
  switch(type) {
    case "jab":
      bx.armL.rotation.x=-0.35-e*1.35;
      bx.armL.rotation.y=e*0.18*s;
      bx.faL.rotation.x=0.55-e*0.45;
      bx.torsoG.rotation.y=0.12*s-e*0.22*s;
      break;
    case "cross":
      bx.armR.rotation.x=-0.35-e*1.45;
      bx.armR.rotation.y=-e*0.22*s;
      bx.faR.rotation.x=0.55-e*0.45;
      bx.torsoG.rotation.y=0.12*s+e*0.4*s;
      bx.hips.rotation.y=e*0.18*s;
      break;
    case "hook":
      bx.armL.rotation.x=-0.55-e*0.25;
      bx.armL.rotation.z=(0.24+e*1.2)*s;
      bx.armL.rotation.y=e*0.4*s;
      bx.faL.rotation.x=0.35+e*0.5;
      bx.torsoG.rotation.y=0.12*s-e*0.5*s;
      break;
    case "uppercut":
      bx.armR.rotation.x=-0.35+e*1.1;
      bx.faR.rotation.x=-e*0.9;
      bx.torsoG.rotation.y=0.12*s+e*0.3*s;
      bx.torsoG.rotation.x=-e*0.22;
      break;
    case "body":
      bx.armL.rotation.x=-0.35-e*0.9;
      bx.armL.rotation.z=(0.24+e*0.4)*s;
      bx.torsoG.rotation.x=e*0.38;
      bx.torsoG.rotation.y=0.12*s-e*0.22*s;
      break;
  }
}

// Idle guard with bob
function applyIdle(bx, t, side) {
  const s=side==="a"?1:-1;
  resetGuard(bx, side);
  const bob=Math.sin(t*3.6)*0.042;
  const sway=Math.sin(t*2.1)*0.022;
  bx.root.position.y=bob;
  bx.root.position.x=sway;
  bx.legL.rotation.x=Math.sin(t*3.6+0.5)*0.13;
  bx.legR.rotation.x=Math.sin(t*3.6)*0.13;
}

// Hit reaction — exponential decay snap
function applyHit(bx, type, intensity, age, side) {
  const s=side==="a"?1:-1;
  const decay=Math.exp(-age*9)*intensity;
  bx.headG.rotation.x+=decay*0.35*(type==="uppercut"?1.2:-0.2);
  bx.headG.rotation.y+=-decay*0.7*s*(type==="hook"?1.6:1);
  bx.headG.rotation.z+=decay*0.3*s;
  bx.torsoG.rotation.y+=decay*0.2*s;
}

// Knockdown — t=0 upright, t=1 on canvas
function applyKnockdown(bx, t, side) {
  const f=clamp(t,0,1);
  bx.group.rotation.z=(side==="a"?-1:1)*f*1.45;
  bx.group.position.y=0.08-f*0.72;
  bx.torsoG.rotation.x=f*0.55;
  bx.armL.rotation.x=-0.35+f*1.1;
  bx.armR.rotation.x=-0.35+f*0.8;
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
    // per-frame mutable state (not React state — updated every frame)
    phase:"idle",
    evIdx:0,
    evTimer:0,
    // A punch state
    pA:null,   // {type, p, done} p goes 0->1
    pB:null,
    // hit reaction
    hA:null,   // {type, intensity, age}
    hB:null,
    // knockdown
    kdA:0,     // seconds remaining
    kdB:0,
    // positions
    xA:-1.3, xB:1.3,
    txA:-1.3, txB:1.3,
  });

  const [hpA,setHpA]=useState(100);
  const [hpB,setHpB]=useState(100);
  const [stamA,setStamA]=useState(100);
  const [stamB,setStamB]=useState(100);
  const [round,setRound]=useState(1);
  const [gameState,setGameState]=useState("idle"); // idle|fighting|done
  const [winText,setWinText]=useState("");
  const [actionText,setActionText]=useState("");

  const [npcs, setNpcs] = useState([]);
  const [npcFightState, setNpcFightState] = useState(null); // null | { matchId, npcName } | { result: "win"|"loss"|"draw", npcName, reason }
  const npcPollRef = useRef(null);

  // Backend boxing meta (profile / gym / coach / gear)
  const [profile, setProfile] = useState(null);
  const [effective, setEffective] = useState(null);
  const [drills, setDrills] = useState({});
  const [gymInfo, setGymInfo] = useState(null);
  const [coachInfo, setCoachInfo] = useState(null); // { coaches, coach_id }
  const [gearInfo, setGearInfo] = useState(null);   // { gear, owned_ids, equipped }
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const flashMsg=(msg,ms=1600)=>{ setActionText(msg); setTimeout(()=>setActionText(""),ms); };

  const getErr = (e) => e?.response?.data?.detail || e?.message || "Something went wrong";

  // Load NPCs + boxing meta (profile / gym / coach / gear)
  useEffect(() => {
    let cancelled = false;
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
      const poll = () => {
        api.get(`/boxing/matches/${matchId}`).then((r) => {
          const m = r.data?.match;
          if (!m || m.state !== "finished") return;
          if (npcPollRef.current) clearInterval(npcPollRef.current);
          npcPollRef.current = null;
          const winner = m.winner;
          const meId = r.data?.match?.a_id;
          let result = "draw";
          if (winner) result = winner === meId ? "win" : "loss";
          setNpcFightState({ result, npcName: npc.name, reason: m.finish_reason || "" });
        }).catch(() => {});
      };
      npcPollRef.current = setInterval(poll, 2000);
      poll();
    } catch (e) {
      setNpcFightState({ result: "error", npcName: npc.name, message: e?.response?.data?.detail || e?.message || "Failed" });
    }
  };

  const clearNpcResult = () => setNpcFightState(null);

  // Training / gym / coach / gear actions
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
      // refresh gym info to get new level
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

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const W=canvas.clientWidth||640, H=canvas.clientHeight||440;

    const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H,false);
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.toneMapping=THREE.ReinhardToneMapping;
    renderer.toneMappingExposure=1.15;

    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0x060402);
    scene.fog=new THREE.FogExp2(0x080503,0.038);

    const camera=new THREE.PerspectiveCamera(52,W/H,0.1,80);
    camera.position.set(0,2.9,7.4); camera.lookAt(0,1.1,0);

    scene.add(new THREE.AmbientLight(0x221a08,0.85));
    const spot=new THREE.SpotLight(0xfff2cc,4.5,24,Math.PI/4.2,0.3);
    spot.position.set(0,10,1); spot.target.position.set(0,0,0);
    spot.castShadow=true; spot.shadow.mapSize.set(1024,1024);
    scene.add(spot); scene.add(spot.target);
    const fl1=new THREE.PointLight(0xc9a84c,1.0,18); fl1.position.set(-6,5,4); scene.add(fl1);
    const fl2=new THREE.PointLight(0x8b2222,0.7,14); fl2.position.set(6,5,4); scene.add(fl2);
    const fl3=new THREE.PointLight(0x3a3020,0.4,10); fl3.position.set(0,2,-5); scene.add(fl3);

    buildRing(scene);

    const bA=buildBoxer(scene,FIGHTERS[0].color,0xc8956a);
    const bB=buildBoxer(scene,FIGHTERS[1].color,0xb07850);
    bA.group.position.set(-1.3,0.08,0);
    bB.group.position.set(1.3,0.08,0);
    bB.group.rotation.y=Math.PI;

    // Crowd
    const cg=new THREE.BufferGeometry();
    const cp=[]; for(let i=0;i<500;i++){const a=Math.random()*Math.PI*2,r=8+Math.random()*7;cp.push(r*Math.cos(a),1.2+Math.random()*4,r*Math.sin(a));}
    cg.setAttribute("position",new THREE.Float32BufferAttribute(cp,3));
    const crowd=new THREE.Points(cg,new THREE.PointsMaterial({color:0xc9a84c,size:0.14,transparent:true,opacity:0.28}));
    scene.add(crowd);

    const r=refs.current;
    r.renderer=renderer; r.scene=scene; r.camera=camera;
    r.bA=bA; r.bB=bB; r.crowd=crowd;
    r.clock.start();

    const onResize=()=>{
      const w=canvas.clientWidth,h=canvas.clientHeight;
      renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
    };
    window.addEventListener("resize",onResize);

    const PUNCH_SPEED=2.8; // cycles per second (0->1 in 1/PUNCH_SPEED seconds)

    let raf;
    const loop=()=>{
      raf=requestAnimationFrame(loop);
      const dt=Math.min(r.clock.getDelta(),0.05);
      const t=r.clock.getElapsedTime();
      if(!r.bA||!r.bB){renderer.render(scene,camera);return;}
      const {bA,bB}=r;

      crowd.rotation.y+=0.0006;

      // ── SMOOTH X POSITION ──
      r.xA=lerp(r.xA,r.txA,dt*7);
      r.xB=lerp(r.xB,r.txB,dt*7);
      bA.group.position.x=r.xA;
      bB.group.position.x=r.xB;

      if(r.phase==="idle"||r.phase==="done"){
        applyIdle(bA,t,"a"); applyIdle(bB,t,"b");
        renderer.render(scene,camera); return;
      }

      // ── KNOCKDOWNS ──
      if(r.kdA>0){
        r.kdA-=dt;
        const getUp=r.kdA<0.7;
        const prog=getUp?1-(r.kdA/0.7):clamp((2.8-r.kdA)/0.6,0,1);
        applyKnockdown(bA,prog,"a");
        bA.group.position.y=getUp?lerp(-0.64,0.08,1-r.kdA/0.7):-0.64+0.08;
        r.txA=-1.65;
        if(r.kdA<=0){bA.group.rotation.z=0;bA.group.position.y=0.08;r.txA=-1.3;}
      } else { bA.group.position.y=0.08; bA.group.rotation.z=0; }

      if(r.kdB>0){
        r.kdB-=dt;
        const getUp=r.kdB<0.7;
        const prog=getUp?1-(r.kdB/0.7):clamp((2.8-r.kdB)/0.6,0,1);
        applyKnockdown(bB,prog,"b");
        bB.group.position.y=getUp?lerp(-0.64,0.08,1-r.kdB/0.7):-0.64+0.08;
        r.txB=1.65;
        if(r.kdB<=0){bB.group.rotation.z=0;bB.group.position.y=0.08;r.txB=1.3;}
      } else { bB.group.position.y=0.08; bB.group.rotation.z=0; }

      // ── PUNCH ANIMATIONS ──
      let aPunching=false, bPunching=false;

      if(r.pA&&r.kdA<=0){
        aPunching=true;
        r.pA.p=Math.min(1,r.pA.p+dt*PUNCH_SPEED);
        applyPunch(bA,r.pA.type,r.pA.p,"a");
        // step in
        r.txA=-1.1+Math.sin(r.pA.p*Math.PI)*0.28;
        if(r.pA.p>=1){r.pA=null; r.txA=-1.3;}
      }
      if(r.pB&&r.kdB<=0){
        bPunching=true;
        r.pB.p=Math.min(1,r.pB.p+dt*PUNCH_SPEED);
        applyPunch(bB,r.pB.type,r.pB.p,"b");
        r.txB=1.1-Math.sin(r.pB.p*Math.PI)*0.28;
        if(r.pB.p>=1){r.pB=null; r.txB=1.3;}
      }

      // ── HIT REACTIONS (additive on top of whatever pose) ──
      if(r.hA){
        r.hA.age+=dt;
        applyHit(bA,r.hA.type,r.hA.intensity,r.hA.age,"a");
        if(r.hA.age>0.55) r.hA=null;
      }
      if(r.hB){
        r.hB.age+=dt;
        applyHit(bB,r.hB.type,r.hB.intensity,r.hB.age,"b");
        if(r.hB.age>0.55) r.hB=null;
      }

      // ── GUARD IDLE (when not in punch animation) ──
      if(!aPunching&&r.kdA<=0) applyIdle(bA,t,"a");
      if(!bPunching&&r.kdB<=0) applyIdle(bB,t,"b");

      // ── EVENT DISPATCH ──
      if(r.phase==="fighting"&&r.fight){
        r.evTimer-=dt;
        if(r.evTimer<=0&&!r.pA&&!r.pB&&r.evIdx<r.fight.events.length){
          const ev=r.fight.events[r.evIdx++];
          setHpA(ev.hpA); setHpB(ev.hpB); setStamA(ev.stamA); setStamB(ev.stamB); setRound(ev.round);

          // Fire both punches — B slightly delayed
          if(r.kdA<=0) r.pA={type:ev.aPunch,p:0};
          setTimeout(()=>{ if(r.kdB<=0) r.pB={type:ev.bPunch,p:0}; },110);

          // Hit reactions
          if(ev.aLanded) setTimeout(()=>{ r.hB={type:ev.aPunch,intensity:clamp(ev.aDmg/13,0.3,1.6),age:0}; },170);
          if(ev.bLanded) setTimeout(()=>{ r.hA={type:ev.bPunch,intensity:clamp(ev.bDmg/13,0.3,1.6),age:0}; },270);

          // Knockdowns
          if(ev.aKD){ setTimeout(()=>{r.kdA=2.9;r.txA=-1.65;},200); flashMsg(`⚡ ${FIGHTERS[0].name.split(" ")[0].toUpperCase()} IS DOWN!`); }
          if(ev.bKD){ setTimeout(()=>{r.kdB=2.9;r.txB=1.65;},200); flashMsg(`⚡ ${FIGHTERS[1].name.split(" ")[0].toUpperCase()} IS DOWN!`); }

          // Big shot
          if(!ev.aKD&&ev.aLanded&&ev.aDmg>14) flashMsg(`💥 ${FIGHTERS[0].name.split("'")[1]?.split("'")[0]} lands big!`,900);
          else if(!ev.bKD&&ev.bLanded&&ev.bDmg>14) flashMsg(`💢 ${FIGHTERS[1].name.split("'")[1]?.split("'")[0]} fires back!`,900);

          const kdDelay=(ev.aKD||ev.bKD)?3.1:0;
          r.evTimer=0.38+Math.random()*0.22+kdDelay;
        }

        if(r.evIdx>=r.fight.events.length&&!r.pA&&!r.pB&&r.evTimer<=0){
          r.phase="done"; setGameState("done");
          const res=r.fight;
          const wName=res.winner==="a"?FIGHTERS[0].name:res.winner==="b"?FIGHTERS[1].name:"";
          setWinText(res.reason==="Draw"?"DRAW":`${wName.split(" ")[0]} WINS — ${res.reason}`);
        }
      }

      renderer.render(scene,camera);
    };
    loop();

    return()=>{cancelAnimationFrame(raf);window.removeEventListener("resize",onResize);renderer.dispose();};
  },[]);

  const startFight=useCallback(()=>{
    const result=simulateFight(FIGHTERS[0],FIGHTERS[1]);
    const r=refs.current;
    r.fight=result; r.phase="fighting"; r.evIdx=0; r.evTimer=0.6;
    r.pA=null; r.pB=null; r.hA=null; r.hB=null;
    r.kdA=0; r.kdB=0; r.xA=-1.3; r.xB=1.3; r.txA=-1.3; r.txB=1.3;
    if(r.bA){r.bA.group.position.set(-1.3,0.08,0);r.bA.group.rotation.set(0,0,0);}
    if(r.bB){r.bB.group.position.set(1.3,0.08,0);r.bB.group.rotation.set(0,Math.PI,0);}
    setHpA(100);setHpB(100);setStamA(100);setStamB(100);setRound(1);
    setGameState("fighting");setWinText("");setActionText("");
  },[]);

  const gold="#c9a84c",crimson="#8b1a1a",bg="#0d0a05";

  const Bar=({val,flip,color})=>(
    <div style={{height:5,background:"rgba(255,255,255,0.07)",borderRadius:2,overflow:"hidden"}}>
      <div style={{width:`${val}%`,height:"100%",background:color,borderRadius:2,transition:"width 0.3s",marginLeft:flip?"auto":undefined}}/>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:bg,fontFamily:"'Cinzel',serif",color:"#e8dcc8",display:"flex",flexDirection:"column"}}>

      {/* Header */}
      <div style={{borderBottom:"1px solid rgba(201,168,76,0.15)",padding:"10px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(0,0,0,0.55)"}}>
        <div>
          <div style={{fontSize:16,letterSpacing:"0.2em",color:gold}}>THE UNDERGROUND RING</div>
          <div style={{fontSize:9,color:"#3a2a10",letterSpacing:"0.12em"}}>1920s MAFIA BOXING • SIMULATION</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{padding:"3px 8px",border:"1px solid rgba(201,168,76,0.2)",borderRadius:2,fontSize:9,color:gold}}>12 RDS</span>
          {gameState==="fighting"&&<span style={{padding:"3px 8px",border:"1px solid rgba(180,40,40,0.5)",borderRadius:2,fontSize:9,color:"#dd4444",letterSpacing:"0.1em"}}>● LIVE</span>}
        </div>
      </div>

      {/* HUD */}
      <div style={{display:"flex",background:"rgba(0,0,0,0.65)",borderBottom:"1px solid rgba(201,168,76,0.08)"}}>
        {/* A */}
        <div style={{flex:1,padding:"9px 14px",borderRight:"1px solid rgba(201,168,76,0.07)"}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:FIGHTERS[0].colorCSS,boxShadow:`0 0 5px ${FIGHTERS[0].colorCSS}`}}/>
            <span style={{fontSize:10,color:"#ffe0a0",letterSpacing:"0.05em"}}>{FIGHTERS[0].name}</span>
          </div>
          <div style={{marginBottom:5}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#5a4a28",marginBottom:2}}><span>HP</span><span style={{color:hpA<30?crimson:gold}}>{hpA}</span></div>
            <Bar val={hpA} color={hpA<30?crimson:hpA<55?"#cc7722":gold}/>
          </div>
          <div style={{fontSize:8,color:"#5a4a28",marginBottom:2,display:"flex",justifyContent:"space-between"}}><span>STAM</span><span style={{color:"#4a9a6a"}}>{stamA}</span></div>
          <Bar val={stamA} color="#3a7a5a"/>
        </div>
        {/* Round */}
        <div style={{padding:"9px 14px",textAlign:"center",minWidth:54}}>
          <div style={{fontSize:20,color:gold,fontWeight:700,lineHeight:1}}>{round}</div>
          <div style={{fontSize:8,color:"#3a2a10",letterSpacing:"0.08em"}}>ROUND</div>
        </div>
        {/* B */}
        <div style={{flex:1,padding:"9px 14px",borderLeft:"1px solid rgba(201,168,76,0.07)",textAlign:"right"}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7,justifyContent:"flex-end"}}>
            <span style={{fontSize:10,color:"#ffe0a0",letterSpacing:"0.05em"}}>{FIGHTERS[1].name}</span>
            <div style={{width:8,height:8,borderRadius:"50%",background:FIGHTERS[1].colorCSS,boxShadow:`0 0 5px ${FIGHTERS[1].colorCSS}`}}/>
          </div>
          <div style={{marginBottom:5}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#5a4a28",marginBottom:2}}><span style={{marginLeft:"auto"}}>{hpB} HP</span></div>
            <Bar val={hpB} flip color={hpB<30?crimson:hpB<55?"#cc7722":FIGHTERS[1].colorCSS}/>
          </div>
          <div style={{fontSize:8,color:"#5a4a28",marginBottom:2,display:"flex",justifyContent:"flex-end"}}><span style={{color:"#4a9a6a"}}>{stamB} STAM</span></div>
          <Bar val={stamB} flip color="#3a7a5a"/>
        </div>
      </div>

      {/* Canvas */}
      <div style={{position:"relative",flex:1,minHeight:420}}>
        <canvas ref={canvasRef} style={{width:"100%",height:"100%",minHeight:420,display:"block"}}/>

        {/* Action flash */}
        {actionText&&(
          <div style={{position:"absolute",top:"15%",left:"50%",transform:"translateX(-50%)",fontSize:"clamp(13px,2.8vw,20px)",color:actionText.includes("DOWN")?"#ff6666":"#ffe066",fontWeight:700,letterSpacing:"0.1em",textAlign:"center",whiteSpace:"nowrap",textShadow:"0 0 28px rgba(0,0,0,1),0 2px 8px rgba(0,0,0,0.9)",pointerEvents:"none"}}>
            {actionText}
          </div>
        )}

        {/* Win overlay */}
        {gameState==="done"&&winText&&(
          <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"rgba(4,2,1,0.92)",border:"1px solid rgba(201,168,76,0.4)",borderRadius:4,padding:"18px 32px",textAlign:"center",pointerEvents:"none"}}>
            <div style={{fontSize:9,color:"#5a4a28",letterSpacing:"0.2em",marginBottom:5}}>FIGHT OVER</div>
            <div style={{fontSize:"clamp(14px,3vw,22px)",color:"#ffe066",letterSpacing:"0.1em"}}>{winText}</div>
          </div>
        )}

        {/* Idle */}
        {gameState==="idle"&&(
          <div style={{position:"absolute",bottom:"22%",left:"50%",transform:"translateX(-50%)",fontSize:11,color:gold,letterSpacing:"0.18em",opacity:0.55,pointerEvents:"none"}}>PRESS START TO FIGHT</div>
        )}

        {/* Vignette */}
        <div style={{position:"absolute",inset:0,pointerEvents:"none",background:"radial-gradient(ellipse 75% 65% at 50% 42%,transparent 22%,rgba(0,0,0,0.65) 100%)"}}/>
      </div>

      {/* Control */}
      <div style={{padding:"12px 20px",borderTop:"1px solid rgba(201,168,76,0.1)",display:"flex",flexDirection:"column",alignItems:"center",gap:10,background:"rgba(0,0,0,0.65)"}}>
        <button onClick={startFight} style={{background:"rgba(201,168,76,0.14)",border:"1px solid rgba(201,168,76,0.45)",borderRadius:3,color:"#ffe066",fontFamily:"'Cinzel',serif",fontSize:12,letterSpacing:"0.15em",padding:"10px 32px",cursor:"pointer",textTransform:"uppercase",fontWeight:700}}>
          🥊 {gameState==="idle"?"Start Fight":"Rematch"}
        </button>
        {npcs.length > 0 && (
          <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:6,alignItems:"center"}}>
            <span style={{fontSize:10,color:"#8a7a4a",letterSpacing:"0.08em"}}>Fight NPC:</span>
            {npcs.map((npc) => (
              <button
                key={npc.id}
                onClick={() => startNpcFight(npc)}
                disabled={npcFightState && !npcFightState.result}
                style={{padding:"6px 12px",fontSize:10,border:"1px solid rgba(201,168,76,0.35)",borderRadius:2,background:"rgba(201,168,76,0.08)",color:"#d4b858",cursor:npcFightState&&!npcFightState.result?"not-allowed":"pointer",opacity:npcFightState&&!npcFightState.result?0.6:1}}
              >
                {npc.name} <span style={{color:"#6a5a30"}}>({npc.rating})</span>
              </button>
            ))}
          </div>
        )}
        {npcFightState?.matchId && !npcFightState.result && (
          <div style={{fontSize:10,color:"#8a9a6a"}}>Fight vs {npcFightState.npcName} in progress…</div>
        )}
        {npcFightState?.result && npcFightState.result !== "error" && (
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:11,color:npcFightState.result==="win"?"#6a9a4a":npcFightState.result==="loss"?"#aa4444":"#8a7a4a"}}>
              {npcFightState.result==="win"?"You won":npcFightState.result==="loss"?"You lost":"Draw"} vs {npcFightState.npcName}{npcFightState.reason?` (${npcFightState.reason})`:""}
            </span>
            <button onClick={clearNpcResult} style={{padding:"2px 8px",fontSize:9,border:"1px solid rgba(201,168,76,0.3)",borderRadius:2,background:"rgba(0,0,0,0.4)",color:"#a09050",cursor:"pointer"}}>Dismiss</button>
          </div>
        )}
        {npcFightState?.result === "error" && (
          <div style={{fontSize:10,color:"#aa4444"}}>{npcFightState.message} <button onClick={clearNpcResult} style={{marginLeft:6,padding:"2px 6px",fontSize:9,border:"1px solid rgba(201,168,76,0.3)",borderRadius:2,background:"rgba(0,0,0,0.4)",color:"#a09050",cursor:"pointer"}}>Dismiss</button></div>
        )}
      </div>

      {/* Training / Gym / Coach / Gear */}
      <div style={{padding:"18px 20px 28px",background:"#050302",borderTop:"1px solid rgba(201,168,76,0.25)",display:"grid",gridTemplateColumns:"minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.2fr)",gap:16}}>
        {/* Training & Stats */}
        <div style={{border:"1px solid rgba(201,168,76,0.25)",borderRadius:4,background:"rgba(0,0,0,0.7)",padding:12,minHeight:140}}>
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
                  <div key={k} style={{display:"flex",justifyContent:"space-between",background:"rgba(0,0,0,0.55)",padding:"4px 6px",borderRadius:2}}>
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
                      style={{padding:"4px 8px",fontSize:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:"rgba(0,0,0,0.7)",color:"#e0d0a0",cursor:busyAction===`train:${id}`?"wait":"pointer"}}
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

        {/* Gym & Coach */}
        <div style={{border:"1px solid rgba(201,168,76,0.25)",borderRadius:4,background:"rgba(0,0,0,0.7)",padding:12,minHeight:140,display:"flex",flexDirection:"column",gap:10}}>
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
                          style={{padding:"3px 7px",fontSize:9,border:"1px solid rgba(201,168,76,0.35)",borderRadius:2,background:g.id===gymInfo.gym?.id?"rgba(201,168,76,0.22)":"rgba(0,0,0,0.7)",color:"#e0d0a0",cursor:g.id===gymInfo.gym?.id?"default":"pointer"}}
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
                        style={{padding:"4px 8px",fontSize:9,border:"1px solid rgba(201,168,76,0.35)",borderRadius:2,background:isCurrent?"rgba(201,168,76,0.2)":"rgba(0,0,0,0.7)",color:"#e0d0a0",cursor:(busyAction && !isCurrent)?"wait":"pointer"}}
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

        {/* Gear */}
        <div style={{border:"1px solid rgba(201,168,76,0.25)",borderRadius:4,background:"rgba(0,0,0,0.7)",padding:12,minHeight:140}}>
          <div style={{fontSize:11,color:gold,letterSpacing:"0.16em",marginBottom:6}}>GEAR</div>
          {gearInfo && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:6,fontSize:10}}>
              {gearInfo.gear?.map((g) => {
                const owned = (gearInfo.owned_ids || []).includes(g.id);
                const equippedSlot = gearInfo.equipped?.[g.slot];
                const isEquipped = equippedSlot === g.id;
                return (
                  <div key={g.id} style={{background:"rgba(0,0,0,0.7)",borderRadius:3,padding:"4px 6px",border:isEquipped?"1px solid rgba(201,168,76,0.7)":"1px solid rgba(201,168,76,0.25)"}}>
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
                          style={{padding:"2px 6px",fontSize:9,border:"1px solid rgba(201,168,76,0.4)",borderRadius:2,background:"rgba(0,0,0,0.8)",color:"#e0d0a0",cursor:busyAction===`equip:${g.slot}:${g.id}`?"wait":"pointer"}}
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

      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap');`}</style>
    </div>
  );
}
