import { NODE_TYPE_REGISTRY, type NodeType } from "./node-types";
import type { SemanticNode, SemanticEdge } from "./semantic";

/** One file in the generated zip. */
export interface ScaffoldFile {
  path: string;
  contents: string;
}

interface EnvVar {
  key: string;
  value: string;
}

interface ComposeService {
  name: string;
  image?: string;
  build?: string;
  command?: string;
  ports?: string[];
  environment?: Record<string, string>;
  volumes?: string[];
  dependsOn?: string[];
}

interface ScaffoldNodeContext {
  node: SemanticNode;
  slug: string;
  env: EnvVar[];
  dependsOn: string[];
  // The env key is stored alongside the slug because addEnv can rename it on collision
  // (e.g. a node wired to two queues) — generated code must reference the real key, not
  // assume a fixed name.
  producesTo: { slug: string; envKey: string }[];
  consumesFrom: { slug: string; envKey: string }[];
}

interface ScaffoldManifest {
  nodes: ScaffoldNodeContext[];
  byId: Map<string, ScaffoldNodeContext>;
  edges: SemanticEdge[];
}

// ---------------------------------------------------------------------------
// slugs
// ---------------------------------------------------------------------------

/** Kebab-cases a label for use as a folder name / compose service name / env prefix. */
export function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "node";
}

function envPrefix(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}

