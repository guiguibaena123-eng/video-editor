import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Duas entradas: index.html (PC, Electron) e mobile.html (app de celular instalável).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true, host: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        mobile: fileURLToPath(new URL('./mobile.html', import.meta.url)),
      },
    },
  },
});
