import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Walk dist recursively
function walk(dir, base) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

async function main() {
  const dist = path.resolve("dist");
  if (!existsSync(dist)) {
    console.error("dist/ not found — run vite build first");
    process.exit(1);
  }

  // Ensure icons exist in dist (vite copies from public, but if that failed generate now)
  // If dist/icons missing, generate them directly into dist.
  const distIcons = path.join(dist, "icons");
  if (!existsSync(distIcons) || readdirSync(distIcons).length === 0) {
    // Try to copy from public/icons if present
    const pubIcons = path.resolve("public/icons");
    if (existsSync(pubIcons)) {
      mkdirSync(distIcons, { recursive: true });
      for (const f of readdirSync(pubIcons)) {
        const src = path.join(pubIcons, f);
        const dst = path.join(distIcons, f);
        if (!existsSync(dst)) writeFileSync(dst, readFileSync(src));
      }
    } else {
      // Generate via sharp directly into dist/icons
      try {
        const sharp = (await import("sharp")).default;
        mkdirSync(distIcons, { recursive: true });
        const bg = "#04161c";
        const fg = "#9fd9e8";
        const svgFor = (size, maskable) => {
          const r = size * 0.22;
          const s = size;
          const cx = s / 2;
          const cy = s / 2;
          const bodyW = s * 0.42;
          const bodyH = s * 0.2;
          const bodyX = cx - bodyW * 0.1;
          const bodyY = cy;
          const tailSize = s * 0.14;
          const tailX = bodyX - bodyW / 2 - tailSize * 0.2;
          const eyeX = bodyX + bodyW * 0.28;
          const eyeY = bodyY - bodyH * 0.08;
          const eyeR = s * 0.018;
          const scale = maskable ? 0.8 : 1;
          return `<?xml version="1.0" encoding="UTF-8"?><svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg"><rect width="${s}" height="${s}" rx="${r}" ry="${r}" fill="${bg}"/><g transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})"><ellipse cx="${bodyX}" cy="${bodyY}" rx="${bodyW / 2}" ry="${bodyH / 2}" fill="${fg}"/><path d="M ${tailX} ${bodyY} L ${tailX + tailSize} ${bodyY - tailSize * 0.7} L ${tailX + tailSize} ${bodyY + tailSize * 0.7} Z" fill="${fg}"/><path d="M ${bodyX} ${bodyY - bodyH / 2} L ${bodyX - bodyW * 0.05} ${bodyY - bodyH / 2 - s * 0.07} L ${bodyX + bodyW * 0.12} ${bodyY - bodyH / 2} Z" fill="${fg}" opacity="0.9"/><circle cx="${eyeX}" cy="${eyeY}" r="${eyeR * 1.6}" fill="${bg}"/><circle cx="${eyeX}" cy="${eyeY}" r="${eyeR}" fill="#04161c"/><circle cx="${eyeX + eyeR * 0.25}" cy="${eyeY - eyeR * 0.25}" r="${eyeR * 0.35}" fill="white" opacity="0.85"/></g></svg>`;
        };
        for (const { size, name, maskable } of [
          { size: 192, name: "icon-192.png", maskable: false },
          { size: 512, name: "icon-512.png", maskable: false },
          { size: 512, name: "icon-512-maskable.png", maskable: true },
        ]) {
          const svg = svgFor(size, maskable);
          await sharp(Buffer.from(svg)).png().toFile(path.join(distIcons, name));
        }
      } catch (e) {
        console.warn("failed to generate icons", e);
      }
    }
  }

  // Collect every file in dist
  let files = walk(dist, "");
  // Exclude generated files that should not affect build id
  files = files.filter((f) => {
    const base = path.basename(f);
    if (base === "sw.js") return false;
    if (base === "version.json") return false;
    return true;
  });
  // Sort for determinism
  files.sort();

  const entries = files.map((rel) => {
    const full = path.join(dist, rel);
    const bytes = readFileSync(full);
    const posix = rel.split(path.sep).join(path.posix.sep);
    return [posix, bytes.length, createHash("sha256").update(bytes).digest("hex")];
  });

  // Build id: sha256 over sorted (path, content hash) pairs. Content rather
  // than size, because the fish GLBs and KTX2 textures live in public/ and are
  // not content-hashed by Vite: their URLs never change, so a stale cache is
  // only avoided by the build id reacting to what is actually inside them.
  const hash = createHash("sha256");
  for (const [p, , digest] of entries) hash.update(`${p}:${digest}\n`);
  const buildId = hash.digest("hex").slice(0, 8);

  const totalBytes = entries.reduce((a, [, size]) => a + size, 0);

  // Build precache list: every file as "./<path>", plus "./" alias for index.html if present
  const precache = entries.map(([p]) => `./${p}`);
  // Ensure navigation to "./" resolves: add "./" if index.html exists
  const hasIndex = entries.some(([p]) => p === "index.html");
  if (hasIndex && !precache.includes("./")) {
    // Keep "./" as navigation alias; not required but helps cache-first for root
    // We also keep "./index.html" already included
  }

  // Generate service worker
  const swContent = `// Generated by scripts/build-sw.mjs — do not edit.
const BUILD_ID = ${JSON.stringify(buildId)};
const CACHE = "yaumicuario-" + BUILD_ID;
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // Only handle same-origin GETs
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      // For navigations, serve the cached index.html as fallback (offline support)
      if (event.request.mode === "navigate") {
        return caches.match("./index.html").then((fallback) => fallback || fetch(event.request));
      }
      return fetch(event.request).then((response) => {
        // Never cache opaque or non-200 responses into the precache; just pass through
        return response;
      }).catch(() => {
        // If network fails and we have no cache, return fallback for navigations already handled
        return caches.match("./index.html").then((fallback) => fallback || Response.error());
      });
    })
  );
});
`;

  const swPath = path.join(dist, "sw.js");
  writeFileSync(swPath, swContent);
  console.log(`build id ${buildId}`);
  console.log(`precached ${precache.length} files, ${totalBytes} bytes`);

  // Also write version.json for runtime reading / debugging
  const versionPath = path.join(dist, "version.json");
  writeFileSync(versionPath, JSON.stringify({ id: buildId }) + "\n");

  // Patch the build id into the bundle. The placeholder is deliberately
  // distinctive: replacing a generic literal like "00000000" across every
  // bundled file could corrupt an unrelated constant in minified three.js.
  const placeholder = "__BUILD_ID_PLACEHOLDER__";
  // Walk again for JS files in dist to patch
  let patchedFiles = 0;
  for (const rel of files) {
    if (!rel.endsWith(".js")) continue;
    const full = path.join(dist, rel);
    let content = readFileSync(full, "utf8");
    if (content.includes(placeholder)) {
      content = content.split(placeholder).join(buildId);
      writeFileSync(full, content, "utf8");
      patchedFiles++;
    }
  }
  if (patchedFiles) console.log(`patched ${patchedFiles} file(s) with build id`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
