import { AnimationMixer, MathUtils, Object3D, Vector3 } from "three";
import type { Boid } from "./boids";

// One swimming fish: a boid-driven agent group whose child holder carries the
// (forward-corrected, scaled) model. The agent's +Z is the swim direction.
const orienter = new Object3D();
const lookTarget = new Vector3();

export class Fish {
  readonly object: Object3D;
  readonly boid: Boid;
  readonly mixer: AnimationMixer | null;
  private turnRate: number;

  constructor(object: Object3D, boid: Boid, mixer: AnimationMixer | null, turnRate: number) {
    this.object = object;
    this.boid = boid;
    this.mixer = mixer;
    this.turnRate = turnRate;
  }

  update(dt: number): void {
    if (this.mixer) this.mixer.update(dt);

    this.object.position.copy(this.boid.position);

    // Orient the agent so +Z faces the velocity, easing into turns.
    if (this.boid.velocity.lengthSq() > 1e-6) {
      orienter.position.copy(this.boid.position);
      orienter.up.set(0, 1, 0);
      lookTarget.copy(this.boid.position).add(this.boid.velocity);
      orienter.lookAt(lookTarget);
      const t = MathUtils.clamp(this.turnRate * dt, 0, 1);
      this.object.quaternion.slerp(orienter.quaternion, t);
    }
  }
}
