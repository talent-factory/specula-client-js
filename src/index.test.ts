import { describe, expect, it } from "vitest";

import { SPECULA_CLIENT_VERSION } from "./index.js";

// Leere Test-Suite fuers Repo-Skeleton (TF-853) — stellt nur sicher, dass
// Build/Test-Pipeline funktioniert. Echte Tests kommen mit der fachlichen
// Logik (OTel-Setup, Logging, PII-Scrubbing) in Folge-Tasks der EPIC TF-845.
describe("specula-client (skeleton)", () => {
  it("is importierbar", () => {
    expect(SPECULA_CLIENT_VERSION).toBe("0.0.0");
  });
});
