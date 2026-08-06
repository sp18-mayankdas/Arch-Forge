import { Router } from "express";
import OpenAI, { AzureOpenAI } from "openai";
import {
  NODE_TYPES,
  NODE_TYPE_REGISTRY,
  isNodeType,
  type NodeType,
  type SemanticNode,
  type SemanticEdge,
} from "@archforge/shared";

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
    baseURL =
      process.env.GROQ_AI_BASE_URL ?? "https://api.groq.com/openai/v1";
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
    ? process.env.AZURE_OPENAI_DEPLOYMENT ?? ""
    : PROVIDER === "nvidia"
      ? process.env.NVIDIA_AI_MODEL ?? "meta/llama-3.3-70b-instruct"
      : PROVIDER === "groq"
        ? process.env.GROQ_AI_MODEL ?? "llama-3.3-70b-versatile"
        : process.env.AI_MODEL ?? "";

function buildSystemPrompt(): string {
  const typeGuide = NODE_TYPES.map(
    (t) => `- ${t} → ${NODE_TYPE_REGISTRY[t].defaultLabel}`,
  ).join("\n");

  return `You are ArchForge, an expert system architect that generates technical architecture diagrams.

You describe TOPOLOGY ONLY. You never choose positions, colours, sizes or shapes —
the client derives all of those from the node type. Do not emit them.

ALLOWED NODE TYPES (use the exact value on the left):
${typeGuide}

GENERATION RULES:
- Node count scales with described complexity. A simple system gets 5-12 nodes. A system
  describing many distinct modules/services (e.g. 8-10+ named features) gets one node per
  distinct module — do not merge separate modules into one node just to stay small. Up to
  30 nodes for large multi-module systems.
- Do not pad a simple system with filler nodes to look detailed.
- Add edges to show data/request flow
- Node IDs must be unique short slugs e.g. "api-gateway", "user-db"
- Edge IDs must be unique e.g. "edge-api-db"
- Every edge's source and target must be an id you also declared in "nodes"
- "label" is the human-readable name shown on the node, e.g. "Orders DB"

WHEN TO GENERATE (IMPORTANT):
- Only produce nodes/edges when the user is actually describing or asking you to design or modify a
  software/system architecture.
- If the message is a greeting, small talk, a question about you, unclear, or NOT an architecture
  request (e.g. "hi", "hello", "what can you do?"), return "nodes": [] and "edges": [] and put a short,
  friendly one-line reply in "summary" inviting them to describe a system. Do NOT invent an
  architecture in that case.

OUTPUT FORMAT:
Respond with ONLY a single JSON object (no prose, no markdown code fences, no explanation)
matching exactly this shape:
{
  "nodes": [
    { "id": "api-gateway", "type": "api_gateway", "label": "API Gateway" }
  ],
  "edges": [
    { "id": "edge-api-db", "source": "api-gateway", "target": "user-db", "label": "reads/writes" }
  ],
  "summary": "1-2 sentence description of the architecture"
}
Rules: "type" must be exactly one of the allowed node types listed above; "label" on edges is
optional. Never include x, y, shape, colour or size. Output nothing but the JSON object.`;
}

// Shapes as they arrive from the model: everything optional, nothing trusted.
interface AiNode {
  id?: string;
  type?: string;
  label?: string;
}

interface AiEdge {
  id?: string;
  source?: string;
  target?: string;
  label?: string;
}

interface AiDesign {
  nodes?: AiNode[];
  edges?: AiEdge[];
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
    let type: NodeType;
    if (isNodeType(n.type)) {
      type = n.type;
    } else {
      console.warn(
        `AI generate: unknown node type "${n.type}" on "${n.id}", coercing to service`,
      );
      type = "service";
    }
    nodes.push({
      id: n.id,
      type,
      label: n.label?.trim() || NODE_TYPE_REGISTRY[type].defaultLabel,
    });
  }

  const edges: SemanticEdge[] = [];
  const seenEdges = new Set<string>();

  for (const e of design.edges ?? []) {
    if (!e.id || seenEdges.has(e.id)) continue;
    if (!e.source || !e.target) continue;
    // A dangling edge is not a valid graph, and React Flow would render it as a
    // floating stub, so drop it here.
    if (!seen.has(e.source) || !seen.has(e.target)) continue;
    seenEdges.add(e.id);
    edges.push(
      e.label
        ? { id: e.id, source: e.source, target: e.target, label: e.label }
        : { id: e.id, source: e.source, target: e.target },
    );
  }

  return { nodes, edges };
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

router.post("/generate", async (req, res) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt?.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const completion = await getClient().chat.completions.create({
      model: MODEL,
      temperature: 0.6,
      // Generous budget: reasoning-style models spend tokens on a think phase
      // before emitting the JSON, so a small cap can truncate the answer.
      max_tokens: 8192,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    let design: AiDesign;
    try {
      design = extractJson(raw);
    } catch (parseErr) {
      console.error(
        "AI generate: failed to parse JSON. Raw model output:\n",
        raw,
      );
      throw parseErr;
    }

    // Semantic records only — the client derives shape, colour, size and position.
    const { nodes, edges } = validateDesign(design);

    const summary = design.summary ?? "Design applied to canvas.";

    res.json({ nodes, edges, summary });
  } catch (error) {
    console.error("AI generate error:", error);
    res.status(500).json({ error: "Failed to generate architecture" });
  }
});

export default router;
