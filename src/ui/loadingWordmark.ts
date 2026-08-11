import { yaumicuarioArt } from "../assets/ascii/yaumicuario";

const FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const MUTATION_CHARS = "0123456789@#$%&*<>/\\|=+-YAUMICUARIO";
const MONO_ASPECT = 0.6;
const COLUMN_STEP_MS = 12;
const FLICKER_LEAD_MS = 220;
const FLICKER_INTERVAL_MS = 55;

function randomGlyph(): string {
  return MUTATION_CHARS[(Math.random() * MUTATION_CHARS.length) | 0];
}

function parseArt(art: string): string[][] {
  const lines = art.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const columns = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return lines.map((line) => line.padEnd(columns, " ").split(""));
}

export function revealLoadingWordmark(canvas: HTMLCanvasElement): Promise<void> {
  const renderingContext = canvas.getContext("2d");
  if (!renderingContext) return Promise.resolve();
  const context: CanvasRenderingContext2D = renderingContext;

  const parent = canvas.parentElement;
  if (!parent) return Promise.resolve();
  const container: HTMLElement = parent;

  const cells = parseArt(yaumicuarioArt);
  const rows = cells.length;
  const columns = cells[0].length;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lockAt = cells.map((row) =>
    row.map((_, column) => (reduceMotion ? 0 : column * COLUMN_STEP_MS + Math.random() * 90))
  );
  const totalDuration = Math.max(...lockAt.flat()) + 50;
  const flickerGlyphs = cells.map((row) => row.map(() => randomGlyph()));

  let cssWidth = 0;
  let cellWidth = 0;
  let rowHeight = 0;
  let lastFlicker = 0;

  function layout(): void {
    cssWidth = container.clientWidth;
    if (!cssWidth) return;

    cellWidth = cssWidth / columns;
    let fontSize = cellWidth / MONO_ASPECT;
    context.font = `${fontSize}px ${FONT_STACK}`;
    fontSize *= cellWidth / (context.measureText("M").width || cellWidth);
    rowHeight = fontSize;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(rows * rowHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${rows * rowHeight}px`;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.font = `${fontSize}px ${FONT_STACK}`;
    context.textBaseline = "top";
  }

  layout();

  return new Promise((resolve) => {
    const startedAt = performance.now();
    let resolved = false;

    window.addEventListener("resize", layout);

    function draw(now: number): void {
      const elapsed = reduceMotion ? totalDuration : now - startedAt;
      const refreshFlicker = now - lastFlicker >= FLICKER_INTERVAL_MS;

      context.clearRect(0, 0, cssWidth, rows * rowHeight);

      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const remaining = lockAt[row][column] - elapsed;
          let glyph = cells[row][column];
          let alpha = 0.9;

          if (remaining > FLICKER_LEAD_MS) continue;
          if (remaining > 0) {
            if (refreshFlicker) flickerGlyphs[row][column] = randomGlyph();
            glyph = flickerGlyphs[row][column];
            alpha = 0.12 + (1 - remaining / FLICKER_LEAD_MS) * 0.6;
          } else if (glyph === " ") {
            continue;
          }

          context.fillStyle = `rgba(230,247,250,${alpha})`;
          context.fillText(glyph, column * cellWidth, row * rowHeight);
        }
      }

      if (refreshFlicker) lastFlicker = now;
      if (elapsed < totalDuration) {
        requestAnimationFrame(draw);
      } else if (!resolved) {
        resolved = true;
        window.removeEventListener("resize", layout);
        resolve();
      }
    }

    requestAnimationFrame(draw);
  });
}
