import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture
} from "three";

// Deterministic value noise so generated textures are stable across reloads.
function mulberry32(seed: number): () => number {
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

// Gravel/sand floor: a noisy albedo plus a matching normal map.
export function makeGroundTextures(size = 512): { map: Texture; normalMap: Texture } {
  const rng = mulberry32(99);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Base sandy tone.
  ctx.fillStyle = "#3a3a30";
  ctx.fillRect(0, 0, size, size);
  // Scatter pebbles as soft radial blobs.
  for (let i = 0; i < 1400; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 3 + rng() * 10;
    const shade = 30 + rng() * 70;
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
