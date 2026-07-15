import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import aiRouter from "./routes/ai";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupWSConnection } = require("y-websocket/bin/utils") as {
  setupWSConnection: (ws: unknown, req: unknown) => void;
};

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use("/api", aiRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
  setupWSConnection(ws, req as any);
});

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket as any, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

const PORT = parseInt(process.env.PORT ?? "3001", 10);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use — another backend instance is running. ` +
        `Stop it first (e.g. "lsof -ti tcp:${PORT} | xargs kill") and retry.`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`ArchForge backend running on http://localhost:${PORT}`);
  console.log(`Yjs WebSocket ready at ws://localhost:${PORT}`);
});

// Graceful shutdown: on restart (ts-node-dev --respawn sends SIGTERM) or Ctrl+C,
// close live WebSocket connections with a proper close frame and release the port
// before exiting. Without this, the process dies mid-connection, resetting sockets
// (which surfaces as "[vite] ws proxy socket error: read ECONNRESET") and can leave
// the port briefly occupied (EADDRINUSE on the next start).
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down gracefully...`);
  for (const client of wss.clients) {
    client.close(1001, "server shutting down");
  }
  wss.close();
  server.close(() => process.exit(0));
  // Fallback: don't hang if a connection refuses to close.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
