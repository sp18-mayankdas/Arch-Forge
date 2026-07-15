import { useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  ConnectionLineType,
  MarkerType,
  Controls,
  useReactFlow,
} from "@xyflow/react";
import type { Connection } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CanvasNode, CanvasEdge } from "@/types/canvas";
import type { UserAwareness } from "@/types/canvas";
import { CanvasNodeComponent } from "./CanvasNode";
import { CanvasEdgeComponent } from "./CanvasEdge";
import { PresenceCursors } from "./PresenceCursors";
import type { Awareness } from "y-protocols/awareness";

const nodeTypes = { canvasNode: CanvasNodeComponent };
const edgeTypes = { canvasEdge: CanvasEdgeComponent };

let edgeCounter = 0;
function newEdgeId() {
  return `edge-${Date.now()}-${++edgeCounter}`;
}

interface GhostCanvasProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  collaborators: UserAwareness[];
  awareness: Awareness;
  onNodesChange: ReturnType<typeof import("@/hooks/useYjsSync").useYjsSync>["onNodesChange"];
  onEdgesChange: ReturnType<typeof import("@/hooks/useYjsSync").useYjsSync>["onEdgesChange"];
  addEdges: (edges: CanvasEdge[]) => void;
}

export function GhostCanvas({
  nodes,
  edges,
  collaborators,
  awareness,
  onNodesChange,
  onEdgesChange,
  addEdges,
}: GhostCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      awareness.setLocalStateField("cursor", pos);
    },
    [awareness, screenToFlowPosition]
  );

  const onMouseLeave = useCallback(() => {
    awareness.setLocalStateField("cursor", null);
  }, [awareness]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      addEdges([
        {
          id: newEdgeId(),
          type: "canvasEdge",
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle ?? null,
          targetHandle: connection.targetHandle ?? null,
          data: { label: "" },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "rgba(255,255,255,0.4)",
            width: 16,
            height: 16,
          },
        } as CanvasEdge,
      ]);
    },
    [addEdges]
  );

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: "rgba(255,255,255,0.35)", strokeWidth: 1.5 }}
        fitView
        proOptions={{ hideAttribution: true }}
        style={{ background: "#0e0e0e" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color="rgba(255,255,255,0.06)"
        />
        <Controls
          style={{
            background: "#1a1a1a",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
          }}
        />
        <PresenceCursors collaborators={collaborators} />
      </ReactFlow>
    </div>
  );
}
