import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const backend = process.env.STUDIO_API || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // shadcn/ui generates imports like `@/components/ui/button`.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: backend, changeOrigin: true, ws: true },
      "/media": { target: backend, changeOrigin: true },
      "/evidence": { target: backend, changeOrigin: true },
    },
  },
});
