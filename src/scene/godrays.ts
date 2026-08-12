import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Vector2,
  type Scene
} from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { makeMoteSprite } from "../utils/textures";
import { TANK } from "./dimensions";

// Screen-space volumetric light scattering (god rays). Radially blurs the bright
// parts of the frame outward from the sun's projected screen position. Cheap
// approximation of light shafts; good enough for the WebGL2 path.
const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLightPos: { value: new Vector2(0.5, 1.1) },
    uExposure: { value: 0.18 },
    uDecay: { value: 0.95 },
    uDensity: { value: 0.7 },
    uWeight: { value: 0.44 },
    uThreshold: { value: 0.64 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    #define SAMPLES 60
    uniform sampler2D tDiffuse;
    uniform vec2 uLightPos;
    uniform float uExposure, uDecay, uDensity, uWeight, uThreshold;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 coord = vUv;
      vec2 delta = (vUv - uLightPos) * (uDensity / float(SAMPLES));
      float illumDecay = 1.0;
      vec3 accum = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        coord -= delta;
        vec3 s = texture2D(tDiffuse, coord).rgb;
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        vec3 bright = s * smoothstep(uThreshold, 1.0, lum);
        accum += bright * illumDecay * uWeight;
        illumDecay *= uDecay;
      }
      // Fade out when the sun is well off screen.
      float onScreen = smoothstep(0.6, 0.0, length(uLightPos - vec2(0.5)) - 0.5);
      gl_FragColor = base + vec4(accum * uExposure * onScreen, 0.0);
    }
  `
};

export function createGodRaysPass(): ShaderPass {
  return new ShaderPass(GodRaysShader);
}

interface BeamUniforms {
  uTime: { value: number };
}

const beamUniforms: BeamUniforms[] = [];

// Soft scene-space shafts complement the screen-space scattering pass. The
// planes face the fixed aquarium camera, fade at every edge and remain faint
// enough that fish colors are not replaced by additive white.
export function buildLightBeams(scene: Scene): Group {
  const group = new Group();
  group.name = "light-beams";

  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color(0x79c5cf) },
      uOpacity: { value: 0.075 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;

      void main() {
        vUv = uv;
        vec3 shaped = position;
        // The underwater portion occupies the lower third of the extended
        // card. Light enters through a smaller patch at the surface and
        // spreads as it travels down through the water column.
        float underwaterT = clamp(uv.y * 3.0, 0.0, 1.0);
        shaped.x *= mix(1.0, 0.35, underwaterT);
        vec4 worldPosition = modelMatrix * vec4(shaped, 1.0);
        vWorldPos = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vWorldPos;

      void main() {
        float across = pow(sin(3.14159265 * vUv.x), 2.4);
        float vertical = smoothstep(0.0, 0.05, vUv.y)
          * (1.0 - smoothstep(0.75, 0.95, vUv.y));
        // Fade broadly below the water plane so depth clipping never exposes a
        // hard horizontal boundary where the shaft enters the tank.
        vertical *= 1.0 - smoothstep(1.2, 3.45, vWorldPos.y);
        float shimmer = 0.82 + 0.18 * sin(
          vWorldPos.y * 1.7 + vWorldPos.x * 2.3 + uTime * 0.32
        );
        float strands = 0.78 + 0.22 * sin(vUv.x * 35.0 + uTime * 0.21);
        float alpha = uOpacity * across * vertical * shimmer * strands;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    side: DoubleSide
  });
  beamUniforms.push(material.uniforms as unknown as BeamUniforms);

  // Extend above the tank so the plane's upper edge is never visible from the
  // underwater camera. The tank and water depth naturally clip the shaft at
  // the surface instead of exposing a rectangular card boundary.
  const geometry = new PlaneGeometry(1, TANK.height * 3);
  const placements: Array<[number, number, number, number]> = [
    [-5.2, -4.5, 2.0, -0.08],
    [-1.7, -7.0, 2.8, 0.06],
    [2.2, -5.5, 2.3, -0.05],
    [5.6, -8.0, 1.7, 0.08]
  ];
  for (const [x, z, width, tilt] of placements) {
    const beam = new Mesh(geometry, material);
    beam.position.set(x, TANK.height, z);
    beam.scale.x = width;
    beam.rotation.z = tilt;
    beam.frustumCulled = false;
    group.add(beam);
  }

  scene.add(group);
  return group;
}

export function updateLightBeams(time: number): void {
  for (const uniforms of beamUniforms) uniforms.uTime.value = time;
}

// Suspended particles (motes) drifting slowly to sell the water volume. They
// are confined to the viewed region in front of the camera rather than the
// whole tank.
export class Motes {
  readonly points: Points;
  private velocities: Float32Array;
  private count: number;

  constructor(scene: Scene, count: number) {
    this.count = count;
    const positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * 7;
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * 3.4;
      positions[i * 3 + 2] = -9 + Math.random() * 16;
      this.velocities[i * 3] = (Math.random() - 0.5) * 0.02;
      this.velocities[i * 3 + 1] = Math.random() * 0.03 + 0.005;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    const mat = new PointsMaterial({
      size: 0.035,
      map: makeMoteSprite(),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      opacity: 0.5,
      color: 0xbfe9f0,
      sizeAttenuation: true
    });
    this.points = new Points(geo, mat);
    this.points.name = "motes";
    scene.add(this.points);
  }

  dispose(): void {
    this.points.parent?.remove(this.points);
    this.points.geometry.dispose();
    const mat = this.points.material as PointsMaterial;
    mat.dispose();
    mat.map?.dispose();
  }

  update(dt: number): void {
    const pos = this.points.geometry.getAttribute("position") as BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      a[i * 3] += this.velocities[i * 3] * dt;
      a[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      a[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      // Wrap when a particle rises above the viewed region; respawn at the bottom.
      if (a[i * 3 + 1] > 3.4) {
        a[i * 3 + 1] = -3.4;
        a[i * 3] = (Math.random() * 2 - 1) * 7;
        a[i * 3 + 2] = -9 + Math.random() * 16;
      }
    }
    pos.needsUpdate = true;
  }
}
