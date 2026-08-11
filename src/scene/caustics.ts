import type { Material } from "three";
import { HALF } from "./dimensions";

// Procedural caustics: animated rippling light projected onto surfaces.
// We inject a cheap layered-cell pattern into a MeshStandardMaterial's emissive
// output via onBeforeCompile, driven by world position so it tiles seamlessly
// and reacts to depth (stronger near the surface, fading toward the floor).

interface CausticUniforms {
  uCausticTime: { value: number };
}

const registered: CausticUniforms[] = [];

const PARS = /* glsl */ `
  uniform float uCausticTime;
  varying vec3 vWorldPosCaustic;

  // Cheap pseudo-Voronoi caustics: distance to animated cell centers.
  float caustic(vec2 p, float t) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float md = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = fract(sin(vec2(
          dot(i + g, vec2(127.1, 311.7)),
          dot(i + g, vec2(269.5, 183.3)))) * 43758.5453);
        o = 0.5 + 0.5 * sin(t + 6.2831 * o);
        float d = length(g + o - f);
        md = min(md, d);
      }
    }
    return md;
  }
`;

const VERT_WORLD = /* glsl */ `
  vWorldPosCaustic = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_APPLY = /* glsl */ `
  {
    vec2 cp = vWorldPosCaustic.xz * 1.1;
    float t = uCausticTime;
    float c = caustic(cp, t) + caustic(cp * 1.9 + 7.0, t * 1.3);
    c = pow(clamp(1.0 - c * 0.7, 0.0, 1.0), 3.0);
    // Strongest on the floor (deep), fading toward the surface.
    float depthFade = smoothstep(${(HALF.y * 0.75).toFixed(2)}, ${(-HALF.y).toFixed(2)}, vWorldPosCaustic.y);
    vec3 causticColor = vec3(0.45, 0.8, 0.78) * c * depthFade * 1.1;
    totalEmissiveRadiance += causticColor;
  }
`;

// Meshes in a glTF often share one material instance, so this can be called
// several times for the same material. The injection chains, so guard it or the
// GLSL gets added twice and fails to compile with a redefinition error.
const injected = new WeakSet<Material>();

export function registerCaustics(material: Material): void {
  if (injected.has(material)) return;
  injected.add(material);

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uCausticTime = { value: 0 };
    registered.push(shader.uniforms as unknown as CausticUniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\n  varying vec3 vWorldPosCaustic;"
      )
      .replace(
        "#include <project_vertex>",
        VERT_WORLD + "\n#include <project_vertex>"
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + PARS)
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n" + FRAG_APPLY
      );
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function () {
    return prevKey.call(this) + "|caustics";
  };
  material.needsUpdate = true;
}

export function updateCaustics(time: number): void {
  for (const u of registered) u.uCausticTime.value = time;
}
