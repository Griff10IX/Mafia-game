import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const GUN_BASE = new THREE.Vector3(-0.34, 0.02, 0);
const TARGET_CENTRE = new THREE.Vector3(1.9, 0.32, -1.15);
const TARGET_NORMAL = GUN_BASE.clone().sub(TARGET_CENTRE).normalize();
const TARGET_ROTATION = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  TARGET_NORMAL,
);

function woodMat() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, "#8a5932");
  gradient.addColorStop(0.5, "#5d351d");
  gradient.addColorStop(1, "#7a4928");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 34; i += 1) {
    const y = (i / 34) * 64 + Math.sin(i * 1.7) * 2;
    ctx.strokeStyle = `rgba(35, 14, 5, ${0.08 + (i % 4) * 0.025})`;
    ctx.lineWidth = 0.7 + (i % 3) * 0.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(70, y + Math.sin(i) * 4, 170, y - Math.cos(i) * 3, 256, y + 1);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.2, 1);
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    roughness: 0.64,
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
  const blued = steelMat(0x303740, { roughness: 0.24 });
  const steel = steelMat(0x484f57, { roughness: 0.28 });
  const magSteel = steelMat(0x262c32, { roughness: 0.38 });
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
  const rounded = (size, radius = 0.012, segments = 4) =>
    new RoundedBoxGeometry(size[0], size[1], size[2], segments, radius);

  // Sculpted walnut buttstock
  const stockShape = new THREE.Shape();
  stockShape.moveTo(-0.72, -0.045);
  stockShape.bezierCurveTo(-0.69, 0.015, -0.68, 0.072, -0.62, 0.075);
  stockShape.lineTo(-0.43, 0.07);
  stockShape.bezierCurveTo(-0.37, 0.06, -0.34, 0.025, -0.35, -0.01);
  stockShape.lineTo(-0.42, -0.055);
  stockShape.bezierCurveTo(-0.52, -0.075, -0.63, -0.08, -0.72, -0.045);
  const stock = add(
    new THREE.ExtrudeGeometry(stockShape, {
      depth: 0.052,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.008,
      bevelThickness: 0.006,
      curveSegments: 12,
    }),
    wood,
    [0, 0, -0.026],
  );
  stock.name = "walnut_stock";
  add(rounded([0.055, 0.125, 0.058], 0.008), steel, [-0.71, -0.002, 0]); // butt plate
  add(rounded([0.17, 0.07, 0.052], 0.012), wood, [-0.30, 0.005, 0], [0, 0, -0.08]); // wrist
  add(rounded([0.12, 0.028, 0.038], 0.006), blued, [-0.285, 0.052, 0]); // receiver tang

  // Receiver
  add(rounded([0.31, 0.09, 0.066], 0.009), blued, [-0.07, 0.025, 0]);
  add(rounded([0.20, 0.047, 0.056], 0.008), blued, [-0.03, 0.088, 0]);
  add(rounded([0.05, 0.04, 0.05], 0.006), steel, [-0.19, 0.075, 0.0]); // rear sight base
  add(new THREE.BoxGeometry(0.006, 0.028, 0.018), steel, [-0.18, 0.08, 0]);

  // Charging handle
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), steel, [-0.04, 0.055, 0.032], [Math.PI / 2, 0, 0]);
  add(new THREE.SphereGeometry(0.01, 8, 8), steel, [-0.04, 0.055, 0.058]);

  // Pistol-less BAR grip / trigger group
  add(rounded([0.075, 0.10, 0.04], 0.009), wood, [-0.215, -0.058, 0], [0, 0, 0.28]);
  add(new THREE.BoxGeometry(0.012, 0.028, 0.008), steel, [-0.16, -0.02, 0]); // trigger
  add(new THREE.TorusGeometry(0.022, 0.0035, 8, 16, Math.PI), steel, [-0.155, -0.038, 0], [Math.PI / 2, 0, Math.PI]);

  // Magazine
  add(rounded([0.052, 0.17, 0.038], 0.006), magSteel, [0.02, -0.075, 0], [0.10, 0, 0]);
  add(rounded([0.05, 0.018, 0.039], 0.004), magSteel, [0.012, -0.163, 0]);
  for (let i = 0; i < 5; i += 1) {
    add(new THREE.BoxGeometry(0.047, 0.003, 0.031), steel, [0.02, -0.105 - i * 0.022, 0]);
  }

  // Forend
  add(rounded([0.25, 0.064, 0.058], 0.016, 6), wood, [0.19, -0.008, 0]);
  add(rounded([0.075, 0.05, 0.052], 0.012), wood, [0.34, 0.002, 0]);
  for (let i = 0; i < 6; i += 1) {
    add(new THREE.BoxGeometry(0.003, 0.026, 0.061), magSteel, [0.095 + i * 0.034, -0.032, 0]);
  }

  // Barrel (long)
  const barrel = add(new THREE.CylinderGeometry(0.012, 0.015, 0.62, 24), blued, [0.65, 0.028, 0], [0, 0, Math.PI / 2]);
  barrel.name = "barrel";
  add(new THREE.CylinderGeometry(0.016, 0.016, 0.04, 12), steel, [0.32, 0.028, 0], [0, 0, Math.PI / 2]); // barrel band
  add(new THREE.CylinderGeometry(0.018, 0.014, 0.075, 20), steel, [0.985, 0.028, 0], [0, 0, Math.PI / 2]); // flash hider / muzzle
  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(1.025, 0.028, 0);
  gun.add(muzzle);

  // Gas tube above barrel
  add(new THREE.CylinderGeometry(0.007, 0.007, 0.47, 16), steel, [0.59, 0.055, 0], [0, 0, Math.PI / 2]);
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.18, 18), blued, [0.52, 0.054, 0], [0, 0, Math.PI / 2]);
  add(rounded([0.05, 0.026, 0.03], 0.005), steel, [0.79, 0.05, 0]);
  for (let x = 0.43; x < 0.95; x += 0.035) {
    add(new THREE.TorusGeometry(0.015, 0.002, 6, 18), steel, [x, 0.028, 0], [0, Math.PI / 2, 0]);
  }

  // Front sight
  add(rounded([0.022, 0.038, 0.016], 0.004), steel, [0.91, 0.055, 0]);
  add(new THREE.BoxGeometry(0.004, 0.024, 0.004), steel, [0.91, 0.085, 0]);
  add(new THREE.TorusGeometry(0.014, 0.003, 8, 20), steel, [0.91, 0.092, 0], [0, Math.PI / 2, 0]);

  // Receiver pins, selector and ejection port
  [-0.16, -0.08, 0.01].forEach((x) => {
    add(new THREE.CylinderGeometry(0.007, 0.007, 0.056, 12), steel, [x, 0.03, 0], [Math.PI / 2, 0, 0]);
  });
  add(new THREE.BoxGeometry(0.082, 0.026, 0.003), steelMat(0x050607), [-0.03, 0.045, 0.027]);
  add(new THREE.BoxGeometry(0.055, 0.012, 0.004), steelMat(0xa0a6ac), [-0.035, 0.046, 0.030]);
  add(new THREE.CylinderGeometry(0.004, 0.004, 0.04, 8), steel, [-0.19, 0.025, 0.03], [Math.PI / 2, 0, 0]);

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
  const slingCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.53, -0.055, -0.02),
    new THREE.Vector3(-0.25, -0.24, -0.045),
    new THREE.Vector3(0.12, -0.25, -0.05),
    new THREE.Vector3(0.30, -0.045, -0.02),
  ]);
  add(
    new THREE.TubeGeometry(slingCurve, 36, 0.005, 7, false),
    new THREE.MeshStandardMaterial({ color: 0x352216, roughness: 1 }),
    [0, 0, 0],
  );

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
  targetBoard.quaternion.copy(TARGET_ROTATION);
  targetBoard.position.copy(TARGET_CENTRE);
  targetBoard.name = "target";
  root.add(targetBoard);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.16, 32),
    new THREE.MeshBasicMaterial({ color: 0xb42318, side: THREE.DoubleSide }),
  );
  ring.quaternion.copy(TARGET_ROTATION);
  ring.position.copy(targetBoard.position);
  ring.position.addScaledVector(TARGET_NORMAL, 0.004);
  root.add(ring);
  const bull = new THREE.Mesh(
    new THREE.CircleGeometry(0.04, 24),
    new THREE.MeshBasicMaterial({ color: 0x1a1208 }),
  );
  bull.quaternion.copy(TARGET_ROTATION);
  bull.position.copy(targetBoard.position);
  bull.position.addScaledVector(TARGET_NORMAL, 0.006);
  root.add(bull);

  const targetPostMaterial = new THREE.MeshStandardMaterial({ color: 0x49301e, roughness: 0.88 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.05), targetPostMaterial);
  post.position.set(TARGET_CENTRE.x, -0.16, TARGET_CENTRE.z);
  post.castShadow = true;
  root.add(post);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.45), targetPostMaterial);
  base.position.set(TARGET_CENTRE.x, -0.56, TARGET_CENTRE.z);
  base.castShadow = true;
  root.add(base);

  root.userData.target = targetBoard;
  return root;
}

