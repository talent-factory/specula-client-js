import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Ohne globales Cleanup bleiben ueber `render()` gemountete Komponenten zwischen Tests im DOM
// stehen (kein `globals: true` in vitest.config.ts, daher registriert sich Testing Librarys
// eigenes Auto-Cleanup nicht automatisch). Betraf bislang nur nicht, weil kein Test zweimal auf
// denselben Text query'te — sichtbar geworden erst mit zusaetzlichen Tests, die erneut den
// Default-Fallback-Text abfragen.
afterEach(() => {
  cleanup();
});
