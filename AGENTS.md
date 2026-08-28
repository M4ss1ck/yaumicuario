# Agent context

Photorealistic browser aquarium. Three.js (WebGL2) + Vite + TypeScript, static
deploy to Cloudflare Pages. See `plan.md` for the full design and `README.md`
for build/run/deploy.

## Conventions

- Code and comments in English. No em dashes in generated prose.
- Keep changes surgical; match existing style.
- The active render path is WebGL2 with EffectComposer post-processing. A WebGPU
  probe exists in `renderer.ts` but the WebGPU/TSL port is not implemented.

## Layout

- `src/scene/` - tank shell, ground, lighting/fog/IBL, water, caustics, god rays
- `src/fish/` - FishManager (load + instance), Fish (per-instance), boids,
  wiggle (fallback swim for non-animated models)
- `src/post/composer.ts` - bloom, DOF, god rays, grading/vignette/grain
- `src/quality.ts`, `src/ui/controls.ts` - quality tiers and overlay
- `src/main.ts` - scene assembly and render loop

## Assets

- Fish GLBs: `public/assets/fish/` (CC0), KTX2/Basis textures and
  meshopt-compressed geometry, ~2.0 MB total. These are generated, not authored.
- Originals are `asset-sources/fish-original/` (~33.5 MB, not deployed).
  Regenerate with:

  ```bash
  KTX_BIN_DIR=/path/to/ktx/bin KTX_LIB_DIR=/path/to/ktx/lib \
    node scripts/optimize-assets.mjs
  ```

  Needs the `ktx` binary from KhronosGroup/KTX-Software (not on npm). The
  script resizes per species, encodes normals as UASTC and everything else as
  ETC1S, welds, decimates the two heaviest models, then prunes, dedups and
  meshopt-compresses. `meshopt` must stay last: `prune` decodes
  `EXT_meshopt_compression` and re-inflates the files if it runs after.
- `public/basis/` holds the Basis transcoder copied from the three.js version
  in `package.json`; refresh it when three is upgraded, or KTX2 textures will
  fail to transcode.
- Source `.zip`s and the unused spec-gloss `guppy.glb` are also in
  `asset-sources/` (not deployed).
- Lighting, floor, water normals and caustics are procedural; no HDRI/textures
  are downloaded.

## Verify

`npm run build` type-checks and bundles.

Visual regressions are caught by the capture harness, which renders the
production build in headless Chrome under a determinism shim
(`scripts/capture-shim.js`: seeded `Math.random`, virtual clock, pumped
`requestAnimationFrame`) and diffs PNG frames:

```bash
npm run build
npm run capture -- --out captures/baseline      # before a change
npm run capture -- --out captures/after         # after it
npm run diff:captures captures/baseline captures/after
```

Presets are `phone-portrait`, `phone-landscape` and `desktop`; the phone presets
send a Samsung user agent so `autoDetect()` in `quality.ts` takes the Low tier,
which is what the target device runs. Captures are not bit-exact: the measured
noise floor is under 0.025% of pixels and the diff threshold defaults to 0.15%.
See the header of `scripts/diff-captures.mjs` before changing that number.
