import {
  Color,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type CanvasTexture,
  Mesh,
  type Scene
} from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { Refractor } from "three/examples/jsm/objects/Refractor.js";
import { TANK } from "./dimensions";
import { SURFACE_Y } from "./tank";
import { makeWaterNormalTextures } from "../utils/textures";

// Real planar reflection/refraction for the surface, seen from below. The
// surface renders the scene twice into half-float targets (a reflected and a
// refracted virtual camera) and the custom shader below blends those colors
// with a Schlick fresnel term, distorts both projective samples with combined
// multi-scale normal ripples, and adds a transmitted sun glint derived from
// Snell's law. The shader outputs linear color: the composer's OutputPass
// applies tone mapping and the color space conversion at the end of the chain,
// so this shader never tone maps or converts itself.
interface WaterShaderDef {
  name: string;
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

const WaterShader: WaterShaderDef = {
  name: "UnderwaterWaterShader",
  uniforms: {
    color: { value: null }, // absorption tint, set from options.color
    reflectivity: { value: 0 },
    tReflectionMap: { value: null },
    tRefractionMap: { value: null },
    tNormalMap0: { value: null },
    tNormalMap1: { value: null },
    textureMatrix: { value: null },
    config: { value: new Vector4() },
    uTime: { value: 0 },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uF0: { value: 0.02 }, // water reflectance at normal incidence
    uEta: { value: 1.0 / 1.333 }, // air-to-water index ratio
    uAbsorption: { value: 0.32 },
    uNormalStrength: { value: 0.55 },
    uScale: { value: new Vector2(2.0, 4.6) },
    uDrift0: { value: new Vector2(0.035, -0.025) },
    uDrift1: { value: new Vector2(-0.045, 0.032) },
    uDistortion: { value: 0.035 },
    uGlintPower: { value: 220.0 },
    uGlintGain: { value: 0.9 },
    uSunColor: { value: new Color(0xfff2d8) }
  },
  vertexShader: /* glsl */ `
    #include <common>
    #include <fog_pars_vertex>

    uniform mat4 textureMatrix;
    uniform float uTime;

    varying vec4 vCoord;
    varying vec2 vUv;
    varying vec3 vToEye;

    void main() {
      vUv = uv;

      // Three directional wave trains displace the surface vertically. The
      // plane is rotated flat, so local X and Y lie in the world XZ plane and
      // local Z is the world up. Amplitudes sum to 0.045 m.
      vec3 displaced = position;
      displaced.z += 0.015 * sin(position.x * 0.9 + position.y * 0.55 + uTime * 1.2);
      displaced.z += 0.012 * sin(position.x * -0.7 + position.y * 0.95 + uTime * 0.8 + 1.9);
      displaced.z += 0.018 * sin(position.x * 0.35 + position.y * -1.15 + uTime * 1.5 + 0.6);

      // Projective reflection/refraction coordinates and the world position
      // both use the displaced vertex so the ripples warp the sampling.
      vCoord = textureMatrix * vec4(displaced, 1.0);

      vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
      vToEye = cameraPosition - worldPosition.xyz;

      vec4 mvPosition = viewMatrix * worldPosition;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    #include <common>
    #include <fog_pars_fragment>

    uniform sampler2D tReflectionMap;
    uniform sampler2D tRefractionMap;
    uniform sampler2D tNormalMap0;
    uniform sampler2D tNormalMap1;

    uniform vec3 color;
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform float uF0;
    uniform float uEta;
    uniform float uAbsorption;
    uniform float uNormalStrength;
    uniform vec2 uScale;
    uniform vec2 uDrift0;
    uniform vec2 uDrift1;
    uniform float uDistortion;
    uniform float uGlintPower;
    uniform float uGlintGain;
    uniform vec3 uSunColor;

    varying vec4 vCoord;
    varying vec2 vUv;
    varying vec3 vToEye;

    void main() {
      vec3 viewDir = normalize(vToEye);

      // Multi-scale waves: the two runtime normal maps are sampled at different
      // scales and drift in different directions with uTime, then combined into
      // one tangent-space normal.
      vec2 p0 = vUv * uScale.x + uTime * uDrift0;
      vec2 p1 = vUv * uScale.y + uTime * uDrift1;
      vec3 n0 = texture2D(tNormalMap0, p0).xyz * 2.0 - 1.0;
      vec3 n1 = texture2D(tNormalMap1, p1).xyz * 2.0 - 1.0;
      vec3 mapN = normalize(vec3((n0.xy + n1.xy) * uNormalStrength, n0.z + n1.z));

      // The plane's front face points down, so the tangent-space up (map z)
      // maps to world -Y; fold it into the shading normal so it points up
      // toward the air, from where the light arrives.
      vec3 N = normalize(vec3(mapN.x, mapN.z, mapN.y));

      // Schlick fresnel with the water F0 (~0.02). N is the air-side +Y normal
      // while viewDir points from the surface to the underwater camera, so the
      // cosine compares N with the opposing -viewDir.
      float theta = max(dot(-viewDir, N), 0.0);
      float reflectance = uF0 + (1.0 - uF0) * pow(1.0 - theta, 5.0);

      // Projective coordinates into both render targets, distorted by the
      // combined normal.
      vec3 coord = vCoord.xyz / vCoord.w;
      vec2 uv = coord.xy + coord.z * N.xz * uDistortion;

      vec4 reflectColor = texture2D(tReflectionMap, vec2(1.0 - uv.x, uv.y));
      vec4 refractColor = texture2D(tRefractionMap, uv);

      // Blend the actual render-target colors with fresnel, then absorb toward
      // the blue-green character. Mixing tints instead of multiplying, so the
      // sampled scene is never crushed toward black.
      // The tank has no modeled above-water environment, so a dominant mirror
      // capture turns reflected floor and rock geometry into dark floating
      // shapes. Keep the live reflection as a restrained surface cue while the
      // refraction map supplies most of the visible detail.
      float reflectionWeight = reflectance * 0.18;
      vec3 scene = mix(refractColor.rgb, reflectColor.rgb, reflectionWeight);
      float absorb = uAbsorption * (0.5 + 0.5 * reflectance);
      vec3 c = mix(scene, color, absorb);

      // Transmitted sun highlight: refract the incoming sun ray from air to
      // water and compare the transmitted direction to the view direction, so
      // the glint tracks the real sun position instead of a fixed screen spot.
      vec3 transmitted = refract(-uSunDir, N, uEta);
      float glint = pow(max(dot(transmitted, viewDir), 0.0), uGlintPower);
      c += uSunColor * glint * uGlintGain;

      gl_FragColor = vec4(c, 1.0);
      #include <fog_fragment>
    }
  `
};

// Resize-safe replacement for the Water2 wrapper. Water2 keeps its Reflector
// and Refractor private, so its capture targets are fixed at the constructor
// size and cannot follow window resizes. This adapter reproduces the small part
// of Water2's orchestration this scene uses, with direct references to both
// capture render targets so their size can be updated on resize.
class WaterSurface extends Mesh {
  readonly reflector: Reflector;
  readonly refractor: Refractor;
  override material: ShaderMaterial;

