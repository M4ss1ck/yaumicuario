// Determinism shim, injected before any page script runs.
//
// The aquarium is full of intentional randomness and wall-clock timing, so two
// runs never produce the same pixels by default. This replaces the three
// sources of nondeterminism with controlled equivalents, without touching the
// application source:
//
//   1. Math.random        -> seeded mulberry32 (same generator the scene uses)
//   2. performance.now    -> a virtual clock advanced only by the frame pump
//   3. requestAnimationFrame -> a queue drained only by the frame pump
//
// setTimeout and the network are deliberately left alone: promise chains and
// GLTF loads still need to progress in real time between pumped frames.

(() => {
  const SEED = 0x9e3779b9;
  const FRAME_MS = 1000 / 60;

  // Same PRNG as src/utils/textures.ts, so seeded runs stay in the same family
  // of values the scene was authored against.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rng = mulberry32(SEED);
  let randomCalls = 0;
  Math.random = () => {
    randomCalls++;
    return rng();
  };

  // Virtual clock. Starts at a nonzero value because code that treats 0 as
  // "unset" is common, and at a fixed epoch so Date.now is stable too.
  let virtualNow = 1000;
  const EPOCH = 1735689600000; // 2025-01-01T00:00:00Z

  const realNow = performance.now.bind(performance);
  performance.now = () => virtualNow;
  Date.now = () => EPOCH + virtualNow;
  const RealDate = Date;
  // eslint-disable-next-line no-global-assign
  Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(EPOCH + virtualNow);
      else super(...args);
    }
    static now() {
      return EPOCH + virtualNow;
    }
  };
  Date.UTC = RealDate.UTC;
  Date.parse = RealDate.parse;

  // Controlled rAF queue.
  let nextHandle = 1;
  let queue = new Map();
  window.requestAnimationFrame = (cb) => {
    const handle = nextHandle++;
    queue.set(handle, cb);
    return handle;
  };
  window.cancelAnimationFrame = (handle) => {
    queue.delete(handle);
  };

  let framesPumped = 0;
  function pumpOneFrame() {
    framesPumped++;
    virtualNow += FRAME_MS;
    // Drain the queue as it stood at frame start: callbacks that re-register
    // must land in the *next* frame, not spin forever inside this one.
    const batch = queue;
    queue = new Map();
    for (const cb of batch.values()) {
      try {
        cb(virtualNow);
      } catch (err) {
        (window.__captureErrors ||= []).push(String((err && err.message) || err));
      }
    }
  }

  // Yield to the real event loop so pending promises, GLTF parses and image
  // decodes can settle between frames.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  window.__capture = {
    get virtualNow() {
      return virtualNow;
    },
    get realElapsed() {
      return realNow();
    },
    pendingFrameCallbacks: () => queue.size,
    get randomCalls() {
      return randomCalls;
    },
    get framesPumped() {
      return framesPumped;
    },

    // Pump frames until the app reports every fish loaded and spawned. The
    // loading overlay clears earlier than that, as soon as the wordmark plays,
    // so waiting on the overlay would capture a half-populated tank.
    async pumpUntilReady(maxFrames) {
      for (let i = 0; i < maxFrames; i++) {
        if (document.documentElement.dataset.aquariumReady === "1") return i;
        pumpOneFrame();
        await settle();
      }
      return -1;
    },

    async pump(frames) {
      for (let i = 0; i < frames; i++) {
        pumpOneFrame();
        await settle();
      }
    },

    // A fatal boot error rewrites #loading and never hides it; surface that as
    // a real failure instead of letting the harness time out mysteriously.
    fatalMessage() {
      const loading = document.getElementById("loading");
      if (!loading || loading.classList.contains("hidden")) return null;
      const text = (loading.textContent || "").trim();
      return text.startsWith("Error:") || text.includes("WebGL is disabled") ? text : null;
    }
  };
})();
