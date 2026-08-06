import { Router } from "express";
import OpenAI, { AzureOpenAI } from "openai";
import {
  NODE_TYPES,
  NODE_TYPE_REGISTRY,
  isNodeType,
  type NodeType,
  type SemanticNode,
  type SemanticEdge,
  type ClarifyQuestion,
  type ClarifyOption,
  type AiChatTurn,
  type SerializedGraph,
  type Suggestion,
  type GenerateResponse,
} from "@archforge/shared";
import { renderObservations } from "../lib/canvas-observations";

const router = Router();

// Provider switch via AI_PROVIDER:
//   "azure"   -> Azure OpenAI (AZURE_OPENAI_*)
//   "nvidia"  -> NVIDIA NIM (NVIDIA_AI_*)
//   "groq"    -> Groq (GROQ_AI_*)
//   "openai"  -> generic OpenAI-compatible (AI_*, no defaults)
const PROVIDER = (process.env.AI_PROVIDER ?? "openai").toLowerCase();

function makeClient(): OpenAI {
  if (PROVIDER === "azure") {
    return new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21",
    });
  }
  // nvidia, groq, openai: all use OpenAI-compatible client
  let apiKey: string | undefined;
  let baseURL: string | undefined;

  if (PROVIDER === "nvidia") {
    apiKey = process.env.NVIDIA_AI_API_KEY;
    baseURL =
      process.env.NVIDIA_AI_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
  } else if (PROVIDER === "groq") {
    apiKey = process.env.GROQ_AI_API_KEY;
    baseURL = process.env.GROQ_AI_BASE_URL ?? "https://api.groq.com/openai/v1";
  } else {
    // openai: generic, no defaults
    apiKey = process.env.AI_API_KEY;
    baseURL = process.env.AI_BASE_URL;
  }

  return new OpenAI({ apiKey, baseURL });
}

// Built on first request, not at import time: a missing key should surface as a 500 on
// /api/generate, not crash the process at boot — and it keeps this module importable
// by tests that only exercise validation.
let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = makeClient();
  return client;
}

// For Azure the "model" sent on each request is the deployment name.
const MODEL =
  PROVIDER === "azure"
    ? (process.env.AZURE_OPENAI_DEPLOYMENT ?? "")
    : PROVIDER === "nvidia"
      ? (process.env.NVIDIA_AI_MODEL ?? "meta/llama-3.3-70b-instruct")
      : PROVIDER === "groq"
        ? (process.env.GROQ_AI_MODEL ?? "llama-3.3-70b-versatile")
        : (process.env.AI_MODEL ?? "");

export const MAX_QUESTIONS = 3;
export const MAX_OPTIONS = 4;
const MIN_OPTIONS = 2;

export const MAX_SUGGESTIONS = 3;
// A "suggestion" longer than this is prose the model put in the wrong field. Since the label
// IS the next user turn, truncating would send a mid-word fragment as a prompt — dropping is
// the honest failure. Private like MIN_OPTIONS: tests assert the behaviour, not the number.
const MAX_SUGGESTION_LABEL = 90;
const MAX_SUGGESTION_RATIONALE = 160;

