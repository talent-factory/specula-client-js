import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary.js";
import type { ClientErrorPayload } from "./errorReporting.js";

afterEach(() => vi.restoreAllMocks());

function Boom(): never {
  throw new Error("render boom");
}

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <div>all good</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText("all good")).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it("renders the default fallback and reports the error when a child throws", () => {
    const onError = vi.fn();
    // React loggt bei jedem gefangenen Render-Fehler zusaetzlich (u. a. via console.error) einen
    // eigenen Stacktrace — hier gemockt, um den Testoutput sauber zu halten. Die eigentliche
    // Regressionsabsicherung laeuft ueber die Assertions unten (Fallback-Text, onError-Aufruf),
    // nicht ueber Konsolenoutput.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/ist ein Fehler aufgetreten/i)).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "render boom",
        userAgent: navigator.userAgent,
      }),
    );
    const payload = onError.mock.calls[0]![0] as ClientErrorPayload;
    expect(payload.componentStack).toContain("Boom");
    consoleSpy.mockRestore();
  });

  it("renders a custom fallback when provided", () => {
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary onError={onError} fallback={<p>Custom fallback</p>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("falls back to an empty stack when the thrown error has none", () => {
    // Review-Fund-Parallele zum ratum-Original: `error.stack ?? ''` war bislang unverifiziert.
    function BoomWithoutStack(): never {
      const err = new Error("boom without stack");
      Object.defineProperty(err, "stack", { value: undefined });
      throw err;
    }
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary onError={onError}>
        <BoomWithoutStack />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ stack: "" }));
    consoleSpy.mockRestore();
  });

  it("falls back to an empty string when componentStack is missing", () => {
    const onError = vi.fn();
    const boundary = new ErrorBoundary({ children: null, onError });

    boundary.componentDidCatch(new Error("boom"), { componentStack: null as unknown as string });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ componentStack: "" }));
  });

  it("renders nothing when fallback is explicitly null, instead of the default text", () => {
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <ErrorBoundary onError={onError} fallback={null}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/ist ein Fehler aufgetreten/i)).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("does not crash the app when the onError callback itself throws", () => {
    // Die Boundary ist die letzte Verteidigungslinie gegen Render-Fehler — ein Bug im
    // Reporting-Callback des Konsumenten darf diese Garantie nicht wieder aufheben.
    const onError = vi.fn(() => {
      throw new Error("onError callback is broken");
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      render(
        <ErrorBoundary onError={onError}>
          <Boom />
        </ErrorBoundary>,
      ),
    ).not.toThrow();

    expect(screen.getByText(/ist ein Fehler aufgetreten/i)).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("onError-Callback ist fehlgeschlagen"),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
