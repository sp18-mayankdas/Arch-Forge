import type { Request, Response, NextFunction, RequestHandler } from "express";
import { resolveProjectAccess } from "../lib/access";
import { param } from "../lib/http";
import { userById, userIdFromToken, SESSION_COOKIE } from "../lib/session";

// `req.user` / `req.projectRole` are declared in src/types/express.d.ts — globally, so every
// route file sees them whether or not it imports this module.

/**
 * Every `/api` route except `/api/auth/*` sits behind this. There is deliberately no
 * anonymous path: an access level you can sidestep by not signing in is not an access level.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
  void (async () => {
    const user = await userById(userIdFromToken(req.cookies?.[SESSION_COOKIE]));
    if (!user) {
      res.status(401).json({ error: "Not signed in" });
      return;
    }
    req.user = user;
    next();
  })().catch(next);
};

/**
 * Guards a single project, reading `:id` (or `:projectId`) from the route.
 *
 * Returns **404 for both "no such project" and "not allowed"**. That is intentional: a
 * distinct 403 would confirm that a given project id exists to someone who cannot open it,
 * turning the id space into an oracle. The owner sees a real 404 for a real typo either way.
 */
export function requireProjectAccess(minRole?: "owner"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: "Not signed in" });
        return;
      }
      const projectId = param(req.params.id) || param(req.params.projectId);
      const role = await resolveProjectAccess(user, projectId);
      if (!role) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      // Changing who can see a project, or who is invited, is the owner's alone — a member
      // who could re-share it would make the owner's choice meaningless.
      if (minRole === "owner" && role !== "owner") {
        res.status(403).json({ error: "Only the project owner can do that" });
        return;
      }
      req.projectRole = role;
      next();
    })().catch(next);
  };
}
