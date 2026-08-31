import { AnimationMixer, Group, MathUtils, Object3D, Vector3, type Scene } from "three";

// Big animals that cross the back of the tank rather than milling about in it.
//
// They are deliberately not boids. The fog is FogExp2 at density 0.11 and the
// camera sits at z = +6, so only 27-43% of a surface at z = -2.5 to -4.5 reaches
// the lens: an animal in that band reads as a shape resolving out of the murk,
// which is the whole effect. Boid steering would pull them forward into the
// shoal, where a 4.5 m body has nowhere to go and dwarfs everything.
//
// A pass runs from one side to the other along a slowly curving lane, then the
// animal leaves the frame. `idleAfterPass` is how long it stays gone: 0 makes a
// continuous patroller, a positive value makes an event worth waiting for.

export interface CruiserOptions {
  /** Metres per second along the lane. */
  speed: number;
  /** Seconds offscreen between passes; 0 patrols continuously. */
  idleAfterPass: number;
  /** Extra seconds of gap, picked per pass. */
  idleJitter: number;
  /** Half-width of the vertical drift over a pass. */
  bobAmplitude: number;
}

// The lane. Nearer than -2.5 the animal starts competing with the shoal for the
// mid-field; further than -4.5 the fog has swallowed it.
const LANE_NEAR = -2.5;
const LANE_FAR = -4.5;
// Far enough outside the frame that an animal is never seen popping into being;
// the frame is about 14 m wide at lane depth.
const OFFSCREEN_X = 9.5;

const orienter = new Object3D();
const lookTarget = new Vector3();

export class Cruiser {
  readonly object: Group;
  private mixer: AnimationMixer | null;
  private options: CruiserOptions;

  private position = new Vector3();
  private velocity = new Vector3();
  private direction: 1 | -1 = 1;
  private laneZ = LANE_NEAR;
  private baseY = 0;
  private bobPhase = 0;
  /** Counts down while the animal is offscreen between passes. */
  private waiting = 0;

  constructor(
    scene: Scene,
    holder: Group,
    mixer: AnimationMixer | null,
    options: CruiserOptions,
    startDelay: number
  ) {
    this.object = new Group();
    this.object.add(holder);
    this.mixer = mixer;
    this.options = options;
    scene.add(this.object);

    this.beginPass();
    this.waiting = startDelay;
    this.object.visible = startDelay <= 0;
  }

  private beginPass(): void {
    this.direction = Math.random() < 0.5 ? 1 : -1;
    this.laneZ = MathUtils.lerp(LANE_FAR, LANE_NEAR, Math.random());
    // Above the shoal's ceiling but below the water surface, so the big
    // silhouette crosses the upper third of the picture.
    this.baseY = MathUtils.lerp(-0.4, 1.4, Math.random());
    this.bobPhase = Math.random() * Math.PI * 2;
    this.position.set(-this.direction * OFFSCREEN_X, this.baseY, this.laneZ);
    this.waiting = 0;
    this.object.visible = true;
  }

  update(dt: number, elapsed: number): void {
    if (this.mixer) this.mixer.update(dt);

    if (this.waiting > 0) {
      this.waiting -= dt;
      if (this.waiting <= 0) this.beginPass();
      return;
    }

    const previous = this.position.clone();
    this.position.x += this.direction * this.options.speed * dt;
    // A shallow arc across the tank rather than a straight line: the lane
    // drifts in depth and the animal rises and falls slowly over the crossing.
    const progress = (this.position.x + OFFSCREEN_X) / (OFFSCREEN_X * 2);
    this.position.z = this.laneZ + Math.sin(progress * Math.PI) * 0.9;
    this.position.y =
      this.baseY + Math.sin(elapsed * 0.21 + this.bobPhase) * this.options.bobAmplitude;

    this.velocity.subVectors(this.position, previous);
    this.object.position.copy(this.position);

    if (this.velocity.lengthSq() > 1e-9) {
      orienter.position.copy(this.position);
      orienter.up.set(0, 1, 0);
      lookTarget.copy(this.position).add(this.velocity);
      orienter.lookAt(lookTarget);
      this.object.quaternion.slerp(orienter.quaternion, MathUtils.clamp(2.0 * dt, 0, 1));
    }

    if (Math.abs(this.position.x) > OFFSCREEN_X) {
      if (this.options.idleAfterPass <= 0) {
        this.beginPass();
      } else {
        this.waiting = this.options.idleAfterPass + Math.random() * this.options.idleJitter;
        this.object.visible = false;
      }
    }
  }
}
