import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
root: 'src/renderer', 
  build: {
    outDir: '.vite/renderer',
  },
});
