import * as THREE from "three";
import { getBudPhenotype } from "./weedPhenotypes";

const FALLBACK_GREEN = 0x3f7938;
const FALLBACK_BUD = 0x739a68;
const STEEL = 0xb8bec4;
const HANDLE = 0x243029;
const TRAY = 0x242728;

function mesh(geometry, material, name) {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  object.castShadow = true;
  return object;
}

function makeShears() {
  const root = new THREE.Group();
  root.name = "harvestShears";
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: STEEL,
    roughness: 0.24,
    metalness: 0.82,
    side: THREE.DoubleSide,
  });
  const handleMaterial = new THREE.MeshStandardMaterial({ color: HANDLE, roughness: 0.58 });
  const bladeGeometry = new THREE.ConeGeometry(0.045, 0.42, 4);
  bladeGeometry.rotateZ(Math.PI / 2);

  const upperBlade = mesh(bladeGeometry, bladeMaterial, "upperTrimBlade");
  upperBlade.position.x = -0.2;
  upperBlade.rotation.x = Math.PI / 4;
  const lowerBlade = mesh(bladeGeometry, bladeMaterial.clone(), "lowerTrimBlade");
  lowerBlade.position.x = -0.2;
  lowerBlade.rotation.x = Math.PI / 4;
  root.add(upperBlade, lowerBlade);

  const hinge = mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.055, 14),
    new THREE.MeshStandardMaterial({ color: 0xd89f32, roughness: 0.3, metalness: 0.72 }),
    "shearHinge"
  );
  hinge.rotation.x = Math.PI / 2;
  root.add(hinge);

  for (const side of [-1, 1]) {
    const handle = mesh(new THREE.TorusGeometry(0.085, 0.018, 8, 20), handleMaterial, "shearHandle");
    handle.scale.set(1.35, 0.72, 1);
    handle.position.set(0.14, side * 0.085, 0);
    root.add(handle);
  }
  root.scale.setScalar(0.72);
  root.rotation.set(0.08, -0.18, 0.08);
  root.userData.upperBlade = upperBlade;
  root.userData.lowerBlade = lowerBlade;
  return root;
}

function makeTray() {
  const root = new THREE.Group();
  root.name = "trimTray";
  const trayMaterial = new THREE.MeshStandardMaterial({ color: TRAY, roughness: 0.52, metalness: 0.25 });
  const base = mesh(new THREE.BoxGeometry(0.7, 0.035, 0.42), trayMaterial, "trimTrayBase");
  root.add(base);
  const rimGeometryX = new THREE.BoxGeometry(0.74, 0.07, 0.025);
  const rimGeometryZ = new THREE.BoxGeometry(0.025, 0.07, 0.42);
  for (const z of [-0.21, 0.21]) {
    const rim = mesh(rimGeometryX, trayMaterial, "trimTrayRim");
    rim.position.set(0, 0.045, z);
    root.add(rim);
  }
  for (const x of [-0.36, 0.36]) {
    const rim = mesh(rimGeometryZ, trayMaterial, "trimTrayRim");
    rim.position.set(x, 0.045, 0);
    root.add(rim);
  }
  root.position.set(0.55, 0.075, 0.34);
  return root;
}

function makeDrops(count, geometry, material, name) {
  const drops = new THREE.InstancedMesh(geometry, material, count);
  drops.name = name;
  drops.castShadow = true;
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return drops;
}

function resetInstances(meshObject, count) {
  const matrix = new THREE.Matrix4();
  const zero = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < count; i++) {
    matrix.compose(zero, new THREE.Quaternion(), zero);
    meshObject.setMatrixAt(i, matrix);
  }
  meshObject.instanceMatrix.needsUpdate = true;
}

function localPosition(root, object, fallback) {
  if (!object) return fallback.clone();
  const position = new THREE.Vector3();
  object.getWorldPosition(position);
  return root.worldToLocal(position);
}

function trayPileTarget(index, count, { bud = false } = {}) {
  // Tray sits at local (0.55, 0.075, 0.34); pile into a visible mound on the bed.
  const cx = 0.55;
  const cz = 0.34;
  const angle = (index / Math.max(1, count)) * Math.PI * 2 + (bud ? 0.35 : 0.1);
  const ring = Math.floor(index / 5);
  const radius = (bud ? 0.05 : 0.07) + ring * (bud ? 0.045 : 0.05) + (index % 3) * 0.012;
  const stack = Math.floor(index / 3);
  const y = 0.11 + stack * (bud ? 0.028 : 0.016) + (index % 2) * 0.008;
  return new THREE.Vector3(
    cx + Math.cos(angle) * radius * (bud ? 0.85 : 1.05),
    y,
    cz + Math.sin(angle) * radius * 0.72
  );
}

