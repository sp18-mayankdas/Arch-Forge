import { defineConfig } from "vitest/config";
import path from "path";

// Aliases mirror vite.config.ts so tests resolve imports exactly as the app does.
// @archforge/shared is consumed as RAW TypeScript — never add a build step for it.
export default defineConfig({
  resolve: {
    alias: {
      "@archforge/shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // A package with zero tests should not fail the monorepo suite. Failing tests
    // still fail — this only covers the "no files yet" case.
    passWithNoTests: true,
  },
});