export default function BarM1918A2Viewer({ className = "", onShot = null }) {
  const wrapRef = useRef(null);
  const crosshairRef = useRef(null);
  const apiRef = useRef(null);
  const modeRef = useRef("inspect");
  const [mode, setMode] = useState("inspect");
  const onShotRef = useRef(onShot);
  onShotRef.current = onShot;

  const chooseMode = (next) => {
    modeRef.current = next;
    setMode(next);
    apiRef.current?.setMode(next);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x17191d);
    scene.fog = new THREE.Fog(0x17191d, 6, 12);

    const camera = new THREE.PerspectiveCamera(40, 16 / 10, 0.05, 40);
    const orbit = { yaw: 0.06, pitch: 0.18, dist: 3.65 };
    const focus = new THREE.Vector3(0.45, 0.03, -0.24);
    const applyCam = () => {
      const cp = Math.cos(orbit.pitch);
      camera.position.set(
        focus.x + Math.sin(orbit.yaw) * cp * orbit.dist,
        focus.y + Math.sin(orbit.pitch) * orbit.dist,
        Math.cos(orbit.yaw) * cp * orbit.dist,
      );
      camera.lookAt(focus);
    };
    applyCam();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(renderer.domElement);

    const key = new THREE.SpotLight(0xfff2dd, 6.2, 12, 0.72, 0.32);
    key.position.set(0.8, 3.2, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xd6deee, 0x332012, 1.6));
    const fill = new THREE.DirectionalLight(0xaac4ee, 1.4);
    fill.position.set(-2.4, 1.4, -1.2);
    scene.add(fill);
    const rim = new THREE.PointLight(0xffd9a0, 2.2, 6);
    rim.position.set(-0.4, 1.1, 1.4);
    scene.add(rim);

    const studio = buildStudio();
    scene.add(studio);
    const gun = buildBarM1918A2();
    const gunBase = GUN_BASE.clone();
    gun.position.copy(gunBase);
    gun.scale.setScalar(1.22);
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

    const drag = { on: false, moved: false, x: 0, y: 0, yaw: orbit.yaw, pitch: orbit.pitch };
    const recoil = { kick: 0, flashUntil: 0 };
    const aim = { yaw: 0, pitch: 0, point: TARGET_CENTRE.clone() };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const targetPlane = new THREE.Plane(
      TARGET_NORMAL.clone(),
      -TARGET_NORMAL.dot(TARGET_CENTRE),
    );
    const targetCentre = TARGET_CENTRE.clone();
    const holes = [];
    let audioContext = null;
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

    const updateAim = (e) => {
      const rect = wrap.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(targetPlane, point)) return;
      aim.point.copy(point);
      const delta = point.clone().sub(gunBase);
      aim.yaw = Math.atan2(-delta.z, delta.x);
      aim.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
      if (crosshairRef.current) {
        crosshairRef.current.style.left = `${e.clientX - rect.left}px`;
        crosshairRef.current.style.top = `${e.clientY - rect.top}px`;
        crosshairRef.current.style.opacity = "1";
      }
    };
    const onDown = (e) => {
      const inspectMode = modeRef.current === "inspect";
      if (!inspectMode && e.button !== 2 && !e.shiftKey) {
        updateAim(e);
        return;
      }
      drag.on = true;
      drag.moved = false;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.yaw = orbit.yaw;
      drag.pitch = orbit.pitch;
      wrap.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!drag.on) {
        if (modeRef.current === "aim") updateAim(e);
        return;
      }
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      orbit.yaw = drag.yaw - dx * 0.008;
      orbit.pitch = Math.max(-0.35, Math.min(0.85, drag.pitch + dy * 0.006));
      applyCam();
    };
    const onUp = () => {
      drag.on = false;
    };
    const onClick = (e) => {
      if (modeRef.current === "aim" && e.button === 0 && !drag.moved) {
        updateAim(e);
        fire();
      }
      drag.moved = false;
    };
    const onContextMenu = (e) => e.preventDefault();
    const onWheel = (e) => {
      e.preventDefault();
      orbit.dist = Math.max(1.15, Math.min(3.6, orbit.dist + e.deltaY * 0.0022));
      applyCam();
    };

    const playGunshot = () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        audioContext = audioContext || new AudioCtx();
        const now = audioContext.currentTime;
        const duration = 0.32;
        const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i += 1) {
          const t = i / audioContext.sampleRate;
          const crack = Math.exp(-t * 32) * (Math.random() * 2 - 1);
          const tail = Math.exp(-t * 9) * (Math.random() * 2 - 1) * 0.34;
          samples[i] = crack + tail;
        }
        const noise = audioContext.createBufferSource();
        noise.buffer = buffer;
        const noiseFilter = audioContext.createBiquadFilter();
        noiseFilter.type = "bandpass";
        noiseFilter.frequency.setValueAtTime(1250, now);
        noiseFilter.Q.value = 0.65;
        const gain = audioContext.createGain();
        gain.gain.setValueAtTime(0.72, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        noise.connect(noiseFilter).connect(gain).connect(audioContext.destination);
        noise.start(now);

        const boom = audioContext.createOscillator();
        const boomGain = audioContext.createGain();
        boom.type = "triangle";
        boom.frequency.setValueAtTime(105, now);
        boom.frequency.exponentialRampToValueAtTime(42, now + 0.16);
        boomGain.gain.setValueAtTime(0.42, now);
        boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        boom.connect(boomGain).connect(audioContext.destination);
        boom.start(now);
        boom.stop(now + 0.23);
      } catch (_) {
        // Audio is cosmetic; firing must still work if browser audio is unavailable.
      }
    };

    const fire = () => {
      const now = performance.now();
      if (now < recoil.flashUntil - 40) return;
      recoil.kick = 0.085;
      playGunshot();
      recoil.flashUntil = now + 90;
      muzzleFlash.visible = true;
      muzzleLight.intensity = 5.5;
      gun.updateMatrixWorld(true);
      const muzzle = gun.userData.muzzle;
      const origin = new THREE.Vector3();
      muzzle.getWorldPosition(origin);
      const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(muzzle.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const shotRay = new THREE.Ray(origin, dir);
      const hit = new THREE.Vector3();
      if (!shotRay.intersectPlane(targetPlane, hit)) hit.copy(origin).add(dir.multiplyScalar(4));
      tracerGeo.setFromPoints([origin, hit]);
      tracerMat.opacity = 0.85;
      const targetDistance = Math.hypot(hit.y - targetCentre.y, hit.z - targetCentre.z);
      if (targetDistance <= 0.28) {
        const hole = new THREE.Mesh(
          new THREE.CircleGeometry(0.009 + Math.random() * 0.004, 10),
          new THREE.MeshBasicMaterial({ color: 0x090909, side: THREE.DoubleSide }),
        );
        hole.quaternion.copy(TARGET_ROTATION);
        hole.position.copy(hit).addScaledVector(TARGET_NORMAL, 0.009);
        scene.add(hole);
        holes.push(hole);
        if (holes.length > 40) {
          const old = holes.shift();
          scene.remove(old);
          old.geometry.dispose();
          old.material.dispose();
        }
      }
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
    wrap.addEventListener("click", onClick);
    wrap.addEventListener("contextmenu", onContextMenu);
    wrap.addEventListener("wheel", onWheel, { passive: false });
    const onKey = (e) => {
      if (modeRef.current === "aim" && (e.code === "Space" || e.key === " ")) {
        e.preventDefault();
        fire();
      }
    };
    window.addEventListener("keydown", onKey);

    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      recoil.kick *= Math.pow(0.08, dt * 8);
      gun.rotation.y += (aim.yaw - gun.rotation.y) * Math.min(1, dt * 12);
      gun.rotation.z += (aim.pitch + recoil.kick - gun.rotation.z) * Math.min(1, dt * 18);
      gun.position.copy(gunBase);
      gun.position.x -= recoil.kick * 0.35;
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
    apiRef.current = {
      fire,
      setMode: (next) => {
        drag.on = false;
        if (next === "inspect") {
          aim.yaw = 0;
          aim.pitch = 0;
          if (crosshairRef.current) crosshairRef.current.style.opacity = "0";
        } else {
          orbit.yaw = 0.06;
          orbit.pitch = 0.18;
          orbit.dist = 3.65;
          applyCam();
        }
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointercancel", onUp);
      wrap.removeEventListener("click", onClick);
      wrap.removeEventListener("contextmenu", onContextMenu);
      wrap.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      renderer.dispose();
      audioContext?.close?.();
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
      <div
        ref={wrapRef}
        className={`absolute inset-0 touch-none ${mode === "aim" ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
      />
      <div
        ref={crosshairRef}
        className="absolute z-10 pointer-events-none w-6 h-6 -translate-x-1/2 -translate-y-1/2 opacity-0"
        aria-hidden
      >
        <span className="absolute left-1/2 top-0 w-px h-2 bg-red-400/90" />
        <span className="absolute left-1/2 bottom-0 w-px h-2 bg-red-400/90" />
        <span className="absolute top-1/2 left-0 h-px w-2 bg-red-400/90" />
        <span className="absolute top-1/2 right-0 h-px w-2 bg-red-400/90" />
        <span className="absolute left-1/2 top-1/2 w-1 h-1 rounded-full bg-red-400 -translate-x-1/2 -translate-y-1/2" />
      </div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
        <button
          type="button"
          className={`px-3 py-1.5 rounded-md border text-[9px] font-heading font-bold uppercase tracking-wider ${
            mode === "inspect"
              ? "border-sky-400/70 bg-sky-500/25 text-sky-200"
              : "border-white/20 bg-black/65 text-zinc-300 hover:bg-white/10"
          }`}
          onClick={() => chooseMode("inspect")}
        >
          Inspect 360°
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 rounded-md border text-[9px] font-heading font-bold uppercase tracking-wider ${
            mode === "aim"
              ? "border-red-400/70 bg-red-500/25 text-red-100"
              : "border-white/20 bg-black/65 text-zinc-300 hover:bg-white/10"
          }`}
          onClick={() => chooseMode("aim")}
        >
          Aim &amp; Fire
        </button>
        {mode === "aim" ? (
          <button
            type="button"
            className="px-4 py-1.5 rounded-md border border-amber-500/60 bg-black/75 text-[9px] font-heading font-bold uppercase tracking-widest text-amber-300 hover:bg-amber-500/20"
            onClick={() => apiRef.current?.fire()}
          >
            Fire
          </button>
        ) : null}
      </div>
      <div className="absolute top-2 left-2 right-2 pointer-events-none text-center text-[9px] font-heading text-mutedForeground">
        {mode === "inspect"
          ? "Drag freely for full 360° inspection · scroll to zoom"
          : "Move to point at the target · click / Fire / Space to shoot · right-drag to orbit"}
      </div>
    </div>
  );
}
