# CLAUDE.md

Kontext für Claude Code in diesem Repo. Siehe auch [README.md](README.md) (Installation, Verwendung, Versionierung).

## Verwandte Projekte

Teil des [Specula](https://github.com/talent-factory/specula)-Projekts (selbst betriebenes,
OTel-natives Observability-Produkt), aber bewusst ein eigenständiges Repo statt Teil des
`specula`-Monorepos, weil dieses Package als versionierte Git-Tag-Dependency von mehreren
Produkt-Repos (`ratum`, `examcraft-private`) referenziert wird.

- [`specula`](https://github.com/talent-factory/specula) — Observability-Backend (Collector, ClickHouse, HyperDX, Notifier), an das dieses Package Fehler/Traces sendet
- [`specula-client-python`](https://github.com/talent-factory/specula-client-python) — Schwester-Library mit gleichem Funktionsumfang für Python-Produkte

Änderungen am Backend-Verhalten (Ingestion, Checks, Trigger) gehören ins `specula`-Repo, nicht
hierher.
