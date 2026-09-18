import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import JSZip from "jszip";

describe("POST /api/scaffold", () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    const { default: scaffoldRouter } = await import("./scaffold");
    const app = express();
    app.use(express.json());
    app.use("/api", scaffoldRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://localhost:${(server.address() as AddressInfo).port}/api/scaffold`;
  });

  afterAll(() => server.close());

  async function post(body: unknown) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("generates a zip with a two-folder (frontend/backend) shape for a mixed diagram", async () => {
    const res = await post({
      nodes: [
        { id: "c", type: "client", label: "Web Client" },
        { id: "gw", type: "api_gateway", label: "API Gateway" },
        { id: "svc", type: "service", label: "Orders Service" },
        { id: "db", type: "sql_db", label: "Orders DB" },
        { id: "q", type: "queue", label: "Orders Queue" },
        { id: "w", type: "worker", label: "Order Worker" },
        { id: "cache", type: "cache", label: "Cache" },
      ],
      edges: [
        { id: "e1", source: "c", target: "gw" },
        { id: "e2", source: "gw", target: "svc" },
        { id: "e3", source: "svc", target: "db" },
        { id: "e4", source: "svc", target: "q" },
        { id: "e5", source: "q", target: "w" },
        { id: "e6", source: "svc", target: "cache" },
      ],
      projectName: "Test Project",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("test-project.zip");

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const paths = Object.keys(zip.files);

    expect(paths).toContain("docker-compose.yml");
    expect(paths).toContain("README.md");
    expect(paths).toContain(".gitignore");
    expect(paths).toContain("frontend/package.json");
    expect(paths).toContain("backend/package.json");
    expect(paths).toContain("backend/nginx/api-gateway.conf");
    expect(paths).toContain("backend/src/modules/orders-service/routes.ts");
    expect(paths).toContain("backend/.env.example");
    expect(paths).toContain("backend/db/orders-db/init.sql");
    expect(paths).toContain("backend/src/workers/order-worker.ts");
    // No stray per-node folders.
    expect(paths.some((p) => p.startsWith("services/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("client/"))).toBe(false);

    const compose = await zip.file("docker-compose.yml")!.async("string");
    expect(compose).toContain("redis");
    expect(compose).toMatch(/backend:[\s\S]*depends_on:[\s\S]*orders-db/);
  });

  it("returns 200 with a minimal valid zip for an empty graph, not 400", async () => {
    const res = await post({ nodes: [], edges: [] });
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files)).toContain("README.md");
  });

  it("returns 400 when nodes is missing", async () => {
    const res = await post({ edges: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when nodes is not an array", async () => {
    const res = await post({ nodes: "nope", edges: [] });
    expect(res.status).toBe(400);
  });

  it("coerces an unknown node type to service instead of failing the export", async () => {
    const res = await post({
      nodes: [{ id: "n1", type: "totally-not-a-real-type", label: "Mystery" }],
      edges: [],
    });
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files)).toContain("backend/src/modules/mystery/routes.ts");
  });

  it("gives duplicate labels collision-safe, distinct module folders in the actual zip", async () => {
    const res = await post({
      nodes: [
        { id: "a", type: "service", label: "Api" },
        { id: "b", type: "service", label: "Api" },
      ],
      edges: [],
    });
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const paths = Object.keys(zip.files);
    expect(paths).toContain("backend/src/modules/api/routes.ts");
    expect(paths).toContain("backend/src/modules/api-2/routes.ts");
  });
});
