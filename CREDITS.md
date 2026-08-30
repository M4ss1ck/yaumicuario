# Credits

Bundled models are CC0 or CC BY 4.0. The CC0 ones need no attribution and are
listed as good practice; the CC BY ones are credited by author below, and that
attribution is required.

## Fish models (CC0)

Used (in `public/assets/fish/`):

- Paracheirodon innesi (neon tetra)
- Pale Bleak (Zacco platypus) - animated, by ffishAsia / floraZia
- Guppy fish
- Betta splendens
- Japanese common loach - by ffishAsia / floraZia
- Myllokunmingia fengjiaoa
- Blacktip shark (model_9a)
- Perch (ahven / abborre)
- Baltic herring (silakka / strömming)

Many freshwater models come from the ffishAsia / floraZia CC0 collection on
Sketchfab (author `ffishAsia-and-floraZia`).

## Other creatures

In `public/assets/creatures/`.

CC0:

- Japanese freshwater crab (Geothelphusa dehaani) - by ffishAsia / floraZia

CC BY 4.0, attribution required:

- Dolphin - by [Alex_Pfe](https://sketchfab.com/Alex_Pfe) on Sketchfab
- Great white shark ("White Pointer") - by
  [3dartstevenz](https://sketchfab.com/3dartstevenz) on Sketchfab
- Octopus - by [s8819296](https://sketchfab.com/s8819296) on Sketchfab

Each was modified for this project: repaired, decimated and recompressed. See
`scripts/optimize-creatures.mjs`.

## Generated at runtime (no external files)

- Image-based lighting: Three.js `RoomEnvironment`
- Gravel floor albedo + normal map: procedural (canvas/noise)
- Water surface normals: procedural
- Coral reef geometry and color: procedural
- Underwater ambience and bubble sounds: synthesized in Web Audio, no samples
- Caustics, god rays, color grading: custom shaders

## Libraries

- [Three.js](https://threejs.org/) - MIT
- [Vite](https://vitejs.dev/) - MIT
