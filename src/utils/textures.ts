import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture
} from "three";

// Deterministic value noise so generated textures are stable across reloads.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seamless height field from summed sine waves with integer frequencies.
function seamlessHeight(size: number, octaves: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const waves: { fx: number; fy: number; ph: number; amp: number }[] = [];
  let ampSum = 0;
  for (let o = 0; o < octaves; o++) {
    const freq = 1 + o * 2 + Math.floor(rng() * 2);
    const amp = 1 / (o + 1);
    ampSum += amp;
    waves.push({
      fx: freq * (rng() > 0.5 ? 1 : -1),
      fy: freq * (rng() > 0.5 ? 1 : -1),
      ph: rng() * Math.PI * 2,
      amp
    });
  }
  const h = new Float32Array(size * size);
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let s = 0;
      for (const w of waves) {
        s += w.amp * Math.sin(tau * (w.fx * u + w.fy * v) + w.ph);
      }
      h[y * size + x] = s / ampSum; // -1..1
    }
  }
  return h;
}

// Convert a height field to a tangent-space normal map texture.
function heightToNormalTexture(h: Float32Array, size: number, strength: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const nz = 1;
      const len = Math.hypot(dx, dy, nz);
      const i = (y * size + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

// Sand substrate: a noisy albedo plus a matching normal map.
export function makeGroundTextures(size = 512): { map: Texture; normalMap: Texture } {
  const rng = mulberry32(99);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Base sandy tone.
  ctx.fillStyle = "#6b6350";
  ctx.fillRect(0, 0, size, size);
  // Scatter pebbles as soft radial blobs.
  for (let i = 0; i < 1400; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 3 + rng() * 10;
    const shade = 45 + rng() * 45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const hue = 30 + rng() * 25;
    g.addColorStop(0, `hsl(${hue} 18% ${shade}%)`);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = new CanvasTexture(canvas);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.colorSpace = SRGBColorSpace;

  const h = seamlessHeight(size, 5, 4242);
  const normalMap = heightToNormalTexture(h, size, 3.5);
  return { map, normalMap };
}

// Height field whose features are stretched along V by sampling an isotropic
// seamless field at compressed U. An integer stretch keeps the result seamless
// in U, so the pattern reads as longitudinal streaks along the blade.
function longitudinalHeight(size: number, stretch: number, seed: number): Float32Array {
  const base = seamlessHeight(size, 4, seed);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const su = ((x / size) * stretch) % 1;
      out[y * size + x] = base[y * size + Math.round(su * (size - 1))];
    }
  }
  return out;
}

// Longitudinal vein ridges: periodic gaussian lines parallel to V, one per
// (k + 0.5) / count across U. Evenly spaced with no vein on the seam, so the
// field is seamless in U.
function veinField(size: number, count: number, width: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      let s = 0;
      for (let k = 0; k < count; k++) {
        const d = Math.abs(u - (k + 0.5) / count);
        s += Math.exp(-(d * d) / (2 * width * width));
      }
      out[y * size + x] = s;
    }
  }
  return out;
}

// One canvas per texture: CanvasTexture uploads the canvas lazily, so sharing a
// single canvas would make every texture read the last image drawn into it.
function plantCanvasTexture(size: number, data: Uint8ClampedArray, srgb: boolean): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

// Runtime-generated 512x512 plant surface set: a neutral albedo detail map
// (meant to be multiplied by the per-species vertex colors), a tangent-space
// normal map with longitudinal veins, a roughness variation map, and a
// grayscale thickness map that is brighter at thin edges and veins (consumed by
// the plant backlight term). All four are deterministic and seamless.
export function makePlantTextures(size = 512): {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  roughnessMap: CanvasTexture;
  thicknessMap: CanvasTexture;
} {
  const noise = longitudinalHeight(size, 4, 7331); // -1..1, elongated along V
  const veins = veinField(size, 7, 0.014); // 0..1 longitudinal ridge lines
  const normalH = new Float32Array(size * size);
  const albedoData = new Uint8ClampedArray(size * size * 4);
  const roughData = new Uint8ClampedArray(size * size * 4);
  const thickData = new Uint8ClampedArray(size * size * 4);
  // Brightness profile across the blade: thin near both edges, thick in the
  // middle, so the backlight term lights up the leaf margins first.
  const edgeX = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    const u = x / (size - 1);
    const s = 0.16;
    edgeX[x] = Math.exp(-(u * u) / (2 * s * s)) + Math.exp(-((1 - u) * (1 - u)) / (2 * s * s));
  }
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const n = noise[i];
      const v = veins[i];
      const ai = i * 4;
      // Neutral green-gray albedo detail; species colors arrive as vertex colors.
      albedoData[ai] = clamp01(0.6 + n * 0.1 + v * 0.05) * 255;
      albedoData[ai + 1] = clamp01(0.64 + n * 0.1 + v * 0.05) * 255;
      albedoData[ai + 2] = clamp01(0.5 + n * 0.08 + v * 0.04) * 255;
      albedoData[ai + 3] = 255;
      // Roughness variation; the material samples the green channel.
      const r = clamp01(0.55 + 0.35 * (n * 0.5 + 0.5) + v * 0.06) * 255;
      roughData[ai] = r;
      roughData[ai + 1] = r;
      roughData[ai + 2] = r;
      roughData[ai + 3] = 255;
      // Thickness: thin (bright) at the edges and along veins, thick mid-blade.
      const th = clamp01(0.32 + 0.55 * edgeX[x] + 0.4 * v) * 255;
      thickData[ai] = th;
      thickData[ai + 1] = th;
      thickData[ai + 2] = th;
      thickData[ai + 3] = 255;
      // Normal height: veins dominate, with soft surface noise beneath.
      normalH[i] = n * 0.15 + v * 0.5;
    }
  }

  const map = plantCanvasTexture(size, albedoData, true);
  const roughnessMap = plantCanvasTexture(size, roughData, false);
  const thicknessMap = plantCanvasTexture(size, thickData, false);
  const normalMap = heightToNormalTexture(normalH, size, 2.2);
  normalMap.anisotropy = 8;
  return { map, normalMap, roughnessMap, thicknessMap };
}

