import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const GUN_BASE = new THREE.Vector3(-0.18, 0.08, 0);
const TARGET_CENTRE = new THREE.Vector3(4.2, 0.28, 0);
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
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: texture,
    bumpMap: texture,
    bumpScale: 0.012,
    roughness: 0.58,
    metalness: 0.04,
    clearcoat: 0.18,
    clearcoatRoughness: 0.72,
  });
}

function steelMat(hex = 0x1c1f24, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: hex,
    roughness: 0.29,
    metalness: 0.9,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
    ...extra,
  });
}

/** Procedural Browning Automatic Rifle M1918A2 — barrel along +X, stock −X. */
export function buildBarM1918A2() {
  const gun = new THREE.Group();
  gun.name = "bar_m1918a2";
  const wood = woodMat();
  const blued = steelMat(0x252b31, { roughness: 0.2 });
  const bluedEdge = steelMat(0x3d454d, { roughness: 0.25 });
  const steel = steelMat(0x555d65, { roughness: 0.26 });
  const black = steelMat(0x111519, { roughness: 0.38 });
  const magSteel = steelMat(0x30363c, { roughness: 0.34 });
  const brass = steelMat(0xa9813f, { metalness: 0.76, roughness: 0.36 });
  const leather = new THREE.MeshPhysicalMaterial({
    color: 0x4b2618,
    roughness: 0.94,
    metalness: 0,
    clearcoat: 0.05,
  });

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
  const extrudeSide = (shape, depth, material, bevel = 0.008, name = "") => {
    const mesh = add(
      new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelSegments: 4,
        bevelSize: bevel,
        bevelThickness: bevel,
        curveSegments: 18,
      }),
      material,
      [0, 0, -depth / 2],
    );
    mesh.name = name;
    return mesh;
  };

  // Sculpted walnut buttstock copied from the real M1918A2 side profile.
  const stockShape = new THREE.Shape();
  stockShape.moveTo(-1.08, -0.12);
  stockShape.bezierCurveTo(-1.07, -0.01, -1.04, 0.14, -0.97, 0.18);
  stockShape.bezierCurveTo(-0.86, 0.205, -0.70, 0.20, -0.58, 0.18);
  stockShape.lineTo(-0.46, 0.13);
  stockShape.lineTo(-0.40, 0.07);
  stockShape.lineTo(-0.43, -0.01);
  stockShape.bezierCurveTo(-0.55, -0.07, -0.71, -0.12, -0.90, -0.15);
  stockShape.bezierCurveTo(-0.99, -0.17, -1.05, -0.16, -1.08, -0.12);
  extrudeSide(stockShape, 0.13, wood, 0.014, "walnut_stock");
  const buttShape = new THREE.Shape();
  buttShape.moveTo(-1.095, -0.13);
  buttShape.bezierCurveTo(-1.12, -0.03, -1.11, 0.11, -1.075, 0.18);
  buttShape.lineTo(-1.04, 0.17);
  buttShape.lineTo(-1.045, -0.14);
  extrudeSide(buttShape, 0.142, black, 0.004, "butt_plate");
  add(rounded([0.20, 0.075, 0.105], 0.016, 6), wood, [-0.41, 0.065, 0], [0, 0, -0.12]);
  add(rounded([0.17, 0.025, 0.075], 0.005), blued, [-0.36, 0.145, 0]);

  // Forged receiver with the BAR's characteristic raised top and rear shoulder.
  const receiverShape = new THREE.Shape();
  receiverShape.moveTo(-0.44, -0.015);
  receiverShape.lineTo(-0.43, 0.15);
  receiverShape.lineTo(-0.31, 0.18);
  receiverShape.lineTo(-0.26, 0.235);
  receiverShape.lineTo(-0.08, 0.24);
  receiverShape.lineTo(-0.035, 0.205);
  receiverShape.lineTo(0.14, 0.195);
  receiverShape.lineTo(0.17, 0.13);
  receiverShape.lineTo(0.14, -0.025);
  receiverShape.lineTo(-0.13, -0.04);
  receiverShape.lineTo(-0.20, -0.005);
  receiverShape.closePath();
  extrudeSide(receiverShape, 0.15, blued, 0.01, "forged_receiver");
  add(rounded([0.33, 0.018, 0.158], 0.004), bluedEdge, [-0.04, 0.203, 0]);

  // Ejection port, bolt face and stamped side plate.
  add(rounded([0.12, 0.052, 0.004], 0.005), black, [-0.095, 0.145, 0.078]);
  add(rounded([0.06, 0.032, 0.005], 0.004), steel, [-0.07, 0.145, 0.081]);
  add(rounded([0.18, 0.085, 0.004], 0.006), bluedEdge, [0.045, 0.07, 0.078]);

  // Rear sight block and aperture.
  add(rounded([0.072, 0.045, 0.09], 0.006), steel, [-0.26, 0.235, 0]);
  add(new THREE.BoxGeometry(0.014, 0.07, 0.025), steel, [-0.26, 0.285, 0]);
  add(new THREE.TorusGeometry(0.017, 0.004, 10, 28), steel, [-0.26, 0.323, 0], [0, Math.PI / 2, 0]);

  // Charging handle and fire selector.
  add(new THREE.CylinderGeometry(0.009, 0.009, 0.085, 16), steel, [-0.18, 0.13, 0.095], [Math.PI / 2, 0, 0]);
  add(new THREE.CylinderGeometry(0.017, 0.017, 0.035, 18), black, [-0.18, 0.13, 0.145], [Math.PI / 2, 0, 0]);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.018, 16), steel, [-0.32, 0.075, 0.086], [Math.PI / 2, 0, 0]);
  add(new THREE.BoxGeometry(0.045, 0.009, 0.014), steel, [-0.30, 0.085, 0.096], [0, 0, 0.45]);

  // Trigger, guard and grip wrist.
  const guardCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.29, -0.015, 0),
    new THREE.Vector3(-0.25, -0.115, 0),
    new THREE.Vector3(-0.12, -0.12, 0),
    new THREE.Vector3(-0.08, -0.025, 0),
  ]);
  add(new THREE.TubeGeometry(guardCurve, 30, 0.008, 10, false), bluedEdge, [0, 0, 0.055]);
  add(new THREE.TubeGeometry(guardCurve, 30, 0.008, 10, false), bluedEdge, [0, 0, -0.055]);
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 10), steel, [-0.19, -0.045, 0], [0, 0, 0.30]);

  // Tapered twenty-round box magazine with pressed ribs.
  const magShape = new THREE.Shape();
  magShape.moveTo(-0.12, -0.025);
  magShape.lineTo(0.015, -0.025);
  magShape.lineTo(0.005, -0.36);
  magShape.lineTo(-0.105, -0.37);
  magShape.closePath();
  extrudeSide(magShape, 0.105, magSteel, 0.007, "box_magazine");
  for (let i = 0; i < 6; i += 1) {
    add(rounded([0.105, 0.008, 0.004], 0.002), bluedEdge, [-0.05, -0.09 - i * 0.045, 0.056]);
    add(rounded([0.105, 0.008, 0.004], 0.002), bluedEdge, [-0.05, -0.09 - i * 0.045, -0.056]);
  }

  // Full walnut fore-end, tapered toward the gas block.
  const foreShape = new THREE.Shape();
  foreShape.moveTo(0.13, 0.025);
  foreShape.lineTo(0.18, 0.155);
  foreShape.bezierCurveTo(0.34, 0.17, 0.55, 0.16, 0.70, 0.125);
  foreShape.lineTo(0.68, 0.025);
  foreShape.closePath();
  extrudeSide(foreShape, 0.145, wood, 0.014, "walnut_fore_end");
  for (let i = 0; i < 5; i += 1) {
    add(new THREE.BoxGeometry(0.008, 0.052, 0.151), black, [0.23 + i * 0.09, 0.044, 0]);
  }

  // Heavy barrel and lower gas system.
  const barrel = add(new THREE.CylinderGeometry(0.021, 0.026, 0.78, 36), blued, [1.04, 0.175, 0], [0, 0, Math.PI / 2]);
  barrel.name = "barrel";
  add(new THREE.CylinderGeometry(0.029, 0.029, 0.07, 32), steel, [0.69, 0.175, 0], [0, 0, Math.PI / 2]);
  add(new THREE.CylinderGeometry(0.031, 0.026, 0.13, 32), steel, [1.49, 0.175, 0], [0, 0, Math.PI / 2]);
  add(new THREE.CylinderGeometry(0.017, 0.019, 0.76, 28), bluedEdge, [1.03, 0.075, 0], [0, 0, Math.PI / 2]);
  add(new THREE.CylinderGeometry(0.034, 0.034, 0.17, 32), blued, [0.75, 0.075, 0], [0, 0, Math.PI / 2]);
  add(rounded([0.08, 0.12, 0.12], 0.012), bluedEdge, [1.35, 0.12, 0]);
  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(1.57, 0.175, 0);
  gun.add(muzzle);

  // Barrel cooling collars and front sight ears.
  for (let x = 0.76; x < 1.42; x += 0.055) {
    add(new THREE.TorusGeometry(0.025, 0.0022, 8, 28), bluedEdge, [x, 0.175, 0], [0, Math.PI / 2, 0]);
  }
  add(rounded([0.04, 0.10, 0.035], 0.006), steel, [1.37, 0.225, 0]);
  add(new THREE.BoxGeometry(0.008, 0.07, 0.012), steel, [1.37, 0.29, 0]);
  add(new THREE.TorusGeometry(0.025, 0.005, 10, 30), steel, [1.37, 0.32, 0], [0, Math.PI / 2, 0]);

  // Receiver pins.
  [-0.34, -0.22, -0.04, 0.08].forEach((x) => {
    add(new THREE.CylinderGeometry(0.011, 0.011, 0.158, 20), steel, [x, 0.08, 0], [Math.PI / 2, 0, 0]);
  });

  // M1918A2 carry handle: steel arm and turned walnut grip.
  add(rounded([0.035, 0.23, 0.035], 0.007), bluedEdge, [0.72, 0.26, 0], [0, 0, -0.15]);
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 32), wood, [0.70, 0.43, 0], [Math.PI / 2, 0, 0]);
  add(new THREE.CylinderGeometry(0.015, 0.015, 0.19, 20), steel, [0.70, 0.43, 0], [Math.PI / 2, 0, 0]);

  // M1918A2 bipod with hinge, telescoping legs and broad stamped feet.
  add(new THREE.CylinderGeometry(0.055, 0.055, 0.18, 32), bluedEdge, [1.35, 0.11, 0], [Math.PI / 2, 0, 0]);
  const legMaterial = steelMat(0x3b4249, { roughness: 0.34 });
  const legGeo = new THREE.CylinderGeometry(0.016, 0.021, 0.68, 18);
  const makeLeg = (zSign) => {
    const leg = add(legGeo, legMaterial, [1.20, -0.20, zSign * 0.25], [zSign * 0.43, 0, -0.34]);
    add(new THREE.CylinderGeometry(0.021, 0.021, 0.20, 18), black, [1.31, 0.055, zSign * 0.065], [zSign * 0.43, 0, -0.34]);
    const foot = add(rounded([0.18, 0.025, 0.075], 0.012, 6), legMaterial, [1.08, -0.52, zSign * 0.47], [0, zSign * 0.15, 0]);
    leg.name = `bipod_leg_${zSign > 0 ? "right" : "left"}`;
    foot.name = `bipod_foot_${zSign > 0 ? "right" : "left"}`;
  };
  makeLeg(1);
  makeLeg(-1);

  // Leather sling, swivels and brass fittings.
  add(new THREE.TorusGeometry(0.018, 0.004, 8, 18), brass, [-0.84, -0.12, 0], [0, Math.PI / 2, 0]);
  add(new THREE.TorusGeometry(0.018, 0.004, 8, 18), brass, [0.57, 0.015, 0], [0, Math.PI / 2, 0]);
  const slingCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.84, -0.12, -0.04),
    new THREE.Vector3(-0.52, -0.42, -0.08),
    new THREE.Vector3(0.16, -0.44, -0.09),
    new THREE.Vector3(0.57, 0.015, -0.04),
  ]);
  add(
    new THREE.TubeGeometry(slingCurve, 72, 0.011, 10, false),
    leather,
    [0, 0, 0],
  );

  gun.userData.muzzle = muzzle;
  return gun;
}

