import { defineConfig } from "@argo-video/cli";

export default defineConfig({
  baseURL: "about:blank",
  demosDir: "demos",
  outputDir: "videos",
  tts: {
    defaultVoice: "af_heart",
    defaultSpeed: 0.95,
  },
  video: {
    width: 1280,
    height: 800,
    fps: 30,
    browser: "chromium",
  },
  export: {
    preset: "slow",
    crf: 16,
    // transition: { type: 'dissolve', durationMs: 400 },
    audio: { loudnorm: true },
    thumbnailPath: "docs/assets/logo.png",
  },
  overlays: {
    autoBackground: true,
  },
});
