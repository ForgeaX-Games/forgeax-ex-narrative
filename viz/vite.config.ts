import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: true },
  server: {
    port: 5176,
    proxy: {
      "/api": {
        target:
          process.env.VITE_NARRATIVE_API ??
          "http://localhost:8900",
        changeOrigin: true,
      },
    },
  },
});
