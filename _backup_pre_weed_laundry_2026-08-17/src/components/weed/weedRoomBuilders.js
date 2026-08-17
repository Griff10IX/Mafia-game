import * as THREE from "three";
import { LIGHT_PRESETS } from "./weedPhenotypes";

const HOUSE_PRESETS = [
  { floor: 0x46362a, wall: 0x383027, accent: 0x755439, fog: 0x272019, fogDensity: 0.011, camera: [0.12, 1.35, 3.25], look: [0, 0.78, 0] },
  { floor: 0x555552, wall: 0x444642, accent: 0x777e74, fog: 0x292c2a, fogDensity: 0.009, camera: [0.18, 1.45, 3.7], look: [0, 0.82, 0] },
  { floor: 0x624c40, wall: 0xd0c8bc, accent: 0x76544b, fog: 0x40372f, fogDensity: 0.008, camera: [0.2, 1.5, 3.9], look: [0, 0.86, 0] },
  { floor: 0x5c5e63, wall: 0x414852, accent: 0x91673a, fog: 0x202731, fogDensity: 0.007, camera: [0.28, 1.68, 4.45], look: [0, 0.92, 0] },
  { floor: 0x46494f, wall: 0x303640, accent: 0x7b8996, fog: 0x19212a, fogDensity: 0.006, camera: [0.32, 1.82, 4.75], look: [0, 0.96, 0] },
];

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...options });
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
  const wallMat = material(preset.wall, { roughness: 0.76 });
  box(shell, [width, 0.08, depth], [0, -0.04, 0], floorMat, "floor");
  box(shell, [width, height, 0.08], [0, height / 2, -depth / 2], wallMat, "backWall");
  box(shell, [0.08, height, depth], [-width / 2, height / 2, 0], wallMat, "leftWall");
  // Partial enclosure keeps the room readable without blocking the open camera.
  box(shell, [0.08, height, depth * 0.58], [width / 2, height / 2, -depth * 0.2], wallMat, "rightWall");
  box(shell, [width, 0.06, depth * 0.48], [0, height, -depth * 0.25], wallMat, "ceiling");
  box(shell, [width, 0.075, 0.09], [0, 0.045, -depth / 2 + 0.06], material(preset.accent, { roughness: 0.62 }), "baseTrim");

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
    box(shell, [0.035, 1.25, 0.035], [1.66, 0.82, -1.37], material(0x2a2927), "closetCableConduit");
    box(shell, [0.16, 0.2, 0.045], [1.66, 0.42, -1.35], material(0xd2cec2, { roughness: 0.58 }), "closetOutlet");
  } else if (index === 1) {
    const pipeMat = material(0x68706b, { roughness: 0.38, metalness: 0.55 });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.35, 10), pipeMat);
    pipe.position.set(-1.75, 1.18, -1.35);
    shell.add(pipe);
    box(shell, [0.58, 0.42, 0.42], [1.65, 0.21, -1.08], material(0xb9bab5, { metalness: 0.15 }), "utilitySink");
    const drain = new THREE.Mesh(
      new THREE.RingGeometry(0.09, 0.14, 18),
      material(0x252a29, { metalness: 0.55, roughness: 0.46, side: THREE.DoubleSide })
    );
    drain.rotation.x = -Math.PI / 2;
    drain.position.set(1.1, 0.006, 0.75);
    shell.add(drain);
  } else if (index === 2) {
    box(shell, [0.98, 0.78, 0.07], [1.42, 1.62, -1.84], material(0x171719), "blackoutWindow");
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), material(0x57353e, { roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.006, 0.85);
    rug.receiveShadow = true;
    shell.add(rug);
    box(shell, [4.65, 0.09, 0.04], [0, 0.08, -1.86], material(0xe1ddd4, { roughness: 0.65 }), "suburbanBaseboard");
    box(shell, [0.48, 0.24, 0.05], [-1.55, 1.72, -1.84], material(0xc9c8c2, { metalness: 0.2 }), "suburbanVent");
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
    if (!mobileLod) {
      for (let i = 0; i < 5; i++) {
        const stripe = box(
          shell,
          [0.08, 0.012, 0.65],
          [1.5 + i * 0.18, 0.009, 0.95],
          material(i % 2 ? 0x1e2024 : 0xc8992d, { roughness: 0.68 }),
          "safetyFloorStripe"
        );
        stripe.rotation.y = -0.35;
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
  fixture.userData.chains = [];
  const housing = box(fixture, [0.68, 0.075, 0.42], [0, 0, 0], material(0x25272c, { metalness: 0.5, roughness: 0.38 }), "fixtureHousing");
  const emitterMaterial = material(0xffe1a6, { emissive: 0xffe1a6, emissiveIntensity: 2.1, roughness: 0.25 });
  const emitter = box(fixture, [0.6, 0.025, 0.34], [0, -0.05, 0], emitterMaterial, "emitter");
  const upgradeDetails = new THREE.Group();
  upgradeDetails.name = "fixtureUpgradeDetails";
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const diode = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 6, 6),
        new THREE.MeshBasicMaterial({ color: (row + col) % 3 === 0 ? 0xff72d5 : 0xeceaff })
      );
      diode.position.set((col - 2.5) * 0.085, -0.069, (row - 1) * 0.095);
      upgradeDetails.add(diode);
    }
  }
  upgradeDetails.visible = false;
  fixture.add(upgradeDetails);
  for (const x of [-0.23, 0.23]) {
    const chain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.32, 6),
      material(0x686b70, { metalness: 0.72, roughness: 0.34 })
    );
    chain.position.set(x, 0.19, 0);
    chain.name = "fixtureChain";
    fixture.add(chain);
    fixture.userData.chains.push(chain);
  }
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.38, 6), material(0x25262a));
  wire.position.set(0, 0.22, -0.14);
  wire.name = "fixturePowerCable";
  fixture.add(wire);
  return { fixture, housing, emitter, emitterMaterial, upgradeDetails };
}

