import { Router } from "express";
import { prisma } from "../db";
import type { UsageResponse, UsageTotals } from "@archforge/shared";
import { visibleProjectsWhere } from "../lib/access";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

// GET /api/usage — token usage source of truth: totals across every project, plus a
// per-project breakdown, sorted by heaviest usage first.
router.get("/usage", async (req, res) => {
  // Scope FIRST, then aggregate. Grouping over every event and filtering afterwards would
  // still have summed other people's tokens into `overview` — the leak this page had.
  const visible = await prisma.project.findMany({
    where: visibleProjectsWhere(req.user!),
    select: { id: true, title: true },
  });
  const visibleIds = visible.map((p) => p.id);

  const grouped = visibleIds.length
    ? await prisma.aiUsageEvent.groupBy({
        by: ["projectId"],
        where: { projectId: { in: visibleIds } },
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
        _count: true,
      })
    : [];

  const projects = visible;
  const titleById = new Map(projects.map((p) => [p.id, p.title]));

  const overview: UsageTotals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
  const byProject = grouped
    .map((g) => {
      const promptTokens = g._sum.promptTokens ?? 0;
      const completionTokens = g._sum.completionTokens ?? 0;
      const totalTokens = g._sum.totalTokens ?? 0;
      const callCount = g._count;

      overview.promptTokens += promptTokens;
      overview.completionTokens += completionTokens;
      overview.totalTokens += totalTokens;
      overview.callCount += callCount;

      return {
        projectId: g.projectId,
        // AiUsageEvent cascades on project delete, so this fallback should be
        // unreachable in practice — defensive only.
        title: titleById.get(g.projectId) ?? "Deleted project",
        promptTokens,
        completionTokens,
        totalTokens,
        callCount,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const body: UsageResponse = { overview, projects: byProject };
  res.json(body);
});

export default router;