function applyHarvestPhenotype(rig, phenotypeKey) {
  const preset = getBudPhenotype(phenotypeKey);
  rig.phenotypeKey = phenotypeKey || "dense";
  if (rig.buds?.material?.color) {
    rig.buds.material.color.setHex(preset.bud ?? FALLBACK_BUD);
    if (rig.buds.material.emissive) {
      rig.buds.material.emissive.setHex(preset.emissive ?? 0x000000);
      rig.buds.material.emissiveIntensity = phenotypeKey === "purple" || phenotypeKey === "frosty" ? 0.12 : 0.04;
    }
    rig.buds.material.roughness = phenotypeKey === "frosty" ? 0.28 : 0.34;
    rig.buds.material.needsUpdate = true;
  }
  if (rig.trimmings?.material?.color) {
    rig.trimmings.material.color.setHex(preset.leaf ?? FALLBACK_GREEN);
    rig.trimmings.material.needsUpdate = true;
  }
}

function populateDrops(rig, plant) {
  plant.updateMatrixWorld(true);
  rig.root.updateMatrixWorld(true);
  const buds = [];
  const leaves = [];
  plant.traverse((object) => {
    if (object.name === "BudCluster") buds.push(object);
    else if (object.name === "FanLeaf" || object.name === "SugarLeaf") leaves.push(object);
  });
  rig.cutNodes = [...buds, ...leaves.filter((_, index) => index % 2 === 0)];
  rig.cutNodes.forEach((node) => {
    node.userData.harvestWasVisible = node.visible;
  });

  const fallback = new THREE.Vector3(0, 0.85, 0);
  rig.budDrops = Array.from({ length: rig.budCount }, (_, index) => ({
    source: localPosition(rig.root, buds[index % Math.max(1, buds.length)], fallback),
    target: trayPileTarget(index, rig.budCount, { bud: true }),
    delay: 0.12 + index * 0.038,
    spin: 1.8 + index * 0.37,
  }));
  rig.trimDrops = Array.from({ length: rig.trimCount }, (_, index) => ({
    source: localPosition(rig.root, leaves[index % Math.max(1, leaves.length)], fallback),
    target: trayPileTarget(index, rig.trimCount, { bud: false }),
    delay: 0.08 + index * 0.022,
    spin: 2.4 + index * 0.51,
  }));
}

export function createHarvestRig(growZone, mobileLod) {
  const root = new THREE.Group();
  root.name = "harvestFx";
  root.visible = false;
  growZone.add(root);
  const shears = makeShears();
  const tray = makeTray();
  root.add(shears, tray);

  const budCount = mobileLod ? 10 : 16;
  const trimCount = mobileLod ? 14 : 24;
  const buds = makeDrops(
    budCount,
    new THREE.DodecahedronGeometry(0.042, 0),
    new THREE.MeshStandardMaterial({
      color: FALLBACK_BUD,
      roughness: 0.34,
      emissive: 0x000000,
      emissiveIntensity: 0.04,
    }),
    "harvestBudDrops"
  );
  const trimmings = makeDrops(
    trimCount,
    new THREE.TetrahedronGeometry(0.026, 0),
    new THREE.MeshStandardMaterial({ color: FALLBACK_GREEN, roughness: 0.52, side: THREE.DoubleSide }),
    "harvestLeafTrimmings"
  );
  root.add(buds, trimmings);
  resetInstances(buds, budCount);
  resetInstances(trimmings, trimCount);

  return {
    root,
    shears,
    tray,
    buds,
    trimmings,
    budCount,
    trimCount,
    budDrops: [],
    trimDrops: [],
    cutNodes: [],
    plant: null,
    phenotypeKey: "dense",
    active: false,
    startedAt: 0,
    duration: 4200,
  };
}

