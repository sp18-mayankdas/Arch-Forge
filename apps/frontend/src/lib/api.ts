import { API_URL } from "./config";
import type { UsageResponse, SemanticNode, SemanticEdge } from "@archforge/shared";

// Project metadata as returned by the backend (the Yjs canvas/chat state is NOT here —
// that syncs over the WebSocket and is persisted server-side).
export interface Project {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function listProjects(): Promise<Project[]> {
  return fetch(`${API_URL}/api/projects`).then((r) => asJson<Project[]>(r));
}

export function getProject(id: string): Promise<Project> {
  return fetch(`${API_URL}/api/projects/${encodeURIComponent(id)}`).then((r) => asJson<Project>(r));
}

export function createProject(title: string): Promise<Project> {
  return fetch(`${API_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).then((r) => asJson<Project>(r));
}

export function updateProject(id: string, title: string): Promise<Project> {
  return fetch(`${API_URL}/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).then((r) => asJson<Project>(r));
}

export function deleteProject(id: string): Promise<void> {
  return fetch(`${API_URL}/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).then(
    (r) => {
      if (!r.ok) throw new Error(`Delete failed: ${r.status}`);
    }
  );
}

// Client-side path for a project's canvas (used with react-router `navigate`).
export function projectPath(id: string): string {
  return `/project/${encodeURIComponent(id)}`;
}

export function getUsage(): Promise<UsageResponse> {
  return fetch(`${API_URL}/api/usage`).then((r) => asJson<UsageResponse>(r));
}

export async function generateScaffold(
  graph: { nodes: SemanticNode[]; edges: SemanticEdge[] },
  projectName?: string
): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/scaffold`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...graph, projectName }),
  });
  if (!res.ok) throw new Error(`Scaffold generation failed: ${res.status} ${res.statusText}`);
  return res.blob();
}
