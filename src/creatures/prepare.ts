import {
  Box3,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  SkinnedMesh,
  Vector3,
  type Material
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { registerCaustics } from "../scene/caustics";

// Shared model setup for the non-fish cast. Mirrors what FishManager does per
// species (measure posed, center, scale to a real-world size, rotate so the
// model's forward becomes +Z), but these creatures each get their own steering
// rather than joining the boid flock, so it lives apart from the fish roster.

export type Axis = "x" | "y" | "z";

export interface Placement {
  /** Group whose +Z is forward and whose origin is the creature's center. */
  holder: Group;
  /** The cloned model root, which is what an AnimationMixer must bind to. */
  model: Object3D;
  /** Posed size in metres, after scaling. */
  size: Vector3;
}

function axisVector(axis: Axis): Vector3 {
  return new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
}

const FORWARD = new Vector3(0, 0, 1);

// Skinned meshes deform outside their baked geometry bounds, so the culler
// under-reports and a creature can vanish while still on screen. Same fix and
// same reasoning as FishManager.
const SKINNED_BOUNDS_SLACK = 2.2;

export function eachMaterial(root: Object3D, fn: (m: Material) => void): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(fn);
    else if (mat) fn(mat);
  });
}

// Measure with skinning applied: these models carry much of their transform in
// the bones, so geometry.boundingBox alone under-reports badly.
function measurePosed(root: Object3D): { size: Vector3; center: Vector3 } {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const skinned = o as SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.update();
  });
  const box = new Box3().setFromObject(root, true);
  return { size: box.getSize(new Vector3()), center: box.getCenter(new Vector3()) };
}

export function prepareModel(
  source: Object3D,
  options: { length: number; bodyAxis: Axis; headDir: 1 | -1; castShadow?: boolean }
): Placement {
  eachMaterial(source, (m) => {
    if (
      (m as MeshStandardMaterial).isMeshStandardMaterial ||
      (m as MeshPhysicalMaterial).isMeshPhysicalMaterial
    ) {
      registerCaustics(m);
    }
  });

  source.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const sphere = mesh.geometry.boundingSphere;
    if (sphere) sphere.radius *= SKINNED_BOUNDS_SLACK;
  });

  const model = cloneSkinned(source);
  model.updateMatrixWorld(true);

  const posed = measurePosed(model);
  const scale = options.length / Math.max(posed.size[options.bodyAxis], 1e-6);

  model.position.sub(posed.center);
  const holder = new Group();
  holder.scale.setScalar(scale);
  holder.quaternion.setFromUnitVectors(
    axisVector(options.bodyAxis).multiplyScalar(options.headDir),
    FORWARD
  );
  holder.add(model);

  const castShadow = options.castShadow ?? true;
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) mesh.castShadow = castShadow;
  });

  return { holder, model, size: posed.size.clone().multiplyScalar(scale) };
}
