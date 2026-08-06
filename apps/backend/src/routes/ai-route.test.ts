import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import type { GenerateResponse } from "@archforge/shared";

/**
 * Route-level tests for the response contract. These exist because the canvas-wipe bug they
 * cover shipped precisely for want of them: every other test here exercises an exported
 * validator, and nothing asserted what the endpoint actually returns.
 *
 * The model is mocked at the SDK boundary — the subject is the route's branching, not the
 * model's judgement.
 */

let nextContent = "";
const create = vi.fn(async (_params: unknown) => ({
  choices: [{ message: { role: "assistant", content: nextContent } }],
}));

vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create } };
  }
  return { default: MockOpenAI, AzureOpenAI: MockOpenAI };
});

// Two services sharing one database, so `computeObservations` has something true to say —
// a clean linear chain correctly produces no observations at all.
const POPULATED_GRAPH = {
  v: 6,
  nodes: [
    { id: "api", t: "api_gateway", l: "API Gateway" },
    { id: "svc", t: "service", l: "Orders Service" },
    { id: "reports", t: "service", l: "Reporting Service" },
    { id: "db", t: "sql_db", l: "Orders DB" },
  ],
  edges: [
    { id: "e1", f: "api", to: "svc" },
    { id: "e2", f: "api", to: "reports" },
    { id: "e3", f: "svc", to: "db" },
    { id: "e4", f: "reports", to: "db" },
  ],
};

