import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  WEED_MODELS,
  disposeModelClone,
  loadWeedModel,
  preloadWeedModels,
} from "./weedModelLoader";
import {
  applyHousePreset,
  applyLightPreset,
  buildGrowRoom,
} from "./weedRoomBuilders";
import {
  createCareRig,
  disposeCareRig,
  setIrrigationVisibility,
  startCareFx,
  updateCareFx,
} from "./weedFx";
import {
  applyPlantPhenotype,
  getBudPhenotype,
  strainScale,
} from "./weedPhenotypes";

function level(equipment, id) {
  return Math.max(0, Number(equipment?.[id]) || 0);
}

function stageUrl(stage) {
  if (stage === "harvest-ready") return WEED_MODELS.harvest_ready;
  return WEED_MODELS[stage] || null;
}

function stageHeight(stage) {
  if (stage === "seedling") return 0.3;
  if (stage === "veg") return 0.72;
  if (stage === "flower") return 0.92;
  return 1.02;
}

function setOpacity(root, opacity) {
  root?.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      material.transparent = opacity < 0.999;
      material.opacity = opacity;
      material.depthWrite = opacity > 0.45;
    });
  });
}

function makePlaceholderPlant() {
  const root = new THREE.Group();
  root.name = "plantPlaceholder";
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x4d753d, roughness: 0.72 });
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x397c39,
    roughness: 0.52,
    side: THREE.DoubleSide,
  });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.45, 8), stemMaterial);
  stem.position.y = 0.225;
  root.add(stem);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), leafMaterial);
    const angle = (i / 6) * Math.PI * 2;
    leaf.scale.set(1.5, 0.16, 0.55);
    leaf.rotation.y = -angle;
    leaf.position.set(Math.cos(angle) * 0.12, 0.18 + (i % 3) * 0.11, Math.sin(angle) * 0.12);
    root.add(leaf);
  }
  root.traverse((object) => {
    if (object.isMesh) object.castShadow = true;
  });
  return root;
}

function makeSparkles(mobileLod) {
  const count = mobileLod ? 34 : 68;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 0.56;
    positions[i * 3 + 1] = 0.35 + Math.random() * 0.72;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.018,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    })
  );
  points.visible = false;
  return points;
}

function disposeSceneObject(root) {
  root?.traverse((object) => {
    if (object.isMesh && !object.userData.cachedGeometry) object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => material.dispose());
  });
}

const EQUIPMENT_CONFIG = {
  fan: { equipment: "osc_fans", url: WEED_MODELS.fan, height: 0.38, position: [0.82, 0.86, -0.45], rotation: [0, -1.2, 0] },
  filter: { equipment: "carbon_filter", url: WEED_MODELS.filter, height: 0.28, position: [-0.73, 1.62, -0.58], rotation: [0, 0, Math.PI / 2] },
  climate: { equipment: "climate_control", alternate: "dehumidifier", url: WEED_MODELS.climate, height: 0.42, position: [-0.8, 0.03, -0.52], rotation: [0, 0.35, 0] },
  co2: { equipment: "co2", url: WEED_MODELS.co2, height: 0.56, position: [0.84, 0.02, -0.55], rotation: [0, -0.3, 0] },
};

