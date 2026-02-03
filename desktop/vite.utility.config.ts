import { defineConfig } from "vite";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: {
        "summarization-utility": path.resolve(__dirname, "src/summarization/utility-process.ts"),
        "transcription-utility": path.resolve(__dirname, "src/transcription/utility-process.ts")
      },
      formats: ["cjs"] 
    },
    rollupOptions: {
      external: ["electron", "node-llama-cpp", "@huggingface/transformers"]
    }
  }
});
