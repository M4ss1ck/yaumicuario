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
import { viewBottomAt, viewTopAt } from "./dimensions";

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
    uThreshold: { value: 0.64 },
    uTime: { value: 0 },
    uBeamStrength: { value: 0.075 }
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
    uniform float uTime, uBeamStrength;
    varying vec2 vUv;

    float softBeam(float x, float center, float width) {
      float d = (x - center) / width;
      return exp(-d * d * 2.0);
    }

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
      vec3 scattered = accum * uExposure * onScreen;

      // Uncapped shafts enter from the top edge of the frame and fade through
      // the water column. They live in this existing post pass, so transparent
      // geometry cannot leak into GTAO, shadows or water capture targets.
      float drift = sin(uTime * 0.11) * 0.008;
      float beams =
        softBeam(vUv.x, 0.20 + drift, 0.055) * 0.75 +
        softBeam(vUv.x, 0.41 - drift, 0.070) +
        softBeam(vUv.x, 0.62 + drift, 0.060) * 0.9 +
        softBeam(vUv.x, 0.79 - drift, 0.050) * 0.7;
      float waterDepth = mix(0.2, 1.0, smoothstep(0.02, 1.0, vUv.y));
      float shimmer = 0.88 + 0.12 * sin(vUv.y * 19.0 + uTime * 0.24);
      float preserveHighlights = 1.0 - smoothstep(0.45, 1.0, dot(base.rgb, vec3(0.299, 0.587, 0.114)));
      vec3 beamLight = vec3(0.36, 0.72, 0.76)
        * beams * waterDepth * shimmer * preserveHighlights * uBeamStrength;

      gl_FragColor = base + vec4(scattered + beamLight, 0.0);
    }
  `
};

export function createGodRaysPass(): ShaderPass {
  return new ShaderPass(GodRaysShader);
}

// Suspended particles (motes) drifting slowly to sell the water volume. They
// are confined to the viewed region in front of the camera rather than the
// whole tank.
// Clearance beyond the frame edge, so the wrap happens a little outside the
// picture rather than exactly on the boundary.
const MOTE_EDGE_MARGIN = 0.25;

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
    // Same reason as the bubble column: the water surface is transparent too,
    // and its origin is nearer the camera than the mote cloud's, so three.js
    // sorts it after and composites it over the motes. Every mote is below the
    // surface, so drawing them after it is both correct and what keeps the ones
    // high in the water column visible instead of washing out.
    this.points.renderOrder = 2;
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
      // Wrap when a particle rises above the viewed region; respawn below it.
      // Both edges have to be taken at the particle's own depth: the frame
      // spreads with distance, so a fixed 3.4 ceiling sat 86% of the way up the
      // screen for the far motes and they blinked out in plain sight.
      const z = a[i * 3 + 2];
      if (a[i * 3 + 1] > viewTopAt(z) + MOTE_EDGE_MARGIN) {
        a[i * 3] = (Math.random() * 2 - 1) * 7;
        a[i * 3 + 2] = -9 + Math.random() * 16;
        a[i * 3 + 1] = viewBottomAt(a[i * 3 + 2]) - MOTE_EDGE_MARGIN;
      }
    }
    pos.needsUpdate = true;
  }
}
