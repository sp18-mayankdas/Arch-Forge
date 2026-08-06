import {
  NODE_TYPE_REGISTRY,
  isNodeType,
  type SerializedGraph,
  type NodeType,
} from "@archforge/shared";

/**
 * Facts about the drawn graph, computed here rather than left for the model to notice.
 *
 * This is the difference between "be insightful about this diagram" — which a mid-tier model
 * answers with generic advice — and "read this fact and phrase it", which it does well. Every
 * observation is a true statement about a named node, so a suggestion or a trade-off built on
 * one is automatically specific to THIS canvas rather than to architecture in general.
 *
 * The predicates come from `NODE_TYPE_REGISTRY` (`isDatastore`, `isIngress`, `absorbsLoad`),
 * which the registry declares for exactly this lint-engine purpose.
 */

interface Node {
  id: string;
  type: NodeType;
  label: string;
}

/** Cap so a pathological graph cannot crowd out the rest of the prompt. */
const MAX_OBSERVATIONS = 8;

function spec(type: NodeType) {
  return NODE_TYPE_REGISTRY[type];
}

export function computeObservations(graph: SerializedGraph | null): string[] {
  if (!graph || graph.nodes.length === 0) return [];

  const nodes: Node[] = graph.nodes
    .filter((n) => isNodeType(n.t))
    .map((n) => ({ id: n.id, type: n.t as NodeType, label: n.l || n.id }));
  if (nodes.length === 0) return [];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Only edges between nodes we actually know about; the graph may carry stragglers.
  const edges = graph.edges.filter((e) => byId.has(e.f) && byId.has(e.to));

  const inbound = new Map<string, string[]>();
  const outbound = new Map<string, string[]>();
  for (const n of nodes) {
    inbound.set(n.id, []);
    outbound.set(n.id, []);
  }
  for (const e of edges) {
    outbound.get(e.f)!.push(e.to);
    inbound.get(e.to)!.push(e.f);
  }

  const name = (id: string) => byId.get(id)?.label ?? id;
  const out: string[] = [];

  // A shared datastore is the most common real bottleneck and the most useful trade-off.
  for (const n of nodes) {
    if (!spec(n.type).isDatastore) continue;
    const writers = inbound.get(n.id)!;
    if (writers.length >= 2) {
      out.push(
        `${n.label} is used by ${writers.length} nodes (${writers.map(name).join(", ")}) — it is shared state.`,
      );
    }
  }

  // A third-party call on the request path couples your uptime to theirs.
  const ingressIds = nodes.filter((n) => spec(n.type).isIngress).map((n) => n.id);
  const reachableWithoutQueue = new Set<string>();
  const walk = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    reachableWithoutQueue.add(id);
    for (const next of outbound.get(id) ?? []) {
      // A queue breaks the synchronous chain — that is the whole point of one.
      if (byId.get(next)?.type === "queue") continue;
      walk(next, seen);
    }
  };
  for (const id of ingressIds) walk(id, new Set());
  for (const n of nodes) {
    if (n.type === "external_api" && reachableWithoutQueue.has(n.id)) {
      out.push(`${n.label} is called synchronously from the request path, with no queue in between.`);
    }
  }

  // Disconnected nodes are almost always an accident of a previous edit.
  for (const n of nodes) {
    if (inbound.get(n.id)!.length === 0 && outbound.get(n.id)!.length === 0) {
      out.push(`${n.label} is not connected to anything.`);
    }
  }

  // A queue with nothing draining it (or a worker with nothing feeding it) is half a pattern.
  for (const n of nodes) {
    if (n.type === "queue") {
      const consumers = outbound.get(n.id)!.filter((id) => byId.get(id)?.type === "worker");
      if (consumers.length === 0) out.push(`${n.label} has no worker consuming it.`);
    }
    if (n.type === "worker") {
      const feeds = inbound.get(n.id)!.filter((id) => byId.get(id)?.type === "queue");
      if (feeds.length === 0) out.push(`${n.label} is not fed by a queue.`);
    }
  }

  // Ingress straight into storage means no place for validation or auth to live.
  for (const e of edges) {
    const from = byId.get(e.f)!;
    const to = byId.get(e.to)!;
    if (spec(from.type).isIngress && spec(to.type).isDatastore) {
      out.push(`${from.label} talks to ${to.label} directly, with no service in between.`);
    }
  }

  // A node every ingress path must traverse is the thing that must never be down.
  if (ingressIds.length > 0 && nodes.length >= 4) {
    for (const candidate of nodes) {
      if (ingressIds.includes(candidate.id)) continue;
      if (inbound.get(candidate.id)!.length < 2) continue;
      const withoutIt = new Set<string>();
      const walkSkipping = (id: string) => {
        if (withoutIt.has(id) || id === candidate.id) return;
        withoutIt.add(id);
        for (const next of outbound.get(id) ?? []) walkSkipping(next);
      };
      for (const id of ingressIds) walkSkipping(id);
      const strandedCount = nodes.filter(
        (n) => n.id !== candidate.id && !withoutIt.has(n.id),
      ).length;
      // Only interesting if removing it cuts off a real share of the graph.
      if (strandedCount >= 2) {
        out.push(
          `Everything downstream reaches ${candidate.label} first — ${strandedCount} nodes become unreachable without it.`,
        );
      }
    }
  }

  return out.slice(0, MAX_OBSERVATIONS);
}

/** The prompt block. Empty string when there is nothing true worth saying. */
export function renderObservations(graph: SerializedGraph | null): string {
  const observations = computeObservations(graph);
  if (observations.length === 0) return "";

  return `CANVAS OBSERVATIONS — computed from the diagram above. These are TRUE; use them and
never contradict them. If one of them is the most load-bearing weakness in the design, that is
your "tradeoff". They are also the best raw material for STRESS and CUT suggestions.
${observations.map((o) => `- ${o}`).join("\n")}`;
}
