import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createErrorReporter, safeUrl } from "./errorReporting.js";

const ENDPOINT = "/client-errors";

// attachGlobalHandlers() haengt echte "error"/"unhandledrejection"-Listener an `window` — die
// muessen zwischen Tests wieder entfernt werden, sonst feuern Listener aelterer Tests bei
// dispatchEvent() in spaeteren Tests mit und verfaelschen die fetch-Call-Reihenfolge.
let detachHandlers: Array<() => void> = [];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const detach of detachHandlers) {
    detach();
  }
  detachHandlers = [];
});

describe("safeUrl", () => {
  it("strips the query string", () => {
    expect(safeUrl("https://app.example.com/verify-email?token=abc123")).toBe(
      "https://app.example.com/verify-email",
    );
  });

  it("strips the fragment", () => {
    expect(safeUrl("https://app.example.com/page#secret")).toBe("https://app.example.com/page");
  });

  it("combines query and fragment stripping", () => {
    expect(safeUrl("https://app.example.com/page?token=abc#secret")).toBe(
      "https://app.example.com/page",
    );
  });

  it("returns an empty string for an unparsable URL and warns", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(safeUrl("not a valid url")).toBe("");

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("not a valid url"));
    consoleSpy.mockRestore();
  });

  it("resolves a relative path against window.location.origin instead of dropping it", () => {
    expect(safeUrl("/verify-email?token=super-secret")).toBe(`${window.location.origin}/verify-email`);
  });
});

describe("createErrorReporter", () => {
  it("throws synchronously for an empty endpoint instead of failing silently later", () => {
    expect(() => createErrorReporter({ endpoint: "" })).toThrow(/endpoint/);
    expect(() => createErrorReporter({ endpoint: "   " })).toThrow(/endpoint/);
  });

  it("throws synchronously for an invalid maxReports instead of silently disabling the cap", () => {
    expect(() => createErrorReporter({ endpoint: ENDPOINT, maxReports: -1 })).toThrow(/maxReports/);
    expect(() => createErrorReporter({ endpoint: ENDPOINT, maxReports: Number.NaN })).toThrow(/maxReports/);
  });
});