function contactCard(radiusX, radiusZ, opacity = 0.24) {
  const card = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false })
  );
  card.rotation.x = -Math.PI / 2;
  card.scale.set(radiusX, radiusZ, 1);
  card.position.y = 0.006;
  return card;
}

function buildEquipmentSupports(mobileLod) {
  const supports = {};
  const steel = material(0x60656b, { metalness: 0.7, roughness: 0.35 });
  const rubber = material(0x202226, { roughness: 0.9 });

  const fan = new THREE.Group();
  fan.name = "fanFloorMount";
  box(fan, [0.34, 0.025, 0.3], [0.72, 0.015, -0.5], rubber, "fanAntiVibrationPad");
  const fanShadow = contactCard(0.26, 0.22, 0.22);
  fanShadow.position.set(0.72, 0.006, -0.5);
  fan.add(fanShadow);
  fan.visible = false;
  supports.fan = fan;

  const filter = new THREE.Group();
  filter.name = "filterRoofStraps";
  for (const x of [-0.82, -0.62]) {
    box(filter, [0.018, 0.48, 0.026], [x, 1.88, -0.58], rubber, "filterStrap");
  }
  box(filter, [0.5, 0.026, 0.04], [-0.72, 2.08, -0.58], steel, "filterCrossbar");
  filter.visible = false;
  supports.filter = filter;

  const climate = new THREE.Group();
  climate.name = "climateFloorMount";
  box(climate, [0.42, 0.035, 0.34], [-0.95, 0.02, -0.62], rubber, "climatePad");
  const climateShadow = contactCard(0.3, 0.23, 0.2);
  climateShadow.position.set(-0.95, 0.006, -0.62);
  climate.add(climateShadow);
  climate.visible = false;
  supports.climate = climate;

  const co2 = new THREE.Group();
  co2.name = "co2SafetyMount";
  const base = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 20), steel);
  base.rotation.x = Math.PI / 2;
  base.position.set(0.84, 0.035, -0.55);
  co2.add(base);
  const restraint = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 7, 20, Math.PI * 1.45), rubber);
  restraint.rotation.y = Math.PI / 2;
  restraint.position.set(0.84, 0.42, -0.62);
  co2.add(restraint);
  const co2Shadow = contactCard(0.18, 0.15, 0.22);
  co2Shadow.position.set(0.84, 0.006, -0.55);
  co2.add(co2Shadow);
  co2.visible = false;
  supports.co2 = co2;

  const careShelf = new THREE.Group();
  careShelf.name = "carePropShelf";
  box(careShelf, [1.35, 0.045, 0.36], [-0.05, 0.08, 0.42], material(0x45484d, { metalness: 0.38 }), "careShelfTop");
  if (!mobileLod) {
    box(careShelf, [0.035, 0.16, 0.3], [-0.68, 0.02, 0.42], steel, "careShelfLeg");
    box(careShelf, [0.035, 0.16, 0.3], [0.58, 0.02, 0.42], steel, "careShelfLeg");
  }
  supports.care = careShelf;
  return supports;
}

