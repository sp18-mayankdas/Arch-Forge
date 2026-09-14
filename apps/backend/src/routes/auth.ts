import { Router } from "express";
import crypto from "crypto";
import type { AuthUser } from "@archforge/shared";
import { prisma } from "../db";
import {
  setSessionCookie,
  clearSessionCookie,
  setStateCookie,
  clearStateCookie,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  userById,
  userIdFromToken,
} from "../lib/session";

const router = Router();

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";

// `user:email` is required, not optional: SAME_DOMAIN compares verified email domains, and
// without this scope every user arrives with a null domain and that level can never match.
const SCOPES = "read:user user:email";

function appOrigin(): string {
  return process.env.APP_ORIGIN ?? "http://localhost:3000";
}

function oauthConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const callbackUrl = process.env.GITHUB_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) return null;
  return { clientId, clientSecret, callbackUrl };
}

/** GET /api/auth/github — start the flow. */
router.get("/auth/github", (req, res) => {
  const cfg = oauthConfig();
  if (!cfg) {
    res.status(500).json({
      error:
        "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and " +
        "GITHUB_CALLBACK_URL in apps/backend/.env.",
    });
    return;
  }

  // CSRF: a random value echoed back by GitHub and compared against a cookie only this
  // browser has. Without it, an attacker can complete a login in the victim's browser using
  // their OWN code, silently signing the victim into the attacker's account.
  const state = crypto.randomBytes(16).toString("hex");
  setStateCookie(res, state);

  // Where to land afterwards. Only a path is kept — an absolute URL here would be an open
  // redirect straight out of our own login flow.
  const raw = typeof req.query.next === "string" ? req.query.next : "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  const url = new URL(GITHUB_AUTHORIZE);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.callbackUrl);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", `${state}:${Buffer.from(next).toString("base64url")}`);
  res.redirect(url.toString());
});

/** GET /api/auth/github/callback — exchange the code, upsert the user, set the cookie. */
router.get("/auth/github/callback", async (req, res) => {
  const cfg = oauthConfig();
  if (!cfg) {
    res.status(500).send("GitHub OAuth is not configured.");
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const returned = typeof req.query.state === "string" ? req.query.state : "";
  const expected = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
  clearStateCookie(res);

  const [statePart, nextPart] = returned.split(":");
  // Compared in constant time, and an absent cookie is a failure rather than a pass — the
  // usual shape of this bug is `if (expected && expected !== state)`, which lets a request
  // with no cookie through entirely.
  const stateOk =
    !!expected &&
    !!statePart &&
    expected.length === statePart.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(statePart));

  if (!code || !stateOk) {
    res.redirect(`${appOrigin()}/login?error=oauth_state`);
    return;
  }

  try {
    const tokenRes = await fetch(GITHUB_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: cfg.callbackUrl,
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      res.redirect(`${appOrigin()}/login?error=oauth_token`);
      return;
    }

    const gh = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ArchForge",
    };

    const profileRes = await fetch(`${GITHUB_API}/user`, { headers: gh });
    const profile = (await profileRes.json()) as {
      id?: number;
      login?: string;
      name?: string | null;
      avatar_url?: string | null;
    };
    if (!profile.id || !profile.login) {
      res.redirect(`${appOrigin()}/login?error=oauth_profile`);
      return;
    }

    // The profile's own `email` is whatever the user made public — often null, and never a
    // guarantee of verification. The domain gates access, so only a primary VERIFIED address
    // counts; anything else leaves the domain null and SAME_DOMAIN simply never matches.
    let email: string | null = null;
    try {
      const emailsRes = await fetch(`${GITHUB_API}/user/emails`, { headers: gh });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as {
          email?: string;
          primary?: boolean;
          verified?: boolean;
        }[];
        email = emails.find((e) => e.primary && e.verified)?.email ?? null;
      }
    } catch {
      // A failure here must not fail the login — it costs the user SAME_DOMAIN, nothing more.
    }

    const domain = email?.split("@")[1]?.toLowerCase() ?? null;
    const login = profile.login.toLowerCase();

    const user = await prisma.user.upsert({
      where: { githubId: String(profile.id) },
      // `login` is updated on every sign-in: GitHub logins can be renamed, and invites match
      // on it, so a stale value would silently stop resolving this user's memberships.
      update: {
        login,
        name: profile.name ?? null,
        avatarUrl: profile.avatar_url ?? null,
        email,
        emailDomain: domain,
      },
      create: {
        githubId: String(profile.id),
        login,
        name: profile.name ?? null,
        avatarUrl: profile.avatar_url ?? null,
        email,
        emailDomain: domain,
      },
      select: { id: true },
    });

    // Claim any invitations addressed to this login before the person had an account. This is
    // what makes "invite someone who has never signed in" work with no separate invite table.
    await prisma.projectMember.updateMany({
      where: { githubLogin: login, userId: null },
      data: { userId: user.id },
    });

    setSessionCookie(res, user.id);

    const next = nextPart ? Buffer.from(nextPart, "base64url").toString("utf8") : "/";
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    res.redirect(`${appOrigin()}${safeNext}`);
  } catch (err) {
    console.error("GitHub OAuth callback failed:", err);
    res.redirect(`${appOrigin()}/login?error=oauth_failed`);
  }
});

/** GET /api/auth/me — the signed-in user, or 401. The client's session probe. */
router.get("/auth/me", async (req, res) => {
  const session = await userById(userIdFromToken(req.cookies?.[SESSION_COOKIE]));
  if (!session) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  const full = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, login: true, name: true, avatarUrl: true, emailDomain: true },
  });
  if (!full) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  res.json(full satisfies AuthUser);
});

/** POST /api/auth/logout */
router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

export default router;
