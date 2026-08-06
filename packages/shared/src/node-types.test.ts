import { describe, it, expect } from "vitest";
import { NODE_TYPES, NODE_TYPE_REGISTRY } from "./node-types";
import { NODE_SHAPES, NODE_COLORS } from "./presentation";

describe("node type registry", () => {
  it("has an entry for every type", () => {
    for (const t of NODE_TYPES) expect(NODE_TYPE_REGISTRY[t]).toBeDefined();
  });

  it("has no entries for unknown types", () => {
    expect(Object.keys(NODE_TYPE_REGISTRY).sort()).toEqual([...NODE_TYPES].sort());
  });

  it("uses only valid shapes and in-range colour indices", () => {
    for (const t of NODE_TYPES) {
      const s = NODE_TYPE_REGISTRY[t];
      expect(NODE_SHAPES).toContain(s.shape);
      expect(s.colorIndex).toBeGreaterThanOrEqual(0);
      expect(s.colorIndex).toBeLessThan(NODE_COLORS.length);
    }
  });

  it("declares every consumer's fields on every entry", () => {
    for (const t of NODE_TYPES) {
      const s = NODE_TYPE_REGISTRY[t];
      expect(typeof s.icon).toBe("string");
      expect(s.icon.length).toBeGreaterThan(0);
      expect(typeof s.templateKey).toBe("string");
      expect(s.templateKey.length).toBeGreaterThan(0);
      expect(typeof s.defaultLabel).toBe("string");
      expect(typeof s.isDatastore).toBe("boolean");
      expect(typeof s.isIngress).toBe("boolean");
      expect(typeof s.absorbsLoad).toBe("boolean");
      expect(Number.isFinite(s.capacityRps)).toBe(true);
      expect(Number.isFinite(s.latencyMs)).toBe(true);
    }
  });

  it("only puts cacheHitRatio in (0,1] where present", () => {
    for (const t of NODE_TYPES) {
      const r = NODE_TYPE_REGISTRY[t].cacheHitRatio;
      if (r !== undefined) {
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThanOrEqual(1);
      }
    }
  });
});
