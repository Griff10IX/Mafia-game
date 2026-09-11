import { useEffect, useRef } from "react";
import * as THREE from "three";

function woodMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x6d4324,
    roughness: 0.78,
    metalness: 0.04,
  });
}

function steelMat(hex = 0x1c1f24, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color: hex,
    roughness: 0.32,
    metalness: 0.88,
    ...extra,
  });
}

/** Procedural Browning Automatic Rifle M1918A2 — barrel along +X, stock −X. */
export function buildBarM1918A2() {
  const gun = new THREE.Group();
  gun.name = "bar_m1918a2";
  const wood = woodMat();
  const blued = steelMat(0x15181c);
  const steel = steelMat(0x2a2e33);
  const magSteel = steelMat(0x22262b);
  const brass = steelMat(0xb08a4a, { metalness: 0.75, roughness: 0.38 });

  const add = (geom, mat, pos, rot = null, parent = gun) => {
    const m = new THREE.Mesh(geom, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    parent.add(m);
    return m;
  };

  // Buttstock
  add(new THREE.BoxGeometry(0.28, 0.105, 0.046), wood, [-0.52, -0.01, 0]);
  add(new THREE.BoxGeometry(0.09, 0.12, 0.05), wood, [-0.66, 0.0, 0]);
  add(new THREE.BoxGeometry(0.08, 0.07, 0.044), wood, [-0.38, -0.02, 0], [0, 0, -0.18]);
  add(new THREE.BoxGeometry(0.055, 0.012, 0.048), steel, [-0.695, 0.01, 0]); // butt plate

  // Receiver
  add(new THREE.BoxGeometry(0.28, 0.07, 0.05), blued, [-0.08, 0.03, 0]);
  add(new THREE.BoxGeometry(0.18, 0.045, 0.042), blued, [-0.02, 0.068, 0]);
  add(new THREE.BoxGeometry(0.04, 0.035, 0.038), steel, [-0.18, 0.055, 0.0]); // rear sight base
  add(new THREE.BoxGeometry(0.006, 0.028, 0.018), steel, [-0.18, 0.08, 0]);

  // Charging handle
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), steel, [-0.04, 0.055, 0.032], [Math.PI / 2, 0, 0]);
  add(new THREE.SphereGeometry(0.01, 8, 8), steel, [-0.04, 0.055, 0.058]);

  // Pistol-less BAR grip / trigger group
  add(new THREE.BoxGeometry(0.07, 0.09, 0.032), wood, [-0.22, -0.055, 0], [0, 0, 0.35]);
  add(new THREE.BoxGeometry(0.012, 0.028, 0.008), steel, [-0.16, -0.02, 0]); // trigger
  add(new THREE.TorusGeometry(0.022, 0.0035, 8, 16, Math.PI), steel, [-0.155, -0.038, 0], [Math.PI / 2, 0, Math.PI]);

  // Magazine
  add(new THREE.BoxGeometry(0.045, 0.16, 0.028), magSteel, [0.02, -0.07, 0], [0.12, 0, 0]);
  add(new THREE.BoxGeometry(0.042, 0.018, 0.026), magSteel, [0.02, -0.155, 0]);

  // Forend
  add(new THREE.BoxGeometry(0.22, 0.055, 0.048), wood, [0.18, -0.012, 0]);
  add(new THREE.BoxGeometry(0.08, 0.04, 0.044), wood, [0.30, 0.0, 0]);

  // Barrel (long)
  const barrel = add(new THREE.CylinderGeometry(0.011, 0.013, 0.62, 14), blued, [0.58, 0.028, 0], [0, 0, Math.PI / 2]);
  barrel.name = "barrel";
  add(new THREE.CylinderGeometry(0.016, 0.016, 0.04, 12), steel, [0.32, 0.028, 0], [0, 0, Math.PI / 2]); // barrel band
  add(new THREE.CylinderGeometry(0.018, 0.014, 0.06, 12), steel, [0.88, 0.028, 0], [0, 0, Math.PI / 2]); // flash hider / muzzle
  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(0.92, 0.028, 0);
  gun.add(muzzle);

  // Gas tube above barrel
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.38, 8), steel, [0.48, 0.052, 0], [0, 0, Math.PI / 2]);
  add(new THREE.BoxGeometry(0.04, 0.022, 0.022), steel, [0.68, 0.048, 0]);

  // Front sight
  add(new THREE.BoxGeometry(0.018, 0.032, 0.012), steel, [0.78, 0.055, 0]);
  add(new THREE.BoxGeometry(0.004, 0.02, 0.004), steel, [0.78, 0.072, 0]);

  // Carry handle
  add(new THREE.TorusGeometry(0.035, 0.004, 8, 16, Math.PI), steel, [0.12, 0.09, 0], [Math.PI / 2, 0, 0]);

  // Bipod (deployed)
  const bipod = new THREE.Group();
  const legGeo = new THREE.CylinderGeometry(0.005, 0.006, 0.22, 8);
  const legL = new THREE.Mesh(legGeo, steel);
  legL.position.set(0.34, -0.12, 0.06);
  legL.rotation.z = 0.35;
  legL.rotation.x = 0.45;
  bipod.add(legL);
  const legR = new THREE.Mesh(legGeo, steel);
  legR.position.set(0.34, -0.12, -0.06);
  legR.rotation.z = 0.35;
  legR.rotation.x = -0.45;
  bipod.add(legR);
  const footL = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), steel);
  footL.position.set(0.38, -0.22, 0.11);
  bipod.add(footL);
  const footR = footL.clone();
  footR.position.set(0.38, -0.22, -0.11);
  bipod.add(footR);
  gun.add(bipod);

  // Sling swivels
  add(new THREE.TorusGeometry(0.01, 0.0025, 6, 10), brass, [-0.48, -0.055, 0], [0, Math.PI / 2, 0]);
  add(new THREE.TorusGeometry(0.01, 0.0025, 6, 10), brass, [0.28, -0.04, 0], [0, Math.PI / 2, 0]);

  gun.userData.muzzle = muzzle;
  return gun;
}

