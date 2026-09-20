import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom (statt node, dem Vitest-Default): ErrorBoundary.test.tsx rendert React-Komponenten
    // und errorReporting.test.ts stubbt `window`/`navigator`/`fetch` — beides braucht ein DOM.
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
