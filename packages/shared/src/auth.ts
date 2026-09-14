/**
 * Auth and per-project access control, shared by both apps.
 *
 * The access level lives here rather than being inferred from a membership list because it is
 * a single closed choice the owner makes, and both ends have to agree on its spelling: the
 * Share dialog renders it, the server stores it as a Prisma enum of the same three names.
 */

/** Who may open a project's canvas. Mirrors the Prisma `ProjectAccess` enum exactly. */
export const PROJECT_ACCESS = ["INVITE_ONLY", "SAME_DOMAIN", "LINK"] as const;
export type ProjectAccess = (typeof PROJECT_ACCESS)[number];

/** Guard for untrusted input — a PATCH body naming a level that does not exist. */
export function isProjectAccess(v: unknown): v is ProjectAccess {
  return typeof v === "string" && (PROJECT_ACCESS as readonly string[]).includes(v);
}

/**
 * Why a user was let in. Returned by the server so the UI can explain access ("you're the
 * owner", "shared with your organisation") rather than only permitting or denying it.
 * `null` is not a role — it is the denial, and callers must treat it as such.
 */
export type ProjectRole = "owner" | "member" | "domain" | "link";

/**
 * The signed-in user as the client sees them. Deliberately NOT the DB row: `githubId` and the
 * raw `email` stay server-side. `emailDomain` is exposed because the Share dialog has to
 * explain *why* the same-domain option is unavailable, and it cannot do that without knowing
 * the domain is absent.
 */
export interface AuthUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  emailDomain: string | null;
}

/** One row of a project's invite list. `accepted` is false until that login first signs in. */
export interface ProjectMemberDto {
  githubLogin: string;
  accepted: boolean;
  name: string | null;
  avatarUrl: string | null;
}

/** `GET /api/projects/:id/access`. `members` is only meaningful for INVITE_ONLY. */
export interface ProjectAccessResponse {
  access: ProjectAccess;
  role: ProjectRole;
  /** The owner's verified email domain, or null — what SAME_DOMAIN would actually match. */
  ownerDomain: string | null;
  members: ProjectMemberDto[];
}
