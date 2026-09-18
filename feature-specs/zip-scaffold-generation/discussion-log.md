# Discussion Log — Zip Scaffold Generation

Running notes from talking through the "Generate Scaffold" feature before locking anything into `plan.md`. Decisions move to `plan.md` once settled; this file is where things are still being chewed on, or are settled but worth remembering *why*. Updated as we keep talking.

---

## Settled so far

### 1. Stack choice can't come from the diagram — needs its own step
The canvas only ever encodes topology (node type + label + edges), never language/framework/ORM — that boundary is hard-baked into the rest of this app (the AI never sees more than topology either). So "Generate Scaffold" can't be a single silent click if we want real, running code in more than one language. Conclusion: add a **Stack Picker** step between clicking "Generate Scaffold" and actually getting the zip — a couple of dropdowns/radios, pre-filled with sensible defaults so someone who doesn't care can still just click through.

### 2. ~~Start with a small, curated matrix of stacks~~ → superseded: start with exactly ONE fixed stack
Originally proposed a small matrix (Node+Express+Prisma / Python+FastAPI+SQLAlchemy for backend, React+Vite / Next.js for frontend) with a Stack Picker step to choose between them. **Narrowed further**: v1 ships with exactly one fixed stack and no picker at all — **React + Vite + TypeScript** frontend, **Node.js + Express + Prisma + PostgreSQL** backend. "Generate Scaffold" is a true one-click action again. The multi-stack matrix idea isn't gone, just deferred — the template registry is still built so app-code templates (service/worker/auth/client) could become swappable per stack later without redesigning the infra-template half. See `plan.md`'s "Room to grow" section.

Important distinction that came out of fixing the stack: **fixing the stack pins the language the generated application code is written in — it does NOT reduce which infrastructure components get scaffolded.** If a diagram has Redis, Mongo, a queue, S3-style storage, whatever — all of that still has to show up correctly wired in the zip, regardless of the backend always being Node/Prisma. That's a separate guarantee from stack choice, and needed its own mechanism — see #6 below.

