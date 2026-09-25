import { describe, it, expect } from "vitest";
import { NODE_TYPES } from "./node-types";
import type { NodeType } from "./node-types";
import { generateScaffoldFiles, NODE_TYPE_COVERAGE, INFRA_TEMPLATES, type ScaffoldFile } from "./scaffold";
import type { SemanticNode, SemanticEdge } from "./semantic";

function node(id: string, type: NodeType, label?: string): SemanticNode {
  return { id, type, label: label ?? id };
}

function findFile(files: ScaffoldFile[], match: string): ScaffoldFile | undefined {
  return files.find((f) => f.path.includes(match));
}

describe("root files always present", () => {
  it("always emits docker-compose.yml, README.md and .gitignore, even for an empty graph", () => {
    const files = generateScaffoldFiles([], []);
    expect(findFile(files, "docker-compose.yml")).toBeDefined();
    expect(findFile(files, "README.md")).toBeDefined();
    expect(findFile(files, ".gitignore")).toBeDefined();
  });
});

describe("two-folder project shape (frontend/, backend/) — never one folder per node", () => {
  it("puts every service/auth node's code inside ONE shared backend/ app, not its own folder", () => {
    const nodes = [
      node("s1", "service", "Orders Service"),
      node("s2", "service", "Payments Service"),
      node("a1", "auth", "Auth Service"),
    ];
    const files = generateScaffoldFiles(nodes, []);
    const paths = files.map((f) => f.path);

    // Exactly one package.json/Dockerfile/tsconfig for the whole backend, not one per node.
    expect(paths.filter((p) => p.endsWith("package.json") && p.startsWith("backend/"))).toHaveLength(1);
    expect(paths.filter((p) => p.endsWith("Dockerfile") && p.startsWith("backend/"))).toHaveLength(1);
    expect(paths.filter((p) => p.endsWith("tsconfig.json") && p.startsWith("backend/"))).toHaveLength(1);

    // Each node becomes a router module inside that one app.
    expect(paths).toContain("backend/src/modules/orders-service/routes.ts");
    expect(paths).toContain("backend/src/modules/payments-service/routes.ts");
    expect(paths).toContain("backend/src/modules/auth-service/routes.ts");
    expect(paths).toContain("backend/src/index.ts");

    // No stray per-node folders at the project root.
    expect(paths.some((p) => p.startsWith("services/"))).toBe(false);
  });

  it("puts the client node's code inside frontend/", () => {
    const files = generateScaffoldFiles([node("c", "client", "Web Client")], []);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("frontend/package.json");
    expect(paths).toContain("frontend/src/App.tsx");
    expect(paths.some((p) => p.startsWith("client/"))).toBe(false);
  });

  it("gives a worker its own entrypoint file and compose entry, but shares the backend codebase (no own package.json)", () => {
    const nodes = [node("w", "worker", "Order Worker")];
    const files = generateScaffoldFiles(nodes, []);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("backend/src/workers/order-worker.ts");
    expect(paths.filter((p) => p.endsWith("package.json"))).toHaveLength(1); // shared, not its own
  });

  it("nests infra config (postgres init script, nginx conf) under backend/, not the project root", () => {
    const nodes = [
      node("gw", "api_gateway", "API Gateway"),
      node("svc", "service", "Orders Service"),
      node("db", "sql_db", "Orders DB"),
    ];
    const edges: SemanticEdge[] = [
      { id: "e1", source: "gw", target: "svc" },
      { id: "e2", source: "svc", target: "db" },
    ];
    const files = generateScaffoldFiles(nodes, edges);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("backend/db/orders-db/init.sql");
    expect(paths).toContain("backend/nginx/api-gateway.conf");
  });
});

describe("node type coverage stays consistent with actual generation logic", () => {
  it("every type marked 'infra' in NODE_TYPE_COVERAGE actually has an INFRA_TEMPLATES entry, and no other type does", () => {
    for (const [type, bucket] of Object.entries(NODE_TYPE_COVERAGE) as [NodeType, string][]) {
      if (bucket === "infra") expect(INFRA_TEMPLATES[type]).toBeDefined();
      else expect(INFRA_TEMPLATES[type]).toBeUndefined();
    }
  });
});

