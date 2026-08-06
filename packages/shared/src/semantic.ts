import type { NodeType } from "./node-types";

/** A node as the semantic layer knows it. No coordinates, no colours, no size. */
export interface SemanticNode {
  id: string;
  type: NodeType;
  label: string;
}

export interface SemanticEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

/**
 * The closed op vocabulary. Deliberately expressive enough to describe a MUTATION
 * and not only an append: Ghost's surgical edits are deferred, but the format has to
 * support them already so it does not need a breaking change when they land.
 */
export type SemanticOp =
  | { op: "add_node"; id: string; type: NodeType; label: string }
  | { op: "add_edge"; id: string; source: string; target: string; label?: string }
  | { op: "set_label"; id: string; label: string }
  | { op: "set_type"; id: string; type: NodeType }
  | { op: "remove_node"; id: string }
  | { op: "remove_edge"; id: string };

export interface SerializedGraph {
  v: number;
  nodes: { id: string; t: NodeType; l: string }[];
  edges: { id: string; f: string; to: string; l?: string }[];
}

/**
 * The only thing an LLM ever sees of the graph. Short keys because this goes into a
 * prompt on every call.
 */
export function serializeGraph(
  nodes: SemanticNode[],
  edges: SemanticEdge[],
  version: number
): SerializedGraph {
  return {
    v: version,
    // Fields are picked explicitly, never spread. A spread would carry presentation
    // keys straight into a prompt the moment a caller passes a React Flow node.
    nodes: nodes.map((n) => ({ id: n.id, t: n.type, l: n.label })),
    edges: edges.map((e) =>
      e.label
        ? { id: e.id, f: e.source, to: e.target, l: e.label }
        : { id: e.id, f: e.source, to: e.target }
    ),
  };
}
