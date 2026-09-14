import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import type { UsageResponse } from "@archforge/shared";

// Mocked at the same boundary as the openai SDK in ai-route.test.ts — the subject here is
// the route's aggregation/sort logic, not Prisma itself.
const groupBy = vi.fn();
const findMany = vi.fn();

// `/api/usage` is behind requireAuth now. Stubbed here so these stay tests of the route's
// aggregation and scoping, not of the session machinery (that is covered in access.test.ts).
const TEST_USER = { id: "u-test", login: "tester", emailDomain: "acme.com" };
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = TEST_USER;
    next();
  },
}));

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

  it("aggregates ONLY over projects the caller can see", async () => {
    // The leak this page used to have: it grouped over every event in the database, so the
    // overview summed other people's tokens. Scoping now happens first, and the aggregate
    // query must be constrained to the visible ids rather than filtered afterwards.
    findMany.mockResolvedValue([{ id: "mine", title: "Mine" }]);
    groupBy.mockResolvedValue([
      { projectId: "mine", _sum: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, _count: 1 },
    ]);

    const res = await fetch(url);
    const body = (await res.json()) as UsageResponse;

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) })
    );
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: { in: ["mine"] } } })
    );
    expect(body.projects.map((p) => p.projectId)).toEqual(["mine"]);
    expect(body.overview.totalTokens).toBe(15);
  });

  it("skips the aggregate query entirely when the caller has no projects", async () => {
    findMany.mockResolvedValue([]);

    const res = await fetch(url);
    const body = (await res.json()) as UsageResponse;

    // `in: []` matches nothing, so the round-trip is pure waste — but more importantly an
    // unconstrained groupBy here would be the leak again.
    expect(groupBy).not.toHaveBeenCalled();
    expect(body.projects).toEqual([]);
    expect(body.overview.totalTokens).toBe(0);
  });
});
