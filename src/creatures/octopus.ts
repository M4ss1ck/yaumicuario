import { Group, Vector3, type Material, type Scene } from "three";

// An octopus perched on the hero reef mass.
//
// The source model is a photoscan with no rig, so all of its motion has to come
// from the vertex shader. Arms undulate on a travelling sine whose amplitude
// grows with distance from the mantle, so the body stays put while the arm tips
// curl; the whole animal also breathes and shifts its weight very slowly.
//
// It stays perched. The plan called for an occasional jet-glide to another
// perch, but a fixed-pose scan translated through open water reads as a prop
// being dragged rather than an animal swimming, and there is no rig to fix
// that. Motion in place is the honest version of what this asset can do.

interface OctopusUniforms {
  uOctopusTime: { value: number };
}

const registered: OctopusUniforms[] = [];
const injected = new WeakSet<Material>();

// Local-space radius past which a vertex counts as "arm" rather than "mantle".
// Measured as a fraction of the model's own extent, so it survives rescaling.
export function registerArmUndulation(material: Material, armStart: number, armEnd: number, amplitude: number): void {
  if (injected.has(material)) return;
  injected.add(material);

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uOctopusTime = { value: 0 };
    registered.push(shader.uniforms as unknown as OctopusUniforms);

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n  uniform float uOctopusTime;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        {
          // Arms are whatever is far from the body axis. The mantle sits near
          // the origin and barely moves; the tips travel most.
          float reach = smoothstep(${armStart.toFixed(4)}, ${armEnd.toFixed(4)}, length(position.xz));
          float t = uOctopusTime;
          // Phase varies along the arm so the curl travels outward instead of
          // the whole arm swinging as one rigid piece.
          float travel = length(position.xz) * 9.0;
          transformed.x += sin(t * 0.85 + travel) * reach * ${amplitude.toFixed(4)};
          transformed.z += cos(t * 0.67 + travel * 1.13) * reach * ${amplitude.toFixed(4)};
          transformed.y += sin(t * 0.53 + travel * 0.8) * reach * ${(amplitude * 0.6).toFixed(4)};
          // Mantle breathing, strongest where the arms are not.
          transformed *= 1.0 + sin(t * 0.4) * 0.012 * (1.0 - reach);
        }`
      );
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function () {
    return prevKey.call(this) + "|octopusarms";
  };
  material.needsUpdate = true;
}

export function updateOctopusArms(time: number): void {
  for (const u of registered) u.uOctopusTime.value = time;
}

export class Octopus {
  readonly object: Group;
  private basePosition: Vector3;
  private phase = Math.random() * Math.PI * 2;

  constructor(scene: Scene, holder: Group, perch: Vector3, facing: number) {
    this.object = new Group();
    this.object.add(holder);
    this.object.position.copy(perch);
    this.object.rotation.y = facing;
    this.basePosition = perch.clone();
    scene.add(this.object);
  }

  update(_dt: number, elapsed: number): void {
    // A slow shift of weight on the perch. Small enough to read as an animal
    // settling rather than an object drifting.
    this.object.position.set(
      this.basePosition.x + Math.sin(elapsed * 0.13 + this.phase) * 0.025,
      this.basePosition.y + Math.sin(elapsed * 0.19 + this.phase * 1.7) * 0.018,
      this.basePosition.z + Math.cos(elapsed * 0.11 + this.phase) * 0.02
    );
    this.object.rotation.y += Math.sin(elapsed * 0.07 + this.phase) * 0.00035;
    this.object.rotation.z = Math.sin(elapsed * 0.09 + this.phase) * 0.02;
  }
}
