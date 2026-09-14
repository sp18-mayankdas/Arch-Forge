import jwt from "jsonwebtoken";
import type { Response } from "express";
import { prisma } from "../db";

/**
 * Sessions are a signed JWT in an httpOnly cookie, and that choice is forced by the Yjs
 * WebSocket rather than by the REST API.
 *
 * A browser cannot set an `Authorization` header when constructing a `WebSocket`, and
 * y-websocket discards the query string when deriving the room name (so `?token=` would both
 * be awkward and leak the credential into every access log). A cookie is the one credential
 * the browser attaches to the upgrade request by itself, where it is readable as
 * `req.headers.cookie` inside `server.on("upgrade")`.
 *
 * A JWT rather than a session table because the token only carries IDENTITY. Every
 * authorization decision is a fresh DB read in `resolveProjectAccess`, so revoking someone's
 * access takes effect on their next request regardless of how long their token lives — the
 * usual "stale JWT" objection does not apply to anything that matters here.
 */

export const SESSION_COOKIE = "af_session";
export const OAUTH_STATE_COOKIE = "af_oauth_state";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const STATE_MAX_AGE_SECONDS = 60 * 10; // 10 minutes

/** The identity baked into the token. Kept minimal — everything else is read from the DB. */
interface SessionClaims {
  uid: string;
}

/**
 * Read once, at first use rather than at import time, and THROW when missing.
 *
 * The AI client is lazy for the opposite reason (a missing key should surface as a 500 on one
 * route, not a boot crash). Here a missing secret is not a degraded feature: `jwt.sign` with a
 * fallback would mint tokens anyone can forge, so refusing to start is the safe failure.
 */
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short (need >= 16 chars). Set it in apps/backend/.env."
    );
  }
  return s;
}

/** Cookies must be `secure` in production but cannot be over plain http in local dev. */
function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // "lax" (not "strict") so returning from GitHub's redirect still carries the cookie, and
    // (not "none") because the app is same-origin through the Vite proxy in dev.
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  };
}

export function setSessionCookie(res: Response, userId: string): void {
  const token = jwt.sign({ uid: userId } satisfies SessionClaims, secret(), {
    expiresIn: SESSION_MAX_AGE_SECONDS,
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE_SECONDS));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

export function setStateCookie(res: Response, state: string): void {
  res.cookie(OAUTH_STATE_COOKIE, state, cookieOptions(STATE_MAX_AGE_SECONDS));
}

export function clearStateCookie(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

/** Verify a raw token and return the user id, or null. Never throws on bad input. */
export function userIdFromToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, secret()) as Partial<SessionClaims>;
    return typeof claims.uid === "string" && claims.uid ? claims.uid : null;
  } catch {
    // Expired, tampered, or signed with an old secret — all equally "not signed in".
    return null;
  }
}

/**
 * The session user, loaded fresh from the DB.
 *
 * `login` and `emailDomain` are read here rather than carried in the token on purpose: both
 * feed authorization (`SAME_DOMAIN` compares domains, invites match on login), and a value
 * baked into a week-old token would keep granting access after a GitHub rename or an email
 * change. Identity is cached in the cookie; anything an access decision reads is not.
 */
export type SessionUser = {
  id: string;
  login: string;
  emailDomain: string | null;
};

export async function userById(userId: string | null): Promise<SessionUser | null> {
  if (!userId) return null;
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, login: true, emailDomain: true },
  });
}

/**
 * Resolve a session straight from a raw `Cookie` header.
 *
 * This exists for the WebSocket upgrade, which is a bare `http.IncomingMessage` with no
 * Express middleware in front of it — so `cookie-parser` has not run and `req.cookies` does
 * not exist. Parsing the header here is what lets the socket and the REST API share one
 * session mechanism instead of growing a second, WS-only one.
 */
export async function userFromCookieHeader(header: string | undefined): Promise<SessionUser | null> {
  return userById(userIdFromToken(readCookie(header, SESSION_COOKIE)));
}

/**
 * Pull one cookie out of a raw `Cookie` header.
 *
 * Hand-rolled rather than pulling in the `cookie` package: that package ships ESM-only export
 * maps which this CommonJS backend (`moduleResolution: "node"`) cannot resolve. A session
 * token is an opaque base64url JWT, so the only parsing that matters is splitting on `;` and
 * the FIRST `=` — splitting on every `=` would truncate the token's padding.
 */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
