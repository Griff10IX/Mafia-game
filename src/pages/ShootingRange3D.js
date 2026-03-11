import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import * as THREE from "three";
import { Crosshair } from "lucide-react";
import api from "../utils/api";
import { toast } from "sonner";
import styles from "../styles/noir.module.css";

const ROUND_DURATION_SEC = 60;
const MAX_HITS_FOR_MASTERY = 30;
const BULLET_SPEED = 120;
const BULLET_MAX_DIST = 35;
const MUZZLE_FLASH_DURATION = 0.06;
const TARGET_SPAWN_DELAY_MIN = 0.4;
const TARGET_SPAWN_DELAY_MAX = 1.4;
const RANGE_LENGTH = 28;
const BACK_WALL_Z = -RANGE_LENGTH;
const TARGET_RADIUS = 0.22;

function createTargetMesh() {
  const group = new THREE.Group();
  const backGeo = new THREE.CylinderGeometry(TARGET_RADIUS * 1.1, TARGET_RADIUS * 1.1, 0.05, 24);
  const backMat = new THREE.MeshLambertMaterial({ color: 0x4a4844 });
  const back = new THREE.Mesh(backGeo, backMat);
  group.add(back);
  const faceGeo = new THREE.CircleGeometry(TARGET_RADIUS, 24);
  const faceMat = new THREE.MeshBasicMaterial({ color: 0xe04040 });
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.rotation.x = -Math.PI / 2;
  face.position.z = 0.03;
  group.add(face);
  const innerGeo = new THREE.CircleGeometry(TARGET_RADIUS * 0.4, 16);
  const innerMat = new THREE.MeshBasicMaterial({ color: 0xffe070 });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.rotation.x = -Math.PI / 2;
  inner.position.z = 0.035;
  group.add(inner);
  return group;
}

function buildLongRangeScene(scene) {
  const floorLen = RANGE_LENGTH + 4;
  const floorGeo = new THREE.PlaneGeometry(5, floorLen);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x505048 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -floorLen / 2 - 2);
  scene.add(floor);

  const wallGeo = new THREE.PlaneGeometry(5, 4);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x404038 });
  const backWall = new THREE.Mesh(wallGeo, wallMat);
  backWall.position.set(0, 1.5, BACK_WALL_Z);
  scene.add(backWall);

  const target = createTargetMesh();
  target.visible = false;
  target.position.z = BACK_WALL_Z + 0.1;
  scene.add(target);

  return { target, floor, backWall };
}

function createBulletMesh() {
  const geo = new THREE.SphereGeometry(0.022, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xe8c040 });
  return new THREE.Mesh(geo, mat);
}

function createMuzzleFlash() {
  const geo = new THREE.SphereGeometry(0.1, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.95 });
  return new THREE.Mesh(geo, mat);
}

function randomTargetPosition() {
  return {
    x: -1.4 + Math.random() * 2.8,
    y: 0.6 + Math.random() * 1.6,
  };
}

