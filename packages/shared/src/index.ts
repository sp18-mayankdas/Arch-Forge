export * from "./presentation";
export * from "./node-types";
export * from "./semantic";

import type { NodeType } from "./node-types";

// React Flow's data generic requires an index signature, hence the
// `extends Record<string, unknown>` on both.
//
// Shape and colour are NOT stored here — they are derived from `type` via
// NODE_TYPE_REGISTRY. Position is not stored here either; it lives in the Yjs
// `positions` map, outside the semantic layer.
export interface CanvasNodeData extends Record<string, unknown> {
  label: string;
  type: NodeType;
}

export interface CanvasEdgeData extends Record<string, unknown> {
  label?: string;
}
