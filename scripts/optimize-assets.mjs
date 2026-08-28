#!/usr/bin/env node
/**
 * Optimize fish GLBs for the aquarium.
 *
 * Reads from asset-sources/fish-original/*.glb and writes optimized copies
 * to public/assets/fish/ with the same filenames, using the gltf-transform CLI.
 *
 * KTX-Software requirement
 * ------------------------
 * Texture compression (etc1s / uastc) requires the Khronos `ktx` binary
 * (from KTX-Software). This script does NOT bundle it. You must supply its
 * location via environment variables:
 *
 *   KTX_BIN_DIR  - directory containing the `ktx` (and `toktx`) binaries.
 *   KTX_LIB_DIR  - (optional but recommended on Linux) directory containing
 *                  libktx.so* so the dynamic linker can find it.
 *
 * The script prepends KTX_BIN_DIR to PATH and KTX_LIB_DIR to LD_LIBRARY_PATH
 * before invoking gltf-transform. If KTX_BIN_DIR is unset, it exits with a
 * clear message pointing at:
 *   https://github.com/KhronosGroup/KTX-Software/releases
 *
 * Example:
 *   KTX_BIN_DIR=/path/to/ktx/bin KTX_LIB_DIR=/path/to/ktx/lib node scripts/optimize-assets.mjs
 */

import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// KTX env handling / PATH setup
// ---------------------------------------------------------------------------
if (!process.env.KTX_BIN_DIR) {
  console.error(
    'ERROR: KTX_BIN_DIR is not set. ' +
      'Set KTX_BIN_DIR to the directory containing the `ktx` binary ' +
      '(and optionally KTX_LIB_DIR for its shared libraries).\n' +
      'Download a release from https://github.com/KhronosGroup/KTX-Software/releases ' +
      'and point KTX_BIN_DIR at its bin/ directory (KTX_LIB_DIR at lib/).',
  );
  process.exit(1);
}

process.env.PATH = `${process.env.KTX_BIN_DIR}:${process.env.PATH}`;
if (process.env.KTX_LIB_DIR) {
  const sep = process.platform === 'win32' ? ';' : ':';
  process.env.LD_LIBRARY_PATH = process.env.KTX_LIB_DIR + sep + (process.env.LD_LIBRARY_PATH ?? '');
}

// ---------------------------------------------------------------------------
// Per-file configuration
// ---------------------------------------------------------------------------
const CAPS = {
  'model_9a_-_blacktip_shark.glb': 1024,
  'betta_splendens.glb': 512,
  'guppy_fish.glb': 512,
  'cc0____pale_bleak_z._platypus_animation.glb': 512,
  'cc0___japanese_common_loach.glb': 512,
  'silakka_-_stromming_-_baltic_herring.glb': 512,
  'ahven_-_abborre_-_perch.glb': 512,
  'myllokunmingia_fengjiaoa.glb': 256,
  'paracheirodon_innesi___tetra_neon.glb': 256,
};

const SIMPLIFY_SET = new Set([
  'cc0____pale_bleak_z._platypus_animation.glb',
  'cc0___japanese_common_loach.glb',
]);