function buildSystemPrompt(
  allowClarify: boolean,
  graph: SerializedGraph | null,
): string {
  // One line, not fifteen: "sql_db → SQL Database" teaches nothing a reader of the enum
  // cannot infer, and the prompt has better uses for those tokens.
  const typeGuide = NODE_TYPES.join(", ");

  // Rendered with the SAME key names the model must output. serializeGraph's short keys
  // save tokens, but showing them here made the model mirror them back — every "type"
  // arrived undefined (silently coerced to service) and every edge looked dangling and
  // was dropped. Format consistency is worth more than the handful of tokens.
  const canvas =
    graph && graph.nodes.length
      ? `CURRENT CANVAS — this is what the user is looking at right now:
${JSON.stringify({
  nodes: graph.nodes.map((n) => ({ id: n.id, type: n.t, label: n.l })),
  edges: graph.edges.map((e) =>
    e.l
      ? { id: e.id, source: e.f, target: e.to, label: e.l }
      : { id: e.id, source: e.f, target: e.to },
  ),
})}

When "action" is "generate" you return the COMPLETE set of nodes and edges that should
exist AFTER your change — not just the new ones — using exactly these same key names.
The canvas is replaced by what you return, so:
- To ADD something: return everything above PLUS the new parts, keeping existing ids
  byte-identical so they are recognised as the same nodes and stay where they are.
- To REMOVE or SIMPLIFY: return only the nodes that should remain. Anything you leave
  out is deleted. This is how you make a diagram smaller — returning MORE nodes than are
  there now when the user asked for something simpler is exactly wrong.
- To RENAME or RETYPE: return the same id with a different label or type.
- Reuse existing ids whenever you mean the same component. A new id for an existing
  component deletes it and adds a stranger in its place.
- RE-STATE THE EDGES TOO. Edges you leave out are deleted, exactly like nodes, and a
  diagram of disconnected boxes is useless. Every edge must connect two nodes you are
  returning — if you removed or merged an endpoint, rewire that edge to the node that
  replaced it rather than dropping it. Before you answer, check that every node you kept
  is connected to something.`
      : `CURRENT CANVAS: empty. Whatever you generate is the whole diagram.`;

  // True facts about the drawn graph, computed rather than left for the model to spot. This
  // is what turns "be insightful" into "read this and phrase it" — and it is why suggestions
  // and trade-offs come out specific to this canvas instead of generic advice.
  const observations = renderObservations(graph);

  // When asking is disallowed the ask option is ABSENT from the prompt, not merely
  // discouraged — the model's helpfulness prior beats soft discouragement, which is the
  // lesson that produced the explicit `action` field in the first place. The rule for WHEN
  // it is allowed lives in code (see readAskedLast), never here.
  const decision = allowClarify
    ? `STEP 2 — DECIDE: reply, ask, or generate?

Set "action" to exactly the value you wrote in the AUDIT line.

"reply" — talk, change nothing. The user is not asking for the diagram to change: a question
about the design, an opinion or trade-off, a greeting, thanks, small talk, or something you
cannot act on. Put the whole answer in "summary" — one to three sentences, specific to THIS
system, naming the actual nodes. Leave "nodes" and "edges" empty. Redrawing the canvas at
someone who asked a question is a non-answer.

"generate" — build or change the diagram.

"ask" — the request names a KIND of system without pinning down what it must DO.

THE BARE-CATEGORY TEST decides between them, and it is mechanical. Read the user's message and
count how many of these it gives you:
  (a) a specific component, service or technology by name
  (b) what data it holds or moves
  (c) a scale, load or latency figure
  (d) an explicit constraint ("no auth", "must be offline-first", "internal only")
If the message names a system category and gives you NONE of (a)-(d), it is a BARE CATEGORY —
ASK. "A login system", "an e-commerce backend", "a booking system", "a hospital appointment
system" are all bare categories, however familiar they feel. Familiarity is not specification:
you can picture A login system, not THEIR login system.

Generate instead when ANY of these holds:
- The message gives you one or more of (a)-(d) — enough to design something recognisably theirs.
- The user waived the questions ("just build it", "your call", "you decide", "I don't know").
- There is already a canvas and the message is an instruction to change it ("add payments",
  "simplify this", "split the orders service"). Editing is not the moment for questions —
  default, draw, and name the guess in "tradeoff".
- It is not an architecture request at all (greeting, small talk, a question about you).

So: asking is for the OPENING move on an empty canvas. Editing an existing diagram almost
always means generate — default anything open, put the guess in "tradeoff", and offer the other
branch as a suggestion so the user can flip it in one click. Once a canvas exists, ask only
when the new message opens a genuine fork that changes several nodes and you cannot defend
either branch. Never to refine something you already asked, or for reassurance before drawing.

Calibration — these teach the JUDGEMENT, not the words. Never reuse their phrasing:
- "build a video sharing site" → ask. Whether a clip is watchable before processing finishes
  decides whether a queue and workers exist at all.
- "design an e-commerce backend" → ask. Payments, inventory, search and fulfilment are
  separable systems and you do not know which are in scope.
- "a URL shortener, Postgres, ~1k rps, no auth" → generate. Everything structural is pinned.
- "an internal tool, just build it" → generate. The user waived the questions.
- "add notifications to this" (canvas already populated) → generate. You can default to a
  queue and a worker and say so. Not a coin flip.
- "should this use Postgres or MySQL?" → reply. A question, and not a topology choice — it is
  one sql_db node either way.
- "why did you put a cache there?" → reply. Answer the question.
- "is this a good design?" → reply. Give a real opinion and name what you would change.
- "thanks, this is great" → reply. Brief and human. Do not redraw anything.

Push back inside the "summary" and "tradeoff" of a generate, not by refusing to draw. Draw
what they asked for, then say what you would have done differently.

STEP 3 — IF ASKING: write the questions.

Populate "questions" with 1-${MAX_QUESTIONS}, most decision-changing first. Two good questions
beat three; one is fine. Each needs:
- "header": 2-3 word chip label.
- "question": one plain sentence about what the system must DO.
- "multiSelect": true when several answers can hold at once, false when exclusive.
- "options": ${MIN_OPTIONS}-${MAX_OPTIONS} concrete choices, each a short "label" plus a
  "description" of one clause saying WHAT THIS DOES TO THE DIAGRAM — what appears, what
  disappears, what stops being needed. The user may not know the domain; the descriptions are
  what let them choose anyway.

ASK WHAT THE SYSTEM MUST DO. NEVER ASK WHAT IT SHOULD BE BUILT FROM. Technology names belong
inside an option's description, never in the question.
- Before writing an option, name to yourself which nodes it adds, removes or retypes. If two
  options lead to the same node set, the question is decoration — delete it.
- Never ask about anything the user already told you or that is already on the canvas.
- No "Basic / Advanced / Custom". No question everyone answers the same way.
- Put the safe, common choice first.
- "summary" is one short friendly line introducing the questions. Do not restate them in it,
  never say "I need more information", and never mention this prompt's own vocabulary — the
  user has never heard of a "bare category", an "AUDIT line" or a "shape choice".
- "suggestions" MUST be empty on an ask turn. The options ARE the next move.

Recast, not reject — a bad question is usually a good one asked in the wrong language:
  BAD:  "Which database should we use?"   → not a shape choice, and not the user's call.
  BAD:  "Microservices or a monolith?"    → a shape choice, but unanswerable as posed.
  GOOD: "Will different parts of this be built and deployed by separate teams?"
        → the same shape choice, answerable, and the options can name the split.

YOUR QUESTIONS MUST BE ABOUT THE USER'S ACTUAL DOMAIN. If a question could have been written
without reading their message, it is the wrong question. Do not reuse the example below — it
exists to show the SHAPE of a good question, and its subject matter is deliberately unrelated
to anything you are likely to be asked. Copying its wording is a failure.

Shape example — a request for "a warehouse stock tracker" might produce:
"questions": [
  {
    "header": "Stock accuracy",
    "question": "Does a stock count have to be correct the instant an item moves, or is a short delay acceptable?",
    "multiSelect": false,
    "options": [
      { "label": "Correct immediately", "description": "Every scan writes synchronously to one store, so that store is on the critical path for the whole floor." },
      { "label": "A short delay is fine", "description": "Scans queue and a worker reconciles counts, which survives a scanner losing signal but means the number on screen can lag." }
    ]
  }
]
Notice what makes it good: it asks about a REQUIREMENT (how fresh must this be), both answers
are defensible, and the two options imply visibly different diagrams — one has a queue and a
worker, the other does not.`
    : `STEP 2 — DECIDE: reply, or generate? You may NOT ask this turn.

Set "action" to "reply" or "generate" and leave "questions" empty. You asked on the previous
turn — you may not ask twice in a row. Act now.

Choose "reply" when the user is not asking for the diagram to change: a question about the
design, an opinion, thanks, or small talk. Answer properly in "summary", naming the actual
nodes, and leave "nodes"/"edges" empty. You are a collaborator, not a diagram vending machine.

Otherwise choose "generate": build or amend the diagram now, using whatever the user has told
you plus your own judgement for anything still open. Anything you had to guess goes in
"tradeoff" as a named assumption — and if the guess was a real fork, offer the other branch as
a suggestion so the user can flip it in one click. That is how you handle an open question
without stopping to ask one.`;

  return `You are ArchForge, an experienced system architect working alongside someone on a
shared architecture canvas. You have opinions, you explain your reasoning, and you push back
when a design smells wrong. The diagram is the artefact you work on together — it is not the
only thing you do. Talking is a first-class response.

You describe TOPOLOGY ONLY. You never choose positions, colours, sizes or shapes —
the client derives all of those from the node type. Do not emit them.

${canvas}
${observations}

STEP 1 — THINK FIRST, in the "thinking" field, before anything else.
A few sentences of plain prose, then one AUDIT line. In the prose:
- What is the user actually asking for — a change to the diagram, a question about it, or neither?
- If it is a change: which nodes exist AFTERWARDS, which go away, and how do the survivors
  connect once the removed ones are gone?
- Which ONE open decision would most change the SHAPE of this diagram, and could you pick a
  sensible answer yourself, or is it genuinely a coin flip?
- What is the weakest part of what you are about to draw — the thing that gives way first?
Reason honestly. If you notice yourself about to assume a technology, feature or scale the user
never mentioned, name that assumption here; you will have to state it later.

End "thinking" with exactly this line, filled in, with nothing after it:

AUDIT | wants: change|question|chitchat | nodes-now: <N> | nodes-after: <M or -> | open-fork: <short phrase or none> | default-safe: yes|no | action: reply|ask|generate

"nodes-now" is the node count in CURRENT CANVAS (0 if empty). "nodes-after" is how many you are
about to return, or "-" if none. "default-safe: yes" means you could settle the open fork
yourself and state it as an assumption without much risk of being wrong. Your "action" field
MUST be identical to the action in this line.

${decision}

ALLOWED NODE TYPES (use exactly one of these values for every node's "type"):
${typeGuide}

STEP 4 — IF GENERATING: build the graph, then name what it costs.
- Node count scales with described complexity. A simple system gets 5-12 nodes. A system with
  many distinct named modules gets one node per module — do not merge separate modules just to
  stay small. Up to 30 nodes for large multi-module systems.
- Do not pad a simple system with filler nodes to look detailed.
- Add edges to show data/request flow.
- Node IDs are unique short slugs, e.g. "api-gateway", "orders-db". Edge IDs are unique too.
- Every edge's source and target must be an id you also declared in "nodes".
- "label" is the human-readable name shown on the node, e.g. "Orders DB".

Then fill "tradeoff" — ONE sentence, at most 25 words, in this form:
  <a named part of THIS diagram> + <what gives way> + <under what condition>

Pick which one to name, in this order:
 1. If you guessed something structural the user never specified, name the guess.
 2. Otherwise, the thing that breaks FIRST as the system grows.
 3. Otherwise, the single point of failure everything routes through.

It must be FALSIFIABLE — a competent engineer should be able to read it and say "no, actually…".
Use "is" and "will", not "may", "might" or "could". Never open with "This design", "There are",
"It is important to", "Keep in mind" or "As with any".
  BAD:  "This design has trade-offs to consider."
  BAD:  "Consider the performance implications of the database."
  GOOD: "The single Postgres behind Orders and Reporting is your first bottleneck once reads outgrow writes."
  GOOD: "I assumed uploads can be processed asynchronously; if people expect instant playback, the queue and both workers come out."
  GOOD: "Payments Service calls Stripe inline, so a Stripe outage takes checkout down with it."
"tradeoff" is required when action is "generate". Leave it "" on reply and ask turns.
"summary" stays 1-2 sentences describing what you drew — do not repeat the tradeoff in it.

STEP 5 — SUGGESTIONS: what should happen next?
"suggestions" is 0-${MAX_SUGGESTIONS} items of { "label", "rationale" }. They render as clickable
chips, and CLICKING ONE SENDS ITS LABEL VERBATIM AS THE USER'S NEXT MESSAGE. Write every label
as a sentence the user would type to you.
- "label": an instruction in the user's voice, at most 8 words, no question mark. Never starts
  with "Consider", "Maybe", "You could" or "Think about". IT MUST NAME A NODE that appears in
  the diagram — by its label, not by category. "Cache the Orders DB reads", not "Add caching".
  A label that names no node is rejected before the user ever sees it.
- "rationale": one clause stating a fact about THIS diagram that makes the suggestion apply —
  something you could only say having seen it. Not a restatement of the label, and never a
  hedge: no "may", "might", "could benefit from" or "would improve".

Pick each from a different row. Never two from the same row:
  FORK   — the branch you did NOT take.        "Switch uploads to synchronous processing"
  DEPTH  — expand one named node into parts.   "Break Orders Service into checkout and fulfilment"
  STRESS — a named node's failure or scale.    "Show what happens when Stripe is down"
  SCOPE  — the neighbouring flow not drawn.    "Add the refund and chargeback path"
  CUT    — something not earning its place.    "Drop the CDN, nothing static is served here"

THE COVER TEST. Cover the diagram with your hand and read the suggestion. If it still makes
sense, it is generic — delete it. These are BANNED unless the rationale names a specific node
and a specific reason drawn from this diagram: "add caching", "add monitoring", "add logging",
"improve security", "add a load balancer", "consider scalability", "add error handling".
  BAD:  { "label": "Add caching", "rationale": "Caching improves performance." }
  GOOD: { "label": "Cache the product listing reads", "rationale": "Catalog Service reads Products DB on every page load and nothing else writes to it, so the cache would almost never be stale." }

ZERO IS OFTEN THE RIGHT ANSWER. Return "suggestions": [] when the turn was thanks, a greeting or
small talk; when you just asked a question; when the user clearly knows what they want next; or
when everything you can think of fails the cover test. Two good suggestions beat three. Zero
beats one that is filler — a chip nobody clicks is noise on every future turn. Never suggest
something you just did, or something already on the canvas.
  Example — the user said "thanks, that's exactly right":  "suggestions": []
If the canvas is empty and you are returning no nodes, anchor each suggestion to something the
USER said instead, in their words.

BEFORE YOU OUTPUT, check each line and fix anything that fails:
1. "thinking" ends with the AUDIT line, and "action" matches the action named there.
2. If generating: every edge's source and target is an id in "nodes"; no node is left
   unconnected; "tradeoff" is one falsifiable sentence naming a real part of THIS diagram.
3. If the user asked for something simpler or smaller: your node count is LOWER than nodes-now.
4. If asking: "suggestions", "nodes" and "edges" are empty, "tradeoff" is "", and every question
   has at least ${MIN_OPTIONS} options.
5. Every suggestion names something in your "nodes" or in CURRENT CANVAS, and would make no
   sense pasted under a different diagram.
6. Every suggestion "label" reads as a sentence the USER would type. No question marks.
7. Nothing you wrote reuses the wording of an example in this prompt.
8. You are emitting one JSON object and nothing else.

OUTPUT FORMAT:
Respond with ONLY a single JSON object (no prose, no markdown code fences, no explanation).
The keys appear in exactly this order — "thinking" first, "suggestions" last:
{
  "thinking": "your reasoning, ending with the AUDIT line",
  "action": "generate",
  "questions": [],
  "nodes": [ { "id": "api-gateway", "type": "api_gateway", "label": "API Gateway" } ],
  "edges": [ { "id": "edge-api-db", "source": "api-gateway", "target": "user-db", "label": "reads/writes" } ],
  "tradeoff": "one falsifiable sentence about this diagram",
  "summary": "1-2 sentences describing what you drew",
  "suggestions": [ { "label": "user-voice instruction", "rationale": "why, given this diagram" } ]
}
When "action" is "ask": same shape, "questions" populated, "nodes"/"edges"/"suggestions" empty
and "tradeoff" "". When "action" is "reply": your answer in "summary", "questions"/"nodes"/
"edges" empty, "tradeoff" "", "suggestions" optional.
Rules: "action" must be exactly "reply", "ask" or "generate"; "type" must be exactly one of the
allowed node types above; edge "label" is optional. Never include x, y, shape, colour or size.
Output nothing but the JSON object.`;
}

