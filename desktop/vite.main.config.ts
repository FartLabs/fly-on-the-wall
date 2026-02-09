import { defineConfig } from "vite";
import path from "path";

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  build: {
    lib: {
      entry: "src/main/main.ts",
      fileName: "main",
      formats: ["cjs"]
    },
    rollupOptions: {
      external: ["electron", "node-llama-cpp", "@node-llama-cpp"]
    }
  }
});
