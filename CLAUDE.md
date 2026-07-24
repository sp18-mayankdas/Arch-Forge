# ArchForge

ArchForge is a multiplayer architecture canvas: describe a system in natural language and an AI
assistant (Claude `claude-sonnet-4-6`) generates a live architecture diagram, synced in real time
across browser tabs via Yjs CRDT. MVP scope is exactly two features — AI prompt → architecture
generation, and real-time multiplayer canvas with live presence cursors.

## Monorepo layout (pnpm + Turborepo)

```
archforge/
├── apps/
│   ├── frontend/   @archforge/frontend  — Vite + React 18 + TS + TailwindCSS v4 + React Flow + Yjs (port 5173)
│   └── backend/    @archforge/backend   — Express + y-websocket + Anthropic SDK (port 3001)
└── packages/
    └── shared/     @archforge/shared    — shared TS types & constants (consumed as RAW TS, no build)
```

## Commands (run from the repo root)

| Command | What it does |
|---|---|
| `pnpm install` | Install everything for all packages (one command) |
| `pnpm dev` | Turbo runs frontend (:5173) + backend (:3001) in parallel |
| `pnpm dev:frontend` / `pnpm dev:backend` | Run just one app |
| `pnpm build` | Build all (see backend caveat below) |
| `pnpm type-check` | `tsc --noEmit` across all three packages |
| `pnpm lint` | ESLint across all packages |
| `pnpm --filter @archforge/frontend <script>` | Target a single package |

## Hard rules

- **Use pnpm only** — never `npm` or `yarn`. This is a pnpm workspace; npm/yarn will corrupt the layout.
- **Never compile `@archforge/shared`.** Its `package.json` `main` points at raw `./src/index.ts`.
  Vite (frontend) and ts-node-dev (backend) consume the TypeScript source directly via path aliases.
  Anything shared between frontend and backend goes here — it is the single source of truth.
- **No application-logic changes disguised as refactors.** Keep structural and feature changes separate.

## Architecture notes

- **`@archforge/shared`** exports `NODE_SHAPES`, `NodeShape`, `NODE_COLORS`, `SHAPE_DEFAULTS`,
  `CanvasNodeData`, `CanvasEdgeData`. `NODE_COLORS` entries are `{ fill, text }` (not `color/textColor`).
  `CanvasNodeData`/`CanvasEdgeData` extend `Record<string, unknown>` (required by React Flow's data generic).
  Resolved via a Vite alias + tsconfig `paths` (frontend) and `tsconfig-paths/register` at runtime (backend).
- **`CanvasNode`/`CanvasEdge`/`UserAwareness`** stay local in `apps/frontend/src/types/canvas.ts` because
  they depend on `@xyflow/react`. That file re-exports the shared pieces so existing imports keep working.
- **Frontend connects directly to the backend — there is no Vite proxy.** URLs come from
  `apps/frontend/src/lib/config.ts` (`API_URL`/`WS_URL`), which read `VITE_API_URL`/`VITE_WS_URL` and
  default to `http://localhost:3001` / `ws://localhost:3001`. Backend CORS is `origin: "*"`.
- **AI generation** lives in `apps/backend/src/routes/ai.ts` (`POST /api/generate`) → returns
  `{ nodes, edges, summary }`. It uses the **`openai` SDK** with a provider switch (`AI_PROVIDER`):
  `azure` → `AzureOpenAI` (endpoint + deployment + api-version); otherwise a generic OpenAI-compatible
  client (`AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY` — NVIDIA, OpenAI, local Ollama, …). Either way the model
  is prompted to return a single JSON object, parsed robustly (`extractJson`) and mapped through
  `NODE_COLORS`/`SHAPE_DEFAULTS`. Switch providers by editing `.env` only — no code changes.
- **Multiplayer** uses Yjs + y-websocket. The backend serves both HTTP and the Yjs WebSocket on port 3001.
  Room is the `?room=<id>` URL param — sharing the URL shares the room.

## Environment

- **Backend needs `apps/backend/.env`** — set `AI_PROVIDER` then the matching block:
  - `azure`: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`.
  - `openai`: `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` (e.g. NVIDIA free models).
  Plus optional `PORT` (default 3001). See `apps/backend/.env.example`. Restart the backend after editing
  `.env` (dotenv reads once at startup).
- **Frontend needs no env for local dev** — defaults are baked in. Set `apps/frontend/.env`
  (`VITE_API_URL`, `VITE_WS_URL`) only to target a remote backend (staging/prod; use `wss://` behind TLS).
- All `.env` files are gitignored. Never commit secrets.

## Dev gotchas

- After `pnpm dev`, fully reap the process tree when stopping — `ts-node-dev --respawn` can orphan a
  child that keeps holding port 3001 (`EADDRINUSE` on the next start):
  `pkill -f turbo; pkill -f ts-node-dev; pkill -f vite`.
- The backend has graceful shutdown (SIGTERM/SIGINT → closes WS clients cleanly, releases the port),
  so a normal restart no longer resets live sockets.
- **Backend `build` caveat:** `pnpm --filter @archforge/backend build` (plain `tsc`) is imperfect because
  `@archforge/shared` is consumed as raw TS from outside `src`. The verified run paths are `pnpm dev`
  and `type-check`. If a compiled backend `dist/` is ever needed, bundle with `tsup`/`esbuild` (inlining
  shared) rather than adding a compile step to the shared package.
