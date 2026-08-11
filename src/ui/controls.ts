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

    this.panel.append(fsBtn, select);
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
