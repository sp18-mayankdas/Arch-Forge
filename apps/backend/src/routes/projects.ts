import { Router } from "express";
import { isProjectAccess, type ProjectAccessResponse, type ProjectMemberDto } from "@archforge/shared";
import { prisma } from "../db";
import { visibleProjectsWhere } from "../lib/access";
import { param } from "../lib/http";
import { evictRoom } from "../lib/rooms";
import { requireAuth, requireProjectAccess } from "../middleware/auth";

const router = Router();

// Metadata only — never ship the (potentially large) Yjs `state` blob to the list/detail views.
const META = { id: true, title: true, createdAt: true, updatedAt: true } as const;

// Everything below requires a session. There is no anonymous read of anything.
router.use(requireAuth);

// GET /api/projects — the caller's projects, most-recently-updated first.
router.get("/projects", async (req, res) => {
  const projects = await prisma.project.findMany({
    where: visibleProjectsWhere(req.user!),
    select: META,
    orderBy: { updatedAt: "desc" },
  });
  res.json(projects);
});

// POST /api/projects — create. The returned id becomes the Yjs room id.
router.post("/projects", async (req, res) => {
  const { title } = req.body as { title?: string };
  const project = await prisma.project.create({
    // Defaults to INVITE_ONLY (schema default): a new canvas is private until its owner
    // decides otherwise. The safe default is the one you have to opt OUT of.
    data: { title: title?.trim() || "Untitled project", ownerId: req.user!.id },
    select: META,
  });
  res.status(201).json(project);
});

// GET /api/projects/:id — metadata (for the canvas navbar title).
router.get("/projects/:id", requireProjectAccess(), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: param(req.params.id) }, select: META });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

// PATCH /api/projects/:id — rename. Any collaborator may rename; only sharing is owner-only.
router.patch("/projects/:id", requireProjectAccess(), async (req, res) => {
  const { title } = req.body as { title?: string };
  if (!title?.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  try {
    const project = await prisma.project.update({
      where: { id: param(req.params.id) },
      data: { title: title.trim() },
      select: META,
    });
    res.json(project);
  } catch {
    res.status(404).json({ error: "Project not found" });
  }
});

// DELETE /api/projects/:id — owner only; remove the row and drop any live in-memory room.
router.delete("/projects/:id", requireProjectAccess("owner"), async (req, res) => {
  try {
    await prisma.project.delete({ where: { id: param(req.params.id) } });
  } catch {
    // already gone — treat delete as idempotent
  }
  evictRoom(param(req.params.id));
  res.status(204).end();
});

/** Shape a project's invite list for the Share dialog. */
async function readAccess(projectId: string): Promise<ProjectAccessResponse | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      access: true,
      owner: { select: { emailDomain: true } },
      members: {
        orderBy: { createdAt: "asc" },
        select: {
          githubLogin: true,
          user: { select: { name: true, avatarUrl: true } },
        },
      },
    },
  });
  if (!project) return null;
  const members: ProjectMemberDto[] = project.members.map((m) => ({
    githubLogin: m.githubLogin,
    // "Accepted" == that login has signed in at least once and been linked to a User row.
    accepted: m.user !== null,
    name: m.user?.name ?? null,
    avatarUrl: m.user?.avatarUrl ?? null,
  }));
  return { access: project.access, role: "owner", ownerDomain: project.owner.emailDomain, members };
}

// GET /api/projects/:id/access — current level + invite list. Visible to any collaborator so
// the UI can show how they got in; only the owner can change it.
router.get("/projects/:id/access", requireProjectAccess(), async (req, res) => {
  const data = await readAccess(param(req.params.id));
  if (!data) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({ ...data, role: req.projectRole! });
});

// PATCH /api/projects/:id/access — owner only.
router.patch("/projects/:id/access", requireProjectAccess("owner"), async (req, res) => {
  const { access } = req.body as { access?: unknown };
  if (!isProjectAccess(access)) {
    res.status(400).json({ error: "access must be INVITE_ONLY, SAME_DOMAIN or LINK" });
    return;
  }
  // Setting SAME_DOMAIN with no verified owner domain would lock everyone out, silently —
  // resolveProjectAccess fails closed on a null domain. Refuse it with a reason instead.
  if (access === "SAME_DOMAIN" && !req.user!.emailDomain) {
    res.status(400).json({
      error:
        "Your GitHub account has no primary verified email, so there is no domain to share " +
        "with. Verify an email on GitHub, sign in again, then retry.",
    });
    return;
  }
  await prisma.project.update({ where: { id: param(req.params.id) }, data: { access } });
  // Anyone whose access just narrowed is still holding an open socket onto the canvas.
  evictRoom(param(req.params.id));
  const data = await readAccess(param(req.params.id));
  res.json({ ...data!, role: "owner" });
});

// POST /api/projects/:id/members — invite by GitHub username. Owner only.
router.post("/projects/:id/members", requireProjectAccess("owner"), async (req, res) => {
  const { login } = req.body as { login?: unknown };
  const handle = typeof login === "string" ? login.trim().replace(/^@/, "").toLowerCase() : "";
  // GitHub's own rule: alphanumerics and single hyphens, 39 chars max.
  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/.test(handle)) {
    res.status(400).json({ error: "That is not a valid GitHub username" });
    return;
  }
  // The invited person may not have an account yet — that is the whole reason members are
  // keyed by login. If they do, link them now so access works on their current session.
  const existing = await prisma.user.findUnique({ where: { login: handle }, select: { id: true } });
  await prisma.projectMember.upsert({
    where: { projectId_githubLogin: { projectId: param(req.params.id), githubLogin: handle } },
    update: { userId: existing?.id ?? null },
    create: { projectId: param(req.params.id), githubLogin: handle, userId: existing?.id ?? null },
  });
  const data = await readAccess(param(req.params.id));
  res.status(201).json({ ...data!, role: "owner" });
});

// DELETE /api/projects/:id/members/:login — revoke an invite. Owner only.
router.delete("/projects/:id/members/:login", requireProjectAccess("owner"), async (req, res) => {
  const handle = param(req.params.login).trim().replace(/^@/, "").toLowerCase();
  await prisma.projectMember.deleteMany({
    where: { projectId: param(req.params.id), githubLogin: handle },
  });
  // Same reason as the access change: revoking someone who is connected right now has to
  // actually disconnect them, or the removal only takes effect the next time they reload.
  evictRoom(param(req.params.id));
  const data = await readAccess(param(req.params.id));
  res.json({ ...data!, role: "owner" });
});

export default router;
