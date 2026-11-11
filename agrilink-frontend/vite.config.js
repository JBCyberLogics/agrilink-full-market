import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// This config sits at the repo root (agrilink-frontend/). index.html,
// public/ and src/ resolve relative to it. The production build lands
// at <repo>/dist.
// AgriLink is frontend-only: there is no backend process or API proxy in this
// checkout. Set VITE_API_BASE_URL to the actual backend origin; when it is
// blank, the API client reports a clear not-configured error instead of
// sending requests to the Vite development server.
export default defineConfig({
  // root defaults to the config file's directory — leave it unset.
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
