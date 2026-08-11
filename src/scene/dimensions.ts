import { Box3, Vector3 } from "three";

// A compact desktop-sized tank. Units are meters. Origin is the tank center;
// the water surface is at +halfH.
export const TANK = {
  width: 8, // x
  height: 3.6, // y
  depth: 3.6 // z
};

export const HALF = new Vector3(TANK.width / 2, TANK.height / 2, TANK.depth / 2);

// Inner volume the fish steer within (kept off the glass).
export function fishBounds(margin = 0.25): Box3 {
  return new Box3(
    new Vector3(-HALF.x + margin, -HALF.y + margin, -HALF.z + margin),
    new Vector3(HALF.x - margin, HALF.y - margin, HALF.z - margin)
  );
}
