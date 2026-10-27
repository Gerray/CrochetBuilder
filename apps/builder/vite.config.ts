import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset URLs: the app is served from a sub-path (GitHub Pages: /CrochetBuilder/).
  // Worker and lazy chunks resolve relative to their importer, so they follow along.
  base: "./",
  plugins: [react()],
  server: { port: 5190, strictPort: true },
  // The preview worker imports the engine: emit it as an ES module chunk.
  worker: { format: "es" },
  // The lazy 3D-view chunk is Three.js itself (~570 kB, ~140 kB gzip); it loads after the
  // editor has painted, so the default 500 kB warning does not apply to it.
  build: { chunkSizeWarningLimit: 650 },
});