export function startHarvestFx(rig, plant, duration = 4200, phenotypeKey = "dense") {
  if (!rig || !plant || rig.active) return false;
  rig.active = true;
  rig.startedAt = performance.now();
  rig.duration = duration;
  rig.plant = plant;
  rig.root.visible = true;
  rig.shears.visible = true;
  rig.tray.visible = true;
  rig.buds.visible = true;
  rig.trimmings.visible = true;
  rig.shears.position.set(1.15, 1.25, 0.28);
  plant.visible = true;
  applyHarvestPhenotype(rig, phenotypeKey);
  populateDrops(rig, plant);
  resetInstances(rig.buds, rig.budCount);
  resetInstances(rig.trimmings, rig.trimCount);
  return true;
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function updateDrops(meshObject, drops, phase, scale) {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const rotation = new THREE.Euler();
  const size = new THREE.Vector3();
  drops.forEach((drop, index) => {
    const travel = THREE.MathUtils.clamp((phase - drop.delay) / 0.24, 0, 1);
    const ease = travel * travel * (3 - 2 * travel);
    if (travel <= 0) {
      size.setScalar(0);
      position.copy(drop.source);
      quaternion.identity();
    } else {
      position.lerpVectors(drop.source, drop.target, ease);
      // Arc only while in flight; settle flat on the tray pile.
      position.y += Math.sin(ease * Math.PI) * 0.16 * (1 - ease);
      rotation.set(ease * drop.spin, ease * drop.spin * 0.7, ease * drop.spin * 0.45);
      quaternion.setFromEuler(rotation);
      // Grow to full size and stay — visible mound build-up.
      const landScale = scale * (0.55 + 0.55 * ease);
      size.setScalar(landScale);
    }
    matrix.compose(position, quaternion, size);
    meshObject.setMatrixAt(index, matrix);
  });
  meshObject.instanceMatrix.needsUpdate = true;
}

export function updateHarvestFx(rig, now) {
  if (!rig?.active) return false;
  const phase = THREE.MathUtils.clamp((now - rig.startedAt) / rig.duration, 0, 1);
  const cutCenters = [0.14, 0.3, 0.46];
  let nearestCut = 0;
  let nearestDistance = Infinity;
  cutCenters.forEach((center, index) => {
    const distance = Math.abs(phase - center);
    if (distance < nearestDistance) {
      nearestCut = index;
      nearestDistance = distance;
    }
  });
  const cutTargets = [
    new THREE.Vector3(0.38, 1.23, 0.12),
    new THREE.Vector3(0.36, 0.96, 0.1),
    new THREE.Vector3(0.3, 0.7, 0.08),
  ];
  const approach = smoothstep(0.01, 0.1, phase);
  const retreat = smoothstep(0.58, 0.7, phase);
  const target = cutTargets[nearestCut];
  rig.shears.position.lerpVectors(new THREE.Vector3(1.15, 1.25, 0.28), target, approach * (1 - retreat));
  rig.shears.position.x += Math.sin(phase * Math.PI * 16) * 0.018 * (1 - retreat);
  const snip = Math.max(0, Math.sin(((phase - cutCenters[nearestCut]) / 0.1 + 0.5) * Math.PI));
  rig.shears.userData.upperBlade.rotation.z = 0.28 * (1 - snip);
  rig.shears.userData.lowerBlade.rotation.z = -0.28 * (1 - snip);
  rig.shears.visible = phase < 0.78;

  const cutProgress = smoothstep(0.1, 0.55, phase);
  const hiddenCount = Math.floor(rig.cutNodes.length * cutProgress);
  rig.cutNodes.forEach((node, index) => {
    node.visible = index >= hiddenCount && node.userData.harvestWasVisible !== false;
  });
  updateDrops(rig.buds, rig.budDrops, phase, 1.05);
  updateDrops(rig.trimmings, rig.trimDrops, phase, 0.85);

  if (rig.plant) {
    const finish = smoothstep(0.58, 0.82, phase);
    rig.plant.rotation.z = finish * -0.34;
    rig.plant.position.y = finish * -0.2;
    rig.plant.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => {
        material.transparent = finish > 0;
        material.opacity = 1 - finish;
        material.depthWrite = finish < 0.55;
      });
    });
    if (finish >= 0.98) rig.plant.visible = false;
  }

  // Hold the piled tray in frame after the plant is gone.
  if (phase >= 1) {
    if (rig.plant) rig.plant.visible = false;
    rig.root.visible = false;
    rig.active = false;
    rig.plant = null;
    return true;
  }
  return false;
}

export function disposeHarvestRig(rig) {
  rig?.root?.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => material.dispose());
  });
  rig?.root?.parent?.remove(rig.root);
}
