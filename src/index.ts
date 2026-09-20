/**
 * @talent-factory/specula-client — Public API.
 *
 * Enthaelt bislang das Package-Geruest (Build/Lint/Test, TF-853), den
 * `/client-errors`-Frontend-Client und den React-`ErrorBoundary`-Helper (TF-854) sowie den
 * rrweb-Session-Replay-Wrapper (TF-855). OTel-SDK-Setup und weitere Bausteine folgen in
 * Folge-Tasks der EPIC TF-845 (Vorbild: `ratum/backend/app/monitoring.py`, ADR-012).
 */

export { ErrorBoundary, type ErrorBoundaryProps } from "./ErrorBoundary.js";
export {
  createErrorReporter,
  safeUrl,
  type ClientErrorPayload,
  type ErrorReporter,
  type ErrorReporterOptions,
} from "./errorReporting.js";
export {
  createSessionReplayRecorder,
  type SessionReplayEventBatch,
  type SessionReplayOptions,
  type SessionReplayRecorder,
  type SessionReplaySamplingMode,
} from "./sessionReplay.js";

export const SPECULA_CLIENT_VERSION = "0.0.0";
