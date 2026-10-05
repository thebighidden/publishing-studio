import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The Laravel API (docker compose up) answers on :8000. Proxying it keeps the app, the
// API and the OAuth callbacks on one origin, so the session cookie just works. The Host
// header is passed through unchanged so signed links (email verification) still match.
// (The string shorthand would rewrite Host to :8000, hence the explicit objects.)
const api = { target: 'http://localhost:8000', changeOrigin: false }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/sanctum': api,
      '/oauth': api,
    },
  },
})
