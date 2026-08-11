import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PMREMGenerator,
  Vector3,
  type Scene,
  type WebGLRenderer
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SURFACE_Y } from "./tank";
import { HALF } from "./dimensions";
import type { QualitySettings } from "../quality";

export interface Lighting {
  sun: DirectionalLight;
  sunWorldPos: Vector3;
}

// Image-based lighting from a procedural room environment (no external HDRI
// needed) plus a directional "sun" punching down through the water surface.
export function buildLighting(
  scene: Scene,
  renderer: WebGLRenderer,
  quality: QualitySettings
): Lighting {
  const pmrem = new PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.75;

  // Blue-green exponential fog gives underwater depth and absorption, light
  // enough that the bright planted tank stays clear while the far walls dissolve.
  const fogColor = 0x0e3b40;
  scene.fog = new FogExp2(fogColor, 0.11);
  // Empty space matches the water color so fogged geometry blends into the
  // background.
  scene.background = new Color(fogColor);

  const hemi = new HemisphereLight(0x9fd8e6, 0x2a4a40, 0.55);
  scene.add(hemi);

  const sun = new DirectionalLight(0xfff2d8, 2.35);
  const sunWorldPos = new Vector3(HALF.x * 0.15, SURFACE_Y + 6, -HALF.z * 0.2);
  sun.position.copy(sunWorldPos);
  sun.target.position.set(0, -HALF.y, 0);
  sun.castShadow = quality.shadows;
  if (quality.shadows) {
    sun.shadow.mapSize.setScalar(quality.shadowMapSize);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    const s = 8;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
  }
  scene.add(sun);
  scene.add(sun.target);

  return { sun, sunWorldPos };
}
