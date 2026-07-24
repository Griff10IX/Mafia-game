import * as THREE from "three";
import { LIGHT_PRESETS } from "./weedPhenotypes";

const HOUSE_PRESETS = [
  { floor: 0x3a2c22, wall: 0x2b211a, accent: 0x60442d, fog: 0x19140f, camera: [0.12, 1.35, 3.25], look: [0, 0.78, 0] },
  { floor: 0x494947, wall: 0x363735, accent: 0x6b7068, fog: 0x1c1e1d, camera: [0.18, 1.45, 3.7], look: [0, 0.82, 0] },
  { floor: 0x5a4438, wall: 0xc7bfb3, accent: 0x5c3d35, fog: 0x302923, camera: [0.2, 1.5, 3.9], look: [0, 0.86, 0] },
  { floor: 0x505156, wall: 0x353b42, accent: 0x7b542e, fog: 0x15191f, camera: [0.28, 1.68, 4.45], look: [0, 0.92, 0] },
  { floor: 0x393b40, wall: 0x252a31, accent: 0x65717d, fog: 0x10141a, camera: [0.32, 1.82, 4.75], look: [0, 0.96, 0] },
];

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...options });
}

function box(parent, size, position, mat, name = "") {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...position);
  mesh.name = name;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildShell(tier, mobileLod) {
  const index = Math.max(0, Math.min(4, Number(tier) || 0));
  const preset = HOUSE_PRESETS[index];
  const shell = new THREE.Group();
  shell.name = "roomShell";
  shell.userData.preset = preset;
  const width = index >= 3 ? 6.5 : index === 0 ? 3.8 : 5;
  const height = index >= 3 ? 3.25 : 2.65;
  const depth = width * 0.76;
  const floorMat = material(preset.floor, { roughness: index >= 3 ? 0.72 : 0.92, metalness: index >= 3 ? 0.12 : 0.02 });
  const wallMat = material(preset.wall, { roughness: 0.9 });
  box(shell, [width, 0.08, depth], [0, -0.04, 0], floorMat, "floor");
  box(shell, [width, height, 0.08], [0, height / 2, -depth / 2], wallMat, "backWall");
  box(shell, [0.08, height, depth], [-width / 2, height / 2, 0], wallMat, "leftWall");

  if (index === 0) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 8), material(0x929398, { metalness: 0.65 }));
    rod.rotation.z = Math.PI / 2;
    rod.position.set(-1.05, 1.95, -0.92);
    shell.add(rod);
    if (!mobileLod) {
      [0x263347, 0x493021, 0x2b4934].forEach((color, i) => {
        box(shell, [0.22, 0.62 + i * 0.06, 0.05], [-1.42 + i * 0.3, 1.56, -0.91], material(color), "hangingClothes");
      });
    }
    box(shell, [0.75, 0.06, 0.34], [1.25, 1.55, -1.12], material(preset.accent), "closetShelf");
  } else if (index === 1) {
    const pipeMat = material(0x68706b, { roughness: 0.38, metalness: 0.55 });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.35, 10), pipeMat);
    pipe.position.set(-1.75, 1.18, -1.35);
    shell.add(pipe);
    box(shell, [0.58, 0.42, 0.42], [1.65, 0.21, -1.08], material(0xb9bab5, { metalness: 0.15 }), "utilitySink");
  } else if (index === 2) {
    box(shell, [0.98, 0.78, 0.07], [1.42, 1.62, -1.84], material(0x171719), "blackoutWindow");
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), material(0x57353e, { roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.006, 0.85);
    rug.receiveShadow = true;
    shell.add(rug);
  } else {
    const beamMat = material(index === 3 ? 0x54575c : 0x68727b, { metalness: 0.68, roughness: 0.38 });
    box(shell, [width * 0.82, 0.12, 0.14], [0, 2.86, -0.55], beamMat, "industrialBeam");
    if (!mobileLod) {
      for (let i = 0; i < 3; i++) {
        box(shell, [1.18, 0.05, 0.42], [-2.05, 0.42 + i * 0.48, -1.4], beamMat, "storageRack");
      }
      if (index === 4) {
        for (const x of [-2.5, 2.5]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.7, 8), beamMat);
          post.position.set(x, 1.35, -1.6);
          shell.add(post);
        }
      }
    }
  }
  return shell;
}