export default function WeedEmpire3D({
  lightClass = "cfl",
  stage = "empty",
  progress = 0,
  budMeshKey = "dense",
  strainType = "hybrid",
  quality = 50,
  equipment = {},
  houseTier = 0,
  houseId = "closet",
  autoWater = false,
  autoFeed = false,
  curingCount = 0,
  fx = null,
  fxNonce = 0,
  onFxDone,
}) {
  const mountRef = useRef(null);
  const stateRef = useRef(null);
  const propsRef = useRef({});
  const [sceneReady, setSceneReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState("");

  propsRef.current = {
    stage,
    progress,
    budMeshKey,
    strainType,
    quality,
    equipment,
    houseTier,
    lightClass,
    onFxDone,
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let cancelled = false;
    const width = mount.clientWidth || 480;
    const height = mount.clientHeight || 320;
    const mobileLod = width < 480;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x161310);
    scene.fog = new THREE.FogExp2(0x19140f, 0.018);
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.08, 40);
    camera.position.set(0.12, 1.35, 3.25);
    camera.lookAt(0, 0.78, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: !mobileLod, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobileLod ? 1.5 : 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const room = buildGrowRoom(scene, houseTier, mobileLod);
    const sparkles = makeSparkles(mobileLod);
    room.plantRig.add(sparkles);
    const state = {
      ...room,
      scene,
      camera,
      renderer,
      mobileLod,
      sparkles,
      plant: null,
      careRig: null,
      models: new Set(),
      equipmentModels: {},
      transitions: [],
      irrigationLevel: level(equipment, "irrigation"),
      fxDoneNonce: null,
      disposed: false,
      animationFrame: 0,
      startedAt: performance.now(),
    };
    stateRef.current = state;

    const required = [
      WEED_MODELS.pot,
      WEED_MODELS.wateringCan,
      WEED_MODELS.nutrientBottle,
      stageUrl(stage),
      ...Object.values(EQUIPMENT_CONFIG)
        .filter((item) => level(equipment, item.equipment) || level(equipment, item.alternate))
        .map((item) => item.url),
    ];

    async function initializeModels() {
      await preloadWeedModels(required);
      if (cancelled || state.disposed) return;
      try {
        const [potModel, canModel, bottleModel] = await Promise.all([
          loadWeedModel(WEED_MODELS.pot, { height: 0.34 }),
          loadWeedModel(WEED_MODELS.wateringCan, { height: 0.34 }),
          loadWeedModel(WEED_MODELS.nutrientBottle, { height: 0.28 }),
        ]);
        if (cancelled || state.disposed) {
          [potModel, canModel, bottleModel].forEach(disposeModelClone);
          return;
        }
        state.models.add(potModel);
        state.models.add(canModel);
        state.models.add(bottleModel);
        state.potRig.add(potModel);
        state.fallbackPot.visible = false;
        state.careRig = createCareRig(state.growZone, canModel, bottleModel, state.soil, mobileLod);
        setIrrigationVisibility(state.careRig, state.irrigationLevel);
      } catch (error) {
        setLoadWarning("Some grow-room models could not load. Using clean fallback props.");
      } finally {
        if (!cancelled) {
          setSceneReady(true);
          setLoading(false);
        }
      }
    }
    initializeModels();

    const animate = (now) => {
      if (state.disposed) return;
      const elapsed = (now - state.startedAt) / 1000;
      if (state.plant && !state.careRig?.kind) state.plant.rotation.y = Math.sin(elapsed * 0.35) * 0.045;
      state.sparkles.rotation.y = elapsed * 0.08;
      state.sparkles.material.opacity = 0.68 + Math.sin(elapsed * 2.2) * 0.14;

      for (let i = state.transitions.length - 1; i >= 0; i--) {
        const transition = state.transitions[i];
        const amount = Math.min(1, (now - transition.start) / transition.duration);
        setOpacity(transition.object, transition.from + (transition.to - transition.from) * amount);
        if (amount >= 1) {
          state.transitions.splice(i, 1);
          if (transition.remove) {
            state.plantRig.remove(transition.object);
            state.models.delete(transition.object);
            disposeModelClone(transition.object);
          }
        }
      }

      if (state.careRig) {
        const finished = updateCareFx(state.careRig, now, state.irrigationLevel);
        if (finished && state.fxDoneNonce !== null) {
          state.fxDoneNonce = null;
          propsRef.current.onFxDone?.();
        }
      }
      renderer.render(scene, camera);
      state.animationFrame = requestAnimationFrame(animate);
    };
    state.animationFrame = requestAnimationFrame(animate);

    const resize = () => {
      if (state.disposed) return;
      const nextWidth = mount.clientWidth || 480;
      const nextHeight = mount.clientHeight || 320;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    };
    window.addEventListener("resize", resize);

    return () => {
      cancelled = true;
      state.disposed = true;
      cancelAnimationFrame(state.animationFrame);
      window.removeEventListener("resize", resize);
      if (state.careRig) disposeCareRig(state.careRig);
      state.models.forEach(disposeModelClone);
      disposeSceneObject(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
    // The scene is intentionally created once; prop effects below update it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    if (!sceneReady || !state) return;
    applyHousePreset(state, houseTier);
    void houseId;
  }, [sceneReady, houseTier, houseId]);

  useEffect(() => {
    const state = stateRef.current;
    if (!sceneReady || !state) return;
    const lightLevel =
      lightClass === "quantum"
        ? level(equipment, "lights_quantum")
        : lightClass === "hps"
          ? level(equipment, "lights_hps")
          : lightClass === "led"
            ? level(equipment, "lights_led")
            : Math.max(1, level(equipment, "lights_cfl"));
    applyLightPreset(state, lightClass, lightLevel);
  }, [sceneReady, lightClass, equipment]);

  useEffect(() => {
    const state = stateRef.current;
    if (!sceneReady || !state) return undefined;
    let stale = false;
    const url = stageUrl(stage);
    const empty = stage === "empty" || stage === "dead" || !url;
    if (empty) {
      if (state.plant) state.plant.visible = false;
      state.sparkles.visible = false;
      return undefined;
    }

    const normalizedStage = stage === "harvest-ready" ? "harvest_ready" : stage;
    setLoading(true);
    loadWeedModel(url, { height: stageHeight(normalizedStage) })
      .then((model) => {
        if (stale || state.disposed) {
          disposeModelClone(model);
          return;
        }
        applyPlantPhenotype(model, budMeshKey, normalizedStage, quality);
        const p = Math.max(0, Math.min(1, Number(progress) || 0));
        const growth = 0.88 + p * 0.12;
        model.scale.set(...strainScale(strainType, growth));
        model.userData.stage = normalizedStage;
        setOpacity(model, 0);
        state.plantRig.add(model);
        state.models.add(model);
        if (state.plant && state.plant !== model) {
          state.transitions.push({ object: state.plant, from: 1, to: 0, start: performance.now(), duration: 320, remove: true });
        }
        state.plant = model;
        state.transitions.push({ object: model, from: 0, to: 1, start: performance.now(), duration: 360 });
        const phenotype = getBudPhenotype(budMeshKey);
        state.sparkles.material.color.setHex(phenotype.sparkle);
        state.sparkles.visible =
          (normalizedStage === "flower" || normalizedStage === "harvest_ready") &&
          (budMeshKey === "frosty" || quality >= 60 || normalizedStage === "harvest_ready");
        setLoadWarning("");
      })
      .catch(() => {
        if (stale || state.disposed) return;
        const placeholder = makePlaceholderPlant();
        placeholder.scale.set(...strainScale(strainType, 1));
        state.plantRig.add(placeholder);
        if (state.plant) {
          state.plantRig.remove(state.plant);
          state.models.delete(state.plant);
          disposeModelClone(state.plant);
        }
        state.plant = placeholder;
        setLoadWarning(`Plant model failed to load: ${url}. Showing fallback.`);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [sceneReady, stage, progress, strainType, budMeshKey, quality]);

  useEffect(() => {
    const state = stateRef.current;
    if (!sceneReady || !state) return undefined;
    let stale = false;
    const tents = level(equipment, "tents");
    const mylar = level(equipment, "mylar");
    const pots = level(equipment, "pots");
    const irrigationLevel = level(equipment, "irrigation");
    state.irrigationLevel = irrigationLevel;
    state.tent.visible = tents >= 1;
    state.tent.scale.setScalar(tents >= 8 || houseTier >= 2 ? 1.14 : tents >= 4 ? 1.07 : 1);
    if (state.tent.userData.mylar) {
      state.tent.userData.mylar.metalness = 0.5 + Math.min(0.3, mylar * 0.04);
      state.tent.userData.mylar.color.setHex(mylar >= 3 ? 0xe4e4df : 0xc9c8c1);
    }
    const potScale = pots >= 8 ? 1.12 : pots >= 4 ? 1.07 : 1;
    state.potRig.scale.setScalar(potScale);
    if (state.careRig) setIrrigationVisibility(state.careRig, irrigationLevel);

    const syncEquipment = async () => {
      for (const [key, config] of Object.entries(EQUIPMENT_CONFIG)) {
        const ownedLevel = Math.max(level(equipment, config.equipment), level(equipment, config.alternate));
        const visible = ownedLevel >= 1 && (!state.mobileLod || key === "filter" || key === "co2");
        let model = state.equipmentModels[key];
        if (visible && !model) {
          try {
            model = await loadWeedModel(config.url, { height: config.height });
            if (stale || state.disposed) {
              disposeModelClone(model);
              return;
            }
            model.position.set(...config.position);
            model.rotation.set(...config.rotation);
            state.props.add(model);
            state.models.add(model);
            state.equipmentModels[key] = model;
          } catch (error) {
            setLoadWarning(`Equipment model failed to load: ${config.url}`);
          }
        }
        if (model) {
          model.visible = visible;
          const detailScale = 1 + Math.min(0.16, Math.max(0, ownedLevel - 1) * 0.025);
          model.scale.setScalar(detailScale);
        }
      }
    };
    syncEquipment();
    void autoWater;
    void autoFeed;
    void curingCount;
    return () => {
      stale = true;
    };
  }, [sceneReady, equipment, houseTier, autoWater, autoFeed, curingCount]);

  useEffect(() => {
    const state = stateRef.current;
    if (!sceneReady || !state || !fx) return;
    if (fx === "water" || fx === "feed") {
      if (state.careRig && startCareFx(state.careRig, fx, state.irrigationLevel)) {
        state.fxDoneNonce = fxNonce;
      } else {
        onFxDone?.();
      }
      return;
    }
    if (fx === "harvest_trim" && state.plant) {
      const currentScale = state.plant.scale.clone();
      state.transitions.push({
        object: state.plant,
        from: 1,
        to: 0.25,
        start: performance.now(),
        duration: 1300,
      });
      window.setTimeout(() => {
        if (!state.disposed && state.plant) state.plant.scale.copy(currentScale);
        onFxDone?.();
      }, 1350);
    }
  }, [sceneReady, fx, fxNonce, onFxDone]);

  return (
    <div
      ref={mountRef}
      className="relative w-full h-[280px] md:h-[340px] rounded-lg overflow-hidden border border-emerald-900/40 bg-black"
      aria-label="Grow room 3D view"
      aria-busy={loading}
    >
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/35 text-xs font-medium tracking-wide text-emerald-100/80">
          Loading grow room…
        </div>
      )}
      {loadWarning && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded bg-black/70 px-2 py-1 text-[10px] text-amber-200/90">
          {loadWarning}
        </div>
      )}
    </div>
  );
}
