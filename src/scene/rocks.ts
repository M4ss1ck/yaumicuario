import {
  BufferAttribute,
  Color,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type BufferGeometry,
  type Scene
} from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HALF } from "./dimensions";
import { registerCaustics } from "./caustics";
import { mulberry32 } from "../utils/textures";

// Iwagumi-style water-worn stones with moss on their upward faces, partly
// buried in the pale sand. A seeded rng keeps the layout identical on every
// reload, so no Math.random is used anywhere in this file.

// Build one rounded, smooth rock shape. The icosphere is non-indexed, so
// mergeVertices lets shared vertices displace together, giving a soft,
// water-worn silhouette instead of a hard faceted look.
function makeRockGeometry(rng: () => number): BufferGeometry {
  const geo = mergeVertices(new IcosahedronGeometry(1, 3));

  const s1 = rng() * 10;
  const s2 = rng() * 10;
  const s3 = rng() * 10;
  const s4 = rng() * 10;

  const pos = geo.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r =
      1 +
      0.22 * Math.sin(3.1 * v.x + s1) +
      0.17 * Math.sin(4.3 * v.y + s2) +
      0.13 * Math.sin(5.7 * v.z + s3) +
      0.09 * Math.sin(8.1 * (v.x + v.y + v.z) + s4);
    v.multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.computeVertexNormals();

  // Per-vertex stone color, with moss spreading across the upward faces. The
  // sine keeps the moss boundary irregular instead of a clean line.
  const colors = new Float32Array(pos.count * 3);
  const stone = new Color(0x6f6d64);
  const stoneDark = new Color(0x47463f);
  const moss = new Color(0x47682f);
  const n = new Vector3();
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(geo.attributes.normal, i);
    p.fromBufferAttribute(pos, i);
    const noise = 0.5 + 0.5 * Math.sin(5.3 * p.x + 7.1 * p.y + 3.7 * p.z + s1);
    const t = Math.max(0, Math.min(1, (n.y - 0.1) / 0.7)) * (0.45 + 0.55 * noise);
    const c = stone.clone().lerp(stoneDark, 0.35 + 0.4 * noise).lerp(moss, t * 0.85);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));

  return geo;
}

// Bake one rock placement into world space, flattened and partly buried so it
// reads as sitting in the sand rather than resting on top of it. The rocks
// never move and all share one material, so every placement is baked into a
// single merged geometry instead of 22 separate meshes, each of which was a
// draw call in the main pass and another in the shadow pass.
function placedRock(
  geometry: BufferGeometry,
  x: number,
  z: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  rotY: number
): BufferGeometry {
  const placed = geometry.clone();
  const m = new Matrix4()
    .makeTranslation(x, -HALF.y + scaleY * 0.58, z)
    .multiply(new Matrix4().makeRotationY(rotY))
    .multiply(new Matrix4().makeScale(scaleX, scaleY, scaleZ));
  placed.applyMatrix4(m);
  return placed;
}

export function buildRocks(scene: Scene): void {
  const rng = mulberry32(1337);

  // Five distinct shapes, reused across all instances by index.
  const geometries: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    geometries.push(makeRockGeometry(rng));
  }

  // One shared material so every rock gets the same caustics injection.
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0
  });
  registerCaustics(material);

  // Four hero stones outside the fish steering x-range, framing the shot.
  const heroes: [number, number, number, number, number, number][] = [
    [-6.4, -5.0, 1.9, 1.3, 1.7, 0.6],
    [6.2, -6.5, 1.55, 1.05, 1.45, 2.1],
    [-5.9, -8.2, 1.2, 0.85, 1.15, 4.0],
    [5.6, -2.6, 1.05, 0.75, 1.0, 1.2]
  ];
  const placed: BufferGeometry[] = [];
  heroes.forEach(([x, z, scaleX, scaleY, scaleZ, rotY], i) => {
    placed.push(placedRock(geometries[i % geometries.length], x, z, scaleX, scaleY, scaleZ, rotY));
  });

  // Eighteen scattered small stones, low enough that fish clear them.
  let count = 0;
  while (count < 18) {
    const x = -9 + rng() * 18;
    const z = -10 + rng() * 13.5;
    // Keep the near-centre foreground clear for the camera.
    if (Math.abs(x) < 1.6 && z > -1.5) continue;
    const s = 0.16 + rng() * 0.19;
    const scaleX = s;
    const scaleY = s * 0.7;
    const scaleZ = s * (0.85 + rng() * 0.3);
    const rotY = rng() * Math.PI * 2;
    placed.push(
      placedRock(geometries[count % geometries.length], x, z, scaleX, scaleY, scaleZ, rotY)
    );
    count++;
  }

  const merged = mergeGeometries(placed, false);
  for (const g of placed) g.dispose();
  for (const g of geometries) g.dispose();

  const rocks = new Mesh(merged, material);
  rocks.name = "rocks";
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);
}
