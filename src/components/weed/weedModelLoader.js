import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

const loader = new GLTFLoader();
const modelCache = new Map();

export const WEED_MODELS = {
  seedling: "/models/weed/plant-seedling.glb",
  veg: "/models/weed/plant-veg.glb",
  flower: "/models/weed/plant-flower.glb",
  harvest_ready: "/models/weed/plant-harvest.glb",
  wateringCan: "/models/weed/watering-can.glb",
  nutrientBottle: "/models/weed/nutrient-bottle.glb",
  pot: "/models/weed/pot.glb",
  potFabric: "/models/weed/pot-fabric-grow-bag.glb",
  potAir: "/models/weed/pot-air-perforated.glb",
  potHydro: "/models/weed/pot-hydro-autopot.glb",
  fan: "/models/weed/clip-fan.glb",
  filter: "/models/weed/carbon-filter.glb",
  climate: "/models/weed/dehumidifier.glb",
  co2: "/models/weed/co2-tank.glb",
};

function fetchModel(url) {
  if (!modelCache.has(url)) {
    modelCache.set(
      url,
      loader.loadAsync(url).catch((error) => {
        modelCache.delete(url);
        console.error(`[WeedEmpire3D] Failed to load model: ${url}`, error);
        throw error;
      })
    );
  }
  return modelCache.get(url);
}

function cloneMaterials(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.cachedGeometry = true;
    if (Array.isArray(object.material)) object.material = object.material.map((material) => material.clone());
    else if (object.material) object.material = object.material.clone();
  });
}

export async function loadWeedModel(url, { height = 1, ground = true, preserveOrigin = false } = {}) {
  const gltf = await fetchModel(url);
  const model = cloneSkeleton(gltf.scene);
  cloneMaterials(model);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = height / Math.max(size.y, 0.001);
  model.scale.setScalar(scale);
  if (preserveOrigin) model.position.set(0, 0, 0);
  else model.position.set(-center.x * scale, ground ? -bounds.min.y * scale : -center.y * scale, -center.z * scale);

  const wrapper = new THREE.Group();
  wrapper.name = `model:${url}`;
  wrapper.userData.modelUrl = url;
  wrapper.userData.normalizedBounds = {
    min: bounds.min.clone().multiplyScalar(scale),
    max: bounds.max.clone().multiplyScalar(scale),
    size: size.clone().multiplyScalar(scale),
  };
  wrapper.userData.originGroundOffset = -bounds.min.y * scale;
  wrapper.add(model);
  return wrapper;
}

export function preloadWeedModels(urls) {
  return Promise.allSettled([...new Set(urls.filter(Boolean))].map((url) => fetchModel(url)));
}

export function disposeModelClone(root) {
  root?.traverse((object) => {
    if (!object.isMesh) return;
    if (!object.userData.cachedGeometry) object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => material.dispose());
  });
}

export function clearWeedModelCache() {
  modelCache.clear();
}
