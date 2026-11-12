import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const configuredApiBase = env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:4300/api/v1';
  const apiTarget = configuredApiBase.match(/^https?:\/\/[^/]+/i)?.[0];
  if (!apiTarget) throw new Error('VITE_API_BASE_URL must be an absolute HTTP(S) URL.');
  // The local backend binds IPv4 loopback; normalize localhost to avoid a
  // Vite proxy choosing IPv6 ::1 when the backend is listening on 127.0.0.1.
  const proxyTarget = apiTarget.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');

  return {
    plugins: [react()],
    server: {
      host: 'localhost',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api/v1': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
