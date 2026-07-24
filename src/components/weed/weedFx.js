import * as THREE from "three";

const WATER = 0x66cfff;
const FEED = 0xaed548;
const WET_WATER = new THREE.Color(0x21140e);
const WET_FEED = new THREE.Color(0x252417);

function anchor(parent, name, position) {
  const point = new THREE.Object3D();
  point.name = name;
  point.position.set(...position);
  parent.add(point);
  return point;
}

function makeStream() {
  const material = new THREE.MeshPhysicalMaterial({
    color: WATER,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    roughness: 0.08,
    transmission: 0.35,
    thickness: 0.04,
  });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.027, 1, 10), material);
  mesh.visible = false;
  return { mesh, material };
}

function makeDroplets(mobileLod) {
  const count = mobileLod ? 18 : 34;
  const positions = new Float32Array(count * 3);
  positions.fill(-20);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: WATER,
    size: mobileLod ? 0.035 : 0.045,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  return { points: new THREE.Points(geometry, material), positions, count };
}

export function createCareRig(growZone, wateringCan, nutrientBottle, soil, mobileLod) {
  const canPivot = new THREE.Group();
  canPivot.name = "wateringCanPivot";
  canPivot.position.set(-0.58, 0.38, 0.2);
  wateringCan.scale.setScalar(0.95);
  // Poly Pizza can is authored with its spout on local +X. Keeping that axis
  // aimed at the pot prevents the stream appearing from the body/side.
  wateringCan.position.set(0, -0.28, 0);
  canPivot.add(wateringCan);
  const canTip = anchor(wateringCan, "pourTip", [0.305, 0.205, 0]);
  growZone.add(canPivot);

  const bottlePivot = new THREE.Group();
  bottlePivot.name = "nutrientBottlePivot";
  bottlePivot.position.set(0.5, 0.38, 0.22);
  nutrientBottle.scale.setScalar(0.8);
  nutrientBottle.position.set(0, -0.25, 0);
  bottlePivot.add(nutrientBottle);
  const bottleTip = anchor(nutrientBottle, "doseTip", [0, 0.285, 0]);
  bottlePivot.visible = false;
  growZone.add(bottlePivot);

  const dripLine = new THREE.Group();
  dripLine.name = "dripLine";
  const tube = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.012, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x20232b, roughness: 0.55 })
  );
  tube.rotation.x = Math.PI / 2;
  tube.position.y = 0.42;
  dripLine.add(tube);
  const dripTip = anchor(dripLine, "dripTip", [0.04, 0.43, 0.04]);
  dripLine.visible = false;
  growZone.add(dripLine);

  const reservoir = new THREE.Group();
  reservoir.name = "irrigationReservoir";
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.18, 0.38, 16),
    new THREE.MeshStandardMaterial({ color: 0x384652, roughness: 0.48, metalness: 0.15 })
  );
  tank.position.set(-0.78, 0.2, -0.42);
  tank.castShadow = true;
  reservoir.add(tank);
  const levelWindow = new THREE.Mesh(
    new THREE.BoxGeometry(0.025, 0.22, 0.055),
    new THREE.MeshStandardMaterial({ color: 0x66b9d5, emissive: 0x17445a, emissiveIntensity: 0.45 })
  );
  levelWindow.position.set(-0.615, 0.21, -0.42);
  reservoir.add(levelWindow);
  const pumpIndicator = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x55dd88, emissive: 0x228844, emissiveIntensity: 0.8 })
  );
  pumpIndicator.position.set(-0.72, 0.39, -0.39);
  reservoir.add(pumpIndicator);
  reservoir.visible = false;
  growZone.add(reservoir);

  const { mesh: stream, material: streamMaterial } = makeStream();
  growZone.add(stream);
  const droplets = makeDroplets(mobileLod);
  growZone.add(droplets.points);
  const splash = new THREE.Mesh(
    new THREE.RingGeometry(0.055, 0.2, 26),
    new THREE.MeshBasicMaterial({ color: WATER, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  splash.rotation.x = -Math.PI / 2;
  splash.position.y = 0.398;
  growZone.add(splash);

  return {
    canPivot,
    wateringCan,
    canTip,
    bottlePivot,
    nutrientBottle,
    bottleTip,
    dripLine,
    dripTip,
    reservoir,
    pumpIndicator,
    soil,
    soilBaseColor: soil.material?.color?.clone(),
    soilBaseRoughness: soil.material?.roughness ?? 1,
    wetUntil: 0,
    stream,
    streamMaterial,
    splash,
    droplets,
    kind: null,
    startedAt: 0,
    duration: 1650,
    until: 0,
    source: null,
    targetPosition: new THREE.Vector3(),
    idleCan: new THREE.Vector3(-0.58, 0.38, 0.2),
    pourCan: new THREE.Vector3(-0.43, 0.72, 0.1),
    idleBottle: new THREE.Vector3(0.5, 0.38, 0.22),
    pourBottle: new THREE.Vector3(0.33, 0.7, 0.12),
  };
}

export function setIrrigationVisibility(rig, level) {
  const owned = level >= 1;
  rig.canPivot.visible = owned && level < 4 && rig.kind !== "feed";
  rig.dripLine.visible = level >= 4;
  rig.reservoir.visible = level >= 6;
  if (!rig.kind) rig.bottlePivot.visible = false;
}

export function startCareFx(rig, kind, irrigationLevel = 0, duration = 1650) {
  if (kind !== "water" && kind !== "feed") return false;
  rig.kind = kind;
  rig.startedAt = performance.now();
  rig.duration = duration;
  rig.until = rig.startedAt + duration;
  const color = kind === "water" ? WATER : FEED;
  rig.streamMaterial.color.setHex(color);
  rig.droplets.points.material.color.setHex(color);
  rig.splash.material.color.setHex(color);
  rig.splash.material.opacity = 0;
  rig.stream.visible = false;
  rig.streamMaterial.opacity = 0;

  if (kind === "feed") {
    rig.bottlePivot.visible = true;
    rig.source = rig.bottleTip;
  } else if (irrigationLevel >= 4) {
    rig.dripLine.visible = true;
    rig.canPivot.visible = false;
    rig.source = rig.dripTip;
  } else {
    rig.canPivot.visible = true;
    rig.source = rig.canTip;
  }
  return true;
}

function alignStream(rig) {
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  rig.source?.getWorldPosition(start);
  rig.soil.getWorldPosition(end);
  end.y += 0.035;
  const delta = end.clone().sub(start);
  const length = Math.max(0.02, delta.length());
  rig.stream.position.copy(start).addScaledVector(delta, 0.5);
  rig.stream.scale.set(0.78 + Math.sin(performance.now() * 0.02) * 0.08, length, 0.78);
  rig.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());

  const { positions, count } = rig.droplets;
  for (let i = 0; i < count; i++) {
    const phase = ((performance.now() * 0.0018 + i / count) % 1);
    positions[i * 3] = THREE.MathUtils.lerp(start.x, end.x, phase) + Math.sin(i * 3.1) * 0.008;
    positions[i * 3 + 1] = THREE.MathUtils.lerp(start.y, end.y, phase) - Math.sin(phase * Math.PI) * 0.035;
    positions[i * 3 + 2] = THREE.MathUtils.lerp(start.z, end.z, phase) + Math.cos(i * 2.7) * 0.008;
  }
  rig.droplets.points.geometry.attributes.position.needsUpdate = true;
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function updateCareFx(rig, now, irrigationLevel = 0) {
  const active = rig.kind === "water" || rig.kind === "feed";
  const phase = active ? THREE.MathUtils.clamp((now - rig.startedAt) / rig.duration, 0, 1) : 0;
  const lift = active ? smoothstep(0.02, 0.28, phase) * (1 - smoothstep(0.82, 0.98, phase)) : 0;
  const tilt = active ? smoothstep(0.24, 0.42, phase) * (1 - smoothstep(0.76, 0.94, phase)) : 0;
  const pour = active && phase >= 0.4 && phase <= 0.82;
  if (rig.pumpIndicator?.material) {
    rig.pumpIndicator.material.emissiveIntensity = 0.55 + Math.sin(now * 0.004) * 0.25;
    rig.pumpIndicator.material.color.setHex(rig.autoFeed ? 0x9bd84f : 0x55dd88);
  }

  rig.canPivot.position.lerpVectors(rig.idleCan, rig.pourCan, rig.kind === "water" && irrigationLevel < 4 ? lift : 0);
  rig.bottlePivot.position.lerpVectors(rig.idleBottle, rig.pourBottle, rig.kind === "feed" ? lift : 0);
  // With the spout along +X, Z rotation tips it down toward the soil.
  rig.canPivot.rotation.set(-0.08 * tilt, 0, THREE.MathUtils.lerp(0.08, -0.58, tilt));
  rig.bottlePivot.rotation.set(0.05 * tilt, 0, THREE.MathUtils.lerp(0, 0.92, tilt));

  if (active) {
    rig.canPivot.updateMatrixWorld(true);
    rig.bottlePivot.updateMatrixWorld(true);
    rig.dripLine.updateMatrixWorld(true);
    if (pour) {
      rig.stream.visible = true;
      alignStream(rig);
      rig.streamMaterial.opacity = 0.62 + Math.sin(now * 0.025) * 0.08;
      rig.splash.material.opacity = 0.52 + Math.sin(now * 0.018) * 0.18;
      if (rig.soil?.material?.color) {
        rig.soil.material.color.lerp(rig.kind === "water" ? WET_WATER : WET_FEED, 0.06);
        rig.soil.material.roughness = Math.max(0.72, (rig.soil.material.roughness ?? 1) - 0.012);
        rig.wetUntil = now + 2600;
      }
    } else {
      rig.stream.visible = false;
      rig.streamMaterial.opacity = 0;
      rig.splash.material.opacity = Math.max(0, rig.splash.material.opacity - 0.08);
    }
    if (now >= rig.until) {
      rig.kind = null;
      rig.source = null;
      rig.streamMaterial.opacity = 0;
      rig.stream.visible = false;
      rig.splash.material.opacity = 0;
      rig.bottlePivot.visible = false;
      setIrrigationVisibility(rig, irrigationLevel);
      return true;
    }
  } else {
    const autoPulse = rig.autoWater && irrigationLevel >= 5 && (now % 7000) < 520;
    if (autoPulse) {
      rig.source = rig.dripTip;
      rig.dripLine.updateMatrixWorld(true);
      rig.stream.visible = true;
      rig.streamMaterial.color.setHex(WATER);
      rig.streamMaterial.opacity = 0.24;
      alignStream(rig);
      rig.splash.material.color.setHex(WATER);
      rig.splash.material.opacity = 0.16;
    } else if (!rig.kind) {
      rig.stream.visible = false;
      rig.streamMaterial.opacity = 0;
      rig.source = null;
    }
    rig.splash.material.opacity = Math.max(0, rig.splash.material.opacity - 0.035);
  }
  if (!active && now > rig.wetUntil && rig.soilBaseColor && rig.soil?.material?.color) {
    rig.soil.material.color.lerp(rig.soilBaseColor, 0.025);
    rig.soil.material.roughness += (rig.soilBaseRoughness - rig.soil.material.roughness) * 0.025;
  }
  return false;
}

export function disposeCareRig(rig) {
  [rig.stream, rig.splash, rig.droplets.points].forEach((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  rig.dripLine.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  rig.reservoir.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
}
