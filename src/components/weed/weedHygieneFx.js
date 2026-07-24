import * as THREE from "three";

function webGeometry(radius, spokes = 8, rings = 3) {
  const points = [];
  for (let spoke = 0; spoke < spokes; spoke++) {
    const angle = (spoke / spokes) * Math.PI * 2;
    points.push(0, 0, 0, Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  }
  for (let ring = 1; ring <= rings; ring++) {
    const ringRadius = radius * (ring / rings);
    for (let spoke = 0; spoke <= spokes; spoke++) {
      const angle = ((spoke % spokes) / spokes) * Math.PI * 2;
      points.push(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

function makeWeb(index) {
  const material = new THREE.LineBasicMaterial({
    color: 0xe8ece6,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const web = new THREE.LineSegments(webGeometry(0.13 + (index % 3) * 0.025), material);
  const angle = index * 1.91;
  web.position.set(Math.cos(angle) * (0.11 + (index % 2) * 0.08), 0.28 + (index % 5) * 0.12, Math.sin(angle) * 0.14);
  web.rotation.set(index % 2 ? -0.45 : 0.2, angle, index % 3 ? 0.3 : -0.25);
  web.visible = false;
  return web;
}

function makeMites(mobileLod) {
  const count = mobileLod ? 12 : 30;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.08 + Math.random() * 0.19;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = 0.22 + Math.random() * 0.68;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    phases[i] = Math.random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xc95f2d,
      size: mobileLod ? 0.012 : 0.016,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  points.visible = false;
  return { points, positions, phases, count };
}

function makeGrimeOverlay(mobileLod) {
  const group = new THREE.Group();
  group.name = "roomGrimeOverlay";
  const stainMaterial = new THREE.MeshBasicMaterial({
    color: 0x251d13,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const floorStain = new THREE.Mesh(new THREE.CircleGeometry(0.72, 24), stainMaterial);
  floorStain.rotation.x = -Math.PI / 2;
  floorStain.scale.set(1.5, 0.68, 1);
  floorStain.position.set(-0.48, 0.009, -0.32);
  group.add(floorStain);
  if (!mobileLod) {
    for (let i = 0; i < 3; i++) {
      const floorMark = new THREE.Mesh(new THREE.CircleGeometry(0.18 + i * 0.06, 18), stainMaterial.clone());
      floorMark.rotation.x = -Math.PI / 2;
      floorMark.scale.set(1.5, 0.62, 1);
      floorMark.position.set(-1.05 + i * 0.9, 0.008 + i * 0.0005, -0.85 + (i % 2) * 0.42);
      group.add(floorMark);
    }
  }
  return group;
}

function makeMist(mobileLod) {
  const count = mobileLod ? 24 : 54;
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xd8f4da,
      size: mobileLod ? 0.035 : 0.045,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  );
  points.visible = false;
  return { points, positions, count };
}

export function createHygieneRig(plantRig, roomRoot, growZone, mobileLod) {
  const webGroup = new THREE.Group();
  webGroup.name = "spiderMiteWebs";
  const webCount = mobileLod ? 5 : 11;
  const webs = Array.from({ length: webCount }, (_, index) => makeWeb(index));
  webs.forEach((web) => webGroup.add(web));
  plantRig.add(webGroup);
  const mites = makeMites(mobileLod);
  plantRig.add(mites.points);
  const grime = makeGrimeOverlay(mobileLod);
  roomRoot.add(grime);
  const mist = makeMist(mobileLod);
  growZone.add(mist.points);
  return {
    webs,
    webGroup,
    mites,
    grime,
    mist,
    cleanliness: 100,
    infestation: 0,
    stage: "empty",
    fxKind: null,
    fxStartedAt: 0,
    fxUntil: 0,
  };
}

export function setHygieneState(rig, cleanliness = 100, infestation = 0, stage = "empty") {
  rig.cleanliness = THREE.MathUtils.clamp(Number(cleanliness) || 0, 0, 100);
  rig.infestation = THREE.MathUtils.clamp(Number(infestation) || 0, 0, 100);
  rig.stage = stage;
}

export function startHygieneFx(rig, kind, duration = 1250) {
  if (kind !== "clean" && kind !== "ipm") return false;
  rig.fxKind = kind;
  rig.fxStartedAt = performance.now();
  rig.fxUntil = rig.fxStartedAt + duration;
  rig.mist.points.material.color.setHex(kind === "clean" ? 0xe9f6ff : 0xb8efa8);
  rig.mist.points.visible = true;
  return true;
}

export function updateHygieneFx(rig, now) {
  const planted = rig.stage !== "empty" && rig.stage !== "dead";
  const severity = planted ? rig.infestation / 100 : 0;
  const visibleWebs = Math.ceil(severity * rig.webs.length);
  rig.webs.forEach((web, index) => {
    web.visible = index < visibleWebs && severity >= 0.08;
    web.material.opacity = web.visible ? 0.1 + severity * 0.52 : 0;
    web.rotation.z += Math.sin(now * 0.0008 + index) * 0.00012;
  });
  rig.mites.points.visible = planted && severity >= 0.12;
  rig.mites.points.material.opacity = rig.mites.points.visible ? Math.min(0.9, 0.2 + severity) : 0;
  if (rig.mites.points.visible) {
    for (let i = 0; i < rig.mites.count; i++) {
      rig.mites.positions[i * 3] += Math.sin(now * 0.002 + rig.mites.phases[i]) * 0.00012;
      rig.mites.positions[i * 3 + 1] += Math.cos(now * 0.0016 + rig.mites.phases[i]) * 0.00008;
    }
    rig.mites.points.geometry.attributes.position.needsUpdate = true;
  }

  const grimeAmount = THREE.MathUtils.clamp((55 - rig.cleanliness) / 55, 0, 1);
  rig.grime.children.forEach((stain, index) => {
    stain.material.opacity = grimeAmount * (index === 0 ? 0.34 : 0.2);
    stain.visible = grimeAmount > 0.03;
  });

  if (rig.fxKind) {
    const phase = THREE.MathUtils.clamp((now - rig.fxStartedAt) / (rig.fxUntil - rig.fxStartedAt), 0, 1);
    for (let i = 0; i < rig.mist.count; i++) {
      const angle = i * 2.399;
      const radius = phase * (0.18 + (i % 7) * 0.035);
      rig.mist.positions[i * 3] = Math.cos(angle) * radius;
      rig.mist.positions[i * 3 + 1] = 0.28 + (i % 9) * 0.07 + Math.sin(phase * Math.PI) * 0.16;
      rig.mist.positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    rig.mist.points.geometry.attributes.position.needsUpdate = true;
    rig.mist.points.material.opacity = Math.sin(phase * Math.PI) * 0.62;
    if (now >= rig.fxUntil) {
      rig.fxKind = null;
      rig.mist.points.visible = false;
      rig.mist.points.material.opacity = 0;
      return true;
    }
  }
  return false;
}

export function disposeHygieneRig(rig) {
  rig.webs.forEach((web) => {
    web.geometry.dispose();
    web.material.dispose();
  });
  [rig.mites.points, rig.mist.points].forEach((points) => {
    points.geometry.dispose();
    points.material.dispose();
  });
  rig.grime.children.forEach((mesh) => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
}
