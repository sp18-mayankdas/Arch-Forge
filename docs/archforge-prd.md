# ArchForge — Product Requirements Document

*A shared, live canvas for designing software systems, with an AI teammate ("Ghost") that draws, reviews, stress-tests, and scaffolds alongside you.*

**Document type:** Internal PRD for a 3-person innovation-sprint squad. Audience: two frontend engineers (squadmates) plus the originator. Purpose: make the whole squad completely understand what we are building, how each part works, and why it is designed this way — ahead of an internal Brown Bag Session demo. This is a shared understanding document, not an approval gate. Everything below reflects decisions already made in prior technical discussions; the tech stack and architecture are presented as the agreed "proposed" plan and treated as the source of truth.

---

## TL;DR

- **What it is:** A Figma/Miro-style multiplayer canvas built specifically for software architecture. Teammates drag typed nodes (services, databases, caches, queues, gateways, etc.) and connect them, with live cursors — and an AI agent called **Ghost** sits inside the same room as just another peer, with its own visible animated cursor.
- **What Ghost does:** (1) draws a full architecture from a plain-English prompt, node-by-node, live; (2) watches the canvas and drops "suggestion cards" when it spots design flaws, using a hybrid of instant deterministic lint rules plus occasional deeper LLM critique; (3) runs a client-side load simulation so you can drag a requests-per-second slider and watch bottlenecks glow red; (4) exports a one-click ZIP of real project scaffolding (docker-compose, service folders, wiring) that mirrors the drawn diagram.
- **Why it matters:** No shipping product today unifies these four things behind an AI that behaves like a visible collaborator. A successful MVP is simply the end-to-end demo path working reliably in the Brown Bag room.

---

## 1. Problem Statement & Solution Approach

### The friction we're attacking

Team-based architecture planning is broken in small, familiar ways that add up:

- **Whiteboards die after the meeting.** A team huddles, sketches boxes and arrows on a physical or virtual whiteboard, has a great discussion — and then the artifact is a photo in someone's phone that nobody opens again.
- **Diagrams rot in Confluence/draw.io.** Even when a diagram is "saved," it drifts out of date the moment code changes. It becomes decoration, not a source of truth.
- **Design reviews are slow and asynchronous.** Someone posts a diagram, waits a day for comments, revises, waits again. Feedback loops are measured in days.
- **Flaws are found late.** A missing cache, a service talking straight to a database, an unauthenticated entry point, a single point of failure — these often surface in code review or, worse, in production, when they are expensive to fix.
- **Static diagrams can't answer "what happens under load?"** A picture of boxes tells you nothing about where the system falls over when traffic spikes.
- **Turning a finished diagram into a project skeleton is manual toil.** After agreeing on a design, someone hand-writes the docker-compose file, the folder structure, the env wiring — re-encoding by hand a structure that was already fully described by the diagram.

### How ArchForge addresses it, simply

ArchForge keeps the good part of whiteboarding (fast, visual, collaborative) and removes the decay. Because the canvas understands *what each box actually is* (a database, a cache, a queue), it can do things a dumb drawing tool cannot:

- It stays **live and multiplayer**, so the "meeting" and the "artifact" are the same object.
- Ghost **draws for you** from a sentence, so you get to a first draft in seconds.
- Ghost **reviews continuously**, so flaws are caught while you design, not in production.
- The canvas **simulates load**, so "what happens under load?" gets a visual answer immediately.
- The canvas **exports scaffolding**, so the agreed design becomes runnable code with one click.

The core design bet: because the canvas holds a real, typed model of the system (not just shapes), the same model can power drawing, review, simulation, and code generation. One shared vocabulary, four payoffs.

---

## 2. Product Goals & Core Value Proposition

### What a successful MVP looks like (honest, internal-demo definition)

This is an innovation-sprint prototype headed for a Brown Bag Session, not a launch. Success is **one demo path that works reliably in front of the room**:

