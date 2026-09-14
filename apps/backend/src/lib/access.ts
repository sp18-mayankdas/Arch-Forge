import type { ProjectRole } from "@archforge/shared";
import { prisma } from "../db";
import type { SessionUser } from "./session";

/**
 * The ONE answer to "may this user open this project, and why".
 *
 * Called by both the Express middleware (`requireProjectAccess`) and the Yjs WebSocket
 * upgrade handler. That is the whole point of it being a function rather than a `where`
 * clause written twice: the canvas data flows over the socket, so if the two checks ever
 * disagreed, the REST rules would be decoration. Same single-writer discipline the frontend
 * uses for the Yjs maps — one writer, so the two can never drift.
 *
 * Returns `null` for "no", including for a project that does not exist. Callers decide
 * whether that is a 403 or a 404; this function does not leak the difference by itself.
 */
export async function resolveProjectAccess(
  user: SessionUser,
  projectId: string
): Promise<ProjectRole | null> {
  if (!projectId) return null;

  // One round-trip. The membership lookup rides along as a filtered relation rather than a
  // second query, so the common "am I a member" path costs nothing extra.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      access: true,
      owner: { select: { emailDomain: true } },
      members: { where: { githubLogin: user.login }, select: { id: true } },
    },
  });

  if (!project) return null;

  if (project.ownerId === user.id) return "owner";

  // Checked BEFORE the access level, deliberately. An explicit invite has to survive the
  // owner later switching the project to SAME_DOMAIN: losing access you were personally
  // granted, because someone changed an unrelated setting, is a bug from the user's side.
  if (project.members.length > 0) return "member";

  if (project.access === "LINK") return "link";

  if (project.access === "SAME_DOMAIN") {
    const ownerDomain = project.owner.emailDomain;
    // Fails CLOSED on a null domain, on either side. A user whose GitHub email is private or
    // unverified has no domain, and `null === null` must never read as "same domain" — that
    // would turn the level into "anyone without a verified email".
    if (ownerDomain && user.emailDomain && ownerDomain === user.emailDomain) return "domain";
  }

  return null;
}

/**
 * The `where` fragment for "projects this user can see" — the list view's version of the
 * check above. Kept beside it so the two stay in step, but it is deliberately NOT the same
 * code: a list query cannot afford a per-row function call, and a row-by-row
 * `resolveProjectAccess` over every project in the database is the obvious wrong shape.
 *
 * LINK projects are excluded on purpose. "Anyone with the link" means exactly that — having
 * the URL — so listing every link-shared project in the database to every signed-in user
 * would quietly make LINK mean "public", which is not what the owner chose.
 */
export function visibleProjectsWhere(user: SessionUser) {
  return {
    OR: [
      { ownerId: user.id },
      { members: { some: { githubLogin: user.login } } },
      ...(user.emailDomain
        ? [
            {
              access: "SAME_DOMAIN" as const,
              owner: { emailDomain: user.emailDomain },
            },
          ]
        : []),
    ],
  };
}
