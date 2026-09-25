import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import type { Duplex } from "stream";
import { WebSocketServer } from "ws";
import aiRouter from "./routes/ai";
import authRouter from "./routes/auth";
import projectsRouter from "./routes/projects";
import usageRouter from "./routes/usage";
import scaffoldRouter from "./routes/scaffold";
import { prisma } from "./db";
import { resolveProjectAccess } from "./lib/access";
import { roomIdFromUrl } from "./lib/rooms";
import { userFromCookieHeader } from "./lib/session";
import { setupPersistence, flushAllDocs } from "./persistence";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupWSConnection } = require("y-websocket/bin/utils") as {
  setupWSConnection: (ws: unknown, req: unknown, opts?: { docName?: string }) => void;
};

// Load persisted Yjs docs from / save them to Postgres. Must run before the first
// WebSocket connection so bindState is registered when rooms open.
setupPersistence();

const app = express();

// Credentialed requests cannot use `origin: "*"` — the browser refuses the combination — so
// the wildcard is gone now that the session rides in a cookie. In dev the app is same-origin
// through the Vite proxy and sends no Origin at all; APP_ORIGIN covers a split deployment.
app.use(
  cors({
    origin: [process.env.APP_ORIGIN ?? "http://localhost:3000"],
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());
// Mounted BEFORE the guarded routers: signing in cannot itself require a session.
app.use("/api", authRouter);
app.use("/api", aiRouter);
app.use("/api", projectsRouter);
app.use("/api", usageRouter);
app.use("/api", scaffoldRouter);

app.get("/health", async (_req, res) => {
  let db: "ok" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "ok";
  } catch {
    db = "down";
  }
  res.status(db === "ok" ? 200 : 503).json({ status: "ok", db });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
  // `docName` passed EXPLICITLY rather than letting y-websocket re-derive it from the URL.
  // The guard below authorizes `roomIdFromUrl(req.url)`; if the library computed a different
  // name from the same URL we would authorize one room and open another. One definition.
  setupWSConnection(ws, req as any, { docName: roomIdFromUrl((req as any).url) });
});

/** Refuse an upgrade with a real HTTP status, rather than dropping the socket silently. */
function rejectSocket(socket: Duplex, code: number, text: string) {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * The access check that actually matters.
 *
 * The canvas itself flows over this socket, so without it every REST rule is decoration:
 * anyone who could guess a project id could open `ws://host/<id>` and read and write the
 * whole document. The session arrives as a cookie because a browser cannot set headers on a
 * WebSocket (see lib/session.ts), and authorization is the same `resolveProjectAccess` the
 * REST middleware uses, so the two cannot drift.
 */
server.on("upgrade", (req, socket, head) => {
  void (async () => {
    const user = await userFromCookieHeader(req.headers.cookie);
    if (!user) return rejectSocket(socket, 401, "Unauthorized");

    const roomId = roomIdFromUrl(req.url);
    if (!roomId) return rejectSocket(socket, 404, "Not Found");

    // Unknown project and no-access are both null here, and both answer 403 — a 404 would
    // confirm which project ids exist to someone who cannot open them.
    if (!(await resolveProjectAccess(user, roomId))) return rejectSocket(socket, 403, "Forbidden");

    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  })().catch((err) => {
    console.error("WebSocket upgrade check failed:", err);
    rejectSocket(socket, 500, "Internal Server Error");
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
  // Verify the DB connection at startup so misconfig is obvious immediately.
  prisma
    .$queryRaw`SELECT 1`
    .then(() => console.log("Postgres connected ✓"))
    .catch((err) => console.error("Postgres connection FAILED:", err.message));
});

// Graceful shutdown: on restart (ts-node-dev --respawn sends SIGTERM) or Ctrl+C,
// close live WebSocket connections with a proper close frame and release the port
// before exiting. Without this, the process dies mid-connection, resetting sockets
// (which surfaces as "[vite] ws proxy socket error: read ECONNRESET") and can leave
// the port briefly occupied (EADDRINUSE on the next start).
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down gracefully...`);
  // Flush every open room to Postgres FIRST (writeState only fires on last-client
  // disconnect, so a restart would otherwise lose unsaved canvas changes).
  try {
    await flushAllDocs();
  } catch (e) {
    console.error("flush on shutdown failed:", e);
  }
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
