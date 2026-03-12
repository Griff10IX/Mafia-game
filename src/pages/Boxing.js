import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
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
      // Accuracy: stat-based (accuracy), speed vs defense, fatigue, momentum (backend: base_acc + accuracy*0.012 + speed*0.003; def_avoid + defense*0.012)
      const aAcc = clamp(
        PUNCH_ACC[apt]
        + ((a.accuracy != null ? a.accuracy : 70) - 70) / 400   // accuracy stat (scale 45–95): training/gear matter
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
        + ((b.accuracy != null ? b.accuracy : 70) - 70) / 400   // accuracy stat: training/gear matter
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
    // Stamina & HP recovery: align with backend (stamina + recovery stats matter)
    const aRec = 6 + ((a.stamina != null ? a.stamina : 62) / 100) * 12 + ((a.recovery != null ? a.recovery : 62) / 100) * 8;
    const bRec = 6 + ((b.stamina != null ? b.stamina : 62) / 100) * 12 + ((b.recovery != null ? b.recovery : 62) / 100) * 8;
    a.stam = Math.min(100, a.stam + aRec);
    b.stam = Math.min(100, b.stam + bRec);
    const aHpRec = 2 + ((a.recovery != null ? a.recovery : 62) / 100) * 5;
    const bHpRec = 2 + ((b.recovery != null ? b.recovery : 62) / 100) * 5;
    a.hp = Math.min(100, a.hp + aHpRec);
    b.hp = Math.min(100, b.hp + bHpRec);
    // Momentum decays toward neutral between rounds
    a.momentum *= 0.5;
    b.momentum *= 0.5;
    // Cuts swell between rounds — corner can slow it slightly
    if (a.cut) a.cut.severity = Math.min(1, a.cut.severity + 0.04);
    if (b.cut) b.cut.severity = Math.min(1, b.cut.severity + 0.04);
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
    // Decision: mirror server logic — total damage, then total hits, then random
    let totalADmg = 0, totalBDmg = 0, hitsA = 0, hitsB = 0;
    for (const ev of events) {
      totalADmg += ev.aDmg || 0;
      totalBDmg += ev.bDmg || 0;
      if (ev.aLanded) hitsA++;
      if (ev.bLanded) hitsB++;
    }
    if (totalADmg > totalBDmg) { winner = "a"; reason = "Decision"; }
    else if (totalBDmg > totalADmg) { winner = "b"; reason = "Decision"; }
    else if (hitsA > hitsB) { winner = "a"; reason = "Decision"; }
    else if (hitsB > hitsA) { winner = "b"; reason = "Decision"; }
    else { winner = Math.random() < 0.5 ? "a" : "b"; reason = "Split decision"; }
  }
  return {events, winner, reason};
}

// ── FIGHTERS DATA ────────────────────────────────────────────────────────────
const FIGHTERS=[
  {name:"Tommy 'The Bull' Moran",  power:82,speed:66,stamina:74,defense:60,accuracy:65,chin:70,recovery:62,color:0x1a4a9a,colorCSS:"#2a5aaa"},
  {name:"Sal 'Switchblade' Ricci", power:68,speed:84,stamina:78,defense:76,accuracy:72,chin:62,recovery:60,color:0x9a1a1a,colorCSS:"#bb2222"},
];

