import { QUALITY_NAMES, type QualityName } from "../quality";

declare const __BUILD_ID__: string;

// Minimal overlay: sound toggle, fullscreen toggle and quality selector. The
// panel and the cursor both fade out after a few seconds of inactivity
// (screensaver feel).
export class Controls {
  private panel: HTMLDivElement;
  private idleTimer = 0;
  private readonly idleMs = 3000;
  private soundBtn: HTMLButtonElement;
  private onSound: () => boolean;

  constructor(
    current: QualityName,
    onQuality: (q: QualityName) => void,
    onSound: () => boolean
  ) {
    this.onSound = onSound;
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

    // Sound starts off. Autoplay is blocked until a gesture anyway, and a
    // screensaver that starts making noise unprompted is hostile.
    this.soundBtn = document.createElement("button");
    styleButton(this.soundBtn);
    this.setSoundLabel(false);
    this.soundBtn.onclick = () => this.toggleSound();

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
      opt.style.backgroundColor = "#12333c";
      opt.style.color = "#cfe8ef";
      if (name === current) opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = () => onQuality(select.value as QualityName);

    const creditsBtn = document.createElement("button");
    creditsBtn.textContent = "Credits";
    styleButton(creditsBtn);
    const creditsDialog = createCreditsDialog();
    creditsBtn.onclick = () => creditsDialog.showModal();

    // Build id, so it can be read out over the phone when something needs
    // diagnosing on a device that cannot be inspected directly. If the
    // post-build patch ever fails, the raw placeholder shows here, which is
    // itself the useful signal.
    const version = document.createElement("span");
    const bid: string = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "";
    version.textContent = bid;
    version.setAttribute("data-build-id", bid);
    version.style.cssText = [
      "margin-left:4px",
      "opacity:0.45",
      "font:300 10px/1 system-ui,sans-serif",
      "letter-spacing:0.06em",
      "color:#82aab4",
      "user-select:text"
    ].join(";");
    this.panel.append(this.soundBtn, fsBtn, select, creditsBtn, version);
    document.body.appendChild(creditsDialog);
    document.body.appendChild(this.panel);

    // Touch devices have no hover and no keyboard, so without this the panel
    // fades after a few seconds and there is no way to bring it back.
    window.addEventListener("mousemove", () => this.wake());
    window.addEventListener("pointerdown", () => this.wake());
    window.addEventListener("keydown", (e) => {
      this.wake();
      if (e.key === "f" || e.key === "F") this.toggleFullscreen();
      if (e.key === "m" || e.key === "M") this.toggleSound();
      if (e.key === "h" || e.key === "H") this.panel.style.display = this.panel.style.display === "none" ? "flex" : "none";
    });
    this.wake();
  }

  private setSoundLabel(on: boolean): void {
    this.soundBtn.textContent = on ? "🔊 Sound" : "🔈 Sound";
    this.soundBtn.setAttribute("aria-pressed", String(on));
    this.soundBtn.style.opacity = on ? "1" : "0.65";
  }

  private toggleSound(): void {
    this.setSoundLabel(this.onSound());
  }

  /** For sound restored from a previous session, which no click reported. */
  reflectSound(on: boolean): void {
    this.setSoundLabel(on);
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
    <p>Bundled models are CC0 or CC BY 4.0. The CC BY ones are credited by author below.</p>
    <h3>Fish models (CC0)</h3>
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
    <h3>Other creatures</h3>
    <ul>
      <li>Japanese freshwater crab, by ffishAsia / floraZia (CC0)</li>
      <li>Dolphin, by <strong>Alex_Pfe</strong> (CC BY 4.0)</li>
      <li>Great white shark ("White Pointer"), by <strong>3dartstevenz</strong> (CC BY 4.0)</li>
      <li>Octopus, by <strong>s8819296</strong> (CC BY 4.0)</li>
    </ul>
    <h3>Generated at runtime</h3>
    <ul>
      <li>Image-based lighting: Three.js RoomEnvironment</li>
      <li>Gravel floor albedo and normal map: procedural canvas/noise</li>
      <li>Water surface normals: procedural</li>
      <li>Coral reef geometry and color: procedural</li>
      <li>Underwater ambience and bubble sounds: synthesized in Web Audio</li>
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

// Coarse pointers get taller controls: a 30px target is hard to hit reliably
// with a thumb, and the recipient will be using this on a phone.
const COARSE_POINTER = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

function styleButton(el: HTMLElement): void {
  el.style.cssText = [
    "background:rgba(255,255,255,0.08)",
    "color:#cfe8ef",
    "border:1px solid rgba(255,255,255,0.15)",
    "border-radius:7px",
    "box-sizing:border-box",
    `height:${COARSE_POINTER ? 44 : 30}px`,
    `padding:${COARSE_POINTER ? "10px 14px" : "6px 10px"}`,
    "font:300 13px/1 system-ui,sans-serif",
    "cursor:pointer",
    "outline:none"
  ].join(";");
}
