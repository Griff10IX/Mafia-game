import * as THREE from "three";

export const LIGHT_PRESETS = {
  cfl: { color: 0xffe1a6, fill: 0xfff1d0, ambient: 0xb4aa94, intensity: 1.9, exposure: 1.18 },
  led: { color: 0xdd62ff, fill: 0x9ba6ff, ambient: 0xa368bc, intensity: 3.35, exposure: 1.18 },
  hps: { color: 0xffa63d, fill: 0xffd890, ambient: 0xb18b58, intensity: 3.15, exposure: 1.15 },
  quantum: { color: 0xf4efff, fill: 0xb6a3ff, ambient: 0xc6bfd3, intensity: 3.75, exposure: 1.24 },
};

export const BUD_PHENOTYPES = {
  dense: { bud: 0x2f7839, leaf: 0x246a31, pistil: 0xf09a35, emissive: 0x0d3217, sparkle: 0xe8ffe4 },
  airy: { bud: 0x7fbd4a, leaf: 0x4f9638, pistil: 0xf4ad4b, emissive: 0x294817, sparkle: 0xf4ffe8 },
  frosty: { bud: 0xb8d3b2, leaf: 0x709a6c, pistil: 0xffc56b, emissive: 0x557455, sparkle: 0xffffff },
  purple: { bud: 0x724080, leaf: 0x3f4058, pistil: 0xff922b, emissive: 0x3a1d47, sparkle: 0xead8ff },
};

export function getBudPhenotype(key) {
  return BUD_PHENOTYPES[key] || BUD_PHENOTYPES.dense;
}

export function applyPlantPhenotype(root, key, stage, quality = 50, lightClass = "cfl") {
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
          const qualityGlow = Math.max(0, quality - 45) / 250;
          const lightGlow = lightClass === "led" || lightClass === "quantum" ? 0.06 : lightClass === "hps" ? 0.03 : 0;
          material.emissiveIntensity = flowering ? 0.2 + qualityGlow + lightGlow : 0.07;
        }
        material.metalness = key === "frosty" && quality >= 65 ? 0.08 : 0.02;
      } else if (name.includes("leaf")) {
        material.color?.setHex(preset.leaf);
        material.userData.healthyColor = preset.leaf;
        if (material.emissive) {
          material.emissive.setHex(lightClass === "led" ? 0x261338 : lightClass === "hps" ? 0x38220d : 0x102b17);
          material.emissiveIntensity = lightClass === "led" || lightClass === "quantum" ? 0.11 : 0.06;
        }
        material.roughness = quality >= 70 ? 0.38 : 0.46;
      }
      if (quality >= 70 && material.roughness != null) material.roughness = Math.max(0.2, material.roughness - 0.08);
      material.needsUpdate = true;
    });
  });
  return preset;
}

export function applyInfestationStress(root, infestationPct = 0) {
  const stress = Math.max(0, Math.min(1, Number(infestationPct || 0) / 100));
  const sick = new THREE.Color(stress > 0.65 ? 0x79632d : 0x8b8738);
  root?.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const name = `${object.name} ${object.material.name}`.toLowerCase();
    if (!name.includes("leaf")) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (!material.color) return;
      const healthy = new THREE.Color(material.userData.healthyColor ?? material.color.getHex());
      material.color.copy(healthy).lerp(sick, stress * 0.58);
      material.roughness = Math.min(0.72, (material.roughness ?? 0.45) + stress * 0.2);
    });
  });
}

export function strainScale(strainType, stageScale = 1) {
  if (strainType === "indica") return [1.12 * stageScale, 0.92 * stageScale, 1.12 * stageScale];
  if (strainType === "sativa") return [0.88 * stageScale, 1.12 * stageScale, 0.88 * stageScale];
  return [stageScale, stageScale, stageScale];
}
