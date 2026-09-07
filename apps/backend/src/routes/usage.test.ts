import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import type { UsageResponse } from "@archforge/shared";

// Mocked at the same boundary as the openai SDK in ai-route.test.ts — the subject here is
// the route's aggregation/sort logic, not Prisma itself.
const groupBy = vi.fn();
const findMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    aiUsageEvent: { groupBy: (...args: unknown[]) => groupBy(...args) },
    project: { findMany: (...args: unknown[]) => findMany(...args) },
  },
}));

describe("GET /api/usage", () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    const { default: usageRouter } = await import("./usage");
    const app = express();
    app.use(express.json());
    app.use("/api", usageRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://localhost:${(server.address() as AddressInfo).port}/api/usage`;
  });

  afterAll(() => server.close());

  beforeEach(() => {
    groupBy.mockReset();
    findMany.mockReset();
  });

  it("sums overview totals and sorts projects by totalTokens desc", async () => {
    groupBy.mockResolvedValue([
      { projectId: "p1", _sum: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }, _count: 2 },
      { projectId: "p2", _sum: { promptTokens: 400, completionTokens: 200, totalTokens: 600 }, _count: 3 },
    ]);
    findMany.mockResolvedValue([
      { id: "p1", title: "Project One" },
      { id: "p2", title: "Project Two" },
    ]);

    const res = await fetch(url);
    const body = (await res.json()) as UsageResponse;

    expect(body.overview).toEqual({
      promptTokens: 500,
      completionTokens: 250,
      totalTokens: 750,
      callCount: 5,
    });
    // p2 has more totalTokens than p1, so it sorts first despite groupBy returning p1 first.
    expect(body.projects.map((p) => p.projectId)).toEqual(["p2", "p1"]);
    expect(body.projects[0].title).toBe("Project Two");
  });

  it("returns a zeroed overview and no projects when nothing has been recorded", async () => {
    groupBy.mockResolvedValue([]);
    findMany.mockResolvedValue([]);

    const res = await fetch(url);
    const body = (await res.json()) as UsageResponse;

    expect(body.overview).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callCount: 0,
    });
    expect(body.projects).toEqual([]);
  });

  it("falls back to a placeholder title if a project row is missing", async () => {
    // Defensive path only — AiUsageEvent cascades on project delete, so this should not
    // happen in practice, but the aggregation must not crash if it ever does.
    groupBy.mockResolvedValue([
      { projectId: "gone", _sum: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }, _count: 1 },
    ]);
    findMany.mockResolvedValue([]);

    const res = await fetch(url);
    const body = (await res.json()) as UsageResponse;

    expect(body.projects[0]).toMatchObject({ projectId: "gone", title: "Deleted project" });
  });
});