1. Two people join a room and see each other's live cursors.
2. One asks Ghost to design an e-commerce backend; Ghost draws it live with its own cursor.
3. Someone edits the diagram to introduce a flaw; a suggestion card appears near-instantly.
4. They drag the load slider; a bottleneck node glows red.
5. They apply Ghost's fix; the red drains away.
6. They click Generate Scaffold and open the downloaded `docker-compose.yml`, and it matches what's on screen.

If that sequence runs smoothly and legibly, the MVP is a success. Everything else is a nice-to-have.

### Primary user value

**Go from "a sentence" to "a reviewed, stress-tested architecture and a runnable project skeleton" in one shared room, in minutes.** The single most important value is compression of the whole early-design loop — draft, critique, validate, scaffold — into one continuous, visual, collaborative flow.

### Where this sits versus what already exists

We researched the landscape honestly. The individual ingredients exist in isolation:

- **Text-to-diagram** is mature and crowded: Eraser's DiagramGPT (which "leverages OpenAI's GPT-4 to classify user input and generate diagrams in a diagram-as-code format" and has "processed 1,108,389+ requests"), Miro AI, FigJam AI, Lucidchart AI, and Excalidraw's text-to-diagram all turn a prompt into a diagram. Nearly all are **one-shot or copilot-style** — Eraser explicitly bills itself "AI assisted, not AI only" — meaning the AI produces a diagram; it is not a visible peer with a cursor.
- **Diagram-to-infrastructure-code** is established: Brainboard and similar tools generate Terraform from a cloud diagram; AWS Infrastructure Composer (formerly Application Composer) can "automatically generate ready-to-deploy, fully configured infrastructure as code (IaC) AWS CloudFormation templates," expanded in September 2023 to cover "all 1000+ resources supported by AWS CloudFormation."
- **AI agents that incrementally draw/edit a canvas** exist mainly as **tldraw SDK starter kits and public experiments**, not as a shipping software-design product.
- **Live, canvas-native architecture flaw detection** (SPOFs, client-hits-DB, missing cache) is essentially absent from mainstream shipping diagram tools; it exists only as batch review agents and prompt frameworks.
- **Load/stress simulation visualized on the diagram** has, as far as we can find, **no shipping precedent** at all.

Honest framing for the squad: *we are not inventing text-to-diagram or diagram-to-code.* What no shipping product does is unify them behind an AI that participates as a visible peer collaborator with its own cursor, catches flaws live as it draws, and simulates load on the diagram — that last one being the most genuinely novel piece. The novelty is the **combination and the peer model**, not any single feature.

---

## 3. Target Audience

Kept deliberately thin and honest — this is an internal prototype, so "audience" means "who we picture using it," not a market segmentation.

| User | What they want | How they use ArchForge |
|---|---|---|
| **Backend / full-stack developers** | Get from idea to a running skeleton fast; sanity-check a design before writing code. | Prompt Ghost for a first draft, tweak nodes, run the load slider, export scaffolding to start coding. |
| **Frontend developers (our squad)** | Understand the system they plug into; participate in design without deep infra expertise. | Join a room, watch Ghost draw, read suggestion cards to learn *why* a cache or gateway belongs there. |
| **Tech leads** | Run fast, live design reviews; catch flaws early; align the team. | Co-edit in real time, use Ghost's critique as a second reviewer, use load sim to make trade-offs visible in the meeting. |
| **System architects** | Explore designs and communicate them clearly. | Rapidly draft and compare topologies; use scaffolding export as a concrete handoff. |

The common thread: everyone works in the *same live room*, and Ghost lowers the expertise floor so non-infra people can contribute meaningfully.

---

## 4. Detailed Feature Walkthrough & High-Level Logic

This is the heart of the document. Each feature is explained in plain language: what it does, then how it works under the hood, and why it's built that way.

### 4.0 The foundation: two layers of state (read this first)

