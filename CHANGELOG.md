# Changelog

Alle nennenswerten Aenderungen an `@talent-factory/specula-client` werden hier dokumentiert.

Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung
folgt [SemVer](https://semver.org/lang/de/) ueber Git-Tags (`vX.Y.Z`) - siehe README,
Abschnitt "Versionierung".

## [0.1.0] - 2026-09-20

Erstes stabiles Release. Buendelt den `/client-errors`-Frontend-Client samt `ErrorBoundary`-Helper
und den rrweb-basierten Session-Replay-Wrapper, gebaut nach dem Vorbild von `ratum`-ADR-012 bzw.
als neue Faehigkeit (Ersatz fuer Sentry Session-Replay).

### Hinzugefuegt

- **Client-Errors + ErrorBoundary** (TF-854): `createErrorReporter()` meldet Browser-Fehler an
  einen App-eigenen `/client-errors`-Proxy-Endpoint, `ErrorBoundary` faengt zusaetzlich
  React-Render-Fehler ab. `reportError()` sanitized die URL via `safeUrl()` und drosselt sich
  selbst (Default: max. 5 Reports pro Reporter-Instanz).
- **Session-Replay (rrweb)** (TF-855): `createSessionReplayRecorder()` wrappt `rrweb.record()`
  mit DSGVO-Defaults (Text maskiert, Medien geblockt), batcht Events und sendet sie periodisch an
  einen konfigurierbaren Endpoint. Unterstuetzt Sampling (`sampleRate`/`errorSampleRate`) und
  nachtraegliches Hochziehen auf volle Aufzeichnung via `notifyError()`.

### Bekannt

- Sanitizing deckt bislang nur das `url`-Feld der Error-Reports ab; `message`/`stack`/
  `componentStack` werden unveraendert weitergereicht.
- Die ClickHouse-Ingestion fuer Session-Replay-Events ist ein eigener, noch offener Sub-Task
  derselben EPIC ([TF-845](https://linear.app/talent-factory/issue/TF-845)); `endpoint` ist bis
  dahin ein App-eigener Proxy.

[0.1.0]: https://github.com/talent-factory/specula-client-js/releases/tag/v0.1.0
