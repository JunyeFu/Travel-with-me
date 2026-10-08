import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'js/__tests__/amap-web-service.test.js',
      'js/__tests__/amap-arrow-shader.test.js',
      'js/__tests__/geocode.test.js',
      'js/__tests__/guide-import-cancellation.test.js',
      'js/__tests__/guide-import-cleanup.test.js',
      'js/__tests__/icons.test.js',
      'js/__tests__/route-config.test.js',
      'js/__tests__/route-geometry.test.js',
      'js/__tests__/routing.test.js',
      'js/__tests__/state.test.js',
      'js/__tests__/storage.test.js',
      'js/__tests__/time-slots.test.js',
      'js/__tests__/utils.test.js',
      'server/__tests__/bm25.test.js',
      'server/__tests__/integration.test.js',
      'server/__tests__/retrieve.test.js',
      'server/__tests__/store.test.js',
      'server/__tests__/tokenizer.test.js',
      'scripts/__tests__/playwright-config.test.js',
      'scripts/__tests__/release-evidence.test.js'
    ],
    globals: false
  }
});
