#!/usr/bin/env node
/**
 * Optimize the non-fish creature GLBs for the aquarium.
 *
 * Reads from asset-sources/creatures-original/*.glb and writes optimized copies
 * to public/assets/creatures/. Sibling of optimize-assets.mjs, which does the
 * same for the fish roster; this one exists separately because each of these
 * four models needs its own repair step before the shared pipeline can run:
 *
 *   dolphin  The Sketchfab download is a whole scene, not a dolphin: 549 meshes,
 *            of which only 5 are skinned. The other 181 (after join) are rigid
 *            Cube.* set dressing worth ~156k triangles. Dropping every unskinned
 *            mesh leaves the animated dolphin alone, at 31.8k triangles.
 *   shark    Ships inverted-hull toon outline shells under a "Border_mat"
 *            material, one per mesh at double the triangle count. They z-fight
 *            with the body and read as blocky camouflage. Dropped by material.
 *   octopus  A 1.97M triangle photoscan with no rig. Its atlas splits a vertex
 *            at every UV seam and meshopt will not collapse across a split
 *            vertex, so simplification floors at 221k however loose the error
 *            budget. Dropping NORMAL/TANGENT before the weld removes two of the
 *            three reasons a vertex is split, which lets it reach 39k with the
 *            arms and suckers intact; normals are recomputed afterwards.
 *   crab     Clean. Passes straight through.
 *
 * Provenance. All four came from Sketchfab; the octopus original is gitignored
 * because the raw scan is 116 MB, so re-fetch it by uid if the pipeline has to
 * be re-run. Downloads need a Sketchfab API token:
 *
 *   curl -H "Authorization: Token $SKETCHFAB_TOKEN" \
 *     https://api.sketchfab.com/v3/models/<uid>/download
 *
 *   dolphin      c24dc835a6aa4d3c827450513525cdb8  Alex_Pfe        CC BY 4.0
 *   shark        8e429052939a4677861d0d550a0e27cd  3dartstevenz    CC BY 4.0
 *   octopus      a6e8afbc35604438bbd4fba04e866025  s8819296        CC BY 4.0
 *   crab         35559c2236d04c1a80ccbe08cae863c6  ffishAsia       CC0
 *
 * KTX-Software requirement is identical to optimize-assets.mjs: set KTX_BIN_DIR
 * (and ideally KTX_LIB_DIR) to a KTX-Software release, because texture
 * compression shells out to the Khronos `ktx` binary.
 *
 *   KTX_BIN_DIR=/path/to/ktx/bin KTX_LIB_DIR=/path/to/ktx/lib \
 *     node scripts/optimize-creatures.mjs
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import os from 'node:os';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, join, normals, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

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

const INPUT_DIR = 'asset-sources/creatures-original';
const OUTPUT_DIR = 'public/assets/creatures';

// Texture caps, sized against how many pixels each thing actually covers on
// screen. The shark is 4.5 m and crosses a third of the frame; the crab is
// 30 cm and covers about 50 px, so a 1024 map on it would be pure waste.
//
// `normalCap` is separate and always tighter, because normal maps are the one
// slot that has to stay UASTC (ETC1S bands visibly across a large smooth body)
// and UASTC is roughly 10x the bytes of ETC1S at the same resolution. Left at
// 1024 the three normal maps alone came to 2.8 MB, half the entire payload.
//
// `materialCaps` overrides both for one named material. The shark's eyes and
// teeth carry a full texture set that covers perhaps 20 px of a 690 px animal.
const CREATURES = [
  { file: 'dolphin.glb', cap: 1024, normalCap: 512, repair: 'keepSkinnedOnly', ratio: 0.5, error: 0.01 },
  {
    file: 'great_white_shark.glb',
    cap: 1024,
    normalCap: 512,
    materialCaps: { eye_teeth_mat: 256 },
    repair: 'dropMaterial',
    material: 'Border_mat',
  },
  { file: 'octopus.glb', cap: 512, normalCap: 256, repair: 'decimateScan', ratio: 0.01, error: 0.02 },
  { file: 'crab.glb', cap: 256, normalCap: 256, repair: null, ratio: 0.35, error: 0.01 },
];

// The decoder is needed to read back the meshopt-compressed output for its stats.
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

function runGltfTransform(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['gltf-transform', ...args], { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gltf-transform ${args[0]} exited with code ${code}`));
    });
  });
}

function countTriangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? 0) / 3;
  return Math.round(tris);
}

// Resize each texture against the material that uses it and the slot it fills,
// which `gltf-transform resize` cannot express: its --slots filter matches slot
// names across the whole file, with no way to say "this material is small".
// A texture shared by two materials takes the larger of their caps.
async function resizeTextures(doc, spec) {
  const caps = new Map();
  for (const material of doc.getRoot().listMaterials()) {
    const materialCap = spec.materialCaps?.[material.getName()] ?? spec.cap;
    for (const [slot, texture] of [
      ['base', material.getBaseColorTexture()],
      ['mr', material.getMetallicRoughnessTexture()],
      ['ao', material.getOcclusionTexture()],
      ['emissive', material.getEmissiveTexture()],
      ['normal', material.getNormalTexture()],
    ]) {
      if (!texture) continue;
      const cap = slot === 'normal' ? Math.min(materialCap, spec.normalCap) : materialCap;
      caps.set(texture, Math.max(caps.get(texture) ?? 0, cap));
    }
  }

  for (const [texture, cap] of caps) {
    const [width, height] = texture.getSize() ?? [0, 0];
    if (width <= cap && height <= cap) continue;
    const resized = await sharp(Buffer.from(texture.getImage()))
      .resize(Math.min(width, cap), Math.min(height, cap), { fit: 'fill' })
      .png()
      .toBuffer();
    texture.setImage(resized).setMimeType('image/png');
    console.log(`  resize: ${width}x${height} -> ${Math.min(width, cap)}px (${texture.getName() || 'unnamed'})`);
  }
}

async function preprocess(spec, inPath, outPath) {
  const doc = await io.read(inPath);
  const root = doc.getRoot();

  if (spec.repair === 'keepSkinnedOnly') {
    await doc.transform(join());
    let dropped = 0;
    for (const node of root.listNodes()) {
      if (node.getMesh() && !node.getSkin()) {
        node.setMesh(null);
        dropped++;
      }
    }
    console.log(`  repair: dropped ${dropped} unskinned mesh nodes`);
    await doc.transform(prune(), dedup());
  } else if (spec.repair === 'dropMaterial') {
    let dropped = 0;
    for (const mesh of root.listMeshes())
      for (const prim of mesh.listPrimitives())
        if (prim.getMaterial()?.getName() === spec.material) {
          mesh.removePrimitive(prim);
          prim.dispose();
          dropped++;
        }
    console.log(`  repair: dropped ${dropped} "${spec.material}" primitives`);
    await doc.transform(prune(), dedup());
  } else if (spec.repair === 'decimateScan') {
    for (const mesh of root.listMeshes())
      for (const prim of mesh.listPrimitives())
        for (const name of ['NORMAL', 'TANGENT']) if (prim.getAttribute(name)) prim.setAttribute(name, null);
    await doc.transform(
      prune(),
      join(),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: spec.ratio, error: spec.error }),
      normals({ overwrite: true }),
      dedup(),
    );
    console.log(`  repair: decimated scan to ${countTriangles(doc)} triangles`);
  }

  // Both hero models arrive far denser than their on-screen size justifies:
  // the dolphin covers ~380 px and the octopus ~115 px. The scan path has
  // already simplified itself above, so this is for the rigged models, where
  // meshopt keeps the joint and weight attributes intact.
  if (spec.repair !== 'decimateScan' && spec.ratio) {
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: spec.ratio, error: spec.error }));
    console.log(`  simplify: ${countTriangles(doc)} triangles`);
  }

  await resizeTextures(doc, spec);
  await io.write(outPath, doc);
  return countTriangles(doc);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const missing = CREATURES.filter((c) => !existsSync(joinPath(INPUT_DIR, c.file)));
  if (missing.length) {
    console.error(`Missing input files in ${INPUT_DIR}: ${missing.map((c) => c.file).join(', ')}`);
    process.exit(1);
  }

  const tmpDir = mkdtempSync(joinPath(os.tmpdir(), 'optimize-creatures-'));
  const results = [];

  try {
    for (const spec of CREATURES) {
      const input = joinPath(INPUT_DIR, spec.file);
      const output = joinPath(OUTPUT_DIR, spec.file);
      console.log(`\n=== ${spec.file} (cap ${spec.cap}px) ===`);

      let stepIdx = 0;
      const nextTemp = (suffix) => joinPath(tmpDir, `${stepIdx++}_${spec.file}_${suffix}.glb`);
      let current = input;

      {
        const next = nextTemp('preprocess');
        await preprocess(spec, current, next);
        current = next;
      }

      for (const [label, args] of [
        ['uastc (*normal*)', ['uastc', '--slots', '*normal*']],
        ['etc1s (!*normal*)', ['etc1s', '--slots', '!*normal*']],
        ['weld', ['weld']],
        ['prune', ['prune']],
        ['dedup', ['dedup']],
        // meshopt must stay last: prune decodes EXT_meshopt_compression and
        // re-inflates the file if it runs afterwards.
        ['meshopt', ['meshopt']],
      ]) {
        const next = nextTemp(args[0]);
        console.log(`  ${label} ...`);
        await runGltfTransform([args[0], current, next, ...args.slice(1)]);
        current = next;
      }

      cpSync(current, output);
      const beforeSize = statSync(input).size;
      const afterSize = statSync(output).size;
      const doc = await io.read(output);
      console.log(`  -> ${output}`);
      console.log(
        `  size: ${formatBytes(beforeSize)} -> ${formatBytes(afterSize)}, ` +
          `${countTriangles(doc)} tris, ${doc.getRoot().listAnimations().length} anim`,
      );
      results.push({ file: spec.file, beforeSize, afterSize, tris: countTriangles(doc) });
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(70));
  let total = 0;
  for (const r of results) {
    total += r.afterSize;
    console.log(
      `${r.file.padEnd(26)} ${formatBytes(r.beforeSize).padStart(10)} -> ${formatBytes(r.afterSize).padStart(10)}  ${String(r.tris).padStart(7)} tris`,
    );
  }
  console.log('-'.repeat(70));
  console.log(`${'TOTAL'.padEnd(26)} ${''.padStart(10)}    ${formatBytes(total).padStart(10)}`);
  const BUDGET = 2_500_000;
  console.log(
    total <= BUDGET
      ? `Budget <${BUDGET} bytes: PASS (${total} bytes)`
      : `WARNING: total ${total} bytes exceeds the ${BUDGET} byte budget`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
