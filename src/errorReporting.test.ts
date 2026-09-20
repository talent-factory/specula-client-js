import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createErrorReporter, safeUrl } from "./errorReporting.js";

const ENDPOINT = "/client-errors";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.onerror = null;
  window.onunhandledrejection = null;
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

  it("returns an empty string for an unparsable URL", () => {
    expect(safeUrl("not a valid url")).toBe("");
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

  it("caps the number of reports at the configured maxReports", async () => {
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
  });

  it("defaults maxReports to 5", async () => {
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
  it("forwards window.onerror to reportError", () => {
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    reporter.attachGlobalHandlers();

    window.onerror!("Script error", "app.js", 1, 1, new Error("boom"));

    expect(fetch).toHaveBeenCalled();
  });

  it("falls back to the raw message when window.onerror has no Error object", () => {
    // Cross-Origin-Skriptfehler feuern window.onerror mit error === null ("Script error.") — der
    // Fall, fuer den `error?.message ?? String(message)` existiert.
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    reporter.attachGlobalHandlers();

    window.onerror!("Script error.", "app.js", 1, 1, undefined);

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.message).toBe("Script error.");
    expect(body.stack).toBe("");
  });

  it("forwards window.onunhandledrejection to reportError", () => {
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    reporter.attachGlobalHandlers();

    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: new Error("rejected") });
    window.onunhandledrejection!(event);

    expect(fetch).toHaveBeenCalled();
  });

  it("falls back to String(reason) for a non-Error rejection", () => {
    const reporter = createErrorReporter({ endpoint: ENDPOINT });
    reporter.attachGlobalHandlers();

    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: "plain string rejection" });
    window.onunhandledrejection!(event);

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.message).toBe("plain string rejection");
    expect(body.stack).toBe("");
  });
});
