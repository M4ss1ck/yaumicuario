import {
  Vector2,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { createGodRaysPass } from "../scene/godrays";
import type { QualitySettings } from "../quality";

// Cinematic color grade: blue-green tint, vignette and a faint film grain.
const GradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.1 },
    uGrain: { value: 0.04 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // Push toward a cool blue-green underwater grade.
      c.r *= 0.92;
      c.b *= 1.05;
      c.g *= 1.02;
      // Vignette.
      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.85, 0.2, dot(d, d) * uVignette * 2.0);
      c *= mix(0.55, 1.0, vig);
      // Film grain. This pass runs before tone mapping, so c is still linear and
      // shadows sit near zero: adding a constant amplitude there swamps them and
      // reads as blotchy mottling. Scale the grain with local brightness so dark
      // areas stay clean.
      float g = hash(vUv * vec2(1920.0, 1080.0) + uTime) - 0.5;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      c += g * uGrain * (0.15 + lum);
      gl_FragColor = vec4(c, 1.0);
    }
  `
};

export class PostPipeline {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private bokeh: BokehPass;
  private godrays: ShaderPass;
  private grading: ShaderPass;
  private sunScreen = new Vector2(0.5, 1.1);

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    quality: QualitySettings
  ) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(w, h);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bokeh = new BokehPass(scene, camera, {
      focus: camera.position.length(),
      aperture: 0.0006,
      maxblur: 0.008
    });
    this.composer.addPass(this.bokeh);

    this.godrays = createGodRaysPass();
    this.composer.addPass(this.godrays);

    this.bloom = new UnrealBloomPass(new Vector2(w, h), 0.55, 0.4, 0.82);
    this.composer.addPass(this.bloom);

    this.grading = new ShaderPass(GradingShader);
    this.composer.addPass(this.grading);

    this.composer.addPass(new OutputPass());

    this.applyQuality(quality);
  }

  applyQuality(q: QualitySettings): void {
    this.bloom.enabled = q.bloom;
    this.bokeh.enabled = q.dof;
    this.godrays.enabled = q.godRays;
  }

  setSunScreenPos(x: number, y: number): void {
    this.sunScreen.set(x, y);
    (this.godrays.uniforms.uLightPos.value as Vector2).copy(this.sunScreen);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  render(dt: number, time: number): void {
    this.grading.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