describe("POST /api/generate", () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    const { default: aiRouter } = await import("./ai");
    const app = express();
    app.use(express.json());
    app.use("/api", aiRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://localhost:${(server.address() as AddressInfo).port}/api/generate`;
  });

  afterAll(() => server.close());
  beforeEach(() => create.mockClear());

  async function post(body: unknown): Promise<GenerateResponse> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as GenerateResponse;
  }

  /** A turn against the populated canvas, with the previous assistant turn having asked —
   * so the server vetoes any further ask. */
  const editAfterAsk = (prompt: string) => ({
    messages: [
      { role: "user", content: "build something" },
      { role: "assistant", content: "which kind?", asked: true },
      { role: "user", content: prompt },
    ],
    graph: POPULATED_GRAPH,
  });

  it("never applies a vetoed ask — this is the canvas-wipe regression", () => {
    // The model asks on a turn where the server has disallowed it. This used to fall through
    // to validateDesign, yield an empty design, and ship applied:true — which the client
    // diffed into remove_node for every node in the room.
    nextContent = JSON.stringify({
      thinking: "…",
      action: "ask",
      questions: [
        {
          header: "H",
          question: "Which?",
          options: [
            { label: "A", description: "a" },
            { label: "B", description: "b" },
          ],
        },
      ],
      nodes: [],
      edges: [],
      summary: "A question.",
    });
    return post(editAfterAsk("change it")).then((body) => {
      expect(body.applied).toBe(false);
      expect(body.nodes).toEqual([]);
    });
  });

  it("never applies an ask whose questions fail validation", async () => {
    // One option is unpickable, so validateQuestions drops the question — the other route
    // into the same fall-through.
    nextContent = JSON.stringify({
      action: "ask",
      questions: [{ header: "H", question: "Which?", options: [{ label: "Only" }] }],
      nodes: [],
      edges: [],
      summary: "A question.",
    });
    const body = await post({
      messages: [{ role: "user", content: "build a thing" }],
      graph: POPULATED_GRAPH,
    });
    expect(body.applied).toBe(false);
    expect(body.questions).toEqual([]);
  });

  it("never applies an unknown or missing action", async () => {
    nextContent = JSON.stringify({ action: "ponder", nodes: [], edges: [], summary: "hm" });
    expect((await post(editAfterAsk("x"))).applied).toBe(false);

    nextContent = JSON.stringify({ nodes: [], edges: [], summary: "hm" });
    expect((await post(editAfterAsk("y"))).applied).toBe(false);
  });

  it("never applies an empty generate against a populated canvas", async () => {
    // Indistinguishable from a truncated response, so treat the ambiguity as harmless.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    nextContent = JSON.stringify({
      action: "generate",
      nodes: [],
      edges: [],
      summary: "Cleared.",
    });
    const body = await post(editAfterAsk("simplify"));
    expect(body.applied).toBe(false);
    warn.mockRestore();
  });

  it("does apply an empty generate when the canvas was already empty", async () => {
    // Nothing to lose, so the guard must not fire and block a legitimate no-op.
    nextContent = JSON.stringify({ action: "generate", nodes: [], edges: [], summary: "hi" });
    const body = await post({ messages: [{ role: "user", content: "hi" }], graph: { v: 0, nodes: [], edges: [] } });
    expect(body.applied).toBe(true);
  });

  it("returns 200 with applied:false on unparseable output, never a 500", async () => {
    // A 500 becomes an assistant message in the client's transcript, which is then resent to
    // the model forever — teaching it to mirror its own failure.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    nextContent = "I'm afraid I can't do that.";
    const body = await post(editAfterAsk("change it"));
    expect(body.applied).toBe(false);
    expect(body.summary).toBeTruthy();
    err.mockRestore();
  });

  it("applies a real design and carries tradeoff + suggestions", async () => {
    nextContent = JSON.stringify({
      action: "generate",
      nodes: [
        { id: "api", type: "api_gateway", label: "API Gateway" },
        { id: "db", type: "sql_db", label: "Orders DB" },
      ],
      edges: [{ id: "e1", source: "api", target: "db" }],
      tradeoff: "API Gateway talks to Orders DB directly, so there is nowhere to put validation.",
      summary: "A gateway and a database.",
      suggestions: [
        { label: "Put a service between API Gateway and Orders DB", rationale: "Nothing validates writes today." },
        { label: "Add caching", rationale: "Caching is good." },
      ],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = await post(editAfterAsk("draw it"));
    expect(body.applied).toBe(true);
    expect(body.nodes).toHaveLength(2);
    expect(body.tradeoff).toContain("Orders DB");
    // The generic one is dropped; the specific one survives.
    expect(body.suggestions.map((s) => s.label)).toEqual([
      "Put a service between API Gateway and Orders DB",
    ]);
    warn.mockRestore();
  });

  it("offers the ask option only when the previous assistant turn did not ask", async () => {
    nextContent = JSON.stringify({ action: "reply", nodes: [], edges: [], summary: "ok" });

    await post({ messages: [{ role: "user", content: "build a login system" }], graph: { v: 0, nodes: [], edges: [] } });
    const firstTurnPrompt = (create.mock.calls.at(-1)?.[0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(firstTurnPrompt).toContain("reply, ask, or generate");

    await post(editAfterAsk("still vague"));
    const afterAskPrompt = (create.mock.calls.at(-1)?.[0] as { messages: { content: string }[] })
      .messages[0].content;
    // Not merely discouraged — absent.
    expect(afterAskPrompt).toContain("You may NOT ask this turn");
    expect(afterAskPrompt).not.toContain("reply, ask, or generate");
  });

  it("allows a mid-conversation ask once the user has seen an answer", async () => {
    nextContent = JSON.stringify({ action: "reply", nodes: [], edges: [], summary: "ok" });
    await post({
      messages: [
        { role: "user", content: "build it" },
        { role: "assistant", content: "here you go", asked: false },
        { role: "user", content: "add payments" },
      ],
      graph: POPULATED_GRAPH,
    });
    const prompt = (create.mock.calls.at(-1)?.[0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(prompt).toContain("reply, ask, or generate");
  });

  it("feeds computed canvas observations into the prompt", async () => {
    nextContent = JSON.stringify({ action: "reply", nodes: [], edges: [], summary: "ok" });
    await post(editAfterAsk("what's wrong with this?"));
    const prompt = (create.mock.calls.at(-1)?.[0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(prompt).toContain("CANVAS OBSERVATIONS");
  });

  it("still rejects an empty conversation with a 400", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
