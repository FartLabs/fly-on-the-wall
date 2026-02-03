import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    lib: {
      entry: "src/summarization/utility-process.ts",
      fileName: "summarization-utility",
      formats: ["cjs"]
    },
    rollupOptions: {
      external: ["electron", "node-llama-cpp"]
    }
  }
});
