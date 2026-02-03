import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    lib: {
      entry: "src/preload/preload.ts",
      fileName: "preload",
      formats: ["cjs"]
    }
  }
});
