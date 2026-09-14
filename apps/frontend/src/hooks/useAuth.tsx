import { createContext, useContext, useCallback, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthUser } from "@archforge/shared";
import { getMe, logout as apiLogout, startGithubLogin } from "@/lib/api";

interface AuthState {
  user: AuthUser | null;
  /** True only while the FIRST session probe is in flight — see RequireAuth. */
  loading: boolean;
  signIn: (next?: string) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    // A signed-out user is a null result, not a failure, so retrying buys nothing and only
    // delays rendering the login page.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const signIn = useCallback((next?: string) => {
    startGithubLogin(next ?? window.location.pathname + window.location.search);
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    // Drop every cached query, not just ["me"]: project lists and usage are scoped to the
    // user, so leaving them cached would show the previous person's data to the next one.
    qc.clear();
    window.location.href = "/login";
  }, [qc]);

  return (
    <AuthContext.Provider value={{ user: data ?? null, loading: isPending, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
