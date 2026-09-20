# @talent-factory/specula-client (JS)

Gemeinsame Client-Library fuer Monitored Products von [Specula](https://github.com/talent-factory/specula)
(OTel-SDK-Setup, `SpeculaLogHandler`, PII-Scrubbing, Frontend-Error-Proxy).

Extrahiert aus dem in `ratum` gewachsenen Muster (ADR-012), damit `ratum` und
`examcraft-private` denselben, versionierten Code beziehen statt ihn
zu duplizieren. Siehe [TF-845](https://linear.app/talent-factory/issue/TF-845)
fuer den vollen Kontext.

> **Status**: `/client-errors`-Frontend-Client + `ErrorBoundary`-Helper (TF-854). Weitere
> Bausteine (u. a. rrweb-Session-Replay, TF-855) folgen in nachgelagerten Tasks derselben EPIC.

## Installation

Kein eigenes npm-Registry — Bezug per Git-Dependency auf ein Tag:

```bash
npm install github:talent-factory/specula-client-js#v0.1.0
```

`package.json`:

```json
{
  "dependencies": {
    "@talent-factory/specula-client": "github:talent-factory/specula-client-js#v0.1.0"
  }
}
```

## Client-Errors + ErrorBoundary

`createErrorReporter()` meldet Browser-Fehler an den App-eigenen `/client-errors`-Proxy-Endpoint
(der Endpoint selbst bleibt pro Repo — siehe [TF-845](https://linear.app/talent-factory/issue/TF-845),
Grilling Q12). `ErrorBoundary` faengt zusaetzlich React-Render-Fehler ab, die React sonst nicht an
`window.onerror` propagiert:

```tsx
import { ErrorBoundary, createErrorReporter } from "@talent-factory/specula-client";

const reporter = createErrorReporter({ endpoint: "/api/v1/monitoring/client-errors" });

// Global unhandled errors/rejections (ausserhalb des React-Render-Baums) — nur in Prod:
if (import.meta.env.PROD) {
  reporter.attachGlobalHandlers();
}

function App() {
  return (
    <ErrorBoundary onError={reporter.reportError}>
      <MyApp />
    </ErrorBoundary>
  );
}
```

`reportError()` sanitized die gemeldete URL immer via `safeUrl()` (strippt Query-String und
Fragment) und drosselt sich selbst (Default: max. 5 Reports pro Reporter-Instanz), damit ein sich
wiederholender Frontend-Fehler nicht das Rate-Limit-Budget des Backend-Proxys aufbraucht.

## Versionierung

Es gibt keine npm-Registry-Releases. Versionen sind Git-Tags nach
[SemVer](https://semver.org/) (`vMAJOR.MINOR.PATCH`). Konsumenten pinnen
in ihrer `package.json` immer auf ein konkretes Tag, nie auf `main`/`develop`.

## Entwicklung

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```
