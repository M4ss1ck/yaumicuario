// Quality tiers. Each tier toggles the expensive effects and caps resolution.
// The user choice persists in localStorage (allowed: this is a normal web app).

export type QualityName = "Low" | "Medium" | "High" | "Ultra";

export interface QualitySettings {
  name: QualityName;
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  dof: boolean;
  godRays: boolean;
  water: boolean;
  motes: number; // particle count
}

const TIERS: Record<QualityName, QualitySettings> = {
  Low: {
    name: "Low",
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 512,
    bloom: false,
    dof: false,
    godRays: false,
    water: true,
    motes: 0
  },
  Medium: {
    name: "Medium",
    pixelRatioCap: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    dof: false,
    godRays: true,
    water: true,
    motes: 250
  },
  High: {
    name: "High",
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    dof: true,
    godRays: true,
    water: true,
    motes: 600
  },
  Ultra: {
    name: "Ultra",
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 4096,
    bloom: true,
    dof: true,
    godRays: true,
    water: true,
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
