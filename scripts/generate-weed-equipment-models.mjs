import fs from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const materials = {
  terracotta: material("Terracotta", 0xb85f36, 0.82),
  terracottaDark: material("TerracottaDark", 0x783a25, 0.9),
  fabric: material("FabricCharcoal", 0x292b2d, 0.96),
  fabricEdge: material("FabricEdge", 0x17191a, 0.94),
  saucer: material("Saucer", 0x4b4e50, 0.86),
  airPot: material("AirPot", 0x202426, 0.84),
  airHole: material("AirPotHoles", 0x070808, 1),
  hydro: material("HydroTub", 0x363c40, 0.78),
  reservoir: material("Reservoir", 0xe1e4df, 0.68),
  water: material("WaterIndicator", 0x3ba9cf, 0.32, 0.25),
  tube: material("IrrigationTube", 0x202b31, 0.72),
  soil: material("Soil", 0x302016, 1),
  fanBody: material("FanHousing", 0xd9d9d2, 0.6),
  fanDark: material("FanHardware", 0x34383b, 0.72),
  fanBlade: material("FanBlades", 0x7eaaa7, 0.52),
  fanAccent: material("FanAccent", 0xd28b32, 0.58),
};

function material(name, color, roughness, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({ name, color, roughness, metalness });
}

