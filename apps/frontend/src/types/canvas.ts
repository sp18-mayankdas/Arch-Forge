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
  SerializedGraph,
  ClarifyQuestion,
  ClarifyOption,
  AiChatTurn,
  Suggestion,
  GenerateRequest,
  GenerateResponse,
} from "@archforge/shared";

// These stay local — they depend on @xyflow/react.
import type { Node, Edge } from "@xyflow/react";
import type {
  CanvasNodeData,
  CanvasEdgeData,
  ClarifyQuestion,
  Suggestion,
} from "@archforge/shared";

export type CanvasNode = Node<CanvasNodeData, "canvasNode">;
export type CanvasEdge = Edge<CanvasEdgeData, "canvasEdge">;

export interface UserAwareness {
  userId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
}

// AI chat messages, stored in the shared Yjs doc so they sync across the room
// and survive reloads (see lib/yjs.ts + hooks/useYjsSync.ts).
//
// Every field a turn renders lives here rather than in component state: the transcript
// is shared, so a peer who joins later — or the same peer after a reload — must be able
// to redraw the turn exactly as it first appeared, questions and all. A message is
// append-only and never edited, so the nested objects are stored as plain JSON rather
// than nested Y types; there is nothing here for the CRDT to merge.
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** The model's reasoning for this turn; shown collapsed. */
  thinking?: string;
  /** Present only on a clarifying turn — rendered as pickable options. */
  questions?: ClarifyQuestion[];
  /** Proposed next moves; clicking one sends its label. */
  suggestions?: Suggestion[];
  /** The one thing this design costs. Present only on a generated design. */
  tradeoff?: string;
  /** Present only when the canvas actually changed. */
  change?: { total: number; delta: number };
}