function buildStudio() {
  const root = new THREE.Group();
  const tableWood = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.55, metalness: 0.08 });
  const table = new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.42, 0.10, 72), tableWood);
  table.position.y = -0.57;
  table.receiveShadow = true;
  table.castShadow = true;
  root.add(table);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.58, 36), tableWood);
  pedestal.position.y = -0.9;
  pedestal.receiveShadow = true;
  root.add(pedestal);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.2;
  floor.receiveShadow = true;
  root.add(floor);

  const targetBoard = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 64),
    new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 }),
  );
  targetBoard.quaternion.copy(TARGET_ROTATION);
  targetBoard.position.copy(TARGET_CENTRE);
  targetBoard.name = "target";
  root.add(targetBoard);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.34, 64),
    new THREE.MeshBasicMaterial({ color: 0xb42318, side: THREE.DoubleSide }),
  );
  ring.quaternion.copy(TARGET_ROTATION);
  ring.position.copy(targetBoard.position);
  ring.position.addScaledVector(TARGET_NORMAL, 0.004);
  root.add(ring);
  const bull = new THREE.Mesh(
    new THREE.CircleGeometry(0.085, 40),
    new THREE.MeshBasicMaterial({ color: 0x1a1208 }),
  );
  bull.quaternion.copy(TARGET_ROTATION);
  bull.position.copy(targetBoard.position);
  bull.position.addScaledVector(TARGET_NORMAL, 0.006);
  root.add(bull);

  const targetPostMaterial = new THREE.MeshStandardMaterial({ color: 0x49301e, roughness: 0.88 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.1, 0.07), targetPostMaterial);
  post.position.set(TARGET_CENTRE.x, -0.30, TARGET_CENTRE.z);
  post.castShadow = true;
  root.add(post);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.045, 0.58), targetPostMaterial);
  base.position.set(TARGET_CENTRE.x, -0.86, TARGET_CENTRE.z);
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
    const orbit = { yaw: 0.06, pitch: 0.16, dist: 4.25 };
    const focus = new THREE.Vector3(0.12, 0.02, 0);
    const applyCam = () => {
      if (modeRef.current === "aim") {
        camera.position.set(-1.72, 0.38, 0.42);
        camera.lookAt(TARGET_CENTRE);
        return;
      }
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
    gun.scale.setScalar(1);
    scene.add(gun);

    const muzzleFlash = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.24, 14, 1, true),
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
    const casingGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.038, 10);
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
      orbit.dist = Math.max(2.0, Math.min(6.2, orbit.dist + e.deltaY * 0.003));
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
      const targetDistance = hit.distanceTo(targetCentre);
      if (targetDistance <= 0.62) {
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
      <div className="absolute z-10 top-2 left-2 right-2 pointer-events-none text-center text-[9px] font-heading text-mutedForeground">
        {mode === "inspect"
          ? "Original high-detail M1918A2 model · drag freely for full 360° inspection · scroll to zoom"
          : "Target is directly down-range · move to aim · click / Fire / Space to shoot"}
      </div>
    </div>
  );
}
