import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { diffToOps, applyOps, readSemanticGraph, setPositions, getMaps } from "./semantic-ops";
import type { SemanticNode, SemanticEdge } from "@archforge/shared";

const n = (id: string, label = id, type: SemanticNode["type"] = "service"): SemanticNode => ({
  id,
  type,
  label,
});
const e = (id: string, source: string, target: string, label?: string): SemanticEdge =>
  label ? { id, source, target, label } : { id, source, target };

const empty = { nodes: [] as SemanticNode[], edges: [] as SemanticEdge[] };

describe("diffToOps", () => {
  it("adds everything against an empty canvas", () => {
    const ops = diffToOps(empty, { nodes: [n("a"), n("b")], edges: [e("e1", "a", "b")] });
    expect(ops.filter((o) => o.op === "add_node")).toHaveLength(2);
    expect(ops.filter((o) => o.op === "add_edge")).toHaveLength(1);
  });

  it("emits nothing when the desired graph already matches", () => {
    const graph = { nodes: [n("a"), n("b")], edges: [e("e1", "a", "b")] };
    expect(diffToOps(graph, graph)).toEqual([]);
  });

  // The reported bug: asking for something simpler used to ADD nodes, because the apply
  // was add-only and could not express a removal at all.
  it("removes nodes the desired graph omits, so a simplify shrinks the canvas", () => {
    const current = {
      nodes: [n("a"), n("b"), n("c"), n("d")],
      edges: [e("e1", "a", "b"), e("e2", "b", "c")],
    };
    const ops = diffToOps(current, { nodes: [n("a"), n("b")], edges: [e("e1", "a", "b")] });

    expect(ops.filter((o) => o.op === "remove_node").map((o) => o.id).sort()).toEqual(["c", "d"]);
    expect(ops.some((o) => o.op === "add_node")).toBe(false);
  });

  it("does not emit a redundant remove_edge for an edge a removed node already sweeps", () => {
    const current = { nodes: [n("a"), n("b")], edges: [e("e1", "a", "b")] };
    const ops = diffToOps(current, { nodes: [n("a")], edges: [] });
    // applyOps sweeps edges touching a removed node; re-issuing it would be a no-op that
    // still bumps the version counter.
    expect(ops.filter((o) => o.op === "remove_edge")).toHaveLength(0);
    expect(ops.filter((o) => o.op === "remove_node")).toHaveLength(1);
  });

  it("emits remove_edge when both endpoints survive", () => {
    const current = { nodes: [n("a"), n("b")], edges: [e("e1", "a", "b")] };
    const ops = diffToOps(current, { nodes: [n("a"), n("b")], edges: [] });
    expect(ops).toEqual([{ op: "remove_edge", id: "e1" }]);
  });

  it("uses set_label/set_type for a changed node rather than remove+add", () => {
    // remove+add would drop the node's position and make it jump across the canvas.
    const current = { nodes: [n("a", "Old", "service")], edges: [] };
    const ops = diffToOps(current, { nodes: [n("a", "New", "cache")], edges: [] });
    expect(ops).toEqual([
      { op: "set_label", id: "a", label: "New" },
      { op: "set_type", id: "a", type: "cache" },
    ]);
  });

  it("replaces an edge whose endpoints or label changed", () => {
    const current = { nodes: [n("a"), n("b"), n("c")], edges: [e("e1", "a", "b")] };
    const ops = diffToOps(current, { nodes: [n("a"), n("b"), n("c")], edges: [e("e1", "a", "c")] });
    expect(ops).toEqual([
      { op: "remove_edge", id: "e1" },
      { op: "add_edge", id: "e1", source: "a", target: "c" },
    ]);
  });
});

describe("diffToOps applied to a real doc", () => {
  it("shrinks the graph and clears the removed nodes' positions", () => {
    const doc = new Y.Doc();
    applyOps(
      doc,
      diffToOps(empty, {
        nodes: [n("a"), n("b"), n("c")],
        edges: [e("e1", "a", "b"), e("e2", "b", "c")],
      })
    );
    setPositions(doc, { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, c: { x: 2, y: 2 } });
    expect(readSemanticGraph(doc).nodes).toHaveLength(3);

    // "Make it simpler" — down to a single node.
    const current = readSemanticGraph(doc);
    applyOps(doc, diffToOps(current, { nodes: [n("a")], edges: [] }));

    const after = readSemanticGraph(doc);
    expect(after.nodes.map((x) => x.id)).toEqual(["a"]);
    expect(after.edges).toHaveLength(0);
    // A stale position for a deleted node would resurrect it at the origin on re-layout.
    const { positionsMap } = getMaps(doc);
    expect(positionsMap.has("b")).toBe(false);
    expect(positionsMap.has("c")).toBe(false);
  });

  it("preserves the position of a node that survives an edit", () => {
    const doc = new Y.Doc();
    applyOps(doc, diffToOps(empty, { nodes: [n("keep"), n("drop")], edges: [] }));
    setPositions(doc, { keep: { x: 42, y: 99 }, drop: { x: 0, y: 0 } });

    applyOps(doc, diffToOps(readSemanticGraph(doc), { nodes: [n("keep", "Renamed")], edges: [] }));

    const { positionsMap } = getMaps(doc);
    expect(positionsMap.get("keep")).toEqual({ x: 42, y: 99 });
    expect(readSemanticGraph(doc).nodes[0].label).toBe("Renamed");
  });

  it("bumps the version once per op and never loses one", () => {
    const doc = new Y.Doc();
    const ops = diffToOps(empty, { nodes: [n("a"), n("b")], edges: [e("e1", "a", "b")] });
    applyOps(doc, ops);
    expect(readSemanticGraph(doc).version).toBe(ops.length);
  });
});
