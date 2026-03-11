import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import * as THREE from "three";
import { Crosshair } from "lucide-react";
import api from "../utils/api";
import { toast } from "sonner";
import styles from "../styles/noir.module.css";

const MAX_HITS_PER_SESSION = 30;
const BULLET_SPEED = 95;
const BULLET_MAX_DIST = 25;
const MUZZLE_FLASH_DURATION = 0.06;
const TARGET_RESPAWN = 0.8;

function buildRangeScene(scene) {
  const floorGeo = new THREE.PlaneGeometry(14, 10);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x353230 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -3);
  scene.add(floor);

  const wallGeo = new THREE.PlaneGeometry(14, 7);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x22201e });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.set(0, 1.5, -5.5);
  scene.add(wall);

  const targets = [];
  const targetSpecs = [
    { x: -3, y: 2.4, move: 0 },
    { x: -1, y: 2.5, move: 1 },
    { x: 1, y: 2.5, move: 1 },
    { x: 3, y: 2.4, move: 0 },
    { x: -2.5, y: 1.2, move: 2 },
    { x: 0, y: 1.4, move: 2 },
    { x: 2.5, y: 1.2, move: 2 },
    { x: -1.5, y: 0.2, move: 1 },
    { x: 1.5, y: 0.2, move: 1 },
  ];
  const targetRadius = 0.28;
  targetSpecs.forEach((spec, i) => {
    const group = new THREE.Group();
    group.position.set(spec.x, spec.y, -5.48);
    group.userData.baseX = spec.x;
    group.userData.baseY = spec.y;
    group.userData.moveType = spec.move;
    group.userData.respawnAt = 0;
    group.userData.index = i;
    const backGeo = new THREE.CylinderGeometry(targetRadius * 1.1, targetRadius * 1.1, 0.06, 24);
    const backMat = new THREE.MeshLambertMaterial({ color: 0x333230 });
    const back = new THREE.Mesh(backGeo, backMat);
    group.add(back);
    const faceGeo = new THREE.CircleGeometry(targetRadius, 24);
    const faceMat = new THREE.MeshLambertMaterial({ color: 0xc03030 });
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.rotation.x = -Math.PI / 2;
    face.position.z = 0.04;
    group.add(face);
    const innerGeo = new THREE.CircleGeometry(targetRadius * 0.35, 16);
    const innerMat = new THREE.MeshLambertMaterial({ color: 0xf0e0a0 });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.z = 0.045;
    group.add(inner);
    scene.add(group);
    targets.push(group);
  });

  return { targets, floor, wall };
}

function createBulletMesh() {
  const geo = new THREE.SphereGeometry(0.028, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xe8c040 });
  return new THREE.Mesh(geo, mat);
}

function createMuzzleFlash() {
  const geo = new THREE.SphereGeometry(0.12, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.95 });
  return new THREE.Mesh(geo, mat);
}

