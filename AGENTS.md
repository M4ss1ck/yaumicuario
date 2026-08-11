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

- Fish GLBs: `public/assets/fish/` (CC0). Source `.zip`s and the unused
  spec-gloss `guppy.glb` are in `asset-sources/` (not deployed).
- Lighting, floor, water normals and caustics are procedural; no HDRI/textures
  are downloaded.

## Verify

`npm run build` type-checks and bundles. There are no automated tests; visual
behavior was checked by rendering the production build in headless Chrome.