// Shapes as they arrive from the model: everything optional, nothing trusted.
//
// The short aliases (t/l/f/to) are the compact keys `serializeGraph` uses. Models tend to
// mirror whatever key style they were shown, and silently reading `undefined` there is
// expensive: an unknown type coerces every node to `service`, and an unknown endpoint
// makes every edge look dangling and get dropped. Accepting both spellings is cheap.
interface AiNode {
  id?: string;
  type?: string;
  t?: string;
  label?: string;
  l?: string;
}

interface AiEdge {
  id?: string;
  source?: string;
  f?: string;
  target?: string;
  to?: string;
  label?: string;
  l?: string;
}

interface AiOption {
  label?: string;
  description?: string;
}

interface AiSuggestion {
  label?: string;
  rationale?: string;
  /** ClarifyOption uses "description" in the same prompt, and models mirror what they are
   * shown — the same reason AiNode accepts `t`/`l`. Cheap to accept. */
  description?: string;
}

interface AiQuestion {
  header?: string;
  question?: string;
  multiSelect?: boolean;
  options?: AiOption[];
}

interface AiDesign {
  thinking?: string;
  action?: string;
  questions?: AiQuestion[];
  suggestions?: AiSuggestion[];
  nodes?: AiNode[];
  edges?: AiEdge[];
  tradeoff?: string;
  summary?: string;
}

