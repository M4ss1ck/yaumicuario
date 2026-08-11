import {
  BackSide,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Scene
} from "three";
import { HALF, TANK } from "./dimensions";

// The water volume. Rather than bright transmissive glass panes (which read as
// flat panels filling the view), we use an inward-facing dark shell that
// dissolves into the fog, so the far walls recede into murk. The scene
// background is set to the fog color in lighting.ts so empty space matches.
export function buildTank(scene: Scene): Group {
  const group = new Group();
  group.name = "tank";

  // Matching the fog color exactly is what lets the walls dissolve instead of
  // reading as a lit box with hard corner seams.
  const wall = new MeshStandardMaterial({
    color: 0x052028,
    metalness: 0,
    roughness: 1,
    envMapIntensity: 0.15,
    side: BackSide
  });

  const box = new Mesh(
    new BoxGeometry(TANK.width, TANK.height, TANK.depth),
    wall
  );
  box.name = "shell";
  box.receiveShadow = true;
  group.add(box);

  scene.add(group);
  return group;
}

export const SURFACE_Y = HALF.y;
export const FLOOR_Y = -HALF.y;
