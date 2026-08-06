import { describe, it, expect } from "vitest";
import { serializeGraph } from "./semantic";

describe("serializeGraph", () => {
  it("emits a compact graph with the version", () => {
    const out = serializeGraph(
      [{ id: "gw", type: "api_gateway", label: "API Gateway" }],
      [{ id: "e1", source: "gw", target: "db", label: "sql" }],
      7
    );
    expect(out).toEqual({
      v: 7,
      nodes: [{ id: "gw", t: "api_gateway", l: "API Gateway" }],
      edges: [{ id: "e1", f: "gw", to: "db", l: "sql" }],
    });
  });

  it("cannot leak presentation fields even when they are present on input", () => {
    const dirty = [
      { id: "a", type: "service", label: "A", x: 10, y: 20, color: "#fff", width: 160 },
    ] as never;
    const json = JSON.stringify(serializeGraph(dirty, [], 1));
    for (const banned of ["x", "y", "color", "width", "position", "textColor", "shape"]) {
      expect(json).not.toContain(`"${banned}"`);
    }
  });

  it("omits edge label when absent", () => {
    const out = serializeGraph([], [{ id: "e", source: "a", target: "b" }], 0);
    expect(out.edges[0]).toEqual({ id: "e", f: "a", to: "b" });
    expect("l" in out.edges[0]).toBe(false);
  });
});
