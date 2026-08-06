import { describe, it, expect } from "vitest";
import { computeObservations, renderObservations } from "./canvas-observations";
import type { SerializedGraph, NodeType } from "@archforge/shared";

const g = (
  nodes: [string, NodeType, string?][],
  edges: [string, string, string][] = []
): SerializedGraph => ({
  v: 1,
  nodes: nodes.map(([id, t, l]) => ({ id, t, l: l ?? id })),
  edges: edges.map(([id, f, to]) => ({ id, f, to })),
});

const joined = (graph: SerializedGraph) => computeObservations(graph).join(" | ");

describe("computeObservations", () => {
  it("says nothing about an empty or absent canvas", () => {
    expect(computeObservations(null)).toEqual([]);
    expect(computeObservations(g([]))).toEqual([]);
  });

  it("says nothing about a clean linear chain — silence is the correct answer", () => {
    // The guard against padding the prompt with noise: no true observation, no block.
    const graph = g(
      [["api", "api_gateway"], ["svc", "service"], ["db", "sql_db"]],
      [["e1", "api", "svc"], ["e2", "svc", "db"]]
    );
    expect(computeObservations(graph)).toEqual([]);
  });

  it("flags a datastore shared by two or more nodes", () => {
    const graph = g(
      [["svc", "service", "Orders Service"], ["rep", "service", "Reporting"], ["db", "sql_db", "Orders DB"]],
      [["e1", "svc", "db"], ["e2", "rep", "db"]]
    );
    expect(joined(graph)).toContain("Orders DB is used by 2 nodes");
  });

  it("flags a third-party call sitting on the request path", () => {
    const graph = g(
      [["api", "api_gateway"], ["pay", "service"], ["stripe", "external_api", "Stripe"]],
      [["e1", "api", "pay"], ["e2", "pay", "stripe"]]
    );
    expect(joined(graph)).toContain("Stripe is called synchronously");
  });

  it("does NOT flag a third-party call behind a queue — that is the point of a queue", () => {
    const graph = g(
      [["api", "api_gateway"], ["q", "queue"], ["w", "worker"], ["stripe", "external_api", "Stripe"]],
      [["e1", "api", "q"], ["e2", "q", "w"], ["e3", "w", "stripe"]]
    );
    expect(joined(graph)).not.toContain("synchronously");
  });

  it("flags a disconnected node", () => {
    const graph = g([["api", "api_gateway"], ["orphan", "observability", "Metrics"]], []);
    expect(joined(graph)).toContain("Metrics is not connected to anything");
  });

  it("flags half a queue/worker pattern", () => {
    const lonelyQueue = g([["q", "queue", "Jobs"]], []);
    expect(joined(lonelyQueue)).toContain("Jobs has no worker consuming it");

    const lonelyWorker = g(
      [["svc", "service"], ["w", "worker", "Mailer"]],
      [["e1", "svc", "w"]]
    );
    expect(joined(lonelyWorker)).toContain("Mailer is not fed by a queue");
  });

  it("flags ingress wired straight into storage", () => {
    const graph = g(
      [["api", "api_gateway", "API Gateway"], ["db", "sql_db", "Users DB"]],
      [["e1", "api", "db"]]
    );
    expect(joined(graph)).toContain("API Gateway talks to Users DB directly");
  });

  it("flags the node everything funnels through", () => {
    const graph = g(
      [
        ["api", "api_gateway"],
        ["lb", "load_balancer"],
        ["auth", "auth", "Auth Service"],
        ["a", "service"],
        ["b", "service"],
        ["db", "sql_db"],
      ],
      [
        ["e1", "lb", "auth"],
        ["e2", "api", "auth"],
        ["e3", "auth", "a"],
        ["e4", "auth", "b"],
        ["e5", "a", "db"],
      ]
    );
    expect(joined(graph)).toContain("Auth Service");
  });

  it("ignores nodes whose type is not in the registry", () => {
    const graph = { v: 1, nodes: [{ id: "x", t: "nonsense" as NodeType, l: "X" }], edges: [] };
    expect(computeObservations(graph)).toEqual([]);
  });

  it("caps how much it will say, so it cannot crowd out the prompt", () => {
    const many = g(
      Array.from({ length: 30 }, (_, i) => [`n${i}`, "queue", `Q${i}`] as [string, NodeType, string]),
      []
    );
    expect(computeObservations(many).length).toBeLessThanOrEqual(8);
  });
});

describe("renderObservations", () => {
  it("renders nothing when there is nothing true to say", () => {
    expect(renderObservations(null)).toBe("");
    expect(
      renderObservations(
        g([["api", "api_gateway"], ["svc", "service"]], [["e1", "api", "svc"]])
      )
    ).toBe("");
  });

  it("labels the block and marks the facts as true", () => {
    const graph = g([["q", "queue", "Jobs"]], []);
    const block = renderObservations(graph);
    expect(block).toContain("CANVAS OBSERVATIONS");
    expect(block).toContain("- Jobs has no worker");
  });
});
