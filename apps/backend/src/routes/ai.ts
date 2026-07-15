import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { NODE_COLORS, SHAPE_DEFAULTS, type NodeShape } from "@archforge/shared";

const router = Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
- Prefer clear left-to-right or top-to-bottom flows`;
}

const tools: Anthropic.Tool[] = [
  {
    name: "add_node",
    description: "Add a new node to the architecture canvas",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: 'Unique slug ID e.g. "api-gateway", "user-db"' },
        label: { type: "string", description: "Display label for the node" },
        shape: {
          type: "string",
          enum: ["rectangle", "diamond", "circle", "pill", "cylinder", "hexagon"],
          description: "Node shape",
        },
        colorIndex: {
          type: "number",
          description: "Color palette index 0-7",
          minimum: 0,
          maximum: 7,
        },
        x: { type: "number", description: "X position in pixels" },
        y: { type: "number", description: "Y position in pixels" },
      },
      required: ["id", "label", "shape", "colorIndex", "x", "y"],
    },
  },
  {
    name: "add_edge",
    description: "Add a directed edge between two nodes",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: 'Unique edge ID e.g. "edge-api-db"' },
        source: { type: "string", description: "Source node ID" },
        target: { type: "string", description: "Target node ID" },
        label: { type: "string", description: "Optional edge label" },
      },
      required: ["id", "source", "target"],
    },
  },
  {
    name: "finalize_design",
    description: "Complete the design — call this last with a summary",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "1-2 sentence description of the architecture designed",
        },
      },
      required: ["summary"],
    },
  },
];

interface AddNodeInput {
  id: string;
  label: string;
  shape: string;
  colorIndex: number;
  x: number;
  y: number;
}

interface AddEdgeInput {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface FinalizeInput {
  summary: string;
}

router.post("/generate", async (req, res) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt?.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: `Design this architecture on the canvas: ${prompt}\n\nCall add_node for each node, add_edge for each connection, then finalize_design with a summary.`,
        },
      ],
      tools,
      tool_choice: { type: "auto" },
    });

    const nodes: Array<{
      id: string;
      type: "canvasNode";
      position: { x: number; y: number };
      data: { label: string; color: string; textColor: string; shape: string };
      width: number;
      height: number;
    }> = [];

    const edges: Array<{
      id: string;
      type: "canvasEdge";
      source: string;
      target: string;
      data: { label: string };
      markerEnd: { type: string; color: string; width: number; height: number };
    }> = [];

    let summary = "Design applied to canvas.";

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      if (block.name === "add_node") {
        const input = block.input as AddNodeInput;
        const ci = Math.min(Math.max(Math.round(input.colorIndex ?? 0), 0), NODE_COLORS.length - 1);
        const color = NODE_COLORS[ci];
        const size = SHAPE_DEFAULTS[input.shape as NodeShape] ?? SHAPE_DEFAULTS.rectangle;
        nodes.push({
          id: input.id,
          type: "canvasNode",
          position: { x: input.x, y: input.y },
          data: { label: input.label, color: color.fill, textColor: color.text, shape: input.shape },
          width: size.width,
          height: size.height,
        });
      } else if (block.name === "add_edge") {
        const input = block.input as AddEdgeInput;
        edges.push({
          id: input.id,
          type: "canvasEdge",
          source: input.source,
          target: input.target,
          data: { label: input.label ?? "" },
          markerEnd: { type: "arrowclosed", color: "rgba(255,255,255,0.4)", width: 16, height: 16 },
        });
      } else if (block.name === "finalize_design") {
        const input = block.input as FinalizeInput;
        summary = input.summary;
      }
    }

    res.json({ nodes, edges, summary });
  } catch (error) {
    console.error("AI generate error:", error);
    res.status(500).json({ error: "Failed to generate architecture" });
  }
});

export default router;
