# ArchForge — Technical Architecture Blueprint
**Real-time collaborative system design canvas with an embedded AI agent**

---

## 0. Framing Correction: Where the Token Problem Actually Lives

Before the optimization strategy, the premise needs recalibrating, because it changes what we build first.

A compactly serialized system-design graph is small. A 40-node architecture with edges, stripped of presentation data, is roughly 1,500–2,000 tokens. Even naively resending the full graph on every AI call, payload size is not what explodes cost. What explodes cost is **call frequency** (an agent "watching" a canvas where two people are dragging nodes can trivially fire dozens of calls per minute) and **uncached repetition** (resending the same system prompt, tool schemas, and graph history at full input price on every call).

So the optimization hierarchy, in order of leverage:

1. **Don't call the model** — deterministic client-side lint rules handle most "proactive interventions" for free.
2. **Call it rarely** — a trigger engine gated on semantic settle-points, not raw canvas events.
3. **Call it cheaply** — prompt caching so 90%+ of every request's input tokens are cache reads (~10x cheaper on Anthropic's API).
4. **Send less** — compact serialization and semantic deltas. Real, but the smallest lever of the four.

Graph diffing is still in this document (Section 3.4) because it composes well with prompt caching. It is not the headline.

---

## 1. Canvas & Real-Time State Architecture

### 1.1 Canvas library: React Flow (@xyflow/react)

**Recommendation: React Flow. Not tldraw, not raw canvas.**

The product is a *graph editor* — typed nodes, typed edges, connection handles, ports. That is exactly React Flow's data model. You get node dragging, edge connection UX, minimap, zoom/pan, custom node components (your service/DB/API cards are just React components), and a controlled `nodes`/`edges` state shape that is already the abstract structure the LLM needs. The distance from "install" to "draggable architecture diagram" is a day.

tldraw is a superior *freeform* canvas and its multiplayer story is excellent, but you'd be rebuilding graph semantics (typed connections, ports, validation) on top of a shape model that doesn't want them — and the tldraw SDK carries licensing/watermark conditions for production use that are noise you don't need for an internal innovation sprint (verify current terms if you ever ship it). Raw HTML5 Canvas/SVG is a non-starter on this timeline; you'd spend all four weeks on hit-testing and edge routing.

One rendering note: React Flow renders nodes as DOM. Fine up to a few hundred nodes, which is far beyond any demo scenario. Don't prematurely optimize toward WebGL.

### 1.2 Multiplayer sync: Yjs

**Recommendation: Yjs CRDT + `y-websocket`** (a ~50-line Node server you self-host), with Liveblocks as the buy-instead-of-build fallback if Week 1 slips.

- Canvas state lives in two `Y.Map`s: `nodes` (keyed by node ID) and `edges` (keyed by edge ID). Every mutation is a keyed map operation — this matters later, because it makes diffing trivial (Section 3.4).
- Live cursors use Yjs's **awareness protocol** (ephemeral state, not persisted into the document — exactly what cursors should be).
- **The trick that makes Ghost feel alive:** the AI agent connects to the room as *just another Yjs client* from your backend. Its cursor is an awareness entry like any human's; its node placements are ordinary Y.Map writes. You don't build a special "AI rendering path" — Ghost is a peer. This is architecturally clean and demos beautifully ("Ghost is literally a participant in the CRDT").

There are known React Flow + Yjs integration examples to crib from; the binding is ~100 lines (subscribe Y.Map → setNodes; onNodesChange → Y.Map writes, wrapped in `doc.transact` to batch).

### 1.3 The graph schema: two layers, strictly separated

The single most important schema decision: **separate the semantic layer from the presentation layer.** The LLM only ever sees semantics.

```jsonc
// SEMANTIC layer — what the LLM reads and writes
{
  "v": 42,                    // monotonic version, incremented per semantic change
  "nodes": [
    { "id": "gw",  "t": "api_gateway", "l": "API Gateway" },
    { "id": "db1", "t": "postgres",    "l": "Orders DB", "p": { "replicas": 2 } }
  ],
  "edges": [
    { "f": "gw", "to": "svc1", "k": "http" },
    { "f": "svc1", "to": "db1", "k": "sql" }
  ]
}

// PRESENTATION layer — client-only, never serialized to the LLM
// { id: "gw", x: 340, y: 120, w: 180, h: 80, selected: false, ... }
```

