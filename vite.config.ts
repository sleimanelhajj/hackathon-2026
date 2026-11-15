import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Big libraries get their own long-lived chunks: an app update doesn't make the browser download them again, and a
// page only loads the ones it uses (charts, the grid, the calendar, PDF and image export).
const VENDOR_CHUNKS: [RegExp, string][] = [
  [/node_modules[\/](recharts|d3-[^\/]+|victory-vendor|decimal.js-light)[\/]/, "charts"],
  [/node_modules[\/]gridstack[\/]/, "grid"],
  [/node_modules[\/](react-big-calendar|dayjs|date-arithmetic|dom-helpers)[\/]/, "calendar"],
  [/node_modules[\/](react|react-dom|scheduler)[\/]/, "react"],
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => VENDOR_CHUNKS.find(([re]) => re.test(id))?.[1],
      },
    },
  },
});
