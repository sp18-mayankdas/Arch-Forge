import { useState, useCallback, useEffect, useMemo } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Bot, Users, Copy, Check, Wifi, WifiOff, TriangleAlert } from "lucide-react";
import { GhostCanvas } from "@/components/canvas/GhostCanvas";
import { AiSidebar } from "@/components/AiSidebar";
import { useYjsSync } from "@/hooks/useYjsSync";
import { createRoom } from "@/lib/yjs";
import { applyOps, setPositions, readSemanticGraph, diffToOps } from "@/lib/semantic-ops";
import { layoutGraph } from "@/lib/layout";
import { serializeGraph } from "@/types/canvas";
import type { SemanticNode, SemanticEdge } from "@/types/canvas";
import { cn } from "@/lib/utils";

// A removal this large is either a deliberate simplify or the model losing track of the
// graph, and the two look identical from here — so ask. Both thresholds must hold: the ratio
// alone would nag on a 3-node canvas, the count alone would nag on a 30-node one.
const REMOVAL_CONFIRM_RATIO = 1 / 3;
const MIN_REMOVALS_TO_CONFIRM = 3;

interface PendingApply {
  desired: { nodes: SemanticNode[]; edges: SemanticEdge[] };
  removals: number;
  before: number;
}

function getRoomId() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (room) return room;
  const newRoom = Math.random().toString(36).slice(2, 9);
  const url = new URL(window.location.href);
  url.searchParams.set("room", newRoom);
  window.history.replaceState({}, "", url.toString());
  return newRoom;
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [pendingApply, setPendingApply] = useState<PendingApply | null>(null);
  const roomId = useMemo(() => getRoomId(), []);

  const { doc, provider, messagesArray, user } = useMemo(() => createRoom(roomId), [roomId]);

  const {
    nodes,
    edges,
    messages,
    collaborators,
    onNodesChange,
    onEdgesChange,
    addEdges,
    addMessage,
  } = useYjsSync({
    doc,
    messagesArray,
    awareness: provider.awareness,
  });

  useEffect(() => {
    setConnected(provider.wsconnected);
    setSynced(provider.synced);
    const onStatus = ({ status }: { status: string }) => {
      setConnected(status === "connected");
    };
    const onSync = (isSynced: boolean) => setSynced(isSynced);
    provider.on("status", onStatus);
    provider.on("sync", onSync);
    // Note: the provider is a cached singleton (see createRoom) that lives for the
    // page's lifetime, so we only detach the listeners here — no disconnect, which
    // would otherwise drop the connection during StrictMode's mount/unmount cycle.
    return () => {
      provider.off("status", onStatus);
      provider.off("sync", onSync);
    };
  }, [provider]);

  /** The canvas as the AI is allowed to see it: topology only, no coordinates. */
  const readGraphForAi = useCallback(() => {
    const { nodes: n, edges: e, version } = readSemanticGraph(doc);
    return serializeGraph(n, e, version);
  }, [doc]);

  /** Writes the desired graph. Diffed against the doc at call time, never against a
   * snapshot, so a confirmed-later apply still lands on the current canvas. */
  const writeDesign = useCallback(
    (desired: { nodes: SemanticNode[]; edges: SemanticEdge[] }) => {
      // The AI returns the complete desired graph, so this is a diff, not an append.
      // Appending was why "make it simpler" made the diagram bigger: an add-only apply
      // can only ever grow the graph.
      const ops = diffToOps(readSemanticGraph(doc), desired);
      if (ops.length === 0) return false;

      // 1. Semantic write, one transaction, ops appended.
      applyOps(doc, ops);
      // 2. Lay out the FULL graph, not just what changed, so surviving content re-flows
      //    to fill the space instead of leaving holes. applyOps is synchronous, so the
      //    read below already sees the updated graph.
      const { nodes: allNodes, edges: allEdges } = readSemanticGraph(doc);
      // 3. Presentation write. Appends no op — layout is not a semantic change.
      setPositions(doc, layoutGraph(allNodes, allEdges));
      return true;
    },
    [doc]
  );

  /**
   * Applies a design, unless it would delete a large share of the canvas — then it waits for
   * confirmation.
   *
   * The canvas is shared live and there is no undo, so a single turn that drops most of
   * someone's work should not land silently. A deliberate "simplify this" costs one extra
   * click; a model that quietly forgot half the graph gets caught. Returns whether the canvas
   * actually changed, so the sidebar does not claim an update that is still pending.
   */
  const handleApplyDesign = useCallback(
    (desiredNodes: SemanticNode[], desiredEdges: SemanticEdge[]) => {
      const desired = { nodes: desiredNodes, edges: desiredEdges };
      const current = readSemanticGraph(doc);
      const removals = diffToOps(current, desired).filter(
        (o) => o.op === "remove_node"
      ).length;

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
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const onlineCount = collaborators.length + 1;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0e0e0e]">
      {/* Navbar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/8 bg-[#141414] px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#6457f9]/20">
            <Bot className="h-4 w-4 text-[#a89dfc]" />
          </div>
          <span className="text-sm font-semibold text-white">ArchForge</span>
          <span className="hidden text-white/20 sm:block">·</span>
          <span className="hidden text-xs text-white/40 sm:block font-mono">{roomId}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection status */}
          <div
            className="flex items-center gap-1.5 text-[11px]"
            title={connected ? "Connected to room" : "Connecting…"}
          >
            {connected ? (
              <Wifi className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-white/30 animate-pulse" />
            )}
          </div>

          {/* Collaborator avatars */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-white/30" />
              <span className="text-xs text-white/50 tabular-nums">{onlineCount}</span>
            </div>
            <div className="flex -space-x-2">
              {/* Self */}
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#141414] text-[11px] font-bold text-white select-none"
                style={{ background: user.color }}
                title={`${user.name} (you)`}
              >
                {user.name[0].toUpperCase()}
              </div>
              {collaborators.slice(0, 4).map((c) => (
                <div
                  key={c.userId}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#141414] text-[11px] font-bold text-white select-none"
                  style={{ background: c.color }}
                  title={c.name}
                >
                  {c.name[0].toUpperCase()}
                </div>
              ))}
            </div>
            {/* Current user name */}
            <span className="hidden text-xs text-white/40 md:block">{user.name}</span>
          </div>

          <button
            onClick={handleCopyLink}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white/60 transition-all hover:bg-white/8 hover:text-white"
            )}
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
      </header>

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

        <AiSidebar
          isOpen={sidebarOpen}
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