function buildStudio() {
  const root = new THREE.Group();
  const tableWood = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.55, metalness: 0.08 });
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.58, 0.06, 48), tableWood);
  table.position.y = -0.26;
  table.receiveShadow = true;
  table.castShadow = true;
  root.add(table);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.42, 24), tableWood);
  pedestal.position.y = -0.5;
  pedestal.receiveShadow = true;
  root.add(pedestal);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.72;
  floor.receiveShadow = true;
  root.add(floor);

  const targetBoard = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 32),
    new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 }),
  );
  targetBoard.position.set(0.2, 0.35, -2.4);
  targetBoard.name = "target";
  root.add(targetBoard);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.16, 32),
    new THREE.MeshBasicMaterial({ color: 0xb42318, side: THREE.DoubleSide }),
  );
  ring.position.copy(targetBoard.position);
  ring.position.z += 0.01;
  root.add(ring);
  const bull = new THREE.Mesh(
    new THREE.CircleGeometry(0.04, 24),
    new THREE.MeshBasicMaterial({ color: 0x1a1208 }),
  );
  bull.position.copy(targetBoard.position);
  bull.position.z += 0.012;
  root.add(bull);

  root.userData.target = targetBoard;
  return root;
}

export default function BarM1918A2Viewer({ className = "", onShot = null }) {
  const wrapRef = useRef(null);
  const apiRef = useRef(null);
  const onShotRef = useRef(onShot);
  onShotRef.current = onShot;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0c10);
    scene.fog = new THREE.Fog(0x0b0c10, 4.5, 9);

    const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.05, 40);
    const orbit = { yaw: 0.85, pitch: 0.22, dist: 2.15 };
    const applyCam = () => {
      const cp = Math.cos(orbit.pitch);
      camera.position.set(
        Math.sin(orbit.yaw) * cp * orbit.dist,
        Math.sin(orbit.pitch) * orbit.dist + 0.12,
        Math.cos(orbit.yaw) * cp * orbit.dist,
      );
      camera.lookAt(0, 0.02, 0);
    };
    applyCam();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(renderer.domElement);

    const key = new THREE.SpotLight(0xfff2dd, 3.2, 12, 0.55, 0.35);
    key.position.set(2.2, 2.4, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0x6a7280, 0.35));
    const fill = new THREE.DirectionalLight(0x88a0c8, 0.55);
    fill.position.set(-2.4, 1.4, -1.2);
    scene.add(fill);
    const rim = new THREE.PointLight(0xffd9a0, 0.8, 6);
    rim.position.set(-0.4, 1.1, 1.4);
    scene.add(rim);

    const studio = buildStudio();
    scene.add(studio);
    const gun = buildBarM1918A2();
    gun.position.set(-0.06, 0.02, 0);
    gun.rotation.y = -0.12;
    scene.add(gun);

    const muzzleFlash = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.14, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    muzzleFlash.rotation.z = -Math.PI / 2;
    muzzleFlash.visible = false;
    gun.userData.muzzle.add(muzzleFlash);
    const muzzleLight = new THREE.PointLight(0xffaa44, 0, 2.2);
    gun.userData.muzzle.add(muzzleLight);

    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 });
    const tracerGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
    const tracer = new THREE.Line(tracerGeo, tracerMat);
    scene.add(tracer);

    const casings = [];
    const casingGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.018, 6);
    const casingMat = steelMat(0xc4a35a, { metalness: 0.7, roughness: 0.4 });

    const drag = { on: false, x: 0, y: 0, yaw: orbit.yaw, pitch: orbit.pitch };
    const recoil = { kick: 0, flashUntil: 0 };
    let raf = 0;
    let last = performance.now();

    const sizeToWrap = () => {
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    sizeToWrap();
    const ro = new ResizeObserver(sizeToWrap);
    ro.observe(wrap);

    const onDown = (e) => {
      drag.on = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.yaw = orbit.yaw;
      drag.pitch = orbit.pitch;
      wrap.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!drag.on) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      orbit.yaw = drag.yaw - dx * 0.008;
      orbit.pitch = Math.max(-0.35, Math.min(0.85, drag.pitch + dy * 0.006));
      applyCam();
    };
    const onUp = () => {
      drag.on = false;
    };
    const onWheel = (e) => {
      e.preventDefault();
      orbit.dist = Math.max(1.15, Math.min(3.6, orbit.dist + e.deltaY * 0.0022));
      applyCam();
    };

    const fire = () => {
      const now = performance.now();
      if (now < recoil.flashUntil - 40) return;
      recoil.kick = 0.085;
      recoil.flashUntil = now + 90;
      muzzleFlash.visible = true;
      muzzleLight.intensity = 5.5;
      gun.updateMatrixWorld(true);
      const muzzle = gun.userData.muzzle;
      const origin = new THREE.Vector3();
      muzzle.getWorldPosition(origin);
      const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(muzzle.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const hit = origin.clone().add(dir.multiplyScalar(3.4));
      tracerGeo.setFromPoints([origin, hit]);
      tracerMat.opacity = 0.85;
      const casing = new THREE.Mesh(casingGeo, casingMat);
      casing.position.copy(origin);
      casing.position.y -= 0.02;
      casing.userData.v = new THREE.Vector3(0.15 + Math.random() * 0.1, 0.9 + Math.random() * 0.3, 0.55 + Math.random() * 0.2);
      casings.push(casing);
      scene.add(casing);
      if (casings.length > 24) {
        const old = casings.shift();
        scene.remove(old);
      }
      onShotRef.current?.();
    };

    wrap.addEventListener("pointerdown", onDown);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onUp);
    wrap.addEventListener("pointercancel", onUp);
    wrap.addEventListener("wheel", onWheel, { passive: false });
    const onKey = (e) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        fire();
      }
    };
    window.addEventListener("keydown", onKey);

    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      recoil.kick *= Math.pow(0.08, dt * 8);
      gun.rotation.z = recoil.kick;
      gun.position.x = -0.06 - recoil.kick * 0.35;
      if (now > recoil.flashUntil) {
        muzzleFlash.visible = false;
        muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 40);
      }
      if (tracerMat.opacity > 0) tracerMat.opacity = Math.max(0, tracerMat.opacity - dt * 4.5);
      for (const c of casings) {
        c.userData.v.y -= 9.8 * dt;
        c.position.addScaledVector(c.userData.v, dt);
        c.rotation.x += dt * 8;
        c.rotation.z += dt * 5;
        if (c.position.y < -0.7) {
          c.position.y = -0.7;
          c.userData.v.multiplyScalar(0);
        }
      }
      applyCam();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    apiRef.current = { fire };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointercancel", onUp);
      wrap.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      renderer.dispose();
      if (renderer.domElement.parentNode === wrap) wrap.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m.dispose?.());
        }
      });
      apiRef.current = null;
    };
  }, []);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={wrapRef} className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none" />
      <button
        type="button"
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 rounded-md border border-amber-500/50 bg-black/70 text-[10px] font-heading font-bold uppercase tracking-widest text-amber-300 hover:bg-amber-500/20"
        onClick={() => apiRef.current?.fire()}
      >
        Fire
      </button>
      <div className="absolute top-2 left-2 right-2 pointer-events-none text-center text-[9px] font-heading text-mutedForeground">
        Drag to orbit · scroll to zoom · Fire / Space to shoot
      </div>
    </div>
  );
}
