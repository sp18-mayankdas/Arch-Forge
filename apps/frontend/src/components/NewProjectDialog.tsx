import { useState, useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createProject, projectPath } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// CTA + modal: click the child trigger → name the project → create → open its canvas.
export function NewProjectDialog({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const create = useMutation({
    mutationFn: (t: string) => createProject(t),
    onSuccess: (project) => {
      toast.success("Project created");
      navigate(projectPath(project.id)); // route change unmounts the dialog
    },
    onError: () => toast.error("Couldn't create the project"),
  });

  const submit = useCallback(() => {
    if (create.isPending) return;
    create.mutate(title.trim() || "Untitled project");
  }, [create, title]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTitle("");
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Give your architecture canvas a name.</DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="e.g. Payments service"
          className="w-full rounded-lg border border-border bg-white/5 px-3 py-2.5 text-sm text-foreground placeholder-white/25 outline-none transition-colors focus:border-[#6457f9]/60"
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={create.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
