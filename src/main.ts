import { Clock, MathUtils, PerspectiveCamera, Scene, Vector3 } from "three";
import { createRenderer } from "./renderer";
import { effectivePixelRatio, isMobile, loadQuality, saveQuality, type QualityName } from "./quality";
import { buildTank } from "./scene/tank";
import { buildGround } from "./scene/ground";
import { buildRocks } from "./scene/rocks";
import { buildLighting } from "./scene/lighting";
import {
  buildWater,
  disposeWater,
  resizeWater,
  updateWater,
  waterHasCaptures
} from "./scene/water";
import { Motes } from "./scene/godrays";
import { updateCaustics } from "./scene/caustics";
import { buildPlants, updatePlants } from "./scene/plants";
import { updateWiggle } from "./fish/wiggle";
import { FishManager } from "./fish/FishManager";
import { PostPipeline } from "./post/composer";
import { Controls } from "./ui/controls";
import { revealLoadingWordmark } from "./ui/loadingWordmark";
import { initLoaders } from "./utils/loaders";
import { registerSW } from "./pwa";

// Camera framing. The composition is authored for a wide screen; a phone held
// upright is about 0.45 aspect, where the horizontal field of view collapses to
// roughly a 2 unit wide slice of a 9 unit fish region and a single near fish
// fills the frame. Visible width is always visible height times aspect, so a
// tall screen cannot be given more width without also being given more empty
// water above the tank. Instead the narrow slice is aimed lower, so the plant
// bed anchors the bottom of the frame instead of fog filling the top, with the
// camera pulled back and widened so no one fish dominates.
// Frame budget. On a phone this is a battery decision: drifting fish read the
// same at 30 fps as at 60, and this is meant to be left running. A desktop has
// no such constraint, and its display is often well above 60 Hz, where 30 fps
// reads as steppy rather than calm.
const TARGET_FPS = isMobile() ? 30 : 60;
const REFRESH_SLACK_MS = 4;

const BASE_FOV = 45;
const REFERENCE_ASPECT = 16 / 9;
const NARROW_ASPECT = 0.5;

function frameCamera(camera: PerspectiveCamera): void {
  const aspect = window.innerWidth / window.innerHeight;
  // 0 at the authored wide framing, 1 at phone-portrait proportions.
  const narrow = MathUtils.clamp(
    (REFERENCE_ASPECT - aspect) / (REFERENCE_ASPECT - NARROW_ASPECT),
    0,
    1
  );

  camera.aspect = aspect;
  camera.fov = MathUtils.lerp(BASE_FOV, 58, narrow);
  camera.position.set(0, MathUtils.lerp(-0.5, -0.15, narrow), MathUtils.lerp(6.0, 7.2, narrow));
  camera.updateProjectionMatrix();
  camera.lookAt(0, MathUtils.lerp(-0.7, -1.15, narrow), 0);
}

// Unobtrusive line over the live scene while the fish stream in, so the wait
// is legible without a full-screen loading state hiding the tank.
function makeFishProgress(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "left:0",
    "right:0",
    "bottom:22px",
    "text-align:center",
    "color:#82aab4",
    "font:300 12px/1.4 system-ui,sans-serif",
    "letter-spacing:0.12em",
    "text-transform:uppercase",
    "transition:opacity 0.8s ease",
    "pointer-events:none",
    "z-index:4"
  ].join(";");
  document.body.appendChild(el);
  return el;
}

const app = document.getElementById("app")!;
const loadingEl = document.getElementById("loading")!;
const loadingWordmarkEl = document.getElementById("loading-wordmark") as HTMLCanvasElement;
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

// Error nets guard startup only. Once the aquarium is running, a transient
// error must not blank a working scene and replace it with an error page; it
// goes to the console instead.
let booted = false;
window.addEventListener("error", (e) => {
  if (!booted) showFatal("Error: " + (e.message || String(e.error)));
});
window.addEventListener("unhandledrejection", (e) => {
  if (!booted) showFatal("Error: " + (e.reason?.message ?? String(e.reason)));
});

// Pre-flight checks that otherwise produce an eternal loading screen.
if (location.protocol === "file:") {
  showFatal("Open this through a local server (npm run dev / npm run preview), not file://.");
} else if (webglProblem()) {
  showFatal(WEBGL_HELP);
} else {
  registerSW();
  boot();
}

