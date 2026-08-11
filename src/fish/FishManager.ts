import {
  AnimationMixer,
  Box3,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  SkinnedMesh,
  Vector3,
  type Material,
  type Scene
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadGLTF, asset } from "../utils/loaders";
import { registerCaustics } from "../scene/caustics";
import { registerSwimWiggle } from "./wiggle";
import { fishBounds } from "../scene/dimensions";
import { Fish } from "./Fish";
import { initBoid, steer, type Boid } from "./boids";

type Axis = "x" | "y" | "z";

interface Species {
  file: string;
  bodyAxis: Axis; // body axis of the model ("x" | "y" | "z")
  headDir: 1 | -1; // head points down + or - of bodyAxis
  count: number;
  length: number; // total length (nose to caudal tip) in meters
  speedBL: number; // cruise speed ceiling in body lengths per second
  turnRate: number;
  animated: boolean;
}

// Roster: a mix of species at realistic sizes, with body axis and head
// direction measured per model. Models that ship without a swim clip are
// flagged so they get the fallback wiggle shader.
const ROSTER: Species[] = [
  { file: "paracheirodon_innesi___tetra_neon.glb", bodyAxis: "z", headDir: 1, count: 34, length: 0.045, speedBL: 5.0, turnRate: 5.0, animated: true },
  { file: "cc0____pale_bleak_z._platypus_animation.glb", bodyAxis: "x", headDir: -1, count: 10, length: 0.18, speedBL: 3.6, turnRate: 4.0, animated: true },
  { file: "guppy_fish.glb", bodyAxis: "z", headDir: -1, count: 12, length: 0.055, speedBL: 4.5, turnRate: 4.8, animated: true },
  { file: "myllokunmingia_fengjiaoa.glb", bodyAxis: "z", headDir: 1, count: 8, length: 0.04, speedBL: 5.0, turnRate: 4.6, animated: true },
  { file: "betta_splendens.glb", bodyAxis: "z", headDir: 1, count: 3, length: 0.08, speedBL: 2.6, turnRate: 3.6, animated: true },
  { file: "cc0___japanese_common_loach.glb", bodyAxis: "x", headDir: -1, count: 4, length: 0.15, speedBL: 3.0, turnRate: 4.0, animated: true },
  { file: "silakka_-_stromming_-_baltic_herring.glb", bodyAxis: "z", headDir: -1, count: 9, length: 0.26, speedBL: 3.2, turnRate: 3.6, animated: false },
  { file: "ahven_-_abborre_-_perch.glb", bodyAxis: "z", headDir: 1, count: 4, length: 0.32, speedBL: 2.8, turnRate: 3.4, animated: false },
  { file: "model_9a_-_blacktip_shark.glb", bodyAxis: "x", headDir: -1, count: 1, length: 1.2, speedBL: 0.5, turnRate: 3.0, animated: true }
];

const FORWARD = new Vector3(0, 0, 1);

function axisVector(axis: Axis): Vector3 {
  return new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
}

// Posed size of a species, measured once on the source model. Skinned models can
// carry most of their transform in the bones rather than the node matrix (the
// shark is ~3.4x bigger posed than its node matrix implies), so this walks actual
// vertices with skinning applied instead of trusting geometry.boundingBox.
function measurePosed(root: Object3D): { size: Vector3; center: Vector3 } {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const skinned = o as SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.update();
  });
  const box = new Box3().setFromObject(root, true); // precise: per-vertex, skin-aware
  return { size: box.getSize(new Vector3()), center: box.getCenter(new Vector3()) };
}

function eachMaterial(root: Object3D, fn: (m: Material) => void): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(fn);
    else if (mat) fn(mat);
  });
}

export class FishManager {
  readonly fish: Fish[] = [];
  private boids: Boid[] = [];
  private bounds = fishBounds();

