// Visual capture harness.
//
// Renders the production build in headless Chrome under the determinism shim
// and writes a fixed set of PNG frames. Two runs of the same commit must
// produce byte-identical output; that property is what makes the diff script a
// usable regression tripwire.
//
//   node scripts/capture.mjs --out captures/baseline [--build] [--preset phone-portrait]
//
// Presets deliberately include a Samsung-like mobile UA, because autoDetect()
// in src/quality.ts branches on it and the phone path (Low tier) is the one the
// recipient actually runs.

import { createServer } from "node:http";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const SAMSUNG_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/152.0.0.0 Mobile Safari/537.36";

// Captured this many pumped frames after the scene becomes ready, so a
// regression in motion (fish drift, caustics, water) shows up as well as one in
// static composition. Boot itself takes a variable number of frames because
// GLTF loads settle in real time, but the scene's own clocks start from zero
// when the render loop starts, so counting from ready is what makes runs
// comparable.
const FRAME_CHECKPOINTS = [0, 30, 90];

// SwiftShader renders the full post stack in software, so a pumped frame can
// still be in flight when the pump call returns. Let the compositor present
// before grabbing pixels, or the screenshot races the renderer.
const PRESENT_SETTLE_MS = 250;

const PRESETS = {
  "phone-portrait": { width: 360, height: 800, dpr: 2, mobile: true },
  "phone-landscape": { width: 800, height: 360, dpr: 2, mobile: true },
  desktop: { width: 1280, height: 720, dpr: 1, mobile: false }
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function parseArgs(argv) {
  const args = { out: null, build: false, presets: Object.keys(PRESETS), maxBootFrames: 1200 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--build") args.build = true;
    else if (argv[i] === "--preset") args.presets = [argv[++i]];
    else if (argv[i] === "--max-boot-frames") args.maxBootFrames = Number(argv[++i]);
  }
  if (!args.out) {
    console.error("usage: node scripts/capture.mjs --out <dir> [--build] [--preset <name>]");
    process.exit(2);
  }
  for (const name of args.presets) {
    if (!PRESETS[name]) {
      console.error(`unknown preset: ${name}. known: ${Object.keys(PRESETS).join(", ")}`);
      process.exit(2);
    }
  }
  return args;
}

function serveDist() {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = join(DIST, path === "/" ? "index.html" : path);
      if (!file.startsWith(DIST)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file)] || "application/octet-stream",
        "cache-control": "no-store"
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function capturePreset(browser, shim, port, name, outDir, maxBootFrames) {
  const preset = PRESETS[name];
  const page = await browser.newPage();

  await page.setViewport({
    width: preset.width,
    height: preset.height,
    deviceScaleFactor: preset.dpr,
    isMobile: preset.mobile,
    hasTouch: preset.mobile
  });
  if (preset.mobile) await page.setUserAgent(SAMSUNG_UA);

  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err.message || err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.evaluateOnNewDocument(shim);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

  const bootFrames = await page.evaluate(
    (max) => window.__capture.pumpUntilReady(max),
    maxBootFrames
  );

  if (bootFrames < 0) {
    const fatal = await page.evaluate(() => window.__capture.fatalMessage());
    await page.close();
    throw new Error(
      `[${name}] scene never became ready within ${maxBootFrames} frames` +
        (fatal ? `: ${fatal}` : "") +
        (consoleErrors.length ? `\n  console: ${consoleErrors.slice(0, 5).join("\n  ")}` : "")
    );
  }

  const written = [];
  let pumped = 0;
  for (const checkpoint of FRAME_CHECKPOINTS) {
    await page.evaluate((n) => window.__capture.pump(n), checkpoint - pumped);
    pumped = checkpoint;
    await new Promise((resolve) => setTimeout(resolve, PRESENT_SETTLE_MS));
    const file = join(outDir, `${name}-f${String(checkpoint).padStart(3, "0")}.png`);
    await page.screenshot({ path: file, captureBeyondViewport: false });
    written.push(file);
  }

  const state = await page.evaluate(() => ({
    virtualNow: window.__capture.virtualNow,
    framesPumped: window.__capture.framesPumped,
    randomCalls: window.__capture.randomCalls
  }));
  await page.close();

  return { bootFrames, ...state, written, consoleErrors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.build) {
    const { execSync } = await import("node:child_process");
    execSync("npx vite build", { cwd: ROOT, stdio: "inherit" });
  }

  const outDir = join(ROOT, args.out);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const shim = await readFile(join(ROOT, "scripts", "capture-shim.js"), "utf8");
  const { server, port } = await serveDist();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // Software rendering makes a pumped batch of frames slow; the default
    // 180s CDP timeout is not enough for the larger checkpoints.
    protocolTimeout: 900_000,
    args: [
      "--headless=new",
      // Software GL: no display is available and SwiftShader is deterministic
      // for a given binary, which is what the diff tripwire depends on.
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-gpu-sandbox",
      "--no-sandbox",
      "--hide-scrollbars",
      "--mute-audio",
      // Skips the wordmark's timed reveal so boot reaches the scene in a
      // handful of frames instead of ~150. The 3D scene is unaffected.
      "--force-prefers-reduced-motion"
    ]
  });

  const summary = {};
  let failure = null;
  try {
    for (const name of args.presets) {
      process.stdout.write(`capturing ${name} ... `);
      const result = await capturePreset(browser, shim, port, name, outDir, args.maxBootFrames);
      summary[name] = {
        bootFrames: result.bootFrames,
        framesPumped: result.framesPumped,
        randomCalls: result.randomCalls,
        virtualNowMs: result.virtualNow,
        frames: result.written.map((f) => f.replace(outDir + "/", "")),
        consoleErrors: result.consoleErrors
      };
      console.log(
        `ready after ${result.bootFrames} frames, ${result.written.length} captures` +
          (result.consoleErrors.length ? `, ${result.consoleErrors.length} console errors` : "")
      );
    }
  } catch (err) {
    failure = err;
  } finally {
    await browser.close();
    server.close();
  }

  if (failure) {
    console.error(String(failure.message || failure));
    process.exit(1);
  }

  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`\nwrote ${outDir}`);
}

main();