/**
 * Model output → semantic records. Forgiving by design: a single bad field must never
 * cost the user a whole generation, so anything unusable is coerced or dropped rather
 * than thrown. Exported for tests — no HTTP server or live model required.
 */
export function validateDesign(design: AiDesign): {
  nodes: SemanticNode[];
  edges: SemanticEdge[];
} {
  const seen = new Set<string>();
  const nodes: SemanticNode[] = [];

  for (const n of design.nodes ?? []) {
    if (!n.id || seen.has(n.id)) continue; // missing or duplicate id
    seen.add(n.id);
    const rawType = n.type ?? n.t;
    let type: NodeType;
    if (isNodeType(rawType)) {
      type = rawType;
    } else {
      console.warn(
        `AI generate: unknown node type "${rawType}" on "${n.id}", coercing to service`,
      );
      type = "service";
    }
    nodes.push({
      id: n.id,
      type,
      label: (n.label ?? n.l)?.trim() || NODE_TYPE_REGISTRY[type].defaultLabel,
    });
  }

  const edges: SemanticEdge[] = [];
  const seenEdges = new Set<string>();

  for (const e of design.edges ?? []) {
    if (!e.id || seenEdges.has(e.id)) continue;
    const source = e.source ?? e.f;
    const target = e.target ?? e.to;
    if (!source || !target) continue;
    // A dangling edge is not a valid graph, and React Flow would render it as a
    // floating stub, so drop it here.
    if (!seen.has(source) || !seen.has(target)) continue;
    seenEdges.add(e.id);
    const label = e.label ?? e.l;
    edges.push(
      label
        ? { id: e.id, source, target, label }
        : { id: e.id, source, target },
    );
  }

  return { nodes, edges };
}

