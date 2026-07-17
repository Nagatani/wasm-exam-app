import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// @wasmer/sdk needs SharedArrayBuffer (used for its Web Worker thread pool,
// even for single-threaded WASIX programs), which browsers only expose on
// cross-origin-isolated pages. These headers must also be set by whatever
// serves the production build (reverse proxy / static host), not just here.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { headers: crossOriginIsolationHeaders },
  preview: { headers: crossOriginIsolationHeaders },
})
