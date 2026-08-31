import { AnimationMixer, Vector3, type Object3D, type Scene } from "three";
import { asset, loadGLTF } from "../utils/loaders";
import { prepareModel, eachMaterial, type Axis } from "./prepare";
import { Cruiser } from "./cruiser";
import { Crab } from "./crab";
import { Octopus, registerArmUndulation, updateOctopusArms } from "./octopus";

// The non-fish cast: two big animals that cross the back of the tank, a crab
// walking the near sand, and an octopus perched on the reef. Each has its own
// behaviour rather than joining the boid flock, for the reasons set out in the
// individual modules.
//
// Sizes are honest except the crab. See crab.ts: at its species' real 5 cm it
// would cover five pixels of an 1280-wide frame, so it is scaled to 30 cm,
// which is an honest size for a crab, just not for this one.
interface CreatureSpec {
  file: string;
  bodyAxis: Axis;
  headDir: 1 | -1;
  /** Length along bodyAxis, in metres. */
  length: number;
}

const DOLPHIN: CreatureSpec = { file: "dolphin.glb", bodyAxis: "z", headDir: 1, length: 2.6 };
const SHARK: CreatureSpec = { file: "great_white_shark.glb", bodyAxis: "z", headDir: 1, length: 4.5 };
const CRAB: CreatureSpec = { file: "crab.glb", bodyAxis: "x", headDir: 1, length: 0.3 };
const OCTOPUS: CreatureSpec = { file: "octopus.glb", bodyAxis: "z", headDir: 1, length: 1.1 };

const ROSTER = [DOLPHIN, SHARK, CRAB, OCTOPUS];

// On the center-rear reef mass (see reef.ts OUTCROPS), whose domes stand around
// 0.25 m off a floor at y = -3.5.
//
// Not on the hero mass stage left, which would be the better composition on a
// wide screen. The portrait framing a phone gets spans only about +-2.3 m at
// this depth, and every flanking position is outside it, so an octopus on the
// hero mass simply does not exist on the device this is mostly watched on.
// Size is at the top of the honest range for a common octopus, to hold up
// against the 28% fog transmittance at this distance.
const OCTOPUS_PERCH = new Vector3(-1.6, -3.18, -4.3);

export class CreatureManager {
  private cruisers: Cruiser[] = [];
  private crab: Crab | null = null;
  private octopus: Octopus | null = null;

  async load(scene: Scene, onProgress?: (loadedBytes: number, totalBytes: number) => void): Promise<void> {
    const loaded = new Map<string, number>();
    const totals = new Map<string, number>();
    const sum = (m: Map<string, number>): number => {
      let n = 0;
      for (const v of m.values()) n += v;
      return n;
    };

    const gltfs = await Promise.all(
      ROSTER.map((spec) =>
        loadGLTF(asset(`assets/creatures/${spec.file}`), (event) => {
          loaded.set(spec.file, event.loaded);
          if (event.lengthComputable) totals.set(spec.file, event.total);
          onProgress?.(sum(loaded), sum(totals));
        })
      )
    );

    const [dolphinGltf, sharkGltf, crabGltf, octopusGltf] = gltfs;

    const mixerFor = (gltf: (typeof gltfs)[number], root: Object3D): AnimationMixer | null => {
      if (gltf.animations.length === 0) return null;
      const mixer = new AnimationMixer(root);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play();
      action.time = Math.random() * gltf.animations[0].duration;
      return mixer;
    };

    // The dolphin is an event: it crosses, leaves, and is gone for half a minute
    // or more. The shark patrols without a break, so the back of the tank is
    // never entirely empty.
    const dolphin = prepareModel(dolphinGltf.scene, DOLPHIN);
    this.cruisers.push(
      new Cruiser(
        scene,
        dolphin.holder,
        mixerFor(dolphinGltf, dolphin.model),
        { speed: 1.5, idleAfterPass: 30, idleJitter: 30, bobAmplitude: 0.35 },
        8
      )
    );

    const shark = prepareModel(sharkGltf.scene, SHARK);
    this.cruisers.push(
      new Cruiser(
        scene,
        shark.holder,
        mixerFor(sharkGltf, shark.model),
        { speed: 0.85, idleAfterPass: 0, idleJitter: 0, bobAmplitude: 0.22 },
        0
      )
    );

    const crab = prepareModel(crabGltf.scene, CRAB);
    this.crab = new Crab(scene, crab.holder, mixerFor(crabGltf, crab.model), crab.size.y);

    // The octopus has no rig, so its motion is injected into its materials.
    const octopus = prepareModel(octopusGltf.scene, OCTOPUS);
    eachMaterial(octopus.model, (m) => registerArmUndulation(m, 0.12, 0.42, 0.02));
    this.octopus = new Octopus(scene, octopus.holder, OCTOPUS_PERCH, 0.9);
  }

  update(dt: number, elapsed: number): void {
    for (const cruiser of this.cruisers) cruiser.update(dt, elapsed);
    this.crab?.update(dt);
    this.octopus?.update(dt, elapsed);
    updateOctopusArms(elapsed);
  }
}
