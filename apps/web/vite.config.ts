import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Dev server proxies API calls so the browser stays same-origin, as in production.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000'

// IP addresses and localhost are always accepted. To open the dev server by a machine
// name (e.g. mybox.local) from a phone, list it: DEV_ALLOWED_HOSTS=mybox.local,other.local
const extraHosts = (process.env.DEV_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { environment: 'happy-dom', setupFiles: ['test/setup.ts'] },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    ...(extraHosts.length > 0 ? { allowedHosts: extraHosts } : {}),
    // The dev server may be reachable from the LAN, so only serve what the app needs.
    fs: {
      strict: true,
      allow: [
        import.meta.dirname,
        path.resolve(import.meta.dirname, '../../packages/shared'),
        path.resolve(import.meta.dirname, '../../node_modules'),
      ],
      deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**'],
    },
    proxy: {
      '/api': apiTarget,
      '/healthz': apiTarget,
    },
  },
})