  private readonly normalMap0: CanvasTexture;
  private readonly normalMap1: CanvasTexture;
  private readonly textureMatrix = new Matrix4();
  private textureWidth: number;
  private textureHeight: number;

  constructor(
    geometry: PlaneGeometry,
    shader: WaterShaderDef,
    options: {
      color: number;
      textureWidth: number;
      textureHeight: number;
      clipBias?: number;
      normalMap0: CanvasTexture;
      normalMap1: CanvasTexture;
    }
  ) {
    super(geometry);

    this.textureWidth = options.textureWidth;
    this.textureHeight = options.textureHeight;
    this.normalMap0 = options.normalMap0;
    this.normalMap1 = options.normalMap1;

    const clipBias = options.clipBias ?? 0;
    this.reflector = new Reflector(geometry, {
      textureWidth: options.textureWidth,
      textureHeight: options.textureHeight,
      clipBias
    });
    this.refractor = new Refractor(geometry, {
      textureWidth: options.textureWidth,
      textureHeight: options.textureHeight,
      clipBias
    });
    this.reflector.matrixAutoUpdate = false;
    this.refractor.matrixAutoUpdate = false;

    this.material = new ShaderMaterial({
      name: shader.name,
      uniforms: UniformsUtils.merge([UniformsLib.fog, shader.uniforms]),
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      transparent: true,
      fog: true
    });

    this.material.uniforms.color.value = new Color(options.color);
    this.material.uniforms.reflectivity.value = 0.02;
    this.material.uniforms.tReflectionMap.value = this.reflector.getRenderTarget().texture;
    this.material.uniforms.tRefractionMap.value = this.refractor.getRenderTarget().texture;
    this.material.uniforms.tNormalMap0.value = options.normalMap0;
    this.material.uniforms.tNormalMap1.value = options.normalMap1;
    this.material.uniforms.textureMatrix.value = this.textureMatrix;
    // config drives Water2's flow animation; the custom shader drifts the
    // normal samples with uTime instead, so it stays at its default values.
    (this.material.uniforms.config.value as Vector4).w = 1;

    // Capture pass: hide the surface, render the scene from the reflected and
    // refracted virtual cameras into their targets, then restore. Skipped while
    // an override material is active (GTAO/DOF normal and depth passes) so the
    // captures never recurse into those renders.
    this.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      if (scene.overrideMaterial) return;
      this.updateTextureMatrix(camera);
      this.visible = false;
      this.reflector.matrixWorld.copy(this.matrixWorld);
      this.refractor.matrixWorld.copy(this.matrixWorld);
      this.reflector.onBeforeRender(renderer, scene, camera, geometry, material, group);
      this.refractor.onBeforeRender(renderer, scene, camera, geometry, material, group);
      this.visible = true;
    };
  }

