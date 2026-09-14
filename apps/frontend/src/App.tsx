import { Routes, Route } from "react-router-dom";
import { PrivateLayout } from "@/components/PrivateLayout";
import { RequireAuth } from "@/components/RequireAuth";
import { AuthProvider } from "@/hooks/useAuth";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { CanvasPage } from "@/pages/CanvasPage";
import { UsagePage } from "@/pages/UsagePage";
import { Toaster } from "@/components/ui/sonner";

// /login sits OUTSIDE the shell and outside RequireAuth — a signed-out user has to be able to
// reach it, and it has no nav to show. Everything else lives inside one shell
// (PrivateLayout: left nav + right content) behind a session:
//   /            -> Dashboard (Home)
//   /projects    -> Projects list
//   /project/:id -> the collaborative canvas (id = the shared room)
//   /usage       -> AI token usage, overall and per project
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<PrivateLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="project/:projectId" element={<CanvasPage />} />
            <Route path="usage" element={<UsagePage />} />
          </Route>
        </Route>
      </Routes>
      <Toaster position="bottom-right" richColors closeButton />
    </AuthProvider>
  );
}
