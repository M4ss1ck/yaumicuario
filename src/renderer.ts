import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  SRGBColorSpace,
  WebGLRenderer
} from "three";
import { effectivePixelRatio, type QualitySettings } from "./quality";

// WebGPU detection. The plan targets WebGPU first, but the rich post-processing
// pipeline (EffectComposer, bloom, DOF, god rays) is the proven WebGL2 path and
// is what ships here. We keep the probe so a WebGPU/TSL port can branch later;
// for now we always run the WebGL2 path, which the plan designates as the
// guaranteed-functional fallback.
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function createRenderer(quality: QualitySettings): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    stencil: false
  });

  renderer.outputColorSpace = SRGBColorSpace;
  // Tone mapping is applied by the composer's OutputPass at the end of the chain.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;

  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;

  renderer.setPixelRatio(effectivePixelRatio(quality));
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (isWebGPUAvailable()) {
    console.info("WebGPU is available; running the WebGL2 path (post pipeline).");
  } else {
    console.info("WebGPU not available; running WebGL2.");
  }

  return renderer;
}
