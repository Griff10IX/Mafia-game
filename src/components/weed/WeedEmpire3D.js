import { useEffect, useRef } from "react";
import * as THREE from "three";

const LIGHT_COLORS = {
  cfl: { color: 0xffe8b0, intensity: 2.4, fog: 0x3a3228, spot: 1.6 },
  led: { color: 0xc4a0ff, intensity: 3.6, fog: 0x2a2040, spot: 2.8 },
  hps: { color: 0xffb84a, intensity: 4.0, fog: 0x3a2810, spot: 3.2 },
  quantum: { color: 0xe8f4ff, intensity: 4.6, fog: 0x1a2838, spot: 3.8 },
};

const MESH_TINT = {
  dense: 0x3d8f3d,
  airy: 0x4cb05a,
  frosty: 0x7fd48a,
  purple: 0x7a5088,
};

function lvl(equipment, id) {
  return Math.max(0, Number(equipment?.[id]) || 0);
}

function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  });
}

/**
 * Gear-driven grow room: tent shell, canopy SpotLights, props from owned equipment.
 */
export default function WeedEmpire3D({
  lightClass = "cfl",
  stage = "empty",
  progress = 0,
  budMeshKey = "dense",
  quality = 50,
  equipment = {},
  houseTier = 0,
  autoWater = false,
  curingCount = 0,
  fx = null,
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
    scene.fog = new THREE.FogExp2(0x2a241c, 0.022);

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    camera.position.set(0.15, 1.45, 3.55);
    camera.lookAt(0, 0.85, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobileLod ? 1.5 : 2));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.28;
    mount.appendChild(renderer.domElement);

    // Closet / room shell
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 4),
      new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.9, metalness: 0.04 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 2.8),
      new THREE.MeshStandardMaterial({ color: 0x1c1916, roughness: 0.92 })
    );
    back.position.set(0, 1.4, -1.55);
    scene.add(back);
    const leftWall = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 2.8),
      new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.95 })
    );
    leftWall.position.set(-2.4, 1.4, 0);
    leftWall.rotation.y = Math.PI / 2;
    scene.add(leftWall);

    // Tent group (fabric walls + poles + mylar inner)
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
      side: THREE.BackSide,
    });
    const tentBox = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.15, 1.7), tentOuterMat);
    tentBox.position.y = 1.08;
    tent.add(tentBox);
    const tentInner = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.05, 1.6), tentMylarMat);
    tentInner.position.y = 1.08;
    tent.add(tentInner);
    // zipper strip
    const zip = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 1.6, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.6, roughness: 0.4 })
    );
    zip.position.set(0, 1.0, 0.86);
    tent.add(zip);
    // poles
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x555560, metalness: 0.7, roughness: 0.35 });
    for (const [x, z] of [
      [-0.95, -0.75],
      [0.95, -0.75],
      [-0.95, 0.75],
      [0.95, 0.75],
    ]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.15, 8), poleMat);
      pole.position.set(x, 1.08, z);
      tent.add(pole);
    }

    // Fixture hang + grow lights
    const fixture = new THREE.Group();
    fixture.position.set(0, 1.95, 0);
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

    // LED diode dots (hidden for CFL)
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

    // CFL bulbs
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

    // HPS hood
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

    // Pot (swappable look via materials)
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

    // Plant
    const plant = new THREE.Group();
    plant.position.set(0, 0.4, 0);
    scene.add(plant);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, 0.5, 8),
      new THREE.MeshStandardMaterial({
        color: 0x3d7a38,
        roughness: 0.65,
        emissive: 0x142814,
        emissiveIntensity: 0.25,
      })
    );
    stem.position.y = 0.25;
    plant.add(stem);

    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x3d8f3d,
      roughness: 0.55,
      metalness: 0.02,
      emissive: 0x1a3a1a,
      emissiveIntensity: 0.35,
    });
    const budMat = new THREE.MeshStandardMaterial({
      color: MESH_TINT[budMeshKey] || MESH_TINT.dense,
      roughness: 0.35,
      metalness: 0.08,
      emissive: 0x306030,
      emissiveIntensity: 0.55,
    });
    const pistilMat = new THREE.MeshStandardMaterial({
      color: 0xe8a040,
      roughness: 0.5,
      emissive: 0x663300,
      emissiveIntensity: 0.35,
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

    const buds = new THREE.Group();
    buds.visible = false;
    plant.add(buds);
    const budMeshes = [];
    const budSpecs = [
      { y: 0.72, x: 0, z: 0, s: 1.15 },
      { y: 0.58, x: 0.14, z: 0.08, s: 0.72 },
      { y: 0.56, x: -0.12, z: 0.1, s: 0.68 },
      { y: 0.52, x: 0.06, z: -0.14, s: 0.62 },
      { y: 0.5, x: -0.1, z: -0.1, s: 0.58 },
      { y: 0.44, x: 0.16, z: -0.02, s: 0.5 },
      { y: 0.42, x: -0.15, z: 0.04, s: 0.48 },
    ];
    for (const spec of budSpecs) {
      const cola = new THREE.Group();
      cola.position.set(spec.x, spec.y, spec.z);
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), budMat.clone());
      body.scale.set(0.85 * spec.s, 1.35 * spec.s, 0.85 * spec.s);
      cola.add(body);
      for (let k = 0; k < 3; k++) {
        const bump = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), budMat.clone());
        bump.position.set((k - 1) * 0.04, 0.02 + k * 0.05, (k % 2) * 0.03);
        bump.scale.setScalar(0.7 * spec.s);
        cola.add(bump);
      }
      for (let k = 0; k < 4; k++) {
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), pistilMat.clone());
        const a = (k / 4) * Math.PI * 2;
        tip.position.set(Math.cos(a) * 0.06 * spec.s, 0.1 * spec.s, Math.sin(a) * 0.06 * spec.s);
        cola.add(tip);
      }
      cola.userData.baseScale = spec.s;
      buds.add(cola);
      budMeshes.push(cola);
    }
    const bud = budMeshes[0];

    const sparkGeom = new THREE.BufferGeometry();
    const sparkCount = mobileLod ? 28 : 55;
    const positions = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.4;
      positions[i * 3 + 1] = 0.45 + Math.random() * 0.4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
    sparkGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const sparks = new THREE.Points(
      sparkGeom,
      new THREE.PointsMaterial({ color: 0xf0ffe8, size: 0.022, transparent: true, opacity: 0.85 })
    );
    sparks.visible = false;
    plant.add(sparks);

    // Props group
    const props = new THREE.Group();
    scene.add(props);

    // Fan (clip style)
    const fan = new THREE.Group();
    fan.position.set(0.85, 1.15, 0.55);
    fan.visible = false;
    const fanHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.06, 10),
      new THREE.MeshStandardMaterial({ color: 0x333338, metalness: 0.5, roughness: 0.4 })
    );
    fanHub.rotation.z = Math.PI / 2;
    fan.add(fanHub);
    const blades = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.04, 0.01),
        new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.5 })
      );
      blade.rotation.z = (i / 3) * Math.PI * 2;
      blades.add(blade);
    }
    fan.add(blades);
    props.add(fan);

    // Carbon filter + duct on tent roof
    const filterGroup = new THREE.Group();
    filterGroup.position.set(-0.55, 2.15, -0.2);
    filterGroup.visible = false;
    const filterCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.45, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.7 })
    );
    filterCyl.rotation.z = Math.PI / 2;
    filterGroup.add(filterCyl);
    const duct = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: 0x6a5a40, roughness: 0.65 })
    );
    duct.position.set(0.35, 0.05, 0);
    duct.rotation.z = Math.PI / 3;
    filterGroup.add(duct);
    props.add(filterGroup);

    // Climate box (AC / dehum)
    const climateBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.45, 0.28),
      new THREE.MeshStandardMaterial({ color: 0xd8d8dc, roughness: 0.45, metalness: 0.25 })
    );
    climateBox.position.set(-1.15, 0.25, 0.7);
    climateBox.visible = false;
    props.add(climateBox);

    // CO2 tank
    const co2Group = new THREE.Group();
    co2Group.position.set(1.15, 0.35, -0.55);
    co2Group.visible = false;
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.55, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a6aaa, metalness: 0.55, roughness: 0.35 })
    );
    co2Group.add(tank);
    const valve = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.06, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.7 })
    );
    valve.position.y = 0.32;
    co2Group.add(valve);
    props.add(co2Group);

    // Irrigation drip lines
    const irrig = new THREE.Group();
    irrig.visible = false;
    const can = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a7aaa, roughness: 0.5 })
    );
    can.position.set(-0.45, 0.55, 0.35);
    irrig.add(can);
    const dripLine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x222228 })
    );
    dripLine.position.set(0.1, 0.95, 0.15);
    dripLine.rotation.z = Math.PI / 2.5;
    irrig.add(dripLine);
    const nozzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x444450, metalness: 0.4 })
    );
    nozzle.position.set(0, 0.72, 0.05);
    irrig.add(nozzle);
    props.add(irrig);

    // Idle drip particles for auto-water
    const idleDripGeom = new THREE.BufferGeometry();
    const idleN = 12;
    const idlePos = new Float32Array(idleN * 3);
    for (let i = 0; i < idleN; i++) idlePos[i * 3 + 1] = -10;
    idleDripGeom.setAttribute("position", new THREE.BufferAttribute(idlePos, 3));
    const idleDrips = new THREE.Points(
      idleDripGeom,
      new THREE.PointsMaterial({ color: 0x66aaff, size: 0.02, transparent: true, opacity: 0.7 })
    );
    idleDrips.visible = false;
    scene.add(idleDrips);

    // Security cam
    const cam = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.6, roughness: 0.35 })
    );
    cam.position.set(0.9, 1.85, 0.7);
    cam.visible = false;
    props.add(cam);

    // Meter on pot rim
    const meter = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.04, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x222228, emissive: 0x226622, emissiveIntensity: 0.4 })
    );
    meter.position.set(0.22, 0.38, 0.18);
    meter.visible = false;
    props.add(meter);

    // Curing racks background
    const curingRack = new THREE.Group();
    curingRack.position.set(-1.6, 0.9, -0.9);
    curingRack.visible = false;
    for (let s = 0; s < 3; s++) {
      const shelf = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.03, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 0.8 })
      );
      shelf.position.y = s * 0.28;
      curingRack.add(shelf);
      for (let j = 0; j < 2; j++) {
        const jar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8),
          new THREE.MeshStandardMaterial({ color: 0x88aa66, transparent: true, opacity: 0.55 })
        );
        jar.position.set(-0.15 + j * 0.25, s * 0.28 + 0.08, 0);
        curingRack.add(jar);
      }
    }
    props.add(curingRack);

    // Water FX
    const dripGeom = new THREE.BufferGeometry();
    const dripN = 60;
    const dripPos = new Float32Array(dripN * 3);
    const dripVel = [];
    for (let i = 0; i < dripN; i++) {
      dripPos[i * 3 + 1] = -10;
      dripVel.push({ vx: 0, vy: 0, vz: 0, life: 0 });
    }
    dripGeom.setAttribute("position", new THREE.BufferAttribute(dripPos, 3));
    const drips = new THREE.Points(
      dripGeom,
      new THREE.PointsMaterial({ color: 0x66aaff, size: 0.035, transparent: true, opacity: 0.85 })
    );
    scene.add(drips);

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
      buds,
      budMeshes,
      sparks,
      soil,
      pot,
      potMat,
      tent,
      tentOuterMat,
      tentMylarMat,
      tentBox,
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
      idleDrips,
      idlePos,
      idleDripGeom,
      cam,
      meter,
      curingRack,
      dripPos,
      dripVel,
      dripGeom,
      dripsMat: drips.material,
      scrapPos,
      scrapVel,
      scrapGeom,
      budBaseScale: 1,
      fxUntil: 0,
      fxKind: null,
      t0: performance.now(),
      disposed: false,
      mobileLod,
    };
    stateRef.current = st;

    let raf = 0;
    const tick = (t) => {
      if (st.disposed) return;
      const elapsed = (t - st.t0) / 1000;
      plant.rotation.y = Math.sin(elapsed * 0.25) * 0.08;
      if (st.blades && st.fan?.visible) st.blades.rotation.z = elapsed * 6;
      if (st.buds?.visible) {
        const pulse = 1 + Math.sin(elapsed * 2) * 0.03;
        const base = st.budBaseScale || 1;
        if (st.fxKind !== "harvest_trim") st.buds.scale.setScalar(base * pulse);
      }
      if (st.idleDrips?.visible) {
        for (let i = 0; i < idleN; i++) {
          let y = st.idlePos[i * 3 + 1];
          if (y < 0.35 || y > 1.2) {
            st.idlePos[i * 3] = (Math.random() - 0.5) * 0.15;
            st.idlePos[i * 3 + 1] = 0.9 + Math.random() * 0.15;
            st.idlePos[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
          } else {
            st.idlePos[i * 3 + 1] -= 0.012;
          }
        }
        st.idleDripGeom.attributes.position.needsUpdate = true;
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

  // Light class → fixture mesh + canopy wash
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
    st.growFill.intensity = cfg.intensity * 0.35 * boost;
    st.glowSphere.material.color.setHex(cfg.color);
    st.glowSphere.material.opacity = 0.32 + cfg.intensity * 0.05;
    st.emitterMat.color.setHex(cfg.color);
    st.emitterMat.emissive.setHex(cfg.color);
    st.emitterMat.emissiveIntensity = 1.1 + cfg.intensity * 0.15;
    if (st.scene?.fog) st.scene.fog.color.setHex(cfg.fog);

    const isCfl = lightClass === "cfl";
    const isHps = lightClass === "hps";
    const isLed = lightClass === "led" || lightClass === "quantum";
    st.cflGroup.visible = isCfl;
    st.hpsHood.visible = isHps;
    st.hpsBulb.visible = isHps;
    st.diodes.visible = isLed;
    st.emitter.visible = isLed || isCfl;
    st.fixtureBody.scale.set(
      isHps ? 0.7 : isLed ? 1.15 + lightLvl * 0.02 : 0.85,
      1,
      isLed ? 1.1 : 0.9
    );
    if (lightClass === "quantum") {
      st.fixtureBody.scale.set(1.35, 1, 1.25);
      st.emitter.scale.set(1.2, 1, 1.15);
    }
  }, [lightClass, equipment]);

  // Equipment → room props / tent / pot
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

    st.tent.visible = tents >= 1;
    if (tents >= 1) {
      const scale = tents >= 8 || houseTier >= 2 ? 1.25 : tents >= 4 ? 1.12 : 1;
      st.tent.scale.set(scale, 1 + (tents >= 6 ? 0.08 : 0), scale);
      const reflect = 0.35 + Math.min(0.4, mylar * 0.05);
      st.tentMylarMat.metalness = 0.4 + Math.min(0.35, mylar * 0.04);
      st.tentMylarMat.roughness = Math.max(0.2, 0.5 - mylar * 0.03);
      st.tentMylarMat.color.setHex(mylar >= 3 ? 0xe8e4d8 : 0xc8c4b8);
      if (st.amb) st.amb.intensity = 0.45 + reflect * 0.4;
    } else {
      if (st.amb) st.amb.intensity = 0.7;
    }

    // Pot look: plastic → fabric (taller darker) → air pot (lighter)
    if (pots >= 8) {
      st.potMat.color.setHex(0x5a5a58);
      st.potMat.roughness = 0.55;
      st.pot.scale.set(1.05, 1.1, 1.05);
    } else if (pots >= 4) {
      st.potMat.color.setHex(0x3a3028);
      st.potMat.roughness = 0.85;
      st.pot.scale.set(1.08, 1.15, 1.08);
    } else {
      st.potMat.color.setHex(0x6a4830);
      st.potMat.roughness = 0.7;
      st.pot.scale.set(1, 1, 1);
    }

    const showDetail = !st.mobileLod;
    st.fan.visible = fans >= 1 && showDetail;
    st.filterGroup.visible = filter >= 1 && tents >= 1;
    st.climateBox.visible = climate >= 1 && showDetail;
    st.co2Group.visible = co2 >= 1;
    st.irrig.visible = irrigLvl >= 1;
    st.cam.visible = security >= 2;
    st.meter.visible = meters >= 1;
    st.curingRack.visible = curingCount > 0 && showDetail;
    st.idleDrips.visible = !!autoWater && irrigLvl >= 5;

    // Hang fixture from tent ceiling when tent present
    if (st.fixture) {
      st.fixture.position.y = tents >= 1 ? 1.95 : 2.15;
      st.glowSphere.position.copy(st.fixture.position);
      st.canopySpot.position.set(0, st.fixture.position.y - 0.05, 0.05);
    }
  }, [equipment, houseTier, autoWater, curingCount]);

  // Plant stage
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.plant) return;
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const empty = stage === "empty" || stage === "dead";
    st.plant.visible = !empty;
    if (empty) {
      if (st.buds) st.buds.visible = false;
      if (st.sparks) st.sparks.visible = false;
      return;
    }

    const lightBoost =
      lightClass === "quantum" || lightClass === "led" ? 1.08 : lightClass === "hps" ? 1.05 : 1;
    const scale =
      (stage === "seedling" ? 0.4 + p * 0.25 : stage === "veg" ? 0.65 + p * 0.3 : 1.0 + p * 0.2) *
      lightBoost;
    st.plant.scale.setScalar(scale);

    const showBuds = stage === "flower" || stage === "harvest_ready";
    if (st.buds) {
      st.buds.visible = showBuds;
      (st.budMeshes || []).forEach((cola, i) => {
        if (!cola) return;
        if (stage === "harvest_ready") {
          cola.visible = true;
          cola.scale.setScalar(1);
        } else {
          const unlock = i === 0 ? 0 : 0.15 + i * 0.1;
          cola.visible = p >= unlock;
          cola.scale.setScalar(0.55 + p * 0.45);
        }
      });
    }
    if (st.sparks) {
      st.sparks.visible = showBuds && (stage === "harvest_ready" || quality >= 55);
      st.sparks.material.opacity = stage === "harvest_ready" ? 0.95 : 0.7;
    }

    const tint = MESH_TINT[budMeshKey] || MESH_TINT.dense;
    (st.budMeshes || []).forEach((cola) => {
      cola?.traverse((obj) => {
        if (obj.isMesh && obj.material && obj.material.emissive && obj.material.color) {
          const c = obj.material.color.getHex();
          if (c === 0xe8a040) return;
          obj.material.color.setHex(tint);
          obj.material.emissiveIntensity =
            stage === "harvest_ready" ? 0.75 : 0.45 + (quality / 100) * 0.3;
        }
      });
    });
    (st.leaves || []).forEach((leaf) => {
      if (leaf?.material) {
        leaf.material.emissiveIntensity = 0.3 + (lightClass === "led" || lightClass === "quantum" ? 0.2 : 0);
      }
    });

    st.budBaseScale = stage === "harvest_ready" ? 1.35 : stage === "flower" ? 0.9 + p * 0.25 : 0.7;
    if (st.buds && st.fxKind !== "harvest_trim") {
      st.buds.scale.setScalar(st.budBaseScale);
    }
  }, [stage, progress, budMeshKey, quality, lightClass]);

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
