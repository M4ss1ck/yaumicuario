import type { Material } from "three";

// Fallback swim animation for fish models that ship without a skeletal clip.
// Bends the mesh laterally with a sine wave travelling along the body axis,
// stronger toward the extremities, to fake an undulating swim.

type Axis = "x" | "y" | "z";

interface WiggleUniforms {
  uWiggleTime: { value: number };
}

const registered: WiggleUniforms[] = [];

// Same guard as the caustics injection: chaining twice onto one material would
// redefine uWiggleTime and break the shader compile.
const injected = new WeakSet<Material>();

export function registerSwimWiggle(
  material: Material,
  bodyAxis: Axis,
  lateralAxis: Axis,
  bodyMin: number,
  bodyMax: number,
  amplitude: number,
  phase: number
): void {
  if (injected.has(material)) return;
  injected.add(material);

  const span = Math.max(bodyMax - bodyMin, 1e-3);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uWiggleTime = { value: 0 };
    shader.uniforms.uWigglePhase = { value: phase };
    registered.push(shader.uniforms as unknown as WiggleUniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\n  uniform float uWiggleTime;\n  uniform float uWigglePhase;"
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        {
          float bodyN = (position.${bodyAxis} - (${bodyMin.toFixed(4)})) / (${span.toFixed(4)});
          float tail = abs(bodyN - 0.5) * 2.0;
          transformed.${lateralAxis} += sin(bodyN * 6.2831 - uWiggleTime * 4.0 + uWigglePhase) * ${amplitude.toFixed(4)} * tail;
        }`
      );
  };
  // The phase is a uniform, not part of the source, so it must stay out of the
  // cache key: every instance of a species clones its material to get its own
  // phase, and keying on that gave each of the 87 non-animated fish meshes its
  // own shader program. Each of those compiled lazily, in whichever pass first
  // drew it, which is what produced the stalls in the first minute.
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function () {
    return (
      prevKey.call(this) +
      `|wiggle:${bodyAxis}:${lateralAxis}:${bodyMin}:${bodyMax}:${amplitude}`
    );
  };
  material.needsUpdate = true;
}

export function updateWiggle(time: number): void {
  for (const u of registered) u.uWiggleTime.value = time;
}
