import { useEffect, useState, useCallback, useRef } from "react";
import { applyNodeChanges, applyEdgeChanges, MarkerType } from "@xyflow/react";
import type { NodeChange, EdgeChange } from "@xyflow/react";
import * as Y from "yjs";
import {
  NODE_TYPE_REGISTRY,
  SHAPE_DEFAULTS,
  type NodeType,
  type SemanticNode,
  type SemanticEdge,
} from "@archforge/shared";
import type { CanvasNode, CanvasEdge, UserAwareness, ChatMessage } from "@/types/canvas";
import { getMaps, applyOps, setPositions } from "@/lib/semantic-ops";

interface UseYjsSyncProps {
  doc: Y.Doc;
  // The transcript sits outside the semantic/presentation split, so it is passed in
  // rather than read from getMaps(doc).
  messagesArray: Y.Array<ChatMessage>;
  awareness: import("y-protocols/awareness").Awareness;
}

// Identical for every edge, so it is derived here rather than stored per-edge in the
// document — it is presentation, and the semantic layer does not carry presentation.
const EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  color: "rgba(255,255,255,0.4)",
  width: 16,
  height: 16,
} as const;

export function useYjsSync({ doc, messagesArray, awareness }: UseYjsSyncProps) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [collaborators, setCollaborators] = useState<UserAwareness[]>([]);

  const isRemoteChange = useRef(false);

  // React Flow nodes are assembled from three sources: the semantic `nodes` map,
  // the presentation `positions` map, and the type registry. None of the three
  // knows about the others.
  const buildNodes = useCallback((): CanvasNode[] => {
    const { nodesMap, positionsMap } = getMaps(doc);
    return Array.from(nodesMap.values()).map((m) => {
      const id = m.get("id") as string;
      const type = m.get("type") as NodeType;
      const spec = NODE_TYPE_REGISTRY[type] ?? NODE_TYPE_REGISTRY.service;
      const size = SHAPE_DEFAULTS[spec.shape];
      return {
        id,
        type: "canvasNode",
        // A node with no position entry renders at the origin rather than
        // disappearing — missing presentation must never hide semantics.
        position: positionsMap.get(id) ?? { x: 0, y: 0 },
        data: { label: (m.get("label") as string) ?? spec.defaultLabel, type },
        width: size.width,
        height: size.height,
      } as CanvasNode;
    });
  }, [doc]);

  const buildEdges = useCallback((): CanvasEdge[] => {
    const { edgesMap } = getMaps(doc);
    return Array.from(edgesMap.values()).map((m) => ({
      id: m.get("id") as string,
      type: "canvasEdge",
      source: m.get("source") as string,
      target: m.get("target") as string,
      data: { label: (m.get("label") as string) ?? "" },
      markerEnd: EDGE_MARKER,
    })) as CanvasEdge[];
  }, [doc]);

  useEffect(() => {
    const { nodesMap, edgesMap, positionsMap } = getMaps(doc);

    const refreshNodes = () => {
      isRemoteChange.current = true;
      setNodes(buildNodes());
      isRemoteChange.current = false;
    };
    const refreshEdges = () => {
      isRemoteChange.current = true;
      setEdges(buildEdges());
      isRemoteChange.current = false;
    };

    nodesMap.observe(refreshNodes);
    // Positions live in their own map, so a remote drag has to be observed
    // separately from a remote semantic change.
    positionsMap.observe(refreshNodes);
    edgesMap.observe(refreshEdges);

    setNodes(buildNodes());
    setEdges(buildEdges());

    return () => {
      nodesMap.unobserve(refreshNodes);
      positionsMap.unobserve(refreshNodes);
      edgesMap.unobserve(refreshEdges);
    };
  }, [doc, buildNodes, buildEdges]);

  useEffect(() => {
    const handleMessagesChange = () => setMessages(messagesArray.toArray());
    messagesArray.observe(handleMessagesChange);
    setMessages(messagesArray.toArray());
    return () => messagesArray.unobserve(handleMessagesChange);
  }, [messagesArray]);

  const addMessage = useCallback(
    (message: ChatMessage) => {
      messagesArray.push([message]);
    },
    [messagesArray]
  );

  useEffect(() => {
    const handleAwareness = () => {
      const states = Array.from(awareness.getStates().entries())
        .filter(([clientId]) => clientId !== awareness.clientID)
        .map(([, state]) => {
          const s = state as Record<string, unknown>;
          const user = (s.user ?? {}) as { userId?: string; name?: string; color?: string };
          return {
            userId: user.userId ?? String(Math.random()),
            name: user.name ?? "Anonymous",
            color: user.color ?? "#ffffff",
            cursor: (s.cursor as { x: number; y: number } | null) ?? null,
          };
        });
      setCollaborators(states);
    };

    awareness.on("change", handleAwareness);
    return () => awareness.off("change", handleAwareness);
  }, [awareness]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      if (isRemoteChange.current) return;
      setNodes((nds) => {
        const updated = applyNodeChanges(changes, nds);
        for (const change of changes) {
          if (change.type === "remove") {
            applyOps(doc, [{ op: "remove_node", id: change.id }]);
          } else if (change.type === "position" && change.position) {
            // Presentation write: appends no op, so a drag cannot bump the version.
            setPositions(doc, { [change.id]: change.position });
          }
        }
        return updated;
      });
    },
    [doc]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      if (isRemoteChange.current) return;
      setEdges((eds) => {
        const updated = applyEdgeChanges(changes, eds);
        for (const change of changes) {
          if (change.type === "remove") {
            applyOps(doc, [{ op: "remove_edge", id: change.id }]);
          }
        }
        return updated;
      });
    },
    [doc]
  );

  // Semantic-only entry points. Callers cannot smuggle in presentation fields
  // because the parameter types have nowhere to put them.
  const addNodes = useCallback(
    (newNodes: SemanticNode[]) => {
      applyOps(
        doc,
        newNodes.map((n) => ({ op: "add_node" as const, id: n.id, type: n.type, label: n.label }))
      );
    },
    [doc]
  );

  const addEdges = useCallback(
    (newEdges: SemanticEdge[]) => {
      applyOps(
        doc,
        newEdges.map((e) => ({
          op: "add_edge" as const,
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
        }))
      );
    },
    [doc]
  );

  const clearCanvas = useCallback(() => {
    const { nodesMap } = getMaps(doc);
    applyOps(
      doc,
      Array.from(nodesMap.keys()).map((id) => ({ op: "remove_node" as const, id }))
    );
  }, [doc]);

  return {
    nodes,
    edges,
    messages,
    collaborators,
    onNodesChange,
    onEdgesChange,
    addNodes,
    addEdges,
    addMessage,
    clearCanvas,
  };
}
