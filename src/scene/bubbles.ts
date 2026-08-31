import {
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

// Near the center-rear reef mass, and behind the fish steering box (which ends
// at z = -3.5) so nothing swims through the column.
//
// It was originally behind the near hero stone stage right, which framed better
// on a wide screen but sat outside the portrait frame entirely: a phone heard
// bubbles and saw none, which defeats the point of having a visible source.
//
// The x is also chosen to sit between two of the god-ray beams rather than
// under one. The beams in post/godrays.ts are centred at screen u = 0.20, 0.41,
// 0.62 and 0.79, and additively blended bubbles crossing the brightest one lose
// almost all their contrast: the column appeared to stop partway up.
const SOURCE_X = 0.9;
const SOURCE_Z = -4.6;
// Bubbles leave the vent within a few centimetres of each other and spread as
// they climb, which is what makes a column read as a column.
const VENT_SPREAD = 0.05;
const DRIFT_SPREAD = 0.13;

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
      size: 0.11,
      map: makeBubbleSprite(),
      transparent: true,
      depthWrite: false,
      // Normal blending, not additive, and unfogged. Both are about the same
      // problem: the column sits 10.6 m from the camera, where FogExp2 at
      // density 0.11 fades it 76% toward the fog colour, which is exactly the
      // colour of the open water it is seen against above the plant line. The
      // bubbles were there the whole way up (their positions are uniform to the
      // surface) but faded into the background they were drawn on. Exempting
      // them from fog keeps them legible over water as well as over the sand,
      // and the sprite's own dark ring does the rest.
      fog: false,
      opacity: 0.82,
      color: 0xd8f4ff,
      sizeAttenuation: true
    });
    this.points = new Points(geo, mat);
    this.points.name = "bubbles";
    // The column spans the full water height, and a Points bounding sphere
    // computed from a single frame's positions would cull it as the bubbles
    // move. It is one draw call, so skipping the frustum test costs nothing.
    this.points.frustumCulled = false;
    // Draw after the water surface. Both are transparent, and three.js sorts
    // the transparent queue back to front by object distance: the water's
    // origin is nearer the camera than the column's, so the surface was being
    // composited over the bubbles and washing out the top of the column, which
    // is the part seen against open water rather than against the sand.
    this.points.renderOrder = 2;
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
      let state = this.states[i];
      state.rise += (state.speed / height) * dt;
      if (state.rise >= 1) {
        // Respawn at the vent rather than wrapping in place, so a bubble is
        // never seen appearing halfway up the water column. Fall through to the
        // position write: skipping it left last frame's position, up at the
        // surface, in the buffer for a frame.
        this.states[i] = this.newState(0);
        this.originX[i] = SOURCE_X + (Math.random() - 0.5) * VENT_SPREAD;
        this.originZ[i] = SOURCE_Z + (Math.random() - 0.5) * VENT_SPREAD;
        state = this.states[i];
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
