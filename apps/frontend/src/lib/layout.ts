import dagre from "@dagrejs/dagre";
import {
  NODE_TYPE_REGISTRY,
  SHAPE_DEFAULTS,
  type SemanticNode,
  type SemanticEdge,
  type NodeType,
} from "@archforge/shared";

const RANKDIR = "LR";
const RANKSEP = 160;
const NODESEP = 80;

function sizeOf(type: NodeType) {
  const spec = NODE_TYPE_REGISTRY[type] ?? NODE_TYPE_REGISTRY.service;
  const { width, height } = SHAPE_DEFAULTS[spec.shape];
  // A FRESH object per node, never the shared SHAPE_DEFAULTS entry: dagre writes the
  // computed x/y back into the node label it was given. Passing the shared object
  // makes every node of the same shape alias one label and collapse to one point.
  return { width, height };
}

/**
 * Semantic graph in, coordinates out. This is the only place in the app that turns
 * topology into pixels, which is what keeps coordinates out of the AI contract
 * entirely — the model never sends or receives a position.
 */
export function layoutGraph(
  nodes: SemanticNode[],
  edges: SemanticEdge[]
): Record<string, { x: number; y: number }> {
  if (nodes.length === 0) return {};

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: RANKDIR, ranksep: RANKSEP, nodesep: NODESEP });
  g.setDefaultEdgeLabel(() => ({}));

  const known = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, sizeOf(n.type));
  // Handing dagre an edge to an unknown id makes it invent a zero-size node, which
  // then surfaces as a position for a node that does not exist.
  for (const e of edges) {
    if (known.has(e.source) && known.has(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const out: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const laid = g.node(n.id);
    // dagre reports CENTRES; React Flow positions from top-left.
    out[n.id] = { x: laid.x - laid.width / 2, y: laid.y - laid.height / 2 };
  }
  return out;
}
