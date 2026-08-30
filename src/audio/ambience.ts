// Procedural underwater ambience. Nothing is downloaded and nothing is
// sampled: the whole bed is synthesized in the Web Audio graph.
//
// That is deliberate. A recorded loop reveals its period within a minute, and
// this is a screensaver meant to be left running for hours. It is also how the
// rest of the scene works already, with the gravel, the caustics and the water
// normals all generated at runtime.
//
// Four layers:
//   body      brown noise through a low-pass, the mass of water itself
//   swell     a slow LFO on that filter, so the body breathes
//   surface   high-passed noise at low level, the shimmer near the top
//   bubbles   scheduled transients, a fast upward pitch sweep through a
//             band-pass, matched to the bubble column in scene/bubbles.ts
//
// Autoplay policy means none of this may start without a user gesture, so the
// graph is not even constructed until the first toggle.

const STORAGE_KEY = "aquarium.sound";
const FADE_SECONDS = 1.0;
const MASTER_LEVEL = 0.34;

// Brown noise: a random walk rather than white noise, which puts the energy
// low where a body of water actually sits. The buffer is long enough that its
// own loop point is not audible under everything else.
function makeBrownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bubbleTimer = 0;
  private nextBubbleIn = 0;
  private on = false;

  get enabled(): boolean {
    return this.on;
  }

  // Re-arm sound that was left on in a previous session.
  //
  // Autoplay policy is the whole difficulty. A browser that has seen enough
  // engagement with this origin will let resume() through immediately; one that
  // has not leaves the context suspended and silent, with no error. So the
  // graph is built and resumed optimistically, and if the context is still
  // suspended afterwards the finish is deferred to the first real gesture.
  // Either way `onChange` reports the state that is actually true, so the
  // button never claims to be playing sound that is not.
  restore(onChange: (on: boolean) => void): void {
    if (localStorage.getItem(STORAGE_KEY) !== "on") return;

    const start = (): void => {
      this.build();
      const ctx = this.ctx!;
      void ctx.resume().then(() => {
        if (ctx.state !== "running") return;
        this.on = true;
        const gain = this.master!.gain;
        gain.cancelScheduledValues(ctx.currentTime);
        gain.setValueAtTime(gain.value, ctx.currentTime);
        gain.linearRampToValueAtTime(MASTER_LEVEL, ctx.currentTime + FADE_SECONDS);
        onChange(true);
      });
    };

    start();
    // If the optimistic attempt was blocked, the next gesture unblocks it. The
    // listeners are one-shot, and harmless if the context is already running.
    const onGesture = (): void => {
      if (!this.on) start();
    };
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
  }

  // Built lazily, on the gesture that turns sound on: an AudioContext created
  // before that starts suspended and browsers increasingly warn about it.
  private build(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;

    const noise = makeBrownNoise(ctx, 8);

    // Body: the low rumble of a large volume of water.
    const body = ctx.createBufferSource();
    body.buffer = noise;
    body.loop = true;
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = "lowpass";
    bodyFilter.frequency.value = 320;
    bodyFilter.Q.value = 0.6;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.9;
    body.connect(bodyFilter).connect(bodyGain).connect(master);
    body.start();

    // Swell: a very slow sweep of the body's cutoff, so the bed moves instead
    // of sitting as a flat hiss.
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.045;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 120;
    swell.connect(swellDepth).connect(bodyFilter.frequency);
    swell.start();

    // Surface: faint high shimmer, the light-catching top of the water column.
    const surface = ctx.createBufferSource();
    surface.buffer = noise;
    surface.loop = true;
    surface.playbackRate.value = 1.37; // decorrelate it from the body layer
    const surfaceFilter = ctx.createBiquadFilter();
    surfaceFilter.type = "highpass";
    surfaceFilter.frequency.value = 2600;
    const surfaceGain = ctx.createGain();
    surfaceGain.gain.value = 0.05;
    surface.connect(surfaceFilter).connect(surfaceGain).connect(master);
    surface.start();

    this.nextBubbleIn = 0.4;
  }

  // One bubble: a short sine whose pitch sweeps sharply upward as the bubble
  // pinches off, which is the whole character of the sound.
  private popBubble(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const base = 380 + Math.random() * 900;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * (2.2 + Math.random()), now + 0.055);

    const gain = ctx.createGain();
    const peak = 0.05 + Math.random() * 0.09;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09 + Math.random() * 0.07);

    const shape = ctx.createBiquadFilter();
    shape.type = "bandpass";
    shape.frequency.value = base * 1.6;
    shape.Q.value = 1.4;

    osc.connect(shape).connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  /** Returns the new state. Must be called from a user gesture the first time. */
  toggle(): boolean {
    this.build();
    this.on = !this.on;
    localStorage.setItem(STORAGE_KEY, this.on ? "on" : "off");

    const ctx = this.ctx!;
    if (this.on) void ctx.resume();
    const gain = this.master!.gain;
    gain.cancelScheduledValues(ctx.currentTime);
    gain.setValueAtTime(gain.value, ctx.currentTime);
    gain.linearRampToValueAtTime(this.on ? MASTER_LEVEL : 0, ctx.currentTime + FADE_SECONDS);
    return this.on;
  }

  /** Follows the render loop: silence while the tab is hidden. */
  setSuspended(suspended: boolean): void {
    if (!this.ctx || !this.on) return;
    if (suspended) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  update(dt: number): void {
    if (!this.on || !this.ctx) return;
    this.bubbleTimer += dt;
    if (this.bubbleTimer >= this.nextBubbleIn) {
      this.bubbleTimer = 0;
      // Bubbles arrive in an uneven trickle. A fixed interval reads as a
      // metronome within seconds.
      this.nextBubbleIn = 0.12 + Math.random() * 0.9;
      this.popBubble();
    }
  }
}