Everything Ghost does rests on one key idea: **the canvas keeps two separate layers of state.**

- **The SEMANTIC layer** — the *meaning* of the diagram. Nodes (each with an `id`, a `type` from a closed list of about 15 types, a `label`, and small properties like replica count), and edges (each with `from`, `to`, and a `kind`). Plus a monotonic **version counter** that ticks up on every meaningful change. This layer answers "what is this system?"
- **The PRESENTATION layer** — the *look* of the diagram. X/Y coordinates, node sizes, what's selected, what's being dragged. This layer answers "where is everything on screen?"

**These are strictly separated, and the split is the single most important design decision in the product.** Two consequences follow:

1. **The LLM only ever sees the semantic layer.** Coordinates never go to the model. When Ghost draws, the client computes positions itself (see 4.3). This keeps prompts tiny and keeps the AI reasoning about architecture, not pixels.
2. **The closed node-type enum is one shared vocabulary consumed by four subsystems** — the renderer (draws each type), the lint engine (pattern-matches on types), the load simulator (looks up each type's capacity/latency), and the scaffold engine (maps each type to a code template). Define a type once; four features understand it.

### 4.1 Real-Time Tracing & Change Tracking

**What it does:** Multiple people (and Ghost) edit the same canvas at once. Everyone sees everyone else's nodes, edges, and cursors live. Crucially, the system *knows* which changes are meaningful (a new database) versus cosmetic (someone nudged a box two pixels).

**How it works:**

- The shared document is a **Yjs CRDT** (Conflict-free Replicated Data Type), synced over **y-websocket** through a small self-hosted Node server. CRDTs let many people edit simultaneously and merge cleanly without a central lock — the same class of technology behind modern multiplayer editors.
- Nodes and edges live in **Yjs keyed maps** (a nodes map and an edges map, each keyed by ID). Because every change flows *through* these maps, a semantic operation is recorded **at write time** — the moment someone adds a node, an "add node" event exists. There is **no diffing step**; we never compare two snapshots to figure out what changed.
- **Live cursors use the Yjs awareness protocol**, which is a separate, ephemeral channel for presence (who's here, where's their cursor). Awareness data is deliberately *not* saved into the document — it's transient by design. If someone disconnects, their cursor simply vanishes; nothing to clean up. (This mirrors how React Flow's own multiplayer guidance treats cursors and selection as "ephemeral" awareness state, kept out of the shared document.)
- The semantic/presentation split shows up here directly: **position drags are presentation-only and generate zero AI-relevant events.** Moving a box around produces awareness/coordinate updates but nothing the trigger engine or LLM ever hears about.

**Why it's built this way:** Recording ops at write time (instead of diffing) means the semantic op log is free and always accurate. Keeping cursors in awareness (instead of the document) keeps the saved model clean and small. And ignoring drags at the source is the first line of defense in keeping Ghost from over-reacting.

### 4.2 Ghost as a Peer (the central architectural idea)

**What it does:** Ghost isn't a chatbot in a sidebar bolted onto the app. Ghost **joins the collaboration room as just another sync client** — a peer. It has its own visible, animated cursor and its own presence, exactly like a human collaborator.

**How it works:** Ghost connects to the same Yjs room as everyone else. When it places a node, it uses the exact same mechanics a human does: move the awareness cursor, then write to the nodes map. Its edits propagate through the same CRDT sync as everyone else's, so conflicts resolve naturally — if a human and Ghost touch the canvas at the same time, Yjs merges both without special coordination.

**Why it's built this way:** This "AI as a CRDT peer" pattern was demonstrated publicly in ElectricSQL's April 8, 2026 write-up *"AI agents as CRDT peers — building collaborative AI with Yjs,"* whose agent "Electra" behaves exactly as we intend: *"From the human user's perspective, Electra looks like any other collaborator: A visible cursor that moves through the document as the agent works; Presence in the awareness bar, with status indicators: thinking, composing, idle; Edits that appear in real-time through the same CRDT sync as everyone else's changes."* Adopting this model gives us three things nearly for free: (1) Ghost's drawing *looks* alive and human, which is the demo's wow factor; (2) we reuse one sync path instead of building a second one for the AI; (3) conflict handling between Ghost and humans is handled by the CRDT, not by us.

