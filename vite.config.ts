import { defineConfig } from "vite";

// Static build for Cloudflare Pages. Output goes to dist/.
export default defineConfig({
  base: "./",
  define: {
    __BUILD_ID__: JSON.stringify("__BUILD_ID_PLACEHOLDER__")
  },
  build: {
    target: "esnext",
    outDir: "dist",
    assetsInlineLimit: 0
  }
});
