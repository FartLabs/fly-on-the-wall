import { defineConfig } from "vite";
import path from "path";

// https://vitejs.dev/config
export default defineConfig({
  root: "src/renderer",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    fs: {
      // vite only serves files inside "root" (src/renderer), so
      // allow vite to serve files from the main project directory.
      // though, are there any security implications of this? this works but
      // it can be a bit concerning regarding filesystem permissions
      allow: [path.resolve(__dirname)]
    }
  },
  build: {
    outDir: path.resolve(__dirname, ".vite/renderer/main_window")
  }
});
