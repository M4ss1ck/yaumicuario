import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
  type Scene
} from "three";
import { HALF } from "./dimensions";
import { makeBubbleSprite } from "../utils/textures";

// A bubble column rising from behind the near hero stone.
//
// It exists to give the ambient bubble sound somewhere to come from: the tank
// had no bubbler, so a bubble track would have been a noise from nowhere. Built
// on the same Points-plus-sprite pattern as the suspended motes, because a few
// dozen billboards is the whole cost and it renders on every quality tier for
// that reason, unlike the motes which Low switches off entirely.

// Behind the near hero stone, which sits at (5.6, -2.6) and spans roughly
// z = -3.6 to -1.6 (see rocks.ts). The vent has to clear the far side of that
// footprint, or the bubbles spawn inside the rock and rise through it.
const SOURCE_X = 5.6;
const SOURCE_Z = -3.9;
// Bubbles leave the vent within a few centimetres of each other and spread as
// they climb, which is what makes a column read as a column.
const VENT_SPREAD = 0.05;
const DRIFT_SPREAD = 0.22;

interface BubbleState {
  /** 0 at the vent, 1 at the surface. */
  rise: number;
  speed: number;
  wobblePhase: number;
  wobbleRate: number;
}

export class Bubbles {
  readonly points: Points;
  private states: BubbleState[] = [];
  private count: number;
  private originX: Float32Array;
  private originZ: Float32Array;

  constructor(scene: Scene, count: number) {
    this.count = count;
    const positions = new Float32Array(count * 3);
    this.originX = new Float32Array(count);
    this.originZ = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      this.states.push(this.newState(Math.random()));
      this.originX[i] = SOURCE_X + (Math.random() - 0.5) * VENT_SPREAD;
      this.originZ[i] = SOURCE_Z + (Math.random() - 0.5) * VENT_SPREAD;
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    const mat = new PointsMaterial({
      size: 0.075,
      map: makeBubbleSprite(),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      opacity: 0.65,
      color: 0xd8f4ff,
      sizeAttenuation: true
    });
    this.points = new Points(geo, mat);
    this.points.name = "bubbles";
    // The column spans the full water height, and a Points bounding sphere
    // computed from a single frame's positions would cull it as the bubbles
    // move. It is one draw call, so skipping the frustum test costs nothing.
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.update(0);
  }

  private newState(rise: number): BubbleState {
    return {
      rise,
      // Varied rise rates are what stop the column looking like a rigid
      // conveyor of evenly spaced dots.
      speed: 0.22 + Math.random() * 0.3,
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleRate: 1.4 + Math.random() * 1.8
    };
  }

  dispose(): void {
    this.points.parent?.remove(this.points);
    this.points.geometry.dispose();
    const mat = this.points.material as PointsMaterial;
    mat.dispose();
    mat.map?.dispose();
  }

  update(dt: number): void {
    const pos = this.points.geometry.getAttribute("position") as BufferAttribute;
    const a = pos.array as Float32Array;
    const floor = -HALF.y;
    const height = HALF.y * 2;

    for (let i = 0; i < this.count; i++) {
      const state = this.states[i];
      state.rise += (state.speed / height) * dt;
      if (state.rise >= 1) {
        // Respawn at the vent rather than wrapping in place, so a bubble is
        // never seen appearing halfway up the water column.
        this.states[i] = this.newState(0);
        this.originX[i] = SOURCE_X + (Math.random() - 0.5) * VENT_SPREAD;
        this.originZ[i] = SOURCE_Z + (Math.random() - 0.5) * VENT_SPREAD;
        continue;
      }
      const wobble = Math.sin(state.rise * height * state.wobbleRate + state.wobblePhase);
      a[i * 3] = this.originX[i] + wobble * DRIFT_SPREAD * state.rise;
      a[i * 3 + 1] = floor + state.rise * height;
      a[i * 3 + 2] =
        this.originZ[i] + Math.cos(state.rise * height * state.wobbleRate * 0.7) * DRIFT_SPREAD * 0.5 * state.rise;
    }
    pos.needsUpdate = true;
  }
}
