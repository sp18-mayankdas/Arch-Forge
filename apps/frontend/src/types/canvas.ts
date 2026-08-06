// Canvas types/constants shared with the backend live in @archforge/shared —
// single source of truth. Re-exported here so existing local imports keep working.
export {
  NODE_SHAPES,
  NODE_COLORS,
  SHAPE_DEFAULTS,
  NODE_TYPES,
  NODE_TYPE_REGISTRY,
  isNodeType,
  serializeGraph,
} from "@archforge/shared";
export type {
  NodeShape,
  NodeType,
  NodeTypeSpec,
  CanvasNodeData,
  CanvasEdgeData,
  SemanticNode,
  SemanticEdge,
  SemanticOp,
} from "@archforge/shared";

// These stay local — they depend on @xyflow/react.
import type { Node, Edge } from "@xyflow/react";
import type { CanvasNodeData, CanvasEdgeData } from "@archforge/shared";

export type CanvasNode = Node<CanvasNodeData, "canvasNode">;
export type CanvasEdge = Edge<CanvasEdgeData, "canvasEdge">;

export interface UserAwareness {
  userId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
}