/**
 * Clarifying questions → renderable questions. Same forgiving contract as validateDesign:
 * a malformed question is dropped rather than thrown, because the caller's fallback is to
 * generate a design instead — always better for the user than an error. Exported for tests.
 */
export function validateQuestions(
  raw: AiQuestion[] | undefined,
): ClarifyQuestion[] {
  const questions: ClarifyQuestion[] = [];

  for (const q of raw ?? []) {
    if (questions.length >= MAX_QUESTIONS) break;
    const text = q.question?.trim();
    if (!text) continue;

    const options: ClarifyOption[] = [];
    const seenLabels = new Set<string>();
    for (const o of q.options ?? []) {
      if (options.length >= MAX_OPTIONS) break;
      const label = o.label?.trim();
      // A duplicate label renders as two identical, indistinguishable buttons.
      if (!label || seenLabels.has(label)) continue;
      seenLabels.add(label);
      options.push({ label, description: o.description?.trim() ?? "" });
    }
    // A question the user cannot meaningfully choose between is worse than no question.
    if (options.length < MIN_OPTIONS) continue;

    questions.push({
      header: q.header?.trim() || text.slice(0, 24),
      question: text,
      multiSelect: q.multiSelect === true,
      options,
    });
  }

  return questions;
}

/**
 * Advice that reads identically under any diagram. The model reaches for these when it has run
 * out of things to actually notice, and the prompt's ban alone does not hold — it name-drops a
 * real node in the rationale and considers the rule satisfied.
 *
 * This is deliberately a blocklist of vague ACTIONS rather than a check that the label names an
 * existing node. That check was tried and removed: it silently deleted good suggestions,
 * because FORK and SCOPE suggestions are by definition about things NOT on the canvas —
 * "Restore the Reporting Service" and "Show the password reset flow" both name nothing in the
 * current graph and were both worth offering. Genericness is a property of the verb, not of
 * whether the noun is already drawn.
 */
