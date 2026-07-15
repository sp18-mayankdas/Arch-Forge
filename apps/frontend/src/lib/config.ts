// Backend endpoints. The frontend connects directly to the backend (no Vite proxy).
// Defaults target the local dev backend; override via env vars for other environments:
//   VITE_API_URL  — HTTP base for the REST API   (e.g. https://api.example.com)
//   VITE_WS_URL   — WebSocket base for Yjs sync   (e.g. wss://api.example.com)
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3001";