function mesh(parent, geometry, surface, name, position = [0, 0, 0]) {
  const result = new THREE.Mesh(geometry, surface);
  result.name = name;
  result.position.set(...position);
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

function cylinderBetween(parent, from, to, radius, surface, name, radialSegments = 8) {
  const delta = to.clone().sub(from);
  const result = mesh(
    parent,
    new THREE.CylinderGeometry(radius, radius, delta.length(), radialSegments),
    surface,
    name
  );
  result.position.copy(from).addScaledVector(delta, 0.5);
  result.quaternion.setFromUnitVectors(Y_AXIS, delta.clone().normalize());
  return result;
}

function potRoot(name, dimensions) {
  const root = new THREE.Group();
  root.name = name;
  root.userData = {
    units: "meters",
    upAxis: "Y",
    soilOrigin: "Root X=0, Y=0, Z=0 is the soil center",
    nominalDimensions: dimensions,
  };
  return root;
}

function addSoil(parent, radius, y = -0.006, segments = 16) {
  const soil = mesh(parent, new THREE.CylinderGeometry(radius, radius, 0.018, segments), materials.soil, "soil", [0, y, 0]);
  return soil;
}

function buildTerracottaPot() {
  const root = potRoot("potTier1StarterTerracotta", "0.480 W x 0.398 H x 0.480 D");
  mesh(root, new THREE.CylinderGeometry(0.19, 0.145, 0.34, 16, 1, true), materials.terracotta, "terracottaBowl", [0, -0.17, 0]);
  mesh(root, new THREE.CylinderGeometry(0.215, 0.205, 0.07, 16, 1, true), materials.terracotta, "rolledRim", [0, -0.015, 0]);
  mesh(root, new THREE.CylinderGeometry(0.145, 0.145, 0.018, 16), materials.terracottaDark, "potBase", [0, -0.348, 0]);
  mesh(root, new THREE.CylinderGeometry(0.24, 0.24, 0.025, 16), materials.terracottaDark, "drainageSaucer", [0, -0.365, 0]);
  addSoil(root, 0.186);
  return root;
}

function buildFabricPot() {
  const root = potRoot("potTier2FabricGrowBag", "0.530 W x 0.530 H x 0.520 D");
  mesh(root, new THREE.CylinderGeometry(0.24, 0.215, 0.4, 12, 1, true), materials.fabric, "fabricBag", [0, -0.2, 0]);
  mesh(root, new THREE.TorusGeometry(0.237, 0.014, 6, 12), materials.fabricEdge, "stitchedRim", [0, -0.008, 0]).rotation.x = Math.PI / 2;
  mesh(root, new THREE.CylinderGeometry(0.26, 0.26, 0.025, 16), materials.saucer, "wideSaucer", [0, -0.425, 0]);
  addSoil(root, 0.224);

  for (const side of [-1, 1]) {
    const handle = new THREE.Group();
    handle.name = side < 0 ? "leftHandle" : "rightHandle";
    const x = side * 0.247;
    cylinderBetween(handle, new THREE.Vector3(x, -0.2, -0.115), new THREE.Vector3(x, 0.075, -0.115), 0.018, materials.fabricEdge, "handleRear");
    cylinderBetween(handle, new THREE.Vector3(x, 0.075, -0.115), new THREE.Vector3(x, 0.075, 0.115), 0.018, materials.fabricEdge, "handleGrip");
    cylinderBetween(handle, new THREE.Vector3(x, 0.075, 0.115), new THREE.Vector3(x, -0.2, 0.115), 0.018, materials.fabricEdge, "handleFront");
    root.add(handle);
  }
  return root;
}

function buildAirPot() {
  const root = potRoot("potTier3PerforatedAirPot", "0.554 W x 0.426 H x 0.554 D");
  mesh(root, new THREE.CylinderGeometry(0.245, 0.215, 0.4, 16, 1, true), materials.airPot, "airPotBody", [0, -0.2, 0]);
  mesh(root, new THREE.TorusGeometry(0.246, 0.015, 6, 16), materials.airPot, "airPotRim", [0, -0.005, 0]).rotation.x = Math.PI / 2;
  mesh(root, new THREE.CylinderGeometry(0.215, 0.215, 0.02, 16), materials.airPot, "ventedBase", [0, -0.408, 0]);
  addSoil(root, 0.23);

  const coneGeometries = [];
  const holeGeometries = [];
  for (let row = 0; row < 4; row++) {
    const y = -0.075 - row * 0.09;
    const radius = 0.245 - row * 0.006;
    for (let column = 0; column < 12; column++) {
      const angle = ((column + (row % 2) * 0.5) / 12) * Math.PI * 2;
      const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const coneTransform = new THREE.Object3D();
      coneTransform.position.set(outward.x * (radius + 0.012), y, outward.z * (radius + 0.012));
      coneTransform.quaternion.setFromUnitVectors(Y_AXIS, outward);
      coneTransform.updateMatrix();
      coneGeometries.push(
        new THREE.CylinderGeometry(0.026, 0.039, 0.035, 6, 1, true).applyMatrix4(coneTransform.matrix)
      );

      const holeTransform = new THREE.Object3D();
      holeTransform.position.set(outward.x * (radius + 0.032), y, outward.z * (radius + 0.032));
      holeTransform.quaternion.setFromUnitVectors(Z_AXIS, outward);
      holeTransform.updateMatrix();
      holeGeometries.push(new THREE.CircleGeometry(0.019, 8).applyMatrix4(holeTransform.matrix));
    }
  }
  mesh(root, mergeGeometries(coneGeometries), materials.airPot, "aerationCones");
  mesh(root, mergeGeometries(holeGeometries), materials.airHole, "aerationHole");
  return root;
}

function buildHydroPot() {
  const root = potRoot("potTier4HydroAutopot", "0.800 W x 0.595 H x 0.515 D");
  mesh(root, new THREE.BoxGeometry(0.45, 0.09, 0.49), materials.hydro, "autopotTray", [0, -0.39, 0]);
  mesh(root, new THREE.CylinderGeometry(0.205, 0.18, 0.37, 12, 1, true), materials.hydro, "hydroGrowPot", [0, -0.185, 0]);
  mesh(root, new THREE.TorusGeometry(0.205, 0.014, 6, 12), materials.hydro, "hydroPotRim", [0, -0.008, 0]).rotation.x = Math.PI / 2;
  addSoil(root, 0.19);

  mesh(root, new THREE.CylinderGeometry(0.18, 0.195, 0.54, 12), materials.reservoir, "nutrientReservoir", [0.38, -0.27, 0]);
  mesh(root, new THREE.CylinderGeometry(0.075, 0.075, 0.055, 12), materials.hydro, "reservoirCap", [0.38, 0.027, 0]);
  const gauge = mesh(root, new THREE.BoxGeometry(0.025, 0.36, 0.035), materials.water, "waterLevelIndicator", [0.558, -0.22, 0]);
  gauge.userData.indicates = "reservoir fill level";

  const tubePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.38, -0.49, 0.12),
    new THREE.Vector3(0.3, -0.5, 0.24),
    new THREE.Vector3(0.1, -0.43, 0.25),
    new THREE.Vector3(0.03, -0.38, 0.22),
  ]);
  mesh(root, new THREE.TubeGeometry(tubePath, 12, 0.012, 6, false), materials.tube, "feedTube");
  mesh(root, new THREE.BoxGeometry(0.1, 0.055, 0.12), materials.fanAccent, "floatValveIndicator", [0.12, -0.345, 0.13]);
  return root;
}

function fanBladeGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.025, 0);
  shape.bezierCurveTo(0.07, 0.025, 0.19, 0.06, 0.23, 0.13);
  shape.bezierCurveTo(0.15, 0.19, 0.07, 0.16, 0.025, 0.045);
  shape.lineTo(0.025, 0);
  return new THREE.ShapeGeometry(shape, 5);
}

function buildFan() {
  const root = new THREE.Group();
  root.name = "articulatedClipFan";
  root.userData = {
    units: "meters",
    upAxis: "Y",
    floorOrigin: "Root X=0, Y=0, Z=0 is centered beneath the stand",
    articulation: "Rotate head around local Y for oscillation; rotate bladeRotor around local Z for blade spin",
    nominalDimensions: "0.606 W x 1.173 H x 0.540 D",
  };

  const support = new THREE.Group();
  support.name = "support";
  root.add(support);
  mesh(support, new THREE.CylinderGeometry(0.24, 0.27, 0.055, 12), materials.fanDark, "standBase", [0, 0.028, 0]);
  mesh(support, new THREE.CylinderGeometry(0.055, 0.07, 0.7, 10), materials.fanBody, "standColumn", [0, 0.39, 0]);
  mesh(support, new THREE.BoxGeometry(0.22, 0.07, 0.11), materials.fanDark, "clipLowerJaw", [0, 0.12, 0.13]).rotation.x = -0.18;
  mesh(support, new THREE.BoxGeometry(0.22, 0.07, 0.11), materials.fanDark, "clipUpperJaw", [0, 0.22, 0.13]).rotation.x = 0.18;
  mesh(support, new THREE.CylinderGeometry(0.035, 0.035, 0.24, 8), materials.fanAccent, "clipHinge", [0, 0.17, 0.07]).rotation.z = Math.PI / 2;
  mesh(support, new THREE.SphereGeometry(0.085, 10, 8), materials.fanDark, "oscillationJoint", [0, 0.76, 0]);

  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 0.82, 0);
  head.userData.articulationAxis = "local Y";
  root.add(head);

  const housing = new THREE.Group();
  housing.name = "housing";
  head.add(housing);
  mesh(housing, new THREE.TorusGeometry(0.285, 0.018, 6, 20), materials.fanBody, "outerCageRing", [0, 0.05, 0.03]);
  mesh(housing, new THREE.TorusGeometry(0.09, 0.012, 6, 16), materials.fanBody, "innerCageRing", [0, 0.05, 0.045]);
  mesh(housing, new THREE.CylinderGeometry(0.1, 0.12, 0.18, 12), materials.fanDark, "motorHousing", [0, 0.05, -0.09]).rotation.x = Math.PI / 2;
  for (let spoke = 0; spoke < 10; spoke++) {
    const angle = (spoke / 10) * Math.PI * 2;
    cylinderBetween(
      housing,
      new THREE.Vector3(Math.cos(angle) * 0.09, 0.05 + Math.sin(angle) * 0.09, 0.04),
      new THREE.Vector3(Math.cos(angle) * 0.275, 0.05 + Math.sin(angle) * 0.275, 0.035),
      0.006,
      materials.fanBody,
      "cageSpoke",
      5
    );
  }

  const bladeRotor = new THREE.Group();
  bladeRotor.name = "bladeRotor";
  bladeRotor.position.set(0, 0.05, 0.055);
  bladeRotor.userData.articulationAxis = "local Z";
  head.add(bladeRotor);
  mesh(bladeRotor, new THREE.CylinderGeometry(0.048, 0.048, 0.045, 12), materials.fanAccent, "rotorHub").rotation.x = Math.PI / 2;
  for (let index = 0; index < 4; index++) {
    const blade = mesh(bladeRotor, fanBladeGeometry(), materials.fanBlade, "fanBlade");
    blade.rotation.z = index * Math.PI / 2;
  }
  return root;
}

