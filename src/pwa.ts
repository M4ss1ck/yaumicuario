// Registration for the cache-first service worker.
// Must be a no-op on insecure contexts and must never throw.
export function registerSW(): void {
  try {
    // No SW in insecure context or unsupported browser.
    if (!("serviceWorker" in navigator)) return;
    // isSecureContext is false on http (except localhost); localhost is considered secure anyway.
    // Explicitly guard so we never attempt registration where it would fail noisily.
    if (typeof window !== "undefined" && window.isSecureContext === false) return;

    // Defer until the page has finished loading so registration does not compete with first paint.
    const doRegister = (): void => {
      // Base is "./" so the worker lives next to index.html.
      navigator.serviceWorker
        .register("./sw.js", { scope: "./" })
        .catch(() => {
          // Recovery matters more than logging; never surface to user.
        });
    };

    if (document.readyState === "complete") doRegister();
    else window.addEventListener("load", doRegister, { once: true });
  } catch {
    // Never throw into page.
  }
}
