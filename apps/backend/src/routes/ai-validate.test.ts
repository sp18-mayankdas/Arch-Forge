import { describe, it, expect, vi } from "vitest";
import { validateDesign } from "./ai";

describe("validateDesign", () => {
  it("coerces an unknown type to service instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = validateDesign({ nodes: [{ id: "a", type: "quantum_blockchain", label: "A" }] });
    expect(out.nodes).toEqual([{ id: "a", type: "service", label: "A" }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops a node with a missing id", () => {
    const out = validateDesign({ nodes: [{ type: "service", label: "A" }] });
    expect(out.nodes).toEqual([]);
  });

  it("drops a duplicate id, keeping the first", () => {
    const out = validateDesign({
      nodes: [
        { id: "a", type: "service", label: "First" },
        { id: "a", type: "cache", label: "Second" },
      ],
    });
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0].label).toBe("First");
  });

  it("drops an edge referencing a missing node", () => {
    const out = validateDesign({
      nodes: [{ id: "a", type: "service", label: "A" }],
      edges: [{ id: "e", source: "a", target: "nope" }],
    });
    expect(out.edges).toEqual([]);
  });

  it("falls back to the registry default label when label is blank", () => {
    const out = validateDesign({ nodes: [{ id: "a", type: "sql_db", label: "" }] });
    expect(out.nodes[0].label).toBe("SQL Database");
  });

  it("emits no coordinate or colour field", () => {
    const out = validateDesign({ nodes: [{ id: "a", type: "service", label: "A" }] });
    const json = JSON.stringify(out);
    for (const banned of ["x", "y", "position", "color", "colorIndex", "shape", "width"]) {
      expect(json).not.toContain(`"${banned}"`);
    }
  });

  it("handles an entirely empty design", () => {
    expect(validateDesign({})).toEqual({ nodes: [], edges: [] });
  });
});
