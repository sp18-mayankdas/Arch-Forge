// Backend endpoints.
//
// By default the frontend talks to the SAME origin it is served from — Vite
// proxies /api and /yjs to the backend (see vite.config.ts). This makes the app
// work unchanged whether it's opened at http://localhost:5173 OR through a single
// tunnel (e.g. ngrok) with zero per-environment config.
//
// To point at a separate backend host instead (no proxy), set:
//   VITE_API_URL  — HTTP base for the REST API   (e.g. https://api.example.com)
//   VITE_WS_URL   — WebSocket base for Yjs sync   (e.g. wss://api.example.com)
const sameOriginWs =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/yjs`
    : "ws://localhost:3001/yjs";

// Empty string => same-origin relative path ("/api/generate"), which the proxy forwards.
export const API_URL = import.meta.env.VITE_API_URL ?? "";
export const WS_URL = import.meta.env.VITE_WS_URL ?? sameOriginWs;