### 4.3 Ghost Draws (streaming + animation queue)

**What it does:** A user types "design an e-commerce backend with a product catalog, user accounts, and checkout." Ghost draws the whole architecture, node by node, with its cursor visibly gliding to each spot and dropping a node, then connecting edges — in real time.

**How it works (this is the clever part):**

1. The LLM (Anthropic Claude, streaming) is asked to emit an **ordered list of operations in a terse, line-based format — one operation per line** (resembling Mermaid; roughly 8–12 tokens per node). Not verbose JSON. Example lines: `add svc api "API Gateway"`, `add db pg "Postgres"`, `edge api pg`.
2. As tokens stream in, the client **parses complete lines off the stream** — the moment a full line arrives, it's a complete instruction. It doesn't wait for the whole response.
3. Each parsed op goes onto an **animation queue.**
4. A separate animation loop pulls ops off the queue one at a time. For each new node, the client **computes its position itself using auto-layout (dagre)** — the LLM never sends coordinates. Then it **animates Ghost's cursor to that position** and places the node.

**Why it's built this way:** This **decouples LLM latency from perceived animation smoothness.** The model might stream in bursts or stall for a moment; the animation queue drains at its own steady pace, so Ghost's drawing always looks smooth and deliberate regardless of network jitter. The terse format keeps token cost and latency low — a line-based, Mermaid-like serialization can cost a small fraction of the tokens that equivalent JSON/XML would (community measurements put verbose formats at up to an order of magnitude more tokens than compact ones). And computing layout client-side (dagre converts a directed graph into a clean top-to-bottom or left-to-right arrangement) means the AI focuses purely on *what connects to what*, while the client owns *where things sit* — a direct payoff of the semantic/presentation split.

*Implementation note:* dagre returns node **center** coordinates while React Flow positions from the **top-left** corner, so the client subtracts half the node width/height when placing each node — a small but easy-to-miss gotcha the whole squad should know.

### 4.4 ArchForge Interventions (proactive flaw detection)

**What it does:** As the diagram evolves, Ghost drops **suggestion cards** onto the canvas when it spots architectural problems — e.g., "This client talks directly to Postgres; consider an API layer," or "Your hot read path has no cache." It should feel like a sharp reviewer looking over your shoulder — but one that never nags.

**How it works — a hybrid, two-layer system:**

**Layer 0 — Deterministic client-side lint rules (free, instant, always reliable).**
These are pure graph pattern-matching in the browser. **Zero AI tokens, no network call, fires instantly and deterministically.** They catch well-known, unambiguous flaws:
- Client hitting a database directly.
- Missing cache on a hot read path.
- Unauthenticated ingress (an entry point with no auth in front).
- Single point of failure — detected as an **articulation point** in the graph (a node whose removal disconnects the system). This is a standard graph algorithm (a DFS-based articulation-point / cut-vertex check) that runs in **O(V+E)**; articulation points are the textbook way to identify single points of failure in a network.
- Deep synchronous service chains with no queue to absorb bursts.

**Layer 2 — LLM holistic critique (occasional, deeper, judgment-based).**
For subtler, context-dependent feedback, Ghost asks Claude for a holistic review. But this call is expensive and slow relative to lint, so it is **gated by a trigger engine** that only fires at "settle points." The gates, in order:
- **Only semantic changes count.** Position drags are ignored entirely (see 4.1).
- **3-second settle debounce.** Ghost waits until you've stopped editing for 3 seconds — it critiques a resting diagram, not a moving one.
- **Materiality threshold.** A trivial change isn't worth a call; it waits for roughly 2–3+ semantic ops to accumulate.
- **Semantic-hash short-circuit.** If the graph's topology is unchanged (same shape, computed as a hash of the semantic structure), no call is made — even if things moved.
- **Cooldown periods and finding-deduplication.** Ghost won't re-raise a flaw it already raised, and won't fire repeatedly in a short window.

