export const LIGHT_PRESETS = {
  cfl: { color: 0xffe1a6, fill: 0xfff1d0, ambient: 0x9a927e, intensity: 1.7, exposure: 1.08 },
  led: { color: 0xdd62ff, fill: 0x7f8cff, ambient: 0x8e4bad, intensity: 3.25, exposure: 1.12 },
  hps: { color: 0xffa63d, fill: 0xffd078, ambient: 0x9f7542, intensity: 3.05, exposure: 1.08 },
  quantum: { color: 0xf4efff, fill: 0xa78cff, ambient: 0xb8b1c8, intensity: 3.7, exposure: 1.2 },
};

export const BUD_PHENOTYPES = {
  dense: { bud: 0x39733c, leaf: 0x2e6a34, pistil: 0xe88f32, emissive: 0x102c16, sparkle: 0xe8ffe4 },
  airy: { bud: 0x72ad4d, leaf: 0x4d8c3d, pistil: 0xf1a549, emissive: 0x203c16, sparkle: 0xf4ffe8 },
  frosty: { bud: 0xa7caa1, leaf: 0x668f62, pistil: 0xffbd62, emissive: 0x4c6a4c, sparkle: 0xffffff },
  purple: { bud: 0x684071, leaf: 0x3d3d50, pistil: 0xff8d25, emissive: 0x301b3a, sparkle: 0xead8ff },
};

export function getBudPhenotype(key) {
  return BUD_PHENOTYPES[key] || BUD_PHENOTYPES.dense;
}

export function applyPlantPhenotype(root, key, stage, quality = 50) {
  const preset = getBudPhenotype(key);
  const flowering = stage === "flower" || stage === "harvest_ready";
  root?.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const name = `${object.name} ${object.material.name}`.toLowerCase();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (name.includes("pistil")) {
        material.color?.setHex(preset.pistil);
      } else if (name.includes("bud")) {
        material.color?.setHex(preset.bud);
        material.roughness = key === "frosty" ? 0.24 : 0.38;
        if (material.emissive) {
          material.emissive.setHex(preset.emissive);
          material.emissiveIntensity = flowering ? 0.22 : 0.08;
        }
      } else if (name.includes("leaf")) {
        material.color?.setHex(preset.leaf);
      }
      if (quality >= 70 && material.roughness != null) material.roughness = Math.max(0.2, material.roughness - 0.08);
      material.needsUpdate = true;
    });
  });
  return preset;
}

export function strainScale(strainType, stageScale = 1) {
  if (strainType === "indica") return [1.12 * stageScale, 0.92 * stageScale, 1.12 * stageScale];
  if (strainType === "sativa") return [0.88 * stageScale, 1.12 * stageScale, 0.88 * stageScale];
  return [stageScale, stageScale, stageScale];
}
