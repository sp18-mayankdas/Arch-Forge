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
  FocusSelection,
  GenerateRequest,
  GenerateResponse,
} from "@archforge/shared";
export type { FocusRef, PeerMark } from "@/lib/focus";

// These stay local — they depend on @xyflow/react.
import type { Node, Edge } from "@xyflow/react";
import type {
  CanvasNodeData,
  CanvasEdgeData,
  ClarifyQuestion,
  Suggestion,
} from "@archforge/shared";
import type { FocusRef } from "@/lib/focus";

export type CanvasNode = Node<CanvasNodeData, "canvasNode">;
export type CanvasEdge = Edge<CanvasEdgeData, "canvasEdge">;

export interface UserAwareness {
  userId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  /**
   * Node ids this peer has marked as the scope of their next AI prompt. Ephemeral and
   * per-viewer, exactly like `cursor`: intent rather than document content, so it lives in
   * awareness instead of the Yjs maps and is garbage-collected when the peer disconnects.
   *
   * Ids only — resolving them to labels is the reader's job. A second copy of the label here
   * would drift the moment somebody renamed the node.
   */
  focus: string[];
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
  /**
   * The nodes the sender had marked when this turn went out. Snapshotted WITH labels rather
   * than as bare ids, because the node may be renamed or deleted later and a replayed
   * transcript must still say what was focused AT THE TIME.
   *
   * Display only. `toChatHistory` rebuilds every turn from role and content, so this never
   * reaches the provider — the live scope crosses the wire on `GenerateRequest.focus`
   * instead. It must never be folded into `content`, which is resent on every later turn and
   * would keep steering the model after the user deselected.
   */
  focus?: FocusRef[];
}
