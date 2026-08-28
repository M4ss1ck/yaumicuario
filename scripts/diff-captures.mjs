// Compares two capture directories and reports per-frame pixel drift.
//
//   node scripts/diff-captures.mjs captures/baseline captures/after [--threshold 0.1]
//
// Exit 0 when every frame is within the threshold, 1 when any frame exceeds it,
// 2 on a structural problem (missing or mismatched frames). The threshold is a
// percentage of differing pixels, not a similarity score.
//
// Noise floor: captures are not bit-exact. Boot consumes a variable number of
// frames because GLTF loads settle in real time, which leaves a small drift
// that accumulates over the captured frames and shows up as fish silhouette
// edges. Measured over three runs of an unchanged build, pairwise diffs ranged
// 0.0000% to 0.0230% (one pair was bit-exact). The 0.15% default sits ~6.5x
// above the worst observed run, and well below the percent-level changes the
// asset and render work is expected to produce. Re-measure the floor if the
// boot path or the frame checkpoints change.

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

function parseArgs(argv) {
  const positional = [];
  const args = { threshold: 0.15, pixelThreshold: 0.1, diffDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--threshold") args.threshold = Number(argv[++i]);
    else if (argv[i] === "--pixel-threshold") args.pixelThreshold = Number(argv[++i]);
    else if (argv[i] === "--diff-dir") args.diffDir = argv[++i];
    else positional.push(argv[i]);
  }
  if (positional.length !== 2) {
    console.error("usage: node scripts/diff-captures.mjs <baseline-dir> <after-dir> [--threshold PCT]");
    process.exit(2);
  }
  args.baseline = positional[0];
  args.after = positional[1];
  return args;
}

const pngsIn = async (dir) =>
  (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const diffDir = args.diffDir || join(args.after, "diff");

  const [baseFiles, afterFiles] = await Promise.all([pngsIn(args.baseline), pngsIn(args.after)]);

  const onlyBase = baseFiles.filter((f) => !afterFiles.includes(f));
  const onlyAfter = afterFiles.filter((f) => !baseFiles.includes(f));
  if (onlyBase.length || onlyAfter.length) {
    if (onlyBase.length) console.error(`missing from after:   ${onlyBase.join(", ")}`);
    if (onlyAfter.length) console.error(`unexpected in after:  ${onlyAfter.join(", ")}`);
    process.exit(2);
  }
  if (!baseFiles.length) {
    console.error("no PNG frames found to compare");
    process.exit(2);
  }

  await mkdir(diffDir, { recursive: true });

  const rows = [];
  let worst = 0;
  let failed = false;

  for (const file of baseFiles) {
    const [a, b] = await Promise.all([
      readFile(join(args.baseline, file)).then((buf) => PNG.sync.read(buf)),
      readFile(join(args.after, file)).then((buf) => PNG.sync.read(buf))
    ]);

    if (a.width !== b.width || a.height !== b.height) {
      console.error(`${file}: size changed ${a.width}x${a.height} -> ${b.width}x${b.height}`);
      process.exit(2);
    }

    const diff = new PNG({ width: a.width, height: a.height });
    const differing = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
      threshold: args.pixelThreshold,
      includeAA: false
    });
    const total = a.width * a.height;
    const pct = (differing / total) * 100;
    worst = Math.max(worst, pct);

    const over = pct > args.threshold;
    if (over) {
      failed = true;
      await writeFile(join(diffDir, `diff-${basename(file)}`), PNG.sync.write(diff));
    }
    rows.push({ file, differing, total, pct, over });
  }

  const width = Math.max(...rows.map((r) => r.file.length));
  for (const r of rows) {
    console.log(
      `${r.over ? "FAIL" : "ok  "} ${r.file.padEnd(width)}  ${r.pct.toFixed(4).padStart(9)}%  ` +
        `(${r.differing}/${r.total} px)`
    );
  }
  console.log(`\nworst ${worst.toFixed(4)}%, threshold ${args.threshold}%`);
  if (failed) console.log(`diff images written to ${diffDir}`);

  process.exit(failed ? 1 : 0);
}

main();
