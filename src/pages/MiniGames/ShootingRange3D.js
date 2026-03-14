import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import * as THREE from "three";
import { Crosshair } from "lucide-react";
import api from "../../utils/api";
import { toast } from "sonner";
import styles from "../../styles/noir.module.css";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const ROUND_DURATION_SEC  = 60;
const MAX_HITS_FOR_MASTERY = 30;
const BULLET_SPEED        = 110;
const BULLET_MAX_DIST     = 36;
const TARGET_RADIUS       = 0.80;   // big enough to be satisfying
const TARGET_LIFETIME     = 2.8;    // seconds before it vanishes (desktop)
const TARGET_LIFETIME_TOUCH = 4.2;  // longer on touch so players have time to aim
const TARGET_TOUCH_HIT_MULT = 1.28; // count hit if within this × radius (touch forgiveness)
const TARGET_TOUCH_ZONE_MULT = 1.18; // each ring 18% more forgiving on touch
const TARGET_WARN_AT      = 0.9;    // seconds left when it starts pulsing red
const RANGE_LENGTH        = 28;
const BACK_WALL_Z         = -RANGE_LENGTH;
const MAX_AMMO            = 8;
const CLIPS_TOTAL        = 3;
const RELOAD_SECS         = 1.4;
const MUZZLE_FLASH_DUR    = 0.06;
const RANGE_COOLDOWN_MINUTES = 5; // same as Train 5 min — one 3D round per weapon per 5 min

// Scoring zones — inner → outer
const ZONES = [
  { frac: 0.14, pts: 10, label: "✦ Bullseye!",  popColor: "#ffe04a" },
  { frac: 0.30, pts:  7, label: "Inner Ring",    popColor: "#ff8844" },
  { frac: 0.50, pts:  5, label: "Centre",        popColor: "#ee5544" },
  { frac: 0.70, pts:  3, label: "Mid Ring",       popColor: "#c9a460" },
  { frac: 1.00, pts:  1, label: "Outer Ring",    popColor: "#a08040" },
];

// Target movement: along the back wall only (slower horizontal/vertical/diagonal drift)
const MOVE_PATTERNS = ["along_horizontal", "along_vertical", "along_diagonal"];

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDURAL TEXTURES
// ─────────────────────────────────────────────────────────────────────────────
function makeBrickTex(mobile) {
  const sz = mobile ? 256 : 512;
  const c = document.createElement("canvas"); c.width = c.height = sz;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3a2518"; ctx.fillRect(0, 0, sz, sz);
  const bw = 56, bh = 22, mt = 3;
  for (let row = 0; row < 26; row++) {
    for (let col = 0; col < 11; col++) {
      const x = col*(bw+mt) + (row%2)*((bw+mt)/2), y = row*(bh+mt);
      const sh = Math.floor(Math.random()*28);
      ctx.fillStyle = `rgb(${118+sh},${72+sh},${46+sh})`;
      ctx.fillRect(x+mt/2, y+mt/2, bw, bh);
      ctx.fillStyle = "rgba(0,0,0,0.13)";
      ctx.fillRect(x+mt/2, y+mt/2+bh-3, bw, 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.5, 1.6);
  return t;
}

function makeCobblestoneTex(mobile) {
  const sz = mobile ? 128 : 256;
  const c = document.createElement("canvas"); c.width = c.height = sz;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2a221a"; ctx.fillRect(0, 0, sz, sz);
  for (let i = 0; i < 80; i++) {
    const x = Math.random()*sz, y = Math.random()*sz;
    const rx = 12+Math.random()*7, ry = 9+Math.random()*5;
    ctx.beginPath(); ctx.ellipse(x,y,rx,ry,Math.random()*Math.PI,0,Math.PI*2);
    const s = 95+Math.floor(Math.random()*38);
    ctx.fillStyle = `rgb(${s},${s-10},${s-18})`; ctx.fill();
    ctx.strokeStyle = "rgba(28,18,10,0.8)"; ctx.lineWidth = 1.4; ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 5);
  return t;
}

function makeWoodTex() {
  const sz = 256;
  const c = document.createElement("canvas"); c.width = c.height = sz;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0,0,sz,0);
  g.addColorStop(0,"#5a3a1a"); g.addColorStop(0.5,"#7a5028"); g.addColorStop(1,"#5a3a1a");
  ctx.fillStyle = g; ctx.fillRect(0,0,sz,sz);
  for (let i = 0; i < 28; i++) {
    ctx.strokeStyle = `rgba(28,12,4,${0.06+Math.random()*0.08})`; ctx.lineWidth = 1+Math.random()*2;
    ctx.beginPath(); ctx.moveTo(0, i*(sz/28));
    ctx.bezierCurveTo(sz/3,(i+.5)*(sz/28), 2*sz/3,(i+.4)*(sz/28), sz, i*(sz/28));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3);
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// TARGET MESH BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function createTargetMesh() {
  const g = new THREE.Group();
  const R = TARGET_RADIUS;

  // Cardboard backing
  const back = new THREE.Mesh(
    new THREE.CylinderGeometry(R*1.10, R*1.10, 0.03, 32),
    new THREE.MeshStandardMaterial({ color: 0xd4c8a8, roughness: 0.95 })
  );
  back.rotation.x = Math.PI/2; g.add(back);

  // Zone rings outer→inner
  const zoneColors = [0x1a1208, 0xf0e8d0, 0xcc3322, 0xff6a2a, 0xffe04a];
  let z = 0.018;
  zoneColors.forEach((color, i) => {
    const frac = ZONES[ZONES.length-1-i].frac;
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(R * frac, 40),
      new THREE.MeshBasicMaterial({ color })
    );
    m.position.z = z; z += 0.005; g.add(m);
  });

  // Subtle white ring dividers
  [0.30, 0.50, 0.70, 1.00].forEach(frac => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R*frac-0.012, R*frac, 36),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    ring.position.z = z; z += 0.001; g.add(ring);
  });

  // Gold outer border
  const border = new THREE.Mesh(
    new THREE.RingGeometry(R*1.02, R*1.10, 36),
    new THREE.MeshBasicMaterial({ color: 0xc9a030, transparent: true, opacity: 0.65 })
  );
  border.position.z = 0.015; g.add(border);

  // Mounting rod
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.65, 6),
    new THREE.MeshPhongMaterial({ color: 0x3a2810, shininess: 20 })
  );
  rod.position.set(0, -(R+0.32), 0.02); g.add(rod);

  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUN MODEL
