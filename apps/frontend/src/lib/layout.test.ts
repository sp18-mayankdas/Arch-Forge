import { describe, it, expect } from "vitest";
import { layoutGraph } from "./layout";
import { SHAPE_DEFAULTS, NODE_TYPE_REGISTRY } from "@archforge/shared";

describe("layoutGraph", () => {
  it("converts dagre centres to React Flow top-left", () => {
    const out = layoutGraph([{ id: "a", type: "service", label: "A" }], []);
    // dagre places a lone node's CENTRE at (width/2, height/2), so the top-left
    // this function returns must be exactly the origin. Keep this assertion exact —
    // a loose one would let a half-node offset bug through, and that bug reads as
    // "the layout is slightly off" rather than as a failure.
    expect(out.a).toEqual({ x: 0, y: 0 });
  });

  it("returns an empty object for an empty graph", () => {
    expect(layoutGraph([], [])).toEqual({});
  });

  it("gives every node in a disconnected graph a finite position", () => {
    const out = layoutGraph(
      [
        { id: "a", type: "service", label: "A" },
        { id: "b", type: "cache", label: "B" },
      ],
      []
    );
    expect(Object.keys(out).sort()).toEqual(["a", "b"]);
    for (const p of Object.values(out)) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("does not overlap two disconnected nodes", () => {
    const out = layoutGraph(
      [
        { id: "a", type: "service", label: "A" },
        { id: "b", type: "service", label: "B" },
      ],
      []
    );
    const { width, height } = SHAPE_DEFAULTS[NODE_TYPE_REGISTRY.service.shape];
    const dx = Math.abs(out.a.x - out.b.x);
    const dy = Math.abs(out.a.y - out.b.y);
    expect(dx >= width || dy >= height).toBe(true);
  });

  it("terminates on a cyclic graph", () => {
    const out = layoutGraph(
      [
        { id: "a", type: "service", label: "A" },
        { id: "b", type: "service", label: "B" },
      ],
      [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ]
    );
    expect(Object.keys(out).sort()).toEqual(["a", "b"]);
  });

  it("ignores edges referencing unknown nodes", () => {
    const out = layoutGraph(
      [{ id: "a", type: "service", label: "A" }],
      [{ id: "e", source: "a", target: "ghost" }]
    );
    expect(Object.keys(out)).toEqual(["a"]);
  });
});
