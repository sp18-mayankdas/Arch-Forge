import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, Building2, Lock, X, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PROJECT_ACCESS, type ProjectAccess, type ProjectAccessResponse } from "@archforge/shared";
import {
  getProjectAccess,
  setProjectAccess,
  addProjectMember,
  removeProjectMember,
  ApiError,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const LEVELS: Record<
  ProjectAccess,
  { icon: typeof Lock; label: string; blurb: string }
> = {
  INVITE_ONLY: {
    icon: Lock,
    label: "Invite only",
    blurb: "Only you and people you add by GitHub username.",
  },
  SAME_DOMAIN: {
    icon: Building2,
    label: "Anyone at your company",
    blurb: "Anyone whose verified GitHub email shares your domain.",
  },
  LINK: {
    icon: Globe,
    label: "Anyone with the link",
    blurb: "Any signed-in ArchForge user who has this URL.",
  },
};

export function ShareDialog({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [handle, setHandle] = useState("");
  const qc = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["project-access", projectId],
    queryFn: () => getProjectAccess(projectId),
    // Only fetched while the dialog is open — sharing rules are not needed to draw a canvas.
    enabled: open,
  });

  const put = (next: ProjectAccessResponse) => qc.setQueryData(["project-access", projectId], next);
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : "Something went wrong");

  const changeLevel = useMutation({
    mutationFn: (access: ProjectAccess) => setProjectAccess(projectId, access),
    onSuccess: (next) => {
      put(next);
      toast.success(`Access set to “${LEVELS[next.access].label}”`);
    },
    onError: fail,
  });

  const invite = useMutation({
    mutationFn: (login: string) => addProjectMember(projectId, login),
    onSuccess: (next) => {
      put(next);
      setHandle("");
      toast.success("Invited");
    },
    onError: fail,
  });

  const revoke = useMutation({
    mutationFn: (login: string) => removeProjectMember(projectId, login),
    onSuccess: (next) => {
      put(next);
      toast.success("Access removed");
    },
    onError: fail,
  });

  const isOwner = data?.role === "owner";
  // The owner has no verified email domain, so SAME_DOMAIN would match nobody — including
  // them. Disabled with the reason shown, rather than silently locking the room.
  const domainUnavailable = !data?.ownerDomain;

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share this canvas</DialogTitle>
          <DialogDescription>
            Everyone who can open it edits live, together.
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-white/30" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              {PROJECT_ACCESS.map((level) => {
                const { icon: Icon, label, blurb } = LEVELS[level];
                const active = data?.access === level;
                const disabled =
                  !isOwner || changeLevel.isPending || (level === "SAME_DOMAIN" && domainUnavailable);
                return (
                  <button
                    key={level}
                    disabled={disabled}
                    onClick={() => changeLevel.mutate(level)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-[#6457f9]/60 bg-[#6457f9]/10"
                        : "border-white/8 bg-white/[0.02] hover:bg-white/[0.05]",
                      disabled && !active && "cursor-not-allowed opacity-40 hover:bg-white/[0.02]"
                    )}
                  >
                    <Icon
                      className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-[#a89dfc]" : "text-white/40")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-white/90">{label}</span>
                      <span className="block text-xs text-white/40">
                        {level === "SAME_DOMAIN" && domainUnavailable
                          ? "Unavailable — your GitHub account has no primary verified email, so there is no domain to share with."
                          : level === "SAME_DOMAIN" && data?.ownerDomain
                            ? `Anyone with a verified @${data.ownerDomain} email.`
                            : blurb}
                      </span>
                    </span>
                    {active && <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#a89dfc]" />}
                  </button>
                );
              })}
            </div>

            {!isOwner && (
              <p className="text-xs text-white/35">
                Only the project owner can change who has access.
              </p>
            )}

            {data?.access === "INVITE_ONLY" && isOwner && (
              <div className="space-y-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = handle.trim();
                    if (v) invite.mutate(v);
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="GitHub username"
                    spellCheck={false}
                    autoCapitalize="none"
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#6457f9]/60"
                  />
                  <button
                    type="submit"
                    disabled={!handle.trim() || invite.isPending}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-[#6457f9] px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Invite
                  </button>
                </form>

                {data.members.length > 0 && (
                  <ul className="space-y-1">
                    {data.members.map((m) => (
                      <li
                        key={m.githubLogin}
                        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]"
                      >
                        {m.avatarUrl ? (
                          <img src={m.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/8 text-[10px] font-bold text-white/60">
                            {m.githubLogin[0]?.toUpperCase()}
                          </div>
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs text-white/75">
                          {m.name ?? `@${m.githubLogin}`}
                          {/* An invite for someone who has never signed in is still valid — it
                              is claimed automatically on their first login. Say so, so it does
                              not look broken. */}
                          {!m.accepted && (
                            <span className="ml-1.5 text-[10px] text-white/30">invited</span>
                          )}
                        </span>
                        <button
                          onClick={() => revoke.mutate(m.githubLogin)}
                          title={`Remove @${m.githubLogin}`}
                          aria-label={`Remove @${m.githubLogin}`}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-white/30 hover:bg-white/8 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button
              onClick={copyLink}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 text-xs text-white/70 transition-colors hover:bg-white/8 hover:text-white"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Link copied" : "Copy link"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