const GENERIC_LABEL = [
  /^add (some |a |an )?(caching|cache|monitoring|logging|observability|metrics|alerting|security|error handling|rate limiting|validation|tests?)\b/i,
  /^add (a |an )?\w+ (for|to) (caching|monitoring|logging|observability|security|scalability|performance|reliability|validation)\b/i,
  /^add (caching|monitoring|logging|observability|security) (for|to)\b/i,
  /^(improve|enhance|increase|optimi[sz]e|strengthen) (the )?(security|performance|scalability|reliability|availability|observability|error handling)\b/i,
  /^(consider|think about|look into|maybe|you could|perhaps) /i,
  /^switch to (a |an )?(distributed|scalable|microservices?|better|modern)\b/i,
  /^(make|keep) it (more )?(scalable|reliable|secure|performant|maintainable)\b/i,
];

/**
 * Suggested next moves → renderable chips. Same forgiving contract as validateQuestions, with
 * one extra hazard: the label is sent verbatim as the next user turn, so a malformed one becomes
 * a malformed prompt. Chips are garnish — dropping a bad one costs nothing, which is why every
 * rule here drops rather than repairs. Exported for tests.
 */
export function validateSuggestions(
  raw: AiSuggestion[] | undefined,
): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  for (const s of raw ?? []) {
    // Keep the first N: the prompt asks for most-valuable-first.
    if (out.length >= MAX_SUGGESTIONS) break;

    const label = s.label?.trim();
    if (!label) continue; // a blank chip is unclickable
    // Prose in the wrong field. Truncating would send a mid-word fragment as a prompt.
    if (label.length > MAX_SUGGESTION_LABEL) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue; // two near-identical chips waste the row

    const rationale = (s.rationale ?? s.description)?.trim() ?? "";

    if (GENERIC_LABEL.some((re) => re.test(label))) {
      console.warn(`AI generate: dropping boilerplate suggestion "${label}"`);
      continue;
    }

    seen.add(key);
    out.push({
      label,
      rationale: rationale.slice(0, MAX_SUGGESTION_RATIONALE),
    });
  }

  return out;
}