describe("createErrorReporter().reportError", () => {
  it("posts the payload to the configured endpoint", async () => {
    const reporter = createErrorReporter({ endpoint: ENDPOINT });

    await reporter.reportError({
      message: "boom",
      stack: "at foo",
      url: "https://app.example.com/x",
      userAgent: "test-agent",
    });

    expect(fetch).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.message).toBe("boom");
    expect(body.userAgent).toBe("test-agent");
  });

  it("sends a sanitized url, never the raw token-bearing one", async () => {
    const reporter = createErrorReporter({ endpoint: ENDPOINT });

    await reporter.reportError({
      message: "boom",
      stack: "",
      url: "https://app.example.com/verify-email?token=super-secret",
      userAgent: "test-agent",
    });

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.url).toBe("https://app.example.com/verify-email");
    expect(body.url).not.toContain("super-secret");
  });

  it("swallows network errors", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    const reporter = createErrorReporter({ endpoint: ENDPOINT });

    await expect(
      reporter.reportError({ message: "boom", stack: "", url: "https://app.example.com/x", userAgent: "" }),
    ).resolves.toBeUndefined();
  });

  it("logs to the console when the backend rejects the report (e.g. 422/429)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 422 } as Response);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reporter = createErrorReporter({ endpoint: ENDPOINT });

    await reporter.reportError({ message: "boom", stack: "", url: "https://app.example.com/x", userAgent: "" });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("422"));
    consoleSpy.mockRestore();
  });

  it("deduplicates identical message+stack signatures", async () => {
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    const payload = { message: "repeat-me", stack: "at foo", url: "https://app.example.com/x", userAgent: "" };

    await reporter.reportError(payload);
    await reporter.reportError(payload);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not let duplicates consume the maxReports budget meant for distinct errors", async () => {
    // Regression-Schutz: shouldReport() muss den Dedup-Check VOR dem Inkrementieren von
    // reportCount ausfuehren. Wuerde ein Duplikat versehentlich das Budget verbrauchen, ginge
    // hier der dritte, tatsaechlich neue Fehler verloren.
    const reporter = createErrorReporter({ endpoint: ENDPOINT, maxReports: 2 });
    const duplicate = { message: "repeat-me", stack: "at foo", url: "https://app.example.com/x", userAgent: "" };

    for (let i = 0; i < 5; i += 1) {
      await reporter.reportError(duplicate);
    }
    await reporter.reportError({ message: "distinct", stack: "", url: "https://app.example.com/x", userAgent: "" });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caps the number of reports at the configured maxReports and warns once", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reporter = createErrorReporter({ endpoint: ENDPOINT, maxReports: 2 });

    for (let i = 0; i < 5; i += 1) {
      await reporter.reportError({
        message: `distinct-${i}`,
        stack: "",
        url: "https://app.example.com/x",
        userAgent: "",
      });
    }

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("maxReports"));
    consoleSpy.mockRestore();
  });

  it("defaults maxReports to 5", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reporter = createErrorReporter({ endpoint: ENDPOINT });

    for (let i = 0; i < 10; i += 1) {
      await reporter.reportError({
        message: `distinct-${i}`,
        stack: "",
        url: "https://app.example.com/x",
        userAgent: "",
      });
    }

    expect(fetch).toHaveBeenCalledTimes(5);
    consoleSpy.mockRestore();
  });

  it("keeps separate throttle state per reporter instance", async () => {
    const reporterA = createErrorReporter({ endpoint: ENDPOINT, maxReports: 1 });
    const reporterB = createErrorReporter({ endpoint: ENDPOINT, maxReports: 1 });

    await reporterA.reportError({ message: "a", stack: "", url: "https://app.example.com/x", userAgent: "" });
    await reporterB.reportError({ message: "b", stack: "", url: "https://app.example.com/x", userAgent: "" });

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("createErrorReporter().attachGlobalHandlers", () => {
  it("forwards window 'error' events to reportError", () => {
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    detachHandlers.push(reporter.attachGlobalHandlers());

    window.dispatchEvent(new ErrorEvent("error", { message: "Script error", error: new Error("boom") }));

    expect(fetch).toHaveBeenCalled();
  });

  it("falls back to the raw message when the error event has no Error object", () => {
    // Cross-Origin-Skriptfehler feuern das error-Event mit error === null ("Script error.") — der
    // Fall, fuer den `event.error instanceof Error ? ... : event.message` existiert.
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    detachHandlers.push(reporter.attachGlobalHandlers());

    window.dispatchEvent(new ErrorEvent("error", { message: "Script error.", error: undefined }));

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.message).toBe("Script error.");
    expect(body.stack).toBe("");
  });

  it("forwards window 'unhandledrejection' events to reportError", () => {
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    detachHandlers.push(reporter.attachGlobalHandlers());

    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: new Error("rejected") });
    window.dispatchEvent(event);

    expect(fetch).toHaveBeenCalled();
  });

  it("falls back to an empty stack when the rejection reason has none", () => {
    // Analog zum entsprechenden ErrorBoundary-Test: `reason.stack ?? ""` war bislang unverifiziert
    // (die bisherige Rejection mit new Error(...) hat immer einen echten Stack).
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    detachHandlers.push(reporter.attachGlobalHandlers());

    const reasonWithoutStack = new Error("rejected without stack");
    Object.defineProperty(reasonWithoutStack, "stack", { value: undefined });
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: reasonWithoutStack });
    window.dispatchEvent(event);

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.stack).toBe("");
  });

  it("falls back to String(reason) for a non-Error rejection", () => {
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    detachHandlers.push(reporter.attachGlobalHandlers());

    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: "plain string rejection" });
    window.dispatchEvent(event);

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.message).toBe("plain string rejection");
    expect(body.stack).toBe("");
  });

  it("returns a detach function that removes the registered listeners", () => {
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    const detach = reporter.attachGlobalHandlers();

    detach();
    // Kein `error`-Objekt hier: mit null Listenern auf `window` wuerde Vitests eigener
    // Test-Isolations-Schutz (`catchWindowErrors`) ein dispatchetes ErrorEvent mit echtem `.error`
    // sonst selbst als Test-Crash behandeln — das waere ein Test-Artefakt, kein Verhalten der
    // Bibliothek. Ohne `.error` bleibt der Zweck des Tests (kein reportError nach detach) intakt.
    window.dispatchEvent(new ErrorEvent("error", { message: "after detach" }));

    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not clobber a second reporter's global handlers (addEventListener composes)", () => {
    const reporterA = createErrorReporter({ endpoint: ENDPOINT });
    const reporterB = createErrorReporter({ endpoint: ENDPOINT });
    detachHandlers.push(reporterA.attachGlobalHandlers(), reporterB.attachGlobalHandlers());

    window.dispatchEvent(new ErrorEvent("error", { message: "boom", error: new Error("boom") }));

    // Beide Instanzen haben eigenen Drossel-Zustand (maxReports=5 je Instanz) und sollten daher
    // beide unabhaengig voneinander melden, statt dass die zweite Registrierung die erste ersetzt.
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