  async load(scene: Scene): Promise<void> {
    for (const species of ROSTER) {
      const gltf = await loadGLTF(asset(`assets/fish/${species.file}`));
      const source = gltf.scene;

      // Material setup once on the shared source materials.
      eachMaterial(source, (m) => {
        if ((m as MeshStandardMaterial).isMeshStandardMaterial || (m as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
          registerCaustics(m);
        }
      });

      // Every clone is identical, so measure the species once.
      const posed = measurePosed(source);

      // Shoal mates start clustered and share one wander target, otherwise they
      // spawn too far apart to ever see each other and cohesion never engages.
      const b = this.bounds;
      const spread = Math.min(species.length * 14, 1.4);
      const shoalCenter = new Vector3(
        b.min.x + spread + Math.random() * (b.max.x - b.min.x - spread * 2),
        b.min.y + spread + Math.random() * (b.max.y - b.min.y - spread * 2),
        b.min.z + spread + Math.random() * (b.max.z - b.min.z - spread * 2)
      );
      const shoalTarget = new Vector3();
      for (let i = 0; i < species.count; i++) {
        this.spawn(scene, gltf, species, posed, shoalCenter, spread, shoalTarget, i === 0);
      }
    }
  }

  private spawn(
    scene: Scene,
    gltf: Awaited<ReturnType<typeof loadGLTF>>,
    species: Species,
    posed: { size: Vector3; center: Vector3 },
    shoalCenter: Vector3,
    spread: number,
    shoalTarget: Vector3,
    leader: boolean
  ): void {
    // SkeletonUtils.clone preserves skinning (mesh.clone would share the skeleton).
    const model = cloneSkinned(gltf.scene);
    model.updateMatrixWorld(true);

    const { size, center } = posed;
    const scale = species.length / Math.max(size[species.bodyAxis], 1e-6);

    // Center the model on its body, then correct so the head points to +Z.
    model.position.sub(center);
    const holder = new Group();
    holder.scale.setScalar(scale);
    const forwardLocal = axisVector(species.bodyAxis).multiplyScalar(species.headDir);
    holder.quaternion.setFromUnitVectors(forwardLocal, FORWARD);
    holder.add(model);

    // Fallback wiggle for non-animated species: clone the materials so each
    // instance gets its own phase. The clones lose the source caustics
    // registration, so re-apply it before the wiggle.
    if (!species.animated) {
      const phase = Math.random() * Math.PI * 2;
      model.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox!;
        const meshSize = bb.getSize(new Vector3());
        const body = species.bodyAxis;
        const lateral: Axis = body === "x" ? "z" : "x";
        const amp = meshSize[body] * 0.05;
        const mats = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : [mesh.material.clone()];
        mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
        for (const m of mats) {
          registerCaustics(m);
          registerSwimWiggle(m, body, lateral, bb.min[body], bb.max[body], amp, phase);
        }
      });
    }

    model.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false; // skinned bounds drift; avoid pop-out
      }
    });

    const agent = new Group();
    agent.name = species.file;
    agent.add(holder);
    scene.add(agent);

    // Animation.
    let mixer: AnimationMixer | null = null;
    if (species.animated && gltf.animations.length > 0) {
      mixer = new AnimationMixer(model);
      const action = mixer.clipAction(gltf.animations[0]);
      action.timeScale = 0.85 + Math.random() * 0.5;
      action.play();
      action.time = Math.random() * gltf.animations[0].duration;
    }

    // Boid state.
    // Fish cruise near minSpeed, so the steering force is sized against that, not
    // against maxSpeed: acceleration budget over cruise speed is what sets how
    // fast the velocity vector can rotate, and it must stay under turnRate.
    const maxSpeed = species.length * species.speedBL;
    const minSpeed = maxSpeed * 0.6;
    const b = this.bounds;
    const position = new Vector3(
      shoalCenter.x + (Math.random() - 0.5) * spread * 2,
      shoalCenter.y + (Math.random() - 0.5) * spread * 2,
      shoalCenter.z + (Math.random() - 0.5) * spread * 2
    ).clamp(b.min, b.max);
    const boid: Boid = {
      position,
      velocity: new Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(minSpeed),
      maxSpeed,
      minSpeed,
      maxForce: maxSpeed * 0.6,
      wanderTarget: shoalTarget, // shared across the shoal, repicked by the leader
      separationRadius: species.length * 3.5,
      species: species.file,
      length: species.length,
      leader
    };
    if (leader) initBoid(boid, b);

    const fish = new Fish(agent, boid, mixer, species.turnRate);
    this.fish.push(fish);
    this.boids.push(boid);
  }

  update(dt: number, cameraPos: Vector3): void {
    for (const b of this.boids) steer(b, this.boids, this.bounds, cameraPos, dt);
    for (const f of this.fish) f.update(dt);
  }
}
