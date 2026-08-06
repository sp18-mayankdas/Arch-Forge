import * as Y from "yjs";
import type { SemanticNode, SemanticEdge, SemanticOp } from "@archforge/shared";

export interface Position {
  x: number;
  y: number;
}

/**
 * The document's four structures.
 *
 *   nodes / edges  — SEMANTIC. What the AI reads.
 *   positions      — PRESENTATION. Synced so drags propagate, but the serializer
 *                    has no access to it, so a coordinate cannot reach a prompt.
 *   ops            — append-only semantic log. `ops.length` IS the version counter;
 *                    a mutable number would undercount under concurrent edits.
 */
export function getMaps(doc: Y.Doc) {
  return {
    nodesMap: doc.getMap<Y.Map<unknown>>("nodes"),
    edgesMap: doc.getMap<Y.Map<unknown>>("edges"),
    positionsMap: doc.getMap<Position>("positions"),
    opsArray: doc.getArray<SemanticOp>("ops"),
  };
}

/**
 * The ONLY writer of nodes/edges/ops. Every semantic mutation and its op record land
 * in one transaction, so `ops.length` can never disagree with the graph.
 */
export function applyOps(doc: Y.Doc, ops: SemanticOp[]): void {
  if (ops.length === 0) return;
  const { nodesMap, edgesMap, positionsMap, opsArray } = getMaps(doc);

  doc.transact(() => {
    for (const op of ops) {
      switch (op.op) {
        case "add_node": {
          const m = new Y.Map<unknown>();
          m.set("id", op.id);
          m.set("type", op.type);
          m.set("label", op.label);
          nodesMap.set(op.id, m);
          break;
        }
        case "add_edge": {
          const m = new Y.Map<unknown>();
          m.set("id", op.id);
          m.set("source", op.source);
          m.set("target", op.target);
          if (op.label) m.set("label", op.label);
          edgesMap.set(op.id, m);
          break;
        }
        case "set_label":
          nodesMap.get(op.id)?.set("label", op.label);
          break;
        case "set_type":
          nodesMap.get(op.id)?.set("type", op.type);
          break;
        case "remove_node": {
          nodesMap.delete(op.id);
          // Same transaction, or the presentation map orphans a dead node's position.
          positionsMap.delete(op.id);
          // Dangling edges are not a valid graph state, so sweep them here rather
          // than making every reader filter for them.
          for (const [edgeId, e] of edgesMap.entries()) {
            if (e.get("source") === op.id || e.get("target") === op.id) {
              edgesMap.delete(edgeId);
            }
          }
          break;
        }
        case "remove_edge":
          edgesMap.delete(op.id);
          break;
      }
      opsArray.push([op]);
    }
  });
}

/**
 * Presentation-only writer. Appends NO op — this is precisely why dragging a node
 * cannot bump the version or trigger an AI call.
 */
export function setPositions(doc: Y.Doc, positions: Record<string, Position>): void {
  const { positionsMap } = getMaps(doc);
  doc.transact(() => {
    for (const [id, p] of Object.entries(positions)) positionsMap.set(id, p);
  });
}

export function readSemanticGraph(doc: Y.Doc): {
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  version: number;
} {
  const { nodesMap, edgesMap, opsArray } = getMaps(doc);
  return {
    nodes: Array.from(nodesMap.values()).map(
      (m) => Object.fromEntries(m.entries()) as unknown as SemanticNode
    ),
    edges: Array.from(edgesMap.values()).map(
      (m) => Object.fromEntries(m.entries()) as unknown as SemanticEdge
    ),
    version: opsArray.length,
  };
}