  // Projective matrix that maps the surface's world position into the capture
  // target's [0,1] space for the current camera.
  private updateTextureMatrix(camera: Camera): void {
    const m = this.textureMatrix;
    m.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    m.multiply(camera.projectionMatrix);
    m.multiply(camera.matrixWorldInverse);
    m.multiply(this.matrixWorld);
  }

  // Resize both capture render targets. No-op when the dimensions did not
  // change; the WebGLRenderTarget objects are kept, only their backing
  // resources are recreated.
  resizeTargets(width: number, height: number): void {
    if (width === this.textureWidth && height === this.textureHeight) return;
    this.textureWidth = width;
    this.textureHeight = height;
    this.reflector.getRenderTarget().setSize(width, height);
    this.refractor.getRenderTarget().setSize(width, height);
  }

  dispose(): void {
    this.reflector.dispose();
    this.refractor.dispose();
    this.normalMap0.dispose();
    this.normalMap1.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}

export function buildWater(scene: Scene, sunPosition: Vector3): Mesh {
  const normalMaps = makeWaterNormalTextures();
  // Keep the full 0.045 m wave displacement below the tank's dark top face.
  // Intersections at the old 0.02 m clearance appeared as broad oval shadows.
  const surfaceY = SURFACE_Y - 0.06;

  // Capture targets follow the window and device DPR, capped at 1024 on each
  // axis independently. Reflector and Refractor default to 4 multisamples.
  const dpr = window.devicePixelRatio || 1;
  const textureWidth = Math.min(Math.floor(window.innerWidth * dpr), 1024);
  const textureHeight = Math.min(Math.floor(window.innerHeight * dpr), 1024);

  const water = new WaterSurface(new PlaneGeometry(TANK.width, TANK.depth, 128, 128), WaterShader, {
    color: 0x1a5a66,
    textureWidth,
    textureHeight,
    normalMap0: normalMaps.normalMap0,
    normalMap1: normalMaps.normalMap1
  });

  // The front face points down (-Y). Pointing it up would put both capture
  // virtual cameras under the surface, where the mirror and refraction passes
  // are skipped and there is nothing to capture; pointing it down keeps both
  // passes on the air side so they render for the below-surface camera.
  water.rotation.x = Math.PI / 2;
  water.position.y = surfaceY;
  water.name = "water";

  // Direction from the surface centre toward the sun's world position.
  const surfaceCentre = new Vector3(0, surfaceY, 0);
  (water.material.uniforms.uSunDir.value as Vector3)
    .copy(sunPosition)
    .sub(surfaceCentre)
    .normalize();

  scene.add(water);
  return water;
}

// Recompute the capture dimensions from the current window and device DPR,
// capped at 1024 per axis, resizing both targets only when they changed.
export function resizeWater(water: Mesh): void {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.min(Math.floor(window.innerWidth * dpr), 1024);
  const height = Math.min(Math.floor(window.innerHeight * dpr), 1024);
  (water as WaterSurface).resizeTargets(width, height);
}

export function updateWater(water: Mesh, dt: number): void {
  const mat = water.material as ShaderMaterial;
  (mat.uniforms.uTime.value as number) += dt * 0.6;
}
