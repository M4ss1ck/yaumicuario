// Steady-state frame cost for the current build, on one capture preset.
//
//   node scripts/bench-frames.mjs [--preset phone-portrait] [--frames 60]
//
// Pumps frames one at a time and records how long each takes in real time.
// Rendering is SwiftShader (CPU), so the absolute numbers mean nothing; the
// ratio between two builds is the useful signal, because the same software
// rasterizer does proportionally more work for more draw calls and passes.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const SAMSUNG_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/152.0.0.0 Mobile Safari/537.36";

const PRESETS = {
  "phone-portrait": { width: 360, height: 800, dpr: 2, mobile: true },
  "phone-landscape": { width: 800, height: 360, dpr: 2, mobile: true },
  desktop: { width: 1280, height: 720, dpr: 1, mobile: false }
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".glb": "model/gltf-binary" };

const args = { preset: "phone-portrait", frames: 60, warmup: 10 };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--preset") args.preset = process.argv[++i];
  else if (process.argv[i] === "--frames") args.frames = Number(process.argv[++i]);
}

const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = join(DIST, p === "/" ? "index.html" : p);
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(await readFile(f));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const shim = await readFile(join(ROOT, "scripts", "capture-shim.js"), "utf8");
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 900_000,
  args: [
    "--headless=new",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--hide-scrollbars",
    "--force-prefers-reduced-motion"
  ]
});

const preset = PRESETS[args.preset];
const page = await browser.newPage();
await page.setViewport({
  width: preset.width,
  height: preset.height,
  deviceScaleFactor: preset.dpr,
  isMobile: preset.mobile,
  hasTouch: preset.mobile
});
if (preset.mobile) await page.setUserAgent(SAMSUNG_UA);
await page.evaluateOnNewDocument(shim);
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

await page.evaluate(() => window.__capture.pumpUntilReady(1200));
// Warm up: first frames include shader compiles and texture uploads.
await page.evaluate((n) => window.__capture.pump(n), args.warmup);

const samples = await page.evaluate(async (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const start = window.__capture.realElapsed;
    await window.__capture.pump(1);
    out.push(window.__capture.realElapsed - start);
  }
  return out;
}, args.frames);

await browser.close();
server.close();

samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
console.log(
  `${args.preset}: ${args.frames} frames  median ${median.toFixed(1)}ms  ` +
    `mean ${mean.toFixed(1)}ms  p10 ${samples[Math.floor(samples.length * 0.1)].toFixed(1)}ms  ` +
    `p90 ${samples[Math.floor(samples.length * 0.9)].toFixed(1)}ms`
);
