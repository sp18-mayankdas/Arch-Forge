# Generate Scaffold — ZIP export of a runnable project skeleton

**Status: implemented and verified for v1.** `packages/shared/src/scaffold.ts`, `apps/backend/src/routes/scaffold.ts`, and the "Generate Scaffold" button in `CanvasPage.tsx` are live. This doc reflects what's actually built, not just what was planned — see `discussion-log.md` for the reasoning trail, including a real structural correction made mid-implementation (see "Project shape" below).

## Context

ArchForge's product docs (`docs/archforge-prd.md` §4.6, `docs/archforge-blueprint.md` §3.2) describe a "Scaffold Engine": one click turns the drawn architecture diagram into a downloadable ZIP of a runnable project skeleton whose structure mirrors the canvas. This feature did not exist in the codebase before this work — only a reserved `templateKey` field per node type in `packages/shared/src/node-types.ts`.

### Scope: exactly one fixed stack

v1 supports exactly one frontend stack and one backend stack, fixed, no picker:
- **Frontend**: React + Vite + TypeScript.
- **Backend**: Node.js + Express + Prisma + PostgreSQL.

"Generate Scaffold" is a true one-click action. A multi-stack matrix was explored and deliberately deferred — see "Room to grow."

### Project shape — one frontend/, one backend/, never one folder per node

An early pass at this implementation gave every `service`/`worker`/`auth` node its own folder with its own `package.json`/`Dockerfile`/`tsconfig.json` — effectively a micro-repo per node. **That was corrected.** The shipped shape is:

```
<project>/
  docker-compose.yml
  README.md
  .gitignore
  frontend/            # one React + Vite + TS app (the first client node, if any)
  backend/              # one Node + Express + Prisma app
    package.json
    tsconfig.json
    Dockerfile
    .env.example
    prisma/schema.prisma        # only if some node connects to a sql_db
    src/
      index.ts                  # mounts one router per service/auth node
      prisma.ts                 # shared PrismaClient singleton, if needed
      modules/<slug>/routes.ts  # one per service/auth node
      workers/<slug>.ts         # one per worker node
    db/<slug>/...                # postgres/mongo/minio/elasticsearch init config
    nginx/<slug>.conf
    observability/prometheus.yml
```

- Every `service`/`auth` node becomes a **mounted Express router inside the one shared backend app** — not its own process.
- Every `worker` node gets **its own entrypoint file in the same backend codebase**, and its own `docker-compose` entry (`build: ./backend`, a different `command:`) — a background consumer genuinely needs its own process, but not its own repo. Same pattern real systems use (Django+Celery, Rails+Sidekiq: one codebase, multiple process types).
- Infra config (postgres init scripts, nginx conf, prometheus config) nests under `backend/`, so the project root really only has the two folders plus the three orchestration files.
- Because multiple nodes' env vars now share **one** `backend/.env.example`, every key is namespaced by its owning node's own slug (`ORDERS_SERVICE_DATABASE_URL`, `AUTH_SERVICE_JWT_SECRET`, `ORDER_WORKER_QUEUE_URL`) — this wasn't needed when every node had its own env file.
- Two limitations this introduces are surfaced in the generated README, not silently papered over: Prisma has one datasource, so only the *first* sql_db connection found (scanning in canvas order) gets a real schema/client — any other database connection still gets its namespaced env var but no ORM binding. Similarly, only the *first* `client` node becomes `frontend/` if a diagram somehow has more than one.

### Future scope: repo/deployment topology as a selectable choice

Confirmed as a real future need, not v1: some projects will want the microservice shape (one repo per node — what the early draft accidentally always produced) or fully separate repos, not just this monolith-style two-folder output. The future version is a **repo/deployment topology choice** (monolith vs. microservice vs. one-repo-per-service), the same pattern as the deferred stack picker: a small, explicit choice made once, never inferred. Not designed in detail yet.

### Static templates vs. AI: where each belongs

Directly discussed and settled: hand-maintained, deterministic templates own everything that must be guaranteed correct — folder structure, `docker-compose.yml`, the dependency graph, env wiring, package.json/Dockerfile content. This is what makes "actually run `docker compose config` and `tsc --noEmit` on the output and see it pass" a meaningful verification step — nothing here is AI-generated, so there's no chance of an unverified skeleton. The previously-planned future LLM-enrichment pass (see "Room to grow") is where project-specific intelligence belongs — real Prisma models instead of the generic `Example` stub, real route handlers instead of a health-check-only stub — strictly **on top of** the guaranteed-valid skeleton, never replacing it.

