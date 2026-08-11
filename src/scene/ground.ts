import {
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Vector2,
  type Scene
} from "three";
import { TANK } from "./dimensions";
import { FLOOR_Y } from "./tank";
import { makeGroundTextures } from "../utils/textures";
import { registerCaustics } from "./caustics";

// Sand substrate with procedural PBR textures, receiving caustics and shadows.
export function buildGround(scene: Scene): Mesh {
  const { map, normalMap } = makeGroundTextures();
  const repeat = 40;
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat, repeat * (TANK.depth / TANK.width));
  }

  const mat = new MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new Vector2(1.2, 1.2),
    roughness: 0.95,
    metalness: 0,
    color: 0xa89b7e
  });
  registerCaustics(mat);

  const ground = new Mesh(new PlaneGeometry(TANK.width, TANK.depth, 1, 1), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = FLOOR_Y + 0.01;
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);
  return ground;
}
