import { useEffect, useRef } from "react";
import * as THREE from "three";

const LIGHT_COLORS = {
  cfl: { color: 0xffe8b0, intensity: 2.4, fog: 0x3a3228, spot: 1.6, amb: 0xb0a898 },
  led: { color: 0xe050ff, intensity: 4.0, fog: 0x2a1040, spot: 3.4, amb: 0xa040c8 },
  hps: { color: 0xffb84a, intensity: 4.0, fog: 0x3a2810, spot: 3.2, amb: 0xc8a060 },
  quantum: { color: 0xd080ff, intensity: 4.4, fog: 0x1a1838, spot: 3.8, amb: 0x8860d0 },
};

/** Bud phenotype looks — dense / airy / frosty / purple */
const BUD_PHENOTYPES = {
  dense: {
    body: 0x2d6b2d,
    emissive: 0x1a3a1a,
    emissiveIntensity: 0.45,
    pistil: 0xe09030,
    sugarLeaf: 0x245a28,
    colaScale: { x: 1.15, y: 1.05, z: 1.15 },
    sideBudScale: 0.85,
    sparkColor: 0xe8ffe0,
    sparkSize: 0.02,
    sparkOpacity: 0.7,
    scrapColor: 0x3d8b4a,
  },
  airy: {
    body: 0x6cb84a,
    emissive: 0x2a5020,
    emissiveIntensity: 0.4,
    pistil: 0xf0a848,
    sugarLeaf: 0x4a9838,
    colaScale: { x: 0.75, y: 1.45, z: 0.75 },
    sideBudScale: 1.05,
    sparkColor: 0xf0ffe8,
    sparkSize: 0.018,
    sparkOpacity: 0.55,
    scrapColor: 0x5aaa48,
  },
  frosty: {
    body: 0x9ecf9a,
    emissive: 0x608860,
    emissiveIntensity: 0.75,
    pistil: 0xffc060,
    sugarLeaf: 0x6a9a68,
    colaScale: { x: 1.0, y: 1.15, z: 1.0 },
    sideBudScale: 0.95,
    sparkColor: 0xffffff,
    sparkSize: 0.028,
    sparkOpacity: 0.95,
    scrapColor: 0x88bb88,
  },
  purple: {
    body: 0x6a3a78,
    emissive: 0x3a1848,
    emissiveIntensity: 0.55,
    pistil: 0xffa020,
    sugarLeaf: 0x3a2848,
    colaScale: { x: 1.05, y: 1.1, z: 1.05 },
    sideBudScale: 0.9,
    sparkColor: 0xe8d0ff,
    sparkSize: 0.022,
    sparkOpacity: 0.8,
    scrapColor: 0x6a4a78,
  },
};

function phenotype(key) {
  return BUD_PHENOTYPES[key] || BUD_PHENOTYPES.dense;
}

function lvl(equipment, id) {
  return Math.max(0, Number(equipment?.[id]) || 0);
}

function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  });
}

/**
 * Smooth palmate cannabis fan — separate teardrop blades (readable from camera).
 */
function makeFanLeaf(mat, fingers = 5, size = 1, strainType = "hybrid") {
  const leaf = new THREE.Group();
  leaf.userData.kind = "fan";
  const widthBias = strainType === "indica" ? 1.3 : strainType === "sativa" ? 0.72 : 1;
  const lenBias = strainType === "sativa" ? 1.28 : strainType === "indica" ? 0.88 : 1;
  const leafMat = mat.clone();
  leafMat.side = THREE.DoubleSide;
  leafMat.roughness = 0.52;
  const stemMat = mat.clone();
  stemMat.color = mat.color.clone().multiplyScalar(0.72);

  const petiole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01 * size, 0.013 * size, 0.11 * size, 6),
    stemMat
  );
  petiole.position.y = 0.055 * size;
  leaf.add(petiole);

  // Smooth teardrop blade (compact — pot-relative scale)
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, 0);
  bladeShape.quadraticCurveTo(0.055, 0.08, 0.045, 0.22);
  bladeShape.quadraticCurveTo(0.025, 0.36, 0, 0.48);
  bladeShape.quadraticCurveTo(-0.025, 0.36, -0.045, 0.22);
  bladeShape.quadraticCurveTo(-0.055, 0.08, 0, 0);
  const bladeGeom = new THREE.ShapeGeometry(bladeShape);

  const count = Math.max(3, Math.min(7, fingers | 0));
  const angleSets = {
    3: [-0.55, 0, 0.55],
    5: [-1.05, -0.52, 0, 0.52, 1.05],
    7: [-1.25, -0.85, -0.42, 0, 0.42, 0.85, 1.25],
  };
  const angles = angleSets[count] || angleSets[5];

  for (let i = 0; i < count; i++) {
    const ang = angles[i];
    const centerBoost = 1 - Math.abs(ang) * 0.2;
    const sx = 0.5 * size * widthBias * (0.75 + centerBoost * 0.25);
    const sy = 0.65 * size * lenBias * centerBoost;
    const finger = new THREE.Mesh(bladeGeom.clone(), leafMat.clone());
    finger.scale.set(sx, sy, 1);
    // Fan in Z; slight pitch so face reads toward camera when leaf group is oriented
    finger.rotation.z = ang;
    finger.rotation.x = -0.08;
    const reach = 0.04 * size;
    finger.position.set(Math.sin(ang) * reach, 0.1 * size, Math.cos(ang) * 0.005);
    leaf.add(finger);
  }
  return leaf;
}

function makeCotyledon(mat, size = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.038 * size, 10, 8), mat.clone());
  m.scale.set(1.55, 0.3, 1.15);
  return m;
}

/**
 * Watering can — spout along +X. Pour pose lifts left of pot and tips spout into soil.
 */
function makeWateringCan() {
  const can = new THREE.Group();
  can.name = "wateringCan";
  const plastic = new THREE.MeshStandardMaterial({
    color: 0x2a9ad0,
    roughness: 0.4,
    metalness: 0.05,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1a6088,
    roughness: 0.45,
    metalness: 0.08,
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.125, 0.22, 14), plastic);
  body.position.y = 0.12;
  can.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 8, 18), dark);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.23;
  can.add(rim);
  const hole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.02, 12),
    new THREE.MeshStandardMaterial({ color: 0x0a2030, roughness: 0.9 })
  );
  hole.position.y = 0.24;
  can.add(hole);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 8, 18, Math.PI), dark);
  handle.position.set(-0.02, 0.24, 0);
  handle.rotation.z = Math.PI / 2;
  handle.rotation.y = Math.PI / 2;
  can.add(handle);

  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.032, 0.26, 10), dark);
  spout.position.set(0.18, 0.16, 0);
  spout.rotation.z = -0.7;
  spout.name = "spout";
  can.add(spout);

  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.035, 12), plastic);
  rose.position.set(0.3, 0.24, 0);
  rose.rotation.z = -0.7;
  rose.name = "rose";
  can.add(rose);
  const tip = new THREE.Object3D();
  tip.name = "pourTip";
  tip.position.set(0.34, 0.28, 0);
  can.add(tip);

  can.scale.setScalar(1.35);
  // Idle: left of pot, spout aimed at pot rim (not floor)
  can.userData.idlePos = new THREE.Vector3(-0.5, 0, 0.22);
  can.userData.idleRotZ = 0.45;
  // Pour: lift + tip spout into soil
  can.userData.pourPos = new THREE.Vector3(-0.38, 0.55, 0.12);
  can.userData.pourRotZ = -0.4;
  can.position.copy(can.userData.idlePos);
  can.rotation.z = can.userData.idleRotZ;
  return can;
}

