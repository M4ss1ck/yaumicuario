import {
  BufferAttribute,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene
} from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HALF } from "./dimensions";
import { registerCaustics } from "./caustics";
import { registerSway } from "./plants";
import { mulberry32 } from "../utils/textures";

// Two coral outcrops, generated the same way the stones and plants are: a
// seeded rng, vertex colors, and everything baked into a single merged
// geometry per material. No Math.random is used anywhere in this file, so the
// reef is identical on every reload.
//
// Coral is procedural rather than downloaded because every photoscanned coral
// available under a usable license is a dead specimen: bleached museum
// skeletons, or "fresh samples" that are pale tan. Generating it is also the
// only way to choose its color, and the color is the point here.
//
// Two forms, split by whether they move. Branching staghorn colonies and
// encrusting domes are rigid and merge into one mesh. Sea fans are thin planar
// gorgonians that sway on the plant sway injection, so they merge into a
// second mesh with the sway attributes the shader expects.

// The fog is FogExp2(0x0e3b40, 0.11) and the reef sits 8-11 m out, where only
// 27-43% of the surface color survives to the camera. Colors are therefore
// picked far past where they look correct in isolation: at reef distance the
// fog drags them back to a believable muted violet.
const CORAL_COLORS = [
  new Color(0x7b2fd0), // violet
  new Color(0x4a3fd8), // blue-violet
  new Color(0xb945d8), // magenta
  new Color(0x2f6fd0), // deep blue
  new Color(0x9a5ff0) // lilac
];
// Polyp tips catch more light than the branch shafts they sit on.
const TIP_COLOR = new Color(0xd9a8ff);

const UP = new Vector3(0, 1, 0);

interface Branch {
  origin: Vector3;
  direction: Vector3;
  length: number;
  radius: number;
  depth: number;
}

// One tapered segment, oriented along `direction` and placed at `origin`.
// `tipness` (0 at the colony base, 1 at the outermost twigs) drives the vertex
// color toward the pale polyp tint.
function segmentGeometry(branch: Branch, tipness: number, hue: Color): BufferGeometry {
  const geo = new CylinderGeometry(branch.radius * 0.78, branch.radius, branch.length, 7, 1, true);
  // CylinderGeometry is built around the origin along +Y; shift it so the base
  // sits at the origin, then rotate +Y onto the branch direction.
  geo.translate(0, branch.length / 2, 0);
  geo.applyMatrix4(
    new Matrix4()
      .makeTranslation(branch.origin.x, branch.origin.y, branch.origin.z)
      .multiply(
        new Matrix4().makeRotationFromQuaternion(
          new Quaternion().setFromUnitVectors(UP, branch.direction)
        )
      )
  );

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const base = hue.clone().lerp(TIP_COLOR, tipness * 0.7);
  const v = new Vector3();
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    // Mottling. A colony painted one flat tone reads as moulded plastic; the
    // variation is what makes it look grown.
    v.fromBufferAttribute(pos, i);
    const noise = 0.5 + 0.5 * Math.sin(11.0 * v.x + 7.0 * v.y + 13.0 * v.z);
    c.copy(base).multiplyScalar(0.72 + 0.42 * noise);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  return geo;
}

// Recursive branching colony. `planar` flattens every child direction onto the
// colony's local XY plane, which is what turns a staghorn into a sea fan.
function growColony(
  rng: () => number,
  root: Branch,
  hue: Color,
  maxDepth: number,
  planar: boolean,
  out: BufferGeometry[]
): void {
  const tipness = 1 - root.depth / maxDepth;
  out.push(segmentGeometry(root, 1 - tipness, hue));
  if (root.depth >= maxDepth) return;

  const children = 2 + Math.floor(rng() * 2);
  const tip = root.origin.clone().addScaledVector(root.direction, root.length);
  for (let i = 0; i < children; i++) {
    const spread = 0.45 + rng() * 0.5;
    const azimuth = planar ? (rng() < 0.5 ? 0 : Math.PI) : rng() * Math.PI * 2;
    // Tilt the parent direction away from itself by `spread`, around a
    // perpendicular chosen by `azimuth`.
    const perp = new Vector3(Math.cos(azimuth), 0, planar ? 0 : Math.sin(azimuth));
    if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
    const axis = new Vector3().crossVectors(root.direction, perp).normalize();
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    const direction = root.direction
      .clone()
      .applyQuaternion(new Quaternion().setFromAxisAngle(axis, spread))
      .normalize();
    // Coral grows upward even as it spreads, so bias every child back toward +Y.
    direction.lerp(UP, 0.18).normalize();

    growColony(
      rng,
      {
        origin: tip,
        direction,
        length: root.length * (0.55 + rng() * 0.15),
        radius: root.radius * 0.8,
        depth: root.depth + 1
      },
      hue,
      maxDepth,
      planar,
      out
    );
  }
}