**Both card types render identically to the user.** A lint card and an LLM card look the same on the canvas; the user doesn't need to know or care which layer produced it.

**The token/cost strategy behind Layer 2 (in order of leverage):**
1. **Don't call the model.** Lint rules are free — they handle everything they can.
2. **Call it rarely.** The trigger gates above ensure the LLM only runs at genuine settle points.
3. **Call it cheaply.** Use **Anthropic prompt caching** with a **stable prefix** (system prompt + node-type vocabulary + a full graph checkpoint), plus an **append-only event log of semantic ops**, with periodic re-checkpointing. Anthropic's cache works on an exact-match prefix and makes cache **reads roughly 90% cheaper than normal input tokens** (cache **writes** cost a bit more), so keeping the prefix byte-stable across calls is what makes repeated critique affordable.
4. **Send less.** Compact terse serialization (~8–12 tokens/node) instead of verbose JSON, and **semantic delta ops (5–15 tokens each)** instead of resending the whole graph.

A **version counter** guards against model-view drift: if Claude's response references a node ID that no longer exists, we **discard that response and send a fresh checkpoint** before continuing.

**Why it's built this way:** The hybrid is about **trust and cost**. Lint rules give instant, 100%-reliable coverage of known problems for free — they'll always fire in the demo. The LLM adds judgment for the fuzzy stuff, but only when it's genuinely worth it. The trigger gates exist so Ghost feels like a thoughtful colleague rather than an annoying linter that interrupts every keystroke. "Never nag" is a product requirement, and the gates are how we enforce it.

### 4.5 Load Simulation

**What it does:** A slider sets incoming **requests per second**. Load flows through the diagram; each node colors **green / amber / red** by how utilized it is; bottlenecks glow red. Add a cache in front of a hammered database and watch the red drain out of it in real time.

**How it works:**
- Each node type has a **capacity and a latency** from a static lookup table (keyed by the shared node-type enum). This is a teaching model, not measured performance.
- Load **propagates through the graph client-side**: it enters at the client/ingress nodes and flows along edges. **Caches absorb a hit-ratio percentage and pass only the misses downstream** (e.g., a cache with an 80% hit ratio passes 20% of read load to the database behind it). **Load splits across outbound edges** when a node fans out.
- Each node's utilization = incoming load ÷ its capacity. That ratio drives the color. Near or above capacity → red.
- The whole computation is **O(V+E)** — a single pass over nodes and edges — so it **recomputes live on every slider tick**, with **no backend compute at all.**

**Why it's built this way:** It's a **visualization and teaching tool, not a benchmark** — and we say so plainly. The point is to make an abstract idea *visible and interactive* in a meeting. The color thresholds deliberately echo the real-world rule of thumb from queueing theory: per One2N's queueing guide for reliability engineers, *"running any system consistently above 70-75% utilization significantly increases the risk of spiking the latency"* — illustrated as latency staying near 50 ms at 70% utilization but climbing to ~500 ms at 90%. That non-linear "knee" is exactly the intuition the red glow is meant to teach. Doing it fully client-side in one graph pass keeps it instant and free, which is what makes the slider feel alive.

### 4.6 Scaffold Engine

**What it does:** One click exports a **ZIP of the entire project scaffold** — a real, runnable skeleton whose structure mirrors the diagram. Open the `docker-compose.yml` inside and you see the system you drew.