function buildTent() {
  const tent = new THREE.Group();
  tent.name = "openGrowTent";
  const width = 2.08;
  const height = 2.12;
  const depth = 1.66;
  const y = height / 2;
  const fabric = material(0x151619, { roughness: 0.78, side: THREE.DoubleSide });
  const mylar = material(0xc9c8c1, { roughness: 0.32, metalness: 0.58, side: THREE.DoubleSide });
  const panel = (w, h, x, py, z, ry = 0, mat = fabric) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, py, z);
    mesh.rotation.y = ry;
    mesh.receiveShadow = true;
    tent.add(mesh);
    return mesh;
  };
  panel(width, height, 0, y, -depth / 2, 0, mylar);
  panel(depth, height, -width / 2, y, 0, Math.PI / 2, mylar);
  panel(depth, height, width / 2, y, 0, -Math.PI / 2, mylar);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mylar);
  roof.rotation.x = Math.PI / 2;
  roof.position.y = height;
  tent.add(roof);

  const poleMat = material(0x62666c, { metalness: 0.75, roughness: 0.32 });
  for (const [x, z] of [[-1, -0.78], [1, -0.78], [-1, 0.78], [1, 0.78]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, height, 8), poleMat);
    pole.position.set(x, y, z);
    tent.add(pole);
  }
  const flapShape = new THREE.Shape();
  flapShape.moveTo(0, 0);
  flapShape.lineTo(0.32, 0);
  flapShape.quadraticCurveTo(0.38, height * 0.5, 0.12, height);
  flapShape.lineTo(0, height);
  const left = new THREE.Mesh(new THREE.ShapeGeometry(flapShape), fabric);
  left.position.set(-width / 2, 0, depth / 2 + 0.01);
  left.rotation.y = -0.42;
  tent.add(left);
  const right = left.clone();
  right.scale.x = -1;
  right.position.x = width / 2;
  right.rotation.y = 0.42;
  tent.add(right);
  const zipper = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, height * 0.92, 6), material(0xb6b6b2, { metalness: 0.7 }));
  zipper.position.set(0, height * 0.48, depth / 2 + 0.025);
  tent.add(zipper);
  tent.visible = false;
  tent.userData.mylar = mylar;
  return tent;
}

function buildFixture() {
  const fixture = new THREE.Group();
  fixture.name = "growLightFixture";
  fixture.position.set(0, 1.88, 0);
  const housing = box(fixture, [0.68, 0.075, 0.42], [0, 0, 0], material(0x25272c, { metalness: 0.5, roughness: 0.38 }), "fixtureHousing");
  const emitterMaterial = material(0xffe1a6, { emissive: 0xffe1a6, emissiveIntensity: 2.1, roughness: 0.25 });
  const emitter = box(fixture, [0.6, 0.025, 0.34], [0, -0.05, 0], emitterMaterial, "emitter");
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 6), material(0x36373a));
  wire.position.y = 0.17;
  fixture.add(wire);
  return { fixture, housing, emitter, emitterMaterial };
}

