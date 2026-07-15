import { useState, useCallback, useEffect, useMemo } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Bot, Users, Copy, Check, Wifi, WifiOff } from "lucide-react";
import { GhostCanvas } from "@/components/canvas/GhostCanvas";
import { AiSidebar } from "@/components/AiSidebar";
import { useYjsSync } from "@/hooks/useYjsSync";
import { createRoom } from "@/lib/yjs";
import type { CanvasNode, CanvasEdge } from "@/types/canvas";
import { cn } from "@/lib/utils";

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
  const roomId = useMemo(() => getRoomId(), []);

  const { doc: _doc, provider, nodesMap, edgesMap, user } = useMemo(
    () => createRoom(roomId),
    [roomId]
  );

  const { nodes, edges, collaborators, onNodesChange, onEdgesChange, addNodes, addEdges } =
    useYjsSync({
      nodesMap,
      edgesMap,
      awareness: provider.awareness,
    });

  useEffect(() => {
    const onStatus = ({ status }: { status: string }) => {
      setConnected(status === "connected");
    };
    provider.on("status", onStatus);
    return () => {
      provider.off("status", onStatus);
      provider.disconnect();
    };
  }, [provider]);

  const handleApplyDesign = useCallback(
    (newNodes: CanvasNode[], newEdges: CanvasEdge[]) => {
      addNodes(newNodes);
      addEdges(newEdges);
    },
    [addNodes, addEdges]
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

        <AiSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onApplyDesign={handleApplyDesign}
        />
      </div>
    </div>
  );
}
