import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Bot, Github, TriangleAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/** Callback failures come back as `?error=…`; each one gets a sentence a user can act on. */
const ERRORS: Record<string, string> = {
  oauth_state: "That sign-in link expired or was already used. Try again.",
  oauth_token: "GitHub did not issue a token. Try again.",
  oauth_profile: "Could not read your GitHub profile. Try again.",
  oauth_failed: "Something went wrong talking to GitHub. Try again.",
};

export function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const [params] = useSearchParams();

  const next = params.get("next") ?? "/";
  const error = params.get("error");

  // Only a path is honoured — an absolute URL here would make our own login an open redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  useEffect(() => {
    document.title = "Sign in · ArchForge";
  }, []);

  if (loading) return null;
  if (user) return <Navigate to={safeNext} replace />;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0e0e0e] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/8 bg-[#141414] p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6457f9]/20">
            <Bot className="h-5 w-5 text-[#a89dfc]" />
          </div>
          <span className="text-lg font-semibold text-white">ArchForge</span>
        </div>

        <h1 className="mt-6 text-xl font-semibold text-white">Sign in to continue</h1>
        <p className="mt-2 text-sm text-white/45">
          Architecture canvases are shared live. Signing in is how we know who is in the room
          and which boards you are allowed to open.
        </p>

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-[#1c1a14] px-3 py-2.5">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span className="text-xs text-white/75">
              {ERRORS[error] ?? "Sign-in failed. Try again."}
            </span>
          </div>
        )}

        <button
          onClick={() => signIn(safeNext)}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-white text-sm font-medium text-[#0e0e0e] transition-opacity hover:opacity-90"
        >
          <Github className="h-4.5 w-4.5" />
          Continue with GitHub
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-white/30">
          We read your public profile and your primary verified email. The email domain is
          what makes “anyone at your company” sharing possible — nothing is posted on your
          behalf.
        </p>
      </div>
    </div>
  );
}
