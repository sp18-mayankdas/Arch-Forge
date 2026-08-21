import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@archforge/shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    // Allow any Host header so the dev server works behind a tunnel (ngrok, etc.).
    allowedHosts: true,
    // Same-origin proxy to the backend so the whole app is reachable through ONE
    // origin/tunnel. /api → REST, /yjs → Yjs WebSocket (strip the /yjs prefix).
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/yjs": {
        target: "ws://localhost:3001",
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yjs/, ""),
      },
    },
  },
});