function pascal(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

function camel(slug: string): string {
  const p = pascal(slug);
  return p ? p[0].toLowerCase() + p.slice(1) : p;
}

// ---------------------------------------------------------------------------
// project shape: everything is either the ONE frontend/ app or the ONE
// backend/ app (plus infra config nested under backend/) — never one folder
// per node. `service`/`auth` nodes become routers mounted inside the single
// backend app; `worker` nodes get their own entrypoint file sharing that same
// codebase, run as a separate compose entry (same pattern real systems use
// for e.g. Django+Celery — one codebase, multiple process types).
// ---------------------------------------------------------------------------

const ROUTER_TYPES = new Set<NodeType>(["service", "auth"]);
// Types whose env/dependsOn/queue wiring is meaningful — everything that runs
// generated application code (routers share the one backend app; workers get
// their own entrypoint in it).
const WIRABLE = new Set<NodeType>(["service", "auth", "worker"]);

const BACKEND_PORT = 4000;

/**
 * Every NodeType must be handled by exactly one of: the client-node branch, the shared
 * backend app (ROUTER_TYPES ∪ "worker"), or an INFRA_TEMPLATES entry. This literal is typed
 * against the full 15-entry enum on purpose — TypeScript refuses to compile this file if a
 * type is ever added here without being accounted for below, the same structural guarantee
 * NODE_TYPE_REGISTRY itself relies on. Exported so a test can assert INFRA_TEMPLATES' keys
 * plus the two special-cased groups add up to exactly this set.
 */
export const NODE_TYPE_COVERAGE: Record<NodeType, "client" | "backend-app" | "infra"> = {
  client: "client",
  service: "backend-app",
  worker: "backend-app",
  auth: "backend-app",
  cdn: "infra",
  load_balancer: "infra",
  api_gateway: "infra",
  queue: "infra",
  cache: "infra",
  sql_db: "infra",
  nosql_db: "infra",
  object_store: "infra",
  search_index: "infra",
  external_api: "infra",
  observability: "infra",
};

// ---------------------------------------------------------------------------
// manifest + edge wiring
// ---------------------------------------------------------------------------

/** Returns the actual key used, since a collision renames it — callers that need to reference
 * this value from generated code must use the returned key, not assume a fixed name. */
function addEnv(ctx: ScaffoldNodeContext, baseKey: string, value: string, disambiguator: string): string {
  const ownPrefix = envPrefix(ctx.slug);
  const key = `${ownPrefix}_${baseKey}`;
  const finalKey = ctx.env.some((e) => e.key === key) ? `${ownPrefix}_${disambiguator}_${baseKey}` : key;
  if (!ctx.env.some((e) => e.key === finalKey)) ctx.env.push({ key: finalKey, value });
  return finalKey;
}

function pushUnique(arr: string[], val: string): void {
  if (!arr.includes(val)) arr.push(val);
}

function pushUniqueQueueRef(arr: { slug: string; envKey: string }[], entry: { slug: string; envKey: string }): void {
  if (!arr.some((e) => e.slug === entry.slug)) arr.push(entry);
}

/** Maps a target's own node type to the port its generated container listens on. */
function containerPort(type: NodeType): number {
  if (type === "load_balancer" || type === "api_gateway") return 80;
  if (type === "observability") return 9090;
  return BACKEND_PORT;
}

function wireEdge(source: ScaffoldNodeContext, target: ScaffoldNodeContext): void {
  const targetType = target.node.type;
  const sourceType = source.node.type;

  // Nothing calls into a client, and a CDN isn't addressed by env var.
  if (targetType === "client" || targetType === "cdn") return;

  if (targetType === "queue") {
    if (WIRABLE.has(sourceType)) {
      const envKey = addEnv(source, "QUEUE_URL", `amqp://${target.slug}:5672`, envPrefix(target.slug));
      pushUniqueQueueRef(source.producesTo, { slug: target.slug, envKey });
      pushUnique(source.dependsOn, target.slug);
    }
    return;
  }

  if (sourceType === "queue") {
    if (WIRABLE.has(targetType)) {
      const envKey = addEnv(target, "QUEUE_URL", `amqp://${source.slug}:5672`, envPrefix(source.slug));
      pushUniqueQueueRef(target.consumesFrom, { slug: source.slug, envKey });
      pushUnique(target.dependsOn, source.slug);
    }
    return;
  }

  if (targetType === "external_api") {
    if (WIRABLE.has(sourceType)) {
      const dis = envPrefix(target.slug);
      addEnv(source, `${dis}_BASE_URL`, "https://api.example.com", dis);
      addEnv(source, `${dis}_API_KEY`, "changeme", dis);
    }
    // No depends_on — there is no container to wait on.
    return;
  }

  // A worker has no HTTP surface — it is reachable only via a queue (handled above).
  if (targetType === "worker") return;

  const targetSpec = NODE_TYPE_REGISTRY[targetType];
  if (targetSpec.isDatastore) {
    if (!WIRABLE.has(sourceType)) return;
    const dis = envPrefix(target.slug);
    switch (targetType) {
      case "sql_db":
        addEnv(source, "DATABASE_URL", `postgresql://app:app@${target.slug}:5432/app?schema=public`, dis);
        break;
      case "nosql_db":
        addEnv(source, "DATABASE_URL", `mongodb://${target.slug}:27017/app`, dis);
        break;
      case "cache":
        addEnv(source, "REDIS_URL", `redis://${target.slug}:6379`, dis);
        break;
      case "object_store":
        addEnv(source, "S3_ENDPOINT", `http://${target.slug}:9000`, dis);
        addEnv(source, "S3_BUCKET", "app-bucket", dis);
        break;
      case "search_index":
        addEnv(source, "ELASTICSEARCH_URL", `http://${target.slug}:9200`, dis);
        break;
    }
    pushUnique(source.dependsOn, target.slug);
    return;
  }

  if (!WIRABLE.has(sourceType)) return;

  // A router-type target (service/auth) lives in the SAME shared backend container as any
  // other router-type source — reachable by path, not by hostname, and it starts in the same
  // process so there is nothing to depends_on.
  if (ROUTER_TYPES.has(targetType)) {
    addEnv(source, `${envPrefix(target.slug)}_URL`, `http://backend:${BACKEND_PORT}/${target.slug}`, envPrefix(target.slug));
    return;
  }

  // Generic separate-container target (gateway, load balancer, observability, ...).
  const dis = envPrefix(target.slug);
  addEnv(source, `${dis}_URL`, `http://${target.slug}:${containerPort(targetType)}`, dis);
  pushUnique(source.dependsOn, target.slug);
}

function buildManifest(nodes: SemanticNode[], edges: SemanticEdge[]): ScaffoldManifest {
  const used = new Map<string, number>();
  const contexts: ScaffoldNodeContext[] = [];
  const byId = new Map<string, ScaffoldNodeContext>();

  for (const node of nodes) {
    const base = slugify(node.label);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count + 1}`;
    const ctx: ScaffoldNodeContext = {
      node,
      slug,
      env: [],
      dependsOn: [],
      producesTo: [],
      consumesFrom: [],
    };
    contexts.push(ctx);
    byId.set(node.id, ctx);
  }

  // A dangling edge (an id not present in this diagram) is not a valid graph state,
  // so it is dropped here rather than making every consumer guard against it.
  const validEdges = edges.filter((e) => byId.has(e.source) && byId.has(e.target));

  for (const edge of validEdges) {
    wireEdge(byId.get(edge.source)!, byId.get(edge.target)!);
  }

  return { nodes: contexts, byId, edges: validEdges };
}

// ---------------------------------------------------------------------------
// the shared backend/ app: service + auth nodes become routers in one app;
// worker nodes get their own entrypoint sharing the same codebase.
// ---------------------------------------------------------------------------

const TSCONFIG_NODE = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
`;

function dockerfileNode(): string {
  return `FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE ${BACKEND_PORT}
CMD ["npm", "run", "dev"]
`;
}

/** The first sql_db this node has a direct edge to, if any. */
function firstSqlDbTarget(ctx: ScaffoldNodeContext, manifest: ScaffoldManifest): ScaffoldNodeContext | null {
  for (const edge of manifest.edges) {
    if (edge.source !== ctx.node.id) continue;
    const target = manifest.byId.get(edge.target);
    if (target?.node.type === "sql_db") return target;
  }
  return null;
}

function prismaSchema(): string {
  return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Example {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
}
`;
}

function backendPackageJson(opts: { hasPrisma: boolean; hasQueue: boolean; hasJwt: boolean }): string {
  const dependencies: Record<string, string> = { express: "^4.21.0", dotenv: "^16.4.5" };
  const devDependencies: Record<string, string> = {
    typescript: "^5.6.0",
    "ts-node-dev": "^2.0.0",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
  };
  if (opts.hasPrisma) {
    dependencies["@prisma/client"] = "^5.20.0";
    devDependencies.prisma = "^5.20.0";
  }
  if (opts.hasQueue) {
    dependencies.amqplib = "^0.10.4";
    devDependencies["@types/amqplib"] = "^0.10.5";
  }
  if (opts.hasJwt) {
    dependencies.jsonwebtoken = "^9.0.2";
    devDependencies["@types/jsonwebtoken"] = "^9.0.7";
  }
  return (
    JSON.stringify(
      {
        name: "backend",
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "ts-node-dev --respawn --transpile-only src/index.ts",
          build: "tsc",
          start: "node dist/index.js",
        },
        dependencies,
        devDependencies,
      },
      null,
      2
    ) + "\n"
  );
}

/** JWT_SECRET is namespaced per auth node, same as any other wiring-derived env var. */
function jwtEnvVar(ctx: ScaffoldNodeContext): EnvVar {
  return { key: `${envPrefix(ctx.slug)}_JWT_SECRET`, value: "dev-secret-change-me" };
}

function moduleRouteFile(ctx: ScaffoldNodeContext, opts: { usesPrisma: boolean }): string {
  const isAuth = ctx.node.type === "auth";
  const hasQueue = ctx.producesTo.length > 0 || ctx.consumesFrom.length > 0;
  const lines: string[] = isAuth
    ? [`import express, { Router } from "express";`]
    : [`import { Router } from "express";`];
  if (opts.usesPrisma) lines.push(`import { prisma } from "../../prisma";`);
  if (hasQueue) lines.push(`import amqplib from "amqplib";`);
  if (isAuth) lines.push(`import jwt from "jsonwebtoken";`);
  lines.push("", `const router = Router();`, "");

  if (isAuth) {
    const secretKey = jwtEnvVar(ctx).key;
    lines.push(
      `const JWT_SECRET = process.env.${secretKey} ?? "dev-secret-change-me";`,
      "",
      `router.post("/login", (req, res) => {`,
      `  const { username } = req.body ?? {};`,
      `  if (!username) {`,
      `    res.status(400).json({ error: "username is required" });`,
      `    return;`,
      `  }`,
      `  const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: "1h" });`,
      `  res.json({ token });`,
      `});`,
      "",
      `function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {`,
      `  const header = req.headers.authorization;`,
      `  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;`,
      `  if (!token) {`,
      `    res.status(401).json({ error: "missing token" });`,
      `    return;`,
      `  }`,
      `  try {`,
      `    (req as express.Request & { user?: unknown }).user = jwt.verify(token, JWT_SECRET);`,
      `    next();`,
      `  } catch {`,
      `    res.status(401).json({ error: "invalid token" });`,
      `  }`,
      `}`,
      "",
      `router.get("/me", requireAuth, (req, res) => {`,
      `  res.json({ user: (req as express.Request & { user?: unknown }).user });`,
      `});`,
      ""
    );
  }

  lines.push(`router.get("/health", (_req, res) => res.json({ status: "ok", service: "${ctx.node.label}" }));`, "");

  for (const q of ctx.producesTo) {
    const fn = pascal(q.slug);
    lines.push(
      `export async function publishTo${fn}(message: unknown) {`,
      `  const conn = await amqplib.connect(process.env.${q.envKey} ?? "amqp://localhost:5672");`,
      `  const channel = await conn.createChannel();`,
      `  const queueName = "${q.slug}";`,
      `  await channel.assertQueue(queueName);`,
      `  channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)));`,
      `  await channel.close();`,
      `  await conn.close();`,
      `}`,
      ""
    );
  }

  lines.push(`export default router;`);
  return lines.join("\n") + "\n";
}

function workerEntrypointFile(ctx: ScaffoldNodeContext, opts: { usesPrisma: boolean }): string {
  const lines: string[] = [`import "dotenv/config";`];
  if (opts.usesPrisma) lines.push(`import { prisma } from "../prisma";`);
  if (ctx.consumesFrom.length === 0) {
    lines.push(
      "",
      `// No queue is wired to "${ctx.node.label}" yet — connect one on the canvas to generate a`,
      `// real consumer loop here.`,
      `console.log("${ctx.node.label} worker started (idle — no queue wired).");`
    );
    return lines.join("\n") + "\n";
  }

  lines.push(`import amqplib from "amqplib";`, "");
  for (const q of ctx.consumesFrom) {
    const fn = pascal(q.slug);
    lines.push(
      `async function consumeFrom${fn}() {`,
      `  const conn = await amqplib.connect(process.env.${q.envKey} ?? "amqp://localhost:5672");`,
      `  const channel = await conn.createChannel();`,
      `  const queueName = "${q.slug}";`,
      `  await channel.assertQueue(queueName);`,
      `  channel.consume(queueName, (msg) => {`,
      `    if (!msg) return;`,
      `    console.log("received from ${q.slug}:", msg.content.toString());`,
      `    channel.ack(msg);`,
      `  });`,
      `}`,
      `consumeFrom${fn}().catch((err) => console.error("failed to start consumer:", err));`,
      ""
    );
  }
  lines.push(`console.log("${ctx.node.label} worker started.");`);
  return lines.join("\n") + "\n";
}

