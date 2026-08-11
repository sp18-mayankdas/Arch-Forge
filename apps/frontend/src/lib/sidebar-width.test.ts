import { describe, it, expect } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  readStoredSidebarWidth,
} from "./sidebar-width";

describe("clampSidebarWidth", () => {
  it("passes an in-range width through, rounded", () => {
    expect(clampSidebarWidth(420)).toBe(420);
    expect(clampSidebarWidth(420.6)).toBe(421);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampSidebarWidth(10)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(-500)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(5000)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("falls back to the default for a non-finite width", () => {
    // A drag on a detached pointer can produce NaN, and a NaN width collapses the panel to
    // nothing — with no handle left to grab, there is no way back.
    expect(clampSidebarWidth(NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Infinity)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("keeps the default inside the allowed range", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH);
    expect(DEFAULT_SIDEBAR_WIDTH).toBeLessThanOrEqual(MAX_SIDEBAR_WIDTH);
  });
});

describe("readStoredSidebarWidth", () => {
  it("returns the default when nothing is stored", () => {
    expect(readStoredSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(readStoredSidebarWidth("")).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("parses a stored width and clamps it", () => {
    expect(readStoredSidebarWidth("420")).toBe(420);
    expect(readStoredSidebarWidth("9999")).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("returns the default for junk rather than throwing", () => {
    // localStorage is shared with everything else on the origin and survives deploys, so a
    // stale or hand-edited value must not brick the panel.
    expect(readStoredSidebarWidth("wide")).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(readStoredSidebarWidth("{}")).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});