Rules that keep this honest:

- Node `t` (type) is a closed enum (~15 entries: `client`, `api_gateway`, `service`, `postgres`, `redis`, `queue`, `cdn`, `lb`, `auth`, `s3`, ...). The enum is defined once in the cached system prompt, so per-node cost stays tiny and Ghost can never invent a node type the renderer can't draw. This enum is also the contract for the lint engine and the scaffold engine — one vocabulary, three consumers.
- Coordinates never reach the model. When Ghost creates nodes, the **client** computes positions via auto-layout (`dagre` or `elkjs` — dagre is simpler and sufficient for left-to-right architecture flow). The LLM deciding x/y is a token sink and produces ugly layouts anyway.
- Short keys (`t`, `l`, `f`) are deliberate. Petty, but it compounds across every call.

---

## 2. LLM Integration & Token Strategy

### 2.1 Layer 0 — the deterministic lint engine (zero tokens)

Most of the "proactive intervention" catalogue is graph pattern matching, not intelligence:

```typescript
const RULES: LintRule[] = [
  {
    id: "direct-db-access",
    severity: "high",
    match: (g) => g.edges.filter(e =>
      isType(g, e.f, "client") && isDataStore(g, e.to)),
    card: (hit) => `Client is hitting ${label(hit.to)} directly. Put a service or API layer in front.`
  },
  { id: "missing-cache",   /* hot read path: service→db fan-in ≥ N, no redis/cdn sibling */ },
  { id: "unauth-ingress",  /* edge from `client` to anything with no `auth` node on any path */ },
  { id: "spof",            /* articulation point via one DFS — "this node takes down everything" */ },
  { id: "sync-heavy-work", /* service→service http chain depth ≥ 3, no queue anywhere */ },
];
```

These run client-side on every semantic change, cost nothing, respond in milliseconds, and — critically for a live demo — **fire deterministically**. When your teammate deletes the cache node on stage, the card appears every single time. Ship 5–8 rules; each is 10–30 lines of graph traversal.

Suggestion cards from lint rules and cards from the LLM render identically. The audience doesn't know or care which brain produced which card — but you control the demo with the deterministic ones.

**The LLM critique is Layer 2, not Layer 0:** it runs only at settle-points (2.3) and only for holistic judgment the rules can't express ("this whole design is synchronous; for order processing you probably want an event backbone"). One high-quality card per settle beats a stream of nitpicks.

### 2.2 Prompt structure — built for the cache

Anthropic prompt caching makes cached input tokens ~10x cheaper and much faster to process. Structure every request as **stable prefix + append-only log**, with cache breakpoints after the stable parts:

```
[SYSTEM — cached, changes never]
  Role, node-type enum + semantics, output op format, lint-rule IDs
  already covered (so Ghost doesn't duplicate deterministic findings)

[GRAPH CHECKPOINT — cached, changes rarely]
  Full semantic graph at version N, compact serialization

[EVENT LOG — appended per call]
  v43: +node cache1:redis
  v44: +edge svc1->cache1
  v45: -edge svc1->db1
  user: "does this handle checkout spikes?"
```

Because the prefix is byte-identical across calls, every call after the first pays full price only for the few dozen tokens of new events. This — not diffing cleverness — is where the order-of-magnitude saving lives. Re-checkpoint (write a fresh full-graph block, resetting the log) when the event log exceeds ~30 ops or ~25% of checkpoint size; nodes deleted-then-readded make logs longer than states.

### 2.3 The trigger engine — when Ghost is allowed to think

Raw canvas events (drags, hovers) must never reach the model. Gate LLM calls behind all of the following:

