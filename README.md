# @talent-factory/specula-client (JS)

Gemeinsame Client-Library fuer Monitored Products von [Specula](https://github.com/talent-factory/specula)
(OTel-SDK-Setup, `SpeculaLogHandler`, PII-Scrubbing, Frontend-Error-Proxy).

Extrahiert aus dem in `ratum` gewachsenen Muster (ADR-012), damit `ratum` und
`examcraft-private` denselben, versionierten Code beziehen statt ihn
zu duplizieren. Siehe [TF-845](https://linear.app/talent-factory/issue/TF-845)
fuer den vollen Kontext.

> **Status**: Repo-Skeleton (TF-853) — noch ohne fachliche Logik. Die
> eigentliche Extraktion (OTel-Setup, Logging, Scrubbing) folgt in
> nachgelagerten Tasks derselben EPIC.

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
