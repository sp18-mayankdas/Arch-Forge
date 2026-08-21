import { Routes, Route } from "react-router-dom";
import { PrivateLayout } from "@/components/PrivateLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { CanvasPage } from "@/pages/CanvasPage";
import { Toaster } from "@/components/ui/sonner";

// The whole app lives inside one shell (PrivateLayout: left nav + right content).
//   /            -> Dashboard (Home)
//   /projects    -> Projects list
//   /project/:id -> the collaborative canvas (id = the shared room)
export default function App() {
  return (
    <>
      <Routes>
        <Route element={<PrivateLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="project/:projectId" element={<CanvasPage />} />
        </Route>
      </Routes>
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