export default function ShootingRange3D() {
  const canvasRef = useRef(null);
  const refs = useRef({
    scene: null,
    camera: null,
    renderer: null,
    targets: [],
    bullets: [],
    raycaster: null,
    mouse: new THREE.Vector2(),
    muzzleFlash: null,
    muzzleFlashEnd: 0,
  });
  const hitCountRef = useRef(0);
  const { weaponId: routeWeaponId } = useParams();
  const navigate = useNavigate();

  const [masteryData, setMasteryData] = useState(null);
  const [weaponsList, setWeaponsList] = useState([]);
  const [weaponId, setWeaponId] = useState(routeWeaponId || "");
  const [hitCount, setHitCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);

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
    hitCountRef.current = hitCount;
  }, [hitCount]);

  const ownedGuns = masteryData?.weapons?.filter((w) => w.id !== "weapon1" && weaponsList.some((x) => x.id === w.id && x.owned)) || [];

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
    renderer.setClearColor(0x1a1a18);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a18);
    scene.fog = new THREE.FogExp2(0x121210, 0.04);

    const camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 60);
    camera.position.set(0, 1.35, 2.5);
    camera.lookAt(0, 1.15, -4);

    scene.add(new THREE.AmbientLight(0x6a6258, 1.4));
    const spot = new THREE.SpotLight(0xfff8e8, 5, 28, Math.PI / 5, 0.35);
    spot.position.set(0, 5, -2);
    spot.target.position.set(0, 0, -5);
    scene.add(spot);
    scene.add(spot.target);
    const fill = new THREE.PointLight(0x88aacc, 1.0, 22);
    fill.position.set(5, 2, 1);
    scene.add(fill);

    const { targets } = buildRangeScene(scene);
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const bulletGroup = new THREE.Group();
    scene.add(bulletGroup);
    const bullets = [];
    const muzzleFlash = createMuzzleFlash();
    muzzleFlash.visible = false;
    scene.add(muzzleFlash);
    const tempVec = new THREE.Vector3();
    const targetRadius = 0.28;

    refs.current = {
      scene,
      camera,
      renderer,
      targets,
      bullets,
      raycaster,
      mouse,
      muzzleFlash,
      muzzleFlashEnd: 0,
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
      if (!r.camera || !r.targets || hitCountRef.current >= MAX_HITS_PER_SESSION) return;
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, r.camera);
      const dir = raycaster.ray.direction.clone().normalize();
      const bulletMesh = createBulletMesh();
      bulletMesh.position.copy(r.camera.position).add(dir.clone().multiplyScalar(0.4));
      bulletGroup.add(bulletMesh);
      bullets.push({
        mesh: bulletMesh,
        velocity: dir.clone().multiplyScalar(BULLET_SPEED),
        dist: 0,
        maxDist: BULLET_MAX_DIST,
      });
      muzzleFlash.visible = true;
      muzzleFlash.position.copy(r.camera.position).add(dir.clone().multiplyScalar(0.45));
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

      r.targets.forEach((group) => {
        if (!group.visible && group.userData.respawnAt && t >= group.userData.respawnAt) {
          group.visible = true;
          group.userData.respawnAt = 0;
        }
        if (group.visible && group.userData.moveType) {
          const move = group.userData.moveType;
          const amp = move === 1 ? 0.35 : 0.25;
          const speed = move === 1 ? 1.2 : 0.9;
          if (move === 1) {
            group.position.x = group.userData.baseX + Math.sin(t * speed) * amp;
          } else {
            group.position.y = group.userData.baseY + Math.sin(t * speed) * amp;
          }
        }
      });

      for (let i = r.bullets.length - 1; i >= 0; i--) {
        const b = r.bullets[i];
        b.mesh.position.addScaledVector(b.velocity, dt);
        b.dist += BULLET_SPEED * dt;
        let remove = b.dist >= b.maxDist;
        if (!remove) {
          const bp = b.mesh.position;
          for (const tg of r.targets) {
            if (!tg.visible) continue;
            tg.getWorldPosition(tempVec);
            const dx = bp.x - tempVec.x;
            const dy = bp.y - tempVec.y;
            const dz = bp.z - tempVec.z;
            if (dx * dx + dy * dy + dz * dz < targetRadius * targetRadius * 1.8) {
              tg.visible = false;
              tg.userData.respawnAt = t + TARGET_RESPAWN;
              setHitCount((c) => Math.min(MAX_HITS_PER_SESSION, c + 1));
              remove = true;
              break;
            }
          }
        }
        if (remove) {
          bulletGroup.remove(b.mesh);
          b.mesh.geometry.dispose();
          b.mesh.material.dispose();
          r.bullets.splice(i, 1);
        }
      }

      if (r.muzzleFlash && t >= r.muzzleFlashEnd) {
        r.muzzleFlash.visible = false;
      }

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

  const endSession = async () => {
    if (hitCount < 1) {
      toast.info("Get at least 1 hit to submit.");
      return;
    }
    setSubmitting(true);
    try {
      const hitsToSend = Math.min(hitCount, MAX_HITS_PER_SESSION);
      const res = await api.post("/shooting-range/train", {
        weapon_id: weaponId,
        mode: "live",
        hits: hitsToSend,
      });
      toast.success(res.data?.message || `+${hitsToSend}% mastery from session.`);
      fetchMastery();
      setHitCount(0);
      navigate("/shooting-range");
    } catch (e) {
      const detail = e.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  };

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
        Shoot the red targets. Bullets travel in 3D; some targets move. More hits = more mastery when you end the session. Max {MAX_HITS_PER_SESSION} hits per session.
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
                <span className="text-zinc-300">Hits: <span className="tabular-nums text-primary font-bold">{hitCount}</span>{hitCount >= MAX_HITS_PER_SESSION ? " (max)" : ""}</span>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={endSession}
                  className="px-3 py-1.5 rounded border border-primary/50 bg-primary/20 text-primary font-bold hover:bg-primary/30 disabled:opacity-50"
                >
                  {submitting ? "Submitting…" : "End session"}
                </button>
              </div>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 mt-2">Click to shoot. Moving targets swing side-to-side or up-and-down.</p>
        </>
      )}
    </div>
  );
}
