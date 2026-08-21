import { useCallback, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Bot,
  LayoutDashboard,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { getUserInfo } from "@/lib/yjs";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "archforge:sidebar-collapsed";

const NAV = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban, end: false },
] as const;

export function PrivateLayout() {
  // Read the persisted collapse state synchronously so there's no open→collapsed flicker.
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY) === "1"
  );
  const user = useMemo(() => getUserInfo(), []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Left navigation */}
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out",
          collapsed ? "w-16" : "w-56"
        )}
      >
        {/* Brand row — collapse toggle lives here, aligned with the wordmark */}
        <div className="flex h-14 items-center gap-2.5 px-3">
          {collapsed ? (
            <button
              onClick={toggle}
              title="Expand sidebar"
              className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl text-white/55 transition-colors hover:bg-white/8 hover:text-white"
            >
              <PanelLeftOpen className="h-4.5 w-4.5" />
            </button>
          ) : (
            <>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#6457f9]/20">
                <Bot className="h-5 w-5 text-[#a89dfc]" />
              </div>
              <span className="truncate text-[15px] font-semibold tracking-tight">ArchForge</span>
              <button
                onClick={toggle}
                title="Collapse sidebar"
                className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/8 hover:text-white"
              >
                <PanelLeftClose className="h-4.5 w-4.5" />
              </button>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-[#6457f9]/15 text-[#a89dfc]"
                    : "text-white/55 hover:bg-white/8 hover:text-white"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* accent rail on the active item */}
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-r-full bg-[#6457f9] transition-opacity",
                      isActive ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <Icon className="h-4.5 w-4.5 shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer: current user */}
        <div className="border-t border-border p-2">
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2 py-1.5",
              collapsed && "justify-center px-0"
            )}
            title={collapsed ? user.name : undefined}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white select-none"
              style={{ background: user.color }}
            >
              {user.name[0].toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-white/80">{user.name}</p>
                <p className="text-[10px] text-white/35">You</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Right content */}
      <main className="relative min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
