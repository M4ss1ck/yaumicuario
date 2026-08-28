# Aquarium

A photorealistic, full-screen aquarium screensaver that runs in the browser.
Built with Three.js (WebGL2) + Vite + TypeScript. Around a dozen CC0 fish swim
in a murky, fog-graded tank with animated caustics, god rays, suspended motes
and a cinematic post-processing stack (bloom, depth of field, color grading,
vignette, film grain).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # type-checks, then outputs a static site to dist/
npm run preview  # serve the production build locally
```

## Visual regression captures

```bash
npm run capture -- --out captures/baseline
npm run diff:captures captures/baseline captures/after
```

Renders the production build in headless Chrome with randomness, the clock and
the animation frame loop all under harness control, then compares PNG frames.
Requires Chrome on `PATH` or `CHROME_PATH`. See `AGENTS.md` for details.

## Deploy (Cloudflare Pages)

This is a static site. On Cloudflare Pages:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Framework preset:** none / Vite

`vite.config.ts` uses `base: "./"`, so the build works from the site root or a
subpath without changes.

## Controls

- **F** or the on-screen button: toggle fullscreen
- **H**: show/hide the control panel
- **Quality selector**: Low / Medium / High / Ultra (persisted in localStorage)
- The cursor and panel auto-hide after ~3s of inactivity.

The render loop pauses when the tab is hidden and throttles to ~15 fps when the
window loses focus, so it is light to leave running for hours.

## Rendering notes

- The plan targets WebGPU first, but the rich post-processing pipeline is the
  proven WebGL2 path and is what ships here. `renderer.ts` probes for WebGPU and
  logs availability; porting the post stack to WebGPU/TSL is a future step. The
  WebGL2 path is the plan's designated guaranteed-functional fallback.
- Lighting uses a procedural `RoomEnvironment` for IBL instead of an external
  HDRI, so no image assets need downloading. The gravel floor, caustics and
  water normals are all generated procedurally at runtime.
- Fish that ship with a skeletal swim clip are animated via `AnimationMixer`
  (cloned with `SkeletonUtils.clone` to preserve skinning). The two species
  without a clip get a fallback sine-bend vertex wiggle. A lightweight boids
  layer (wander + wall/separation/camera avoidance) steers where each fish goes.

## Assets

- Fish models live in `public/assets/fish/` (CC0; see `CREDITS.md`).
- Source archives and the unused spec-gloss model are kept out of the deploy
  tree in `asset-sources/`.