## Completeness guarantee — every component type that appears gets scaffolded

1. `NODE_TYPES` is a fixed 15-entry enum (`isNodeType()` guards it everywhere) — a finite, enumerable problem.
2. `NODE_TYPE_COVERAGE: Record<NodeType, "client" | "backend-app" | "infra">` in `scaffold.ts` is typed against the full enum — TypeScript refuses to compile if a type is ever added without being routed to one of the three handling paths (the client branch, the shared backend app, or `INFRA_TEMPLATES`).
3. A test (`node type coverage stays consistent...`) cross-checks that every type marked `"infra"` actually has an `INFRA_TEMPLATES` entry and no other type does — catching a mismatch the type system alone can't (e.g. a type marked infra whose template was never added).
4. Generation always walks the nodes actually present in the submitted diagram — never a hardcoded subset.
5. A table-driven test builds a single-node diagram for each of the 15 types and asserts real output, not just "some file exists."
6. Edge wiring runs through one exhaustive rule set over "what kind of thing is the target," not type-by-type special cases.
7. `client`/`cdn`/`external_api` get an explicit no-container treatment (README note, and for `external_api`, real env-var wiring into callers) — coverage means "an intentional, correct answer," not "everything becomes a container."

## Per-type behavior

| type | where it lands | container | notes |
|---|---|---|---|
| `client` | `frontend/` (first client node only) | none — run separately, not in compose | API base URL baked in from its outbound edge (gateway → `:8080`, direct router node → `:4000/<slug>`) |
| `cdn` | — | none | README note only |
| `load_balancer` / `api_gateway` | `backend/nginx/<slug>.conf` | `nginx:alpine`, published `8080:80` | routes to `backend:4000/<router-slug>/` for every router-type node it points at |
| `service` / `auth` | `backend/src/modules/<slug>/routes.ts`, mounted in `backend/src/index.ts` | shared `backend` container | `auth` adds a real JWT login/verify example (see below) |
| `worker` | `backend/src/workers/<slug>.ts` | own compose entry, `build: ./backend`, own `command:` | consumer/producer stubs reference the correctly namespaced `QUEUE_URL` env key |
| `queue` | — | `rabbitmq:3-management` | |
| `cache` | — | `redis:7-alpine` | |
| `sql_db` | `backend/db/<slug>/init.sql` | `postgres:16-alpine` | first one project-wide gets `backend/prisma/schema.prisma` |
| `nosql_db` | `backend/db/<slug>/init-mongo.js` | `mongo:7` | |
| `object_store` | `backend/db/<slug>/create-bucket.sh` | `minio/minio` | |
| `search_index` | `backend/db/<slug>/mapping.json` | `elasticsearch:8.15.0` | |
| `external_api` | — | none | still wires `_BASE_URL`/`_API_KEY` into any calling router/worker |
| `observability` | `backend/observability/prometheus.yml` | `prom/prometheus`, published `9090:9090` | scrapes the shared `backend:4000` |

`auth` gets a **real, working JWT example**: a `/login` endpoint that signs a token, `requireAuth` middleware that verifies it, a `/me` endpoint behind that middleware. `JWT_SECRET` is a namespaced dev-only placeholder in `.env.example`. A real third-party provider (Auth0/Clerk/etc.) is out of scope.

## Edge-driven wiring (per edge `source → target`)

- `target.type` is `client`/`cdn` → skip.
- `target.type === "external_api"` → source gets namespaced `_BASE_URL`/`_API_KEY`, no `depends_on`.
- `target.type === "queue"` → source gets a namespaced `QUEUE_URL`, `depends_on`, and a producer stub in its router file that reads that exact env key.
- `source.type === "queue"` → mirrors onto the consumer (worker or router), same env-key discipline.
- `target.type === "worker"` → skipped. Workers have no HTTP surface; they're only reachable via a queue (handled above).
- Target `isDatastore` → source gets a namespaced connection env var (`DATABASE_URL`/`REDIS_URL`/`S3_ENDPOINT`+`S3_BUCKET`/`ELASTICSEARCH_URL`) + `depends_on`. For `sql_db`, the source's router module also gets access to the shared `backend/src/prisma.ts` client if it's the project-wide primary DB connection.
- `target.type` is `service`/`auth` (a router-type target) → **same container as the source**, so wiring is a path-based URL (`http://backend:4000/<target-slug>`), no `depends_on` — they start together.
- Otherwise (gateway/observability as a direct target) → namespaced `_URL` + `depends_on`.