1. **Semantic filter.** Position changes are not semantic. Only node add/remove, edge add/remove, type/label/prop changes increment `v`. This alone eliminates ~95% of canvas events — a user dragging nodes around for two minutes generates zero AI-relevant activity.
2. **Settle debounce.** 3 seconds of no semantic changes = the humans have paused. Fire at settle, never mid-flow.
3. **Materiality threshold.** ≥2–3 semantic ops since last critique, OR a high-severity lint rule newly fired (worth Ghost elaborating on).
4. **Semantic hash short-circuit.** Hash the canonical semantic graph (sorted node/edge IDs). Unchanged hash since last critique → no call, even if ops occurred (add-then-undo nets to nothing).
5. **Cooldown + dedupe.** Minimum 20–30s between unsolicited critiques; fingerprint each finding (`rule-ish-id + involved node ids`) and never re-post an unresolved card. An AI that nags loses the room in the first minute of the demo.

Explicit user actions ("Ghost, build me X", clicking "review my design") bypass the gates — user intent is always a valid trigger.

### 2.4 Delta updates & graph diffing — the honest version

Because state lives in ID-keyed maps, "graph diffing" here is **not** graph-isomorphism hard. It's a keyed shallow diff:

```typescript
function diff(prev: SemGraph, next: SemGraph): Op[] {
  const ops: Op[] = [];
  for (const n of next.nodes) {
    const p = prev.byId[n.id];
    if (!p) ops.push({ op: "+n", n });
    else if (p.t !== n.t || p.l !== n.l || !eq(p.p, n.p))
      ops.push({ op: "~n", id: n.id, ...changed(p, n) });
  }
  for (const p of prev.nodes) if (!next.byId[p.id]) ops.push({ op: "-n", id: p.id });
  // edges: identical pattern, keyed by edge id
  return ops;
}
```

Even simpler: since every mutation already flows through Yjs as a keyed map op, you can **record semantic ops at write time** and skip diffing entirely — the event log in 2.2 falls out of the sync layer for free. Ops serialize at 5–15 tokens each in a terse line format (`+n cache1 redis "Session Cache"`), versus ~1,500 for a full-state resend.

The failure mode to engineer against: model's-view drift. If an op is dropped or the log is compacted wrong, Ghost critiques a graph that doesn't exist. Mitigations: the version counter on every payload, and periodic checkpointing (2.2). If Ghost's response references a node ID not in the live graph, silently discard and re-sync with a fresh checkpoint.

### 2.5 Compact serialization

For checkpoints, a terse line-based DSL beats JSON by ~2–3x and is *more* legible to models, not less (it resembles Mermaid, which is heavily represented in training data):

```
NODES
gw api_gateway "API Gateway"
svc1 service "Order Service"
db1 postgres "Orders DB" replicas=2
EDGES
client -> gw http
gw -> svc1 http
svc1 -> db1 sql
```

~8–12 tokens per node. A 40-node system: ~600–800 tokens. Define the format once in the cached system prompt; use it in both directions (Ghost also *emits* ops in this format — see 2.6).

### 2.6 Ghost drawing in real time — the streaming mechanic

The headline demo moment. Implementation:

1. User prompt → backend calls the model with **streaming** on, asking for an *ordered op list* in the line format above (nodes in dependency order, then edges), one op per line.
2. Backend parses complete lines off the stream as they arrive (line-delimited output makes partial-parse trivial — this is why not to use one big JSON object, which is unparseable until the closing brace).
3. Each parsed op goes onto a client-side **animation queue**. A queue consumer: runs dagre layout incrementally, animates Ghost's awareness cursor to the target position with easing (~350ms), drops the node with a small scale-in, proceeds.

The queue **decouples model latency from perceived performance**: if the model streams 20 ops in 3 seconds, Ghost still draws them at a deliberate, watchable cadence over ~10 seconds. Ghost looks thoughtful; you get free latency masking. If the stream hiccups, Ghost's cursor idles — which reads as "thinking," not "broken."

---

## 3. Load Simulation & Scaffold Engine

### 3.1 Load simulation — fully client-side, ~150 lines

No backend compute, no token bucket machinery. A single-pass capacity-propagation model on the semantic graph:

