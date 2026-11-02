import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    hmr: { port: 24685 },
    watch: { ignored: ['**/.local/**'] },
    fs: { deny: ['**/.env*', '**/.git/**', '**/.local/**', '**/*.{crt,pem}'] },
  },
  build: { outDir: 'dist/client', emptyOutDir: true },
});
