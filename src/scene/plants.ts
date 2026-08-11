import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Scene
} from "three";
import { HALF } from "./dimensions";
import { registerCaustics } from "./caustics";
import { mulberry32 } from "../utils/textures";

// Procedural aquarium plants: tall ribbon-leaved eelgrass (Vallisneria) in
// clumps, a low carpet of short grass, and short broad-leaf rosettes
// (Cryptocoryne / small Echinodorus). Every blade is a flat tapered ribbon
// that sways in the vertex shader, driven by per-vertex phase and amplitude
// attributes plus a shared time uniform.

interface PlantUniforms {
  uPlantTime: { value: number };
}

// One shared material drives all three layers, so the sway injection lands once.
const registered: PlantUniforms[] = [];

// Same guard as the caustics/wiggle injections: chaining twice onto one
// material would redefine uPlantTime and break the shader compile.
const injected = new WeakSet<Material>();

// One palette per tall clump: green vallisneria, lighter fresh green, and a
// bronze/red stem plant. Planted tanks mix red and bronze stems among the
// green, and the variety keeps the tall layer from reading as a monoculture.
const TALL_PALETTES = [
  { base: 0x1d3d17, tip: 0x5f9433 }, // green vallisneria
  { base: 0x24401a, tip: 0x7fae3c }, // lighter fresh green
  { base: 0x5a2412, tip: 0xb5652f } // bronze/red stem plant
];

interface BladeParams {
  bx: number;
  bz: number;
  h: number;
  w: number;
  N: number;
  dir: number;
  lean: number;
  phase: number;
  cBase: Color;
  cTip: Color;
}

// Accumulate one blade as two vertex rows per segment, then a ribbon of quads.
// Vertices stay in world space so every blade of a layer can be merged into a
// single indexed geometry and drawn in one call.
function pushBlade(
  positions: number[],
  colors: number[],
  phases: number[],
  heightFracs: number[],
  swayAmps: number[],
  indices: number[],
  floorY: number,
  p: BladeParams
): void {
  const lx = -Math.sin(p.dir); // lateral axis, across the blade
  const lz = Math.cos(p.dir);
  const start = positions.length / 3;
  for (let i = 0; i <= p.N; i++) {
    const t = i / p.N;
    const halfW = p.w * 0.5 * (1 - 0.85 * t * t); // taper to a near point
    const bend = p.lean * t * t; // curve, strongest at the tip
    const cx = p.bx + Math.cos(p.dir) * bend;
    const cz = p.bz + Math.sin(p.dir) * bend;
    const y = floorY + t * p.h;
    // Two vertices per row, left and right of the blade centre line.
    positions.push(cx - lx * halfW, y, cz - lz * halfW);
    positions.push(cx + lx * halfW, y, cz + lz * halfW);
    const c = p.cBase.clone().lerp(p.cTip, t);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    phases.push(p.phase, p.phase);
    heightFracs.push(t, t);
    const amp = p.h * 0.12;
    swayAmps.push(amp, amp);
  }
  for (let i = 0; i < p.N; i++) {
    const a = start + i * 2, b = a + 1, c2 = a + 2, d = a + 3;
    indices.push(a, c2, b, b, c2, d);
  }
}

