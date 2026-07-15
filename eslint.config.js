import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

// Baseline flat config for the monorepo. Covers packages/shared and acts as a
// fallback for any package without its own config. The apps (apps/frontend,
// apps/backend) keep their own eslint.config.js for react/node-specific rules.
export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2020, sourceType: "module" },
      globals: { ...globals.node, ...globals.es2020 },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "off",
    },
  },
];
