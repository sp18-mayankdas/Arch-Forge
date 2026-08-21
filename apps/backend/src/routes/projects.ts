import { Router } from "express";
import { prisma } from "../db";

// Live in-memory rooms, so we can evict a project's doc when it's deleted.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { docs } = require("y-websocket/bin/utils") as {
  docs: Map<string, { conns: Map<{ close?: () => void }, unknown> }>;
};

const router = Router();

// Metadata only — never ship the (potentially large) Yjs `state` blob to the list/detail views.
const META = { id: true, title: true, createdAt: true, updatedAt: true } as const;

// GET /api/projects — list, most-recently-updated first.
router.get("/projects", async (_req, res) => {
  const projects = await prisma.project.findMany({ select: META, orderBy: { updatedAt: "desc" } });
  res.json(projects);
});

// POST /api/projects — create. The returned id becomes the Yjs room id.
router.post("/projects", async (req, res) => {
  const { title } = req.body as { title?: string };
  const project = await prisma.project.create({
    data: { title: title?.trim() || "Untitled project" },
    select: META,
  });
  res.status(201).json(project);
});

// GET /api/projects/:id — metadata (for the canvas navbar title).
router.get("/projects/:id", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: META });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

// PATCH /api/projects/:id — rename.
router.patch("/projects/:id", async (req, res) => {
  const { title } = req.body as { title?: string };
  if (!title?.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  try {
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: { title: title.trim() },
      select: META,
    });
    res.json(project);
  } catch {
    res.status(404).json({ error: "Project not found" });
  }
});

// DELETE /api/projects/:id — remove the row and drop any live in-memory room for it.
router.delete("/projects/:id", async (req, res) => {
  try {
    await prisma.project.delete({ where: { id: req.params.id } });
  } catch {
    // already gone — treat delete as idempotent
  }
  const doc = docs.get(req.params.id);
  if (doc) {
    for (const conn of doc.conns.keys()) conn.close?.();
  }
  res.status(204).end();
});

export default router;
