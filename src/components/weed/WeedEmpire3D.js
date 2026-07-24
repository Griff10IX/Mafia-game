import { useEffect, useRef } from "react";
import * as THREE from "three";

const LIGHT_COLORS = {
  cfl: { color: 0xffe0a0, intensity: 0.55, fog: 0x2a2418 },
  led: { color: 0xb388ff, intensity: 1.1, fog: 0x1a1028 },
  hps: { color: 0xffaa33, intensity: 1.35, fog: 0x2a1808 },
  quantum: { color: 0xddeeff, intensity: 1.5, fog: 0x101820 },
};

const MESH_TINT = {
  dense: 0x2d6b2d,
  airy: 0x3d8b4a,
  frosty: 0x6bbf6b,
  purple: 0x5a3a6a,
};

/**
 * Three.js grow room + bud viewer with light glows, water/harvest FX hooks.
 */
export default function WeedEmpire3D({
  lightClass = "cfl",
  stage = "empty",
  progress = 0,
  budMeshKey = "dense",
  quality = 50,
  fx = null, // 'water' | 'feed' | 'harvest_trim' | null
  onFxDone,
}) {
  const mountRef = useRef(null);
  const stateRef = useRef({});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const w = mount.clientWidth || 480;
    const h = mount.clientHeight || 320;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0a08);
    scene.fog = new THREE.FogExp2(0x1a1210, 0.045);

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    camera.position.set(0, 1.35, 3.4);
    camera.lookAt(0, 0.7, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);

    // Room
    const roomMat = new THREE.MeshStandardMaterial({ color: 0x1c1814, roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), roomMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5), new THREE.MeshStandardMaterial({ color: 0x15120f }));
    back.position.set(0, 1.25, -1.4);
    scene.add(back);

    // Pot
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.22, 0.35, 16),
      new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.85 })
    );
    pot.position.set(0, 0.18, 0);
    scene.add(pot);

    // Soil disc
    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.06, 16),
      new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 1 })
    );
    soil.position.set(0, 0.36, 0);
    scene.add(soil);

    // Plant group
    const plant = new THREE.Group();
    plant.position.set(0, 0.4, 0);
    scene.add(plant);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a5a28 })
    );
    stem.position.y = 0.25;
    plant.add(stem);

    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d6b2d, roughness: 0.7, metalness: 0.05 });
    const budMat = new THREE.MeshStandardMaterial({
      color: MESH_TINT[budMeshKey] || MESH_TINT.dense,
      roughness: 0.45,
      metalness: 0.15,
      emissive: 0x102010,
      emissiveIntensity: 0.15,
    });

    const leaves = [];
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), leafMat.clone());
      leaf.scale.set(1.6, 0.35, 0.8);
      const a = (i / 6) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.18, 0.35 + (i % 3) * 0.08, Math.sin(a) * 0.18);
      plant.add(leaf);
      leaves.push(leaf);
    }

    const bud = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 14), budMat);
    bud.position.y = 0.62;
    bud.visible = false;
    plant.add(bud);

    // Trichome sparkles
    const sparkGeom = new THREE.BufferGeometry();
    const sparkCount = 40;
    const positions = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.28;
      positions[i * 3 + 1] = 0.55 + Math.random() * 0.25;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.28;
    }
    sparkGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const sparks = new THREE.Points(
      sparkGeom,
      new THREE.PointsMaterial({ color: 0xe8ffe8, size: 0.018, transparent: true, opacity: 0.7 })
    );
    sparks.visible = false;
    plant.add(sparks);

    // Lights + glow
    const amb = new THREE.AmbientLight(0x404040, 0.35);
    scene.add(amb);
    const growLight = new THREE.PointLight(0xb388ff, 1.2, 8, 2);
    growLight.position.set(0, 2.2, 0.2);
    scene.add(growLight);
    const glowSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xb388ff, transparent: true, opacity: 0.35 })
    );
    glowSphere.position.copy(growLight.position);
    scene.add(glowSphere);
    const rim = new THREE.PointLight(0xffffff, 0.25, 6);
    rim.position.set(1.5, 1.2, 2);
    scene.add(rim);

    // Water particle system (lazy)
    const dripGeom = new THREE.BufferGeometry();
    const dripN = 60;
    const dripPos = new Float32Array(dripN * 3);
    const dripVel = [];
    for (let i = 0; i < dripN; i++) {
      dripPos[i * 3] = 0;
      dripPos[i * 3 + 1] = -10;
      dripPos[i * 3 + 2] = 0;
      dripVel.push({ vx: 0, vy: 0, vz: 0, life: 0 });
    }
    dripGeom.setAttribute("position", new THREE.BufferAttribute(dripPos, 3));
    const drips = new THREE.Points(
      dripGeom,
      new THREE.PointsMaterial({ color: 0x66aaff, size: 0.035, transparent: true, opacity: 0.85 })
    );
    scene.add(drips);

    // Trim scraps
    const scrapGeom = new THREE.BufferGeometry();
    const scrapN = 30;
    const scrapPos = new Float32Array(scrapN * 3);
    const scrapVel = [];
    for (let i = 0; i < scrapN; i++) {
      scrapPos[i * 3 + 1] = -10;
      scrapVel.push({ vx: 0, vy: 0, vz: 0, life: 0 });
    }
    scrapGeom.setAttribute("position", new THREE.BufferAttribute(scrapPos, 3));
    const scraps = new THREE.Points(
      scrapGeom,
      new THREE.PointsMaterial({ color: 0x3d8b4a, size: 0.04 })
    );
    scene.add(scraps);

    const st = {
      scene,
      camera,
      renderer,
      plant,
      stem,
      leaves,
      bud,
      sparks,
      soil,
      growLight,
      glowSphere,
      dripPos,
      dripVel,
      dripGeom,
      dripsMat: drips.material,
      scrapPos,
      scrapVel,
      scrapGeom,
      fxUntil: 0,
      fxKind: null,
      t0: performance.now(),
      disposed: false,
    };
    stateRef.current = st;

    let raf = 0;
    const tick = (t) => {
      if (st.disposed) return;
      const elapsed = (t - st.t0) / 1000;
      plant.rotation.y = elapsed * 0.35;
      if (st.bud.visible) {
        st.bud.rotation.y = elapsed * 0.6;
        st.bud.scale.setScalar(1 + Math.sin(elapsed * 2) * 0.03);
      }
      // drips
      if (st.fxKind === "water" || st.fxKind === "feed") {
        const attr = st.dripGeom.attributes.position;
        for (let i = 0; i < dripN; i++) {
          const v = st.dripVel[i];
          if (v.life <= 0) continue;
          v.life -= 0.016;
          st.dripPos[i * 3] += v.vx;
          st.dripPos[i * 3 + 1] += v.vy;
          st.dripPos[i * 3 + 2] += v.vz;
          v.vy -= 0.012;
        }
        attr.needsUpdate = true;
        if (performance.now() > st.fxUntil) {
          st.fxKind = null;
          if (onFxDone) onFxDone();
        }
      }
      if (st.fxKind === "harvest_trim") {
        const attr = st.scrapGeom.attributes.position;
        for (let i = 0; i < scrapN; i++) {
          const v = st.scrapVel[i];
          if (v.life <= 0) continue;
          v.life -= 0.016;
          st.scrapPos[i * 3] += v.vx;
          st.scrapPos[i * 3 + 1] += v.vy;
          st.scrapPos[i * 3 + 2] += v.vz;
          v.vy -= 0.01;
        }
        attr.needsUpdate = true;
        st.bud.scale.setScalar(Math.max(0.2, 1 - (performance.now() - (st.fxUntil - 1400)) / 1400));
        if (performance.now() > st.fxUntil) {
          st.fxKind = null;
          if (onFxDone) onFxDone();
        }
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      if (!mount || st.disposed) return;
      const nw = mount.clientWidth || 480;
      const nh = mount.clientHeight || 320;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      st.disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update light glow / plant stage when props change
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.growLight) return;
    const cfg = LIGHT_COLORS[lightClass] || LIGHT_COLORS.cfl;
    st.growLight.color.setHex(cfg.color);
    st.growLight.intensity = cfg.intensity;
    st.glowSphere.material.color.setHex(cfg.color);
    st.glowSphere.material.opacity = 0.25 + cfg.intensity * 0.12;
    st.glowSphere.scale.setScalar(0.8 + cfg.intensity * 0.35);
    if (st.scene?.fog) st.scene.fog.color.setHex(cfg.fog);
  }, [lightClass]);

  useEffect(() => {
    const st = stateRef.current;
    if (!st?.plant) return;
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const empty = stage === "empty" || stage === "dead";
    st.plant.visible = !empty;
    if (empty) return;

    const scale = stage === "seedling" ? 0.35 + p * 0.2 : stage === "veg" ? 0.55 + p * 0.25 : 0.85 + p * 0.25;
    st.plant.scale.setScalar(scale);
    const showBud = stage === "flower" || stage === "harvest_ready";
    st.bud.visible = showBud;
    st.sparks.visible = showBud && quality >= 60;
    const tint = MESH_TINT[budMeshKey] || MESH_TINT.dense;
    st.bud.material.color.setHex(tint);
    st.bud.material.emissiveIntensity = 0.1 + (quality / 100) * 0.35;
    if (stage === "harvest_ready") st.bud.scale.setScalar(1.15);
    else st.bud.scale.setScalar(0.7 + p * 0.4);
  }, [stage, progress, budMeshKey, quality]);

  // Trigger FX
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !fx) return;
    st.fxKind = fx;
    st.fxUntil = performance.now() + (fx === "harvest_trim" ? 1400 : 900);
    if (fx === "water" || fx === "feed") {
      const color = fx === "feed" ? 0x88aa44 : 0x66aaff;
      if (st.dripsMat) st.dripsMat.color.setHex(color);
      for (let i = 0; i < st.dripVel.length; i++) {
        st.dripPos[i * 3] = (Math.random() - 0.5) * 0.3;
        st.dripPos[i * 3 + 1] = 1.6 + Math.random() * 0.4;
        st.dripPos[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
        st.dripVel[i] = {
          vx: (Math.random() - 0.5) * 0.01,
          vy: -0.04 - Math.random() * 0.03,
          vz: (Math.random() - 0.5) * 0.01,
          life: 0.6 + Math.random() * 0.5,
        };
      }
      st.dripGeom.attributes.position.needsUpdate = true;
      // wet soil
      st.soil.material.color.setHex(0x2a1810);
      setTimeout(() => {
        if (st.soil) st.soil.material.color.setHex(0x3a2818);
      }, 800);
    }
    if (fx === "harvest_trim") {
      for (let i = 0; i < st.scrapVel.length; i++) {
        st.scrapPos[i * 3] = (Math.random() - 0.5) * 0.2;
        st.scrapPos[i * 3 + 1] = 0.9;
        st.scrapPos[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
        st.scrapVel[i] = {
          vx: (Math.random() - 0.5) * 0.04,
          vy: 0.02 + Math.random() * 0.03,
          vz: (Math.random() - 0.5) * 0.04,
          life: 0.8 + Math.random() * 0.5,
        };
      }
      st.scrapGeom.attributes.position.needsUpdate = true;
    }
  }, [fx]);

  return (
    <div
      ref={mountRef}
      className="w-full h-[280px] md:h-[340px] rounded-lg overflow-hidden border border-emerald-900/40 bg-black"
      aria-label="Grow room 3D view"
    />
  );
}