/** Distinct architecture per house tier */
function buildRoomShell(tier, mobileLod) {
  const g = new THREE.Group();
  g.name = "roomShell";
  const t = Math.max(0, Math.min(4, Number(tier) || 0));

  const presets = [
    {
      // Closet
      floor: 0x3a2e24,
      wall: 0x2a2218,
      fog: 0x2a241c,
      amb: 0.5,
      cam: [0.2, 1.35, 3.2],
      look: [0, 0.75, 0],
    },
    {
      // Basement
      floor: 0x4a4a48,
      wall: 0x3a3a38,
      fog: 0x2a2c30,
      amb: 0.45,
      cam: [0.25, 1.5, 3.7],
      look: [0, 0.85, 0],
    },
    {
      // Suburban
      floor: 0x4a3830,
      wall: 0xd8d0c4,
      fog: 0x3a342c,
      amb: 0.65,
      cam: [0.2, 1.55, 3.9],
      look: [0, 0.9, 0],
    },
    {
      // Warehouse
      floor: 0x555550,
      wall: 0x3a4048,
      fog: 0x1a2028,
      amb: 0.55,
      cam: [0.35, 1.85, 4.6],
      look: [0, 1.0, 0],
    },
    {
      // Compound
      floor: 0x3a3a3e,
      wall: 0x2a2e34,
      fog: 0x121820,
      amb: 0.7,
      cam: [0.4, 2.0, 5.0],
      look: [0, 1.05, 0],
    },
  ];
  const p = presets[t];
  const floorSize = t >= 3 ? 7 : t >= 1 ? 5.5 : 4.2;
  const wallH = t >= 3 ? 3.4 : 2.8;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize * 0.85),
    new THREE.MeshStandardMaterial({ color: p.floor, roughness: t >= 1 ? 0.95 : 0.85, metalness: t >= 3 ? 0.15 : 0.04 })
  );
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, wallH),
    new THREE.MeshStandardMaterial({ color: p.wall, roughness: 0.9 })
  );
  back.position.set(0, wallH / 2, -floorSize * 0.35);
  g.add(back);

  const left = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize * 0.85, wallH),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(p.wall).multiplyScalar(0.85), roughness: 0.92 })
  );
  left.position.set(-floorSize * 0.42, wallH / 2, 0);
  left.rotation.y = Math.PI / 2;
  g.add(left);

  if (t === 0) {
    // Closet: hanging clothes + wood shelf + towel
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 1.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.6 })
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.set(-1.3, 1.8, -0.4);
    g.add(rod);
    for (let i = 0; i < 4; i++) {
      const cloth = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.55 + (i % 2) * 0.15, 0.04),
        new THREE.MeshStandardMaterial({ color: [0x2a3040, 0x4a3020, 0x1a3a2a, 0x3a2a3a][i], roughness: 0.9 })
      );
      cloth.position.set(-1.5 + i * 0.28, 1.4, -0.4);
      g.add(cloth);
    }
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.04, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.8 })
    );
    shelf.position.set(1.2, 1.5, -0.9);
    g.add(shelf);
    const towel = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.02, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xc8b090, roughness: 0.95 })
    );
    towel.position.set(0, 0.02, 1.5);
    g.add(towel);
  } else if (t === 1) {
    // Basement: pipe + damp stain + laundry tub
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x6a7060, metalness: 0.5, roughness: 0.4 })
    );
    pipe.position.set(-1.8, 1.2, -1.2);
    g.add(pipe);
    const stain = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a3830, roughness: 1, transparent: true, opacity: 0.7 })
    );
    stain.rotation.x = -Math.PI / 2;
    stain.position.set(-0.8, 0.01, 0.6);
    g.add(stain);
    if (!mobileLod) {
      const tub = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.35, 0.35),
        new THREE.MeshStandardMaterial({ color: 0xc8c8c4, roughness: 0.4, metalness: 0.2 })
      );
      tub.position.set(1.6, 0.2, -1.0);
      g.add(tub);
    }
  } else if (t === 2) {
    // Suburban: window blackout + carpet strip
    const windowFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.7, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 })
    );
    windowFrame.position.set(1.4, 1.6, -1.7);
    g.add(windowFrame);
    const blackout = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95 })
    );
    blackout.position.set(1.4, 1.6, -1.66);
    g.add(blackout);
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x4a3038, roughness: 0.95 })
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.005, 0.8);
    g.add(carpet);
  } else if (t === 3) {
    // Warehouse: pallet + metal rack
    if (!mobileLod) {
      const pallet = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.12, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.85 })
      );
      pallet.position.set(2.0, 0.08, -1.2);
      g.add(pallet);
      for (let s = 0; s < 3; s++) {
        const rack = new THREE.Mesh(
          new THREE.BoxGeometry(1.2, 0.04, 0.4),
          new THREE.MeshStandardMaterial({ color: 0x555560, metalness: 0.6, roughness: 0.4 })
        );
        rack.position.set(-2.2, 0.4 + s * 0.45, -1.4);
        g.add(rack);
      }
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(5, 0.12, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x444450, metalness: 0.7 })
    );
    beam.position.set(0, 3.0, -0.5);
    g.add(beam);
  } else {
    // Compound: cage frame + work light
    const cageMat = new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.7, roughness: 0.35 });
    for (const [x, z] of [
      [-2.4, -1.6],
      [2.4, -1.6],
      [-2.4, 1.4],
      [2.4, 1.4],
    ]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 8), cageMat);
      post.position.set(x, 1.4, z);
      g.add(post);
    }
    if (!mobileLod) {
      const work = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.08, 0.2),
        new THREE.MeshStandardMaterial({
          color: 0xfff8e0,
          emissive: 0xffe8a0,
          emissiveIntensity: 1.2,
        })
      );
      work.position.set(-2.0, 2.4, 0);
      g.add(work);
      const workLight = new THREE.PointLight(0xfff0d0, 0.8, 6);
      workLight.position.set(-2.0, 2.2, 0);
      g.add(workLight);
    }
  }

  g.userData.preset = p;
  return g;
}

/**
 * Gear-driven grow room with house shells, care FX, and bud phenotypes.
 */
