import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import * as THREE from "three";
import { Crosshair } from "lucide-react";
import api from "../utils/api";
import { toast } from "sonner";
import styles from "../styles/noir.module.css";

const MAX_HITS_PER_SESSION = 30;

function buildRangeScene(scene) {
  const floorGeo = new THREE.PlaneGeometry(12, 8);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x2a2826 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.position.z = -2;
  scene.add(floor);

  const wallGeo = new THREE.PlaneGeometry(12, 6);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x1a1816 });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.set(0, 1.5, -5);
  scene.add(wall);

  const targets = [];
  const targetPositions = [
    [-2.5, 2.2], [-0.8, 2.4], [0.8, 2.4], [2.5, 2.2],
    [-2, 1], [0, 1.2], [2, 1],
    [-1, 0], [1, 0],
  ];
  targetPositions.forEach(([x, y], i) => {
    const geo = new THREE.CircleGeometry(0.25, 24);
    const mat = new THREE.MeshLambertMaterial({ color: 0xc03030 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, -4.98);
    mesh.userData.index = i;
    mesh.userData.respawnAt = 0;
    scene.add(mesh);
    targets.push(mesh);
  });

  return { targets, floor, wall };
}

export default function ShootingRange3D() {
  const canvasRef = useRef(null);
  const refs = useRef({ scene: null, camera: null, renderer: null, targets: [], raycaster: null, mouse: new THREE.Vector2() });
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
    const W = canvas.clientWidth || 640;
    const H = canvas.clientHeight || 400;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x141414);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141414);
    scene.fog = new THREE.FogExp2(0x0c0c0c, 0.06);

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 50);
    camera.position.set(0, 1.4, 2.2);
    camera.lookAt(0, 1.2, -3);

    scene.add(new THREE.AmbientLight(0x554d48, 1.2));
    const spot = new THREE.SpotLight(0xfff8e8, 4, 25, Math.PI / 6, 0.3);
    spot.position.set(0, 6, 0);
    spot.target.position.set(0, 0, -4);
    scene.add(spot);
    scene.add(spot.target);
    const fill = new THREE.PointLight(0x8899aa, 0.8, 20);
    fill.position.set(4, 2, 2);
    scene.add(fill);

    const { targets } = buildRangeScene(scene);
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    refs.current = { scene, camera, renderer, targets, raycaster, mouse };

    const onResize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
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
      const visibleTargets = r.targets.filter((m) => m.visible);
      const hits = raycaster.intersectObjects(visibleTargets);
      if (hits.length > 0) {
        const hit = hits[0].object;
        hit.visible = false;
        hit.userData.respawnAt = performance.now() / 1000 + 0.6;
        setHitCount((c) => Math.min(MAX_HITS_PER_SESSION, c + 1));
      }
    };
    canvas.addEventListener("pointerdown", onPointerDown);

    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const r = refs.current;
      if (!r.scene || !r.camera || !r.renderer) return;
      const t = performance.now() / 1000;
      r.targets.forEach((mesh) => {
        if (!mesh.visible && mesh.userData.respawnAt && t >= mesh.userData.respawnAt) {
          mesh.visible = true;
          mesh.userData.respawnAt = 0;
        }
      });
      renderer.render(r.scene, r.camera);
    };
    loop();
    setSceneReady(true);

    return () => {
      setSceneReady(false);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
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
        Click targets to hit them. More hits = more mastery when you end the session (faster than Train 5 min). Max {MAX_HITS_PER_SESSION} hits per session.
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
          <div className="relative rounded-lg overflow-hidden border border-zinc-700/50 bg-black" style={{ aspectRatio: "16/10", maxHeight: "60vh" }}>
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
          <p className="text-[10px] text-zinc-500 mt-2">Click the red targets. End session to convert hits into mastery.</p>
        </>
      )}
    </div>
  );
}
