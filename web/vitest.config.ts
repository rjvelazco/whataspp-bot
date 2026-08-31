import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the Angular-free modules in this package — pure functions that import
 * no Angular and touch no DOM, which is where the testable risk actually is.
 *
 * This coexists with the `ng test` Karma target rather than replacing it: Karma exists
 * for component tests that need a browser, and has no specs yet. Anything that needs
 * TestBed belongs there; anything that is just a function belongs here, where it runs in
 * milliseconds without a browser.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
