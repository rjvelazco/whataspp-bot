import { defineConfig } from "vitest/config";

/**
 * The bot's tests only. Without an explicit include, vitest's default glob reaches into
 * web/ and tries to run the Angular package's tests as vitest suites — web/scripts holds
 * a node:test fixture file, which vitest loads and then reports as "no test suite found".
 * The two packages own their own runners: vitest here, node --test and karma in web/.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
