/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Durante el desarrollo /api se proxyea al backend NestJS (:3000), de modo que el
// front trabaja siempre contra rutas relativas (mismo contrato que en producción,
// donde el API sirve el build de Vite en un solo puerto).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Puertos propios de BackOffice para no chocar con MobilityManager (api 3000,
    // web 5173) cuando ambas apps corren en la misma maquina.
    port: 5183,
    proxy: {
      '/api': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      // El iframe del RAG pide /rag/*; hay que reenviarlo al backend (:3010) igual
      // que /api. Sin esto, /rag cae en el fallback SPA de Vite y sirve el propio
      // BackOffice -> el iframe se auto-embebe (BackOffice dentro de BackOffice).
      '/rag': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
    },
  },
  test: {
    // `globals: true` es necesario para que el auto-cleanup de Testing Library
    // se registre entre tests; sin esto los renders se acumulan en el mismo DOM.
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
