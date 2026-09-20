import { Component, type ErrorInfo, type ReactNode } from "react";

import type { ClientErrorPayload } from "./errorReporting.js";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Wird bei einem gefangenen Render-Fehler mit dem vollstaendigen {@link ClientErrorPayload}
   * aufgerufen (inkl. `componentStack`/`userAgent`) — i. d. R. `reporter.reportError`, wobei
   * `reporter` via `createErrorReporter()` erzeugt wurde. Bewusst als expliziter Callback statt
   * eines eingebauten Reporters: entkoppelt die Komponente von einer konkreten
   * Reporter-Konfiguration (Endpoint) und haelt sie so in Tests trivial isolierbar.
   */
  onError: (payload: ClientErrorPayload) => void;
  /** Fallback-UI bei gefangenem Fehler. Default: einfacher deutscher Hinweistext wie im
   * ratum-Original (`RootErrorBoundary`). */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Wiederverwendbarer React-`ErrorBoundary`-Helper (TF-854). Faengt Render-Fehler im Kindbaum ab
 * — diese propagieren sonst NICHT zu `window.onerror` (React-eigenes Verhalten), sind also ohne
 * eine solche Boundary fuer {@link createErrorReporter} unsichtbar. Portiert aus ratums
 * `RootErrorBoundary` (ADR-012), hier generisch: kein eingebauter Reporter/Endpoint (siehe
 * `onError`-Doc), Fallback-UI ueberschreibbar statt hart auf ratums Text verdrahtet.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError({
      message: error.message,
      stack: error.stack ?? "",
      url: window.location.href,
      userAgent: navigator.userAgent,
      componentStack: info.componentStack ?? "",
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? <p role="alert">Es ist ein Fehler aufgetreten. Bitte lade die Seite neu.</p>
      );
    }
    return this.props.children;
  }
}
