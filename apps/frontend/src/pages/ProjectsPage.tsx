import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, LayoutTemplate, Clock } from "lucide-react";
import { listProjects, deleteProject, projectPath, type Project } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  const { data: projects, isLoading, isError } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => {
      toast.success("Project deleted");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: () => toast.error("Couldn't delete the project"),
    onSettled: () => setPendingDelete(null),
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
        {/* Header + CTA */}
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {projects?.length
                ? `${projects.length} project${projects.length > 1 ? "s" : ""}`
                : "Your architecture canvases"}
            </p>
          </div>
          <NewProjectDialog>
            <Button className="rounded-xl">
              <Plus />
              New project
            </Button>
          </NewProjectDialog>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/5 px-5 py-4 text-sm text-red-300">
            Couldn't load projects — is the backend running?
          </div>
        ) : !projects || projects.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border py-20 text-center">
            <LayoutTemplate className="h-8 w-8 text-white/20" />
            <div>
              <p className="text-sm text-muted-foreground">No projects yet</p>
              <p className="mt-0.5 text-xs text-white/30">Create your first architecture canvas.</p>
            </div>
            <NewProjectDialog>
              <Button className="rounded-xl">
                <Plus />
                New project
              </Button>
            </NewProjectDialog>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                onClick={() => navigate(projectPath(p.id))}
                className="group relative cursor-pointer rounded-2xl border border-border bg-card p-4 transition-colors hover:border-[#6457f9]/40 hover:bg-[#181818]"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6457f9]/15">
                  <LayoutTemplate className="h-4.5 w-4.5 text-[#a89dfc]" />
                </div>
                <p className="mt-3 truncate pr-6 text-sm font-medium text-foreground">{p.title}</p>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-white/35">
                  <Clock className="h-3 w-3" />
                  {relativeTime(p.updatedAt)}
                </p>
                <button
                  title="Delete project"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete(p);
                  }}
                  className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-white/25 opacity-0 transition-all hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the project, its diagram, and its chat history. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) remove.mutate(pendingDelete.id);
              }}
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:opacity-90"
            >
              {remove.isPending ? <Loader2 className="animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