function buildDustMotes(mobileLod) {
  const count = mobileLod ? 18 : 42;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 1.25;
    positions[i * 3 + 1] = 0.45 + Math.random() * 1.35;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.9;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const motes = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xfff2c8, size: 0.012, transparent: true, opacity: 0.3, depthWrite: false })
  );
  motes.name = "lightBeamDust";
  return motes;
}

function buildUpgradeDetails(mobileLod) {
  const details = {};
  const dark = material(0x292c32, { roughness: 0.58, metalness: 0.28 });
  const metal = material(0x747b82, { roughness: 0.34, metalness: 0.72 });

  const tentPorts = new THREE.Group();
  tentPorts.name = "tentUpgradePorts";
  for (const y of [0.72, 1.42]) {
    const port = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 24), dark);
    port.rotation.y = Math.PI / 2;
    port.position.set(1.045, y, -0.2);
    tentPorts.add(port);
  }
  tentPorts.visible = false;
  details.tentPorts = tentPorts;

  const tentBraces = new THREE.Group();
  tentBraces.name = "tentReinforcement";
  for (const z of [-0.72, 0, 0.72]) {
    box(tentBraces, [2.02, 0.022, 0.025], [0, 2.06, z], metal, "tentRoofBrace");
  }
  tentBraces.visible = false;
  details.tentBraces = tentBraces;

  const meter = new THREE.Group();
  meter.name = "growMeter";
  box(meter, [0.12, 0.075, 0.035], [0.29, 0.43, 0.16], dark, "meterBody");
  const screen = box(
    meter,
    [0.075, 0.038, 0.008],
    [0.29, 0.435, 0.181],
    material(0x65d98b, { emissive: 0x1a6b39, emissiveIntensity: 0.8, roughness: 0.28 }),
    "meterScreen"
  );
  meter.userData.screen = screen;
  meter.visible = false;
  details.meter = meter;

  const duct = new THREE.Group();
  duct.name = "filterDuct";
  if (!mobileLod) {
    for (let i = 0; i < 8; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 7, 16), metal);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(-0.48 + i * 0.075, 1.66 + Math.sin(i * 0.5) * 0.035, -0.58);
      duct.add(ring);
    }
  }
  duct.visible = false;
  details.duct = duct;

  const co2Regulator = new THREE.Group();
  co2Regulator.name = "co2Regulator";
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 16), metal);
  gauge.rotation.z = Math.PI / 2;
  gauge.position.set(0.84, 0.62, -0.55);
  co2Regulator.add(gauge);
  box(co2Regulator, [0.03, 0.18, 0.03], [0.84, 0.52, -0.55], dark, "co2Valve");
  co2Regulator.visible = false;
  details.co2Regulator = co2Regulator;

  const climateDrain = new THREE.Group();
  climateDrain.name = "climateDrain";
  const drain = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 7, 24, Math.PI * 1.45), dark);
  drain.rotation.x = Math.PI / 2;
  drain.position.set(-0.82, 0.06, -0.42);
  climateDrain.add(drain);
  climateDrain.visible = false;
  details.climateDrain = climateDrain;

  const secondFanPad = new THREE.Group();
  secondFanPad.name = "secondFanFloorMount";
  box(secondFanPad, [0.32, 0.025, 0.28], [-0.95, 0.015, 0.28], dark, "secondFanPad");
  const secondFanShadow = contactCard(0.25, 0.21, 0.2);
  secondFanShadow.position.set(-0.95, 0.006, 0.28);
  secondFanPad.add(secondFanShadow);
  secondFanPad.visible = false;
  details.secondFanPad = secondFanPad;
  return details;
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
  const equipmentSupports = buildEquipmentSupports(mobileLod);
  Object.values(equipmentSupports).forEach((support) => props.add(support));
  const dustMotes = buildDustMotes(mobileLod);
  growZone.add(dustMotes);
  const upgradeDetails = buildUpgradeDetails(mobileLod);
  Object.values(upgradeDetails).forEach((detail) => growZone.add(detail));

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

  const lightConeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe1a6,
    transparent: true,
    opacity: 0.045,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lightCone = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.35, 24, 1, true), lightConeMaterial);
  lightCone.position.set(0, 1.18, 0);
  lightCone.name = "canopyLightCone";
  growZone.add(lightCone);

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
  const rimLight = new THREE.PointLight(0xb9c8ff, mobileLod ? 0.18 : 0.32, 5, 1.8);
  rimLight.position.set(-1.25, 1.65, 1.7);
  scene.add(rimLight);

  return {
    roomRoot,
    growZone,
    shell,
    tent,
    fixture: fixtureParts.fixture,
    fixtureHousing: fixtureParts.housing,
    emitter: fixtureParts.emitter,
    emitterMaterial: fixtureParts.emitterMaterial,
    fixtureUpgradeDetails: fixtureParts.upgradeDetails,
    plantRig,
    potRig,
    props,
    equipmentSupports,
    dustMotes,
    upgradeDetails,
    soil,
    fallbackPot,
    contactShadow,
    lightCone,
    lightConeMaterial,
    ambient,
    canopyLight,
    fillLight,
    rimLight,
  };
}