function backendIndexTs(routerNodes: ScaffoldNodeContext[]): string {
  const lines: string[] = [`import "dotenv/config";`, `import express from "express";`];
  for (const ctx of routerNodes) {
    lines.push(`import ${camel(ctx.slug)}Router from "./modules/${ctx.slug}/routes";`);
  }
  lines.push("", `const app = express();`, `app.use(express.json());`, "");
  for (const ctx of routerNodes) {
    lines.push(`app.use("/${ctx.slug}", ${camel(ctx.slug)}Router);`);
  }
  lines.push(
    "",
    `app.get("/health", (_req, res) => res.json({ status: "ok" }));`,
    "",
    `const PORT = process.env.PORT ? Number(process.env.PORT) : ${BACKEND_PORT};`,
    `app.listen(PORT, () => console.log("backend listening on port " + PORT));`
  );
  return lines.join("\n") + "\n";
}

/** Every node whose application code lives in the shared backend/ app, in a deterministic order. */
function backendAppNodes(manifest: ScaffoldManifest): ScaffoldNodeContext[] {
  return manifest.nodes.filter((n) => WIRABLE.has(n.node.type));
}

function assembleBackendApp(manifest: ScaffoldManifest): {
  files: ScaffoldFile[];
  composeServices: ComposeService[];
  notes: string[];
} {
  const routerNodes = manifest.nodes.filter((n) => ROUTER_TYPES.has(n.node.type));
  const workerNodes = manifest.nodes.filter((n) => n.node.type === "worker");
  const appNodes = backendAppNodes(manifest);

  if (appNodes.length === 0) return { files: [], composeServices: [], notes: [] };

  // Prisma has exactly one datasource — only the first sql_db connection found, scanning in
  // canvas order, gets a real schema/client. Everything else still gets its DATABASE_URL env
  // var, just no ORM binding — documented in the README rather than silently dropped.
  let primaryDbNodeId: string | null = null;
  const extraDbLabels: string[] = [];
  for (const ctx of appNodes) {
    const target = firstSqlDbTarget(ctx, manifest);
    if (!target) continue;
    if (primaryDbNodeId === null) primaryDbNodeId = ctx.node.id;
    else extraDbLabels.push(target.node.label);
  }
  const hasPrisma = primaryDbNodeId !== null;
  const hasJwt = routerNodes.some((n) => n.node.type === "auth");
  const hasQueue = appNodes.some((n) => n.producesTo.length > 0 || n.consumesFrom.length > 0);

  const files: ScaffoldFile[] = [
    { path: "backend/package.json", contents: backendPackageJson({ hasPrisma, hasQueue, hasJwt }) },
    { path: "backend/tsconfig.json", contents: TSCONFIG_NODE },
    { path: "backend/Dockerfile", contents: dockerfileNode() },
  ];
  if (hasPrisma) {
    files.push({ path: "backend/prisma/schema.prisma", contents: prismaSchema() });
    files.push({
      path: "backend/src/prisma.ts",
      contents: `import { PrismaClient } from "@prisma/client";\n\nexport const prisma = new PrismaClient();\n`,
    });
  }

  for (const ctx of routerNodes) {
    files.push({
      path: `backend/src/modules/${ctx.slug}/routes.ts`,
      contents: moduleRouteFile(ctx, { usesPrisma: hasPrisma && ctx.node.id === primaryDbNodeId }),
    });
  }
  if (routerNodes.length > 0) files.push({ path: "backend/src/index.ts", contents: backendIndexTs(routerNodes) });

  for (const ctx of workerNodes) {
    files.push({
      path: `backend/src/workers/${ctx.slug}.ts`,
      contents: workerEntrypointFile(ctx, { usesPrisma: hasPrisma && ctx.node.id === primaryDbNodeId }),
    });
  }

  const envLines: EnvVar[] = [];
  for (const ctx of appNodes) {
    envLines.push(...ctx.env);
    if (ctx.node.type === "auth") envLines.push(jwtEnvVar(ctx));
  }
  files.push({
    path: "backend/.env.example",
    contents: [`PORT=${BACKEND_PORT}`, ...envLines.map((e) => `${e.key}=${e.value}`)].join("\n") + "\n",
  });

  const composeServices: ComposeService[] = [];
  if (routerNodes.length > 0) {
    const environment: Record<string, string> = { PORT: String(BACKEND_PORT) };
    const dependsOn: string[] = [];
    for (const ctx of routerNodes) {
      for (const e of ctx.env) environment[e.key] = e.value;
      if (ctx.node.type === "auth") environment[jwtEnvVar(ctx).key] = jwtEnvVar(ctx).value;
      for (const d of ctx.dependsOn) pushUnique(dependsOn, d);
    }
    composeServices.push({
      name: "backend",
      build: "./backend",
      ports: [`${BACKEND_PORT}:${BACKEND_PORT}`],
      environment,
      dependsOn: dependsOn.length ? dependsOn : undefined,
    });
  }

  for (const ctx of workerNodes) {
    const environment: Record<string, string> = {};
    for (const e of ctx.env) environment[e.key] = e.value;
    composeServices.push({
      name: ctx.slug,
      build: "./backend",
      command: `sh -c "npx ts-node-dev --transpile-only --respawn src/workers/${ctx.slug}.ts"`,
      environment: Object.keys(environment).length ? environment : undefined,
      dependsOn: ctx.dependsOn.length ? [...ctx.dependsOn] : undefined,
    });
  }

  const notes = routerNodes
    .map(
      (ctx) =>
        `- **${ctx.node.label}** (${ctx.node.type === "auth" ? "auth service, with a working JWT login/verify example" : "service"}) — mounted at \`/${ctx.slug}\` inside the shared \`backend/\` app.`
    )
    .concat(
      workerNodes.map(
        (ctx) =>
          `- **${ctx.node.label}** (background worker) — \`backend/src/workers/${ctx.slug}.ts\`, shares the backend codebase but runs as its own process.`
      )
    );

  if (extraDbLabels.length > 0) {
    notes.push(
      `- **Known limitation:** Prisma supports one datasource. Only the first database connection found (wired to \`backend/prisma/schema.prisma\`) got a real ORM binding — ${extraDbLabels.join(", ")} ${extraDbLabels.length === 1 ? "is" : "are"} reachable via its env var only; extend the schema by hand to use it.`
    );
  }

  return { files, composeServices, notes };
}

