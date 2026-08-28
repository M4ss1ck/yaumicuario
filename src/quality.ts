// Quality tiers. Each tier toggles the expensive effects, scales the render
// resolution and caps the effective pixel ratio.
// The user choice persists in localStorage (allowed: this is a normal web app).

export type QualityName = "Low" | "Medium" | "High" | "Ultra";

export interface QualitySettings {
  name: QualityName;
  renderScale: number; // supersampling multiplier on top of the device DPR
  maxPixelRatio: number; // cap for the effective pixel ratio
  msaa: number; // multisample count for the composer targets
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  dof: boolean;
  godRays: boolean;
  ao: boolean;
  water: boolean; // planar reflection/refraction captures on the surface
  waterCaptureSize: number; // per-axis cap for the two capture targets
  motes: number; // particle count
}

// Effective device pixel ratio: the CSS resolution times the tier's render
// scale, capped so very high-DPR displays don't pay for pixels nobody can see.
// Supersampling on DPR 1 displays comes from renderScale > 1, not from the
// device's own pixel density.
export function effectivePixelRatio(quality: QualitySettings): number {
  return Math.min(window.devicePixelRatio * quality.renderScale, quality.maxPixelRatio);
}

const TIERS: Record<QualityName, QualitySettings> = {
  Low: {
    name: "Low",
    renderScale: 1,
    maxPixelRatio: 1,
    msaa: 0,
    shadows: false,
    shadowMapSize: 512,
    bloom: false,
    dof: false,
    godRays: false,
    ao: false,
    water: false,
    waterCaptureSize: 0,
    motes: 0
  },
  Medium: {
    name: "Medium",
    renderScale: 1,
    maxPixelRatio: 1.25,
    msaa: 0,
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    dof: false,
    godRays: true,
    ao: false,
    water: true,
    waterCaptureSize: 512,
    motes: 250
  },
  High: {
    name: "High",
    renderScale: 1.25,
    maxPixelRatio: 2,
    msaa: 2,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    dof: true,
    godRays: true,
    ao: true,
    water: true,
    waterCaptureSize: 768,
    motes: 600
  },
  Ultra: {
    name: "Ultra",
    renderScale: 2,
    maxPixelRatio: 3,
    msaa: 4,
    shadows: true,
    shadowMapSize: 4096,
    bloom: true,
    dof: true,
    godRays: true,
    ao: true,
    water: true,
    waterCaptureSize: 1024,
    motes: 1200
  }
};

const STORAGE_KEY = "aquarium.quality";

// Pick a sensible default from the hardware before the user overrides it.
function autoDetect(): QualityName {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (mobile) return "Low";
  if (cores >= 8 && mem >= 8) return "High";
  if (cores >= 4) return "Medium";
  return "Low";
}

export function loadQuality(): QualitySettings {
  const stored = localStorage.getItem(STORAGE_KEY) as QualityName | null;
  const name = stored && TIERS[stored] ? stored : autoDetect();
  return TIERS[name];
}

export function saveQuality(name: QualityName): QualitySettings {
  localStorage.setItem(STORAGE_KEY, name);
  return TIERS[name];
}

export const QUALITY_NAMES: QualityName[] = ["Low", "Medium", "High", "Ultra"];
