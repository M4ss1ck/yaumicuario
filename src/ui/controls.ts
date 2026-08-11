import { QUALITY_NAMES, type QualityName } from "../quality";

// Minimal overlay: fullscreen toggle and quality selector. The panel and the
// cursor both fade out after a few seconds of inactivity (screensaver feel).
export class Controls {
  private panel: HTMLDivElement;
  private idleTimer = 0;
  private readonly idleMs = 3000;

  constructor(current: QualityName, onQuality: (q: QualityName) => void) {
    this.panel = document.createElement("div");
    this.panel.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "display:flex",
      "gap:8px",
      "align-items:center",
      "padding:8px 12px",
      "border-radius:10px",
      "background:rgba(6,28,34,0.55)",
      "backdrop-filter:blur(6px)",
      "color:#cfe8ef",
      "font:300 13px/1 system-ui,sans-serif",
      "transition:opacity 0.5s ease",
      "z-index:5",
      "user-select:none"
    ].join(";");

    const fsBtn = document.createElement("button");
    fsBtn.textContent = "⛶ Fullscreen";
    styleButton(fsBtn);
    fsBtn.onclick = () => this.toggleFullscreen();

    const select = document.createElement("select");
    styleButton(select);
    for (const name of QUALITY_NAMES) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === current) opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = () => onQuality(select.value as QualityName);

    const creditsBtn = document.createElement("button");
    creditsBtn.textContent = "Credits";
    styleButton(creditsBtn);
    const creditsDialog = createCreditsDialog();
    creditsBtn.onclick = () => creditsDialog.showModal();

    this.panel.append(fsBtn, select, creditsBtn);
    document.body.appendChild(creditsDialog);
    document.body.appendChild(this.panel);

    window.addEventListener("mousemove", () => this.wake());
    window.addEventListener("keydown", (e) => {
      this.wake();
      if (e.key === "f" || e.key === "F") this.toggleFullscreen();
      if (e.key === "h" || e.key === "H") this.panel.style.display = this.panel.style.display === "none" ? "flex" : "none";
    });
    this.wake();
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  private wake(): void {
    document.body.classList.remove("cursor-hidden");
    this.panel.style.opacity = "1";
    this.panel.style.pointerEvents = "auto";
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      document.body.classList.add("cursor-hidden");
      this.panel.style.opacity = "0";
      this.panel.style.pointerEvents = "none";
    }, this.idleMs);
  }
}

function createCreditsDialog(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-labelledby", "credits-title");
  dialog.style.cssText = [
    "width:min(520px,calc(100vw - 48px))",
    "max-height:calc(100vh - 48px)",
    "box-sizing:border-box",
    "padding:24px",
    "border:1px solid rgba(255,255,255,0.15)",
    "border-radius:12px",
    "background:rgba(6,28,34,0.94)",
    "backdrop-filter:blur(12px)",
    "color:#cfe8ef",
    "font:300 14px/1.5 system-ui,sans-serif",
    "overflow:auto"
  ].join(";");

  dialog.innerHTML = `
    <button aria-label="Close credits" style="float:right;margin:-8px -8px 8px 12px;background:none;border:0;color:#cfe8ef;font-size:24px;cursor:pointer">×</button>
    <h2 id="credits-title" style="margin:0 0 8px;font-size:22px">Credits</h2>
    <p>All bundled assets are CC0 (public domain, no attribution required).</p>
    <h3>Fish models</h3>
    <ul>
      <li>Paracheirodon innesi (neon tetra)</li>
      <li>Pale Bleak (Zacco platypus), animated, by ffishAsia / floraZia</li>
      <li>Guppy fish</li>
      <li>Betta splendens</li>
      <li>Japanese common loach, by ffishAsia / floraZia</li>
      <li>Myllokunmingia fengjiaoa</li>
      <li>Blacktip shark (model_9a)</li>
      <li>Perch (ahven / abborre)</li>
      <li>Baltic herring (silakka / strömming)</li>
    </ul>
    <p>Many freshwater models come from the ffishAsia / floraZia CC0 collection on Sketchfab (author <strong>ffishAsia-and-floraZia</strong>).</p>
    <h3>Generated at runtime</h3>
    <ul>
      <li>Image-based lighting: Three.js RoomEnvironment</li>
      <li>Gravel floor albedo and normal map: procedural canvas/noise</li>
      <li>Water surface normals: procedural</li>
      <li>Caustics, god rays, and color grading: custom shaders</li>
    </ul>
    <h3>Libraries</h3>
    <ul>
      <li><a href="https://threejs.org/" target="_blank" rel="noreferrer" style="color:#9fd9e8">Three.js</a>, MIT</li>
      <li><a href="https://vitejs.dev/" target="_blank" rel="noreferrer" style="color:#9fd9e8">Vite</a>, MIT</li>
    </ul>
  `;

  dialog.querySelector("button")!.onclick = () => dialog.close();
  dialog.onclick = (event) => {
    if (event.target === dialog) dialog.close();
  };
  return dialog;
}

function styleButton(el: HTMLElement): void {
  el.style.cssText = [
    "background:rgba(255,255,255,0.08)",
    "color:#cfe8ef",
    "border:1px solid rgba(255,255,255,0.15)",
    "border-radius:7px",
    "padding:6px 10px",
    "font:300 13px/1 system-ui,sans-serif",
    "cursor:pointer",
    "outline:none"
  ].join(";");
}