// ---------------------------------------------------------------------------
// frontend/ (React + Vite + TS) — only the first client node is scaffolded
// ---------------------------------------------------------------------------

function clientFiles(ctx: ScaffoldNodeContext, manifest: ScaffoldManifest): ScaffoldFile[] {
  let apiUrl = `http://localhost:${BACKEND_PORT}`;
  for (const edge of manifest.edges) {
    if (edge.source !== ctx.node.id) continue;
    const target = manifest.byId.get(edge.target);
    if (!target) continue;
    if (target.node.type === "api_gateway" || target.node.type === "load_balancer") {
      apiUrl = "http://localhost:8080";
      break;
    }
    if (ROUTER_TYPES.has(target.node.type)) {
      apiUrl = `http://localhost:${BACKEND_PORT}/${target.slug}`;
      break;
    }
  }

  const packageJson =
    JSON.stringify(
      {
        name: "frontend",
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: { dev: "vite", build: "tsc && vite build", preview: "vite preview" },
        dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
        devDependencies: {
          "@types/react": "^18.3.12",
          "@types/react-dom": "^18.3.1",
          "@vitejs/plugin-react": "^4.3.4",
          typescript: "^5.6.3",
          vite: "^6.0.1",
        },
      },
      null,
      2
    ) + "\n";

  const viteConfig = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
`;

  const tsconfig = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`;

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${ctx.node.label}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

  const mainTsx = `import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

  const appTsx = `import { useEffect, useState } from "react";

const API_URL = "${apiUrl}";

export function App() {
  const [status, setStatus] = useState("loading...");

  useEffect(() => {
    fetch(\`\${API_URL}/health\`)
      .then((res) => res.json())
      .then((data) => setStatus(JSON.stringify(data)))
      .catch(() => setStatus("could not reach backend at " + API_URL));
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>${ctx.node.label}</h1>
      <p>Backend status: {status}</p>
    </main>
  );
}
`;

  return [
    { path: "frontend/package.json", contents: packageJson },
    { path: "frontend/vite.config.ts", contents: viteConfig },
    { path: "frontend/tsconfig.json", contents: tsconfig },
    { path: "frontend/index.html", contents: indexHtml },
    { path: "frontend/src/main.tsx", contents: mainTsx },
    { path: "frontend/src/App.tsx", contents: appTsx },
  ];
}

// ---------------------------------------------------------------------------
// infra node types: postgres/redis/mongo/minio/elasticsearch/queue/nginx/
// prometheus — each still gets its own container, config nested under backend/
// ---------------------------------------------------------------------------

interface InfraTemplate {
  compose(ctx: ScaffoldNodeContext, manifest: ScaffoldManifest): ComposeService | null;
  files(ctx: ScaffoldNodeContext, manifest: ScaffoldManifest): ScaffoldFile[];
  readmeNote(ctx: ScaffoldNodeContext): string;
}

function nginxFiles(ctx: ScaffoldNodeContext, manifest: ScaffoldManifest): ScaffoldFile[] {
  const targets = manifest.edges
    .filter((e) => e.source === ctx.node.id)
    .map((e) => manifest.byId.get(e.target))
    .filter((t): t is ScaffoldNodeContext => !!t && ROUTER_TYPES.has(t.node.type));

  const locations = targets.length
    ? targets
        .map(
          (t) => `    location /${t.slug}/ {
        proxy_pass http://backend:${BACKEND_PORT}/${t.slug}/;
    }
`
        )
        .join("\n")
    : `    location / {
        return 404;
    }
`;

  return [
    {
      path: `backend/nginx/${ctx.slug}.conf`,
      contents: `server {
    listen 80;

${locations}}
`,
    },
  ];
}

function nginxCompose(ctx: ScaffoldNodeContext, manifest: ScaffoldManifest): ComposeService {
  const hasRouterTarget = manifest.edges
    .filter((e) => e.source === ctx.node.id)
    .some((e) => ROUTER_TYPES.has(manifest.byId.get(e.target)?.node.type as NodeType));

  return {
    name: ctx.slug,
    image: "nginx:alpine",
    ports: ["8080:80"],
    volumes: [`./backend/nginx/${ctx.slug}.conf:/etc/nginx/conf.d/default.conf:ro`],
    dependsOn: hasRouterTarget ? ["backend"] : undefined,
  };
}

function renderPrometheusConfig(manifest: ScaffoldManifest): string {
  const targets = manifest.nodes.filter((n) => ROUTER_TYPES.has(n.node.type)).length
    ? [`"backend:${BACKEND_PORT}"`]
    : [];
  const targetsYaml = targets.length ? targets.map((t) => `          - ${t}`).join("\n") : "          []";
  return `global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "services"
    static_configs:
      - targets:
${targetsYaml}
`;
}

export const INFRA_TEMPLATES: Partial<Record<NodeType, InfraTemplate>> = {
  load_balancer: { compose: nginxCompose, files: nginxFiles, readmeNote: (ctx) => `- **${ctx.node.label}** (load balancer) — nginx, routing into the backend app; published on \`localhost:8080\`.` },
  api_gateway: { compose: nginxCompose, files: nginxFiles, readmeNote: (ctx) => `- **${ctx.node.label}** (API gateway) — nginx, routing into the backend app; published on \`localhost:8080\`.` },
  queue: {
    compose: (ctx) => ({ name: ctx.slug, image: "rabbitmq:3-management" }),
    files: () => [],
    readmeNote: (ctx) => `- **${ctx.node.label}** (queue) — RabbitMQ, reachable inside the compose network as \`${ctx.slug}:5672\`.`,
  },
  cache: {
    compose: (ctx) => ({ name: ctx.slug, image: "redis:7-alpine" }),
    files: () => [],
    readmeNote: (ctx) => `- **${ctx.node.label}** (cache) — Redis, reachable inside the compose network as \`${ctx.slug}:6379\`.`,
  },
  sql_db: {
    compose: (ctx) => ({
      name: ctx.slug,
      image: "postgres:16-alpine",
      environment: { POSTGRES_USER: "app", POSTGRES_PASSWORD: "app", POSTGRES_DB: "app" },
      volumes: [`./backend/db/${ctx.slug}/init.sql:/docker-entrypoint-initdb.d/init.sql:ro`],
    }),
    files: (ctx) => [{ path: `backend/db/${ctx.slug}/init.sql`, contents: `-- init script for ${ctx.node.label}\n` }],
    readmeNote: (ctx) => `- **${ctx.node.label}** (sql_db) — Postgres, reachable inside the compose network as \`${ctx.slug}:5432\`.`,
  },
  nosql_db: {
    compose: (ctx) => ({
      name: ctx.slug,
      image: "mongo:7",
      volumes: [`./backend/db/${ctx.slug}/init-mongo.js:/docker-entrypoint-initdb.d/init-mongo.js:ro`],
    }),
    files: (ctx) => [{ path: `backend/db/${ctx.slug}/init-mongo.js`, contents: `// Mongo init script for ${ctx.node.label}\n` }],
    readmeNote: (ctx) => `- **${ctx.node.label}** (nosql_db) — MongoDB, reachable inside the compose network as \`${ctx.slug}:27017\`.`,
  },
  object_store: {
    compose: (ctx) => ({
      name: ctx.slug,
      image: "minio/minio",
      command: `server /data --console-address ":9001"`,
      environment: { MINIO_ROOT_USER: "minioadmin", MINIO_ROOT_PASSWORD: "minioadmin" },
    }),
    files: (ctx) => [
      {
        path: `backend/db/${ctx.slug}/create-bucket.sh`,
        contents: `#!/bin/sh\nmc alias set local http://${ctx.slug}:9000 minioadmin minioadmin\nmc mb local/app-bucket || true\n`,
      },
    ],
    readmeNote: (ctx) => `- **${ctx.node.label}** (object_store) — MinIO (S3-compatible), reachable inside the compose network as \`${ctx.slug}:9000\`.`,
  },
  search_index: {
    compose: (ctx) => ({
      name: ctx.slug,
      image: "elasticsearch:8.15.0",
      environment: { "discovery.type": "single-node", "xpack.security.enabled": "false" },
    }),
    files: (ctx) => [
      {
        path: `backend/db/${ctx.slug}/mapping.json`,
        contents:
          JSON.stringify(
            { mappings: { properties: { id: { type: "keyword" }, createdAt: { type: "date" } } } },
            null,
            2
          ) + "\n",
      },
    ],
    readmeNote: (ctx) => `- **${ctx.node.label}** (search_index) — Elasticsearch, reachable inside the compose network as \`${ctx.slug}:9200\`.`,
  },
  observability: {
    compose: (ctx) => ({
      name: ctx.slug,
      image: "prom/prometheus",
      ports: ["9090:9090"],
      volumes: ["./backend/observability/prometheus.yml:/etc/prometheus/prometheus.yml:ro"],
    }),
    files: (_ctx, manifest) => [{ path: "backend/observability/prometheus.yml", contents: renderPrometheusConfig(manifest) }],
    readmeNote: (ctx) => `- **${ctx.node.label}** (observability) — Prometheus, scraping the backend app; UI at \`localhost:9090\`.`,
  },
  cdn: {
    compose: () => null,
    files: () => [],
    readmeNote: (ctx) => `- **${ctx.node.label}** (cdn) — represents a CDN; not self-hostable locally, so no container is generated.`,
  },
  external_api: {
    compose: () => null,
    files: () => [],
    readmeNote: (ctx) => `- **${ctx.node.label}** (external_api) — a third-party dependency; no container is generated. Services calling it get \`_BASE_URL\`/\`_API_KEY\` placeholders in \`backend/.env.example\`.`,
  },
};

// ---------------------------------------------------------------------------
// compose / readme / gitignore assembly
// ---------------------------------------------------------------------------

function renderCompose(services: ComposeService[]): string {
  if (services.length === 0) return "services: {}\n";
  const lines: string[] = ["services:"];
  for (const s of services) {
    lines.push(`  ${s.name}:`);
    if (s.image) lines.push(`    image: ${s.image}`);
    if (s.build) lines.push(`    build: ${s.build}`);
    if (s.command) lines.push(`    command: ${s.command}`);
    if (s.ports?.length) {
      lines.push(`    ports:`);
      for (const p of s.ports) lines.push(`      - "${p}"`);
    }
    if (s.environment && Object.keys(s.environment).length) {
      lines.push(`    environment:`);
      for (const [k, v] of Object.entries(s.environment)) lines.push(`      ${k}: "${v}"`);
    }
    if (s.volumes?.length) {
      lines.push(`    volumes:`);
      for (const v of s.volumes) lines.push(`      - ${v}`);
    }
    if (s.dependsOn?.length) {
      lines.push(`    depends_on:`);
      for (const d of s.dependsOn) lines.push(`      - ${d}`);
    }
  }
  return lines.join("\n") + "\n";
}

function renderReadme(
  projectName: string | undefined,
  hasFrontend: boolean,
  hasBackend: boolean,
  notes: string[]
): string {
  const title = projectName?.trim() || "ArchForge Scaffold";
  const componentList = notes.length
    ? notes.join("\n")
    : "_The canvas was empty when this was generated — nothing to scaffold yet._";

  const structure = [
    hasFrontend ? "- `frontend/` — React + Vite + TypeScript app." : null,
    hasBackend ? "- `backend/` — one Node.js + Express + Prisma app; every service/auth node is a router mounted inside it, every worker node is its own entrypoint sharing the same codebase." : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `# ${title}

Generated by ArchForge's "Generate Scaffold" export. This mirrors the architecture diagram at
the time of export.

## Project layout

${structure || "_Nothing was generated beyond the orchestration files below._"}

## Components

${componentList}

## Quickstart

\`\`\`bash
docker compose up --build
\`\`\`
${
  hasBackend
    ? `
Copy \`backend/.env.example\` to \`backend/.env\` and adjust as needed if you want to run the
backend outside Docker.
`
    : ""
}${
  hasFrontend
    ? `
The frontend is not part of the compose stack — run it separately:

\`\`\`bash
cd frontend && npm install && npm run dev
\`\`\`
`
    : ""
}
## Going to production

This scaffold is a local development starting point, not a production deployment. Before
shipping it, you still need to:
- Replace every placeholder value in \`backend/.env.example\` with real secrets, managed outside
  version control.
- Put TLS in front of anything public-facing — nothing here terminates HTTPS.
- Move datastores (Postgres, Redis, MongoDB, etc.) to managed/hosted equivalents instead of the
  local containers in \`docker-compose.yml\`.
- Plan for horizontal scaling and health checks beyond the single-instance
  \`docker compose up\` setup here.
`;
}

function renderGitignore(): string {
  return `node_modules/
dist/
.env
*.log
.DS_Store
`;
}

/**
 * Walks the graph and assembles the full file list for the zip: one shared `backend/` app
 * (service/auth nodes as routers, worker nodes as their own entrypoints sharing that codebase),
 * one `frontend/` app (the first client node, if any), infra containers nested under `backend/`,
 * and the three root orchestration files. Never throws on a single bad node — that node's
 * contribution is skipped so one broken template can't cost the whole export.
 */
export function generateScaffoldFiles(
  nodes: SemanticNode[],
  edges: SemanticEdge[],
  projectName?: string
): ScaffoldFile[] {
  const manifest = buildManifest(nodes, edges);
  const files: ScaffoldFile[] = [];
  const composeServices: ComposeService[] = [];
  const notes: string[] = [];

  for (const ctx of manifest.nodes) {
    const template = INFRA_TEMPLATES[ctx.node.type];
    if (!template) continue;
    try {
      const svc = template.compose(ctx, manifest);
      if (svc) composeServices.push(svc);
      files.push(...template.files(ctx, manifest));
      notes.push(template.readmeNote(ctx));
    } catch {
      // See the note on the equivalent catch below — this package has no console/DOM lib.
    }
  }

  try {
    const backendApp = assembleBackendApp(manifest);
    files.push(...backendApp.files);
    composeServices.push(...backendApp.composeServices);
    notes.push(...backendApp.notes);
  } catch {
    // A broken backend assembly must not take down the whole export either.
  }

  const clientNodes = manifest.nodes.filter((n) => n.node.type === "client");
  if (clientNodes.length > 0) {
    const [primary, ...rest] = clientNodes;
    try {
      files.push(...clientFiles(primary, manifest));
      notes.push(`- **${primary.node.label}** (client) — a React + Vite + TypeScript app in \`frontend/\`; not part of the compose stack, run separately with \`npm install && npm run dev\`.`);
    } catch {
      // ditto
    }
    if (rest.length > 0) {
      notes.push(
        `- **Known limitation:** only the first client node in a diagram is scaffolded today. ${rest.map((c) => c.node.label).join(", ")} ${rest.length === 1 ? "was" : "were"} not.`
      );
    }
  }

  const hasFrontend = clientNodes.length > 0;
  const hasBackend = backendAppNodes(manifest).length > 0;

  files.push({ path: "docker-compose.yml", contents: renderCompose(composeServices) });
  files.push({ path: "README.md", contents: renderReadme(projectName, hasFrontend, hasBackend, notes) });
  files.push({ path: ".gitignore", contents: renderGitignore() });

  return files;
}
