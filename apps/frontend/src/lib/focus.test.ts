import { describe, it, expect } from "vitest";
import {
  applySelectChanges,
  pruneFocus,
  resolveFocus,
  summarizeFocus,
  groupPeerFocus,
  peerFocusKey,
} from "./focus";

describe("applySelectChanges", () => {
  it("adds a newly selected node", () => {
    expect(applySelectChanges([], [{ id: "a", selected: true }])).toEqual(["a"]);
  });

  it("removes a deselected node", () => {
    expect(applySelectChanges(["a", "b"], [{ id: "a", selected: false }])).toEqual(["b"]);
  });

  it("keeps the order the user marked things in", () => {
    // That order is what the chips render in and what reaches the model, so appending rather
    // than sorting is behaviour, not an accident of implementation.
    const out = applySelectChanges(
      [],
      [
        { id: "c", selected: true },
        { id: "a", selected: true },
        { id: "b", selected: true },
      ],
    );
    expect(out).toEqual(["c", "a", "b"]);
  });

  it("clears everything when React Flow deselects on a pane click", () => {
    expect(
      applySelectChanges(
        ["a", "b"],
        [
          { id: "a", selected: false },
          { id: "b", selected: false },
        ],
      ),
    ).toEqual([]);
  });

  it("returns the same reference when nothing actually changed", () => {
    const current = ["a"];
    expect(applySelectChanges(current, [{ id: "a", selected: true }])).toBe(current);
    expect(applySelectChanges(current, [])).toBe(current);
  });
});

describe("pruneFocus", () => {
  it("drops marks for nodes that no longer exist", () => {
    expect(pruneFocus(["a", "gone", "b"], new Set(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("returns the IDENTICAL reference when nothing was removed", () => {
    // The single highest-value assertion in this feature. The caller runs this inside an effect
    // that also sets state, so without React's Object.is bail-out it is an infinite render
    // loop — and that failure only ever shows up in a browser. toBe, never toEqual.
    const current = ["a", "b"];
    expect(pruneFocus(current, new Set(["a", "b", "c"]))).toBe(current);
  });

  it("empties the set when the whole canvas is gone", () => {
    expect(pruneFocus(["a"], new Set())).toEqual([]);
  });
});

describe("resolveFocus", () => {
  const labels = new Map([
    ["a", "API Gateway"],
    ["b", "Orders DB"],
  ]);

  it("pairs each id with its live label, in mark order", () => {
    expect(resolveFocus(["b", "a"], labels)).toEqual([
      { id: "b", label: "Orders DB" },
      { id: "a", label: "API Gateway" },
    ]);
  });

  it("drops ids with no live node rather than rendering a ghost chip", () => {
    expect(resolveFocus(["a", "gone"], labels)).toEqual([{ id: "a", label: "API Gateway" }]);
  });

  it("keeps a node whose label is empty", () => {
    expect(resolveFocus(["c"], new Map([["c", ""]]))).toEqual([{ id: "c", label: "" }]);
  });
});

describe("summarizeFocus", () => {
  const ref = (label: string) => ({ id: label, label });

  it("is empty for no marks", () => {
    expect(summarizeFocus([])).toBe("");
  });

  it("lists up to two labels in full", () => {
    expect(summarizeFocus([ref("A"), ref("B")])).toBe("A, B");
  });

  it("counts the overflow", () => {
    expect(summarizeFocus([ref("A"), ref("B"), ref("C"), ref("D")])).toBe("A, B +2");
  });
});

describe("groupPeerFocus", () => {
  const peer = (userId: string, focus?: string[]) => ({
    userId,
    name: userId.toUpperCase(),
    color: "#fff",
    focus,
  });

  it("indexes peers by the node they marked", () => {
    const byNode = groupPeerFocus([peer("p1", ["a", "b"]), peer("p2", ["b"])]);
    expect(byNode.get("a")?.map((m) => m.userId)).toEqual(["p1"]);
    expect(byNode.get("b")?.map((m) => m.userId)).toEqual(["p1", "p2"]);
  });

  it("ignores a peer with nothing marked", () => {
    expect(groupPeerFocus([peer("p1", [])]).size).toBe(0);
  });

  it("tolerates a peer on a bundle that predates the field", () => {
    expect(groupPeerFocus([peer("p1")]).size).toBe(0);
  });
});

describe("peerFocusKey", () => {
  it("is stable while only cursors move", () => {
    // The whole point: the collaborators array is rebuilt on every remote mousemove, and
    // memoising the peer map on it would re-render every node in the room 60x a second.
    const a = [{ userId: "p1", focus: ["n1"] }];
    const b = [{ userId: "p1", focus: ["n1"] }];
    expect(peerFocusKey(a)).toBe(peerFocusKey(b));
  });

  it("changes when somebody marks something", () => {
    expect(peerFocusKey([{ userId: "p1", focus: ["n1"] }])).not.toBe(
      peerFocusKey([{ userId: "p1", focus: ["n1", "n2"] }]),
    );
  });

  it("changes when a peer leaves", () => {
    expect(peerFocusKey([{ userId: "p1", focus: ["n1"] }, { userId: "p2", focus: [] }])).not.toBe(
      peerFocusKey([{ userId: "p1", focus: ["n1"] }]),
    );
  });
});
