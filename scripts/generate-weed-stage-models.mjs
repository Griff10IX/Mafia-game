import fs from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = `data:${blob.type};base64,${Buffer.from(value).toString("base64")}`;
      this.onloadend?.();
    });
  }
};

const OUT = new URL("../public/models/weed/", import.meta.url);
const green = new THREE.MeshStandardMaterial({ name: "Leaves", color: 0x2f7d32, roughness: 0.48, side: THREE.DoubleSide });
const young = new THREE.MeshStandardMaterial({ name: "YoungLeaves", color: 0x62a946, roughness: 0.5, side: THREE.DoubleSide });
const stem = new THREE.MeshStandardMaterial({ name: "Stem", color: 0x47733a, roughness: 0.72 });
const bud = new THREE.MeshStandardMaterial({ name: "Buds", color: 0x4b843d, roughness: 0.36 });
const pistil = new THREE.MeshStandardMaterial({ name: "Pistils", color: 0xd9832f, roughness: 0.55 });
const bladeCache = new Map();
const budGeometryCache = new Map();
const pistilGeometryCache = new Map();

function bladeGeometry(length = 0.28, width = 0.065) {
  const key = `${length.toFixed(4)}:${width.toFixed(4)}`;
  if (bladeCache.has(key)) return bladeCache.get(key);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(width * 0.72, length * 0.18, width, length * 0.47, 0, length);
  shape.bezierCurveTo(-width, length * 0.47, -width * 0.72, length * 0.18, 0, 0);
  const geometry = new THREE.ShapeGeometry(shape, 6);
  geometry.rotateX(-Math.PI / 2);
  bladeCache.set(key, geometry);
  return geometry;
}

function fanLeaf(size, material = green, fingers = 7) {
  const group = new THREE.Group();
  group.name = "FanLeaf";
  const angles = fingers === 5 ? [-0.9, -0.42, 0, 0.42, 0.9] : [-1.12, -0.76, -0.38, 0, 0.38, 0.76, 1.12];
  for (const angle of angles) {
    const center = 1 - Math.abs(angle) * 0.22;
    const blade = new THREE.Mesh(bladeGeometry(size * center, size * 0.19 * center), material);
    blade.rotation.y = -angle;
    blade.rotation.x = -0.08 + Math.abs(angle) * 0.07;
    blade.position.set(Math.sin(angle) * size * 0.045, 0, Math.cos(angle) * size * 0.035);
    blade.name = "LeafBlade";
    group.add(blade);
  }
  const petiole = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.012, size * 0.018, size * 0.22, 7), stem);
  petiole.rotation.x = Math.PI / 2;
  petiole.position.z = -size * 0.1;
  group.add(petiole);
  return group;
}

function branch(parent, from, to, radius = 0.012) {
  const delta = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.65, radius, delta.length(), 7), stem);
  mesh.position.copy(from).addScaledVector(delta, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  mesh.name = "Branch";
  parent.add(mesh);
}

function addWhorl(root, y, radius, leafSize, count, phase, budScaleFactor = 0) {
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    const end = new THREE.Vector3(Math.cos(a) * radius, y + radius * 0.28, Math.sin(a) * radius);
    branch(root, new THREE.Vector3(0, y - 0.04, 0), end, 0.012 + y * 0.004);
    const leaf = fanLeaf(leafSize, green, leafSize < 0.2 ? 5 : 7);
    leaf.position.copy(end);
    leaf.rotation.y = -a + Math.PI;
    leaf.rotation.z = -0.08;
    root.add(leaf);
    if (budScaleFactor > 0) {
      addCola(root, end.clone().add(new THREE.Vector3(0, 0.035, 0)), leafSize * budScaleFactor);
    }
  }
}

