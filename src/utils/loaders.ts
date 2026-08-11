import { LoadingManager } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

// Shared loading manager so the UI can show overall progress.
export const loadingManager = new LoadingManager();

const gltfLoader = new GLTFLoader(loadingManager);

// The bundled models are plain glTF (no DRACO / meshopt required), so a default
// GLTFLoader is enough. If compressed assets are added later, wire decoders here.
export function loadGLTF(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, resolve, undefined, reject);
  });
}

// Resolve an asset served from public/ at runtime, respecting Vite's base path.
export function asset(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
}
