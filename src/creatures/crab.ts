import { AnimationMixer, Group, MathUtils, Vector3, type Scene } from "three";
import { HALF } from "../scene/dimensions";

// A crab walking the sand at the front of the tank.
//
// Two constraints set everything here. The floor only enters the frame from
// about z = -1.2 and behind, so there is no such thing as a crab in the near
// foreground; and at the nearest visible sand the frame is 11.8 m wide, where a
// 5 cm crab covers about five pixels. It is therefore staged in a narrow band
// of sand just inside the bottom of the picture, and scaled up (see
// CREATURE_ROSTER) well past its species' real size so it reads at all.
//
// Crabs walk sideways, so the body faces perpendicular to the direction of
// travel. Motion alternates between slow lateral traverses and stationary
// pauses, which is both what crabs do and what keeps a single small mover from
// sliding continuously across the bottom of a calm picture.

const BAND_NEAR = -1.6;
const BAND_FAR = -3.0;
const BAND_HALF_WIDTH = 3.6;

const WALK_SPEED = 0.16; // m/s
const PAUSE_MIN = 2.5;
const PAUSE_MAX = 7.0;
const WALK_MIN = 3.0;
const WALK_MAX = 9.0;

export class Crab {
  readonly object: Group;
  private mixer: AnimationMixer | null;

  private position = new Vector3();
  private direction: 1 | -1 = 1;
  private walking = true;
  private timer = 0;
  /** Eased 0..1 so the crab does not start and stop dead. */
  private gait = 0;

  constructor(scene: Scene, holder: Group, mixer: AnimationMixer | null, height: number) {
    this.mixer = mixer;
    this.object = new Group();
    // The holder is centered on the model, so lift it by half its height to set
    // the crab's feet on the sand rather than burying it to the waist.
    holder.position.y = height / 2;
    this.object.add(holder);
    scene.add(this.object);

    this.position.set(
      (Math.random() * 2 - 1) * BAND_HALF_WIDTH,
      -HALF.y,
      MathUtils.lerp(BAND_FAR, BAND_NEAR, Math.random())
    );
    this.direction = Math.random() < 0.5 ? 1 : -1;
    this.timer = WALK_MIN + Math.random() * (WALK_MAX - WALK_MIN);
    // Body broadside to the direction of travel.
    this.object.rotation.y = Math.PI / 2;
  }

  update(dt: number): void {
    // The walk clip only plays while the crab is actually moving, so a paused
    // crab is still rather than marching on the spot.
    if (this.mixerActive()) this.mixer!.update(dt * this.gait);

    this.timer -= dt;
    if (this.timer <= 0) {
      this.walking = !this.walking;
      this.timer = this.walking
        ? WALK_MIN + Math.random() * (WALK_MAX - WALK_MIN)
        : PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
      // Turning happens during a pause, which is when a real crab reverses.
      if (this.walking && Math.random() < 0.5) this.direction = this.direction === 1 ? -1 : 1;
    }

    const target = this.walking ? 1 : 0;
    this.gait = MathUtils.damp(this.gait, target, 3.0, dt);

    this.position.x += this.direction * WALK_SPEED * this.gait * dt;
    if (Math.abs(this.position.x) > BAND_HALF_WIDTH) {
      this.position.x = MathUtils.clamp(this.position.x, -BAND_HALF_WIDTH, BAND_HALF_WIDTH);
      this.direction = this.direction === 1 ? -1 : 1;
    }

    this.object.position.copy(this.position);
    this.object.rotation.y = this.direction === 1 ? Math.PI / 2 : -Math.PI / 2;
  }

  private mixerActive(): boolean {
    return this.mixer !== null && this.gait > 0.01;
  }
}
