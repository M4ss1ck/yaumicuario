import {
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Scene
} from "three";
import { TANK } from "./dimensions";
import { SURFACE_Y } from "./tank";

// Top water surface, always seen from below. THREE.Water is built for looking
// down at a reflective surface: its mirror pass has nothing meaningful to sample
// from underneath, so it resolves to a flat grey slab. From below a real surface
// reads as rippling *emitted* light instead, which is what this shader draws.
const SurfaceShader = {
  uniforms: UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uDeep: { value: new Vector3(0.02, 0.11, 0.14) },
      uBright: { value: new Vector3(0.55, 0.85, 0.85) }
    }
  ]),
  vertexShader: /* glsl */ `
    varying vec2 vSurfUv;
    #include <fog_pars_vertex>
    void main() {
      vSurfUv = uv;
      #include <begin_vertex>
      #include <project_vertex>
      #include <fog_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uDeep, uBright, uSunDir;
    varying vec2 vSurfUv;
    #include <fog_pars_fragment>

    // Interfering wave trains: where crests cross, light focuses and the surface
    // flares, which is the shimmer you see looking up through water.
    float waves(vec2 p, float t) {
      float w = 0.0;
      w += sin(p.x * 6.0 + t * 1.1);
      w += sin(p.y * 5.3 - t * 0.9);
      w += sin((p.x + p.y) * 4.1 + t * 1.7);
      w += sin((p.x - p.y) * 7.3 - t * 1.3);
      return w * 0.25;
    }

    void main() {
      vec2 p = vSurfUv * vec2(12.0, 6.0);
      float w = waves(p, uTime);
      float crest = pow(clamp(w * 0.5 + 0.5, 0.0, 1.0), 3.0);
      // Fine chop layered over the swell keeps it from looking like a wallpaper.
      float chop = pow(clamp(waves(p * 2.7 + 3.1, uTime * 1.6) * 0.5 + 0.5, 0.0, 1.0), 6.0);
      vec3 c = mix(uDeep, uBright, crest * 0.55 + chop * 0.45);
      gl_FragColor = vec4(c, 1.0);
      #include <fog_fragment>
    }
  `
};

export function buildWater(scene: Scene, sunDir: Vector3): Mesh {
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.clone(SurfaceShader.uniforms),
    vertexShader: SurfaceShader.vertexShader,
    fragmentShader: SurfaceShader.fragmentShader,
    side: DoubleSide,
    fog: true
  });
  (material.uniforms.uSunDir.value as Vector3).copy(sunDir).normalize();

  const water = new Mesh(new PlaneGeometry(TANK.width, TANK.depth, 1, 1), material);
  water.rotation.x = -Math.PI / 2;
  water.position.y = SURFACE_Y - 0.02;
  water.name = "water";
  scene.add(water);
  return water;
}

export function updateWater(water: Mesh, dt: number): void {
  const mat = water.material as ShaderMaterial;
  (mat.uniforms.uTime.value as number) += dt * 0.6;
}