### 6. How we guarantee every component type that appears actually gets scaffolded (the "if Redis is on the canvas, Redis must be in the zip" guarantee)
Not best-effort — structural:
- The list of possible node types is closed and small (15 total, enforced elsewhere in the app already), so "cover everything" is a finite, checkable problem.
- The template lookup table is typed so that TypeScript **will not compile** unless all 15 types have an entry — not a checklist someone can forget, a build failure if something's missing.
- Generation always walks the nodes actually present in the submitted diagram and looks each one up — never a hardcoded subset of "the types we remembered to support."
- On top of the type-level guarantee, a real test builds a single-node diagram of each of the 15 types and checks the actual generated output (e.g. a Redis-only diagram's zip really contains a Redis service block) — catches a table entry that compiles but is broken or stubbed.
- Edge wiring (env vars, `depends_on`, producer/consumer stubs) is decided by one exhaustive rule set over "what kind of thing is the target," not a pile of type-by-type special cases, so a new type only needs to fit an existing bucket to wire correctly.
- Three types genuinely have no container to run (`client`, `cdn`, `external_api`) — "coverage" for these means a deliberate, correct README/env-var treatment, not a silently skipped type.

### 3. No code-style toggle (class-based vs functional) in v1
Each stack uses whichever style is the normal convention for that ecosystem. Exposing style as its own choice roughly doubles the number of templates to write and test — deferred until the stack matrix itself is proven out.

### 4. How generation actually works, mechanically
Not "AI writes code per click" — it's closer to a very organized copy/paste: every (node type × stack) combination has a real, pre-written, pre-tested code template sitting ready. Generating a scaffold walks the diagram node by node, matches each node to its template, and — this is the part that makes it feel like *your* diagram — uses the **edges** to auto-fill the wiring between nodes (connection strings, `depends_on` ordering, producer/consumer stubs). The templates are static per stack; the wiring is computed fresh from your specific diagram every time.

### 5. Two alternative generation mechanisms were considered and set aside (not forgotten)
- **Shelling out to official scaffolding CLIs** (`create-vite`, `create-next-app`, framework-native generators) at generation time instead of hand-written templates. Would give near-unlimited stack coverage with maintainer-grade base code, but needs network access at generation time, is slower/less predictable to test, and every generator's file layout is different — makes injecting wiring bespoke per generator instead of one uniform pass. Worth revisiting if the curated matrix proves too limiting.
- **LLM-written business logic** on top of a known-good skeleton. Most flexible, least guaranteed-correct — nothing in this pipeline compiles/runs the generated code to check it actually works. A possible future enrichment layer, not the core mechanism.

---

### 7. `auth` gets a real, working JWT example
Resolved: not a third-party provider integration (Auth0/Clerk/Supabase Auth) — a working JWT example is enough. A login endpoint that signs a token, a middleware that verifies it, a real `JWT_SECRET` placeholder. That's the bar for "production grade" on this specific node type for v1.

### 8. Repo hygiene: `.gitignore` in, `LICENSE`/CI not decided
`.gitignore` is confirmed in scope — every generated zip should be immediately safe to `git init`. A `LICENSE` file and a CI workflow were raised but not confirmed either way; treated as undecided rather than included, revisit if it comes up again.

### 9. Env/config maturity: one compose file + a README section, no separate prod config
One `docker-compose.yml` for local dev is enough. The gap toward production is covered by a "Going to production" section in the generated README (naming what's deliberately not handled — real secrets, TLS, managed datastores, scaling) rather than a second set of generated infra files.

### 10. No cap on diagram size
Scaffold whatever's actually on the canvas, however big. The AI-generation path already self-limits to ~30 nodes per diagram, so no separate ceiling is needed here.

### 11. Re-generation / incremental re-export is a real future need — but not v1
Confirmed: there will eventually be a need to re-export after the diagram changes and get an update that doesn't clobber code the user has since hand-edited. Explicitly deferred — v1 stays one-shot (generate from scratch every time). Flagged in `plan.md`'s "Room to grow" so it isn't forgotten, but needs its own design later (e.g. distinguishing purely-derived files like `docker-compose.yml` from files a user is expected to touch).

---

### 12. One project folder, two subfolders — not one folder per node
The first implementation gave every `service`/`worker`/`auth` node its own folder with its own `package.json`/`Dockerfile`/`tsconfig.json` — effectively one micro-repo per node. **That's wrong for what was asked.** Corrected shape: `<project-slug>/frontend/` (one React+Vite+TS app) and `<project-slug>/backend/` (one Node+Express+Prisma app), plus root-level `docker-compose.yml`/`README.md`/`.gitignore`. Concretely:
- Every `service`/`auth` node becomes a mounted Express router *inside* the one shared backend app (`backend/src/modules/<slug>/routes.ts`), not its own process.
- Every `worker` node gets its own entrypoint file in the same backend codebase (`backend/src/workers/<slug>.ts`) and its own `docker-compose` entry — same `build: ./backend`, different `command:` — because a background consumer genuinely needs to run as its own process, but it doesn't need its own repo to do that. Same pattern real systems use (Django+Celery, Rails+Sidekiq: one codebase, multiple process types).
- Infra config (postgres init scripts, nginx conf, prometheus config) nests under `backend/` too, so the root truly only has the two folders plus orchestration files.
- Env vars now live in one shared `backend/.env.example`, so every node's keys are namespaced by that node's own slug (`ORDERS_SERVICE_DATABASE_URL`, `AUTH_SERVICE_JWT_SECRET`) to avoid collisions between nodes sharing one file — this wasn't needed when every node had its own env file.
- Two known, documented (not silently papered over) limitations this introduces: Prisma supports one datasource, so only the *first* sql_db connection found project-wide gets a real schema — any additional database connections still get a namespaced env var but no ORM binding, called out in the generated README. Similarly only the first `client` node gets a `frontend/` folder if a diagram somehow has more than one.

### 13. Repo topology (monorepo vs individual repos) and deployment topology (monolith vs microservice) — future, selectable, not v1
Confirmed as a real future need: some projects will want the microservice shape (what v1 mistakenly always did) or a fully separate-repos shape, not just the monolith-style single frontend/backend this settled on. For v1, only the monolith-style two-folder output ships. The future version of this is a **repo/deployment topology choice** (e.g. "monolith" vs "microservice" vs "one repo per service"), analogous to the deferred stack-choice picker — same pattern: a small, explicit choice made once, not inferred, not left open-ended. Not designed in detail yet; revisit alongside the second-stack work in `plan.md`'s "Room to grow."

### 14. Static templates own structure/wiring; AI is a future enrichment layer on top, never the generation mechanism itself
Directly asked and settled: should the templates be hand-maintained in the codebase, or generated by AI? Hand-maintained, deterministic templates own everything that must be guaranteed correct — folder structure, `docker-compose.yml`, dependency graph, env wiring, package.json/Dockerfile content. This is exactly what made the "actually run `docker compose config` and `tsc --noEmit` on the output" verification meaningful — an LLM-generated skeleton has no such guarantee anywhere in this pipeline. The already-planned future LLM-enrichment pass (see `plan.md` "Room to grow") is where project-specific intelligence belongs: real Prisma models instead of the generic `Example` stub, real route handlers instead of a health-check-only stub — built **on top of** the guaranteed-valid skeleton, never replacing it. Worst case the AI's fill-in is mediocre; the skeleton underneath still boots either way.

---

## Open scenarios — still need a decision

Nothing outstanding right now — every scenario raised so far has a decision recorded above. Add new ones here as they come up; settled items graduate into `plan.md`.