export function buildGrowRoom(scene, tier, mobileLod) {
  const roomRoot = new THREE.Group();
  roomRoot.name = "roomRoot";
  const growZone = new THREE.Group();
  growZone.name = "growZone";
  scene.add(roomRoot, growZone);

  const shell = buildShell(tier, mobileLod);
  roomRoot.add(shell);
  const tent = buildTent();
  growZone.add(tent);
  const fixtureParts = buildFixture();
  growZone.add(fixtureParts.fixture);

  const plantRig = new THREE.Group();
  plantRig.name = "plantRig";
  plantRig.position.y = 0.36;
  growZone.add(plantRig);
  const potRig = new THREE.Group();
  potRig.name = "potRig";
  growZone.add(potRig);
  const props = new THREE.Group();
  props.name = "equipmentProps";
  growZone.add(props);

  const soilMaterial = material(0x3c2819, { roughness: 1 });
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.055, 24), soilMaterial);
  soil.position.y = 0.365;
  soil.name = "soilTarget";
  soil.receiveShadow = true;
  potRig.add(soil);
  const fallbackPot = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.21, 0.35, 20), material(0x62422d));
  fallbackPot.position.y = 0.18;
  fallbackPot.castShadow = true;
  potRig.add(fallbackPot);

  const contactShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.48, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.scale.set(1.35, 0.72, 1);
  contactShadow.position.y = 0.008;
  growZone.add(contactShadow);

  const ambient = new THREE.HemisphereLight(0xd7d1c7, 0x252a21, 0.58);
  scene.add(ambient);
  const canopyLight = new THREE.SpotLight(0xffe1a6, 1.7, 5, Math.PI / 4.4, 0.48, 1.35);
  canopyLight.position.set(0, 1.92, 0.12);
  canopyLight.target.position.set(0, 0.42, 0);
  canopyLight.castShadow = !mobileLod;
  canopyLight.shadow.mapSize.set(mobileLod ? 256 : 768, mobileLod ? 256 : 768);
  canopyLight.shadow.bias = -0.0008;
  scene.add(canopyLight, canopyLight.target);
  const fillLight = new THREE.PointLight(0xfff1d0, 0.75, 4, 1.7);
  fillLight.position.set(0.5, 1.25, 1.15);
  scene.add(fillLight);

  return {
    roomRoot,
    growZone,
    shell,
    tent,
    fixture: fixtureParts.fixture,
    fixtureHousing: fixtureParts.housing,
    emitter: fixtureParts.emitter,
    emitterMaterial: fixtureParts.emitterMaterial,
    plantRig,
    potRig,
    props,
    soil,
    fallbackPot,
    contactShadow,
    ambient,
    canopyLight,
    fillLight,
  };
}

export function applyHousePreset(state, tier) {
  const index = Math.max(0, Math.min(4, Number(tier) || 0));
  const preset = HOUSE_PRESETS[index];
  const nextShell = buildShell(index, state.mobileLod);
  state.roomRoot.remove(state.shell);
  disposeProcedural(state.shell);
  state.shell = nextShell;
  state.roomRoot.add(nextShell);
  state.camera.position.set(...preset.camera);
  state.camera.lookAt(...preset.look);
  state.scene.background = new THREE.Color(preset.fog);
  if (state.scene.fog) state.scene.fog.color.setHex(preset.fog);
}

export function applyLightPreset(state, lightClass, level = 1) {
  const preset = LIGHT_PRESETS[lightClass] || LIGHT_PRESETS.cfl;
  const boost = 1 + Math.min(0.4, Math.max(0, level - 1) * 0.05);
  state.canopyLight.color.setHex(preset.color);
  state.canopyLight.intensity = preset.intensity * boost;
  state.fillLight.color.setHex(preset.fill);
  state.fillLight.intensity = preset.intensity * 0.28 * boost;
  state.ambient.color.setHex(preset.ambient);
  state.emitterMaterial.color.setHex(preset.color);
  state.emitterMaterial.emissive.setHex(preset.color);
  state.renderer.toneMappingExposure = preset.exposure;
  const hps = lightClass === "hps";
  const cfl = lightClass === "cfl";
  state.fixtureHousing.scale.set(hps ? 1.18 : cfl ? 0.75 : 1, 1, hps ? 1.3 : cfl ? 0.72 : 1);
  state.emitter.scale.set(cfl ? 0.55 : 1, 1, cfl ? 0.45 : 1);
}

export function disposeProcedural(root) {
  root?.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((item) => item.dispose());
  });
}
