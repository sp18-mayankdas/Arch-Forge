import { Router } from "express";
import OpenAI, { AzureOpenAI } from "openai";
import { NODE_COLORS, SHAPE_DEFAULTS, type NodeShape } from "@archforge/shared";

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

const COLOR_NAMES = ["neutral", "blue", "purple", "orange", "red", "pink", "green", "teal"];

function buildSystemPrompt(): string {
  const colorGuide = NODE_COLORS.map(
    (c, i) => `  ${i} (${COLOR_NAMES[i]}): fill=${c.fill} text=${c.text}`
  ).join("\n");

  return `You are ArchForge, an expert system architect that generates technical architecture diagrams.

ALLOWED SHAPES:
- rectangle  → services, APIs, microservices, components
- cylinder   → databases, storage, caches
- hexagon    → external systems, third-party services, boundaries
- circle     → events, triggers, endpoints, user entry-points
- diamond    → decision gateways, conditionals
- pill       → processes, workflows, jobs

COLOR PALETTE (colorIndex 0-7):
${colorGuide}
Recommended mapping:
- 1 (blue)   → APIs, services, servers
- 7 (teal)   → databases, storage
- 3 (orange) → message queues, brokers, async flows
- 6 (green)  → success paths, healthy services, CDN
- 2 (purple) → auth, security, identity
- 5 (pink)   → user-facing UI, clients
- 0 (neutral)→ generic / unclassified

LAYOUT RULES:
- Start top-left at approximately x=100, y=80
- Horizontal gap between sibling nodes: 240-280px
- Vertical gap between rows: 160-200px
- Group related nodes in horizontal rows
- Node IDs must be unique short slugs e.g. "api-gateway", "user-db"
- Edge IDs must be unique e.g. "edge-api-db"

GENERATION RULES:
- Create 5-12 nodes; do not overcrowd
- Add edges to show data/request flow
- Prefer clear left-to-right or top-to-bottom flows

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
    { "id": "api-gateway", "label": "API Gateway", "shape": "rectangle", "colorIndex": 1, "x": 100, "y": 80 }
  ],
  "edges": [
    { "id": "edge-api-db", "source": "api-gateway", "target": "user-db", "label": "reads/writes" }
  ],
  "summary": "1-2 sentence description of the architecture"
}
Rules: "shape" must be one of the allowed shapes; "colorIndex" is an integer 0-7;
"x"/"y" are numbers; "label" on edges is optional. Output nothing but the JSON object.`;
}

interface AiNode {
  id: string;
  label: string;
  shape: string;
  colorIndex: number;
  x: number;
  y: number;
}

interface AiEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface AiDesign {
  nodes?: AiNode[];
  edges?: AiEdge[];
  summary?: string;
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
      console.error("AI generate: failed to parse JSON. Raw model output:\n", raw);
      throw parseErr;
    }

    const nodes = (design.nodes ?? []).map((n) => {
      const ci = Math.min(Math.max(Math.round(n.colorIndex ?? 0), 0), NODE_COLORS.length - 1);
      const color = NODE_COLORS[ci];
      const size = SHAPE_DEFAULTS[n.shape as NodeShape] ?? SHAPE_DEFAULTS.rectangle;
      return {
        id: n.id,
        type: "canvasNode" as const,
        position: { x: n.x, y: n.y },
        data: { label: n.label, color: color.fill, textColor: color.text, shape: n.shape },
        width: size.width,
        height: size.height,
      };
    });

    const edges = (design.edges ?? []).map((e) => ({
      id: e.id,
      type: "canvasEdge" as const,
      source: e.source,
      target: e.target,
      data: { label: e.label ?? "" },
      markerEnd: { type: "arrowclosed", color: "rgba(255,255,255,0.4)", width: 16, height: 16 },
    }));

    const summary = design.summary ?? "Design applied to canvas.";

    res.json({ nodes, edges, summary });
  } catch (error) {
    console.error("AI generate error:", error);
    res.status(500).json({ error: "Failed to generate architecture" });
  }
});

export default router;