export function applyEquipmentVisualLevels(state, equipment = {}) {
  const n = (id) => Math.max(0, Number(equipment?.[id]) || 0);
  const tents = n("tents");
  state.upgradeDetails.tentPorts.visible = tents >= 3;
  state.upgradeDetails.tentBraces.visible = tents >= 6;
  state.upgradeDetails.meter.visible = n("meters") >= 1;
  state.upgradeDetails.duct.visible = n("carbon_filter") >= 3;
  state.upgradeDetails.co2Regulator.visible = n("co2") >= 3;
  state.upgradeDetails.climateDrain.visible = Math.max(n("climate_control"), n("dehumidifier")) >= 3;
  state.upgradeDetails.secondFanPad.visible = n("osc_fans") >= 8;
  if (state.upgradeDetails.meter.userData.screen?.material) {
    state.upgradeDetails.meter.userData.screen.material.emissiveIntensity =
      0.55 + Math.min(0.8, n("meters") * 0.1);
  }
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
  if (state.scene.fog) state.scene.fog.density = preset.fogDensity;
}

export function applyLightPreset(state, lightClass, level = 1) {
  const preset = LIGHT_PRESETS[lightClass] || LIGHT_PRESETS.cfl;
  const boost = 1 + Math.min(0.4, Math.max(0, level - 1) * 0.05);
  state.canopyLight.color.setHex(preset.color);
  state.canopyLight.intensity = preset.intensity * boost;
  state.fillLight.color.setHex(preset.fill);
  state.fillLight.intensity = preset.intensity * 0.42 * boost;
  state.ambient.color.setHex(preset.ambient);
  state.ambient.groundColor.setHex(0x343229);
  state.ambient.intensity = lightClass === "cfl" ? 0.72 : 0.64;
  state.rimLight.color.setHex(
    lightClass === "hps" ? 0xffd6a0 : lightClass === "led" || lightClass === "quantum" ? 0x8fd4ff : 0xc8d1ff
  );
  state.rimLight.intensity = (state.mobileLod ? 0.18 : 0.32) * boost * (lightClass === "quantum" ? 1.15 : 1);
  state.lightConeMaterial.color.setHex(preset.color);
  state.lightConeMaterial.opacity =
    lightClass === "cfl" ? 0.035 : lightClass === "quantum" ? 0.07 : lightClass === "led" ? 0.05 : 0.045;
  state.emitterMaterial.color.setHex(preset.color);
  state.emitterMaterial.emissive.setHex(preset.color);
  state.emitterMaterial.emissiveIntensity = lightClass === "quantum" ? 1.35 : lightClass === "led" ? 1.15 : 1;
  state.renderer.toneMappingExposure = preset.exposure * (lightClass === "quantum" ? 1.06 : 1);
  const hps = lightClass === "hps";
  const cfl = lightClass === "cfl";
  const ledLike = lightClass === "led" || lightClass === "quantum";
  state.fixtureHousing.scale.set(hps ? 1.18 : cfl ? 0.75 : ledLike ? 1.08 : 1, 1, hps ? 1.3 : cfl ? 0.72 : ledLike ? 1.15 : 1);
  state.emitter.scale.set(cfl ? 0.55 : ledLike ? 1.12 : 1, 1, cfl ? 0.45 : ledLike ? 1.05 : 1);
  state.fixtureUpgradeDetails.visible = level >= 3 && ledLike;
  state.fixtureUpgradeDetails.scale.setScalar(level >= 7 ? 1.12 : lightClass === "quantum" ? 1.08 : 1);
}

export function disposeProcedural(root) {
  root?.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((item) => item.dispose());
  });
}
