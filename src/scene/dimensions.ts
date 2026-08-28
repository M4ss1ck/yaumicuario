import { Box3, Matrix4, Plane, Vector3, type PerspectiveCamera } from "three";

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

// What the camera actually sees is a frustum, not a box: the top and bottom
// edges of the frame spread apart with distance. A fixed ceiling is therefore
// wrong at both ends - it sits below the frame far away, where fish can never
// rise into the top of the picture, and above it up close, where they swim out
// of frame entirely. Measured on the authored wide framing, the top edge runs
// from y = 1.75 at z = 0 to y = 5.14 at z = -9, against a fish ceiling of 2.2.
// Both edges are planes, so each is one linear function of z.
interface Edge {
  a: number; // world Y at z = 0
  b: number; // change in world Y per unit of z
}

const viewTop: Edge = { a: Infinity, b: 0 };
const viewBottom: Edge = { a: -Infinity, b: 0 };

// Solve n.y * y + n.z * z + d = 0 for y, at x = 0. The camera has no roll, so
// the top and bottom plane normals have no x component and the edge does not
// depend on x.
function edgeFromPlane(plane: Plane, out: Edge): void {
  out.a = -plane.constant / plane.normal.y;
  out.b = -plane.normal.z / plane.normal.y;
}

// Recomputed whenever the camera is framed, which is at startup and on resize.
export function updateViewEdges(camera: PerspectiveCamera): void {
  camera.updateMatrixWorld();
  const e = new Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .elements;
  edgeFromPlane(
    new Plane(new Vector3(e[3] - e[1], e[7] - e[5], e[11] - e[9]), e[15] - e[13]).normalize(),
    viewTop
  );
  edgeFromPlane(
    new Plane(new Vector3(e[3] + e[1], e[7] + e[5], e[11] + e[9]), e[15] + e[13]).normalize(),
    viewBottom
  );
}

export function viewTopAt(z: number): number {
  return viewTop.a + viewTop.b * z;
}

export function viewBottomAt(z: number): number {
  return viewBottom.a + viewBottom.b * z;
}