// ─────────────────────────────────────────────────────────────────────────────
function createGunModel(woodTex) {
  const g = new THREE.Group();
  const gM = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, metalness: 0.75, roughness: 0.3 });
  const wM = new THREE.MeshStandardMaterial({ color: 0x4a3020, metalness: 0.05, roughness: 0.9, map: woodTex });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.020, 0.52, 12), gM);
  barrel.rotation.x = Math.PI/2; barrel.position.set(0.32, 0, 0); g.add(barrel);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.055, 0.26), gM); body.position.set(0.18, -0.018, 0); g.add(body);
  const stck = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.24), wM); stck.position.set(-0.06, -0.04, -0.04); g.add(stck);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.075, 0.04), gM); grip.position.set(0.14, -0.08, 0.02); g.add(grip);
  const fs = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.018, 0.008), gM); fs.position.set(0.37, 0.022, 0); g.add(fs);
  g.position.set(0.22, -0.28, -0.54);
  g.rotation.order = "YXZ"; g.rotation.y = 0.022; g.rotation.x = 0.05;
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD SCENE
// ─────────────────────────────────────────────────────────────────────────────
function buildScene(scene, mobile, woodTex, brickTex, cobbleTex) {
  const ph  = (c, s=15, map=null) => new THREE.MeshPhongMaterial({ color:c, shininess:s, ...(map?{map}:{}) });
  const lmt = (c) => new THREE.MeshLambertMaterial({ color:c });

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5.5, RANGE_LENGTH+6), ph(0x5a4a38, 4, cobbleTex));
  floor.rotation.x = -Math.PI/2; floor.position.set(0, 0, -RANGE_LENGTH/2-1);
  floor.receiveShadow = true; scene.add(floor);

  // Side walls
  const wallMat = ph(0x7a5a40, 6, brickTex);
  const wallL = new THREE.Mesh(new THREE.PlaneGeometry(RANGE_LENGTH+2, 3.4), wallMat);
  wallL.rotation.y = Math.PI/2; wallL.position.set(-2.6, 1.7, -RANGE_LENGTH/2); wallL.receiveShadow = true; scene.add(wallL);
  const wallR = wallL.clone(); wallR.rotation.y = -Math.PI/2; wallR.position.x = 2.6; scene.add(wallR);

  // Ceiling
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(5.5, RANGE_LENGTH+6), ph(0x2a1a0c, 3, woodTex));
  ceil.rotation.x = Math.PI/2; ceil.position.set(0, 3.1, -RANGE_LENGTH/2-1); scene.add(ceil);

  // Back wall
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 3.4), ph(0xa09070, 8));
  backWall.position.set(0, 1.7, BACK_WALL_Z); backWall.receiveShadow = true; scene.add(backWall);

  // Target frame
  const frPostM = ph(0x5a3c1e, 8, woodTex);
  [-1.2, 1.2].forEach(x => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.6, 0.09), frPostM);
    p.position.set(x, 1.3, BACK_WALL_Z+0.12); if (!mobile) p.castShadow = true; scene.add(p);
  });
  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.09, 0.09), frPostM);
  crossbar.position.set(0, 2.5, BACK_WALL_Z+0.12); scene.add(crossbar);

  // Rope pulleys
  const brassM = new THREE.MeshPhongMaterial({ color: 0x8a6a30, shininess: 60 });
  [-1.2, 1.2].forEach(x => {
    const pul = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 8, 20), brassM);
    pul.rotation.x = Math.PI/2; pul.position.set(x, 2.5, BACK_WALL_Z+0.14); scene.add(pul);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.9, 4), lmt(0x5a4020));
    rope.position.set(x, 2.0, BACK_WALL_Z+0.12); scene.add(rope);
  });

  // Target board backing
  const targetBoard = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.2), ph(0xd8ceb0, 5));
  targetBoard.position.set(0, 1.3, BACK_WALL_Z+0.15); scene.add(targetBoard);

  // Ceiling beams
  for (let i = 0; i < 5; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.14, 0.14), ph(0x2a1a0a, 5, woodTex));
    beam.position.set(0, 3.04, -RANGE_LENGTH/2 + i*(RANGE_LENGTH/4));
    if (!mobile) beam.castShadow = true; scene.add(beam);
  }

  // Barrel prop
  const barrelG = new THREE.Group();
  const barBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.52, 16), ph(0x5a3a18, 8, woodTex));
  barrelG.add(barBody);
  [-0.16, 0.16].forEach(y => {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.018, 8, 24), new THREE.MeshPhongMaterial({ color: 0x5a4018, shininess: 40 }));
    hoop.rotation.x = Math.PI/2; hoop.position.y = y; barrelG.add(hoop);
  });
  barrelG.position.set(-2.1, 0.26, -3); scene.add(barrelG);

  // Ambient haze particles
  const hazeArr = [];
  for (let i = 0; i < (mobile ? 60 : 120); i++)
    hazeArr.push((Math.random()-0.5)*5, 0.2+Math.random()*2.8, -Math.random()*RANGE_LENGTH);
  const hazeGeo = new THREE.BufferGeometry();
  hazeGeo.setAttribute("position", new THREE.Float32BufferAttribute(hazeArr, 3));
  const hazeMesh = new THREE.Points(hazeGeo, new THREE.PointsMaterial({ color: 0xc0a880, size: 0.06, transparent: true, opacity: 0.06 }));
  scene.add(hazeMesh);

  return { hazeMesh };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ShootingRange3D() {
  const canvasRef = useRef(null);

  // Three.js refs — never trigger re-renders
  const r = useRef({
    renderer: null, scene: null, camera: null,
    target: null, gun: null,
    bullets: [], bulletGroup: null,
    muzzleFlash: null, muzzleLight: null,
    lampLights: [],
    hazeMesh: null, smokePts: null, smokeGeo: null, SMOKE_COUNT: 0,
    holeGroup: null, holeCount: 0,
    // game state (mutable, read in rAF)
    phase: "idle",          // idle | playing | done
    score: 0,
    ammo: MAX_AMMO,
    clipsRemaining: CLIPS_TOTAL,
    isReloading: false,
    reloadEnd: 0,
    roundEndAt: 0,
    flashEnd: 0,
    // target movement
    targetVisible: false,
    targetSpawnedAt: 0,
    targetLifetime: TARGET_LIFETIME,
    targetPattern: "pendulum",
    targetOriginX: 0,
    targetOriginY: 0,
    targetPhase: 0,
    nextSpawnAt: 0,
    raf: null,
  });

  // React state — only what drives re-renders
  const { weaponId: routeWeaponId } = useParams();
  const [masteryData, setMasteryData]   = useState(null);
  const [weaponsList, setWeaponsList]   = useState([]);
  const [weaponId, setWeaponId]         = useState(routeWeaponId || "");
  const [gamePhase, setGamePhase]       = useState("idle");
  const [score, setScore]               = useState(0);
  const [timeLeft, setTimeLeft]         = useState(ROUND_DURATION_SEC);
  const [ammoState, setAmmoState]       = useState(MAX_AMMO);
  const [clipsRemainingState, setClipsRemainingState] = useState(CLIPS_TOTAL);
  const [isReloading, setIsReloading]   = useState(false);
  const [sceneReady, setSceneReady]     = useState(false);
  const [sceneError, setSceneError]     = useState(null);
  const [popInfo, setPopInfo]           = useState(null); // { pts, label, color, key }
  const [zoneLabel, setZoneLabel]       = useState(null);
  const [reloadAnim, setReloadAnim]     = useState(false);
  const [targetUrgent, setTargetUrgent] = useState(false);
  const [leaderboard, setLeaderboard]   = useState([]);
  const [cooldownSecondsLeft, setCooldownSecondsLeft] = useState(0);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    setIsTouchDevice(typeof window !== "undefined" && (window.innerWidth < 700 || "ontouchstart" in window));
  }, []);

  const gamePhaseRef = useRef("idle");
  useEffect(() => { gamePhaseRef.current = gamePhase; }, [gamePhase]);

  const fetchMastery = useCallback(async () => {
    try { const res = await api.get("/shooting-range/mastery"); setMasteryData(res.data); }
    catch { setMasteryData(null); }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await api.get("/shooting-range/leaderboard");
      setLeaderboard(Array.isArray(res.data?.leaderboard) ? res.data.leaderboard : []);
    } catch {
      setLeaderboard([]);
    }
  }, []);

  useEffect(() => { fetchMastery(); }, [fetchMastery]);
  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  // 5-min cooldown: derive from mastery last_trained_at for selected weapon
  useEffect(() => {
    if (!weaponId || !masteryData?.mastery?.[weaponId]?.last_trained_at) {
      setCooldownSecondsLeft(0);
      return;
    }
    const last = masteryData.mastery[weaponId].last_trained_at;
    const lastMs = new Date(last).getTime();
    const cooldownEndMs = lastMs + RANGE_COOLDOWN_MINUTES * 60 * 1000;
    const update = () => {
      const left = Math.max(0, Math.ceil((cooldownEndMs - Date.now()) / 1000));
      setCooldownSecondsLeft(left);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [weaponId, masteryData]);

  useEffect(() => {
    let cancelled = false;
    api.get("/weapons").then(res => {
      if (!cancelled && Array.isArray(res.data)) setWeaponsList(res.data);
    }).catch(() => { if (!cancelled) setWeaponsList([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (routeWeaponId && !weaponId) setWeaponId(routeWeaponId);
  }, [routeWeaponId, weaponId]);

  const ownedGuns = masteryData?.weapons?.filter(w =>
    w.id !== "weapon1" && weaponsList.some(x => x.id === w.id && x.owned) && (masteryData.mastery?.[w.id]?.can_train !== false)
  ) || [];
  const canPlay = ownedGuns.some(w => w.id === weaponId);

  // ── SCORE POP ────────────────────────────────────────────────────────────────
  const showScorePop = useCallback((pts, zone) => {
    setPopInfo({ pts, label: zone.label, color: zone.popColor, key: Date.now() });
    setZoneLabel({ text: `${zone.label}  +${pts}`, color: zone.popColor, key: Date.now() });
    setTimeout(() => setPopInfo(null), 900);
    setTimeout(() => setZoneLabel(null), 1100);
  }, []);

  // ── RELOAD ───────────────────────────────────────────────────────────────────
  const doReload = useCallback(() => {
    const state = r.current;
    if (state.isReloading || state.ammo >= MAX_AMMO) return;
    if (state.clipsRemaining <= 0) return; // no clips left
    state.isReloading = true;
    state.reloadEnd = performance.now()/1000 + RELOAD_SECS;
    setIsReloading(true);
    setReloadAnim(true);
    if (state.gun) { state.gun.rotation.x = 0.18; setTimeout(() => { if (state.gun) state.gun.rotation.x = 0.05; }, 400); }
  }, []);

  const finishReload = useCallback(() => {
    const state = r.current;
    state.isReloading = false;
    state.clipsRemaining--;
    state.ammo = MAX_AMMO;
    setClipsRemainingState(state.clipsRemaining);
    setAmmoState(MAX_AMMO);
    setIsReloading(false);
    setTimeout(() => setReloadAnim(false), 50);
  }, []);

  // ── SPAWN TARGET ─────────────────────────────────────────────────────────────
  const spawnTarget = useCallback(() => {
    const state = r.current;
    if (!state.target) return;
    const mobile = window.innerWidth < 700;
    const xRange = mobile ? 1.6 : 2.0;
    const ox = -(xRange/2) + Math.random() * xRange;
    const oy = 0.72 + Math.random() * 1.3;
    state.targetOriginX = ox;
    state.targetOriginY = oy;
    state.targetPattern = MOVE_PATTERNS[Math.floor(Math.random() * MOVE_PATTERNS.length)];
    state.targetPhase = Math.random() * Math.PI * 2;
    state.target.position.set(ox, oy, BACK_WALL_Z + 0.20);
    state.target.scale.set(0.01, 0.01, 0.01);
    state.target.visible = true;
    state.targetVisible = true;
    state.targetSpawnedAt = performance.now()/1000;
    setTargetUrgent(false);
    // Pop-in
    const popIn = () => {
      if (!state.target || !state.target.visible) return;
      state.target.scale.x = Math.min(1, state.target.scale.x + 0.15);
      state.target.scale.y = Math.min(1, state.target.scale.y + 0.15);
      state.target.scale.z = Math.min(1, state.target.scale.z + 0.15);
      if (state.target.scale.x < 1) requestAnimationFrame(popIn);
    };
    requestAnimationFrame(popIn);
  }, []);

  const hideTarget = useCallback((scored) => {
    const state = r.current;
    if (!state.target) return;
    state.target.visible = false;
    state.targetVisible = false;
    setTargetUrgent(false);
    if (!scored) {
      // Miss-disappear: briefly show a "Gone!" flash? just set next spawn
    }
    state.nextSpawnAt = performance.now()/1000 + 0.35 + Math.random() * 0.55;
  }, []);

  // ── ADD BULLET HOLE ──────────────────────────────────────────────────────────
  const addBulletHole = useCallback((x, y) => {
    const state = r.current;
    if (!state.holeGroup || state.holeCount > 40) return;
    state.holeCount++;
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(0.022 + Math.random()*0.014, 8),
      new THREE.MeshBasicMaterial({ color: 0x0a0604 })
    );
    hole.position.set(x, y, BACK_WALL_Z+0.16); state.holeGroup.add(hole);
    const spall = new THREE.Mesh(
      new THREE.RingGeometry(0.022, 0.048, 12),
      new THREE.MeshBasicMaterial({ color: 0x6a5030, transparent: true, opacity: 0.5 })
    );
    spall.position.set(x, y, BACK_WALL_Z+0.165); state.holeGroup.add(spall);
  }, []);

  // ── SHOOT ────────────────────────────────────────────────────────────────────
  const shoot = useCallback((clientX, clientY) => {
    const state = r.current;
    if (state.phase !== "playing") return;
    if (state.isReloading) return;
    if (state.ammo <= 0) { if (state.clipsRemaining > 0) doReload(); return; }

    state.ammo--;
    setAmmoState(state.ammo);
    if (state.ammo === 0 && state.clipsRemaining > 0) setTimeout(doReload, 300);

    const canvas = canvasRef.current;
    if (!canvas || !state.camera) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((clientY - rect.top) / rect.height) * 2 + 1;

    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(mx, my), state.camera);
    const dir = ray.ray.direction.clone().normalize();

    const bm = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0xc9a020, metalness: 0.6, roughness: 0.4, emissive: 0xaa8010, emissiveIntensity: 0.4 })
    );
    bm.position.copy(state.camera.position).add(dir.clone().multiplyScalar(0.35));
    state.bulletGroup.add(bm);
    state.bullets.push({ mesh: bm, vel: dir.clone().multiplyScalar(BULLET_SPEED), dist: 0 });

    // Muzzle flash
    if (state.muzzleFlash) {
      state.muzzleFlash.visible = true;
      state.muzzleFlash.position.copy(state.camera.position).add(dir.clone().multiplyScalar(0.4));
      state.flashEnd = performance.now()/1000 + MUZZLE_FLASH_DUR;
      if (state.muzzleLight) { state.muzzleLight.intensity = 4.5; state.muzzleLight.position.copy(state.muzzleFlash.position); }
    }

    // Camera kick
    state.camera.rotation.x -= 0.016;
    setTimeout(() => { if (state.camera) state.camera.rotation.x += 0.016; }, 75);

    // Smoke puff
    if (state.smokePts && state.muzzleFlash) {
      const si = Math.floor(Math.random() * state.SMOKE_COUNT) * 3;
      state.smokePts[si]   = state.muzzleFlash.position.x + (Math.random()-0.5)*0.05;
      state.smokePts[si+1] = state.muzzleFlash.position.y + (Math.random()-0.5)*0.05;
      state.smokePts[si+2] = state.muzzleFlash.position.z;
      if (state.smokeGeo) state.smokeGeo.attributes.position.needsUpdate = true;
    }
  }, [doReload]);

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    const touches = e.touches;
    if (touches && touches.length > 0) shoot(touches[0].clientX, touches[0].clientY);
    else shoot(e.clientX, e.clientY);
  }, [shoot]);

  // ── START ROUND ──────────────────────────────────────────────────────────────
  const startRound = useCallback(() => {
    if (cooldownSecondsLeft > 0) return;
    const state = r.current;
    state.phase = "playing";
    state.score = 0;
    state.ammo = MAX_AMMO;
    state.clipsRemaining = CLIPS_TOTAL;
    state.isReloading = false;
    state.roundEndAt = performance.now()/1000 + ROUND_DURATION_SEC;
    state.nextSpawnAt = 0;
    state.holeCount = 0;
    if (state.holeGroup) { while (state.holeGroup.children.length) { const c = state.holeGroup.children[0]; c.geometry?.dispose(); c.material?.dispose(); state.holeGroup.remove(c); } }
    setGamePhase("playing"); gamePhaseRef.current = "playing";
    setScore(0); setTimeLeft(ROUND_DURATION_SEC); setAmmoState(MAX_AMMO); setClipsRemainingState(CLIPS_TOTAL);
    setIsReloading(false); setReloadAnim(false); setTargetUrgent(false);
    spawnTarget();
  }, [spawnTarget, cooldownSecondsLeft]);

  // ── THREE.JS SCENE SETUP ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!weaponId || !canvasRef.current || !canPlay) return;

    setSceneError(null); setSceneReady(false);
    const state = r.current;
    const canvas = canvasRef.current;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 700;

    let renderer, scene, camera, textures = [];

    try {
      const W = Math.max(320, canvas.clientWidth || 640);
      const H = Math.max(200, canvas.clientHeight || 400);

      renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
      renderer.setSize(W, H, false);
      renderer.shadowMap.enabled = !mobile;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.7;

      scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x2a1810, 22, 45);
      scene.background = new THREE.Color(0x251810);

      camera = new THREE.PerspectiveCamera(mobile ? 62 : 54, W/H, 0.1, 80);
      camera.position.set(0, 1.35, 5);
      camera.lookAt(0, 1.3, -10);

      // Textures
      const woodTex    = makeWoodTex();
      const brickTex   = makeBrickTex(mobile);
      const cobbleTex  = makeCobblestoneTex(mobile);
      textures = [woodTex, brickTex, cobbleTex];

      // Lights — brighter so range isn't too dark
      scene.add(new THREE.AmbientLight(0x3a2818, 2.8));
      const lampPositions = [[-1.2,2.7,-4],[1.2,2.7,-4],[0,2.7,-12],[0,2.7,-20]];
      const lampLights = [];
      lampPositions.forEach(([x,y,z]) => {
        const l = new THREE.PointLight(0xe8a030, 6.5, 12, 1.6);
        l.position.set(x,y,z);
        if (!mobile) { l.castShadow = true; l.shadow.mapSize.set(512,512); l.shadow.radius = 6; }
        scene.add(l); lampLights.push(l);
        // Lamp cage
        const lmpGeo = new THREE.SphereGeometry(0.14, 8, 6, 0, Math.PI*2, 0, Math.PI*0.6);
        const lmpMat = new THREE.MeshPhongMaterial({ color:0xffc040, emissive:0xffa020, emissiveIntensity:0.9, transparent:true, opacity:0.85, side:THREE.DoubleSide, wireframe:true });
        const lmp = new THREE.Mesh(lmpGeo, lmpMat); lmp.position.set(x,y+0.04,z); scene.add(lmp);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005,0.005,0.25,4), new THREE.MeshBasicMaterial({color:0x2a1a08}));
        cord.position.set(x,y+0.25,z); scene.add(cord);
      });

      const muzzleLight = new THREE.PointLight(0xff8820, 0, 2.5); scene.add(muzzleLight);
      const muzzleFlash = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 8),
        new THREE.MeshBasicMaterial({ color:0xffaa22, transparent:true, opacity:0.9 })
      );
      muzzleFlash.visible = false; scene.add(muzzleFlash);

      // Scene
      const { hazeMesh } = buildScene(scene, mobile, woodTex, brickTex, cobbleTex);

      // Smoke
      const SMOKE_COUNT = mobile ? 20 : 40;
      const smokePts = new Float32Array(SMOKE_COUNT * 3);
      for (let i=0; i<SMOKE_COUNT; i++) { smokePts[i*3]=0; smokePts[i*3+1]=-100; smokePts[i*3+2]=0; }
      const smokeGeo = new THREE.BufferGeometry();
      smokeGeo.setAttribute("position", new THREE.Float32BufferAttribute(smokePts, 3));
      const smokeMesh = new THREE.Points(smokeGeo, new THREE.PointsMaterial({color:0xb0a090, size:0.12, transparent:true, opacity:0.22}));
      scene.add(smokeMesh);

      // Bullet holes group
      const holeGroup = new THREE.Group(); scene.add(holeGroup);

      // Target
      const target = createTargetMesh();
      target.visible = false;
      scene.add(target);

      // Gun
      const gun = createGunModel(woodTex);
      camera.add(gun); scene.add(camera);

      // Bullet group
      const bulletGroup = new THREE.Group(); scene.add(bulletGroup);

      // Store refs
      state.renderer    = renderer;
      state.scene       = scene;
      state.camera      = camera;
      state.target      = target;
      state.gun         = gun;
      state.bullets     = [];
      state.bulletGroup = bulletGroup;
      state.muzzleFlash = muzzleFlash;
      state.muzzleLight = muzzleLight;
      state.lampLights  = lampLights;
      state.hazeMesh    = hazeMesh;
      state.smokePts    = smokePts;
      state.smokeGeo    = smokeGeo;
      state.SMOKE_COUNT = SMOKE_COUNT;
      state.holeGroup   = holeGroup;
      state.holeCount   = 0;
      state.phase       = "idle";
      state.score       = 0;
      state.ammo        = MAX_AMMO;
      state.clipsRemaining = CLIPS_TOTAL;
      state.isReloading = false;
      state.targetVisible = false;
      const touchFriendly = typeof window !== "undefined" && (window.innerWidth < 700 || "ontouchstart" in window);
      state.touchFriendly = touchFriendly;
      state.targetLifetime = touchFriendly ? TARGET_LIFETIME_TOUCH : TARGET_LIFETIME;

      const tempVec = new THREE.Vector3();

      // ── MAIN LOOP ──────────────────────────────────────────────────────────
      const loop = () => {
        state.raf = requestAnimationFrame(loop);
        if (!state.renderer || !state.scene || !state.camera) return;

        const t = performance.now()/1000;
        const dt = Math.min(0.05, 1/60);

        // Lamp flicker
        state.lampLights.forEach((l, i) => {
          l.intensity = 6.2 + Math.sin(t*(1.2+i*0.3))*0.3 + (Math.random()>0.992 ? -1.5 : 0);
        });

        // Haze
        if (state.hazeMesh) {
          const hp = state.hazeMesh.geometry.attributes.position.array;
          for (let i=0; i<hp.length; i+=3) { hp[i]+=Math.sin(t*0.3+i)*0.003; hp[i+1]+=dt*0.022; if(hp[i+1]>3.2)hp[i+1]=0.2; }
          state.hazeMesh.geometry.attributes.position.needsUpdate = true;
        }

        // Smoke drift
        if (state.smokePts) {
          for (let i=0; i<state.smokePts.length; i+=3) {
            if (state.smokePts[i+1]>-50) { state.smokePts[i+1]+=dt*0.12; state.smokePts[i]*=0.99; }
          }
          if (state.smokeGeo) state.smokeGeo.attributes.position.needsUpdate = true;
        }

        // Muzzle decay
        if (t >= state.flashEnd) {
          if (state.muzzleFlash) state.muzzleFlash.visible = false;
          if (state.muzzleLight) state.muzzleLight.intensity = Math.max(0, state.muzzleLight.intensity - dt*22);
        }

        // Reload
        if (state.isReloading && t >= state.reloadEnd) finishReload();

        // ── TARGET MOVEMENT + EXPIRY ─────────────────────────────────────
        if (state.targetVisible && state.target && state.target.visible) {
          const age = t - state.targetSpawnedAt;
          const remaining = state.targetLifetime - age;

          // Movement — slower, along the back wall only (x/y drift, z stays at back wall)
          const speed = 0.22 + (age / state.targetLifetime) * 0.12;
          let tx = state.targetOriginX;
          let ty = state.targetOriginY;
          const ph = state.targetPhase + age * speed;

          switch (state.targetPattern) {
            case "along_horizontal":
              tx = state.targetOriginX + Math.sin(ph * 0.6) * 1.0;
              break;
            case "along_vertical":
              ty = state.targetOriginY + Math.sin(ph * 0.5) * 0.5;
              break;
            case "along_diagonal":
              tx = state.targetOriginX + Math.sin(ph * 0.45) * 0.85;
              ty = state.targetOriginY + Math.cos(ph * 0.45) * 0.4;
              break;
            default:
              tx = state.targetOriginX + Math.sin(ph * 0.5) * 0.8;
              break;
          }

          // Keep target on the back wall (z already set at spawn)
          tx = Math.max(-2.0, Math.min(2.0, tx));
          ty = Math.max(0.5, Math.min(2.4, ty));
          state.target.position.x = tx;
          state.target.position.y = ty;
          state.target.position.z = BACK_WALL_Z + 0.20;

          // Urgency: pulse scale + warn UI when nearly expired
          if (remaining <= TARGET_WARN_AT) {
            setTargetUrgent(true);
            const pulse = 1 + Math.sin(t * 14) * 0.055 * (1 - remaining/TARGET_WARN_AT);
            state.target.scale.setScalar(pulse);
          }

          // Expire
          if (remaining <= 0) {
            hideTarget(false);
          }
        }

        // ── ROUND TIMER (or out of clips = round over) ─────────────────────
        if (state.phase === "playing") {
          const rem = Math.ceil(Math.max(0, state.roundEndAt - t));
          setTimeLeft(rem);
          const timeUp = t >= state.roundEndAt;
          const clipsOut = state.ammo === 0 && state.clipsRemaining === 0;
          if (timeUp || clipsOut) {
            state.phase = "done";
            if (state.target) state.target.visible = false;
            state.targetVisible = false;
            setGamePhase("done"); gamePhaseRef.current = "done";
            const finalScore = state.score;
            const toSubmit = Math.min(finalScore, MAX_HITS_FOR_MASTERY);
            if (toSubmit > 0 && weaponId) {
              api.post("/shooting-range/train", { weapon_id: weaponId, mode: "live", hits: toSubmit })
                .then(res => toast.success(res.data?.message || `Score: ${finalScore}. +${toSubmit}% mastery.`))
                .catch(e => toast.error(e.response?.data?.detail || "Submit failed."));
            } else if (finalScore > 0) {
              toast.info(`Round over! Score: ${finalScore}`);
            }
            if (finalScore >= 0) {
              api.post("/shooting-range/score", { score: finalScore })
                .then(() => fetchLeaderboard())
                .catch(() => {});
            }
            fetchMastery();
          }
        }

        // ── BULLETS ───────────────────────────────────────────────────────
        for (let i = state.bullets.length-1; i >= 0; i--) {
          const b = state.bullets[i];
          b.mesh.position.addScaledVector(b.vel, dt);
          b.dist += BULLET_SPEED * dt;
          let remove = b.dist >= BULLET_MAX_DIST;

          if (!remove && state.targetVisible && state.target?.visible) {
            tempVec.set(state.target.position.x, state.target.position.y, state.target.position.z);
            const dx = b.mesh.position.x - tempVec.x;
            const dy = b.mesh.position.y - tempVec.y;
            const dz = b.mesh.position.z - tempVec.z;
            const hitRad = state.touchFriendly ? TARGET_RADIUS * TARGET_TOUCH_HIT_MULT : TARGET_RADIUS;
            const zoneMult = state.touchFriendly ? TARGET_TOUCH_ZONE_MULT : 1.0;
            if (dx*dx + dy*dy + dz*dz < hitRad * hitRad * 1.5) {
              const lateralDist = Math.sqrt(dx*dx + dy*dy);
              let hitZone = ZONES[ZONES.length-1];
              for (const zone of ZONES) {
                if (lateralDist <= TARGET_RADIUS * Math.min(1, zone.frac * zoneMult)) { hitZone = zone; break; }
              }
              hideTarget(true);
              state.score += hitZone.pts;
              setScore(state.score);
              showScorePop(hitZone.pts, hitZone);
              addBulletHole(tempVec.x + dx*0.6, tempVec.y + dy*0.6);
              remove = true;
            }
          }

          if (!remove && b.mesh.position.z <= BACK_WALL_Z + 0.22) {
            addBulletHole(b.mesh.position.x, b.mesh.position.y); remove = true;
          }

          if (remove) {
            state.bulletGroup.remove(b.mesh);
            b.mesh.geometry.dispose(); b.mesh.material.dispose();
            state.bullets.splice(i, 1);
          }
        }

        // ── SPAWN NEXT TARGET ─────────────────────────────────────────────
        if (state.phase === "playing" && t >= state.nextSpawnAt && !state.targetVisible) {
          spawnTarget();
        }

        // Subtle camera breathe
        state.camera.position.x = Math.sin(t * 0.004) * 0.04;

        renderer.render(scene, camera);
      };

      loop();
      setSceneReady(true);

    } catch (err) {
      setSceneError(err?.message || String(err));
    }

    // Resize
    const onResize = () => {
      const w = Math.max(320, canvas.clientWidth || 640);
      const h = Math.max(200, canvas.clientHeight || 400);
      if (state.renderer) { state.renderer.setSize(w, h, false); }
      if (state.camera) { state.camera.aspect = w/h; state.camera.updateProjectionMatrix(); }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (state.raf) cancelAnimationFrame(state.raf);
      textures.forEach(t => t?.dispose?.());
      if (state.bullets && state.bulletGroup) {
        state.bullets.forEach(b => { state.bulletGroup.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); });
      }
      if (renderer && scene) {
        renderer.dispose();
        scene.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) { Array.isArray(o.material) ? o.material.forEach(m => m.dispose()) : o.material.dispose(); }
        });
      }
      state.renderer = null; state.scene = null; state.camera = null;
    };
  }, [weaponId, canPlay]); // eslint-disable-line

  // ── RENDER ───────────────────────────────────────────────────────────────────
  const isMobileView = typeof window !== "undefined" && window.innerWidth < 700;

  return (
    <div className={`space-y-4 ${styles.pageContent} mx-auto`} style={{ maxWidth: 900 }}>
      <style>{`
        .sr-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
      `}</style>

      {/* Breadcrumb */}
      <div className="relative">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Armoury</p>
        <Link to="/shooting-range" className="text-[10px] font-heading uppercase tracking-wider text-primary hover:opacity-90">
          ← Shooting range
        </Link>
      </div>

      {/* Header — match Crimes/Casino */}
      <div className="relative">
        <div className="flex items-center gap-2 mb-1">
          <Crosshair size={22} className="text-primary" />
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">
            3D Range
          </h1>
        </div>
        <p className="text-[10px] text-mutedForeground font-heading italic mt-1">
          Moving targets vanish after {isTouchDevice ? TARGET_LIFETIME_TOUCH : TARGET_LIFETIME}s — aim fast. Bullseye pays <strong className="text-primary">10 pts</strong>, outer ring pays 1.
          {isTouchDevice && " Extra time & bigger hit area on touch."}
          Max <strong className="text-primary">+{MAX_HITS_FOR_MASTERY}%</strong> mastery per round.
        </p>
      </div>

      {/* Weapon select — panel like Casino */}
      {(!weaponId || !canPlay) ? (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Weapon</h2>
          </div>
          <div className="p-3">
            <select
              value={weaponId}
              onChange={e => setWeaponId(e.target.value)}
              className={`w-full max-w-xs px-3 py-2 text-sm font-heading ${styles.input}`}
            >
              <option value="">Select a gun you own</option>
              {ownedGuns.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            {ownedGuns.length === 0 && masteryData && (
              <p className="text-[11px] text-primary mt-2">You need to own a gun to play the 3D range.</p>
            )}
          </div>
          <div className="sr-art-line text-primary mx-3" />
        </div>
      ) : sceneError ? (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="p-4">
            <p className="text-sm font-heading text-foreground mb-2">Something went wrong loading the 3D range.</p>
            <p className="text-xs text-mutedForeground font-mono mb-3">{sceneError}</p>
            <Link to="/shooting-range" className="text-sm font-heading font-bold uppercase tracking-wider text-primary hover:opacity-90">← Back</Link>
          </div>
        </div>
      ) : (
        <div
          className="relative rounded-lg overflow-hidden border border-primary/20 bg-black select-none"
          style={{ aspectRatio: "16/10", maxHeight: "68vh", minHeight: 280 }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair", touchAction: "none" }}
            onPointerDown={onPointerDown}
            onTouchStart={onPointerDown}
          />

          {/* ── OVERLAY HUD ── */}
          {sceneReady && (
            <>
              {/* Top bar */}
              <div
                className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2 px-3 pt-2 pb-3"
                style={{ background: "linear-gradient(to bottom,rgba(8,5,3,.95),transparent)", pointerEvents: "none" }}
              >
                {/* Score */}
                <div>
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize:7, letterSpacing:"0.28em", textTransform:"uppercase", color:"#6a4e28", marginBottom:2 }}>Score</div>
                  <div style={{ fontFamily:"'Cinzel',serif", fontWeight:700, fontSize:"clamp(22px,5vw,34px)", color:"#c9a460", lineHeight:1, textShadow:"0 0 22px rgba(201,164,96,.45),0 2px 0 rgba(0,0,0,.9)" }}>
                    {score}
                  </div>
                </div>
                {/* Centre: ammo */}
                <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize:7, letterSpacing:"0.24em", textTransform:"uppercase", color:"#6a4e28" }}>
                    {isReloading ? "Reloading…" : `Clip ${Math.min(CLIPS_TOTAL, CLIPS_TOTAL - clipsRemainingState + 1)}/${CLIPS_TOTAL}`}
                  </div>
                  <div style={{ display:"flex", gap:3, alignItems:"flex-end", flexWrap:"wrap", justifyContent:"center", maxWidth:140 }}>
                    {Array.from({ length: MAX_AMMO }, (_, i) => (
                      <div
                        key={i}
                        style={{
                          width: 5, height: 13,
                          borderRadius: "3px 3px 1px 1px",
                          background: i < ammoState
                            ? "linear-gradient(to bottom,#e8c870,#b89040)"
                            : "#2a1a04",
                          opacity: i < ammoState ? 0.9 : 0.12,
                          boxShadow: i < ammoState ? "0 0 4px rgba(201,164,96,.3)" : "none",
                          transition: "all 0.25s",
                          animationDelay: reloadAnim && i >= 0 ? `${i * 0.07}s` : "0s",
                        }}
                      />
                    ))}
                  </div>
                </div>
                {/* Time */}
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize:7, letterSpacing:"0.28em", textTransform:"uppercase", color:"#6a4e28", marginBottom:2 }}>Time</div>
                  <div style={{
                    fontFamily:"'Cinzel',serif", fontWeight:700, fontSize:"clamp(20px,4.5vw,30px)", lineHeight:1,
                    color: timeLeft <= 10 ? "#ff4444" : "#c9a460",
                    textShadow: timeLeft <= 10 ? "0 0 18px rgba(255,68,68,.6)" : "0 0 18px rgba(201,164,96,.4)",
                    transition: "color 0.3s",
                  }}>
                    {timeLeft}
                  </div>
                </div>
              </div>

              {/* Decorative rule */}
              <div style={{ position:"absolute", top:60, left:0, right:0, height:1, background:"linear-gradient(90deg,transparent,rgba(201,164,96,.28),transparent)", pointerEvents:"none" }} />

              {/* Desktop crosshair */}
              {!isMobileView && (
                <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", pointerEvents:"none", opacity:0.55 }}>
                  <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                    <circle cx="22" cy="22" r="10" stroke="#c9a460" strokeWidth="1" opacity=".7"/>
                    <line x1="22" y1="2" x2="22" y2="11" stroke="#c9a460" strokeWidth="1.2"/>
                    <line x1="22" y1="33" x2="22" y2="42" stroke="#c9a460" strokeWidth="1.2"/>
                    <line x1="2" y1="22" x2="11" y2="22" stroke="#c9a460" strokeWidth="1.2"/>
                    <line x1="33" y1="22" x2="42" y2="22" stroke="#c9a460" strokeWidth="1.2"/>
                    <circle cx="22" cy="22" r="1.6" fill="#c9a460" opacity=".9"/>
                  </svg>
                </div>
              )}

              {/* Target urgency border pulse */}
              {targetUrgent && (
                <div style={{
                  position:"absolute", inset:0, pointerEvents:"none",
                  boxShadow:"inset 0 0 40px rgba(220,60,40,.35)",
                  animation:"urgentPulse 0.4s ease-in-out infinite alternate",
                }} />
              )}

              {/* Score pop */}
              {popInfo && (
                <div
                  key={popInfo.key}
                  style={{
                    position:"absolute", top:"42%", left:"50%",
                    transform:"translate(-50%,-50%)",
                    pointerEvents:"none", zIndex:30,
                    fontFamily:"'Cinzel',serif", fontWeight:700,
                    fontSize:"clamp(26px,7vw,48px)",
                    color: popInfo.color,
                    textShadow: `0 0 28px ${popInfo.color}`,
                    whiteSpace:"nowrap",
                    animation:"scorePop 0.7s cubic-bezier(.2,.8,.4,1) forwards",
                  }}
                >
                  +{popInfo.pts}
                </div>
              )}

              {/* Zone label */}
              {zoneLabel && (
                <div
                  key={zoneLabel.key}
                  style={{
                    position:"absolute", bottom:"24%", left:"50%",
                    transform:"translateX(-50%)",
                    pointerEvents:"none", zIndex:28,
                    fontFamily:"'Crimson Text',serif", fontStyle:"italic",
                    fontSize:"clamp(13px,3.5vw,18px)",
                    color: zoneLabel.color,
                    textShadow: `0 0 12px ${zoneLabel.color}80`,
                    whiteSpace:"nowrap",
                    animation:"zoneFade 1s forwards",
                  }}
                >
                  {zoneLabel.text}
                </div>
              )}

              {/* Reload banner */}
              {isReloading && (
                <div style={{
                  position:"absolute", top:"50%", left:"50%",
                  transform:"translate(-50%,-50%)",
                  pointerEvents:"none", zIndex:28,
                  fontFamily:"'Cinzel',serif", fontWeight:700,
                  fontSize:"clamp(11px,3.5vw,17px)",
                  letterSpacing:"0.25em", textTransform:"uppercase",
                  color:"#c9a460",
                  textShadow:"0 0 20px rgba(201,164,96,.6)",
                }}>
                  — Reloading —
                </div>
              )}

              {/* Bottom bar */}
              <div
                className="absolute bottom-0 left-0 right-0 flex items-center gap-3 px-3 pb-3 pt-5"
                style={{
                  background: "linear-gradient(to top,rgba(8,5,3,.96),transparent)",
                  pointerEvents: gamePhase === "playing" ? "none" : "auto",
                }}
              >
                <div style={{ fontFamily:"'Crimson Text',serif", fontSize:"clamp(11px,3vw,14px)", fontStyle:"italic", color:"#c9a460", textShadow:"0 0 12px rgba(201,164,96,.4)", flex:1, textAlign:"left" }}>
                  {gamePhase === "idle" && (cooldownSecondsLeft > 0 ? `Next play in ${Math.ceil(cooldownSecondsLeft / 60)} min` : "Step up to the line, friend.")}
                  {gamePhase === "playing" && isReloading && "Reloading…"}
                  {gamePhase === "playing" && !isReloading && ammoState === 0 && clipsRemainingState > 0 && "Empty — reloading…"}
                  {gamePhase === "playing" && !isReloading && ammoState === 0 && clipsRemainingState === 0 && "Out of ammo."}
                  {gamePhase === "done" && (() => {
                    if (cooldownSecondsLeft > 0) return `Next play in ${Math.ceil(cooldownSecondsLeft / 60)} min (1 round every 5 min)`;
                    const s = r.current.score;
                    return s >= 60 ? `${s} pts — you shoot like the devil himself.`
                      : s >= 30 ? `${s} pts — not bad, not bad at all.`
                      : `${s} pts — keep practising, friend.`;
                  })()}
                </div>
                <div className="flex-1 flex justify-center shrink-0">
                  {(gamePhase === "idle" || gamePhase === "done") && (
                    <button
                      type="button"
                      onClick={startRound}
                      disabled={cooldownSecondsLeft > 0}
                      className={`${styles.btnGoldDarkText} font-heading text-[10px] sm:text-[11px] font-bold uppercase tracking-wider px-4 py-2 cursor-pointer`}
                      style={cooldownSecondsLeft > 0 ? { opacity: 0.6, cursor: "not-allowed" } : {}}
                    >
                      {cooldownSecondsLeft > 0 ? `Wait ${Math.ceil(cooldownSecondsLeft / 60)} min` : (gamePhase === "done" ? "Play Again" : "Fire at Will")}
                    </button>
                  )}
                </div>
                <div className="flex-1" />
              </div>
            </>
          )}
        </div>
      )}

      {/* Scoring guide — theme panel */}
      {canPlay && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2 bg-primary/8 border-b border-primary/20">
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Scoring</h2>
          </div>
          <div className="p-2 flex flex-wrap gap-x-4 gap-y-1 items-center">
            {ZONES.map(z => (
              <div key={z.frac} className="flex items-center gap-1.5 text-[10px] font-heading text-mutedForeground">
                <div style={{ width:10, height:10, borderRadius:"50%", background:z.popColor, opacity:0.8, flexShrink:0 }} />
                <span className="text-foreground">{z.label}</span>
                <span className="text-primary">+{z.pts}</span>
              </div>
            ))}
            <span className="text-[10px] font-heading text-mutedForeground">· Targets vanish after {isTouchDevice ? TARGET_LIFETIME_TOUCH : TARGET_LIFETIME}s</span>
          </div>
          <div className="sr-art-line text-primary mx-3" />
        </div>
      )}

      {/* Leaderboard — top 10 */}
      {canPlay && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2 bg-primary/8 border-b border-primary/20">
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Top 10 — Shooting Range</h2>
          </div>
          <div className="p-3">
            {leaderboard.length === 0 ? (
              <p className="text-[11px] text-mutedForeground font-heading">No scores yet. Be the first.</p>
            ) : (
              <ul className="space-y-1">
                {leaderboard.map((e) => (
                  <li key={`${e.rank}-${e.username}-${e.score}`} className="flex items-center justify-between text-[11px] font-heading">
                    <span className="text-mutedForeground min-w-[20px]">#{e.rank}</span>
                    <span className="truncate flex-1 mx-2 text-foreground">{e.username}</span>
                    <span className="text-primary font-bold">{e.score}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="sr-art-line text-primary mx-3" />
        </div>
      )}

      {/* Animations */}
      <style>{`
        @keyframes scorePop {
          0%   { opacity:1; transform:translate(-50%,-40%); }
          80%  { opacity:.9; transform:translate(-50%,-66%); }
          100% { opacity:0; transform:translate(-50%,-78%); filter:blur(2px); }
        }
        @keyframes zoneFade {
          0%  { opacity:1; }
          70% { opacity:.9; }
          100%{ opacity:0; }
        }
        @keyframes urgentPulse {
          from { box-shadow: inset 0 0 30px rgba(220,60,40,.28); }
          to   { box-shadow: inset 0 0 55px rgba(220,60,40,.50); }
        }
      `}</style>
    </div>
  );
}
