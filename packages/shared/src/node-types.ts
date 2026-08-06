import type { NodeShape } from "./presentation";

/**
 * The closed node-type vocabulary. This is a PUBLIC INTERFACE shared by four
 * consumers — renderer, lint engine, load simulator, scaffold engine. Changing an
 * existing entry's meaning is a breaking change even though nothing types it as an
 * API. Adding a type should stay a one-place change: extend this list and add its
 * registry entry below, and every consumer picks it up.
 */
export const NODE_TYPES = [
  "client",
  "cdn",
  "load_balancer",
  "api_gateway",
  "service",
  "worker",
  "queue",
  "cache",
  "sql_db",
  "nosql_db",
  "object_store",
  "search_index",
  "auth",
  "external_api",
  "observability",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export interface NodeTypeSpec {
  // ---- renderer ----
  shape: NodeShape;
  /** Index into NODE_COLORS. */
  colorIndex: number;
  /** lucide-react icon name. Declared for later slices; not rendered yet. */
  icon: string;
  defaultLabel: string;

  // ---- lint engine predicates ----
  isDatastore: boolean;
  /** Load can enter the graph here. */
  isIngress: boolean;
  /** Terminal consumer of traffic — does not forward downstream by default. */
  absorbsLoad: boolean;

  // ---- load simulator ----
  capacityRps: number;
  latencyMs: number;
  /** Only present where caching is the point of the node. */
  cacheHitRatio?: number;

  // ---- scaffold engine ----
  templateKey: string;
}

/**
 * Capacity and latency figures are plausible placeholders; the load-simulator slice
 * tunes them. `client` carries capacityRps 0 because it is a load SOURCE and has no
 * meaningful capacity — the simulator must ignore a source's capacity rather than
 * treat it as a zero-capacity bottleneck.
 */
export const NODE_TYPE_REGISTRY: Record<NodeType, NodeTypeSpec> = {
  client: {
    shape: "circle", colorIndex: 5, icon: "Monitor", defaultLabel: "Client",
    isDatastore: false, isIngress: true, absorbsLoad: false,
    capacityRps: 0, latencyMs: 0, templateKey: "client",
  },
  cdn: {
    shape: "hexagon", colorIndex: 6, icon: "Globe", defaultLabel: "CDN",
    isDatastore: false, isIngress: true, absorbsLoad: false,
    capacityRps: 50000, latencyMs: 10, cacheHitRatio: 0.9, templateKey: "cdn",
  },
  load_balancer: {
    shape: "diamond", colorIndex: 1, icon: "Split", defaultLabel: "Load Balancer",
    isDatastore: false, isIngress: true, absorbsLoad: false,
    capacityRps: 20000, latencyMs: 2, templateKey: "nginx",
  },
  api_gateway: {
    shape: "rectangle", colorIndex: 1, icon: "DoorOpen", defaultLabel: "API Gateway",
    isDatastore: false, isIngress: true, absorbsLoad: false,
    capacityRps: 10000, latencyMs: 5, templateKey: "gateway",
  },
  service: {
    shape: "rectangle", colorIndex: 1, icon: "Box", defaultLabel: "Service",
    isDatastore: false, isIngress: false, absorbsLoad: true,
    capacityRps: 1000, latencyMs: 40, templateKey: "node-service",
  },
  worker: {
    shape: "pill", colorIndex: 3, icon: "Cog", defaultLabel: "Worker",
    isDatastore: false, isIngress: false, absorbsLoad: true,
    capacityRps: 500, latencyMs: 200, templateKey: "node-worker",
  },
  queue: {
    shape: "pill", colorIndex: 3, icon: "ListOrdered", defaultLabel: "Queue",
    isDatastore: false, isIngress: false, absorbsLoad: false,
    capacityRps: 20000, latencyMs: 5, templateKey: "rabbitmq",
  },
  cache: {
    shape: "cylinder", colorIndex: 3, icon: "Zap", defaultLabel: "Cache",
    isDatastore: true, isIngress: false, absorbsLoad: false,
    capacityRps: 50000, latencyMs: 1, cacheHitRatio: 0.8, templateKey: "redis",
  },
  sql_db: {
    shape: "cylinder", colorIndex: 7, icon: "Database", defaultLabel: "SQL Database",
    isDatastore: true, isIngress: false, absorbsLoad: true,
    capacityRps: 800, latencyMs: 15, templateKey: "postgres",
  },
  nosql_db: {
    shape: "cylinder", colorIndex: 7, icon: "Database", defaultLabel: "NoSQL Database",
    isDatastore: true, isIngress: false, absorbsLoad: true,
    capacityRps: 5000, latencyMs: 8, templateKey: "mongodb",
  },
  object_store: {
    shape: "cylinder", colorIndex: 7, icon: "Archive", defaultLabel: "Object Store",
    isDatastore: true, isIngress: false, absorbsLoad: true,
    capacityRps: 5000, latencyMs: 30, templateKey: "minio",
  },
  search_index: {
    shape: "cylinder", colorIndex: 7, icon: "Search", defaultLabel: "Search Index",
    isDatastore: true, isIngress: false, absorbsLoad: true,
    capacityRps: 1500, latencyMs: 25, templateKey: "elasticsearch",
  },
  auth: {
    shape: "hexagon", colorIndex: 2, icon: "ShieldCheck", defaultLabel: "Auth Service",
    isDatastore: false, isIngress: false, absorbsLoad: true,
    capacityRps: 3000, latencyMs: 20, templateKey: "auth",
  },
  external_api: {
    shape: "hexagon", colorIndex: 0, icon: "ExternalLink", defaultLabel: "External API",
    isDatastore: false, isIngress: false, absorbsLoad: true,
    capacityRps: 200, latencyMs: 150, templateKey: "external",
  },
  observability: {
    shape: "rectangle", colorIndex: 6, icon: "Activity", defaultLabel: "Observability",
    isDatastore: false, isIngress: false, absorbsLoad: true,
    capacityRps: 10000, latencyMs: 5, templateKey: "prometheus",
  },
};

/** Narrowing guard for untrusted input (model output, wire data). */
export function isNodeType(value: unknown): value is NodeType {
  return typeof value === "string" && (NODE_TYPES as readonly string[]).includes(value);
}