describe("SCAFFOLD_TEMPLATES completeness", () => {
  for (const type of NODE_TYPES) {
    it(`generates non-throwing, non-empty output for a lone "${type}" node`, () => {
      const files = generateScaffoldFiles([node("n1", type, "Test Node")], []);
      expect(files.length).toBeGreaterThan(0);
      const compose = findFile(files, "docker-compose.yml")!;
      expect(compose.contents.length).toBeGreaterThan(0);
      const readme = findFile(files, "README.md")!;
      expect(readme.contents).toContain("Test Node");
    });
  }

  it("client/cdn/external_api contribute no compose service block", () => {
    for (const type of ["client", "cdn", "external_api"] as const) {
      const files = generateScaffoldFiles([node("n1", type, "Test Node")], []);
      const compose = findFile(files, "docker-compose.yml")!;
      expect(compose.contents).not.toContain("  test-node:");
    }
  });

  it("sql_db produces an init.sql", () => {
    const files = generateScaffoldFiles([node("db1", "sql_db", "Orders DB")], []);
    expect(findFile(files, "init.sql")).toBeDefined();
  });

  it("cache produces a redis compose service", () => {
    const files = generateScaffoldFiles([node("c1", "cache", "Cache")], []);
    const compose = findFile(files, "docker-compose.yml")!;
    expect(compose.contents).toContain("redis");
  });
});

describe("slug collisions", () => {
  it("dedupes identical labels into distinct module folders", () => {
    const files = generateScaffoldFiles(
      [node("a", "service", "Api"), node("b", "service", "Api")],
      []
    );
    const paths = files.map((f) => f.path);
    expect(paths).toContain("backend/src/modules/api/routes.ts");
    expect(paths).toContain("backend/src/modules/api-2/routes.ts");
  });
});

describe("edge wiring", () => {
  it("service -> sql_db injects a namespaced DATABASE_URL and depends_on on the shared backend service", () => {
    const nodes = [node("svc", "service", "Orders Service"), node("db", "sql_db", "Orders DB")];
    const edges: SemanticEdge[] = [{ id: "e1", source: "svc", target: "db" }];
    const files = generateScaffoldFiles(nodes, edges);
    const env = findFile(files, "backend/.env.example")!;
    expect(env.contents).toContain("ORDERS_SERVICE_DATABASE_URL=");
    const compose = findFile(files, "docker-compose.yml")!;
    expect(compose.contents).toMatch(/backend:[\s\S]*depends_on:[\s\S]*orders-db/);
  });

  it("service -> cache injects a namespaced REDIS_URL", () => {
    const nodes = [node("svc", "service", "Api"), node("cache", "cache", "Cache")];
    const edges: SemanticEdge[] = [{ id: "e1", source: "svc", target: "cache" }];
    const files = generateScaffoldFiles(nodes, edges);
    const env = findFile(files, "backend/.env.example")!;
    expect(env.contents).toContain("API_REDIS_URL=");
  });

  it("two different service nodes each connecting to their own sql_db get distinct namespaced env keys (no collision in the shared file)", () => {
    const nodes = [
      node("s1", "service", "Orders Service"),
      node("s2", "service", "Payments Service"),
      node("d1", "sql_db", "Orders DB"),
      node("d2", "sql_db", "Payments DB"),
    ];
    const edges: SemanticEdge[] = [
      { id: "e1", source: "s1", target: "d1" },
      { id: "e2", source: "s2", target: "d2" },
    ];
    const files = generateScaffoldFiles(nodes, edges);
    const env = findFile(files, "backend/.env.example")!;
    expect(env.contents).toContain("ORDERS_SERVICE_DATABASE_URL=");
    expect(env.contents).toContain("PAYMENTS_SERVICE_DATABASE_URL=");
  });

  it("service -> queue and queue -> worker wire a producer and a consumer, sharing the backend codebase", () => {
    const nodes = [
      node("svc", "service", "Api"),
      node("q", "queue", "Orders Queue"),
      node("w", "worker", "Order Worker"),
    ];
    const edges: SemanticEdge[] = [
      { id: "e1", source: "svc", target: "q" },
      { id: "e2", source: "q", target: "w" },
    ];
    const files = generateScaffoldFiles(nodes, edges);
    const producer = findFile(files, "backend/src/modules/api/routes.ts")!;
    expect(producer.contents.toLowerCase()).toContain("orders-queue");
    const consumer = findFile(files, "backend/src/workers/order-worker.ts")!;
    expect(consumer.contents.toLowerCase()).toContain("orders-queue");
  });

  it("the producer/consumer code reads the SAME namespaced env key that's actually injected — not a hardcoded QUEUE_URL", () => {
    const nodes = [
      node("svc", "service", "Api"),
      node("q", "queue", "Orders Queue"),
      node("w", "worker", "Order Worker"),
    ];
    const edges: SemanticEdge[] = [
      { id: "e1", source: "svc", target: "q" },
      { id: "e2", source: "q", target: "w" },
    ];
    const files = generateScaffoldFiles(nodes, edges);
    const env = findFile(files, "backend/.env.example")!;
    expect(env.contents).toContain("API_QUEUE_URL=");
    expect(env.contents).toContain("ORDER_WORKER_QUEUE_URL=");

    const producer = findFile(files, "backend/src/modules/api/routes.ts")!;
    expect(producer.contents).toContain("process.env.API_QUEUE_URL");
    expect(producer.contents).not.toContain('process.env.QUEUE_URL ??');

    const consumer = findFile(files, "backend/src/workers/order-worker.ts")!;
    expect(consumer.contents).toContain("process.env.ORDER_WORKER_QUEUE_URL");
    expect(consumer.contents).not.toContain('process.env.QUEUE_URL ??');
  });

  it("a direct edge into a worker (bypassing a queue) is not wired as an HTTP call — workers aren't HTTP-addressable", () => {
    const nodes = [node("svc", "service", "Api"), node("w", "worker", "Worker")];
    const edges: SemanticEdge[] = [{ id: "e1", source: "svc", target: "w" }];
    expect(() => generateScaffoldFiles(nodes, edges)).not.toThrow();
    const files = generateScaffoldFiles(nodes, edges);
    const env = findFile(files, "backend/.env.example")!;
    expect(env.contents).not.toMatch(/WORKER_URL/);
  });

  it("service -> external_api injects namespaced BASE_URL/API_KEY and no depends_on", () => {
    const nodes = [node("svc", "service", "Api"), node("ext", "external_api", "Payments API")];
    const edges: SemanticEdge[] = [{ id: "e1", source: "svc", target: "ext" }];
    const files = generateScaffoldFiles(nodes, edges);
    const env = findFile(files, "backend/.env.example")!;
    expect(env.contents).toMatch(/API_PAYMENTS_API_BASE_URL=/);
    expect(env.contents).toMatch(/API_PAYMENTS_API_API_KEY=/);
    const compose = findFile(files, "docker-compose.yml")!;
    expect(compose.contents).not.toMatch(/backend:[\s\S]*depends_on:[\s\S]*payments-api/);
  });

  it("an edge between two service/auth nodes needs no depends_on — they share one container", () => {
    const nodes = [node("gw", "service", "Gateway Logic"), node("svc", "service", "Orders Service")];
    const edges: SemanticEdge[] = [{ id: "e1", source: "gw", target: "svc" }];
    const files = generateScaffoldFiles(nodes, edges);
    const compose = findFile(files, "docker-compose.yml")!;
    expect(compose.contents).not.toMatch(/depends_on:\s*\n\s*- orders-service/);
  });

  it("drops a dangling edge instead of throwing", () => {
    const nodes = [node("svc", "service", "Api")];
    const edges: SemanticEdge[] = [{ id: "e1", source: "svc", target: "ghost" }];
    expect(() => generateScaffoldFiles(nodes, edges)).not.toThrow();
  });
});

