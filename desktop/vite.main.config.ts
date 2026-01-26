import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
    build: {
        lib: {
            entry: 'src/main/main.ts',
            fileName: "main",
            formats: ['cjs'],
        }
    }
});
