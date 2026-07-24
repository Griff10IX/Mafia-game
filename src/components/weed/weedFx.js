import * as THREE from "three";

const WATER = 0x66cfff;
const FEED = 0xaed548;

function anchor(parent, name, position) {
  const point = new THREE.Object3D();
  point.name = name;
  point.position.set(...position);
  parent.add(point);
  return point;
}

function makeStream() {
  const material = new THREE.MeshBasicMaterial({
    color: WATER,
    transparent: true,
    opacity: 0,
    depthWrite: false,
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
  canPivot.position.set(-0.58, 0.02, 0.2);
  wateringCan.scale.setScalar(0.95);
  wateringCan.rotation.y = -Math.PI / 2;
  canPivot.add(wateringCan);
  const canTip = anchor(wateringCan, "pourTip", [0.24, 0.22, 0]);
  growZone.add(canPivot);

  const bottlePivot = new THREE.Group();
  bottlePivot.name = "nutrientBottlePivot";
  bottlePivot.position.set(0.5, 0.03, 0.22);
  nutrientBottle.scale.setScalar(0.8);
  bottlePivot.add(nutrientBottle);
  const bottleTip = anchor(nutrientBottle, "doseTip", [0, 0.35, 0]);
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
    soil,
    stream,
    streamMaterial,
    splash,
    droplets,
    kind: null,
    until: 0,
    source: null,
    targetPosition: new THREE.Vector3(),
    idleCan: new THREE.Vector3(-0.58, 0.02, 0.2),
    pourCan: new THREE.Vector3(-0.42, 0.55, 0.12),
    idleBottle: new THREE.Vector3(0.5, 0.03, 0.22),
    pourBottle: new THREE.Vector3(0.34, 0.56, 0.16),
  };
}

export function setIrrigationVisibility(rig, level) {
  const owned = level >= 1;
  rig.canPivot.visible = owned && level < 4 && rig.kind !== "feed";
  rig.dripLine.visible = level >= 4;
  if (!rig.kind) rig.bottlePivot.visible = false;
}

export function startCareFx(rig, kind, irrigationLevel = 0, duration = 1650) {
  if (kind !== "water" && kind !== "feed") return false;
  rig.kind = kind;
  rig.until = performance.now() + duration;
  const color = kind === "water" ? WATER : FEED;
  rig.streamMaterial.color.setHex(color);
  rig.droplets.points.material.color.setHex(color);
  rig.splash.material.color.setHex(color);
  rig.splash.material.opacity = 0.82;
  rig.stream.visible = true;
  rig.streamMaterial.opacity = 0.72;

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
  rig.stream.scale.set(1, length, 1);
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

export function updateCareFx(rig, now, irrigationLevel = 0) {
  const active = rig.kind === "water" || rig.kind === "feed";
  const canTarget = rig.kind === "water" && irrigationLevel < 4 ? rig.pourCan : rig.idleCan;
  const bottleTarget = rig.kind === "feed" ? rig.pourBottle : rig.idleBottle;
  rig.canPivot.position.lerp(canTarget, 0.1);
  rig.bottlePivot.position.lerp(bottleTarget, 0.1);
  const canRotation = rig.kind === "water" && irrigationLevel < 4 ? -0.62 : 0.12;
  const bottleRotation = rig.kind === "feed" ? 1.05 : 0;
  rig.canPivot.rotation.z += (canRotation - rig.canPivot.rotation.z) * 0.1;
  rig.bottlePivot.rotation.z += (bottleRotation - rig.bottlePivot.rotation.z) * 0.1;

  if (active) {
    rig.canPivot.updateMatrixWorld(true);
    rig.bottlePivot.updateMatrixWorld(true);
    rig.dripLine.updateMatrixWorld(true);
    alignStream(rig);
    rig.streamMaterial.opacity = 0.68 + Math.sin(now * 0.025) * 0.1;
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
    rig.splash.material.opacity = Math.max(0, rig.splash.material.opacity - 0.035);
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
}