Every env key is `${envPrefix(sourceSlug)}_<BASE_KEY>`, with a second-level disambiguator appended only if the *same* node would otherwise get two colliding keys (e.g. two different sql_db connections from one node). Producer/consumer code always reads back the *exact* key that was actually injected (tracked alongside the queue reference, not assumed) — this was a real bug caught by actually running `tsc` on generated output (see "What actual verification caught," below).

## Files

- **`packages/shared/src/scaffold.ts`** — manifest/wiring engine, `INFRA_TEMPLATES`, the shared-backend-app assembler, the client-app builder, compose/README/gitignore rendering. `packages/shared/src/index.ts` re-exports it.
- **`packages/shared/src/scaffold.test.ts`** — 45 tests: the 15-type completeness matrix, the infra/backend-app coverage cross-check, slug collisions, every wiring rule (including the namespaced-env-key regression test), the two documented limitations, the auth JWT example.
- **`apps/backend/src/routes/scaffold.ts`** — `POST /api/scaffold`; mounted in `apps/backend/src/index.ts`. Added `jszip` to `apps/backend/package.json`.
- **`apps/backend/src/routes/scaffold.test.ts`** — 6 tests, real HTTP server + real zip round-trip via `jszip`, following `usage.test.ts`'s pattern.
- **`apps/frontend/src/lib/download-blob.ts`** — `downloadBlob(blob, filename)`.
- **`apps/frontend/src/lib/api.ts`** — `generateScaffold(graph, projectName?)`.
- **`apps/frontend/src/pages/CanvasPage.tsx`** — "Generate Scaffold" button between "Share" and "ArchForge," one click, no dialog.

## `POST /api/scaffold` contract

Request: `{ nodes: SemanticNode[]; edges: SemanticEdge[]; projectName?: string }`.
- `nodes` not an array → 400.
- Unknown node `type` → coerced to `"service"`.
- Dangling edge → dropped.
- Empty graph → 200, minimal valid zip (not 400).
- One bad node's template → skipped, doesn't fail the whole export.
- Unexpected failure → 500.

Response: `Content-Type: application/zip`, `Content-Disposition: attachment; filename="<slug>.zip"`, raw `Buffer` from `generateAsync({ type: "nodebuffer" })`.

## What actual verification caught (not just unit tests)

Per-file unit tests passed on the first implementation attempt both times (initial per-node design, then the corrected two-folder design) — but real bugs only surfaced by actually running the generated output:
1. The auth router referenced `express.Request`/`express.Response` types without importing the `express` default binding (only `{ Router }` was imported) — caught by `tsc --noEmit` on the generated `backend/`, not by any unit test.
2. Producer/consumer queue code hardcoded `process.env.QUEUE_URL`, while the actual injected env var is namespaced per node (e.g. `ORDER_WORKER_QUEUE_URL`) — also only visible by generating a real project and grepping it, not from assertions about *whether* a key existed.

Both are fixed and now have regression tests. The lesson generalizes: file-content assertions prove structure; only actually installing and compiling the output proves it runs.

## Verification (all passing)

1. `pnpm --filter @archforge/shared test` (45 tests), `pnpm --filter @archforge/backend test` (89 tests, incl. 6 for `/api/scaffold`) — green.
2. `pnpm type-check` / `pnpm lint` clean across all three packages (only pre-existing, unrelated warnings remain).
3. Generated a real zip covering all 15 node types wired together, unzipped it, and:
   - `docker compose config` on the root `docker-compose.yml` — valid (exit 0).
   - `npm install && npx tsc --noEmit` inside the generated `backend/` — clean.
   - `npm install && npx tsc --noEmit` inside the generated `frontend/` — clean.

## Room to grow (deferred, not designed away)

- **Repo/deployment topology choice** (monolith vs. microservice vs. one-repo-per-service) — see "Future scope" above.
- **A second stack** (Python/FastAPI backend, Next.js frontend) — the registry is structured so app-code templates could become swappable per stack later without touching the infra half.
- **AI enrichment pass on top of the guaranteed-valid skeleton** — real Prisma models and route logic instead of generic stubs, once the deterministic skeleton is stable. Never the generation mechanism itself.
- **Re-generation / incremental re-export** — v1 is one-shot; a future version needs to distinguish purely-derived files from ones a user is expected to have hand-edited.
- **Template maintenance over time** — no scheduled rebuild/verification job yet for keeping the fixed stack's dependency versions current.
- **Repo hygiene beyond `.gitignore`** — `LICENSE`, a CI workflow — raised, not confirmed.