// Encrusting dome: a squashed, noise-displaced hemisphere that reads as a
// brain or plate coral hugging the substrate.
function domeGeometry(rng: () => number, radius: number, hue: Color): BufferGeometry {
  // Indexed, both so shared vertices displace together into a smooth dome and
  // so it can merge with the indexed branch colonies: mergeGeometries refuses a
  // mix of indexed and non-indexed inputs.
  const geo = mergeVertices(new IcosahedronGeometry(radius, 2));
  const s1 = rng() * 10;
  const s2 = rng() * 10;
  const pos = geo.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ridged = 1 + 0.11 * Math.sin(9.0 * v.x + s1) * Math.sin(9.0 * v.z + s2);
    v.multiplyScalar(ridged);
    // Flatten into a dome and lift the base to sit on the substrate.
    v.y = Math.max(v.y, -radius * 0.15) * 0.55;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();

  const colors = new Float32Array(pos.count * 3);
  const n = new Vector3();
  const v2 = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(geo.attributes.normal, i);
    v2.fromBufferAttribute(pos, i);
    // Crowns catch the light; flanks stay in the deeper end of the palette.
    const noise = 0.5 + 0.5 * Math.sin(17.0 * v2.x + s1) * Math.sin(15.0 * v2.z + s2);
    const c = hue
      .clone()
      .lerp(TIP_COLOR, Math.max(0, n.y) * 0.45)
      .multiplyScalar(0.68 + 0.5 * noise);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  return geo;
}

// The sway shader reads aPhase, aHeightFrac and aSwayAmp per vertex, so a fan
// has to carry them. Height fraction is measured within the fan itself, which
// keeps the holdfast still and the outer edge moving most.
function addSwayAttributes(geo: BufferGeometry, phase: number, amplitude: number): void {
  const pos = geo.attributes.position;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxY - minY, 1e-3);
  const phases = new Float32Array(pos.count);
  const heights = new Float32Array(pos.count);
  const amps = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    phases[i] = phase;
    heights[i] = (pos.getY(i) - minY) / span;
    amps[i] = amplitude;
  }
  geo.setAttribute("aPhase", new BufferAttribute(phases, 1));
  geo.setAttribute("aHeightFrac", new BufferAttribute(heights, 1));
  geo.setAttribute("aSwayAmp", new BufferAttribute(amps, 1));
}

function placeAt(geo: BufferGeometry, x: number, z: number, rotY: number, scale: number): BufferGeometry {
  return geo.applyMatrix4(
    new Matrix4()
      .makeTranslation(x, -HALF.y, z)
      .multiply(new Matrix4().makeRotationY(rotY))
      .multiply(new Matrix4().makeScale(scale, scale, scale))
  );
}

// A thin rim term. Coral read through 8-11 m of exponential fog loses most of
// its diffuse color, and a rim tinted by the surface's own color is what puts
// the violet back at the silhouette, where the eye reads hue. It doubles as a
// cheap stand-in for the subsurface scattering that makes live coral glow.
function registerCoralRim(material: Material): void {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      /* glsl */ `#include <emissivemap_fragment>
      {
        float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
        totalEmissiveRadiance += diffuseColor.rgb * pow(rim, 2.5) * 0.55;
      }`
    );
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function () {
    return prevKey.call(this) + "|coralrim";
  };
  material.needsUpdate = true;
}

// One outcrop: a cluster of branching colonies, domes and fans around a center.
//
// Two of the three flank the shot, sitting just outside the +-4.6 fish steering
// range but inside the picture, the way the four hero stones already do. That
// works on a wide screen and fails completely on a phone held upright: the
// portrait framing spans only +-2.4 m at z = -2.5, so both flanking masses fall
// outside it and a phone sees no reef at all.
//
// The third mass exists for that. It sits near the center line and far enough
// back to clear the fish steering box (which ends at z = -3.5), where it is
// inside the frame in both aspects. It is the one that carries the octopus.
interface Outcrop {
  x: number;
  z: number;
  scale: number;
  colonies: number;
  domes: number;
  fans: number;
  /** Pull the scatter in, so a mass close to the fish box does not reach into it. */
  tight?: boolean;
  /**
   * Keep this patch of the outcrop bare. The octopus perches on the center-rear
   * mass, and without a clearing a colony lands on the same spot and grows
   * branches straight through its body.
   */
  clearing?: { x: number; z: number; radius: number };
}

