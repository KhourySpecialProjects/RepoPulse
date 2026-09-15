import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true, //adding this to allow use on coolify?
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Vitest's default (`false`) replaces every CSS import — `?raw` included —
    // with an empty string, which silently made the theme-token guards assert
    // nothing at all. Costs the suite nothing: only main.tsx imports CSS, and
    // no test renders it.
    css: true,
  },
})
