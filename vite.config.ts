import { defineConfig } from "vite";

// Static build for Cloudflare Pages. Output goes to dist/.
export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    outDir: "dist",
    assetsInlineLimit: 0
  }
});
