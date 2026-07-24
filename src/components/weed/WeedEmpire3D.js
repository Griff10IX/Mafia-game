import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  WEED_MODELS,
  disposeModelClone,
  loadWeedModel,
  preloadWeedModels,
} from "./weedModelLoader";
import {
  applyEquipmentVisualLevels,
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
  applyInfestationStress,
  applyPlantPhenotype,
  getBudPhenotype,
  strainScale,
} from "./weedPhenotypes";
import {
  createHygieneRig,
  disposeHygieneRig,
  setHygieneState,
  startHygieneFx,
  updateHygieneFx,
} from "./weedHygieneFx";

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

function potVisual(levelValue) {
  const potLevel = Math.max(0, Number(levelValue) || 0);
  if (potLevel >= 8) return { url: WEED_MODELS.potHydro, height: 0.43, soilScale: 1.08, tier: "hydro" };
  if (potLevel >= 5) return { url: WEED_MODELS.potAir, height: 0.4, soilScale: 1.04, tier: "air" };
  if (potLevel >= 3) return { url: WEED_MODELS.potFabric, height: 0.42, soilScale: 1.02, tier: "fabric" };
  return { url: WEED_MODELS.pot, height: 0.36, soilScale: 0.98, tier: "starter" };
}

function preparePotModel(model, visual) {
  const soilY = Number(model.userData.originGroundOffset) || 0.365;
  model.position.y = soilY;
  model.userData.potTier = visual.tier;
  model.userData.potUrl = visual.url;
  model.traverse((object) => {
    if (object.name?.toLowerCase() === "soil") object.visible = false;
  });
  return soilY;
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
  fan: { equipment: "osc_fans", url: WEED_MODELS.fan, height: 0.78, position: [0.72, 0, -0.5], rotation: [0, -1.15, 0] },
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
  cleanlinessPct = 100,
  miteInfestationPct = 0,
  miteInfested = false,
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
    miteInfested,
    miteInfestationPct,
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
    scene.fog = new THREE.FogExp2(0x272019, 0.011);
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
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const room = buildGrowRoom(scene, houseTier, mobileLod);
    const sparkles = makeSparkles(mobileLod);
    room.plantRig.add(sparkles);
    const hygieneRig = createHygieneRig(room.plantRig, room.roomRoot, room.growZone, mobileLod);
    setHygieneState(hygieneRig, cleanlinessPct, miteInfested ? miteInfestationPct : 0, stage);
    const state = {
      ...room,
      scene,
      camera,
      renderer,
      mobileLod,
      sparkles,
      hygieneRig,
      plant: null,
      potModel: null,
      careRig: null,
      models: new Set(),
      equipmentModels: {},
      fanModels: [],
      fanLevel: level(equipment, "osc_fans"),
      leafNodes: [],
      colaNodes: [],
      transitions: [],
      irrigationLevel: level(equipment, "irrigation"),
      fxDoneNonce: null,
      hygieneFxDoneNonce: null,
      disposed: false,
      animationFrame: 0,
      startedAt: performance.now(),
      lastFrameAt: performance.now(),
      cameraTargetZ: 3.25,
    };
    stateRef.current = state;

    const initialPot = potVisual(level(equipment, "pots"));
    const required = [
      initialPot.url,
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
          loadWeedModel(initialPot.url, { height: initialPot.height, preserveOrigin: true }),
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
        const initialSoilY = preparePotModel(potModel, initialPot);
        state.potRig.add(potModel);
        state.potModel = potModel;
        state.soil.position.y = initialSoilY;
        state.plantRig.position.y = initialSoilY;
        state.soil.scale.set(initialPot.soilScale, 1, initialPot.soilScale);
        state.fallbackPot.visible = false;
        state.careRig = createCareRig(state.growZone, canModel, bottleModel, state.soil, mobileLod);
        state.careRig.splash.position.y = initialSoilY + 0.033;
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
      const frameDelta = Math.min(0.05, Math.max(0, (now - state.lastFrameAt) / 1000));
      state.lastFrameAt = now;
      const careActive = !!state.careRig?.kind;
      const fanModel = state.equipmentModels.fan;
      const fanRunning = !!fanModel?.visible && state.fanLevel > 0;
      const fanSpeed = fanRunning ? 7 + Math.min(8, state.fanLevel * 0.85) : 0;
      state.fanModels.forEach((activeFan, index) => {
        if (!activeFan.visible || !fanRunning) return;
        const bladeRotor = activeFan.userData.bladeRotor;
        const fanHead = activeFan.userData.fanHead;
        if (bladeRotor) bladeRotor.rotation.z -= fanSpeed * frameDelta * (index % 2 ? 0.94 : 1);
        if (fanHead) {
          fanHead.rotation.y =
            Math.sin(elapsed * (0.62 + state.fanLevel * 0.025) + index * Math.PI) * 0.42;
        }
      });
      if (state.dustMotes) {
        state.dustMotes.rotation.y = elapsed * 0.028;
        state.dustMotes.position.y = Math.sin(elapsed * 0.34) * 0.018;
      }
      state.fixture?.userData?.chains?.forEach((chain, index) => {
        chain.rotation.z = Math.sin(elapsed * 0.55 + index * Math.PI) * 0.008;
      });

      if (state.plant && !careActive) {
        const heavyFlower = state.plant.userData.stage === "flower" || state.plant.userData.stage === "harvest_ready";
        const stageDamping = state.plant.userData.stage === "seedling" ? 0.65 : heavyFlower ? 0.85 : 1;
        const airflow = fanRunning ? Math.min(1, 0.34 + state.fanLevel * 0.1) : 0.12;
        const gust = fanRunning ? 0.76 + Math.sin(elapsed * (0.62 + state.fanLevel * 0.025)) * 0.24 : 0.35;
        state.plant.rotation.y = Math.sin(elapsed * 0.42) * 0.042 * airflow * stageDamping;
        state.plant.rotation.z =
          (Math.sin(elapsed * 0.86) + Math.sin(elapsed * 2.15) * 0.22) *
          0.075 *
          airflow *
          gust *
          stageDamping;
        if (!state.mobileLod || Math.floor(now / 32) % 2 === 0) {
          state.leafNodes.forEach((leaf, index) => {
            const baseZ = leaf.userData.airflowBaseZ ?? 0;
            const baseX = leaf.userData.airflowBaseX ?? 0;
            const phase = leaf.userData.airflowPhase ?? index * 0.47;
            leaf.rotation.z =
              baseZ + Math.sin(elapsed * (2.15 + airflow) + phase) * 0.07 * airflow * gust * stageDamping;
            leaf.rotation.x =
              baseX + Math.cos(elapsed * 1.72 + phase) * 0.03 * airflow * gust * stageDamping;
          });
          state.colaNodes.forEach((cola, index) => {
            const phase = cola.userData.airflowPhase ?? index * 0.61;
            cola.rotation.z =
              (cola.userData.airflowBaseZ ?? 0) +
              Math.sin(elapsed * 1.35 + phase) * 0.018 * airflow * gust * stageDamping;
            cola.rotation.x =
              (cola.userData.airflowBaseX ?? 0) +
              Math.cos(elapsed * 1.1 + phase) * 0.01 * airflow * gust * stageDamping;
          });
        }
      }
      state.sparkles.rotation.y = elapsed * 0.08;
      state.sparkles.material.opacity = 0.68 + Math.sin(elapsed * 2.2) * 0.14;

      for (let i = state.transitions.length - 1; i >= 0; i--) {
        const transition = state.transitions[i];
        const amount = Math.min(1, (now - transition.start) / transition.duration);
        setOpacity(transition.object, transition.from + (transition.to - transition.from) * amount);
        if (amount >= 1) {
          state.transitions.splice(i, 1);
          if (transition.remove) {
            (transition.parent || state.plantRig).remove(transition.object);
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
      if (state.hygieneRig) {
        const hygieneFinished = updateHygieneFx(state.hygieneRig, now);
        if (hygieneFinished && state.hygieneFxDoneNonce !== null) {
          state.hygieneFxDoneNonce = null;
          propsRef.current.onFxDone?.();
        }
      }
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, state.cameraTargetZ, 0.1);
      camera.lookAt(0, 0.78, 0);
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
    const zoom = (event) => {
      event.preventDefault();
      state.cameraTargetZ = THREE.MathUtils.clamp(state.cameraTargetZ + event.deltaY * 0.0022, 1.65, 3.5);
    };
    const toggleZoom = () => {
      state.cameraTargetZ = state.cameraTargetZ > 2.4 ? 1.72 : 3.25;
    };
    renderer.domElement.addEventListener("wheel", zoom, { passive: false });
    renderer.domElement.addEventListener("dblclick", toggleZoom);

    return () => {
      cancelled = true;
      state.disposed = true;
      cancelAnimationFrame(state.animationFrame);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("wheel", zoom);
      renderer.domElement.removeEventListener("dblclick", toggleZoom);
      if (state.careRig) disposeCareRig(state.careRig);
      if (state.hygieneRig) disposeHygieneRig(state.hygieneRig);
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
        applyPlantPhenotype(model, budMeshKey, normalizedStage, quality, lightClass);
        applyInfestationStress(
          model,
          propsRef.current.miteInfested ? propsRef.current.miteInfestationPct : 0
        );
        const p = Math.max(0, Math.min(1, Number(progress) || 0));
        const growth = 0.88 + p * 0.12;
        model.scale.set(...strainScale(strainType, growth));
        model.userData.stage = normalizedStage;
        const leafNodes = [];
        const colaNodes = [];
        model.traverse((object) => {
          if (object.name === "FanLeaf" || object.name === "SugarLeaf") {
            object.userData.airflowBaseZ = object.rotation.z;
            object.userData.airflowBaseX = object.rotation.x;
            object.userData.airflowPhase = leafNodes.length * 0.73 + Math.random() * 0.25;
            leafNodes.push(object);
          } else if (object.name === "BudCluster") {
            object.userData.airflowBaseZ = object.rotation.z;
            object.userData.airflowBaseX = object.rotation.x;
            object.userData.airflowPhase = colaNodes.length * 0.61 + Math.random() * 0.18;
            colaNodes.push(object);
          }
        });
        setOpacity(model, 0);
        state.plantRig.add(model);
        state.models.add(model);
        if (state.plant && state.plant !== model) {
          state.transitions.push({ object: state.plant, from: 1, to: 0, start: performance.now(), duration: 320, remove: true });
        }
        state.plant = model;
        state.leafNodes = leafNodes;
        state.colaNodes = colaNodes;
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
        state.leafNodes = [];
        state.colaNodes = [];
        setLoadWarning(`Plant model failed to load: ${url}. Showing fallback.`);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [sceneReady, stage, progress, strainType, budMeshKey, quality, lightClass]);

  useEffect(() => {
    const state = stateRef.current;
    if (!sceneReady || !state) return undefined;
    let stale = false;
    const tents = level(equipment, "tents");
    const mylar = level(equipment, "mylar");
    const pots = level(equipment, "pots");
    const irrigationLevel = level(equipment, "irrigation");
    state.fanLevel = level(equipment, "osc_fans");
    state.irrigationLevel = irrigationLevel;
    if (state.careRig) {
      state.careRig.autoWater = !!autoWater;
      state.careRig.autoFeed = !!autoFeed;
    }
    state.tent.visible = tents >= 1;
    state.tent.scale.setScalar(tents >= 8 || houseTier >= 2 ? 1.14 : tents >= 4 ? 1.07 : 1);
    if (state.tent.userData.mylar) {
      state.tent.userData.mylar.metalness = 0.5 + Math.min(0.3, mylar * 0.04);
      state.tent.userData.mylar.color.setHex(mylar >= 3 ? 0xe4e4df : 0xc9c8c1);
    }
    state.potRig.scale.setScalar(1);
    if (state.careRig) setIrrigationVisibility(state.careRig, irrigationLevel);
    applyEquipmentVisualLevels(state, equipment);

    const syncPot = async () => {
      const visual = potVisual(pots);
      if (state.potModel?.userData?.potUrl === visual.url) {
        state.soil.scale.set(visual.soilScale, 1, visual.soilScale);
        return;
      }
      try {
        const nextPot = await loadWeedModel(visual.url, {
          height: visual.height,
          preserveOrigin: true,
        });
        if (stale || state.disposed) {
          disposeModelClone(nextPot);
          return;
        }
        const nextSoilY = preparePotModel(nextPot, visual);
        setOpacity(nextPot, 0);
        state.potRig.add(nextPot);
        state.models.add(nextPot);
        if (state.potModel) {
          state.transitions.push({
            object: state.potModel,
            parent: state.potRig,
            from: 1,
            to: 0,
            start: performance.now(),
            duration: 280,
            remove: true,
          });
        }
        state.potModel = nextPot;
        state.soil.position.y = nextSoilY;
        state.plantRig.position.y = nextSoilY;
        if (state.careRig) state.careRig.splash.position.y = nextSoilY + 0.033;
        state.soil.scale.set(visual.soilScale, 1, visual.soilScale);
        state.transitions.push({
          object: nextPot,
          from: 0,
          to: 1,
          start: performance.now(),
          duration: 320,
        });
      } catch {
        setLoadWarning(`Pot upgrade model failed to load: ${visual.url}`);
      }
    };

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
            if (key === "fan") {
              model.userData.bladeRotor = model.getObjectByName("bladeRotor");
              model.userData.fanHead =
                model.getObjectByName("fanHead") ||
                model.getObjectByName("oscillationHead") ||
                model.getObjectByName("head");
              state.fanModels.push(model);
            }
          } catch (error) {
            setLoadWarning(`Equipment model failed to load: ${config.url}`);
          }
        }
        if (model) {
          model.visible = visible;
          const detailScale = 1 + Math.min(0.16, Math.max(0, ownedLevel - 1) * 0.025);
          model.scale.setScalar(detailScale);
        }
        if (state.equipmentSupports?.[key]) state.equipmentSupports[key].visible = visible;
        if (key === "fan" && visible && ownedLevel >= 8 && !state.equipmentModels.fanSecondary) {
          try {
            const secondary = await loadWeedModel(config.url, { height: 0.68 });
            if (stale || state.disposed) {
              disposeModelClone(secondary);
              return;
            }
            secondary.position.set(-0.72, 0, -0.5);
            secondary.rotation.set(0, 1.15, 0);
            secondary.userData.bladeRotor = secondary.getObjectByName("bladeRotor");
            secondary.userData.fanHead = secondary.getObjectByName("head");
            state.props.add(secondary);
            state.models.add(secondary);
            state.equipmentModels.fanSecondary = secondary;
            state.fanModels.push(secondary);
          } catch {
            setLoadWarning(`Second fan model failed to load: ${config.url}`);
          }
        }
        if (key === "fan" && state.equipmentModels.fanSecondary) {
          state.equipmentModels.fanSecondary.visible = visible && ownedLevel >= 8;
        }
      }
    };
    syncPot();
    syncEquipment();
    void curingCount;
    return () => {
      stale = true;
    };
  }, [sceneReady, equipment, houseTier, autoWater, autoFeed, curingCount]);

  useEffect(() => {
    const state = stateRef.current;
    if (!sceneReady || !state?.hygieneRig) return;
    setHygieneState(
      state.hygieneRig,
      cleanlinessPct,
      miteInfested ? miteInfestationPct : 0,
      stage
    );
    applyInfestationStress(state.plant, miteInfested ? miteInfestationPct : 0);
  }, [sceneReady, cleanlinessPct, miteInfestationPct, miteInfested, stage]);

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
    if (fx === "clean" || fx === "ipm") {
      if (state.hygieneRig && startHygieneFx(state.hygieneRig, fx)) {
        state.hygieneFxDoneNonce = fxNonce;
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
