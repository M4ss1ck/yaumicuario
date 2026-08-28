import { Box3, Vector3 } from "three";
import { viewTopAt } from "../scene/dimensions";

// Lightweight steering layer that drives where each fish swims. The skeletal
// animation handles the body wiggle; this decides heading and position.
export interface Boid {
  position: Vector3;
  velocity: Vector3;
  maxSpeed: number;
  minSpeed: number;
  maxForce: number;
  wanderTarget: Vector3;
  separationRadius: number;
  species: string;
  length: number;
  // Shoal mates share one wanderTarget instance so the group travels together;
  // only the leader repicks it, otherwise every member would retarget at once.
  leader: boolean;
}

const WANDER_WEIGHT = 1.0;
const WALL_WEIGHT = 2.5;
const SEP_WEIGHT = 1.6;
const COH_WEIGHT = 0.5;
const ALIGN_WEIGHT = 0.8;
const CAMERA_WEIGHT = 3.0;
const CAMERA_RADIUS = 0.6;

const tmp = new Vector3();
const accel = new Vector3();
const desired = new Vector3();
const neighborPos = new Vector3();
const neighborVel = new Vector3();
const cohesion = new Vector3();
const alignment = new Vector3();

function limit(v: Vector3, max: number): Vector3 {
  const len = v.length();
  if (len > max) v.multiplyScalar(max / len);
  return v;
}

function pickWanderTarget(boid: Boid, bounds: Box3): void {
  const z = bounds.min.z + Math.random() * (bounds.max.z - bounds.min.z);
  // Pick the target under the same ceiling the steering enforces, otherwise the
  // shoal is forever drawn toward a point it is not allowed to reach.
  const maxY = Math.min(bounds.max.y, viewTopAt(z));
  boid.wanderTarget.set(
    bounds.min.x + Math.random() * (bounds.max.x - bounds.min.x),
    bounds.min.y + Math.random() * (maxY - bounds.min.y),
    z
  );
}

export function initBoid(boid: Boid, bounds: Box3): void {
  pickWanderTarget(boid, bounds);
}

export function steer(
  boid: Boid,
  all: Boid[],
  bounds: Box3,
  cameraPos: Vector3,
  dt: number
): void {
  accel.set(0, 0, 0);

  // Wander: seek a roaming target, repicking when reached.
  if (
    boid.leader &&
    (boid.position.distanceToSquared(boid.wanderTarget) < Math.max(boid.length * 4, 0.15) ** 2 ||
      Math.random() < 0.003)
  ) {
    pickWanderTarget(boid, bounds);
  }
  desired.copy(boid.wanderTarget).sub(boid.position).normalize().multiplyScalar(boid.maxSpeed);
  desired.sub(boid.velocity);
  accel.addScaledVector(limit(desired, boid.maxForce), WANDER_WEIGHT);

  // Wall avoidance: push inward near each face. Margin scales with the tank so
  // small fish can roam close to the glass.
  const wallMargin = Math.min(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z
  ) * 0.12;
  for (const axis of ["x", "y", "z"] as const) {
    const p = boid.position[axis];
    // The ceiling follows the top edge of the frame rather than the box, so
    // fish stop where the picture stops. A fixed box top left about a tenth of
    // the shoal above the frame at any moment and produced a fish entering or
    // leaving the top of the picture every few seconds, because the frame
    // spreads with distance and the box does not.
    const max =
      axis === "y" ? Math.min(bounds.max.y, viewTopAt(boid.position.z)) : bounds.max[axis];
    if (p < bounds.min[axis] + wallMargin) {
      accel[axis] += (bounds.min[axis] + wallMargin - p) * WALL_WEIGHT;
    } else if (p > max - wallMargin) {
      accel[axis] -= (p - (max - wallMargin)) * WALL_WEIGHT;
    }
  }

  // Separation, cohesion and alignment in one pass, scoped to the same species
  // so a shark never tries to shoal with the tetras.
  desired.set(0, 0, 0);
  neighborPos.set(0, 0, 0);
  neighborVel.set(0, 0, 0);
  let sepN = 0;
  let shoalN = 0;
  const neighborRadius = boid.length * 14;
  for (const other of all) {
    if (other === boid || other.species !== boid.species) continue;
    const d = boid.position.distanceTo(other.position);
    if (d > 0 && d < boid.separationRadius) {
      tmp.copy(boid.position).sub(other.position).divideScalar(d * d);
      desired.add(tmp);
      sepN++;
    }
    if (d < neighborRadius) {
      neighborPos.add(other.position);
      neighborVel.add(other.velocity);
      shoalN++;
    }
  }
  if (sepN > 0) {
    accel.addScaledVector(desired.normalize().multiplyScalar(boid.maxForce), SEP_WEIGHT);
  }
  if (shoalN > 0) {
    // Cohesion: steer toward the mean neighbor position.
    cohesion.copy(neighborPos).divideScalar(shoalN).sub(boid.position);
    const cohLen = cohesion.length();
    if (cohLen > 1e-6) {
      cohesion.normalize().multiplyScalar(boid.maxSpeed);
      cohesion.sub(boid.velocity);
      accel.addScaledVector(limit(cohesion, boid.maxForce), COH_WEIGHT);
    }
    // Alignment: steer toward the mean neighbor velocity.
    alignment.copy(neighborVel).divideScalar(shoalN);
    const aliLen = alignment.length();
    if (aliLen > 1e-6) {
      alignment.normalize().multiplyScalar(boid.maxSpeed);
      alignment.sub(boid.velocity);
      accel.addScaledVector(limit(alignment, boid.maxForce), ALIGN_WEIGHT);
    }
  }

  // Camera avoidance: do not crowd the front glass.
  const dc = boid.position.distanceTo(cameraPos);
  if (dc < CAMERA_RADIUS) {
    tmp.copy(boid.position).sub(cameraPos).normalize();
    accel.addScaledVector(tmp, (CAMERA_RADIUS - dc) * CAMERA_WEIGHT);
  }

  // Keep the total gentle: velocity must not swing faster than the fish can
  // physically turn, or it ends up swimming sideways and backwards.
  limit(accel, boid.maxForce);
  boid.velocity.addScaledVector(accel, dt);

  // Clamp speed so motion stays calm and fish keep gliding.
  const sp = boid.velocity.length();
  if (sp > boid.maxSpeed) boid.velocity.multiplyScalar(boid.maxSpeed / sp);
  else if (sp < boid.minSpeed) {
    if (sp < 1e-4) boid.velocity.set(boid.minSpeed, 0, 0);
    else boid.velocity.multiplyScalar(boid.minSpeed / sp);
  }

  boid.position.addScaledVector(boid.velocity, dt);
}
