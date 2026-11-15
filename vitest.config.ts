import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 15 s per test: the dashboard-editor tests drive the real GridStack grid and take a few seconds when every file
  // runs in parallel (about 1 s each on their own); the 5 s default made them fail at random under load.
  test: { environment: 'jsdom', include: ['tests/**/*.test.tsx'], setupFiles: ['tests/setup.ts'], restoreMocks: true, testTimeout: 15_000 },
});
