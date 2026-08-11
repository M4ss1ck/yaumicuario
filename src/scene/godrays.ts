import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
  Vector2,
  type Scene
} from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { makeMoteSprite } from "../utils/textures";

// Screen-space volumetric light scattering (god rays). Radially blurs the bright
// parts of the frame outward from the sun's projected screen position. Cheap
// approximation of light shafts; good enough for the WebGL2 path.
const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLightPos: { value: new Vector2(0.5, 1.1) },
    uExposure: { value: 0.25 },
    uDecay: { value: 0.95 },
    uDensity: { value: 0.7 },
    uWeight: { value: 0.5 },
    uThreshold: { value: 0.55 }
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