const INPUT_DIR = 'asset-sources/fish-original';
const OUTPUT_DIR = 'public/assets/fish';
const ALL_FILES = Object.keys(CAPS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function runGltfTransform(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['gltf-transform', ...args], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gltf-transform ${args[0]} exited with code ${code}`));
    });
  });
}

function countAnimations(filePath) {
  try {
    const buf = readFileSync(filePath);
    if (buf.length < 12) return 0;
    const magic = buf.subarray(0, 4).toString('utf8');
    if (magic !== 'glTF') {
      // Possibly JSON .gltf fallback
      try {
        const json = JSON.parse(buf.toString('utf8'));
        return json.animations?.length ?? 0;
      } catch {
        return 0;
      }
    }
    // GLB: header 12 bytes, then chunks
    const jsonChunkLength = buf.readUInt32LE(12);
    const jsonChunkType = buf.readUInt32LE(16);
    const JSON_CHUNK = 0x4e4f534a; // 'JSON' little-endian
    if (jsonChunkType !== JSON_CHUNK) return 0;
    if (20 + jsonChunkLength > buf.length) return 0;
    const jsonBytes = buf.subarray(20, 20 + jsonChunkLength);
    const json = JSON.parse(jsonBytes.toString('utf8'));
    return json.animations?.length ?? 0;
  } catch {
    return 0;
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Verify inputs exist
  const missing = ALL_FILES.filter((f) => !existsSync(join(INPUT_DIR, f)));
  if (missing.length) {
    console.error(`Missing input files in ${INPUT_DIR}: ${missing.join(', ')}`);
    process.exit(1);
  }

  const tmpRoot = join(os.tmpdir(), 'optimize-assets-');
  // Use mkdtempSync which needs a prefix ending with random suffix; use /tmp/opencode if available
  // to stay within allowed temp area, fallback to os.tmpdir().
  let tmpDir;
  try {
    // Prefer /tmp/opencode for sandboxed environments
    if (existsSync('/tmp/opencode')) {
      tmpDir = mkdtempSync(join('/tmp/opencode', 'optimize-assets-'));
    } else {
      tmpDir = mkdtempSync(tmpRoot);
    }
  } catch {
    tmpDir = mkdtempSync(tmpRoot);
  }

  const results = [];
  const failures = [];

  try {
    for (const file of ALL_FILES) {
      const cap = CAPS[file];
      const input = join(INPUT_DIR, file);
      const output = join(OUTPUT_DIR, file);
      console.log(`\n=== ${file} (cap ${cap}px) ===`);

      let current = input;
      // We will chain through temp files; each step writes to a new temp path.
      // Use a per-file counter to avoid collisions.
      let stepIdx = 0;
      const nextTemp = (suffix) => join(tmpDir, `${stepIdx++}_${file}_${suffix}.glb`);

      try {
        // 1. resize
        {
          const next = nextTemp('resize');
          console.log(`  resize ${cap}x${cap} ...`);
          await runGltfTransform(['resize', current, next, '--width', String(cap), '--height', String(cap)]);
          current = next;
        }

        // 2. uastc for normal-map slots only
        {
          const next = nextTemp('uastc');
          console.log(`  uastc (*normal*) ...`);
          await runGltfTransform(['uastc', current, next, '--slots', '*normal*']);
          current = next;
        }

        // 3. etc1s for all remaining texture slots
        {
          const next = nextTemp('etc1s');
          console.log(`  etc1s (!*normal*) ...`);
          await runGltfTransform(['etc1s', current, next, '--slots', '!*normal*']);
          current = next;
        }

        // 4. weld (all files) - merges identical vertices so simplify is effective
        {
          const next = nextTemp('weld');
          console.log(`  weld ...`);
          await runGltfTransform(['weld', current, next]);
          current = next;
        }

        // 5. simplify, ONLY for the two files listed (error 0.01 per correction)
        if (SIMPLIFY_SET.has(file)) {
          const next = nextTemp('simplify');
          console.log(`  simplify ratio 0.5 error 0.01 ...`);
          await runGltfTransform(['simplify', current, next, '--ratio', '0.5', '--error', '0.01']);
          current = next;
        }

        // 6a. prune
        {
          const next = nextTemp('prune');
          console.log(`  prune ...`);
          await runGltfTransform(['prune', current, next]);
          current = next;
        }

        // 6b. dedup
        {
          const next = nextTemp('dedup');
          console.log(`  dedup ...`);
          await runGltfTransform(['dedup', current, next]);
          current = next;
        }

        // 7. meshopt (last - after prune/dedup so it is not decoded)
        {
          const next = nextTemp('meshopt');
          console.log(`  meshopt ...`);
          await runGltfTransform(['meshopt', current, next]);
          current = next;
        }

        // Copy final to output dir
        cpSync(current, output);
        console.log(`  -> ${output}`);

        const beforeSize = statSync(input).size;
        const afterSize = statSync(output).size;
        const beforeAnims = countAnimations(input);
        const afterAnims = countAnimations(output);
        const savedPct = beforeSize > 0 ? ((1 - afterSize / beforeSize) * 100).toFixed(1) : '0.0';
        const animOk = afterAnims >= beforeAnims ? 'OK' : 'FAIL';

        console.log(`  size: ${formatBytes(beforeSize)} -> ${formatBytes(afterSize)} (${savedPct}% saved)`);
        console.log(`  animations: ${beforeAnims} -> ${afterAnims} [${animOk}]`);
        if (animOk === 'FAIL') {
          console.warn(`  WARNING: animation clip count decreased for ${file}`);
        }

        results.push({ file, beforeSize, afterSize, beforeAnims, afterAnims });
      } catch (err) {
        console.error(`  FAILED ${file}: ${err.message}`);
        failures.push({ file, error: err.message });
      }
    }
  } finally {
    // Leave no temp files behind
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  // Print summary table
  console.log('\n' + '='.repeat(72));
  console.log('Summary');
  console.log('='.repeat(72));
  const header = `${'File'.padEnd(48)} ${'Before'.padStart(10)} ${'After'.padStart(10)} ${'Saved'.padStart(8)}  Anim`;
  console.log(header);
  console.log('-'.repeat(72));
  let totalBefore = 0;
  let totalAfter = 0;
  for (const r of results) {
    totalBefore += r.beforeSize;
    totalAfter += r.afterSize;
    const pct = r.beforeSize > 0 ? ((1 - r.afterSize / r.beforeSize) * 100).toFixed(1) + '%' : '0%';
    const anim = `${r.beforeAnims}->${r.afterAnims} ${r.afterAnims >= r.beforeAnims ? 'OK' : 'FAIL'}`;
    console.log(`${r.file.padEnd(48)} ${formatBytes(r.beforeSize).padStart(10)} ${formatBytes(r.afterSize).padStart(10)} ${pct.padStart(8)}  ${anim}`);
  }
  if (failures.length) {
    for (const f of failures) {
      console.log(`${f.file.padEnd(48)} ${'FAILED'.padStart(10)} ${f.error}`);
    }
  }
  console.log('-'.repeat(72));
  const totalPct = totalBefore > 0 ? ((1 - totalAfter / totalBefore) * 100).toFixed(1) + '%' : '0%';
  console.log(`${'TOTAL'.padEnd(48)} ${formatBytes(totalBefore).padStart(10)} ${formatBytes(totalAfter).padStart(10)} ${totalPct.padStart(8)}`);
  console.log(`Total bytes: ${totalAfter} / ${totalBefore} (${totalPct} saved)`);
  if (totalAfter > 0 && totalAfter >= 2200000) {
    console.warn(`WARNING: total ${totalAfter} bytes exceeds 2200000 target`);
  } else if (totalAfter > 0) {
    console.log(`Target <2200000 bytes: PASS (${totalAfter} bytes)`);
  }

  if (failures.length) {
    console.error(`\n${failures.length} file(s) failed: ${failures.map((f) => f.file).join(', ')}`);
    process.exit(1);
  }

  // Animation integrity final check
  const animFailures = results.filter((r) => r.afterAnims < r.beforeAnims);
  if (animFailures.length) {
    console.error(`\nAnimation check FAILED for: ${animFailures.map((r) => r.file).join(', ')}`);
    process.exit(1);
  }

  console.log('\nAll done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