export default function ShootingRange3D() {
  const canvasRef = useRef(null);
  const refs = useRef({
    scene: null,
    camera: null,
    renderer: null,
    target: null,
    bullets: [],
    raycaster: null,
    mouse: new THREE.Vector2(),
    muzzleFlash: null,
    muzzleFlashEnd: 0,
    nextSpawnAt: 0,
    roundEndAt: 0,
  });
  const scoreRef = useRef(0);
  const { weaponId: routeWeaponId } = useParams();
  const navigate = useNavigate();

  const [masteryData, setMasteryData] = useState(null);
  const [weaponsList, setWeaponsList] = useState([]);
  const [weaponId, setWeaponId] = useState(routeWeaponId || "");
  const [gamePhase, setGamePhase] = useState("idle");
  const [timeLeft, setTimeLeft] = useState(ROUND_DURATION_SEC);
  const [score, setScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const gamePhaseRef = useRef(gamePhase);
  useEffect(() => {
    gamePhaseRef.current = gamePhase;
  }, [gamePhase]);

  const fetchMastery = useCallback(async () => {
    try {
      const res = await api.get("/shooting-range/mastery");
      setMasteryData(res.data);
    } catch {
      setMasteryData(null);
    }
  }, []);

  useEffect(() => {
    fetchMastery();
  }, [fetchMastery]);

  useEffect(() => {
    let cancelled = false;
    api.get("/weapons").then((res) => {
      if (!cancelled && Array.isArray(res.data)) setWeaponsList(res.data);
    }).catch(() => { if (!cancelled) setWeaponsList([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (routeWeaponId && !weaponId) setWeaponId(routeWeaponId);
  }, [routeWeaponId, weaponId]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  const ownedGuns = masteryData?.weapons?.filter((w) => w.id !== "weapon1" && weaponsList.some((x) => x.id === w.id && x.owned)) || [];

  const startRound = useCallback(() => {
    setGamePhase("playing");
    gamePhaseRef.current = "playing";
    setTimeLeft(ROUND_DURATION_SEC);
    setScore(0);
    refs.current.nextSpawnAt = performance.now() / 1000;
    refs.current.roundEndAt = performance.now() / 1000 + ROUND_DURATION_SEC;
  }, []);

  useEffect(() => {
    if (!weaponId || !canvasRef.current || ownedGuns.every((w) => w.id !== weaponId)) return;
    const canvas = canvasRef.current;
    setSceneReady(false);
    const W = Math.max(320, canvas.clientWidth || 640);
    const H = Math.max(200, canvas.clientHeight || 400);
    const isMobile = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x383832);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x383832);
    scene.fog = new THREE.FogExp2(0x383832, 0.008);

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 80);
    camera.position.set(0, 1.35, 4);
    camera.lookAt(0, 1.2, -RANGE_LENGTH / 2);

    scene.add(new THREE.AmbientLight(0xb0a898, 2.2));
    const spot = new THREE.SpotLight(0xfffce8, 10, 50, Math.PI / 8, 0.3);
    spot.position.set(0, 8, 0);
    spot.target.position.set(0, 1, -15);
    scene.add(spot);
    scene.add(spot.target);
    const fill = new THREE.PointLight(0xaaccff, 2.0, 40);
    fill.position.set(0, 2, -10);
    scene.add(fill);

    const { target } = buildLongRangeScene(scene);
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const bulletGroup = new THREE.Group();
    scene.add(bulletGroup);
    const bullets = [];
    const muzzleFlash = createMuzzleFlash();
    muzzleFlash.visible = false;
    scene.add(muzzleFlash);
    const tempVec = new THREE.Vector3();

    refs.current = {
      scene,
      camera,
      renderer,
      target,
      bullets,
      raycaster,
      mouse,
      muzzleFlash,
      muzzleFlashEnd: 0,
      nextSpawnAt: 0,
      roundEndAt: 0,
    };

    const onResize = () => {
      const w = Math.max(320, canvas.clientWidth || 640);
      const h = Math.max(200, canvas.clientHeight || 400);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

      const onPointerDown = (e) => {
        const r = refs.current;
        if (!r.camera || r.target?.visible === false || gamePhaseRef.current !== "playing") return;
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, r.camera);
      const dir = raycaster.ray.direction.clone().normalize();
      const bulletMesh = createBulletMesh();
      bulletMesh.position.copy(r.camera.position).add(dir.clone().multiplyScalar(0.35));
      bulletGroup.add(bulletMesh);
      bullets.push({
        mesh: bulletMesh,
        velocity: dir.clone().multiplyScalar(BULLET_SPEED),
        dist: 0,
        maxDist: BULLET_MAX_DIST,
      });
      muzzleFlash.visible = true;
      muzzleFlash.position.copy(r.camera.position).add(dir.clone().multiplyScalar(0.4));
      refs.current.muzzleFlashEnd = performance.now() / 1000 + MUZZLE_FLASH_DURATION;
    };
    canvas.addEventListener("pointerdown", onPointerDown);

    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const r = refs.current;
      if (!r.scene || !r.camera || !r.renderer) return;
      const t = performance.now() / 1000;
      const dt = Math.min(1 / 30, 0.02);

      if (gamePhaseRef.current === "playing") {
        const remaining = Math.max(0, Math.ceil((r.roundEndAt - t)));
        setTimeLeft(remaining);
        if (t >= r.roundEndAt) {
          setGamePhase("done");
          gamePhaseRef.current = "done";
          const finalScore = scoreRef.current;
          const toSubmit = Math.min(finalScore, MAX_HITS_FOR_MASTERY);
          if (toSubmit > 0 && weaponId) {
            api.post("/shooting-range/train", { weapon_id: weaponId, mode: "live", hits: toSubmit })
              .then((res) => toast.success(res.data?.message || `Score: ${finalScore}. +${toSubmit}% mastery.`))
              .catch((e) => toast.error(e.response?.data?.detail || "Submit failed."));
          } else if (finalScore > 0) {
            toast.info(`Round over! Score: ${finalScore}`);
          }
          fetchMastery();
        }
      }

      if (r.target) {
        if (gamePhaseRef.current === "playing" && t >= r.nextSpawnAt) {
          const pos = randomTargetPosition();
          r.target.position.x = pos.x;
          r.target.position.y = pos.y;
          r.target.visible = true;
          r.nextSpawnAt = t + TARGET_SPAWN_DELAY_MIN + Math.random() * (TARGET_SPAWN_DELAY_MAX - TARGET_SPAWN_DELAY_MIN);
        }
        if (gamePhaseRef.current !== "playing") r.target.visible = false;
      }

      for (let i = r.bullets.length - 1; i >= 0; i--) {
        const b = r.bullets[i];
        b.mesh.position.addScaledVector(b.velocity, dt);
        b.dist += BULLET_SPEED * dt;
        let remove = b.dist >= b.maxDist;
        if (!remove && r.target?.visible) {
          r.target.getWorldPosition(tempVec);
          const bp = b.mesh.position;
          const dx = bp.x - tempVec.x;
          const dy = bp.y - tempVec.y;
          const dz = bp.z - tempVec.z;
          if (dx * dx + dy * dy + dz * dz < TARGET_RADIUS * TARGET_RADIUS * 2.2) {
            r.target.visible = false;
            setScore((c) => c + 1);
            r.nextSpawnAt = t + TARGET_SPAWN_DELAY_MIN + Math.random() * (TARGET_SPAWN_DELAY_MAX - TARGET_SPAWN_DELAY_MIN);
            remove = true;
          }
        }
        if (remove) {
          bulletGroup.remove(b.mesh);
          b.mesh.geometry.dispose();
          b.mesh.material.dispose();
          r.bullets.splice(i, 1);
        }
      }

      if (r.muzzleFlash && t >= r.muzzleFlashEnd) r.muzzleFlash.visible = false;

      renderer.render(r.scene, r.camera);
    };
    loop();
    setSceneReady(true);

    return () => {
      setSceneReady(false);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      bullets.forEach((b) => {
        bulletGroup.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
      });
      renderer.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
    };
  }, [weaponId]);

  const canPlay = ownedGuns.some((w) => w.id === weaponId);

  return (
    <div className={styles.pageContent} style={{ padding: "1rem", maxWidth: 900 }}>
      <div className="flex items-center gap-2 mb-3">
        <Link to="/shooting-range" className="text-[10px] font-heading uppercase tracking-wider" style={{ color: "var(--noir-primary)" }}>
          ← Shooting range
        </Link>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Crosshair size={22} style={{ color: "var(--noir-primary)" }} />
        <h1 className="text-lg font-heading font-bold uppercase tracking-wider" style={{ color: "var(--noir-primary)" }}>
          3D range
        </h1>
      </div>
      <p className="text-[11px] text-zinc-400 font-heading mb-3">
        One target at a time pops up down the range. Hit as many as you can in 60 seconds. Score = hits. Mastery (max +{MAX_HITS_FOR_MASTERY}%) is applied when the round ends.
      </p>

      {!weaponId || !canPlay ? (
        <div className="rounded-lg p-4 bg-zinc-800/50 border border-zinc-700/40">
          <label className="block text-[10px] font-heading uppercase text-zinc-500 mb-2">Weapon</label>
          <select
            value={weaponId}
            onChange={(e) => setWeaponId(e.target.value)}
            className="w-full max-w-xs rounded border border-zinc-600 bg-zinc-800/80 px-3 py-2 text-sm font-heading text-foreground"
          >
            <option value="">Select a gun you own</option>
            {ownedGuns.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          {ownedGuns.length === 0 && masteryData && (
            <p className="text-[11px] text-amber-500 mt-2">You need to own a gun to play the 3D range.</p>
          )}
        </div>
      ) : (
        <>
          <div
            className="relative rounded-lg overflow-hidden border border-zinc-700/50 bg-black"
            style={{ aspectRatio: "16/10", maxHeight: "60vh", minHeight: 320 }}
          >
            <canvas
              ref={canvasRef}
              style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
            />
            {sceneReady && (
              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 rounded bg-black/70 px-3 py-2 text-[11px] font-heading">
                <span className="text-zinc-300">
                  Score: <span className="tabular-nums text-primary font-bold">{score}</span>
                  {gamePhase === "playing" && (
                    <> · Time: <span className="tabular-nums font-bold">{timeLeft}s</span></>
                  )}
                </span>
                {gamePhase === "idle" && (
                  <button
                    type="button"
                    onClick={startRound}
                    className="px-3 py-1.5 rounded border border-primary/50 bg-primary/20 text-primary font-bold hover:bg-primary/30"
                  >
                    Start 60s round
                  </button>
                )}
                {gamePhase === "done" && (
                  <button
                    type="button"
                    onClick={startRound}
                    className="px-3 py-1.5 rounded border border-primary/50 bg-primary/20 text-primary font-bold hover:bg-primary/30"
                  >
                    Play again
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 mt-2">Click to shoot. Watch your bullets travel; hit the red target before the next one appears.</p>
        </>
      )}
    </div>
  );
}
