import { Router } from "express";
import JSZip from "jszip";
import {
  generateScaffoldFiles,
  isNodeType,
  type NodeType,
  type SemanticNode,
  type SemanticEdge,
} from "@archforge/shared";

const router = Router();

// Shapes as they arrive from the wire: nothing trusted, same defensive posture as
// readGraph/validateDesign in ai.ts.
interface RawNode {
  id?: string;
  type?: string;
  label?: string;
}

interface RawEdge {
  id?: string;
  source?: string;
  target?: string;
  label?: string;
}

/**
 * Model/wire output -> semantic records. An unknown type is coerced to "service" rather than
 * dropped — one bad field must never cost the whole export, mirroring validateDesign in ai.ts.
 * Exported for tests.
 */
export function readNodes(raw: unknown): SemanticNode[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const nodes: SemanticNode[] = [];
  for (const n of raw as RawNode[]) {
    if (!n?.id || seen.has(n.id)) continue;
    seen.add(n.id);
    const type: NodeType = isNodeType(n.type) ? n.type : "service";
    nodes.push({ id: n.id, type, label: n.label?.trim() || n.id });
  }
  return nodes;
}

/** Exported for tests. */
export function readEdges(raw: unknown): SemanticEdge[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const edges: SemanticEdge[] = [];
  for (const e of raw as RawEdge[]) {
    if (!e?.id || seen.has(e.id) || !e.source || !e.target) continue;
    seen.add(e.id);
    edges.push(e.label ? { id: e.id, source: e.source, target: e.target, label: e.label } : { id: e.id, source: e.source, target: e.target });
  }
  return edges;
}

function slugifyName(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "archforge-scaffold";
}

router.post("/scaffold", async (req, res) => {
  try {
    const { nodes: rawNodes, edges: rawEdges, projectName } = (req.body ?? {}) as {
      nodes?: unknown;
      edges?: unknown;
      projectName?: unknown;
    };

    if (!Array.isArray(rawNodes)) {
      res.status(400).json({ error: "nodes is required" });
      return;
    }

    const nodes = readNodes(rawNodes);
    const edges = readEdges(rawEdges);
    const name = typeof projectName === "string" && projectName.trim() ? projectName.trim() : undefined;

    const files = generateScaffoldFiles(nodes, edges, name);

    const zip = new JSZip();
    for (const file of files) zip.file(file.path, file.contents);
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    const filename = `${slugifyName(name ?? "archforge-scaffold")}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error("scaffold generate error:", error);
    res.status(500).json({ error: "Failed to generate scaffold" });
  }
});

export default router;
