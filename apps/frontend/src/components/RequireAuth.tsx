import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

/**
 * Gate for every route inside the app shell.
 *
 * This is convenience, not security: the server rejects unauthenticated REST calls and
 * WebSocket upgrades on its own, and it has to, because a route guard is client-side code
 * that anyone can skip. What this buys is not showing a signed-out user an empty canvas that
 * silently fails to sync.
 */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Render nothing until the first probe resolves. Redirecting while it is still in flight
  // would bounce every already-signed-in user through /login on a hard refresh.
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0e0e0e]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-[#6457f9]" />
      </div>
    );
  }

  if (!user) {
    // Carry where they were headed, so signing in lands there instead of on the dashboard.
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return <Outlet />;
}
