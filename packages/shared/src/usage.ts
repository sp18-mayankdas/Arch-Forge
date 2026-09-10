/**
 * The `GET /api/usage` response — the source of truth for AI token usage, so token
 * efficiency and rough billing exposure can be checked per project. Raw token counts
 * only: no cost estimate, since no per-model pricing config exists and guessing at a
 * provider's rate card would be misleading.
 */
export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

export interface ProjectUsage extends UsageTotals {
  projectId: string;
  title: string;
}

export interface UsageResponse {
  /** Summed across every project. */
  overview: UsageTotals;
  /** One entry per project with at least one recorded call, sorted by totalTokens desc. */
  projects: ProjectUsage[];
}
