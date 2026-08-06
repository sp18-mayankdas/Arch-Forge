import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { applyOps, setPositions, getMaps, readSemanticGraph } from "./semantic-ops";

const addA = { op: "add_node", id: "a", type: "service", label: "A" } as const;

describe("semantic-ops", () => {
  it("writes a node and appends exactly one op", () => {
    const doc = new Y.Doc();
    applyOps(doc, [addA]);
    const { nodesMap, opsArray } = getMaps(doc);
    expect(nodesMap.size).toBe(1);
    expect(opsArray.length).toBe(1);
  });

  it("does NOT bump the version on a position write", () => {
    const doc = new Y.Doc();
    applyOps(doc, [addA]);
    const before = getMaps(doc).opsArray.length;
    setPositions(doc, { a: { x: 5, y: 6 } });
    expect(getMaps(doc).opsArray.length).toBe(before);
    expect(getMaps(doc).positionsMap.get("a")).toEqual({ x: 5, y: 6 });
  });

  it("bumps the version by exactly 1 on a label edit", () => {
    const doc = new Y.Doc();
    applyOps(doc, [addA]);
    applyOps(doc, [{ op: "set_label", id: "a", label: "renamed" }]);
    expect(getMaps(doc).opsArray.length).toBe(2);
    expect(readSemanticGraph(doc).nodes[0].label).toBe("renamed");
  });

  it("clears the position entry when a node is removed", () => {
    const doc = new Y.Doc();
    applyOps(doc, [addA]);
    setPositions(doc, { a: { x: 1, y: 1 } });
    applyOps(doc, [{ op: "remove_node", id: "a" }]);
    expect(getMaps(doc).positionsMap.has("a")).toBe(false);
  });

  it("removes edges touching a removed node", () => {
    const doc = new Y.Doc();
    applyOps(doc, [
      addA,
      { op: "add_node", id: "b", type: "sql_db", label: "B" },
      { op: "add_edge", id: "e", source: "a", target: "b" },
    ]);
    applyOps(doc, [{ op: "remove_node", id: "a" }]);
    expect(getMaps(doc).edgesMap.has("e")).toBe(false);
  });

  it("loses no increment when two peers append concurrently", () => {
    const d1 = new Y.Doc();
    const d2 = new Y.Doc();
    applyOps(d1, [addA]);
    applyOps(d2, [{ op: "add_node", id: "b", type: "cache", label: "B" }]);
    const u1 = Y.encodeStateAsUpdate(d1);
    const u2 = Y.encodeStateAsUpdate(d2);
    Y.applyUpdate(d2, u1);
    Y.applyUpdate(d1, u2);
    expect(getMaps(d1).opsArray.length).toBe(2);
    expect(getMaps(d2).opsArray.length).toBe(2);
    expect(readSemanticGraph(d1).version).toBe(2);
  });

  it("batches a multi-op call into one transaction", () => {
    const doc = new Y.Doc();
    // Touch the shared types first so their lazy creation cannot be counted.
    getMaps(doc);
    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });
    applyOps(doc, [addA, { op: "add_node", id: "b", type: "cache", label: "B" }]);
    expect(transactions).toBe(1);
  });
});
