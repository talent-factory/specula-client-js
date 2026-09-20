/**
 * Client-seitiges Melden von Browser-Fehlern an den App-eigenen `/client-errors`-Proxy-Endpoint
 * (TF-854). Portiert aus `ratum/frontend/src/lib/errorReporting.ts` (ADR-012), generisch fuer
 * beliebige Specula-Monitored-Products.
 *
 * Zwei bewusste Abweichungen vom ratum-Original, beide fuer die Wiederverwendung durch mehrere
 * Talent-Factory-Produkte (analog zu den Abweichungen in `specula_client.logging`):
 *
 * - Der Endpoint hat hier KEINEN Default und wird nicht aus `import.meta.env` gelesen — jedes
 *   Monitored Product betreibt seinen eigenen `/client-errors`-Proxy (siehe Grilling Q12 zu
 *   TF-845), und diese Bibliothek darf weder ratums konkrete Route noch eine Vite-spezifische
 *   Env-Var-Konvention hart verdrahten (andere Products/Bundler lesen Konfiguration anders).
 * - Kein modulweiter Singleton-Zustand mehr (ratums `ENDPOINT`/`reportCount`-Modulvariablen).
 *   `createErrorReporter()` liefert stattdessen eine Instanz mit eigenem, gekapseltem
 *   Drossel-Zustand — mehrere Reporter (z. B. unterschiedliche Endpoints in Tests oder in einem
 *   Multi-App-Setup) koennen so nebeneinander bestehen, ohne dass sich Tests gegenseitig ueber
 *   modulweiten Zustand beeinflussen (ratums Vorbild brauchte dafuer den Test-only-Escape-Hatch
 *   `_resetThrottleForTests()`).
 */

export interface ClientErrorPayload {
  message: string;
  stack: string;
  url: string;
  userAgent: string;
  componentStack?: string;
}

export interface ErrorReporterOptions {
  /**
   * Pfad (oder vollqualifizierte URL) des App-eigenen `/client-errors`-Proxy-Endpoints. Pflicht
   * (kein Default) — siehe Modul-Doc.
   */
  endpoint: string;
  /**
   * Obergrenze an Reports ueber die Lebensdauer dieses Reporters (i. d. R. ein Seitenaufruf,
   * Default 5). Schuetzt vor Self-DoS: ein sich wiederholender Frontend-Fehler (fehlerhafter
   * `setInterval`, Fehler in einem haeufig gefeuerten Event-Handler) darf nicht unbegrenzt gegen
   * den Backend-Proxy und dessen Rate-Limit feuern (Review-Fund aus dem ratum-Original, TF-492).
   */
  maxReports?: number;
}

export interface ErrorReporter {
  /**
   * Meldet einen Fehler an den konfigurierten Endpoint. Sanitized `payload.url` intern via
   * {@link safeUrl} (Aufrufer uebergeben die rohe URL, nicht selbst sanitized — zentralisiert die
   * Sanitizing-Pflicht an einer Stelle statt sie jedem Call-Site aufzuerlegen). Wirft nie:
   * ein Report-Fehlschlag darf die App nie beeintraechtigen (ADR-012), bleibt aber ueber
   * `console.error` sichtbar statt lautlos zu verschwinden.
   */
  reportError(payload: ClientErrorPayload): Promise<void>;
  /**
   * Registriert `window.onerror`/`window.onunhandledrejection`, die nicht von React abgefangene
   * Fehler (u. a. Fehler ausserhalb des Render-Baums, in Event-Handlern, rejected Promises) ueber
   * {@link ErrorReporter.reportError} melden. Bewusst nicht automatisch beim Erzeugen des
   * Reporters aktiv — Konsumenten entscheiden selbst, wann/ob global gemeldet werden soll (z. B.
   * nur in Prod: `if (import.meta.env.PROD) reporter.attachGlobalHandlers()`).
   */
  attachGlobalHandlers(): void;
}

const DEFAULT_MAX_REPORTS = 5;

export function createErrorReporter(options: ErrorReporterOptions): ErrorReporter {
  const { endpoint, maxReports = DEFAULT_MAX_REPORTS } = options;

  let reportCount = 0;
  const reportedSignatures = new Set<string>();

  function shouldReport(payload: ClientErrorPayload): boolean {
    if (reportCount >= maxReports) {
      return false;
    }
    // Dedup ueber message+stack, damit derselbe wiederkehrende Fehler nicht x-mal einzeln
    // zaehlt, bevor der Deckel greift (sonst waere der Deckel gegen genau den Fall wirkungslos,
    // den er eigentlich abfangen soll).
    const signature = JSON.stringify([payload.message, payload.stack]);
    if (reportedSignatures.has(signature)) {
      return false;
    }
    reportedSignatures.add(signature);
    reportCount += 1;
    return true;
  }

  async function reportError(payload: ClientErrorPayload): Promise<void> {
    if (!shouldReport(payload)) {
      return;
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, url: safeUrl(payload.url) }),
      });
      // `fetch()` wirft nur bei Netzwerkfehlern, nicht bei 4xx/5xx — ohne diese Pruefung
      // verschwaende eine vom Backend abgelehnte Meldung (z. B. Payload-Limits, Rate-Limit)
      // komplett spurlos, nicht mal in der Konsole (Review-Fund aus dem ratum-Original).
      if (!response.ok) {
        console.error(`specula-client: error-reporting failed: HTTP ${response.status}`);
      }
    } catch (err) {
      console.error("specula-client: error-reporting failed:", err);
    }
  }

  function attachGlobalHandlers(): void {
    window.onerror = (message, _source, _lineno, _colno, error) => {
      void reportError({
        message: error?.message ?? String(message),
        stack: error?.stack ?? "",
        url: window.location.href,
        userAgent: navigator.userAgent,
      });
    };

    window.onunhandledrejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      void reportError({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? (reason.stack ?? "") : "",
        url: window.location.href,
        userAgent: navigator.userAgent,
      });
    };
  }

  return { reportError, attachGlobalHandlers };
}

/**
 * Sanitized eine URL vor dem Versand an den Backend-Proxy: strippt Query-String und Fragment,
 * behaelt nur Origin + Pfad. Aequivalent zur Kernaufgabe von ratums `safeUrl` (Query-String-
 * Tokens wie `?token=...` auf `/verify-email`/`/reset-password` duerfen nie an einen externen
 * Log-Store gehen), bewusst OHNE ratums zusaetzliche `/sign/:token`-Pfad-Redaction — das war eine
 * ratum-spezifische Routen-Kenntnis (Capability-Token direkt im Pfad), die diese generische
 * Bibliothek nicht hart verdrahten darf (kein Hardcoding auf ratums Route, siehe Grilling Q12).
 * Ein Monitored Product mit aehnlichen Pfad-Capabilities kapselt eine zusaetzliche Pfad-Redaction
 * in seinem eigenen Code, z. B. `safeUrl(rawUrl).replace(/^\/sign\/[^/]+/, "/sign/<redacted>")`.
 */
export function safeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    // Kein parsbares URL-Objekt — konservativ nichts Rohes weiterreichen.
    return "";
  }
}
