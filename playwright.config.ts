import { defineConfig } from '@playwright/test';
import config from './argo.config.mjs';

const scale = Math.max(1, Math.round(config.video?.deviceScaleFactor ?? 1));
const width = config.video?.width ?? 1920;
const height = config.video?.height ?? 1080;

export default defineConfig({
  preserveOutput: 'always',
  projects: [
    {
      name: 'demos',
      testDir: 'demos',
      testMatch: '**/*.demo.ts',
      use: {
        browserName: config.video?.browser ?? 'chromium',
        baseURL: process.env.BASE_URL || config.baseURL || 'http://localhost:3000',
        viewport: { width, height },
        deviceScaleFactor: scale,
        video: {
          mode: 'on',
          size: { width: width * scale, height: height * scale },
        },
      },
    },
  ],
});