// Fold the accumulated arrays into one indexed geometry per layer, so each
// layer renders as a single draw call.
function buildLayerGeometry(
  positions: number[],
  colors: number[],
  phases: number[],
  heightFracs: number[],
  swayAmps: number[],
  indices: number[]
): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geo.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));
  geo.setAttribute("aHeightFrac", new Float32BufferAttribute(heightFracs, 1));
  geo.setAttribute("aSwayAmp", new Float32BufferAttribute(swayAmps, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Inject the sway into the shared material's vertex shader. The motion is
// applied at begin_vertex, before project_vertex, so the caustics injection
// (which reads `transformed` at project_vertex) sees the swayed position.
function registerSway(material: Material): void {
  if (injected.has(material)) return;
  injected.add(material);

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uPlantTime = { value: 0 };
    registered.push(shader.uniforms as unknown as PlantUniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uPlantTime;
        attribute float aPhase;
        attribute float aHeightFrac;
        attribute float aSwayAmp;`
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        {
          float s = aHeightFrac * aHeightFrac;
          float w = uPlantTime + aPhase;
          transformed.x += sin(w * 1.1) * aSwayAmp * s;
          transformed.z += cos(w * 0.83 + 1.7) * aSwayAmp * 0.65 * s;
        }`
      );
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function () {
    return prevKey.call(this) + "|plantsway";
  };
  material.needsUpdate = true;
}

export function buildPlants(scene: Scene): void {
  const rng = mulberry32(20260811);
  const floorY = -HALF.y;

  // Layer A: tall eelgrass clumps. Tall blades are deliberately allowed inside
  // the fish region; they are thin and swaying, so a fish passing through reads
  // as swimming through grass. Solid rocks are what is kept out of that region.
  const aPositions: number[] = [];
  const aColors: number[] = [];
  const aPhases: number[] = [];
  const aHeightFracs: number[] = [];
  const aSwayAmps: number[] = [];
  const aIndices: number[] = [];

  for (let c = 0; c < 26; c++) {
    // Per clump, not per blade: roughly 55% green, 23% light green, 22% bronze.
    const roll = rng();
    const pal = roll < 0.55 ? TALL_PALETTES[0] : roll < 0.78 ? TALL_PALETTES[1] : TALL_PALETTES[2];
    const cxC = -9.5 + rng() * 19;
    const czC = -11 + rng() * 14;
    const clumpPhase = rng() * Math.PI * 2;
    const bladeCount = 12 + Math.floor(rng() * 16);
    for (let k = 0; k < bladeCount; k++) {
      const a = rng() * Math.PI * 2;
      const r = 0.12 + rng() * 0.45;
      const h = 1.1 + rng() * 2.3;
      const jitter = 0.85 + rng() * 0.3;
      pushBlade(
        aPositions,
        aColors,
        aPhases,
        aHeightFracs,
        aSwayAmps,
        aIndices,
        floorY,
        {
          bx: cxC + Math.cos(a) * r,
          bz: czC + Math.sin(a) * r,
          h,
          w: 0.035 + rng() * 0.03,
          N: 7,
          dir: rng() * Math.PI * 2,
          lean: h * (0.12 + rng() * 0.18),
          phase: clumpPhase + rng() * 0.6, // a clump sways together, not at random
          cBase: new Color(pal.base).multiplyScalar(jitter),
          cTip: new Color(pal.tip).multiplyScalar(jitter)
        }
      );
    }
  }

  // Layer B: low carpet, no clumping.
  const bPositions: number[] = [];
  const bColors: number[] = [];
  const bPhases: number[] = [];
  const bHeightFracs: number[] = [];
  const bSwayAmps: number[] = [];
  const bIndices: number[] = [];

  for (let k = 0; k < 3000; k++) {
    const h = 0.1 + rng() * 0.22;
    const jitter = 0.85 + rng() * 0.3;
    pushBlade(
      bPositions,
      bColors,
      bPhases,
      bHeightFracs,
      bSwayAmps,
      bIndices,
      floorY,
      {
        bx: -10 + rng() * 20,
        bz: -11 + rng() * 15,
        h,
        w: 0.02 + rng() * 0.02,
        N: 3,
        dir: rng() * Math.PI * 2,
        lean: h * (0.15 + rng() * 0.25),
        phase: rng() * Math.PI * 2,
        cBase: new Color(0x24471b).multiplyScalar(jitter),
        cTip: new Color(0x6ba33a).multiplyScalar(jitter)
      }
    );
  }

  // Layer C: broad-leaf rosettes. Short, wide, strongly curved leaves radiating
  // from a common centre (Cryptocoryne / small Echinodorus), drawn after the
  // tall layer and carpet so those keep their current rng sequence and layout.
  const cPositions: number[] = [];
  const cColors: number[] = [];
  const cPhases: number[] = [];
  const cHeightFracs: number[] = [];
  const cSwayAmps: number[] = [];
  const cIndices: number[] = [];

  for (let r = 0; r < 14; r++) {
    const rx = -8.5 + rng() * 17;
    const rz = -10 + rng() * 12;
    const rosettePhase = rng() * Math.PI * 2;
    const leafCount = 7 + Math.floor(rng() * 6); // 7..12
    for (let j = 0; j < leafCount; j++) {
      // Leaves radiate outward evenly, with jitter, and lean out hard.
      const dir = (j / leafCount) * Math.PI * 2 + rng() * 0.4;
      const h = 0.35 + rng() * 0.55; // 0.35..0.90 m
      const w = 0.10 + rng() * 0.08; // broad leaf
      const N = 6;
      const lean = h * (0.55 + rng() * 0.35); // strong outward arch
      const phase = rosettePhase + rng() * 0.4;
      const jitter = 0.85 + rng() * 0.3;
      pushBlade(
        cPositions,
        cColors,
        cPhases,
        cHeightFracs,
        cSwayAmps,
        cIndices,
        floorY,
        {
          // Leaf bases sit at the rosette centre with a small offset.
          bx: rx + Math.cos(dir) * 0.05,
          bz: rz + Math.sin(dir) * 0.05,
          h,
          w,
          N,
          dir,
          lean,
          phase,
          cBase: new Color(0x1b3a1c).multiplyScalar(jitter),
          cTip: new Color(0x4e8a35).multiplyScalar(jitter)
        }
      );
    }
  }

  // One shared material for all three layers.
  const material = new MeshStandardMaterial({
    vertexColors: true,
    side: DoubleSide,
    roughness: 0.75,
    metalness: 0,
    // Aquatic leaves glow faintly when light passes through them; a little
    // emissive lift stops the shadow side going flat black. Cheap vs
    // transmission, and compatible with the caustics totalEmissiveRadiance.
    emissive: new Color(0x16300f),
    emissiveIntensity: 0.5
  });
  registerCaustics(material);
  registerSway(material);

  // Hundreds of blades; shadow cost is not worth it.
  const tall = new Mesh(buildLayerGeometry(aPositions, aColors, aPhases, aHeightFracs, aSwayAmps, aIndices), material);
  tall.name = "plants-tall";
  tall.castShadow = false;
  tall.receiveShadow = true;
  scene.add(tall);

  const carpet = new Mesh(buildLayerGeometry(bPositions, bColors, bPhases, bHeightFracs, bSwayAmps, bIndices), material);
  carpet.name = "plants-carpet";
  carpet.castShadow = false;
  carpet.receiveShadow = true;
  scene.add(carpet);

  const broadleaf = new Mesh(buildLayerGeometry(cPositions, cColors, cPhases, cHeightFracs, cSwayAmps, cIndices), material);
  broadleaf.name = "plants-broadleaf";
  broadleaf.castShadow = false;
  broadleaf.receiveShadow = true;
  scene.add(broadleaf);
}

export function updatePlants(time: number): void {
  for (const u of registered) u.uPlantTime.value = time;
}