// Robustly pull a JSON object out of a model response. Handles models that wrap
// output in ```json fences or add stray prose/reasoning around the object.
function extractJson(raw: string): AiDesign {
  let text = raw.trim();
  // Strip a leading/trailing markdown code fence if present.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // Fall back to the substring between the first "{" and the last "}".
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
  return JSON.parse(text) as AiDesign;
}

/**
 * The canvas as the model sees it. Untrusted like everything else on the wire: shaped
 * defensively so a malformed body cannot reach the prompt as `undefined`. Exported for tests.
 */
export function readGraph(body: unknown): SerializedGraph | null {
  const { graph } = (body ?? {}) as { graph?: Partial<SerializedGraph> };
  if (!graph || !Array.isArray(graph.nodes)) return null;
  return {
    v: typeof graph.v === "number" ? graph.v : 0,
    nodes: graph.nodes.filter((n) => n && typeof n.id === "string"),
    edges: (Array.isArray(graph.edges) ? graph.edges : []).filter(
      (e) => e && typeof e.id === "string",
    ),
  };
}

/** Shared by both transcript readers, so they can never disagree about which turns exist —
 * a silent way for the ask rule to end up reading the wrong turn. */
function isUsableTurn(m: { content?: unknown } | null | undefined): boolean {
  return typeof m?.content === "string" && m.content.trim().length > 0;
}

/**
 * Normalises the request body into a conversation. Accepts `messages` (the whole transcript,
 * which is what makes a clarifying round possible — a lone prompt has nowhere to ask a
 * question into) and still accepts a bare `prompt` as a single-turn conversation.
 *
 * Note the explicit rebuild: only `role` and `content` survive. That is what guarantees the
 * client's `asked` bookkeeping can never leak into the provider payload — do not "simplify"
 * this into a spread. Exported for tests.
 */
export function readConversation(body: unknown): AiChatTurn[] {
  const { messages, prompt } = (body ?? {}) as {
    messages?: { role?: string; content?: string }[];
    prompt?: string;
  };

  if (Array.isArray(messages)) {
    return messages.filter(isUsableTurn).map((m) => ({
      // Anything that is not explicitly an assistant turn is treated as the user's.
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: (m.content as string).trim(),
    }));
  }

  return prompt?.trim() ? [{ role: "user", content: prompt.trim() }] : [];
}

/**
 * Did the assistant's most recent turn ask clarifying questions? The transcript the client
 * posts is role + content only, so the backend cannot see this for itself — the client tags
 * the turn it actually rendered.
 *
 * An absent tag is presumed YES. See `AiChatTurn.asked`: the failure mode of a lost or forged
 * tag must be less asking, never a question loop. Forgeability is not a concern here — the
 * whole transcript is already client-supplied and unverified (which is exactly why `role` is
 * coerced above), and the worst a forged value buys is one extra offered question round. This
 * guards pacing, not access; do not "harden" it into server-side state.
 *
 * Exported for tests.
 */
export function readAskedLast(body: unknown): boolean {
  const { messages } = (body ?? {}) as {
    messages?: { role?: string; asked?: boolean; content?: string }[];
  };
  if (!Array.isArray(messages)) return false;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    // `role !== "assistant"` must match readConversation's coercion byte for byte, so a
    // forged `role: "system"` turn is "not the assistant" to both readers.
    if (!isUsableTurn(m) || m?.role !== "assistant") continue;
    return m.asked !== false;
  }
  // No assistant turn yet: the opening move may always ask.
  return false;
}

