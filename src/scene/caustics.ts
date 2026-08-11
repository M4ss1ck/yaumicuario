import type { Material, Texture } from "three";
import { HALF } from "./dimensions";
import { makeCausticsTexture } from "../utils/textures";

// Caustics: animated rippling light projected onto surfaces. One shared runtime
// texture of bright cell ridges is sampled twice at different world-XZ scales
// and drift directions; multiplying the two samples keeps the lit web narrow.
// We inject the result into a MeshStandardMaterial's emissive output via
// onBeforeCompile, driven by world position so it tiles seamlessly and reacts
// to depth (stronger near the surface, fading toward the floor).

interface CausticUniforms {
  uCausticTime: { value: number };
}

const registered: CausticUniforms[] = [];

// Created lazily on first use and shared by every injected material, so there
// is exactly one caustics texture per page instead of one per material.
let causticsMap: Texture | null = null;
function getCausticsMap(): Texture {
  if (!causticsMap) causticsMap = makeCausticsTexture();
  return causticsMap;
}

const PARS = /* glsl */ `
  uniform float uCausticTime;
  uniform sampler2D uCausticMap;
  varying vec3 vWorldPosCaustic;
`;

const VERT_WORLD = /* glsl */ `
  vWorldPosCaustic = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_APPLY = /* glsl */ `
  {
    // Two animated world-XZ projected samples at different scales and drift
    // directions. Their product is bright only where both webs cross, which
    // keeps the highlights restrained and narrow instead of washing the
    // surface out.
    vec2 p = vWorldPosCaustic.xz * 0.9 + uCausticTime * vec2(0.05, -0.03);
    vec2 q = vWorldPosCaustic.xz * 2.1 + 7.0 + uCausticTime * vec2(-0.04, 0.06);
    float web = texture2D(uCausticMap, p).r * texture2D(uCausticMap, q).r;
    float c = pow(clamp(web * 1.4, 0.0, 1.0), 2.0);
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
    shader.uniforms.uCausticMap = { value: getCausticsMap() };
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
