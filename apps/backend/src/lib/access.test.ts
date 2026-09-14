import { describe, it, expect, vi, beforeEach } from "vitest";

// The access matrix is the whole feature, so it is tested against a stubbed Prisma rather
// than a live database: these assertions must run in `pnpm test` with no Postgres, the same
// way every other suite in this repo does.
const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("../db", () => ({ prisma: { project: { findUnique } } }));

// A static import, not `await import`: vi.mock is hoisted above imports by Vitest's transform,
// so the mock is already in place, and top-level await is not valid under this package's
// CommonJS target.
import { resolveProjectAccess, visibleProjectsWhere } from "./access";

const OWNER = { id: "u-owner", login: "owner", emailDomain: "acme.com" };
const COLLEAGUE = { id: "u-colleague", login: "colleague", emailDomain: "acme.com" };
const OUTSIDER = { id: "u-outsider", login: "outsider", emailDomain: "other.com" };
const NO_DOMAIN = { id: "u-nodomain", login: "nodomain", emailDomain: null };

/**
 * Shape one `findUnique` result. `memberLogins` are the invites that exist on the project.
 *
 * `args` is optional because Vitest's `mockReset()` invokes the implementation once with no
 * arguments and discards the result. Only the real call from `resolveProjectAccess` passes
 * args, so the fallback below never decides a test — it just keeps the reset from throwing.
 */
type FindArgs = { select: { members: { where: { githubLogin: string } } } };
function project(access: string, memberLogins: string[] = [], ownerDomain: string | null = "acme.com") {
  return (args?: FindArgs) => ({
    ownerId: OWNER.id,
    access,
    owner: { emailDomain: ownerDomain },
    // Mirrors the filtered relation in the real query: Prisma returns only the rows matching
    // the `where`, so membership is "did this user's login come back", not "does any exist".
    members:
      args && memberLogins.includes(args.select.members.where.githubLogin) ? [{ id: "m1" }] : [],
  });
}

beforeEach(() => findUnique.mockReset());

describe("resolveProjectAccess", () => {
  it("always lets the owner in, at every access level", async () => {
    for (const level of ["INVITE_ONLY", "SAME_DOMAIN", "LINK"]) {
      findUnique.mockImplementation(project(level));
      expect(await resolveProjectAccess(OWNER, "p1")).toBe("owner");
    }
  });

  it("lets an invited member in under ALL THREE levels", async () => {
    // The member check runs before the level switch on purpose: an explicit invite must
    // survive the owner later tightening the project to SAME_DOMAIN.
    for (const level of ["INVITE_ONLY", "SAME_DOMAIN", "LINK"]) {
      findUnique.mockImplementation(project(level, ["outsider"]));
      expect(await resolveProjectAccess(OUTSIDER, "p1")).toBe("member");
    }
  });

  it("keeps a stranger out of an invite-only project", async () => {
    findUnique.mockImplementation(project("INVITE_ONLY"));
    expect(await resolveProjectAccess(OUTSIDER, "p1")).toBeNull();
    expect(await resolveProjectAccess(COLLEAGUE, "p1")).toBeNull();
  });

  it("admits a matching domain only under SAME_DOMAIN", async () => {
    findUnique.mockImplementation(project("SAME_DOMAIN"));
    expect(await resolveProjectAccess(COLLEAGUE, "p1")).toBe("domain");

    findUnique.mockImplementation(project("INVITE_ONLY"));
    expect(await resolveProjectAccess(COLLEAGUE, "p1")).toBeNull();
  });

  it("rejects a different domain under SAME_DOMAIN", async () => {
    findUnique.mockImplementation(project("SAME_DOMAIN"));
    expect(await resolveProjectAccess(OUTSIDER, "p1")).toBeNull();
  });

  it("FAILS CLOSED when either domain is null", async () => {
    // The dangerous case: `null === null` must never read as "same domain", or the level
    // silently becomes "anyone without a verified email".
    findUnique.mockImplementation(project("SAME_DOMAIN", [], null));
    expect(await resolveProjectAccess(NO_DOMAIN, "p1")).toBeNull();

    findUnique.mockImplementation(project("SAME_DOMAIN"));
    expect(await resolveProjectAccess(NO_DOMAIN, "p1")).toBeNull();

    findUnique.mockImplementation(project("SAME_DOMAIN", [], null));
    expect(await resolveProjectAccess(COLLEAGUE, "p1")).toBeNull();
  });

  it("admits any signed-in user under LINK", async () => {
    findUnique.mockImplementation(project("LINK"));
    expect(await resolveProjectAccess(OUTSIDER, "p1")).toBe("link");
    expect(await resolveProjectAccess(NO_DOMAIN, "p1")).toBe("link");
  });

  it("returns null for an unknown project, never a role", async () => {
    findUnique.mockResolvedValue(null);
    expect(await resolveProjectAccess(OWNER, "nope")).toBeNull();
  });

  it("returns null for an empty project id without querying", async () => {
    expect(await resolveProjectAccess(OWNER, "")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("visibleProjectsWhere", () => {
  it("covers owned and invited projects", () => {
    const where = visibleProjectsWhere(OUTSIDER);
    expect(where.OR).toContainEqual({ ownerId: OUTSIDER.id });
    expect(where.OR).toContainEqual({ members: { some: { githubLogin: "outsider" } } });
  });

  it("never lists LINK projects", () => {
    // "Anyone with the link" means having the URL. Listing every LINK project to every
    // signed-in user would quietly promote that level to "public".
    const serialized = JSON.stringify(visibleProjectsWhere(COLLEAGUE));
    expect(serialized).not.toContain("LINK");
  });

  it("omits the domain clause entirely for a user with no domain", () => {
    expect(JSON.stringify(visibleProjectsWhere(NO_DOMAIN))).not.toContain("SAME_DOMAIN");
    expect(JSON.stringify(visibleProjectsWhere(COLLEAGUE))).toContain("SAME_DOMAIN");
  });
});