router.post("/generate", async (req, res) => {
  // Every exit goes through here, typed against the shared contract, so a branch that
  // forgets a newly added field is a compile error rather than a field the client silently
  // reads as undefined. There is no test asserting the response body; this is the guard.
  const send = (body: GenerateResponse) => res.json(body);

  try {
    const conversation = readConversation(req.body);
    if (conversation.length === 0) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const graph = readGraph(req.body);

    // Questions are allowed mid-conversation: a request to change an existing diagram can be
    // exactly as underspecified as the first one ("add payments", "make it faster"). Counting
    // user turns used to be the proxy for "don't loop", but it also banned every later
    // question including the useful ones — and the old non-empty-canvas clause banned them
    // twice over, since after the first turn there is always a canvas.
    //
    // The one rule still enforced in CODE, never left to the model to count, is that it may
    // not ask twice in a row: no second question until the user has seen an answer.
    const allowClarify = !readAskedLast(req.body);

    const completion = await getClient().chat.completions.create({
      model: MODEL,
      // Low: the load-bearing behaviour is reproducing existing node ids byte-identically and
      // filling a fixed JSON shape, neither of which is a creativity task. Suggestion variety
      // comes from the five-row menu in the prompt, not from sampling.
      temperature: 0.3,
      // Generous budget: the thinking phase and a full design both come out of this, so a
      // small cap truncates the JSON mid-object and the whole turn fails to parse.
      max_tokens: 8192,
      messages: [
        { role: "system", content: buildSystemPrompt(allowClarify, graph) },
        ...conversation,
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    let design: AiDesign;
    try {
      design = extractJson(raw);
    } catch {
      // A 200 rather than a 500 on purpose. The client turns a failed request into an
      // assistant message, which then lives in the transcript and is resent to the model
      // on every later turn — so a 500 teaches the model to mirror its own failure. A
      // truncated response is the usual cause; the canvas must not move either way.
      console.error(
        "AI generate: failed to parse JSON. Raw model output:\n",
        raw,
      );
      send({
        applied: false,
        questions: [],
        suggestions: [],
        nodes: [],
        edges: [],
        summary:
          "That reply came back garbled, so I've left the canvas alone. Try again?",
      });
      return;
    }

    const thinking = design.thinking?.trim() || undefined;

    if (design.action === "ask" && allowClarify) {
      const questions = validateQuestions(design.questions);
      if (questions.length > 0) {
        send({
          thinking,
          applied: false,
          questions,
          // Deliberately empty: the question card IS this turn's "what next" affordance. A
          // chip beside it competes with the options, and clicking one would silently discard
          // any picks already made, since the round stops being the last message.
          suggestions: [],
          nodes: [],
          edges: [],
          summary:
            design.summary?.trim() ||
            "A couple of questions before I draw this:",
        });
        return;
      }
    }

    // ONLY a genuine "generate" may touch the canvas.
    //
    // This used to be a fall-through: anything that was not a handled "ask" or "reply" —
    // a vetoed ask, an ask whose questions failed validation, a typo'd or missing action —
    // landed on validateDesign, which returns an empty design for an ask-shaped object,
    // and shipped it as `applied: true`. The client then diffed an empty graph against a
    // populated one and removed EVERY node, for everyone in the room, with no undo. The
    // old comment defended that as "better than a dead end", which was true only while the
    // canvas was always empty. Falling back to prose strands nobody.
    if (design.action !== "generate") {
      send({
        thinking,
        applied: false,
        questions: [],
        // A conversational turn is a fine place to offer a next move; the canvas the
        // suggestions must reference is the one already on screen.
        suggestions: validateSuggestions(design.suggestions),
        nodes: [],
        edges: [],
        summary:
          design.summary?.trim() ||
          "Happy to help — what would you like to change?",
      });
      return;
    }

    // Semantic records only — the client derives shape, colour, size and position.
    const { nodes, edges } = validateDesign(design);

    // An empty design against a populated canvas is far more likely a truncated or
    // malformed response than a deliberate "delete everything" — and the two are
    // indistinguishable here, so treat the ambiguity as the non-destructive case.
    // Clearing the board is better served by an explicit action than by a silent wipe.
    if (nodes.length === 0 && (graph?.nodes.length ?? 0) > 0) {
      console.warn(
        "AI generate: empty design against a non-empty canvas — not applying.",
      );
      send({
        thinking,
        applied: false,
        questions: [],
        suggestions: [],
        nodes: [],
        edges: [],
        summary:
          "I didn't get a usable design back that time, so I've left the canvas alone. Try rephrasing?",
      });
      return;
    }

    send({
      thinking,
      applied: true,
      questions: [],
      suggestions: validateSuggestions(design.suggestions),
      nodes,
      edges,
      tradeoff: design.tradeoff?.trim() || undefined,
      summary: design.summary?.trim() || "Design applied to canvas.",
    });
  } catch (error) {
    console.error("AI generate error:", error);
    res.status(500).json({ error: "Failed to generate architecture" });
  }
});

export default router;
