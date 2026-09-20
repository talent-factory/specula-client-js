/**
 * @talent-factory/specula-client — Public API.
 *
 * Enthaelt bislang das Package-Geruest (Build/Lint/Test, TF-853) sowie den
 * `/client-errors`-Frontend-Client und den React-`ErrorBoundary`-Helper (TF-854). OTel-SDK-Setup
 * und weitere Bausteine folgen in Folge-Tasks der EPIC TF-845 (Vorbild:
 * `ratum/backend/app/monitoring.py`, ADR-012).
 */

export { ErrorBoundary, type ErrorBoundaryProps } from "./ErrorBoundary.js";
export {
  createErrorReporter,
  safeUrl,
  type ClientErrorPayload,
  type ErrorReporter,
  type ErrorReporterOptions,
} from "./errorReporting.js";

export const SPECULA_CLIENT_VERSION = "0.0.0";
