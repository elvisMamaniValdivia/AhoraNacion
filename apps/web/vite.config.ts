import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // En desarrollo, /api se reenvía al backend: sin CORS y con cookies del mismo origen.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
