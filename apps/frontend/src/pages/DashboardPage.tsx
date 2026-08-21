import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Loader2, LayoutTemplate, Clock, ArrowRight, FolderKanban } from "lucide-react";
import { listProjects, createProject, projectPath } from "@/lib/api";
import { Button } from "@/components/ui/button";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");

  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  const create = useMutation({
    mutationFn: (t: string) => createProject(t),
    onSuccess: (project) => {
      toast.success("Project created");
      navigate(projectPath(project.id));
    },
    onError: () => toast.error("Couldn't create the project"),
  });

  const handleCreate = useCallback(() => {
    if (create.isPending) return;
    create.mutate(title.trim() || "Untitled project");
  }, [create, title]);

  const recent = (projects ?? []).slice(0, 6);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-12 md:px-10">
        {/* Hero */}
        <div className="mb-10">
          <p className="text-sm text-[#a89dfc]">ArchForge</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Design systems, together.</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Describe a system in plain language and watch the architecture take shape on a live,
            multiplayer canvas. Start a new project or jump back into a recent one.
          </p>
        </div>

        {/* Quick create */}
        <div className="mb-10 flex max-w-2xl items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-lg">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Name a new project and press Enter…"
            className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder-white/25 outline-none"
          />
          <Button onClick={handleCreate} disabled={create.isPending} className="rounded-xl">
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            New project
          </Button>
        </div>

        {/* Stat */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
            <FolderKanban className="h-4 w-4 text-[#a89dfc]" />
            <span className="text-lg font-semibold tabular-nums">{projects?.length ?? 0}</span>
            <span className="text-xs text-muted-foreground">
              project{(projects?.length ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {/* Recents */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/80">Recent projects</h2>
          {recent.length > 0 && (
            <button
              onClick={() => navigate("/projects")}
              className="flex items-center gap-1 text-xs text-[#a89dfc] transition-opacity hover:opacity-80"
            >
              View all <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {recent.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center">
            <LayoutTemplate className="h-7 w-7 text-white/20" />
            <p className="text-sm text-muted-foreground">No projects yet — create your first above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((p) => (
              <div
                key={p.id}
                onClick={() => navigate(projectPath(p.id))}
                className="group cursor-pointer rounded-2xl border border-border bg-card p-4 transition-colors hover:border-[#6457f9]/40 hover:bg-[#181818]"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6457f9]/15">
                  <LayoutTemplate className="h-4.5 w-4.5 text-[#a89dfc]" />
                </div>
                <p className="mt-3 truncate text-sm font-medium text-foreground">{p.title}</p>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-white/35">
                  <Clock className="h-3 w-3" />
                  {relativeTime(p.updatedAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