const OUTCROPS: Outcrop[] = [
  { x: -4.85, z: -2.5, scale: 1.15, colonies: 7, domes: 5, fans: 3 }, // hero, stage left
  { x: 6.0, z: -5.5, scale: 0.95, colonies: 5, domes: 4, fans: 2 }, // satellite, stage right
  {
    // Center rear: the only mass inside the frame in both aspects.
    x: -1.6,
    z: -4.6,
    scale: 0.8,
    colonies: 5,
    domes: 4,
    fans: 2,
    tight: true,
    clearing: { x: -1.6, z: -4.3, radius: 0.9 }
  }
];

// Pick a spot in the outcrop, rejecting anything that lands in the clearing.
// Bounded, because with a large clearing every draw could in principle be
// rejected; falling back to the last draw is fine, the reef is decorative.
function scatter(
  rng: () => number,
  outcrop: Outcrop,
  minDistance: number,
  maxDistance: number
): { x: number; z: number } {
  let x = outcrop.x;
  let z = outcrop.z;
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = rng() * Math.PI * 2;
    const distance = minDistance + rng() * maxDistance;
    x = outcrop.x + Math.cos(angle) * distance;
    z = outcrop.z + Math.sin(angle) * distance;
    const clearing = outcrop.clearing;
    if (!clearing) break;
    if (Math.hypot(x - clearing.x, z - clearing.z) >= clearing.radius) break;
  }
  return { x, z };
}

export function buildReef(scene: Scene): void {
  const rng = mulberry32(90210);
  const rigid: BufferGeometry[] = [];
  const swaying: BufferGeometry[] = [];

  for (const outcrop of OUTCROPS) {
    for (let i = 0; i < outcrop.colonies; i++) {
      const hue = CORAL_COLORS[Math.floor(rng() * CORAL_COLORS.length)];
      const parts: BufferGeometry[] = [];
      growColony(
        rng,
        {
          origin: new Vector3(0, 0, 0),
          direction: new Vector3((rng() - 0.5) * 0.5, 1, (rng() - 0.5) * 0.5).normalize(),
          length: 0.3 + rng() * 0.14,
          radius: 0.085 + rng() * 0.035,
          depth: 0
        },
        hue,
        3,
        false,
        parts
      );
      const colony = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      const at = scatter(rng, outcrop, 0, 1.5 * outcrop.scale * (outcrop.tight ? 0.6 : 1));
      rigid.push(
        placeAt(
          colony,
          at.x,
          at.z,
          rng() * Math.PI * 2,
          outcrop.scale * (0.8 + rng() * 0.5)
        )
      );
    }

    for (let i = 0; i < outcrop.domes; i++) {
      const hue = CORAL_COLORS[Math.floor(rng() * CORAL_COLORS.length)];
      const at = scatter(rng, outcrop, 0, 1.8 * outcrop.scale * (outcrop.tight ? 0.6 : 1));
      rigid.push(
        placeAt(
          domeGeometry(rng, 0.22 + rng() * 0.2, hue),
          at.x,
          at.z,
          rng() * Math.PI * 2,
          outcrop.scale
        )
      );
    }

    for (let i = 0; i < outcrop.fans; i++) {
      const hue = CORAL_COLORS[Math.floor(rng() * CORAL_COLORS.length)];
      const parts: BufferGeometry[] = [];
      growColony(
        rng,
        {
          origin: new Vector3(0, 0, 0),
          direction: new Vector3(0, 1, 0),
          length: 0.34 + rng() * 0.16,
          radius: 0.045 + rng() * 0.015,
          depth: 0
        },
        hue,
        4,
        true,
        parts
      );
      const fan = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      addSwayAttributes(fan, rng() * Math.PI * 2, 0.035);
      const tight = outcrop.tight ? 0.6 : 1;
      const at = scatter(rng, outcrop, 0.8 * tight, 1.4 * outcrop.scale * tight);
      swaying.push(
        placeAt(
          fan,
          at.x,
          at.z,
          rng() * Math.PI * 2,
          outcrop.scale * (0.9 + rng() * 0.4)
        )
      );
    }
  }

  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0,
    side: DoubleSide
  });
  registerCaustics(material);
  registerCoralRim(material);

  const rigidMesh = new Mesh(mergeGeometries(rigid, false), material);
  rigidMesh.name = "reef";
  rigidMesh.castShadow = true;
  rigidMesh.receiveShadow = true;
  scene.add(rigidMesh);

  // Fans need their own material because the sway injection is per-material,
  // and the rigid colonies must not move.
  const fanMaterial = material.clone();
  registerCaustics(fanMaterial);
  registerCoralRim(fanMaterial);
  registerSway(fanMaterial);

  const fanMesh = new Mesh(mergeGeometries(swaying, false), fanMaterial);
  fanMesh.name = "reef-fans";
  fanMesh.castShadow = true;
  fanMesh.receiveShadow = true;
  scene.add(fanMesh);

  for (const g of rigid) g.dispose();
  for (const g of swaying) g.dispose();
}
