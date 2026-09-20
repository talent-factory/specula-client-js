import { describe, expect, it } from "vitest";

import { ErrorBoundary, SPECULA_CLIENT_VERSION, createErrorReporter, safeUrl } from "./index.js";

// Smoke-Test fuers Package-Barrel: stellt sicher, dass die oeffentliche API tatsaechlich
// importierbar ist (u. a. dass ErrorBoundary.tsx sauber durch tsc/vitest kompiliert). Fachliche
// Tests fuer die einzelnen Bausteine leben in errorReporting.test.ts/ErrorBoundary.test.tsx.
describe("specula-client (public API)", () => {
  it("exports the package version", () => {
    expect(SPECULA_CLIENT_VERSION).toBe("0.0.0");
  });

  it("exports the client-errors reporter and ErrorBoundary", () => {
    expect(createErrorReporter).toBeTypeOf("function");
    expect(safeUrl).toBeTypeOf("function");
    expect(ErrorBoundary).toBeTypeOf("function");
  });
});