// ── COMPONENT ─────────────────────────────────────────────────────────────────
export default function Boxing3D() {
  const refs = useRef({ fight: null });
  const [arenaFightResult, setArenaFightResult] = useState(null);

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
          if (m.state === "finished") setArenaServerResult({ winner: m.winner, finish_reason: m.finish_reason || "" });
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
    setHpA(result.events.length ? result.events[result.events.length - 1].hpA : 100);
    setHpB(result.events.length ? result.events[result.events.length - 1].hpB : 100);
    setStamA(result.events.length ? result.events[result.events.length - 1].stamA : 100);
    setStamB(result.events.length ? result.events[result.events.length - 1].stamB : 100);
    setRound(result.events.length ? result.events[result.events.length - 1].round : 1);
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

  // Build detailed text log from simulated fight events
  const fightLogLines = (() => {
    const res = arenaFightResult;
    if (!res || !res.events || !res.events.length) return null;
    const nameA = res.nameA || "Fighter A";
    const nameB = res.nameB || "Fighter B";
    const cap = (s) => (s && s[0].toUpperCase() + s.slice(1)) || s;
    const lines = [];
    let lastRound = 0;
    const events = res.events;
    for (let idx = 0; idx < events.length; idx++) {
      const ev = events[idx];
      const nextEv = events[idx + 1];
      const isLastExchangeOfRound = !nextEv || nextEv.round !== ev.round;

      if (ev.round !== lastRound) {
        lastRound = ev.round;
        lines.push({ type: "round", text: `Round ${ev.round}`, round: ev.round });
      }
      if (ev.aLanded) {
        lines.push({ type: "exchange", text: `${nameA} lands a ${cap(ev.aPunch)} for ${ev.aDmg} damage.`, side: "a" });
      } else {
        lines.push({ type: "exchange", text: `${nameA} misses with a ${cap(ev.aPunch)}.`, side: "a" });
      }
      if (ev.bLanded) {
        lines.push({ type: "exchange", text: `${nameB} lands a ${cap(ev.bPunch)} for ${ev.bDmg} damage.`, side: "b" });
      } else {
        lines.push({ type: "exchange", text: `${nameB} misses with a ${cap(ev.bPunch)}.`, side: "b" });
      }
      if (ev.aKD) lines.push({ type: "kd", text: `Knockdown! ${nameA} takes a knee.`, side: "a" });
      if (ev.bKD) lines.push({ type: "kd", text: `Knockdown! ${nameB} takes a knee.`, side: "b" });
      if (ev.cutA) lines.push({ type: "cut", text: `Cut opened over ${nameA}'s ${ev.cutA.loc}.`, side: "a" });
      if (ev.cutB) lines.push({ type: "cut", text: `Cut opened over ${nameB}'s ${ev.cutB.loc}.`, side: "b" });
      if (isLastExchangeOfRound) {
        lines.push({
          type: "roundEnd",
          text: `— End of Round ${ev.round} — ${nameA}: ${ev.hpA} HP, ${ev.stamA} Stamina | ${nameB}: ${ev.hpB} HP, ${ev.stamB} Stamina`,
          ev,
        });
      }
    }
    const winnerName = res.winner === "a" ? nameA : res.winner === "b" ? nameB : "";
    lines.push({ type: "result", text: res.reason === "Draw" ? "Draw." : `Fight over. ${winnerName} wins by ${res.reason}.` });
    return lines;
  })();

  const Bar=({val,flip,color})=>(
    <div style={{height:5,background:"rgba(255,255,255,0.07)",borderRadius:2,overflow:"hidden"}}>
      <div style={{width:`${val}%`,height:"100%",background:color,borderRadius:2,transition:"width 0.3s",marginLeft:flip?"auto":undefined}}/>
    </div>
  );

  if (arenaMatchId) {
    const nameA = arenaMatchDetail?.a_username || me?.username || "You";
    const nameB = arenaMatchDetail?.b_username || "Opponent";
    const m = arenaMatchDetail;
    const nowMs = Date.now();
    const nextRoundAtMs = m?.next_round_at ? new Date(m.next_round_at).getTime() : 0;
    const countEndsAtMs = m?.count_ends_at ? new Date(m.count_ends_at).getTime() : 0;
    const roundNum = m?.round ?? 0;
    const matchOver = m?.state === "finished" || gameState === "done";
    const isBetweenRounds = !matchOver && m?.state === "running" && roundNum > 0 && nextRoundAtMs > nowMs;
    const isCounting = !matchOver && m?.state === "counting" && countEndsAtMs > nowMs;
    const secsToNextRound = isBetweenRounds ? Math.max(0, Math.ceil((nextRoundAtMs - nowMs) / 1000)) : 0;
    const secsToCountEnd = isCounting ? Math.max(0, Math.ceil((countEndsAtMs - nowMs) / 1000)) : 0;
    return (
      <div className={styles.page} style={{height:"100vh",overflow:"hidden",fontFamily:"'Cinzel',serif",display:"flex",flexDirection:"column"}}>
        <div className={styles.pageContent} style={{padding:"8px 12px",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid var(--noir-border-light)",minHeight:44}}>
          <Link to="/boxing" className={styles.btnGoldDarkText} style={{padding:"10px 14px",minHeight:44,fontSize:10,textDecoration:"none",touchAction:"manipulation"}}>← Back to gym</Link>
          <div style={{fontSize:12,letterSpacing:"0.12em",color:gold}}>{nameA} vs {nameB}</div>
          <div style={{width:70}}/>
        </div>
        <div style={{flex:1,minHeight:0,position:"relative",display:"flex",flexDirection:"column",touchAction:"manipulation",background:"#181822"}}>
          <div style={{flex:1,overflow:"auto",padding:"12px 14px",fontSize:11,lineHeight:1.5,color:"#e0d0b0"}}>
            {!arenaFightResult && (
              <div style={{textAlign:"center",color:"var(--noir-muted)",paddingTop:24}}>Simulating fight…</div>
            )}
            {fightLogLines && fightLogLines.map((item, i) => (
              <div
                key={i}
                style={{
                  marginBottom: item.type === "round" ? 8 : 2,
                  fontWeight: item.type === "round" ? 700 : 400,
                  color: item.type === "round" ? gold : item.type === "kd" ? "#ff8888" : item.type === "cut" ? "#cc6666" : item.type === "result" ? gold : "#c8b898",
                  fontSize: item.type === "round" ? 12 : item.type === "result" ? 12 : 11,
                }}
              >
                {item.text}
              </div>
            ))}
          </div>
          <div style={{padding:"8px 10px 10px",paddingBottom:"max(10px, env(safe-area-inset-bottom))",background:"linear-gradient(transparent,rgba(0,0,0,0.92))",flexShrink:0,borderTop:"1px solid var(--noir-border-light)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",maxWidth:640,margin:"0 auto",gap:8}}>
              <div style={{width:90,fontSize:9,color:gold}}>{nameA}</div>
              <div style={{flex:1,padding:"0 8px",minWidth:0}}>
                <Bar val={hpA} flip={false} color={gold} />
                <div style={{fontSize:8,color:"var(--noir-muted)",marginTop:1}}>HP {hpA}/100</div>
              </div>
              <div style={{fontSize:10,color:"var(--noir-primary)",minWidth:44,textAlign:"center"}}>R{round}/12</div>
              <div style={{flex:1,padding:"0 8px",minWidth:0}}>
                <Bar val={hpB} flip={true} color={crimson} />
                <div style={{fontSize:8,color:"var(--noir-muted)",marginTop:1,textAlign:"right"}}>HP {hpB}/100</div>
              </div>
              <div style={{width:90,fontSize:9,color:crimson,textAlign:"right"}}>{nameB}</div>
            </div>
            {winText && <div style={{fontSize:11,color:gold,textAlign:"center",marginTop:4,fontWeight:700}}>{winText}</div>}
            {matchOver && arenaServerResult && (() => {
              const winnerName = arenaServerResult.winner === m?.a_id ? nameA : nameB;
              const reasonStr = (arenaServerResult.finish_reason || "decision").replace(/_/g, " ");
              return (
                <div style={{fontSize:10,color:"#a09070",textAlign:"center",marginTop:2}}>
                  Official result: {winnerName} wins by {reasonStr}
                </div>
              );
            })()}
          </div>
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
            <button onClick={refreshMatches} disabled={matchesLoading} className={styles.btnGoldDarkText} style={{padding:narrowLayout?"10px 12px":"6px 10px",minHeight:36,fontSize:narrowLayout?11:9,cursor:matchesLoading?"wait":"pointer",touchAction:"manipulation"}}>Refresh</button>
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
                    className={styles.btnGoldDarkText}
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
                        className={styles.btnGoldDarkText}
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
                        className={styles.btnGoldDarkText}
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
                    className={styles.btnGoldDarkText}
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
