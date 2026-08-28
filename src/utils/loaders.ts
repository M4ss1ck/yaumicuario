import { LoadingManager, type WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

// Shared loading manager so the UI can show overall progress.
export const loadingManager = new LoadingManager();

const gltfLoader = new GLTFLoader(loadingManager);

// The fish models carry KTX2/Basis textures and meshopt-compressed geometry
// (see scripts/optimize-assets.mjs), so both decoders must be wired before any
// of them will parse. KTX2 transcoding needs the renderer to pick a GPU format
// the device actually supports, which is why this cannot run at module scope.
// The transcoder files in public/basis/ are copied from the three.js version in
// package.json and must be refreshed when three is upgraded.
export function initLoaders(renderer: WebGLRenderer): void {
  const ktx2Loader = new KTX2Loader(loadingManager)
    .setTranscoderPath(asset("basis/"))
    .detectSupport(renderer);
  gltfLoader.setKTX2Loader(ktx2Loader);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
}

export function loadGLTF(
  url: string,
  onProgress?: (event: ProgressEvent) => void
): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, resolve, onProgress, reject);
  });
}

// Resolve an asset served from public/ at runtime, respecting Vite's base path.
export function asset(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
}