- Each node type has base `capacity` (RPS) and `latencyMs` from a static lookup (`postgres: 500 rps`, `redis: 50k rps`, `service: 2k rps × replicas`...). Made-up numbers with plausible ratios — this is a visualization, not a benchmark, and nobody at a Brown Bag will audit them.
- Slider sets ingress RPS at `client` nodes. Propagate in topological order (BFS from sources): each node's inbound load splits across outbound edges (evenly, or per edge weight); a `redis`/`cdn` node absorbs `hitRatio` (say 80%) and passes only misses downstream — which means **adding a cache visibly un-reds the database in real time**, the exact causal story you want on stage.
- Utilization = load / capacity → color ramp (green < 60% < amber < 85% < red), plus a CSS glow/pulse on saturated nodes. Over 100%: overflow cascades as added latency/backpressure upstream if you want a stretch flourish; not required.
- Cycles: demo architectures are effectively DAGs; cap propagation at N iterations and move on. Do not build a queueing-theory simulator.

Recompute on every slider tick — it's O(V+E) on 40 nodes, effectively free. The slider feels perfectly live.

Note the payoff of the shared enum: the same `t` field drives rendering, linting, simulation, and codegen.

### 3.2 Scaffold engine — client-side ZIP, no server

Walk the semantic graph → build a manifest → apply a template registry → `JSZip` → `file-saver`. Entirely in-browser.

- **Template registry keyed by node type:** `postgres` contributes a `docker-compose` service block + init SQL stub; `service` contributes `services/<name>/` with a minimal Express/Fastify `index.ts`, `Dockerfile`, `.env.example`; `redis`/`queue` contribute compose blocks; `api_gateway` contributes an nginx conf routing to its outbound edges.
- **Edges drive wiring, and this is the impressive part:** an edge `svc1 → db1` injects `DATABASE_URL` into svc1's env and a `depends_on` into compose; `svc1 → queue1` injects a consumer/producer stub. The generated compose file topologically mirrors the drawn canvas — say that sentence out loud in the demo.
- A generated `README.md` listing the architecture and a `docker compose up` quickstart rounds it out.

Templates are string literals with interpolation; Handlebars if you want tidiness. Support **3 node types deeply** (service, postgres, redis) rather than 15 shallowly. Do not `docker compose up` live on stage — show the ZIP contents and a pre-recorded/pre-run terminal instead. Live Docker is how demos die.

---

## 4. MVP Scope — 40–50 Day Plan, Milestone-Gated

Total runway: ~7 weeks alongside day-job deliverables, so plan on ~50% effective capacity. Structure: **Milestone A** (the demo slice, weeks 1–4, unchanged from a tight-deadline plan — it is the architectural skeleton regardless of runway) → **Milestone B** (expansion tier, weeks 5–6, scope gated on A landing on time) → **freeze + rehearsal week**. The extra runway buys depth *after* a working end-to-end slice, never a longer runway *to* the first working slice.

### 4.1 The demo is one scripted path, and Milestone A builds exactly that

**The 4-minute Brown Bag arc:**

1. Two squad members join the room on separate laptops — live cursors visible. *(10s of multiplayer credibility, then move on.)*
2. Presenter types: *"Design an e-commerce backend: web client, product browsing, checkout with payments, order history."* → **Ghost's cursor draws the architecture live**, node by node, edges snapping in. *(The wow moment. ~30s.)*
3. Teammate on laptop #2 **deletes the Redis node** and drags an edge from client straight to Postgres. Within seconds, two suggestion cards drop onto the canvas (deterministic lint rules — guaranteed to fire). *(The "it's watching" moment.)*
4. Presenter drags the load slider up → Postgres glows red → re-adds the cache per Ghost's suggestion → **the red drains out of the database in real time**. *(Cause and effect, visually.)*
5. One click → ZIP downloads → open the compose file: *"the infrastructure of what we just drew."* *(Close.)*

Every feature that doesn't serve one of those five beats is deferred out of Milestone A: no auth, no persistence beyond the room session, no multi-room management, no undo/redo, no chat-with-Ghost sidebar, no LLM *edits* to existing graphs. Some of these return in Milestone B (4.4) — but only after the slice works end-to-end.

