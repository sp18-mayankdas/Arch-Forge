import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import type { GenerateResponse } from "@archforge/shared";

/**
 * Token usage recording lives as a side effect of /api/generate, deliberately outside the
 * GenerateResponse contract — a DB write must never affect what the client receives. These
 * tests cover that boundary: usage is recorded when a projectId is present, skipped when it
 * is not, and a failed write never surfaces as a broken response.
 */

let nextContent = "";
const create = vi.fn(async () => ({
  choices: [{ message: { role: "assistant", content: nextContent } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
}));

vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create } };
  }
  return { default: MockOpenAI, AzureOpenAI: MockOpenAI };
});

const usageCreate = vi.fn();
vi.mock("../db", () => ({
  prisma: { aiUsageEvent: { create: usageCreate } },
}));

describe("POST /api/generate — token usage recording", () => {
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

  async function post(body: unknown): Promise<GenerateResponse> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as GenerateResponse;
  }

  const body = (projectId?: string) => ({
    messages: [{ role: "user", content: "hi" }],
    graph: { v: 0, nodes: [], edges: [] },
    ...(projectId ? { projectId } : {}),
  });

  // Runs first: a rejecting mock call inside this route's try/catch, observed through a real
  // HTTP round trip, confuses Vitest's test-attribution for console output emitted afterwards
  // — a later test in this same file gets blamed for this test's own console.error. Ordering
  // this test first sidesteps that entirely, since there is no later test left to misattribute
  // to. Application behaviour is what's under test here, not Vitest's own instrumentation.
  it("still returns a normal response when the usage DB write fails", async () => {
    nextContent = JSON.stringify({ action: "reply", nodes: [], edges: [], summary: "ok" });
    usageCreate.mockImplementation(() => {
      throw new Error("db down");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await post(body("proj-1"));

    expect(result.summary).toBe("ok");
    err.mockRestore();
  });

  it("records a usage row when projectId is present", async () => {
    // Reset inline rather than in a beforeEach — see the note on the first test above.
    usageCreate.mockReset();
    nextContent = JSON.stringify({ action: "reply", nodes: [], edges: [], summary: "ok" });
    usageCreate.mockResolvedValue({});

    await post(body("proj-1"));

    expect(usageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "proj-1",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      }),
    });
  });

  it("does not attempt to record usage when projectId is absent", async () => {
    usageCreate.mockReset();
    nextContent = JSON.stringify({ action: "reply", nodes: [], edges: [], summary: "ok" });

    await post(body());

    expect(usageCreate).not.toHaveBeenCalled();
  });
});
