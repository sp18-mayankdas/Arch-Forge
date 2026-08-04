import { useEffect, useState, useCallback, useRef } from "react";
import { applyNodeChanges, applyEdgeChanges } from "@xyflow/react";
import type { NodeChange, EdgeChange } from "@xyflow/react";
import * as Y from "yjs";
import type { CanvasNode, CanvasEdge, UserAwareness, ChatMessage } from "@/types/canvas";

interface UseYjsSyncProps {
  nodesMap: Y.Map<Y.Map<unknown>>;
  edgesMap: Y.Map<Y.Map<unknown>>;
  messagesArray: Y.Array<ChatMessage>;
  awareness: import("y-protocols/awareness").Awareness;
}

export function useYjsSync({ nodesMap, edgesMap, messagesArray, awareness }: UseYjsSyncProps) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [collaborators, setCollaborators] = useState<UserAwareness[]>([]);

  const isRemoteChange = useRef(false);

  const yjsNodesToArray = useCallback(() => {
    return Array.from(nodesMap.values()).map((n) => {
      const raw = n instanceof Y.Map ? Object.fromEntries(n.entries()) : n;
      return raw as unknown as CanvasNode;
    });
  }, [nodesMap]);

  const yjsEdgesToArray = useCallback(() => {
    return Array.from(edgesMap.values()).map((e) => {
      const raw = e instanceof Y.Map ? Object.fromEntries(e.entries()) : e;
      return raw as unknown as CanvasEdge;
    });
  }, [edgesMap]);

  useEffect(() => {
    const handleNodesChange = () => {
      isRemoteChange.current = true;
      setNodes(yjsNodesToArray());
      isRemoteChange.current = false;
    };
    const handleEdgesChange = () => {
      isRemoteChange.current = true;
      setEdges(yjsEdgesToArray());
      isRemoteChange.current = false;
    };

    nodesMap.observe(handleNodesChange);
    edgesMap.observe(handleEdgesChange);

    setNodes(yjsNodesToArray());
    setEdges(yjsEdgesToArray());

    return () => {
      nodesMap.unobserve(handleNodesChange);
      edgesMap.unobserve(handleEdgesChange);
    };
  }, [nodesMap, edgesMap, yjsNodesToArray, yjsEdgesToArray]);

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
            nodesMap.delete(change.id);
          } else if (change.type === "position" && change.position) {
            const existing = nodesMap.get(change.id);
            if (existing instanceof Y.Map) {
              existing.set("position", change.position);
            }
          }
        }
        return updated;
      });
    },
    [nodesMap]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      if (isRemoteChange.current) return;
      setEdges((eds) => {
        const updated = applyEdgeChanges(changes, eds);
        for (const change of changes) {
          if (change.type === "remove") {
            edgesMap.delete(change.id);
          }
        }
        return updated;
      });
    },
    [edgesMap]
  );

  const addNodes = useCallback(
    (newNodes: CanvasNode[]) => {
      for (const node of newNodes) {
        const yNode = new Y.Map<unknown>();
        yNode.set("id", node.id);
        yNode.set("type", node.type ?? "canvasNode");
        yNode.set("position", node.position);
        yNode.set("data", node.data);
        yNode.set("width", node.width ?? 160);
        yNode.set("height", node.height ?? 80);
        nodesMap.set(node.id, yNode);
      }
    },
    [nodesMap]
  );

  const addEdges = useCallback(
    (newEdges: CanvasEdge[]) => {
      for (const edge of newEdges) {
        const yEdge = new Y.Map<unknown>();
        yEdge.set("id", edge.id);
        yEdge.set("type", edge.type ?? "canvasEdge");
        yEdge.set("source", edge.source);
        yEdge.set("target", edge.target);
        yEdge.set("data", edge.data ?? {});
        yEdge.set("markerEnd", edge.markerEnd ?? {
          type: "arrowclosed",
          color: "rgba(255,255,255,0.4)",
          width: 16,
          height: 16,
        });
        edgesMap.set(edge.id, yEdge);
      }
    },
    [edgesMap]
  );

  const clearCanvas = useCallback(() => {
    nodesMap.clear();
    edgesMap.clear();
  }, [nodesMap, edgesMap]);

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