function boot(): void {

  let quality = loadQuality();

  const renderer = createRenderer(quality);
  initLoaders(renderer);
  app.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 100);
  frameCamera(camera);

  // Build the static scene.
  buildTank(scene);
  buildGround(scene);
  buildRocks(scene);
  buildPlants(scene);
  const lighting = buildLighting(scene, renderer, quality);
  let water = buildWater(scene, lighting.sun.position, quality);
  let motes = new Motes(scene, quality.motes);

  const post = new PostPipeline(renderer, scene, camera, quality);
  const fishManager = new FishManager();

  const controls = new Controls(quality.name, (name: QualityName) => {
    quality = saveQuality(name);
    applyQuality();
  });
  void controls;

  // The shadow map is rendered by every renderer.render() call, and a frame
  // makes several: the main pass plus the depth and normal prepasses that DOF
  // and AO each run. Those prepasses replace every material with a depth or
  // normal override, so the shadow map they rebuild is never sampled. Driving
  // the update by hand renders it once per frame instead of three times.
  renderer.shadowMap.autoUpdate = false;

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
    // The surface shader variant and its capture targets are fixed at
    // construction, so a tier that flips quality.water needs a new mesh.
    if (waterHasCaptures(water) !== quality.water) {
      disposeWater(water);
      water = buildWater(scene, lighting.sun.position, quality);
    } else {
      resizeWater(water, quality);
    }
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
    frameCamera(camera);
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
    resizeWater(water, quality);
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

  // Keep the screen awake: this is a screensaver, and a phone left showing it
  // would otherwise dim and lock within a minute. The lock is dropped by the
  // browser whenever the page is hidden, so it has to be re-taken on return.
  let wakeLock: WakeLockSentinel | null = null;
  async function acquireWakeLock(): Promise<void> {
    const nav = navigator as Navigator & { wakeLock?: WakeLock };
    if (!nav.wakeLock) return; // not supported, or insecure context
    try {
      wakeLock = await nav.wakeLock.request("screen");
    } catch {
      /* denied, or the document was not visible; not worth surfacing */
    }
  }
  void acquireWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && wakeLock === null) void acquireWakeLock();
  });

  let lastFrame = 0;
  function loop(): void {
    if (!running) return;
    requestAnimationFrame(loop);

    const now = performance.now();
    // Still throttled harder when the window is not focused.
    const minInterval = focused ? 1000 / TARGET_FPS : 1000 / 15;
    // The slack matters. rAF only fires on display refreshes, so comparing
    // against the bare interval means the gate can only pass on whole refresh
    // multiples: a 33.3 ms target on a 60 Hz screen misses its own 33.3 ms tick
    // by a rounding error and waits for the next one, which delivered 22.8 fps
    // in an alternating 33/50 ms beat that reads as judder. Half a refresh of
    // tolerance snaps the gate to the nearest tick instead.
    if (now - lastFrame < minInterval - REFRESH_SLACK_MS) return;
    lastFrame = now;

    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    // Fish and plants moved, so the one shadow render this frame is due.
    renderer.shadowMap.needsUpdate = quality.shadows;

    fishManager.update(dt, camera.position);
    updateWater(water, dt);
    updateCaustics(elapsed);
    updatePlants(elapsed);
    updateWiggle(elapsed);
    motes.update(dt);
    updateSunScreen();

    post.render(dt, elapsed);
  }

  // The tank, floor, plants, rocks and water are ready now, so start rendering
  // immediately and let the fish arrive into a scene that is already alive.
  // Waiting for every model before showing anything meant a slow link saw a
  // progress counter instead of an aquarium.
  loop();

  const fishProgressEl = makeFishProgress();

  fishManager
    .load(scene, (loadedBytes, totalBytes) => {
      // Byte-level, because the old (loaded/total) counter over nine very
      // unevenly sized files sat on one number for most of the wait.
      const pct = totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0;
      fishProgressEl.textContent = totalBytes > 0
        ? `Filling the tank… ${pct}%`
        : `Filling the tank… ${(loadedBytes / 1048576).toFixed(1)} MB`;
    })
    .then(async () => {
      // Compile every program the fish need before the scene is declared
      // ready. Otherwise each new material and pass combination compiles the
      // first time it happens to be drawn, and each of those stalls a frame by
      // 10-30 ms somewhere in the first minute of watching.
      await renderer.compileAsync(scene, camera);
      booted = true;
      // Explicit readiness signal. The loading overlay now clears when the
      // wordmark finishes rather than when the fish arrive, so "the scene is
      // complete" needs to be stated rather than inferred from the overlay.
      document.documentElement.dataset.aquariumReady = "1";
      fishProgressEl.style.opacity = "0";
      setTimeout(() => fishProgressEl.remove(), 900);
    })
    .catch((err) => {
      console.error("Failed to load fish:", err);
      if (!booted) showFatal("Failed to load aquarium assets: " + (err?.message ?? String(err)));
    });

  // Reveal the scene as soon as the wordmark has played, without waiting on
  // the fish.
  void wordmarkRevealed.then(() => loadingEl.classList.add("hidden"));
}
