import { Box3, Vector3 } from "three";

// A large volume the camera sits inside. Units are meters. Origin is the tank
// center; the water surface is at +halfH.
export const TANK = {
  width: 22, // x
  height: 7, // y
  depth: 22 // z
};

export const HALF = new Vector3(TANK.width / 2, TANK.height / 2, TANK.depth / 2);

// Region the fish steer within: a fixed volume in front of the camera, far
// smaller than the tank so the shoals stay in view. The box is deliberately
// close to the camera so the shoals sit in the near and mid field where their
// model detail is visible.
export function fishBounds(): Box3 {
  return new Box3(
    new Vector3(-4.6, -2.5, -3.5),
    new Vector3(4.6, 2.2, 5.6)
  );
}
