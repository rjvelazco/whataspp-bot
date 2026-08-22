// Bot package (src/, tests/). The Angular admin has its own config in web/.
//
// This is deliberately a focused rule set, not `recommended`: it encodes the
// conventions in CLAUDE.md and catches real mistakes. Broadening it to the full
// typescript-eslint recommended set is worth doing, but as its own change with its
// own cleanup — not smuggled in behind a docs PR.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["web/**", "node_modules/**", "dist/**", "uploads/**", "auth/**", "plan/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      // `any` is a real escape hatch in the Baileys and Express boundaries; warn, don't block.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "smart"],
      "no-console": "error", // use the pino logger in src/logger.ts
    },
  },
  {
    // This file exists in order to patch console.error/console.log, so that it can
    // swallow libsignal's expected decrypt noise. It is the one legitimate caller.
    files: ["src/transport/silence-signal.ts"],
    rules: { "no-console": "off" },
  },
);
