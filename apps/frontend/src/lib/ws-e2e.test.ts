// Integration check against a running backend on :3001. It exercises the doc layout
// over the REAL y-websocket relay rather than two in-memory docs, which is the only
// way to catch a structure that syncs incorrectly between peers.
//
// Skips itself when no backend is up, so `pnpm test` stays green without one.
// Start the backend (`pnpm dev:backend`) to actually run it.
import { it, expect } from "vitest";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { applyOps, setPositions, getMaps, readSemanticGraph } from "./semantic-ops";

function waitFor(predicate: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timeout: ${label}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

const backendUp = await fetch("http://localhost:3001/health")
  .then((r) => r.ok)
  .catch(() => false);

it.skipIf(!backendUp)("syncs the semantic layer and keeps positions out of the version", async () => {
  // Fresh room per run so a leftover document on the relay cannot affect assertions.
  const room = `e2e-${Math.random().toString(36).slice(2, 10)}`;
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const opts = { connect: true }; // Node 22 provides a global WebSocket
  const p1 = new WebsocketProvider("ws://localhost:3001", room, doc1, opts);
  const p2 = new WebsocketProvider("ws://localhost:3001", room, doc2, opts);

  try {
    await waitFor(() => p1.wsconnected && p2.wsconnected, "both peers connected");

    // --- semantic write on peer 1 propagates to peer 2 ---
    applyOps(doc1, [
      { op: "add_node", id: "a", type: "api_gateway", label: "API Gateway" },
      { op: "add_node", id: "b", type: "sql_db", label: "Orders DB" },
      { op: "add_edge", id: "e1", source: "a", target: "b", label: "sql" },
    ]);
    await waitFor(() => getMaps(doc2).nodesMap.size === 2, "peer 2 received 2 nodes");

    const g2 = readSemanticGraph(doc2);
    expect(g2.version).toBe(3);
    expect(g2.nodes.map((n) => n.type).sort()).toEqual(["api_gateway", "sql_db"]);
    expect(g2.edges).toHaveLength(1);

    // --- position write propagates but does NOT bump the version ---
    setPositions(doc1, { a: { x: 42, y: 7 } });
    await waitFor(() => getMaps(doc2).positionsMap.has("a"), "peer 2 received the position");
    expect(getMaps(doc2).positionsMap.get("a")).toEqual({ x: 42, y: 7 });
    expect(readSemanticGraph(doc2).version).toBe(3); // unchanged by the drag

    // --- removing a node sweeps its edge and its position on the remote peer ---
    applyOps(doc1, [{ op: "remove_node", id: "a" }]);
    await waitFor(() => getMaps(doc2).nodesMap.size === 1, "peer 2 saw the removal");
    expect(getMaps(doc2).edgesMap.size).toBe(0);
    expect(getMaps(doc2).positionsMap.has("a")).toBe(false);
    expect(readSemanticGraph(doc2).version).toBe(4);
  } finally {
    p1.destroy();
    p2.destroy();
  }
}, 20000);