const assets = [
  { file: "pot.glb", build: buildTerracottaPot, requiredNodes: ["potTier1StarterTerracotta", "soil"] },
  { file: "pot-fabric-grow-bag.glb", build: buildFabricPot, requiredNodes: ["potTier2FabricGrowBag", "soil", "leftHandle", "rightHandle", "wideSaucer"] },
  { file: "pot-air-perforated.glb", build: buildAirPot, requiredNodes: ["potTier3PerforatedAirPot", "soil", "aerationHole"] },
  { file: "pot-hydro-autopot.glb", build: buildHydroPot, requiredNodes: ["potTier4HydroAutopot", "soil", "nutrientReservoir", "feedTube", "waterLevelIndicator"] },
  { file: "clip-fan.glb", build: buildFan, requiredNodes: ["articulatedClipFan", "housing", "head", "bladeRotor", "support", "clipLowerJaw"] },
];

function parseGlb(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "glTF") throw new Error("Missing glTF magic header");
  if (buffer.readUInt32LE(4) !== 2) throw new Error("GLB is not glTF 2.0");
  if (buffer.readUInt32LE(8) !== buffer.length) throw new Error("GLB header length does not match file size");
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.toString("ascii", 16, 20) !== "JSON") throw new Error("First GLB chunk is not JSON");
  return JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());
}

async function exportAndValidate(asset) {
  const model = asset.build();
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(model, {
    binary: true,
    onlyVisible: true,
    includeCustomExtensions: false,
    trs: true,
  });
  const buffer = Buffer.from(result);
  await fs.writeFile(new URL(asset.file, OUT), buffer);

  const gltf = parseGlb(buffer);
  const nodeNames = new Set((gltf.nodes ?? []).map((node) => node.name));
  for (const required of asset.requiredNodes) {
    if (!nodeNames.has(required)) throw new Error(`${asset.file}: missing required node "${required}"`);
  }
  if (JSON.stringify(gltf).includes("KHR_draco_mesh_compression")) {
    throw new Error(`${asset.file}: unexpected Draco compression`);
  }
  if (!gltf.buffers?.length || !gltf.meshes?.length || !gltf.materials?.length) {
    throw new Error(`${asset.file}: missing embedded buffers, meshes, or materials`);
  }
  return {
    file: asset.file,
    bytes: buffer.length,
    nodes: gltf.nodes.length,
    meshes: gltf.meshes.length,
    materials: gltf.materials.length,
    dimensions: size.toArray().map((value) => value.toFixed(3)).join(" x "),
  };
}

await fs.mkdir(OUT, { recursive: true });
const reports = [];
for (const asset of assets) reports.push(await exportAndValidate(asset));

console.log("Generated and validated binary glTF 2.0 assets (dimensions W x H x D in meters):");
for (const report of reports) {
  console.log(
    `- ${report.file}: ${report.bytes} bytes; ${report.nodes} nodes; ${report.meshes} meshes; ` +
      `${report.materials} materials; ${report.dimensions}; embedded buffers; no Draco`
  );
}
