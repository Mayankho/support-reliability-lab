import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.SRL_API_URL ?? 'http://127.0.0.1:3000';
const proxy = { '/api': api, '/health': api };

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.SRL_WEB_PORT ?? 4173),
    strictPort: true,
    proxy,
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
