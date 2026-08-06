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
| -------------------------------------------- | --------------------------------------------------------- |
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

### The semantic / presentation split (read this first)

The single most important invariant: **the LLM only ever sees topology.** No coordinates, colours,
shapes or sizes cross the AI boundary in either direction. This is structural, not a convention:

| Yjs structure             | Layer        | Contents                                                            |
| ------------------------- | ------------ | ------------------------------------------------------------------- |
| `doc.getMap("nodes")`     | semantic     | `{ id, type, label }`                                               |
| `doc.getMap("edges")`     | semantic     | `{ id, source, target, label? }`                                    |
| `doc.getMap("positions")` | presentation | `{ x, y }` keyed by node id                                         |
| `doc.getArray("ops")`     | log          | append-only `SemanticOp[]`; **`ops.length` IS the version counter** |

- **`apps/frontend/src/lib/semantic-ops.ts` is the only writer of `nodes`/`edges`/`ops`.** `applyOps`
  mutates the maps and appends the op record in one `doc.transact`, so the version can never disagree
  with the graph. Never write those three structures directly.
- **`setPositions` touches `positions` only and appends no op** — that is why dragging a node cannot
  bump the version or (later) trigger an AI call. Do not "simplify" these into one writer.
- The version is an array length rather than a number because a mutable counter undercounts in a CRDT:
  two peers both read 42, both write 43, one write wins, an increment is lost.
- Deleting a node must clear its `positions` entry and sweep its edges in the same transaction —
  `applyOps` already does this.
- A node with no `positions` entry renders at the origin. Missing presentation must never hide semantics.

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

### Layout

- **`apps/frontend/src/lib/layout.ts`** is the only place topology becomes pixels. `layoutGraph()` runs
  dagre (`@dagrejs/dagre`, frontend-only dependency) and writes results to the `positions` map.
- **dagre returns node CENTRES; React Flow positions from top-left** — subtract half width/height.
- `sizeOf()` must return a **fresh** `{ width, height }` per node, never the shared `SHAPE_DEFAULTS`
  entry: dagre writes computed `x`/`y` _into_ the label object it is handed, so a shared object makes
  every node of the same shape alias one label and collapse onto a single point.
- Apply flow (`App.tsx handleApplyDesign`) is three ordered, synchronous steps: `applyOps` →
  `readSemanticGraph` → `setPositions(layoutGraph(...))`. Layout runs over the **full** graph, not just
  new nodes, so existing content re-flows instead of being overlapped.

### Transport and AI

- **The frontend talks to the same origin by default — Vite proxies `/api` and `/yjs` to the backend**
  (`vite.config.ts`), so the app works unchanged at `localhost:5173` or through a single tunnel.
  `apps/frontend/src/lib/config.ts` sets `API_URL` to `""` (relative) and `WS_URL` to a same-origin
  `/yjs` URL. Set `VITE_API_URL`/`VITE_WS_URL` to bypass the proxy and target a separate backend host.
  Backend CORS is `origin: "*"`.
- **AI generation** lives in `apps/backend/src/routes/ai.ts` (`POST /api/generate`) → returns
  `GenerateResponse` (`packages/shared/src/clarify.ts`): `{ thinking?, applied, questions,
  suggestions, nodes, edges, summary, tradeoff? }`, as **semantic records only**. Every branch of the
  handler goes through one `send()` helper typed against that interface, so a branch that forgets a
  newly added field is a compile error — there is no test asserting the body, and that typing is the
  only guard. It uses the **`openai` SDK** with a provider
  switch (`AI_PROVIDER`): `azure` → `AzureOpenAI` (AZURE*OPENAI*_ vars); `nvidia` → OpenAI-compatible
  with NVIDIA NIM defaults (NVIDIA*AI*_ vars); `groq` → Groq free tier (GROQ*AI*_ vars); `openai` → generic
  OpenAI-compatible (any other provider: OpenRouter, real OpenAI, local Ollama, …; AI\__ vars). Switch
  providers by editing `.env` only — no code changes.
