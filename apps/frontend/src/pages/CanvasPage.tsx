import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Users,
  Copy,
  Check,
  Wifi,
  WifiOff,
  TriangleAlert,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { GhostCanvas } from "@/components/canvas/GhostCanvas";
import { AiSidebar } from "@/components/AiSidebar";
import { useYjsSync } from "@/hooks/useYjsSync";
import { useSidebarWidth } from "@/hooks/useSidebarWidth";
import { createRoom } from "@/lib/yjs";
import { applyOps, setPositions, readSemanticGraph, diffToOps } from "@/lib/semantic-ops";
import { layoutGraph } from "@/lib/layout";
import { serializeGraph } from "@/types/canvas";
import type { SemanticNode, SemanticEdge } from "@/types/canvas";
import { getProject, updateProject } from "@/lib/api";
import { cn } from "@/lib/utils";

const REMOVAL_CONFIRM_RATIO = 1 / 3;
const MIN_REMOVALS_TO_CONFIRM = 3;

interface PendingApply {
  desired: { nodes: SemanticNode[]; edges: SemanticEdge[] };
  removals: number;
  before: number;
}

export function CanvasPage() {
  const { projectId = "" } = useParams();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [pendingApply, setPendingApply] = useState<PendingApply | null>(null);

  // Drag-to-resize + persisted width for the assistant panel (colleague's feature).
  const { width: sidebarWidth, dragging, handleProps } = useSidebarWidth();

  // The project id IS the Yjs room id (and the server-side persistence key).
  const { doc, provider, messagesArray, user } = useMemo(
    () => createRoom(projectId),
    [projectId]
  );

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: false,
  });

  // Inline-editable project title (click the title in the top strip to rename).
  const qc = useQueryClient();
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const cancelEditRef = useRef(false);

  const rename = useMutation({
    mutationFn: (t: string) => updateProject(projectId, t),
    onSuccess: (updated) => {
      qc.setQueryData(["project", projectId], updated);
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project renamed");
    },
    onError: () => toast.error("Couldn't rename the project"),
    onSettled: () => setEditingTitle(false),
  });

  const startEditTitle = useCallback(() => {
    setDraftTitle(project?.title ?? "");
    setEditingTitle(true);
  }, [project?.title]);

  // Committed only from onBlur; Enter/Escape blur the input (Escape flags a cancel),
  // so there's never a double save.
  const commitTitle = useCallback(() => {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      setEditingTitle(false);
      return;
    }
    const next = draftTitle.trim();
    if (!next || next === (project?.title ?? "")) {
      setEditingTitle(false);
      return;
    }
    rename.mutate(next);
  }, [draftTitle, project?.title, rename]);

  const {
    nodes,
    edges,
    messages,
    collaborators,
    onNodesChange,
    onEdgesChange,
    addEdges,
    addMessage,
  } = useYjsSync({ doc, messagesArray, awareness: provider.awareness });

  // Connect on mount, disconnect on unmount. Because navigation is client-side (no page
  // reload), this is what drops our presence when leaving a project and reconnects on return.
  // StrictMode-safe: connect → disconnect → connect ends connected, so the online count is right.
  useEffect(() => {
    provider.connect();
    setConnected(provider.wsconnected);
    setSynced(provider.synced);
    const onStatus = ({ status }: { status: string }) => setConnected(status === "connected");
    const onSync = (isSynced: boolean) => setSynced(isSynced);
    provider.on("status", onStatus);
    provider.on("sync", onSync);
    return () => {
      provider.off("status", onStatus);
      provider.off("sync", onSync);
      provider.disconnect();
    };
  }, [provider]);

  const readGraphForAi = useCallback(() => {
    const { nodes: n, edges: e, version } = readSemanticGraph(doc);
    return serializeGraph(n, e, version);
  }, [doc]);

  const writeDesign = useCallback(
    (desired: { nodes: SemanticNode[]; edges: SemanticEdge[] }) => {
      const ops = diffToOps(readSemanticGraph(doc), desired);
      if (ops.length === 0) return false;
      applyOps(doc, ops);
      const { nodes: allNodes, edges: allEdges } = readSemanticGraph(doc);
      setPositions(doc, layoutGraph(allNodes, allEdges));
      return true;
    },
    [doc]
  );

  const handleApplyDesign = useCallback(
    (desiredNodes: SemanticNode[], desiredEdges: SemanticEdge[]) => {
      const desired = { nodes: desiredNodes, edges: desiredEdges };
      const current = readSemanticGraph(doc);
      const removals = diffToOps(current, desired).filter((o) => o.op === "remove_node").length;
      const isLargeRemoval =
        removals >= MIN_REMOVALS_TO_CONFIRM &&
        removals >= current.nodes.length * REMOVAL_CONFIRM_RATIO;
      if (isLargeRemoval) {
        setPendingApply({ desired, removals, before: current.nodes.length });
        return false;
      }
      return writeDesign(desired);
    },
    [doc, writeDesign]
  );

  const handleCopyLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast.success("Link copied — share it to collaborate live");
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const onlineCount = collaborators.length + 1;

  return (
    <div className="flex h-full flex-col">
      {/* Project chrome (contextual — global nav lives in the sidebar) */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#6457f9]/15">
            <Bot className="h-3.5 w-3.5 text-[#a89dfc]" />
          </div>
          {editingTitle ? (
            <input
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  cancelEditRef.current = true;
                  e.currentTarget.blur();
                }
              }}
              onBlur={commitTitle}
              className="w-56 rounded-md border border-[#6457f9]/60 bg-white/5 px-2 py-0.5 text-sm font-medium text-white outline-none"
            />
          ) : (
            <button
              onClick={startEditTitle}
              title="Click to rename"
              className="truncate rounded-md px-1.5 py-0.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/8"
            >
              {project?.title ?? "Untitled project"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 text-[11px]"
            title={connected ? "Connected" : "Connecting…"}
          >
            {connected ? (
              <Wifi className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-white/30 animate-pulse" />
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-white/30" />
              <span className="text-xs text-white/50 tabular-nums">{onlineCount}</span>
            </div>
            <div className="flex -space-x-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-card text-[11px] font-bold text-white select-none"
                style={{ background: user.color }}
                title={`${user.name} (you)`}
              >
                {user.name[0].toUpperCase()}
              </div>
              {collaborators.slice(0, 4).map((c) => (
                <div
                  key={c.userId}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-card text-[11px] font-bold text-white select-none"
                  style={{ background: c.color }}
                  title={c.name}
                >
                  {c.name[0].toUpperCase()}
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleCopyLink}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white/60 transition-all hover:bg-white/8 hover:text-white"
          >
            {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied!" : "Share"}
          </button>

          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-all",
              sidebarOpen
                ? "bg-[#6457f9]/20 text-[#a89dfc]"
                : "border border-white/10 bg-white/5 text-white/60 hover:bg-white/8 hover:text-white"
            )}
          >
            <Bot className="h-3.5 w-3.5" />
            ArchForge
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden">
        <ReactFlowProvider>
          <GhostCanvas
            nodes={nodes}
            edges={edges}
            collaborators={collaborators}
            awareness={provider.awareness}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            addEdges={addEdges}
          />
        </ReactFlowProvider>

        {pendingApply && (
          <div className="absolute left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-400/25 bg-[#1c1a14]/95 px-4 py-2.5 shadow-2xl backdrop-blur-xl">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="text-xs text-white/80">
              This removes {pendingApply.removals} of {pendingApply.before} nodes.
            </span>
            <button
              onClick={() => {
                writeDesign(pendingApply.desired);
                setPendingApply(null);
              }}
              className="flex h-7 items-center rounded-lg bg-amber-400/90 px-3 text-xs font-medium text-[#1c1a14] transition-opacity hover:opacity-90"
            >
              Apply
            </button>
            <button
              onClick={() => setPendingApply(null)}
              className="flex h-7 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white/60 transition-colors hover:bg-white/8 hover:text-white"
            >
              Discard
            </button>
          </div>
        )}

        {/* Arrow tab — toggles the assistant; tracks the panel's edge (its width) when open,
            and stays visible when the panel slides off. Lives outside the panel on purpose. */}
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          title={sidebarOpen ? "Hide assistant" : "Show assistant"}
          aria-label={sidebarOpen ? "Hide assistant" : "Show assistant"}
          style={{ right: sidebarOpen ? sidebarWidth : 0 }}
          className={cn(
            "absolute top-1/2 z-50 flex h-12 w-5 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-white/10 bg-[#141414]/95 text-white/40 backdrop-blur-xl hover:bg-white/10 hover:text-white",
            dragging ? "transition-colors" : "transition-all duration-200"
          )}
        >
          {sidebarOpen ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>

        <AiSidebar
          isOpen={sidebarOpen}
          width={sidebarWidth}
          resizeHandleProps={handleProps}
          onClose={() => setSidebarOpen(false)}
          onApplyDesign={handleApplyDesign}
          readGraphForAi={readGraphForAi}
          messages={messages}
          addMessage={addMessage}
          synced={synced}
        />
      </div>
    </div>
  );
}
