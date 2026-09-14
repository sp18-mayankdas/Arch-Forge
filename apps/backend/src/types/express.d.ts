import type { ProjectRole } from "@archforge/shared";
import type { SessionUser } from "../lib/session";

/**
 * Populated by `requireAuth` / `requireProjectAccess` (src/middleware/auth.ts) so handlers can
 * read the caller and their role without re-querying.
 *
 * A standalone `.d.ts` rather than a `declare module` block inside the middleware: the
 * augmentation has to be visible to every route file, and tying it to an import of the
 * middleware means a file that only reads `req.user` (usage.ts did) silently loses the type.
 *
 * Both are optional because the augmentation applies to EVERY request, including ones that
 * never passed the middleware. Handlers behind the guard use `req.user!`.
 */
declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
    projectRole?: ProjectRole;
  }
}