// Soft round sprite for suspended particles (motes).
export function makeMoteSprite(size = 64): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

// Bright cellular caustics: a wrapped Voronoi distance field whose cell-boundary
// web is bright and whose cell interiors fall off to black. All distances are
// computed on a torus of the texture size, so the tile repeats seamlessly, and
// every cell centre comes from a fixed seed, so the pattern is identical on
// every reload. The value is written to all channels so the shader can read a
// single channel; the texture is left in linear space (not marked sRGB) because
// it feeds linear-light radiance, and mipmapping averages it down cleanly.
export function makeCausticsTexture(size = 256): CanvasTexture {
  const grid = 8;
  const cell = size / grid;
  const half = size * 0.5;
  // Nearest copy of a centre on the torus, as an offset from the pixel.
  const wrap = (v: number) => {
    const w = ((v % size) + size) % size;
    return w > half ? w - size : w;
  };
  // Deterministic per-cell centres, kept away from the cell edges so the web
  // stays open instead of pinning to the seams.
  const ox = new Float32Array(grid * grid);
  const oy = new Float32Array(grid * grid);
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const rng = mulberry32((i * 374761393 + j * 668265263 + 1299721) >>> 0);
      ox[j * grid + i] = (0.2 + rng() * 0.6) * cell;
      oy[j * grid + i] = (0.2 + rng() * 0.6) * cell;
    }
  }
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cj = Math.floor(x / cell);
      const ci = Math.floor(y / cell);
      let md = Infinity;
      let ms = Infinity;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const j = (cj + dj + grid) % grid;
          const i = (ci + di + grid) % grid;
          const d = Math.hypot(
            wrap(j * cell + ox[j * grid + i] - x),
            wrap(i * cell + oy[j * grid + i] - y)
          );
          if (d < md) {
            ms = md;
            md = d;
          } else if (d < ms) {
            ms = d;
          }
        }
      }
      // 0 at a cell centre, ramping toward 1 along the shared boundaries: the
      // bright web the caustics shader multiplies over the surface.
      const v = Math.pow(Math.min(md / ms, 1), 0.8);
      const b = Math.round(v * 255);
      const p = (y * size + x) * 4;
      data[p] = b;
      data[p + 1] = b;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Two uncorrelated water normal fields for the surface shader. Each reuses the
// seamless height field with a different seed and octave count, so the two
// layers carry different frequencies; the surface shader samples them at
// different scales and combines them into multi-scale waves. Both stay in
// linear color space (normal data is not sRGB) and wrap for the drifting UVs.
export function makeWaterNormalTextures(size = 512): {
  normalMap0: CanvasTexture;
  normalMap1: CanvasTexture;
} {
  const normalMap0 = heightToNormalTexture(seamlessHeight(size, 4, 20240), size, 1.1);
  const normalMap1 = heightToNormalTexture(seamlessHeight(size, 7, 73129), size, 0.7);
  normalMap0.anisotropy = 8;
  normalMap1.anisotropy = 8;
  return { normalMap0, normalMap1 };
}

// A bubble: a bright rim with a hollow middle and one specular highlight, which
// is what separates a bubble from the soft blob used for suspended motes.
export function makeBubbleSprite(size = 64): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = size / 2;

  const rim = ctx.createRadialGradient(r, r, r * 0.55, r, r, r);
  rim.addColorStop(0, "rgba(255,255,255,0)");
  rim.addColorStop(0.72, "rgba(210,245,255,0.55)");
  rim.addColorStop(0.93, "rgba(255,255,255,0.85)");
  rim.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  // Faint fill, so the bubble is not a bare outline against dark water.
  const fill = ctx.createRadialGradient(r, r, 0, r, r, r * 0.8);
  fill.addColorStop(0, "rgba(190,235,250,0.12)");
  fill.addColorStop(1, "rgba(190,235,250,0)");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);

  const spec = ctx.createRadialGradient(r * 0.66, r * 0.6, 0, r * 0.66, r * 0.6, r * 0.28);
  spec.addColorStop(0, "rgba(255,255,255,0.9)");
  spec.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = spec;
  ctx.fillRect(0, 0, size, size);

  return new CanvasTexture(canvas);
}
