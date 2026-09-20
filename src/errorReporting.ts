/**
 * Client-seitiges Melden von Browser-Fehlern an den App-eigenen `/client-errors`-Proxy-Endpoint
 * (TF-854). Portiert aus `ratum/frontend/src/lib/errorReporting.ts` (ADR-012), generisch fuer
 * beliebige Specula-Monitored-Products.
 *
 * Bewusste Abweichungen vom ratum-Original, alle fuer die Wiederverwendung durch mehrere
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
 * - Anders als ratum befuellt diese Bibliothek `ClientErrorPayload.userAgent`/`.url` nicht selbst
 *   — Aufrufer (`ErrorBoundary`, `attachGlobalHandlers`) liefern den vollstaendigen Payload,
 *   damit `reportError` unabhaengig von einer konkreten Browser-Umgebung bleibt (z. B. in Tests).
 *
 * Bekannte, bewusst nicht in TF-854 geloeste Einschraenkung: nur `payload.url` wird via
 * {@link safeUrl} sanitized. `message`/`stack`/`componentStack` werden unveraendert an den
 * Endpoint gesendet und koennen z. B. bei Inline-`<script>`/`eval`-Fehlern die volle Dokument-URL
 * (inkl. Query-String) im Stacktrace enthalten. Vollstaendiges PII-/Token-Scrubbing dieser Felder
 * ist ein eigener, spaeterer Baustein derselben EPIC (siehe README-Status).
 */

export interface ClientErrorPayload {
  /** Fehlermeldung (`Error.message`). Wird unveraendert gesendet — siehe Modul-Doc zur
   * Sanitizing-Einschraenkung. */
  message: string;
  /** Stacktrace (`Error.stack ?? ""`). Wird unveraendert gesendet — siehe Modul-Doc. */
  stack: string;
  /** Roh-URL der Seite, auf der der Fehler auftrat. Wird von {@link ErrorReporter.reportError}
   * intern via {@link safeUrl} sanitized, bevor sie den Endpoint erreicht. */
  url: string;
  /** `navigator.userAgent` im Zeitpunkt des Fehlers. Muss vom Aufrufer geliefert werden (siehe
   * Modul-Doc). */
  userAgent: string;
  /** React-Component-Stack (`ErrorInfo.componentStack`), nur bei ueber {@link
   * ErrorBoundary#componentDidCatch} gefangenen Render-Fehlern gesetzt. */
  componentStack?: string;
}

export interface ErrorReporterOptions {
  /**
   * Pfad (oder vollqualifizierte URL) des App-eigenen `/client-errors`-Proxy-Endpoints. Pflicht
   * (kein Default) — siehe Modul-Doc. Muss ein nicht-leerer String sein, sonst wirft
   * {@link createErrorReporter} sofort bei der Erzeugung.
   */
  endpoint: string;
  /**
   * Obergrenze an Reports ueber die Lebensdauer dieses Reporters (i. d. R. ein Seitenaufruf,
   * Default 5). Schuetzt vor Self-DoS: ein sich wiederholender Frontend-Fehler (fehlerhafter
   * `setInterval`, Fehler in einem haeufig gefeuerten Event-Handler) darf nicht unbegrenzt gegen
   * den Backend-Proxy und dessen Rate-Limit feuern (Review-Fund aus dem ratum-Original, TF-492).
   * Muss eine nicht-negative, endliche Zahl sein, sonst wirft {@link createErrorReporter} sofort
   * bei der Erzeugung (ein stillschweigend wirkungsloser Deckel waere schlimmer als kein Deckel).
   */
  maxReports?: number;
}

export interface ErrorReporter {
  /**
   * Meldet einen Fehler an den konfigurierten Endpoint. Sanitized `payload.url` intern via
   * {@link safeUrl} (Aufrufer uebergeben die rohe URL, nicht selbst sanitized — zentralisiert die
   * Sanitizing-Pflicht an einer Stelle statt sie jedem Call-Site aufzuerlegen). Wirft nie:
   * ein Report-Fehlschlag darf die App nie beeintraechtigen (ADR-012), bleibt aber ueber
   * `console.error`/`console.warn` sichtbar statt lautlos zu verschwinden (Netzwerkfehler,
   * HTTP-Fehlerstatus, Erreichen von `maxReports`).
   */
  reportError(payload: ClientErrorPayload): Promise<void>;
  /**
   * Registriert Listener fuer die `error`/`unhandledrejection`-Events auf `window`, die nicht von
   * React abgefangene Fehler (u. a. Fehler ausserhalb des Render-Baums, in Event-Handlern,
   * rejected Promises) ueber {@link ErrorReporter.reportError} melden. Nutzt `addEventListener`
   * statt `window.onerror =`/`window.onunhandledrejection =`, damit bereits registrierte Handler
   * (eine zweite Reporter-Instanz, ein anderes Monitoring-Tool) nicht stillschweigend ersetzt
   * werden. Bewusst nicht automatisch beim Erzeugen des Reporters aktiv — Konsumenten entscheiden
   * selbst, wann/ob global gemeldet werden soll (z. B. nur in Prod:
   * `if (import.meta.env.PROD) reporter.attachGlobalHandlers()`).
   *
   * @returns Eine Funktion, die die registrierten Listener wieder entfernt (z. B. fuer Tests oder
   * einen React-Effect-Cleanup).
   */
  attachGlobalHandlers(): () => void;
}

