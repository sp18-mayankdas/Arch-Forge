import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import type { GenerateResponse } from "@archforge/shared";
// vi.mock is hoisted above imports, so pulling a constant from the module under test here
// does not defeat the SDK mock below.
import { MAX_ASK_ROUNDS, MAX_FOCUS_NODES } from "./ai";

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

  /**
   * A turn against the populated canvas with the ask allowance already spent — MAX_ASK_ROUNDS
   * consecutive ask turns behind it, so the server vetoes any further ask.
   *
   * It takes a whole run of rounds rather than one because a single prior ask no longer vetoes
   * anything: asking repeatedly is the point, and only the runaway cap closes the option. Tests
   * that exercise the veto path (the canvas-wipe regression above all) need the cap reached.
   */
  const editAtAskCap = (prompt: string) => ({
    messages: [
      { role: "user", content: "build something" },
      ...Array.from({ length: MAX_ASK_ROUNDS }, (_, i) => [
        { role: "assistant", content: `question ${i}?`, asked: true },
        { role: "user", content: `answer ${i}` },
      ]).flat(),
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
    return post(editAtAskCap("change it")).then((body) => {
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
    expect((await post(editAtAskCap("x"))).applied).toBe(false);

    nextContent = JSON.stringify({ nodes: [], edges: [], summary: "hm" });
    expect((await post(editAtAskCap("y"))).applied).toBe(false);
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
    const body = await post(editAtAskCap("simplify"));
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
    const body = await post(editAtAskCap("change it"));
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
    const body = await post(editAtAskCap("draw it"));
    expect(body.applied).toBe(true);
    expect(body.nodes).toHaveLength(2);
    expect(body.tradeoff).toContain("Orders DB");
    // The generic one is dropped; the specific one survives.
    expect(body.suggestions.map((s) => s.label)).toEqual([
      "Put a service between API Gateway and Orders DB",
    ]);
    warn.mockRestore();
  });

  const promptOfLastCall = () =>
    (create.mock.calls.at(-1)?.[0] as { messages: { content: string }[] }).messages[0].content;

  it("keeps offering the ask option after the user answers a round", async () => {
    // The reported bug. One answered round used to close the option for the rest of the
    // conversation, so everything still unknown got invented instead of asked about.
    nextContent = JSON.stringify({ action: "reply", nodes: [], edges: [], summary: "ok" });

    await post({
      messages: [{ role: "user", content: "build a login system" }],
      graph: { v: 0, nodes: [], edges: [] },
    });
    expect(promptOfLastCall()).toContain("reply, ask, or generate");

    await post({
      messages: [
        { role: "user", content: "build a login system" },
        { role: "assistant", content: "which sign-in methods?", asked: true },
        { role: "user", content: "Sign-in methods: Email + password" },
      ],
      graph: { v: 0, nodes: [], edges: [] },
    });
    expect(promptOfLastCall()).toContain("reply, ask, or generate");
  });

  it("removes the ask option once the runaway cap is reached — absent, not discouraged", async () => {
    nextContent = JSON.stringify({ action: "reply", nodes: [], edges: [], summary: "ok" });
    await post(editAtAskCap("still vague"));
    const prompt = promptOfLastCall();
    expect(prompt).toContain("You may NOT ask this turn");
    expect(prompt).not.toContain("reply, ask, or generate");
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
    expect(promptOfLastCall()).toContain("reply, ask, or generate");
  });

  it("feeds computed canvas observations into the prompt", async () => {
    nextContent = JSON.stringify({ action: "reply", nodes: [], edges: [], summary: "ok" });
    await post(editAtAskCap("what's wrong with this?"));
    const prompt = (create.mock.calls.at(-1)?.[0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(prompt).toContain("CANVAS OBSERVATIONS");
  });

  describe("focused turns", () => {
    const reply = () =>
      (nextContent = JSON.stringify({
        action: "reply",
        nodes: [],
        edges: [],
        summary: "ok",
      }));

    const focused = (nodeIds: unknown[]) => ({
      messages: [{ role: "user", content: "add a cache in front of this" }],
      graph: POPULATED_GRAPH,
      focus: { nodeIds },
    });

    it("carries the marked nodes into the prompt", async () => {
      reply();
      await post(focused(["db"]));
      const prompt = promptOfLastCall();
      expect(prompt).toContain("FOCUSED NODE");
      expect(prompt).toContain('- db — "Orders DB" (sql_db)');
    });

    it("renders no block for an unfocused turn", async () => {
      reply();
      await post({
        messages: [{ role: "user", content: "what's wrong with this?" }],
        graph: POPULATED_GRAPH,
      });
      expect(promptOfLastCall()).not.toContain("FOCUSED NODE");
    });

    it("treats a focus naming only stale nodes as an ordinary unfocused turn", async () => {
      reply();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = await post(focused(["deleted-by-a-peer"]));
      expect(body.applied).toBe(false);
      expect(promptOfLastCall()).not.toContain("FOCUSED NODE");
      warn.mockRestore();
    });

    it("does not displace the canvas observations", async () => {
      reply();
      await post(focused(["db"]));
      expect(promptOfLastCall()).toContain("CANVAS OBSERVATIONS");
    });

    it("does not reopen the ask option at the runaway cap", async () => {
      reply();
      await post({ ...editAtAskCap("change this"), focus: { nodeIds: ["db"] } });
      const prompt = promptOfLastCall();
      expect(prompt).toContain("FOCUSED NODE");
      expect(prompt).toContain("You may NOT ask this turn");
      expect(prompt).not.toContain("reply, ask, or generate");
    });

    it("clamps an oversized focus rather than rejecting it", async () => {
      reply();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Every real id repeated, padded out with fakes — far more than the cap allows.
      const ids = Array.from({ length: 20 }, (_, i) =>
        i < 4 ? POPULATED_GRAPH.nodes[i].id : `fake-${i}`,
      );
      await post(focused(ids));
      const prompt = promptOfLastCall();
      const block = prompt.slice(
        prompt.indexOf("FOCUSED NODE"),
        prompt.indexOf("STEP 1 — THINK FIRST"),
      );
      expect(block.split("\n").filter((l) => l.startsWith("- ")).length).toBeLessThanOrEqual(
        MAX_FOCUS_NODES,
      );
      warn.mockRestore();
    });

    it("does not merge the focused answer back into the canvas server-side", async () => {
      // Pins the deliberate ABSENCE of a merge. Overlaying returned nodes onto the existing
      // graph when focus is present would make deletion impossible on focused turns — and
      // "delete this node" with that node selected is the most natural focused edit there is.
      // The guard against under-returning is App.tsx's large-removal confirmation, not this.
      nextContent = JSON.stringify({
        action: "generate",
        nodes: [{ id: "db", type: "sql_db", label: "Orders DB" }],
        edges: [],
        tradeoff: "Orders DB now stands alone, so nothing serves reads.",
        summary: "Just the database.",
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = await post(focused(["db"]));
      expect(body.applied).toBe(true);
      expect(body.nodes).toHaveLength(1);
      warn.mockRestore();
    });
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
