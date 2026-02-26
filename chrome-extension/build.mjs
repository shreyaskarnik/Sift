#!/usr/bin/env node
/**
 * Build script:
 * 1. Main build — background service worker (bundles Transformers.js + ONNX WASM)
 * 2. IIFE builds — side panel + content scripts (self-contained, no external imports)
 */
import { build } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. Main build (background with Transformers.js — copies public/ to dist/)
await build({ configFile: resolve(__dirname, "vite.config.ts") });

// 2. Side panel + content scripts as self-contained IIFEs
const iifeEntries = [
  { name: "taste", entry: resolve(__dirname, "src/taste/taste.ts") },
  { name: "labels", entry: resolve(__dirname, "src/labels/labels.ts") },
  { name: "agent", entry: resolve(__dirname, "src/agent/agent.ts") },
  { name: "side-panel", entry: resolve(__dirname, "src/side-panel/side-panel.ts") },
  { name: "hn-content", entry: resolve(__dirname, "src/content/hn/hn-content.ts") },
  { name: "reddit-content", entry: resolve(__dirname, "src/content/reddit/reddit-content.ts") },
  { name: "x-content", entry: resolve(__dirname, "src/content/x/x-content.ts") },
];

for (const { name, entry } of iifeEntries) {
  await build({
    configFile: false,
    publicDir: false,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      rollupOptions: {
        input: { [name]: entry },
        output: {
          format: "iife",
          entryFileNames: "[name].js",
          inlineDynamicImports: true,
        },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
  });
}

console.log("\nBuild complete.");