### 4.2 Milestone A — weeks 1–4, exit-criteria gated

- **Week 1 — the boring foundation:** React Flow canvas, custom node components for the type enum, Yjs sync + live cursors, two-browser test. *Exit criterion: two laptops dragging shared nodes.* If Yjs fights you past day 3, switch to Liveblocks and don't look back.
- **Week 2 — Ghost draws:** streaming endpoint, line-op parser, animation queue, dagre auto-layout, Ghost-as-Yjs-peer cursor. *Exit: prompt → animated architecture, reliably, for 3 canned prompts.*
- **Week 3 — Ghost judges:** lint engine (5–8 rules) + suggestion card component; trigger engine; LLM settle-point critique with cached prefix + event log. *Exit: delete-the-cache reliably produces a card in <3s.*
- **Week 4 — spectacle:** load simulation, scaffold engine (3 node types), recorded op-stream fallback for the drawing demo. *Exit: the full 5-beat demo path runs clean, twice in a row, on two machines.*

**Gate:** Milestone B's big-ticket item only starts if Week 4's exit criterion is met on schedule. If A slips, the slip eats B's scope — never the freeze week.

### 4.3 Milestone B — weeks 5–6, ranked by cost-to-wow

In strict order; each item lands independently, so a partial B is still a coherent product:

1. **Undo/redo** (~1 day). Yjs `UndoManager`, scoped so human ops and Ghost ops undo on separate stacks — cheap, and its absence is the first thing a Figma-literate audience notices.
2. **Failure injection in the simulator** (~1–2 days). Right-click a node → "kill it" → watch load re-route and downstream nodes cascade red. Builds directly on the existing propagation pass; disproportionately demoable for its cost.
3. **Persistence + rooms** (~3–4 days). Yjs document snapshots to Supabase (Postgres + auth in one), shareable room URLs, room list. Turns the demo into something squadmates actually reopen the next day — the difference between a demo and a product.
4. **Ghost surgical edits** (~2 weeks, the gated item). Ghost mutating an *existing* graph from natural language ("make checkout async") — emitting ops against live CRDT state, handling the human dragging a node Ghost is mid-editing, discarding stale ops via the version counter. This is the hardest and highest-value engineering in the entire project. Start it only with a clean 2-week window; a half-working edit feature is worse in a demo than none.
5. **Critique eval harness** (~2–3 days, only if time remains). A fixture set of intentionally flawed graphs with expected findings, so prompt changes to Ghost's judgment are measured, not vibed.

### 4.4 Freeze + rehearsal — final week, non-negotiable

Feature freeze seven days before the Brown Bag regardless of where B stands. The week goes to: demo script rehearsal ×3 on the actual venue network, the canned op-stream fallback path tested, a backup screen recording of the full path, and bug triage only. Every innovation-project demo that dies, dies from code merged in the last 48 hours.

### 4.5 What I'd tell the Engineering Lead when they push back

- *"Why not diff-based AI updates as the centerpiece?"* — Because prompt caching + trigger gating delivers ~90% of the cost/latency win, and full-state payloads are <2K tokens anyway. Deltas are implemented (2.4) but as a cache-friendly append log, not a load-bearing novelty.
- *"Is the proactive AI real if it's mostly lint rules?"* — The hybrid is the *stronger* engineering story: deterministic rules for known patterns at zero cost, LLM judgment at settle-points for what rules can't express. That's how you'd actually productionize it, and it's a better Brown Bag talking point than "we call the model a lot."
- *"You have 7 weeks — why does the plan look like a 4-week plan plus extras?"* — Because the slice is the skeleton: every B item builds on A's sync layer, op log, and simulator. Sequencing doesn't change with runway; only how far down the ranked list we get. And capacity is ~50% of calendar because squad deliverables continue.
- *"Biggest schedule risk?"* — Week 1 multiplayer plumbing (first, with a buy-fallback), then surgical edits (gated, cut-not-compressed), then demo-day API variance (replay fallback).
