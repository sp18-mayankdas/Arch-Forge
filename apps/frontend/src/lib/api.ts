import { API_URL } from "./config";
import type {
  AuthUser,
  ProjectAccess,
  ProjectAccessResponse,
  UsageResponse,
} from "@archforge/shared";

// Project metadata as returned by the backend (the Yjs canvas/chat state is NOT here —
// that syncs over the WebSocket and is persisted server-side).
export interface Project {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** Thrown for any non-2xx, carrying the status so callers can branch on 401/403/404. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

async function toError(res: Response): Promise<ApiError> {
  // The server's own message when there is one — "Only the project owner can do that" is far
  // more useful in a toast than "Request failed: 403".
  let message = `Request failed: ${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) message = body.error;
  } catch {
    // Not JSON — keep the status line.
  }
  return new ApiError(res.status, message);
}

/**
 * Every call goes through here, and the reason is `credentials: "include"`.
 *
 * The session is an httpOnly cookie (it has to be — the Yjs WebSocket cannot carry a header),
 * and `fetch` does NOT send cookies by default on cross-origin requests. One request that
 * forgets this reads as "signed out" for no visible reason, so there is exactly one place
 * that builds a request rather than seven hand-rolled `fetch` calls.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  return asJson<T>(res);
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  if (!res.ok) throw await toError(res);
}

export function listProjects(): Promise<Project[]> {
  return request<Project[]>("/api/projects");
}

export function getProject(id: string): Promise<Project> {
  return request<Project>(`/api/projects/${encodeURIComponent(id)}`);
}

export function createProject(title: string): Promise<Project> {
  return request<Project>("/api/projects", { method: "POST", body: JSON.stringify({ title }) });
}

export function updateProject(id: string, title: string): Promise<Project> {
  return request<Project>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteProject(id: string): Promise<void> {
  return requestVoid(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- auth ---------------------------------------------------------------------------------

/** The signed-in user, or null. A 401 is the normal "signed out" answer, not an error. */
export async function getMe(): Promise<AuthUser | null> {
  try {
    return await request<AuthUser>("/api/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function logout(): Promise<void> {
  return requestVoid("/api/auth/logout", { method: "POST" });
}

/**
 * Full-page navigation, not fetch: OAuth is a redirect flow, and the browser has to actually
 * visit GitHub. `next` brings the user back to the page they were trying to reach.
 */
export function startGithubLogin(next: string): void {
  window.location.href = `${API_URL}/api/auth/github?next=${encodeURIComponent(next)}`;
}

// --- sharing ------------------------------------------------------------------------------

export function getProjectAccess(id: string): Promise<ProjectAccessResponse> {
  return request<ProjectAccessResponse>(`/api/projects/${encodeURIComponent(id)}/access`);
}

export function setProjectAccess(id: string, access: ProjectAccess): Promise<ProjectAccessResponse> {
  return request<ProjectAccessResponse>(`/api/projects/${encodeURIComponent(id)}/access`, {
    method: "PATCH",
    body: JSON.stringify({ access }),
  });
}

export function addProjectMember(id: string, login: string): Promise<ProjectAccessResponse> {
  return request<ProjectAccessResponse>(`/api/projects/${encodeURIComponent(id)}/members`, {
    method: "POST",
    body: JSON.stringify({ login }),
  });
}

export function removeProjectMember(id: string, login: string): Promise<ProjectAccessResponse> {
  return request<ProjectAccessResponse>(
    `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(login)}`,
    { method: "DELETE" }
  );
}

// Client-side path for a project's canvas (used with react-router `navigate`).
export function projectPath(id: string): string {
  return `/project/${encodeURIComponent(id)}`;
}

export function getUsage(): Promise<UsageResponse> {
  return request<UsageResponse>("/api/usage");
}