- The client is built **lazily** via `getClient()`, not at import time: a missing key surfaces as a 500
  on `/api/generate` instead of crashing at boot, and it keeps the module importable by tests.
- The model is prompted for a single JSON object of `{ id, type, label }` nodes and `{ id, source,
target, label? }` edges, parsed by `extractJson`, then run through **`validateDesign`** — which coerces
  an unknown `type` to `service` with a warning, drops missing/duplicate ids, and drops edges pointing
  at nodes that were not declared. Forgiving by design: one bad field must never cost a whole generation.
- **Multiplayer** uses Yjs + y-websocket. The backend serves both HTTP and the Yjs WebSocket on port 3001.
  Room is the `?room=<id>` URL param — sharing the URL shares the room.

### Editing the canvas (why the AI must see the graph)

`POST /api/generate` takes `{ messages, graph }`, where `graph` is `serializeGraph()` output — the
documented "only thing an LLM ever sees of the graph". **The model must see the canvas or it cannot
edit it**, and an AI that cannot edit can only ever append. That was a real bug: "this is too
complicated, simplify it" made the diagram *bigger*, because the model designed blind and
`handleApplyDesign` emitted only `add_node`/`add_edge`.

- **The model returns the COMPLETE desired graph, not a patch.** Asking a model to emit correct ops
  against ids it cannot see is far more error-prone than asking it to describe the end state.
- **`diffToOps()` in `semantic-ops.ts` turns that into a minimal op list** — the deterministic half,
  so it lives in code. Omitted nodes become `remove_node`; changed content becomes `set_label`/
  `set_type` rather than remove+add, which would churn the node's position and make it jump. It skips
  a `remove_edge` for any edge a `remove_node` already sweeps, since that no-op would still bump the
  version counter.
- **The prompt renders the canvas with the SAME key names the model must output.** `serializeGraph`'s
  short keys (`t`/`l`/`f`/`to`) save tokens, but showing them while demanding `type`/`label`/`source`/
  `target` back made the model mirror the input: every `type` arrived `undefined` (silently coerced to
  `service`, so `auth` nodes became generic services) and every edge looked dangling and was dropped,
  leaving disconnected boxes. `validateDesign` now also accepts either spelling as defence in depth.
- The prompt must insist edges are re-stated too — they are deleted by omission exactly like nodes,
  and a model told only to think about nodes will silently return a graph with none.

### Delete-by-omission is load-bearing, and dangerous — the guards are not optional

Because omitted nodes are deleted, **any turn that returns an empty design is a canvas wipe.** The
canvas is shared live, there is no undo and no persistence, so these three guards are the difference
between an edit tool and an incident:

- **Only `action === "generate"` may reach `validateDesign`.** This was a real bug: a vetoed `ask`, an
  `ask` whose questions failed validation, or a typo'd action all fell through to `validateDesign`,
  which returns an empty design for an ask-shaped object, and shipped it as `applied: true` — removing
  every node in the room. The old comment defended the fall-through as "better than a dead end", which
  held only while the canvas was always empty. Anything that is not a generate now returns prose.
- **An empty generate against a populated canvas returns `applied: false`.** A truncated response and
  a deliberate "delete everything" are indistinguishable here, so the ambiguity resolves to the
  non-destructive reading.
- **`App.tsx` holds back a large removal for confirmation** (≥ 3 nodes *and* ≥ ⅓ of the canvas — both,
  so it neither nags on a 3-node diagram nor stays silent on a 30-node one). `handleApplyDesign`
  returns whether it actually wrote, so the "Canvas updated" pill cannot claim a change that is still
  pending. This is what makes one-click suggestion chips acceptable on a shared document.

### Conversation (talking is a first-class response)

`action` is `"reply" | "ask" | "generate"`. **`reply` exists because redrawing the canvas at someone
who asked a question is a non-answer** — without it every turn produced a diagram, which reads as a
vending machine rather than a collaborator. Use it for questions about the design, opinions,
trade-offs, thanks and small talk.