describe("auth template", () => {
  it("includes a working JWT login and verify example inside its router module", () => {
    const files = generateScaffoldFiles([node("auth", "auth", "Auth Service")], []);
    const index = findFile(files, "backend/src/modules/auth-service/routes.ts")!;
    expect(index.contents).toContain("jsonwebtoken");
    expect(index.contents).toMatch(/jwt\.sign/);
    expect(index.contents).toMatch(/jwt\.verify/);
    const env = findFile(files, "backend/.env.example")!;
    expect(env.contents).toContain("AUTH_SERVICE_JWT_SECRET=");
  });
});

describe("known limitations are surfaced, not silently dropped", () => {
  it("notes in the README when more than one client node exists but only the first is scaffolded", () => {
    const nodes = [node("c1", "client", "Web Client"), node("c2", "client", "Admin Client")];
    const files = generateScaffoldFiles(nodes, []);
    const readme = findFile(files, "README.md")!;
    expect(readme.contents).toMatch(/Admin Client/);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("frontend/src/App.tsx");
  });

  it("notes in the README when more than one sql_db connection exists but only the first got a real Prisma schema", () => {
    const nodes = [
      node("s1", "service", "Orders Service"),
      node("s2", "service", "Payments Service"),
      node("d1", "sql_db", "Orders DB"),
      node("d2", "sql_db", "Payments DB"),
    ];
    const edges: SemanticEdge[] = [
      { id: "e1", source: "s1", target: "d1" },
      { id: "e2", source: "s2", target: "d2" },
    ];
    const files = generateScaffoldFiles(nodes, edges);
    expect(findFile(files, "backend/prisma/schema.prisma")).toBeDefined();
    const readme = findFile(files, "README.md")!;
    expect(readme.contents.toLowerCase()).toContain("payments db");
  });
});