function addCola(root, position, scale) {
  const cola = new THREE.Group();
  cola.name = "BudCluster";
  cola.position.copy(position);
  const layers = 5;
  for (let layer = 0; layer < layers; layer++) {
    const taper = 0.56 + Math.sin(((layer + 0.5) / layers) * Math.PI) * 0.44;
    const units = layer === layers - 1 ? 2 : 3;
    for (let unit = 0; unit < units; unit++) {
      const a = (unit / units) * Math.PI * 2 + layer * 0.82;
      const budKey = `${scale.toFixed(4)}:${layer}:${unit === 0 ? 0 : 1}`;
      if (!budGeometryCache.has(budKey)) {
        budGeometryCache.set(budKey, new THREE.DodecahedronGeometry(scale * 0.14 * taper, 0));
      }
      const calyx = new THREE.Mesh(budGeometryCache.get(budKey), bud);
      calyx.scale.set(0.78, 1.32, 0.78);
      calyx.position.set(
        Math.cos(a) * scale * 0.1 * taper,
        layer * scale * 0.16,
        Math.sin(a) * scale * 0.1 * taper
      );
      calyx.rotation.set((unit - 1) * 0.12, -a, Math.cos(a) * 0.18);
      calyx.name = "BudCalyx";
      cola.add(calyx);

      if ((layer + unit) % 3 === 0) {
        const pistilKey = scale.toFixed(4);
        if (!pistilGeometryCache.has(pistilKey)) {
          pistilGeometryCache.set(
            pistilKey,
            new THREE.CylinderGeometry(scale * 0.009, scale * 0.003, scale * 0.17, 5)
          );
        }
        const hair = new THREE.Mesh(pistilGeometryCache.get(pistilKey), pistil);
        hair.position.set(
          Math.cos(a) * scale * 0.18,
          layer * scale * 0.16 + scale * 0.025,
          Math.sin(a) * scale * 0.18
        );
        hair.rotation.set(Math.sin(a) * 0.9, a, Math.cos(a) * 0.9);
        hair.name = "Pistil";
        cola.add(hair);
      }
    }
  }
  for (let i = 0; i < 3; i++) {
    const sugarLeaf = fanLeaf(scale * 0.52, green, 3);
    sugarLeaf.name = "SugarLeaf";
    sugarLeaf.position.set(0, scale * (0.2 + i * 0.12), 0);
    sugarLeaf.rotation.set(-0.25, (i / 3) * Math.PI * 2, i % 2 ? 0.55 : -0.55);
    cola.add(sugarLeaf);
  }
  root.add(cola);
}

function buildStage(stage) {
  const root = new THREE.Group();
  root.name = `Cannabis_${stage}`;
  const configs = {
    seedling: { height: 0.3, whorls: 1, radius: 0.08, size: 0.13, count: 2 },
    veg: { height: 0.78, whorls: 5, radius: 0.18, size: 0.27, count: 4 },
    flower: { height: 0.98, whorls: 6, radius: 0.23, size: 0.29, count: 5 },
    harvest: { height: 1.05, whorls: 7, radius: 0.25, size: 0.3, count: 5 },
  };
  const cfg = configs[stage];
  branch(root, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, cfg.height, 0), stage === "seedling" ? 0.011 : 0.025);

  if (stage === "seedling") {
    for (const side of [-1, 1]) {
      const cotyledon = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), young);
      cotyledon.scale.set(1.2, 0.16, 0.65);
      cotyledon.position.set(side * 0.05, 0.16, 0);
      root.add(cotyledon);
    }
    const first = fanLeaf(0.14, young, 5);
    first.position.y = 0.25;
    root.add(first);
  } else {
    for (let i = 0; i < cfg.whorls; i++) {
      const f = i / Math.max(1, cfg.whorls - 1);
      const taper = 0.72 + Math.sin(f * Math.PI) * 0.32;
      const budScaleFactor =
        stage === "veg" || f < 0.28
          ? 0
          : (stage === "harvest" ? 0.24 : 0.17) * (0.72 + f * 0.28);
      addWhorl(
        root,
        0.18 + f * cfg.height * 0.67,
        cfg.radius * taper,
        cfg.size * taper,
        cfg.count,
        i * 0.55,
        budScaleFactor
      );
    }
    const top = fanLeaf(cfg.size * 0.76, green, 7);
    top.position.y = cfg.height;
    root.add(top);
    if (stage !== "veg") {
      addCola(root, new THREE.Vector3(0, cfg.height * 0.92, 0), stage === "harvest" ? 0.115 : 0.078);
    }
  }

  root.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return root;
}

async function exportStage(stage, fileName) {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(buildStage(stage), { binary: true, onlyVisible: true });
  await fs.writeFile(new URL(fileName, OUT), Buffer.from(result));
}

await fs.mkdir(OUT, { recursive: true });
await Promise.all([
  exportStage("seedling", "plant-seedling.glb"),
  exportStage("veg", "plant-veg.glb"),
  exportStage("flower", "plant-flower.glb"),
  exportStage("harvest", "plant-harvest.glb"),
]);
