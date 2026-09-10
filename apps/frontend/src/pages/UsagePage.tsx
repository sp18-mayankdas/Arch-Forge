import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Gauge, ArrowDownToLine, ArrowUpFromLine, MessagesSquare } from "lucide-react";
import { getUsage, projectPath } from "@/lib/api";

function formatTokens(n: number): string {
  return n.toLocaleString();
}

export function UsagePage() {
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["usage"],
    queryFn: getUsage,
  });

  const overview = data?.overview;
  const projects = data?.projects ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            AI token usage, overall and per project — the source of truth for token efficiency.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/5 px-5 py-4 text-sm text-red-300">
            Couldn't load usage data — is the backend running?
          </div>
        ) : (
          <>
            {/* Overview stat cards */}
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6457f9]/15">
                  <Gauge className="h-4.5 w-4.5 text-[#a89dfc]" />
                </div>
                <p className="mt-3 text-lg font-semibold tabular-nums">
                  {formatTokens(overview?.totalTokens ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total tokens</p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6457f9]/15">
                  <ArrowDownToLine className="h-4.5 w-4.5 text-[#a89dfc]" />
                </div>
                <p className="mt-3 text-lg font-semibold tabular-nums">
                  {formatTokens(overview?.promptTokens ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">Input tokens</p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6457f9]/15">
                  <ArrowUpFromLine className="h-4.5 w-4.5 text-[#a89dfc]" />
                </div>
                <p className="mt-3 text-lg font-semibold tabular-nums">
                  {formatTokens(overview?.completionTokens ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">Output tokens</p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6457f9]/15">
                  <MessagesSquare className="h-4.5 w-4.5 text-[#a89dfc]" />
                </div>
                <p className="mt-3 text-lg font-semibold tabular-nums">
                  {formatTokens(overview?.callCount ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">AI calls</p>
              </div>
            </div>

            {/* Per-project breakdown */}
            <h2 className="mb-3 text-sm font-semibold text-white/80">By project</h2>
            {projects.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center">
                <Gauge className="h-7 w-7 text-white/20" />
                <p className="text-sm text-muted-foreground">
                  No AI calls recorded yet — usage shows up here once you generate a design.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-card text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Project</th>
                      <th className="px-4 py-2.5 text-right font-medium">Calls</th>
                      <th className="px-4 py-2.5 text-right font-medium">Input</th>
                      <th className="px-4 py-2.5 text-right font-medium">Output</th>
                      <th className="px-4 py-2.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr
                        key={p.projectId}
                        onClick={() => navigate(projectPath(p.projectId))}
                        className="cursor-pointer border-b border-border/60 bg-card/40 transition-colors last:border-b-0 hover:bg-[#181818]"
                      >
                        <td className="truncate px-4 py-2.5 font-medium text-foreground">{p.title}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatTokens(p.callCount)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatTokens(p.promptTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatTokens(p.completionTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium text-foreground">
                          {formatTokens(p.totalTokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