export default function WeedEmpire3D({
  lightClass = "cfl",
  stage = "empty",
  progress = 0,
  budMeshKey = "dense",
  strainType = "hybrid",
  quality = 50,
  equipment = {},
  houseTier = 0,
  houseId = "closet",
  autoWater = false,
  autoFeed = false,
  curingCount = 0,
  fx = null,
  fxNonce = 0,
  onFxDone,
}) {
  const mountRef = useRef(null);
  const stateRef = useRef({});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const w = mount.clientWidth || 480;
    const h = mount.clientHeight || 320;
    const mobileLod = w < 420;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14110e);
    scene.fog = new THREE.FogExp2(0x2a241c, 0.02);

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    camera.position.set(0.2, 1.4, 3.4);
    camera.lookAt(0, 0.8, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobileLod ? 1.5 : 2));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.28;
    mount.appendChild(renderer.domElement);

    const roomRoot = new THREE.Group();
    scene.add(roomRoot);
    let roomShell = buildRoomShell(0, mobileLod);
    roomRoot.add(roomShell);

    // Tent — open front
    const tent = new THREE.Group();
    tent.visible = false;
    scene.add(tent);
    const tentOuterMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1c,
      roughness: 0.75,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    const tentMylarMat = new THREE.MeshStandardMaterial({
      color: 0xc8c4b8,
      roughness: 0.35,
      metalness: 0.55,
      side: THREE.DoubleSide,
    });
    const TW = 2.1;
    const TH = 2.15;
    const TD = 1.7;
    const ty = 1.08;
    const thick = 0.04;
    const addPanel = (pw, ph, pd, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), mat);
      m.position.set(x, y, z);
      tent.add(m);
      return m;
    };
    addPanel(TW, thick, TD, 0, ty - TH / 2, 0, tentOuterMat);
    addPanel(TW, thick, TD, 0, ty + TH / 2, 0, tentOuterMat);
    addPanel(TW, TH, thick, 0, ty, -TD / 2, tentOuterMat);
    addPanel(thick, TH, TD, -TW / 2, ty, 0, tentOuterMat);
    addPanel(thick, TH, TD, TW / 2, ty, 0, tentOuterMat);
    addPanel(TW - 0.08, thick * 0.5, TD - 0.08, 0, ty - TH / 2 + 0.03, 0, tentMylarMat);
    addPanel(TW - 0.08, thick * 0.5, TD - 0.08, 0, ty + TH / 2 - 0.03, 0, tentMylarMat);
    addPanel(TW - 0.1, TH - 0.1, thick * 0.5, 0, ty, -TD / 2 + 0.03, tentMylarMat);
    addPanel(thick * 0.5, TH - 0.1, TD - 0.1, -TW / 2 + 0.03, ty, 0, tentMylarMat);
    addPanel(thick * 0.5, TH - 0.1, TD - 0.1, TW / 2 - 0.03, ty, 0, tentMylarMat);
    const flapMat = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.7, side: THREE.DoubleSide });
    const leftFlap = new THREE.Mesh(new THREE.BoxGeometry(0.18, TH - 0.15, 0.05), flapMat);
    leftFlap.position.set(-TW / 2 + 0.12, ty, TD / 2 - 0.02);
    leftFlap.rotation.y = 0.35;
    tent.add(leftFlap);
    const rightFlap = new THREE.Mesh(new THREE.BoxGeometry(0.18, TH - 0.15, 0.05), flapMat);
    rightFlap.position.set(TW / 2 - 0.12, ty, TD / 2 - 0.02);
    rightFlap.rotation.y = -0.35;
    tent.add(rightFlap);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x555560, metalness: 0.7, roughness: 0.35 });
    for (const [x, z] of [
      [-TW / 2 + 0.08, -TD / 2 + 0.08],
      [TW / 2 - 0.08, -TD / 2 + 0.08],
      [-TW / 2 + 0.08, TD / 2 - 0.08],
      [TW / 2 - 0.08, TD / 2 - 0.08],
    ]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, TH, 8), poleMat);
      pole.position.set(x, ty, z);
      tent.add(pole);
    }

    // Lights
    const fixture = new THREE.Group();
    fixture.position.set(0, 1.88, 0);
    scene.add(fixture);
    const hangWire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.25, 6),
      new THREE.MeshStandardMaterial({ color: 0x444448 })
    );
    hangWire.position.y = 0.15;
    fixture.add(hangWire);
    const fixtureBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.08, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.4, roughness: 0.45 })
    );
    fixture.add(fixtureBody);
    const emitterMat = new THREE.MeshStandardMaterial({
      color: 0xffe8b0,
      emissive: 0xffe8b0,
      emissiveIntensity: 1.4,
      roughness: 0.3,
    });
    const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.03, 0.28), emitterMat);
    emitter.position.y = -0.05;
    fixture.add(emitter);
    const diodes = new THREE.Group();
    diodes.visible = false;
    for (let i = 0; i < 18; i++) {
      const d = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 6, 6),
        new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xff66cc : 0x88aaff })
      );
      d.position.set(((i % 6) - 2.5) * 0.07, -0.06, (Math.floor(i / 6) - 1) * 0.08);
      diodes.add(d);
    }
    fixture.add(diodes);
    const cflGroup = new THREE.Group();
    for (const ox of [-0.14, 0.14]) {
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 10, 10),
        new THREE.MeshStandardMaterial({
          color: 0xfff0c8,
          emissive: 0xffe8b0,
          emissiveIntensity: 1.2,
          roughness: 0.2,
        })
      );
      bulb.position.set(ox, -0.1, 0);
      cflGroup.add(bulb);
    }
    fixture.add(cflGroup);
    const hpsHood = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.22, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide })
    );
    hpsHood.position.y = -0.02;
    hpsHood.visible = false;
    fixture.add(hpsHood);
    const hpsBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffb84a,
        emissive: 0xff9020,
        emissiveIntensity: 1.6,
        roughness: 0.25,
      })
    );
    hpsBulb.position.y = -0.14;
    hpsBulb.visible = false;
    fixture.add(hpsBulb);

    const amb = new THREE.AmbientLight(0xb0a898, 0.55);
    scene.add(amb);
    const hemi = new THREE.HemisphereLight(0xfff2d6, 0x2a3020, 0.65);
    scene.add(hemi);
    const canopySpot = new THREE.SpotLight(0xffe8b0, 1.8, 8, Math.PI / 4.5, 0.45, 1.2);
    canopySpot.position.set(0, 2.05, 0.1);
    canopySpot.target.position.set(0, 0.55, 0);
    scene.add(canopySpot);
    scene.add(canopySpot.target);
    const growFill = new THREE.PointLight(0xfff8e8, 0.9, 7, 1.5);
    growFill.position.set(0.35, 1.5, 1.0);
    scene.add(growFill);
    const glowSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xffe8b0, transparent: true, opacity: 0.4 })
    );
    glowSphere.position.copy(fixture.position);
    scene.add(glowSphere);

    const potGroup = new THREE.Group();
    scene.add(potGroup);
    const potMat = new THREE.MeshStandardMaterial({ color: 0x6a4830, roughness: 0.7, metalness: 0.05 });
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.35, 16), potMat);
    pot.position.y = 0.18;
    potGroup.add(pot);
    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.06, 16),
      new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.95 })
    );
    soil.position.y = 0.36;
    potGroup.add(soil);

    // Splash ring on soil
    const splash = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.22, 16),
      new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    splash.rotation.x = -Math.PI / 2;
    splash.position.y = 0.4;
    potGroup.add(splash);

    // ——— Plant ———
    const plant = new THREE.Group();
    plant.position.set(0, 0.38, 0);
    scene.add(plant);

    const stemMat = new THREE.MeshStandardMaterial({
      color: 0x4a7a3a,
      roughness: 0.7,
      emissive: 0x142814,
      emissiveIntensity: 0.2,
    });
    const seedlingLeafMat = new THREE.MeshStandardMaterial({
      color: 0x8fd46a,
      roughness: 0.55,
      side: THREE.DoubleSide,
      emissive: 0x2a4a1a,
      emissiveIntensity: 0.25,
    });
    const vegLeafMat = new THREE.MeshStandardMaterial({
      color: 0x3d9a3d,
      roughness: 0.5,
      side: THREE.DoubleSide,
      emissive: 0x1a3a1a,
      emissiveIntensity: 0.3,
    });
    const darkLeafMat = new THREE.MeshStandardMaterial({
      color: 0x2d7a32,
      roughness: 0.48,
      side: THREE.DoubleSide,
      emissive: 0x143014,
      emissiveIntensity: 0.28,
    });

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.022, 0.7, 8), stemMat);
    stem.position.y = 0.35;
    plant.add(stem);

    const seedlingGroup = new THREE.Group();
    const cotL = makeCotyledon(seedlingLeafMat, 0.5);
    cotL.position.set(-0.04, 0.1, 0.04);
    cotL.rotation.z = 0.35;
    seedlingGroup.add(cotL);
    const cotR = makeCotyledon(seedlingLeafMat, 0.5);
    cotR.position.set(0.04, 0.1, 0.04);
    cotR.rotation.z = -0.35;
    seedlingGroup.add(cotR);
    // Clear small cannabis fans (readable, pot-sized)
    const firstTrueL = makeFanLeaf(seedlingLeafMat, 5, 0.55, "hybrid");
    firstTrueL.position.set(-0.05, 0.16, 0.06);
    firstTrueL.rotation.set(-0.45, 0.6, 0);
    seedlingGroup.add(firstTrueL);
    const firstTrueR = makeFanLeaf(seedlingLeafMat, 5, 0.55, "hybrid");
    firstTrueR.position.set(0.05, 0.18, 0.04);
    firstTrueR.rotation.set(-0.4, -0.6, 0);
    seedlingGroup.add(firstTrueR);
    const firstTrueTop = makeFanLeaf(seedlingLeafMat, 5, 0.48, "hybrid");
    firstTrueTop.position.set(0, 0.26, 0.05);
    firstTrueTop.rotation.set(-0.5, 0.15, 0);
    seedlingGroup.add(firstTrueTop);
    plant.add(seedlingGroup);

    const fanLeaves = [];
    // Whorls unlock early so mid-grow isn't a bare stick
    const leafNodes = [
      { y: 0.22, fingers: 5, size: 0.5, minP: 0.05 },
      { y: 0.32, fingers: 5, size: 0.58, minP: 0.12 },
      { y: 0.42, fingers: 7, size: 0.62, minP: 0.22 },
      { y: 0.52, fingers: 7, size: 0.66, minP: 0.32 },
      { y: 0.62, fingers: 7, size: 0.68, minP: 0.42 },
      { y: 0.7, fingers: 7, size: 0.64, minP: 0.52 },
      { y: 0.4, fingers: 5, size: 0.55, minP: 0.28, branch: true },
      { y: 0.56, fingers: 5, size: 0.58, minP: 0.4, branch: true },
    ];
    leafNodes.forEach((node, idx) => {
      const mat = node.fingers >= 7 ? darkLeafMat : vegLeafMat;
      const pair = new THREE.Group();
      pair.userData.minP = node.minP;
      if (node.branch) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.22, 5), stemMat.clone());
        br.rotation.z = idx % 2 === 0 ? 0.85 : -0.85;
        br.position.set(idx % 2 === 0 ? 0.09 : -0.09, node.y - 0.04, 0.02);
        pair.add(br);
      }
      const sides = node.branch ? 1 : 2;
      for (let s = 0; s < sides; s++) {
        const leaf = makeFanLeaf(mat, node.fingers, node.size, "hybrid");
        leaf.userData.baseFingers = node.fingers;
        leaf.userData.baseSize = node.size;
        // Face mostly toward camera (+Z) with slight yaw around stem
        const yaw = node.branch
          ? idx % 2 === 0
            ? 0.7
            : -0.7
          : (s === 0 ? 1 : -1) * (0.55 + (idx % 3) * 0.2);
        const reach = node.branch ? 0.2 : 0.12;
        leaf.position.set(Math.sin(yaw) * reach, node.y, 0.04 + Math.cos(yaw) * reach * 0.35);
        leaf.rotation.set(-0.4 - (idx % 2) * 0.08, yaw, 0);
        pair.add(leaf);
        fanLeaves.push(leaf);
      }
      pair.visible = false;
      plant.add(pair);
    });
    const leafPairs = plant.children.filter((c) => c.userData && c.userData.minP != null);

    const buds = new THREE.Group();
    buds.visible = false;
    plant.add(buds);
    const budMeshes = [];
    const budSpecs = [
      { y: 0.88, x: 0, z: 0, s: 1.2, main: true },
      { y: 0.78, x: 0.16, z: 0.06, s: 0.75 },
      { y: 0.76, x: -0.14, z: 0.08, s: 0.7 },
      { y: 0.72, x: 0.08, z: -0.14, s: 0.65 },
      { y: 0.7, x: -0.1, z: -0.1, s: 0.6 },
      { y: 0.64, x: 0.18, z: -0.02, s: 0.52 },
      { y: 0.62, x: -0.16, z: 0.04, s: 0.5 },
    ];
    const ph0 = phenotype("dense");
    for (const spec of budSpecs) {
      const cola = new THREE.Group();
      cola.position.set(spec.x, spec.y, spec.z);
      cola.userData.main = !!spec.main;
      cola.userData.baseS = spec.s;
      for (let k = 0; k < 5; k++) {
        const calyx = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 10, 10),
          new THREE.MeshStandardMaterial({
            color: ph0.body,
            roughness: 0.35,
            metalness: 0.08,
            emissive: ph0.emissive,
            emissiveIntensity: ph0.emissiveIntensity,
          })
        );
        calyx.userData.part = "calyx";
        calyx.scale.set(0.9 * spec.s, 0.7 * spec.s, 0.9 * spec.s);
        calyx.position.y = k * 0.045 * spec.s;
        cola.add(calyx);
      }
      for (let k = 0; k < 3; k++) {
        const sugar = makeFanLeaf(
          new THREE.MeshStandardMaterial({
            color: ph0.sugarLeaf,
            roughness: 0.5,
            side: THREE.DoubleSide,
            emissive: ph0.emissive,
            emissiveIntensity: 0.2,
          }),
          3,
          0.22 * spec.s,
          "hybrid"
        );
        sugar.userData.part = "sugar";
        sugar.position.set((k - 1) * 0.05, 0.08 * spec.s, 0.04);
        sugar.rotation.z = (k - 1) * 0.5;
        sugar.rotation.x = -0.8;
        cola.add(sugar);
      }
      for (let k = 0; k < 8; k++) {
        const tip = new THREE.Mesh(
          new THREE.SphereGeometry(0.01, 5, 5),
          new THREE.MeshStandardMaterial({
            color: ph0.pistil,
            roughness: 0.5,
            emissive: 0x663300,
            emissiveIntensity: 0.35,
          })
        );
        tip.userData.part = "pistil";
        const a = (k / 8) * Math.PI * 2;
        tip.position.set(
          Math.cos(a) * 0.055 * spec.s,
          0.12 + (k % 3) * 0.03,
          Math.sin(a) * 0.055 * spec.s
        );
        cola.add(tip);
      }
      buds.add(cola);
      budMeshes.push(cola);
    }

    const sparkGeom = new THREE.BufferGeometry();
    const sparkCount = mobileLod ? 40 : 80;
    const sparkPos = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      sparkPos[i * 3] = (Math.random() - 0.5) * 0.5;
      sparkPos[i * 3 + 1] = 0.55 + Math.random() * 0.5;
      sparkPos[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }
    sparkGeom.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
    const sparks = new THREE.Points(
      sparkGeom,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.025,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      })
    );
    sparks.visible = false;
    plant.add(sparks);

    // Props
    const props = new THREE.Group();
    scene.add(props);

    const fan = new THREE.Group();
    fan.position.set(0.88, 1.05, -0.15);
    fan.rotation.y = -Math.PI / 2;
    fan.visible = false;
    const fanHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10),
      new THREE.MeshStandardMaterial({ color: 0x333338, metalness: 0.5, roughness: 0.4 })
    );
    fanHub.rotation.z = Math.PI / 2;
    fan.add(fanHub);
    const blades = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.035, 0.01),
        new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.5 })
      );
      blade.rotation.z = (i / 3) * Math.PI * 2;
      blades.add(blade);
    }
    fan.add(blades);
    props.add(fan);

    const filterGroup = new THREE.Group();
    filterGroup.position.set(-0.65, 1.95, -0.55);
    filterGroup.visible = false;
    const filterCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.4, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.7 })
    );
    filterCyl.rotation.z = Math.PI / 2;
    filterGroup.add(filterCyl);
    props.add(filterGroup);

    const climateBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.4, 0.26),
      new THREE.MeshStandardMaterial({ color: 0xd8d8dc, roughness: 0.45, metalness: 0.25 })
    );
    climateBox.position.set(-0.78, 0.22, -0.55);
    climateBox.visible = false;
    props.add(climateBox);

    const co2Group = new THREE.Group();
    co2Group.position.set(0.82, 0.3, -0.55);
    co2Group.visible = false;
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a6aaa, metalness: 0.55, roughness: 0.35 })
    );
    co2Group.add(tank);
    props.add(co2Group);

    const irrig = new THREE.Group();
    irrig.visible = false;
    const wateringCan = makeWateringCan();
    irrig.add(wateringCan);

    const dripKit = new THREE.Group();
    dripKit.name = "dripKit";
    dripKit.visible = false;
    const dripTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.55, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a1a22 })
    );
    dripTube.position.set(0.18, 0.95, 0);
    dripKit.add(dripTube);
    const emitterRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.012, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x333340, metalness: 0.3, roughness: 0.5 })
    );
    emitterRing.rotation.x = Math.PI / 2;
    emitterRing.position.set(0, 0.42, 0);
    dripKit.add(emitterRing);
    irrig.add(dripKit);
    props.add(irrig);

    // Nutrient bottle for feed FX
    const nuteBottle = new THREE.Group();
    nuteBottle.visible = false;
    const bottleBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.05, 0.18, 10),
      new THREE.MeshStandardMaterial({ color: 0x4a8020, roughness: 0.4, metalness: 0.1 })
    );
    bottleBody.position.y = 0.1;
    nuteBottle.add(bottleBody);
    const bottleCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.028, 0.04, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8a020, roughness: 0.5 })
    );
    bottleCap.position.y = 0.2;
    nuteBottle.add(bottleCap);
    nuteBottle.position.set(0.4, 0.35, 0.35);
    props.add(nuteBottle);

    // Visible pour stream (cylinder, not tiny points)
    const streamMat = new THREE.MeshBasicMaterial({
      color: 0x66ccff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.55, 8), streamMat);
    stream.visible = false;
    scene.add(stream);

    // Care particles — large & emissive
    const dripN = 90;
    const dripGeom = new THREE.BufferGeometry();
    const dripPos = new Float32Array(dripN * 3);
    const dripVel = [];
    for (let i = 0; i < dripN; i++) {
      dripPos[i * 3 + 1] = -10;
      dripVel.push({ vx: 0, vy: 0, vz: 0, life: 0 });
    }
    dripGeom.setAttribute("position", new THREE.BufferAttribute(dripPos, 3));
    const dripsMat = new THREE.PointsMaterial({
      color: 0x66ccff,
      size: 0.08,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const drips = new THREE.Points(dripGeom, dripsMat);
    scene.add(drips);

    const idleN = 16;
    const idleDripGeom = new THREE.BufferGeometry();
    const idlePos = new Float32Array(idleN * 3);
    for (let i = 0; i < idleN; i++) idlePos[i * 3 + 1] = -10;
    idleDripGeom.setAttribute("position", new THREE.BufferAttribute(idlePos, 3));
    const idleDrips = new THREE.Points(
      idleDripGeom,
      new THREE.PointsMaterial({ color: 0x66aaff, size: 0.04, transparent: true, opacity: 0.85, depthWrite: false })
    );
    idleDrips.visible = false;
    scene.add(idleDrips);

    const idleFeed = new THREE.Points(
      idleDripGeom.clone(),
      new THREE.PointsMaterial({ color: 0xaacc44, size: 0.035, transparent: true, opacity: 0.7, depthWrite: false })
    );
    idleFeed.visible = false;
    scene.add(idleFeed);
    const idleFeedPos = idleFeed.geometry.attributes.position.array;

    const cam = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.6, roughness: 0.35 })
    );
    cam.position.set(0.85, 1.85, 0.55);
    cam.visible = false;
    props.add(cam);

    const meter = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.04, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x222228, emissive: 0x226622, emissiveIntensity: 0.4 })
    );
    meter.position.set(0.22, 0.38, 0.18);
    meter.visible = false;
    props.add(meter);

    const curingRack = new THREE.Group();
    curingRack.position.set(-1.55, 0.55, -0.7);
    curingRack.visible = false;
    for (let s = 0; s < 3; s++) {
      const shelf = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.03, 0.28),
        new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 0.8 })
      );
      shelf.position.y = s * 0.28;
      curingRack.add(shelf);
    }
    props.add(curingRack);

    const scrapN = 36;
    const scrapGeom = new THREE.BufferGeometry();
    const scrapPos = new Float32Array(scrapN * 3);
    const scrapVel = [];
    for (let i = 0; i < scrapN; i++) {
      scrapPos[i * 3 + 1] = -10;
      scrapVel.push({ vx: 0, vy: 0, vz: 0, life: 0 });
    }
    scrapGeom.setAttribute("position", new THREE.BufferAttribute(scrapPos, 3));
    const scraps = new THREE.Points(
      scrapGeom,
      new THREE.PointsMaterial({ color: 0x3d8b4a, size: 0.05, depthWrite: false })
    );
    scene.add(scraps);

    const st = {
      scene,
      camera,
      renderer,
      roomRoot,
      get roomShell() {
        return roomShell;
      },
      set roomShell(v) {
        roomShell = v;
      },
      plant,
      stem,
      leafPairs,
      seedlingGroup,
      fanLeaves,
      buds,
      budMeshes,
      sparks,
      soil,
      pot,
      potMat,
      splash,
      tent,
      tentOuterMat,
      tentMylarMat,
      fixture,
      fixtureBody,
      emitter,
      emitterMat,
      diodes,
      cflGroup,
      hpsHood,
      hpsBulb,
      canopySpot,
      growFill,
      glowSphere,
      amb,
      fan,
      blades,
      filterGroup,
      climateBox,
      co2Group,
      irrig,
      wateringCan,
      dripKit,
      nuteBottle,
      stream,
      streamMat,
      idleDrips,
      idlePos,
      idleDripGeom,
      idleFeed,
      idleFeedPos,
      cam,
      meter,
      curingRack,
      dripPos,
      dripVel,
      dripGeom,
      dripsMat,
      scrapPos,
      scrapVel,
      scrapGeom,
      scrapsMat: scraps.material,
      budBaseScale: 1,
      canTilt: wateringCan.userData.idleRotZ,
      canTargetPos: wateringCan.userData.idlePos.clone(),
      bottleTilt: 0,
      bottleTargetPos: null,
      splashUntil: 0,
      fxUntil: 0,
      fxKind: null,
      houseTierApplied: -1,
      mobileLod,
      t0: performance.now(),
      disposed: false,
    };
    stateRef.current = st;

    let raf = 0;
    const tick = (now) => {
      if (st.disposed) return;
      const elapsed = (now - st.t0) / 1000;
      plant.rotation.y = st.fxKind === "water" || st.fxKind === "feed" ? 0 : Math.sin(elapsed * 0.25) * 0.08;
      if (st.blades && st.fan?.visible) st.blades.rotation.z = elapsed * 6;

      // Can / bottle: lift+tilt ease (pour into soil, not floor)
      if (st.wateringCan) {
        const tp = st.canTargetPos || st.wateringCan.userData.idlePos;
        st.wateringCan.position.lerp(tp, 0.14);
        st.wateringCan.rotation.z += (st.canTilt - st.wateringCan.rotation.z) * 0.14;
      }
      if (st.nuteBottle) {
        if (st.bottleTargetPos) st.nuteBottle.position.lerp(st.bottleTargetPos, 0.14);
        st.nuteBottle.rotation.z += (st.bottleTilt - st.nuteBottle.rotation.z) * 0.14;
      }

      // Splash fade
      if (st.splash && st.splash.material.opacity > 0) {
        if (now > st.splashUntil) {
          st.splash.material.opacity = Math.max(0, st.splash.material.opacity - 0.03);
        }
      }

      // Stream opacity while FX active
      if (st.stream && st.fxKind === "water") {
        st.stream.visible = true;
        st.streamMat.opacity = 0.75 + Math.sin(elapsed * 20) * 0.15;
      } else if (st.stream && st.fxKind === "feed") {
        st.stream.visible = true;
        st.streamMat.opacity = 0.7 + Math.sin(elapsed * 18) * 0.12;
      } else if (st.stream) {
        st.streamMat.opacity = Math.max(0, st.streamMat.opacity - 0.05);
        if (st.streamMat.opacity <= 0) st.stream.visible = false;
      }

      if (st.buds?.visible && st.fxKind !== "harvest_trim") {
        const pulse = 1 + Math.sin(elapsed * 2) * 0.03;
        st.buds.scale.setScalar((st.budBaseScale || 1) * pulse);
      }

      if (st.idleDrips?.visible) {
        for (let i = 0; i < idleN; i++) {
          let y = st.idlePos[i * 3 + 1];
          if (y < 0.38 || y > 1.0) {
            st.idlePos[i * 3] = (Math.random() - 0.5) * 0.12;
            st.idlePos[i * 3 + 1] = 0.55 + Math.random() * 0.1;
            st.idlePos[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
          } else st.idlePos[i * 3 + 1] -= 0.014;
        }
        st.idleDripGeom.attributes.position.needsUpdate = true;
      }
      if (st.idleFeed?.visible) {
        for (let i = 0; i < idleN; i++) {
          let y = st.idleFeedPos[i * 3 + 1];
          if (y < 0.38 || y > 1.0) {
            st.idleFeedPos[i * 3] = 0.15 + (Math.random() - 0.5) * 0.1;
            st.idleFeedPos[i * 3 + 1] = 0.6 + Math.random() * 0.08;
            st.idleFeedPos[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
          } else st.idleFeedPos[i * 3 + 1] -= 0.01;
        }
        st.idleFeed.geometry.attributes.position.needsUpdate = true;
      }

      if (st.fxKind === "water" || st.fxKind === "feed") {
        const attr = st.dripGeom.attributes.position;
        for (let i = 0; i < dripN; i++) {
          const v = st.dripVel[i];
          if (v.life <= 0) continue;
          v.life -= 0.016;
          st.dripPos[i * 3] += v.vx;
          st.dripPos[i * 3 + 1] += v.vy;
          st.dripPos[i * 3 + 2] += v.vz;
          v.vy -= 0.014;
        }
        attr.needsUpdate = true;
        if (performance.now() > st.fxUntil) {
          st.fxKind = null;
          if (st.wateringCan) {
            st.canTilt = st.wateringCan.userData.idleRotZ;
            st.canTargetPos = st.wateringCan.userData.idlePos.clone();
          }
          st.bottleTilt = 0;
          st.bottleTargetPos = null;
          if (st.nuteBottle) st.nuteBottle.visible = false;
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
        const shrink = Math.max(0.15, 1 - (performance.now() - (st.fxUntil - 1400)) / 1400);
        if (st.buds) st.buds.scale.setScalar((st.budBaseScale || 1) * shrink);
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
      disposeObject(scene);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // House shell swap
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.roomRoot || !st.camera) return;
    const tier = Math.max(0, Math.min(4, Number(houseTier) || 0));
    if (st.houseTierApplied === tier) return;
    st.houseTierApplied = tier;
    if (st.roomShell) {
      st.roomRoot.remove(st.roomShell);
      disposeObject(st.roomShell);
    }
    const shell = buildRoomShell(tier, st.mobileLod);
    st.roomRoot.add(shell);
    st.roomShell = shell;
    const p = shell.userData.preset;
    if (p) {
      st.camera.position.set(...p.cam);
      st.camera.lookAt(...p.look);
      if (st.amb) st.amb.intensity = p.amb;
      if (st.scene?.fog) st.scene.fog.color.setHex(p.fog);
      st.scene.background = new THREE.Color(p.fog).multiplyScalar(0.55);
    }
    void houseId;
  }, [houseTier, houseId]);

  // Light class
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.canopySpot) return;
    const cfg = LIGHT_COLORS[lightClass] || LIGHT_COLORS.cfl;
    const lightLvl =
      lightClass === "quantum"
        ? lvl(equipment, "lights_quantum")
        : lightClass === "hps"
          ? lvl(equipment, "lights_hps")
          : lightClass === "led"
            ? lvl(equipment, "lights_led")
            : Math.max(1, lvl(equipment, "lights_cfl"));
    const boost = 1 + Math.min(0.45, lightLvl * 0.04);
    st.canopySpot.color.setHex(cfg.color);
    st.canopySpot.intensity = cfg.spot * boost;
    st.growFill.color.setHex(cfg.color);
    st.growFill.intensity = cfg.intensity * 0.45 * boost;
    st.glowSphere.material.color.setHex(cfg.color);
    st.emitterMat.color.setHex(cfg.color);
    st.emitterMat.emissive.setHex(cfg.color);
    if (st.amb && cfg.amb) {
      st.amb.color.setHex(cfg.amb);
      st.amb.intensity = lightClass === "led" || lightClass === "quantum" ? 0.75 : 0.55;
    }
    if (st.scene?.fog) st.scene.fog.color.setHex(cfg.fog);
    const isCfl = lightClass === "cfl";
    const isHps = lightClass === "hps";
    const isLed = lightClass === "led" || lightClass === "quantum";
    st.cflGroup.visible = isCfl;
    st.hpsHood.visible = isHps;
    st.hpsBulb.visible = isHps;
    st.diodes.visible = isLed;
    st.emitter.visible = isLed || isCfl;
    st.fixtureBody.scale.set(isHps ? 0.7 : isLed ? 1.15 : 0.85, 1, isLed ? 1.1 : 0.9);
  }, [lightClass, equipment]);

  // Equipment props
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.tent) return;
    const tents = lvl(equipment, "tents");
    const mylar = lvl(equipment, "mylar");
    const pots = lvl(equipment, "pots");
    const irrigLvl = lvl(equipment, "irrigation");
    const fans = lvl(equipment, "osc_fans");
    const filter = lvl(equipment, "carbon_filter");
    const climate = Math.max(lvl(equipment, "climate_control"), lvl(equipment, "dehumidifier"));
    const co2 = lvl(equipment, "co2");
    const security = lvl(equipment, "security");
    const meters = lvl(equipment, "meters");
    const showDetail = !st.mobileLod;

    st.tent.visible = tents >= 1;
    if (tents >= 1) {
      const scale = tents >= 8 || houseTier >= 2 ? 1.2 : tents >= 4 ? 1.1 : 1;
      st.tent.scale.set(scale, 1 + (tents >= 6 ? 0.06 : 0), scale);
      st.tentMylarMat.metalness = 0.4 + Math.min(0.35, mylar * 0.04);
      st.tentMylarMat.color.setHex(mylar >= 3 ? 0xe8e4d8 : 0xc8c4b8);
    }
    if (pots >= 8) {
      st.potMat.color.setHex(0x5a5a58);
      st.pot.scale.set(1.05, 1.1, 1.05);
    } else if (pots >= 4) {
      st.potMat.color.setHex(0x3a3028);
      st.pot.scale.set(1.08, 1.15, 1.08);
    } else {
      st.potMat.color.setHex(0x6a4830);
      st.pot.scale.set(1, 1, 1);
    }

    st.fan.visible = fans >= 1 && showDetail;
    st.filterGroup.visible = filter >= 1 && tents >= 1;
    st.climateBox.visible = climate >= 1 && showDetail;
    st.co2Group.visible = co2 >= 1;
    st.irrig.visible = irrigLvl >= 1;
    if (st.wateringCan) st.wateringCan.visible = irrigLvl >= 1 && irrigLvl < 4;
    if (st.dripKit) st.dripKit.visible = irrigLvl >= 4;
    st.cam.visible = security >= 2;
    st.meter.visible = meters >= 1;
    st.curingRack.visible = curingCount > 0 && showDetail;
    st.idleDrips.visible = !!autoWater && irrigLvl >= 5;
    st.idleFeed.visible = !!autoFeed && irrigLvl >= 8;

    if (st.fixture) {
      st.fixture.position.set(0, tents >= 1 ? 1.88 : 2.05, 0);
      st.glowSphere.position.copy(st.fixture.position);
      st.canopySpot.position.set(0, st.fixture.position.y - 0.05, 0.05);
    }
  }, [equipment, houseTier, autoWater, autoFeed, curingCount]);

  // Plant stage + phenotype
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.plant) return;
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const empty = stage === "empty" || stage === "dead";
    st.plant.visible = !empty;
    if (empty) {
      if (st.buds) st.buds.visible = false;
      if (st.sparks) st.sparks.visible = false;
      if (st.seedlingGroup) st.seedlingGroup.visible = false;
      return;
    }

    const lightBoost =
      lightClass === "quantum" || lightClass === "led" ? 1.08 : lightClass === "hps" ? 1.05 : 1;
    const base =
      stage === "seedling"
        ? 0.72 + p * 0.2
        : stage === "veg"
          ? 0.88 + p * 0.22
          : stage === "flower"
            ? 1.05 + p * 0.2
            : 1.2;
    st.plant.scale.setScalar(base * lightBoost);

    if (st.seedlingGroup) {
      st.seedlingGroup.visible = stage === "seedling" || (stage === "veg" && p < 0.4);
      st.seedlingGroup.scale.setScalar(stage === "seedling" ? 1.05 : 0.75);
    }

    (st.leafPairs || []).forEach((pair) => {
      const minP = pair.userData?.minP ?? 0;
      const show = p >= minP && (stage !== "seedling" || minP <= 0.12);
      pair.visible = show;
      if (show) pair.scale.setScalar(Math.max(0.55, Math.min(1, (p - minP) / 0.1 + 0.5)));
    });

    if (st.stem) {
      // Stem height tracks grow progress — no tall bare stick
      const stemH =
        stage === "seedling" ? 0.4 + p * 0.25 : stage === "veg" ? 0.55 + p * 0.4 : 0.95;
      const thick = stage === "seedling" ? 0.75 : stage === "veg" ? 1 : 1.12;
      st.stem.scale.set(thick, stemH, thick);
      st.stem.position.y = 0.18 + stemH * 0.35;
    }

    // Leaf emissive under grow light
    const leafE =
      0.25 +
      (lightClass === "led" || lightClass === "quantum" ? 0.25 : lightClass === "hps" ? 0.15 : 0.05);
    (st.fanLeaves || []).forEach((leaf) => {
      leaf?.traverse((obj) => {
        if (obj.isMesh && obj.material?.emissive) obj.material.emissiveIntensity = leafE;
      });
    });

    const ph = phenotype(budMeshKey);
    const showBuds = stage === "flower" || stage === "harvest_ready";
    if (st.buds) {
      st.buds.visible = showBuds;
      (st.budMeshes || []).forEach((cola, i) => {
        if (!cola) return;
        const sideMult = cola.userData.main ? 1 : ph.sideBudScale;
        if (stage === "harvest_ready") {
          cola.visible = true;
          cola.scale.set(
            ph.colaScale.x * sideMult,
            ph.colaScale.y * sideMult,
            ph.colaScale.z * sideMult
          );
        } else {
          const unlock = i === 0 ? 0.65 : 0.7 + i * 0.04;
          cola.visible = p >= unlock;
          const s = (0.5 + (p - 0.65) * 1.2) * sideMult;
          cola.scale.set(ph.colaScale.x * s, ph.colaScale.y * s, ph.colaScale.z * s);
        }
        cola.traverse((obj) => {
          if (!obj.isMesh || !obj.material) return;
          const part = obj.userData.part;
          if (part === "pistil") {
            obj.material.color.setHex(ph.pistil);
            return;
          }
          if (part === "sugar" || obj.parent?.userData?.kind === "fan" || obj.userData?.kind === "fan") {
            if (obj.material.color) obj.material.color.setHex(ph.sugarLeaf);
            return;
          }
          if (part === "calyx" || obj.material.emissive) {
            obj.material.color.setHex(ph.body);
            if (obj.material.emissive) {
              obj.material.emissive.setHex(ph.emissive);
              obj.material.emissiveIntensity =
                ph.emissiveIntensity * (stage === "harvest_ready" ? 1.25 : 1);
            }
          }
        });
      });
    }

    if (st.sparks) {
      const frostyAmp = budMeshKey === "frosty" || quality >= 70;
      st.sparks.visible = showBuds && (stage === "harvest_ready" || frostyAmp || quality >= 55);
      st.sparks.material.color.setHex(ph.sparkColor);
      st.sparks.material.size = ph.sparkSize * (stage === "harvest_ready" ? 1.3 : 1);
      st.sparks.material.opacity =
        ph.sparkOpacity * (budMeshKey === "frosty" && stage === "harvest_ready" ? 1 : 0.85);
    }
    if (st.scrapsMat) st.scrapsMat.color.setHex(ph.scrapColor);

    st.budBaseScale = stage === "harvest_ready" ? 1.2 : stage === "flower" ? 0.85 + p * 0.3 : 0.7;
    if (st.buds && st.fxKind !== "harvest_trim") st.buds.scale.setScalar(st.budBaseScale);

    // Strain type leaf width bias via scale on fan leaves
    const wBias = strainType === "indica" ? 1.12 : strainType === "sativa" ? 0.88 : 1;
    const lBias = strainType === "sativa" ? 1.12 : strainType === "indica" ? 0.92 : 1;
    (st.fanLeaves || []).forEach((leaf) => {
      if (leaf?.scale) leaf.scale.set(wBias, lBias, 1);
    });
  }, [stage, progress, budMeshKey, strainType, quality, lightClass]);

  // Care + harvest FX
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !fx) return;

    st.fxKind = fx;
    const dur = fx === "harvest_trim" ? 1400 : 1400;
    st.fxUntil = performance.now() + dur;

    if (fx === "water" || fx === "feed") {
      const isWater = fx === "water";
      const color = isWater ? 0x66ccff : 0xb8d44a;
      st.dripsMat.color.setHex(color);
      st.dripsMat.size = 0.09;
      st.dripsMat.opacity = 1;
      st.streamMat.color.setHex(color);
      st.stream.visible = true;
      st.streamMat.opacity = 0.9;

      // Soil target (center of pot soil disc)
      const soilX = 0;
      const soilY = 0.4;
      const soilZ = 0;

      const useCan = isWater && st.wateringCan && (st.wateringCan.visible || st.irrig?.visible);
      const useDrip = isWater && st.dripKit?.visible;
      let sx;
      let sy;
      let sz;

      if (isWater && useCan) {
        // Lift left of pot (no clip), mild tip so spout aims into soil
        if (st.irrig) st.irrig.visible = true;
        st.wateringCan.visible = true;
        const pourPos = st.wateringCan.userData.pourPos;
        const pourRot = st.wateringCan.userData.pourRotZ;
        st.canTargetPos = pourPos.clone();
        st.canTilt = pourRot;
        // Snap immediately so stream matches pose (don't wait for lerp)
        st.wateringCan.position.copy(pourPos);
        st.wateringCan.rotation.z = pourRot;
        st.wateringCan.updateMatrixWorld(true);
        const tip = st.wateringCan.getObjectByName("pourTip");
        const tipWorld = new THREE.Vector3();
        if (tip) tip.getWorldPosition(tipWorld);
        else tipWorld.set(-0.12, 0.62, 0.12);
        sx = tipWorld.x;
        sy = tipWorld.y;
        sz = tipWorld.z;
      } else if (isWater && useDrip) {
        sx = 0.04;
        sy = 0.62;
        sz = 0.04;
      } else if (!isWater) {
        st.nuteBottle.visible = true;
        st.bottleTargetPos = new THREE.Vector3(0.28, 0.58, 0.2);
        st.nuteBottle.position.copy(st.bottleTargetPos);
        st.bottleTilt = 0.85;
        sx = 0.12;
        sy = 0.68;
        sz = 0.12;
      } else {
        sx = -0.1;
        sy = 0.7;
        sz = 0.12;
      }

      // Vertical-ish stream from tip down into soil center
      const midX = (sx + soilX) * 0.5;
      const midY = (sy + soilY) * 0.5;
      const midZ = (sz + soilZ) * 0.5;
      const dx = soilX - sx;
      const dy = soilY - sy;
      const dz = soilZ - sz;
      const len = Math.max(0.22, Math.hypot(dx, dy, dz));
      st.stream.position.set(midX, midY, midZ);
      st.stream.scale.set(0.9, len / 0.55, 0.9);
      st.stream.rotation.set(0, 0, 0);
      // Aim cylinder along tip→soil
      const dir = new THREE.Vector3(dx, dy, dz).normalize();
      st.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

      for (let i = 0; i < st.dripVel.length; i++) {
        st.dripPos[i * 3] = sx + (Math.random() - 0.5) * 0.04;
        st.dripPos[i * 3 + 1] = sy + (Math.random() - 0.5) * 0.03;
        st.dripPos[i * 3 + 2] = sz + (Math.random() - 0.5) * 0.04;
        st.dripVel[i] = {
          vx: dx * 0.04 + (Math.random() - 0.5) * 0.006,
          vy: dy * 0.04 - 0.01,
          vz: dz * 0.04 + (Math.random() - 0.5) * 0.006,
          life: 0.9 + Math.random() * 0.5,
        };
      }
      st.dripGeom.attributes.position.needsUpdate = true;

      if (st.splash) {
        st.splash.position.set(0, 0.4, 0);
        st.splash.material.color.setHex(color);
        st.splash.material.opacity = 0.9;
        st.splashUntil = performance.now() + 1000;
      }
      st.soil.material.color.setHex(isWater ? 0x2a1810 : 0x2a3018);
      setTimeout(() => {
        if (st.soil) st.soil.material.color.setHex(0x3a2818);
      }, 1100);
    }

    if (fx === "harvest_trim") {
      for (let i = 0; i < st.scrapVel.length; i++) {
        st.scrapPos[i * 3] = (Math.random() - 0.5) * 0.25;
        st.scrapPos[i * 3 + 1] = 0.95;
        st.scrapPos[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
        st.scrapVel[i] = {
          vx: (Math.random() - 0.5) * 0.045,
          vy: 0.02 + Math.random() * 0.03,
          vz: (Math.random() - 0.5) * 0.045,
          life: 0.8 + Math.random() * 0.5,
        };
      }
      st.scrapGeom.attributes.position.needsUpdate = true;
    }
  }, [fx, fxNonce]);

  return (
    <div
      ref={mountRef}
      className="w-full h-[280px] md:h-[340px] rounded-lg overflow-hidden border border-emerald-900/40 bg-black"
      aria-label="Grow room 3D view"
    />
  );
}