The response carries **`applied: boolean`**, and that — not an empty node list — is what tells the
client whether to touch the canvas. An empty list is ambiguous: "remove everything" is a legitimate
edit. `AiSidebar` shows the net change (`Canvas updated · 6 nodes (−5)`) so a removal is visible;
silently shrinking someone's canvas is alarming, saying "−5" is not.

A parse failure returns **200 with `applied: false`, never a 500**: the client turns a failed request
into an assistant message, which then lives in the transcript and is resent on every later turn — a
500 literally teaches the model to mirror its own failure.

### Being a partner, not a vending machine

Three things beyond answering, all in `buildSystemPrompt`:

- **`suggestions`** — up to `MAX_SUGGESTIONS` `{ label, rationale }` chips; clicking one sends its
  label verbatim as the next user turn (the same channel `ClarifyQuestions` uses, so the transcript
  stays plain text). The prompt picks them from five distinct rows — FORK / DEPTH / STRESS / SCOPE /
  CUT, never two from one row — because without a menu every suggestion comes from the same well of
  generic infra advice. `validateSuggestions` then drops boilerplate by matching a regex list against
  the **label**. It deliberately does **not** check that the label names an existing node: that was
  tried and removed, because FORK and SCOPE suggestions are by definition about things *not* on the
  canvas, and the check silently deleted "Restore the Reporting Service" and "Show the password reset
  flow". Genericness is a property of the verb, not of whether the noun is already drawn.
- **`tradeoff`** — its own field, not a clause inside `summary`. A required JSON field gets filled far
  more reliably than a constraint on prose, it is independently renderable, and keeping it out of
  `summary` keeps it out of the transcript, where a caveat would be resent every turn and start
  reading as an established requirement.
- **`CANVAS OBSERVATIONS`** (`apps/backend/src/lib/canvas-observations.ts`) — true facts computed from
  the graph (a datastore with two or more writers, an `external_api` on the request path with no queue,
  a queue with no worker, a node everything funnels through), using the `isDatastore`/`isIngress`
  predicates the node registry declares for exactly this purpose. This is the single highest-leverage
  piece: it turns "be insightful about this diagram" — which a mid-tier model answers with generic
  advice — into "read this fact and phrase it", which it does well. It is why the trade-off comes out
  as *"Payments Service calls Stripe inline, so a Stripe outage takes checkout down with it"* rather
  than *"this design has trade-offs"*. It returns nothing for a clean graph; silence beats padding.

### Requirement gathering (the AI asks instead of guessing)

A vague request ("create a login system") must produce a **question with pickable options**, not an
invented diagram. Six things make that hold, all load-bearing. Each one was arrived at by watching a
simpler version fail:

- **`/api/generate` takes a conversation, not a prompt.** The body is `{ messages: AiChatTurn[] }` —
  the frontend owns the transcript (`AiSidebar`'s local `messages` state) and posts the whole thing
  every call; the backend stays stateless. A lone prompt has nowhere to ask a question *into*.
  `readConversation()` still accepts a bare `{ prompt }` as a single-turn conversation. It also
  forces any non-`assistant` role to `user`, so a caller cannot forge assistant turns.
- **`thinking` is the FIRST field in the output JSON.** Generation is left-to-right, so a reasoning
  field emitted before `action` means the model actually reasons before committing to a decision.
  Moving or dropping it silently degrades the decision quality.
- **An explicit `action`, decided in a `STEP 2` block above the generation rules.** Returning empty
  `nodes`/`edges` as the only signal does NOT work — it is an implicit cue that loses to the model's
  prior to be helpful.
- **The decision must be a MECHANICAL test, not a judgement call.** Vague criteria ("two or more
  details missing", "when genuinely torn") get reasoned away every time. The prompt uses the
  **bare-category test**: does the message name any specific component, the data it holds, a scale
  figure, or an explicit constraint? None of those four → ask. This was tuned the hard way — an
  earlier draft leaned so far into anti-stalling ("generate is the DEFAULT", "never ask what you would
  guess") that "create a login system" started generating again, reintroducing the original complaint.
  Asking is for the opening move on an empty canvas; editing an existing diagram means generate,
  default anything open, and name the guess in `tradeoff`.
- **Never twice in a row, enforced in code.** `allowClarify = !readAskedLast(body)`. The signal cannot
  be computed server-side — the transcript is role + content only — so the client tags the assistant
  turn it rendered (`asked` on `AiChatTurn`, derived in `lib/ai-history.ts` from the questions actually
  shown). **An absent tag is presumed `true`**, so a stale bundle fails toward *less* asking rather
  than a question loop. `readConversation` rebuilds every turn from role + content, which is what stops
  that bookkeeping reaching the provider — there is a test pinning it, because a refactor to a spread
  would silently start sending it. Forgeability is a non-issue: the whole transcript is already
  client-supplied, and the worst a forged value buys is one extra question. When asking is disallowed
  the option is **absent from the prompt**, never merely discouraged.
- **Worked examples are the output distribution, not illustrations.** The prompt's single login
  example was being reproduced verbatim, options and all, whenever a login system was requested. It is
  now an unrelated domain (a warehouse stock tracker) explicitly labelled as showing *shape* rather
  than content, with a self-check line forbidding reuse of the prompt's own wording. After that change
  the model wrote its own questions per domain — asking a hospital system about patients-vs-staff and
  insurance integration. If parroting reappears, rotate the example.

`validateQuestions()` mirrors `validateDesign`'s forgiving contract: clamps to `MAX_QUESTIONS`/
`MAX_OPTIONS`, drops duplicate option labels (two identical buttons are unpickable) and drops any
question left with fewer than two options, since a question you cannot choose between is worse than
no question. Frontend rendering is `ClarifyQuestions.tsx` (checkboxes when `multiSelect`, radios
otherwise) and `ThinkingBlock.tsx` (collapsed by default). Picked options are folded into one plain
sentence — `"Sign-in methods: Email + password, Social login. Session strategy: JWTs"` — and sent as
an ordinary user turn, so the transcript stays readable and the model needs no separate answer channel.

## Testing

- `pnpm test` runs Vitest in all three packages (node environment, no jsdom). Frontend and backend set
  `passWithNoTests` so a package with no test files does not fail the suite.
- Tests live beside their subject as `src/**/*.test.ts`.
- `apps/frontend/src/lib/ws-e2e.test.ts` is an integration check against a **running backend on :3001**
  — it exercises the doc layout over the real y-websocket relay (two peers), which is the only way to
  catch a structure that syncs incorrectly between peers. It probes `/health` and **skips itself** when
  no backend is up, so `pnpm test` is green either way. Run `pnpm dev:backend` first to actually exercise it.
- The load-bearing assertions to preserve: a position write leaves `ops.length` unchanged; a label edit
  increments it by exactly 1; concurrent appends on two docs lose no increment; `serializeGraph` output
  contains no presentation key; dagre centres convert to exact top-left.

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
- **Backend `build` emits nothing — it is a type-check.** `apps/backend/tsconfig.json` sets `noEmit`
  and has no `outDir`, so `pnpm --filter @archforge/backend build` runs `tsc` purely for diagnostics
  and `turbo.json` overrides that task's `outputs` to `[]`. This is deliberate: `@archforge/shared` is
  consumed as raw TS from outside `src`, so any emit widens tsc's inferred root dir to the repo root
  and writes `dist/apps/backend/src/index.js` + `dist/packages/shared/src/*` — a layout `start`'s
  `node dist/index.js` cannot load, and one whose `require("@archforge/shared")` has no runtime
  resolver. Under emit the IDE also reports `TS6059 … not under 'rootDir'` on every shared import.
  Do not re-add `outDir`. If a compiled backend `dist/` is ever needed, bundle with `tsup`/`esbuild`
  (inlining shared) rather than adding a compile step to the shared package. The `start` script stays
  broken until that bundler exists; `pnpm dev` is the only run path.