const DEFAULT_MAX_REPORTS = 5;

/**
 * Erzeugt eine isolierte Reporter-Instanz mit eigenem, gekapseltem Drossel-/Dedup-Zustand (siehe
 * Modul-Doc). Wirft sofort (statt spaeter still zu versagen), wenn `options.endpoint` leer ist
 * oder `options.maxReports` keine gueltige, nicht-negative Zahl ist — beides Konstruktionsfehler,
 * die am besten am Call-Site auffallen und nicht erst beim ersten fehlgeschlagenen Report.
 */
export function createErrorReporter(options: ErrorReporterOptions): ErrorReporter {
  const { endpoint, maxReports = DEFAULT_MAX_REPORTS } = options;

  if (endpoint.trim() === "") {
    throw new Error("createErrorReporter: `endpoint` ist Pflicht und darf nicht leer sein.");
  }
  if (!Number.isFinite(maxReports) || maxReports < 0) {
    throw new Error(
      `createErrorReporter: \`maxReports\` muss eine nicht-negative, endliche Zahl sein, erhalten: ${String(maxReports)}.`,
    );
  }

  let reportCount = 0;
  let capWarningLogged = false;
  const reportedSignatures = new Set<string>();

  function shouldReport(payload: ClientErrorPayload): boolean {
    if (reportCount >= maxReports) {
      // Ohne dieses Signal wuerde das Erreichen des Deckels komplett spurlos bleiben — niemand
      // koennte im Nachhinein "wurde gedrosselt" von "es gab keine weiteren Fehler" unterscheiden.
      // Nur einmal pro Reporter-Instanz loggen, um nicht selbst zur Log-Spam-Quelle zu werden.
      if (!capWarningLogged) {
        capWarningLogged = true;
        console.warn(
          `specula-client: maxReports (${maxReports}) erreicht — weitere Client-Fehler dieser Reporter-Instanz werden nicht mehr gemeldet.`,
        );
      }
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
    try {
      if (!shouldReport(payload)) {
        return;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, url: safeUrl(payload.url) }),
        // Reports, die kurz vor einem Seitenwechsel/Unload gefeuert werden (z. B. aus
        // attachGlobalHandlers bei einer Navigation), sollen den Browser ueberleben statt
        // gecancelt zu werden.
        keepalive: true,
      });
      // `fetch()` wirft nur bei Netzwerkfehlern, nicht bei 4xx/5xx — ohne diese Pruefung
      // verschwaende eine vom Backend abgelehnte Meldung (z. B. Payload-Limits, Rate-Limit)
      // komplett spurlos, nicht mal in der Konsole (Review-Fund aus dem ratum-Original).
      if (!response.ok) {
        console.error(
          `specula-client: error-reporting failed for "${payload.message}" (endpoint=${endpoint}): HTTP ${response.status}`,
        );
      }
    } catch (err) {
      // Deckt sowohl Netzwerkfehler aus `fetch()` als auch unerwartete Fehler aus `shouldReport()`
      // ab (z. B. falls `JSON.stringify` in der Signatur-Bildung je einen Ausnahmefall wirft) —
      // das "wirft nie"-Versprechen des Interfaces gilt fuer die gesamte Funktion, nicht nur den
      // Netzwerk-Aufruf.
      console.error(`specula-client: error-reporting failed for "${payload.message}" (endpoint=${endpoint}):`, err);
    }
  }

  function attachGlobalHandlers(): () => void {
    const handleError = (event: ErrorEvent): void => {
      void reportError({
        message: event.error instanceof Error ? event.error.message : event.message,
        stack: event.error instanceof Error ? (event.error.stack ?? "") : "",
        url: window.location.href,
        userAgent: navigator.userAgent,
      });
    };

    const handleRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason as unknown;
      void reportError({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? (reason.stack ?? "") : "",
        url: window.location.href,
        userAgent: navigator.userAgent,
      });
    };

    // addEventListener statt window.onerror =/window.onunhandledrejection = : komponiert mit
    // bereits registrierten Handlern (z. B. einer zweiten Reporter-Instanz oder einem anderen
    // Monitoring-Tool), statt sie stillschweigend zu ersetzen.
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
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
 *
 * Relative Pfade (z. B. `"/verify-email?token=..."`, wie sie ein direkter Aufrufer statt einer
 * vollqualifizierten URL uebergeben koennte) werden gegen `window.location.origin` aufgeloest,
 * statt wie eine unparsbare URL auf `""` zu fallen — sonst ginge der Pfad komplett verloren.
 */
export function safeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    if (typeof window !== "undefined" && rawUrl.startsWith("/")) {
      try {
        const url = new URL(rawUrl, window.location.origin);
        return `${url.origin}${url.pathname}`;
      } catch {
        // Faellt durch zum konservativen Fallback unten.
      }
    }
    // Kein parsbares URL-Objekt — konservativ nichts Rohes weiterreichen, aber sichtbar machen,
    // dass hier etwas verworfen wurde (statt eine leere `url` im Report unerklaert zu lassen).
    console.warn(`specula-client: safeUrl() konnte "${rawUrl}" nicht parsen; url wird im Report weggelassen.`);
    return "";
  }
}