**How it works — a clean pipeline:**
1. **Walk the semantic graph** → visit every node and edge.
2. **Build a manifest** → an intermediate description of what needs to be generated.
3. **Template registry keyed by node type** → each type contributes files:
   - `postgres` → a `docker-compose` service block + an init SQL file.
   - `service` → a folder with a minimal Express/Fastify `index.ts`, a `Dockerfile`, and `.env.example`.
   - `redis` / `queue` → their own `docker-compose` blocks.
   - `api gateway` → an `nginx.conf` routing to whatever its outbound edges point at.
4. **Edges drive the wiring:**
   - A `service → db` edge injects a `DATABASE_URL` env var and a `depends_on`.
   - A `service → queue` edge injects producer/consumer stubs.
5. **JSZip** assembles the files and **file-saver** triggers the download. **Entirely in-browser** — no server round trip. (JSZip's `generateAsync({ type: "blob" })` produces the archive in memory; file-saver's `saveAs` hands it to the browser's download.)

**The generated `docker-compose.yml` topologically mirrors the drawn canvas** — same services, same connections.

**Why it's built this way:** The diagram already contains everything needed to wire a project — types tell you *what services exist*, edges tell you *how they connect*. Re-typing that by hand is exactly the "manual toil" from the problem statement. Keying templates to the shared node-type enum (again, one vocabulary) means adding a new node type automatically teaches the scaffold engine about it. Doing it in-browser with JSZip keeps the whole product client-heavy and backend-light.

---

## 5. Architecture & Workflow Diagrams

### (a) System architecture block diagram

```
                            THE BROWSER (React + TypeScript + Vite)
   +--------------------------------------------------------------------------------+
   |                                                                                |
   |   +------------------------------+     +-----------------------------------+   |
   |   |   Canvas UI                  |     |   Client-side brains (no server)  |   |
   |   |   React Flow (@xyflow/react) |     |   - dagre auto-layout             |   |
   |   |   - typed nodes / edges      |     |   - Layer 0 lint rules            |   |
   |   |   - human live cursors       |     |   - load simulator (O(V+E))       |   |
   |   |   - Ghost's animated cursor  |     |   - trigger engine (settle gates) |   |
   |   +---------------+--------------+     |   - scaffold engine (JSZip)       |   |
   |                   |                    +-----------------------------------+   |
   |                   | reads/writes                                              |
   |          +--------v---------+                                                 |
   |          |  Two-layer state |   SEMANTIC (nodes/edges/version) -> AI-visible  |
   |          |  (Yjs document)  |   PRESENTATION (x/y/size/select) -> local only  |
   |          +--------+---------+                                                 |
   +-------------------|------------------------------------------------------------+
                       | WebSocket (y-websocket)                 ^
                       v                                         | streamed ops (terse lines)
        +------------------------------+          +--------------+-----------------+
        |   Yjs Sync Server (Node)     |          |   Backend AI Service (Node)    |
        |   - small, self-hosted       |          |   - builds cached prompt       |
        |   - relays CRDT updates      |          |   - calls Claude, streams back |
        |   - relays awareness/cursors |          +--------------+-----------------+
        +--------------+---------------+                         |
                       ^                                         v
                       |                              +---------------------+
        +--------------+---------------+              |   Anthropic Claude  |
        |   GHOST (peer sync client)   |<-------------+   API (streaming)   |
        |   joins the room like a human|  drives      +---------------------+
        |   own cursor + node writes   |  Ghost's cursor/writes
        +------------------------------+
```

Key point the diagram makes: **Ghost is a peer on the same sync bus as humans.** The AI service and Anthropic API feed Ghost's decisions, but Ghost expresses them through the ordinary collaboration room — not through a privileged side channel.

### (b) Feature flow diagram — the intervention loop

```
   +-------------------+
   | User edits canvas |  (add node, add edge, change type, ... or just drag)
   +---------+---------+
             |
             v
   +---------------------------+     drag only? (presentation)
   | Write through Yjs maps    +-----------------------------> [ IGNORED: no AI event ]
   | -> semantic op recorded   |
   |    at write time          |
   +---------+-----------------+
             | semantic op
             v
   +-------------------------------+
   |        TRIGGER ENGINE         |
   |  gates, in order:             |
   |  - semantic change? -----------------> no --> stop
   |  - 3s settle debounce         |
   |  - materiality (2-3+ ops)     |
   |  - semantic-hash unchanged? --------> yes --> stop (short-circuit)
   |  - cooldown / dedupe          |
   +----+---------------------+----+
        |                     |
        | ALWAYS (instant)    | only at settle points (gated)
        v                     v
   +-----------------+   +--------------------------+
   | LAYER 0         |   | LAYER 2                  |
   | Lint rules      |   | LLM holistic critique    |
   | (0 tokens,      |   | (Claude, cached prefix + |
   |  graph patterns)|   |  event-log delta)        |
   +--------+--------+   +------------+-------------+
            |                         |
            |   both produce findings |
            v                         v
        +-------------------------------------+
        |   Suggestion cards on the canvas    |
        |   (lint + LLM render identically)   |
        +-------------------------------------+
```

---

## 6. End-to-End User Journey (Product Lifecycle Sequence)

A concrete, step-by-step walkthrough. Meet **Maya**, a tech lead, and **Dan**, a backend engineer.

**1. They open a room.** Maya shares a room link. Dan joins. Each sees the other's name and live cursor gliding across the blank canvas. In the presence bar there's a third participant already present: **Ghost.**

**2. Maya asks Ghost to draw.** She types into Ghost's prompt: *"Design an e-commerce backend — product catalog, user accounts, shopping cart, checkout with payments."*

**3. Ghost draws it live.** Ghost's cursor springs to life. Claude streams a terse op list; the client parses each line and queues it. Ghost's cursor glides to a spot and drops a **Client** node, then an **API Gateway**, then an **Auth** service, a **Product** service, a **Cart** service, a **Checkout** service, a **Postgres** database, a **Redis** cache in front of the product reads, and a **queue** for order processing — placing each with dagre-computed positions and drawing the connecting edges. Dan watches the whole architecture assemble itself in a few seconds, cursor and all. It genuinely looks like a fast, invisible colleague is drawing.

**4. Dan makes an edit — and introduces a flaw.** Dan thinks the Redis cache is unnecessary complexity. He **deletes the Redis node** and, to "simplify," draws a **direct edge from the Client to Postgres**, bypassing the API Gateway.

**5. Suggestion cards appear — instantly.** Before Dan even finishes second-guessing himself, two **suggestion cards** pop onto the canvas. These are **Layer 0 lint cards**, so they fire immediately with zero AI latency:
   - *"Client is connecting directly to a database. Put an API/service layer in between so the datastore isn't exposed."*
   - *"Hot read path (product catalog) has no cache. Reads will hit Postgres directly under load."*
   Maya and Dan read them together. Dan raises an eyebrow — the tool caught exactly what he just did.

**6. They run the load slider.** Maya wants to *show* Dan why the cache mattered. She drags the **requests-per-second slider** up. Load propagates through the graph client-side. As RPS climbs, **Postgres turns amber, then glows red** — its utilization is past capacity because every read is now hitting it directly. The bottleneck is unmissable.

**7. They apply Ghost's fix.** Convinced, Dan **re-adds the Redis cache** per the suggestion card, placing it back on the product read path (Client → API Gateway → Product service → Redis → Postgres). With the slider still cranked, the cache now **absorbs its hit-ratio share and passes only misses downstream.** In real time, **the red drains out of Postgres** back to green. Dan is sold. The abstract argument ("caches protect your database") just became a thing he watched happen.

**8. They generate the scaffold.** With the design agreed, Maya clicks **Generate Scaffold.** The scaffold engine walks the semantic graph, builds a manifest, runs each node through the template registry, uses the edges to wire env vars and `depends_on`, zips it with JSZip, and downloads `ecommerce-backend.zip` — all in her browser, no server call.

**9. They open the ZIP and see their diagram as code.** Maya unzips it and opens `docker-compose.yml`. There they are: a `postgres` service, a `redis` service, an `nginx` gateway config routing to the services, folders for `auth`, `product`, `cart`, and `checkout` each with a minimal Fastify `index.ts`, a `Dockerfile`, and `.env.example`. The `checkout` service has a `DATABASE_URL` pointing at Postgres and a `depends_on`, and producer/consumer stubs for the order queue. **The compose file's topology is exactly the picture on the canvas.** Dan runs `docker compose up` to prove it boots.

Total elapsed time: a few minutes, from one sentence to a reviewed, stress-tested, runnable skeleton — all in one shared room.

---

## 7. Future Goals (Post-MVP)

Deliberately **excluded from the MVP** to keep the demo path tight, but planned and worth knowing so we build the MVP without painting ourselves into a corner:

- **Ghost surgical edits to existing graphs.** Natural-language mutations of a *live* diagram ("add a read replica to Postgres and put a load balancer in front of the product service"). This means editing live CRDT state with proper conflict handling. **This is the hardest and highest-value future item** — it's the difference between Ghost as a drafting tool and Ghost as a true collaborator.
- **Persistence and shareable rooms.** Save/load via Supabase snapshots so rooms survive refreshes and can be revisited.
- **Undo/redo.** Using the Yjs UndoManager, with **separate undo stacks for humans and Ghost** so you don't undo the AI's work by accident and vice versa.
- **Failure injection in the simulator.** Kill a node and watch the cascade — turn the teaching tool into a resilience explorer.
- **Critique-quality eval harness.** Fixture graphs with known expected findings, so we can measure whether Ghost's critique regresses as we tune it.
- **Richer node-type library.** More types (CDN, object storage, search, etc.) — cheap to add because the enum feeds all four subsystems.
- **Authentication and teams.** Real accounts, org rooms, permissions.
- **Chat-with-Ghost sidebar.** A conversational channel in addition to Ghost's on-canvas actions.
- **Deeper scaffold templates.** Terraform, Kubernetes manifests — beyond docker-compose.
- **Integrations.** Export to Mermaid / draw.io; import from existing repos to reverse-engineer a diagram.

---

## Caveats & honest notes

- **The load simulator is a teaching tool, not a benchmark.** Capacities and latencies come from a static lookup table. It's designed to build intuition and make trade-offs visible in a meeting, not to predict real production performance. We should say this out loud in the demo.
- **The MVP scope is a single reliable demo path**, not a hardened product. Multiplayer edge cases, persistence, and auth are explicitly deferred.
- **Novelty is in the combination, not every part.** Text-to-diagram (Eraser, Miro, Lucidchart, Excalidraw) and diagram-to-code (Brainboard, AWS Infrastructure Composer) exist elsewhere; our differentiators are the peer-cursor model, live canvas-native flaw detection, and on-diagram load simulation.
- **LLM critique quality is variable.** Layer 0 lint rules are deterministic and reliable; Layer 2 LLM critique is judgment-based and can occasionally miss or over-flag. The hybrid design intentionally leans on lint for the demo-critical findings so the wow moments don't depend on model luck.
- **Cost/latency depend on disciplined gating and caching.** The token strategy (don't call → call rarely → call cheaply via prompt caching of a byte-stable prefix → send less via terse serialization and deltas) is what keeps Ghost affordable and responsive; if the trigger gates are loosened, cost and nagging both rise. Note Anthropic's prefix cache is exact-match, so any drift in the cached prefix silently forces a full-price recompute.
- **Model-view drift is a real risk.** The version counter guards against it: if Claude references a node ID that no longer exists, that response is discarded and a fresh full-graph checkpoint is sent before continuing.
</result>
</invoke>