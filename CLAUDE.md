# ArchForge

ArchForge is a multiplayer architecture canvas: describe a system in natural language and an LLM
generates a live architecture diagram, synced in real time across browser tabs via Yjs CRDT. MVP
scope is exactly two features — AI prompt → architecture generation, and real-time multiplayer
canvas with live presence cursors. The model is provider-agnostic (see **AI generation** below).

## Monorepo layout (pnpm + Turborepo)

```
archforge/
├── apps/
│   ├── frontend/   @archforge/frontend  — Vite + React 18 + TS + TailwindCSS v4 + React Flow + Yjs (port 5173)
│   └── backend/    @archforge/backend   — Express + y-websocket + `openai` SDK (port 3001)
└── packages/
    └── shared/     @archforge/shared    — shared TS types & constants (consumed as RAW TS, no build)
```

## Commands (run from the repo root)

| Command                                      | What it does                                              |
| --------------------------------------------- | --------------------------------------------------------- |
| `pnpm install`                               | Install everything for all packages (one command)         |
| `pnpm dev`                                   | Turbo runs frontend (:5173) + backend (:3001) in parallel |
| `pnpm dev:frontend` / `pnpm dev:backend`     | Run just one app                                          |
| `pnpm build`                                 | Build all (see backend caveat below)                      |
| `pnpm type-check`                            | `tsc --noEmit` across all three packages                  |
| `pnpm lint`                                  | ESLint across all packages                                |
| `pnpm test`                                  | Vitest across all three packages (see **Testing** below)  |
| `pnpm --filter @archforge/frontend <script>` | Target a single package                                   |

## Hard rules

- **Use pnpm only** — never `npm` or `yarn`. This is a pnpm workspace; npm/yarn will corrupt the layout.
- **Never compile `@archforge/shared`.** Its `package.json` `main` points at raw `./src/index.ts`.
  Vite (frontend) and ts-node-dev (backend) consume the TypeScript source directly via path aliases.
  Anything shared between frontend and backend goes here — it is the single source of truth.
- **No application-logic changes disguised as refactors.** Keep structural and feature changes separate.

## Architecture notes

### Node types

- **`packages/shared/src/node-types.ts`** holds a closed 15-member `NODE_TYPES` enum and
  `NODE_TYPE_REGISTRY`. Node **type derives shape and colour** — `shape`/`color`/`textColor` are not
  stored on nodes and are not in the AI contract. `CanvasNodeData` is `{ label, type }`.
- Each registry entry declares fields for four consumers: renderer (`shape`, `colorIndex`, `icon`,
  `defaultLabel`), lint predicates (`isDatastore`, `isIngress`, `absorbsLoad`), load simulator
  (`capacityRps`, `latencyMs`, `cacheHitRatio?`) and scaffold (`templateKey`). **Only the renderer
  fields are consumed today** — the rest are inert data for planned engines. Do not delete them as
  dead code, and do not render `icon` yet.
- The enum is a public interface across those consumers. Changing an existing entry's _meaning_ is a
  breaking change even though nothing types it as an API. `client.capacityRps` is `0` meaning "load
  source, capacity not applicable" — a future simulator must ignore it, not treat it as a bottleneck.
- `isNodeType()` is the guard for untrusted input (model output, wire data).

### Shared package layout

- **`packages/shared/src/`** is three modules re-exported from `index.ts`: `presentation.ts`
  (`NODE_SHAPES`, `NodeShape`, `NODE_COLORS`, `SHAPE_DEFAULTS`), `node-types.ts` (the enum + registry),
  `semantic.ts` (`SemanticNode`, `SemanticEdge`, `SemanticOp`, `serializeGraph`). `presentation.ts`
  exists as its own file so `node-types.ts` can import `NodeShape` without a cycle through `index.ts`.
  `NODE_COLORS` entries are `{ fill, text }` (not `color`/`textColor`).
- `CanvasNodeData`/`CanvasEdgeData` extend `Record<string, unknown>` (required by React Flow's data
  generic). Resolved via a Vite alias + tsconfig `paths` (frontend) and `tsconfig-paths/register` at
  runtime (backend), plus a matching alias in each `vitest.config.ts`.
- **`CanvasNode`/`CanvasEdge`/`UserAwareness`** stay local in `apps/frontend/src/types/canvas.ts` because
  they depend on `@xyflow/react`. That file re-exports the shared pieces so existing imports keep working.
- `serializeGraph()` picks fields explicitly and never spreads its input — a spread would carry
  presentation keys into a prompt the moment a caller passed a React Flow node.

### Transport and AI

- **Frontend connects directly to the backend — there is no Vite proxy.** URLs come from
  `apps/frontend/src/lib/config.ts` (`API_URL`/`WS_URL`), which read `VITE_API_URL`/`VITE_WS_URL` and
  default to `http://localhost:3001` / `ws://localhost:3001`. Backend CORS is `origin: "*"`.
- **AI generation** lives in `apps/backend/src/routes/ai.ts` (`POST /api/generate`) → returns
  `{ nodes, edges, summary }`. It uses the **`openai` SDK** with a provider switch (`AI_PROVIDER`):
  `azure` → `AzureOpenAI` (AZURE_OPENAI_* vars); `nvidia` → OpenAI-compatible with NVIDIA NIM defaults
  (NVIDIA_AI_* vars); `groq` → Groq free tier (GROQ_AI_* vars); `openai` → generic OpenAI-compatible
  (any other provider: OpenRouter, real OpenAI, local Ollama, …; AI_* vars). Either way the model is
  prompted to return a single JSON object, parsed robustly (`extractJson`) and mapped through
  `NODE_COLORS`/`SHAPE_DEFAULTS`. Switch providers by editing `.env` only — no code changes.
- The client is built **lazily** via `getClient()`, not at import time: a missing key surfaces as a 500
  on `/api/generate` instead of crashing at boot, and it keeps the module importable by tests.
- **Multiplayer** uses Yjs + y-websocket. The backend serves both HTTP and the Yjs WebSocket on port 3001.
  Room is the `?room=<id>` URL param — sharing the URL shares the room.

## Testing

- `pnpm test` runs Vitest in all three packages (node environment, no jsdom). Frontend and backend set
  `passWithNoTests` so a package with no test files does not fail the suite.
- Tests live beside their subject as `src/**/*.test.ts`.

## Environment

- **Backend needs `apps/backend/.env`** — set `AI_PROVIDER` then the matching block:
  - `azure`: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`.
  - `nvidia`: `NVIDIA_AI_API_KEY` (required); `NVIDIA_AI_BASE_URL` and `NVIDIA_AI_MODEL` auto-default, override if needed.
  - `groq`: `GROQ_AI_API_KEY` (required); `GROQ_AI_BASE_URL` and `GROQ_AI_MODEL` auto-default, override if needed.
  - `openai`: `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` (all required; no defaults).
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
- **`packages/shared/tsconfig.json` sets `target`/`lib` to `ES2020`** to match both apps. `tsconfig.base.json`
  sets neither, so without it tsc defaults to ES5 and rejects `Number.isFinite`, `Array.includes` and friends.
- **Backend `build` caveat:** `pnpm --filter @archforge/backend build` (plain `tsc`) is imperfect because
  `@archforge/shared` is consumed as raw TS from outside `src`. The verified run paths are `pnpm dev`
  and `type-check`. If a compiled backend `dist/` is ever needed, bundle with `tsup`/`esbuild` (inlining
  shared) rather than adding a compile step to the shared package.
