import { Toaster as Sonner, type ToasterProps } from "sonner";

// Vite app (no next-themes) — the app is dark-only, so pin the theme and map colors
// to the shadcn tokens so toasts match the ArchForge surface.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
