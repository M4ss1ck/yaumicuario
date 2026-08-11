import { Clock, PerspectiveCamera, Scene, Vector3 } from "three";
import { createRenderer } from "./renderer";
import { effectivePixelRatio, loadQuality, saveQuality, type QualityName } from "./quality";
import { buildTank } from "./scene/tank";
import { buildGround } from "./scene/ground";
import { buildRocks } from "./scene/rocks";
import { buildLighting } from "./scene/lighting";
import { buildWater, resizeWater, updateWater } from "./scene/water";
import { Motes } from "./scene/godrays";
import { updateCaustics } from "./scene/caustics";
import { buildPlants, updatePlants } from "./scene/plants";
import { updateWiggle } from "./fish/wiggle";
import { FishManager } from "./fish/FishManager";
import { PostPipeline } from "./post/composer";
import { Controls } from "./ui/controls";
import { revealLoadingWordmark } from "./ui/loadingWordmark";
import { loadingManager } from "./utils/loaders";

const app = document.getElementById("app")!;
const loadingEl = document.getElementById("loading")!;
const loadingWordmarkEl = document.getElementById("loading-wordmark") as HTMLCanvasElement;
const loadingProgressEl = document.getElementById("loading-progress")!;
const wordmarkRevealed = revealLoadingWordmark(loadingWordmarkEl);

// Surface any failure instead of hanging on "Loading…" forever.
function showFatal(msg: string): void {
  loadingEl.innerHTML = msg;
  loadingEl.style.cssText +=
    ";opacity:1;padding:24px;text-align:center;max-width:640px;margin:auto;left:0;right:0";
  loadingEl.classList.remove("hidden");
}

// Returns null if a WebGL2 context cannot be created (the reason, if any).
function webglProblem(): string | null {
  const canvas = document.createElement("canvas");
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2");
  } catch {
    /* getContext can throw in locked-down configs */
  }
  if (gl) {
    gl.getExtension("WEBGL_lose_context")?.loseContext(); // free it for the real renderer
    return null;
  }
  return "no-webgl2";
}

const WEBGL_HELP = `
  <div style="font:600 20px/1.4 system-ui,sans-serif;margin-bottom:12px">
    WebGL is disabled in your browser
  </div>
  <div style="font:300 15px/1.6 system-ui,sans-serif;color:#9fc3cd">
    This 3D aquarium needs WebGL, and your browser cannot create a WebGL context
    (it reports the GPU as "Disabled"). To fix it:
    <ol style="text-align:left;display:inline-block;margin-top:10px">
      <li>Open <b>chrome://settings/system</b> and turn on
          <b>"Use hardware acceleration when available"</b>, then relaunch Chrome.</li>
      <li>If that is already on, open <b>chrome://gpu</b> and check that
          <b>WebGL / WebGL2</b> say "Hardware accelerated".</li>
      <li>As a fallback, open <b>chrome://flags</b>, set
          <b>"Override software rendering list"</b> to <b>Enabled</b>, and relaunch.</li>
    </ol>
    <div style="margin-top:8px">Then reload this page.</div>
  </div>
`;

// Global error nets (catch top-level throws too).
window.addEventListener("error", (e) => showFatal("Error: " + (e.message || String(e.error))));
window.addEventListener("unhandledrejection", (e) =>
  showFatal("Error: " + (e.reason?.message ?? String(e.reason)))
);

// Pre-flight checks that otherwise produce an eternal loading screen.
if (location.protocol === "file:") {
  showFatal("Open this through a local server (npm run dev / npm run preview), not file://.");
} else if (webglProblem()) {
  showFatal(WEBGL_HELP);
} else {
  boot();
}

function boot(): void {
  // Show load progress so a slow/failed asset is distinguishable from a crash.
  loadingManager.onProgress = (_url, loaded, total) => {
    if (!loadingEl.classList.contains("hidden")) {
      loadingProgressEl.textContent = `Loading aquarium… (${loaded}/${total})`;
    }
  };

  let quality = loadQuality();

  const renderer = createRenderer(quality);
  app.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, -0.5, 6.0);
  camera.lookAt(0, -0.7, 0);

  // Build the static scene.
  buildTank(scene);
  buildGround(scene);
  buildRocks(scene);
  buildPlants(scene);
  const lighting = buildLighting(scene, renderer, quality);
  const water = buildWater(scene, lighting.sun.position);
  let motes = new Motes(scene, quality.motes);

  const post = new PostPipeline(renderer, scene, camera, quality);
  const fishManager = new FishManager();

  const controls = new Controls(quality.name, (name: QualityName) => {
    quality = saveQuality(name);
    applyQuality();
  });
  void controls;

  function applyQuality(): void {
    renderer.setPixelRatio(effectivePixelRatio(quality));
    renderer.shadowMap.enabled = quality.shadows;
    lighting.sun.castShadow = quality.shadows;
    if (quality.shadows) lighting.sun.shadow.mapSize.setScalar(quality.shadowMapSize);
    post.applyQuality(quality);
    post.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
    // Rebuild motes to match the new particle budget.
    motes.dispose();
    motes = new Motes(scene, quality.motes);
  }

  // Project the sun position to screen space for the god-ray pass.
  const sunNdc = new Vector3();
  function updateSunScreen(): void {
    sunNdc.copy(lighting.sunWorldPos).project(camera);
    post.setSunScreenPos(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
  }

  const clock = new Clock();
  let elapsed = 0;
  let running = true;
  let focused = true;

  function onResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
    resizeWater(water);
  }
  window.addEventListener("resize", onResize);

  // Pause when the tab is hidden; throttle when the window loses focus.
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) {
      clock.getDelta(); // drop the accumulated gap
      loop();
    }
  });
  window.addEventListener("blur", () => (focused = false));
  window.addEventListener("focus", () => (focused = true));

  let lastFrame = 0;
  function loop(): void {
    if (!running) return;
    requestAnimationFrame(loop);

    const now = performance.now();
    // Throttle to ~15 fps when unfocused to save power during long sessions.
    const minInterval = focused ? 0 : 1000 / 15;
    if (now - lastFrame < minInterval) return;
    lastFrame = now;

    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    fishManager.update(dt, camera.position);
    updateWater(water, dt);
    updateCaustics(elapsed);
    updatePlants(elapsed);
    updateWiggle(elapsed);
    motes.update(dt);
    updateSunScreen();

    post.render(dt, elapsed);
  }

  // Load fish, then start the loop.
  fishManager
    .load(scene)
    .then(() => wordmarkRevealed)
    .then(() => {
      loadingEl.classList.add("hidden");
      loop();
    })
    .catch((err) => {
      console.error("Failed to load fish:", err);
      showFatal("Failed to load aquarium assets: " + (err?.message ?? String(err)));
    });
}
