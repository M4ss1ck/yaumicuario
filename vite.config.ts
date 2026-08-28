import { defineConfig } from "vite";

// Static build for Cloudflare Pages. Output goes to dist/.
export default defineConfig(({ command }) => ({
  base: "./",
  define: {
    // Only a production build has a build id: scripts/build-sw.mjs computes it
    // from the built output and patches this placeholder afterwards. That
    // script never runs under `vite dev`, so dev gets a literal "dev" instead
    // of an unsubstituted placeholder leaking into the control panel.
    __BUILD_ID__: JSON.stringify(command === "build" ? "__BUILD_ID_PLACEHOLDER__" : "dev")
  },
  build: {
    target: "esnext",
    outDir: "dist",
    assetsInlineLimit: 0
  }
}));
