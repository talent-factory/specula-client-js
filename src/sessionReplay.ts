/**
 * rrweb-Wrapper fuer Session-Replay-Recording (TF-855). Ersetzt Sentrys Session-Replay-Feature
 * (siehe TF-845, Grilling Q3/Q6) — bislang gibt es dafuer kein Vorbild in `ratum`, dieses Modul
 * ist eine neue Faehigkeit, nicht extrahierter Bestandscode.
 *
 * Startet `rrweb.record()` mit DSGVO-Defaults (Text maskiert, Medien geblockt — analog zu
 * Sentrys `maskAllText`/`blockAllMedia`), batcht die emittierten Events und sendet sie periodisch
 * an einen konfigurierbaren Endpoint. Der Endpoint selbst hat bewusst KEINEN Default (analog
 * {@link createErrorReporter} in `errorReporting.ts`) — jedes Monitored Product betreibt seinen
 * eigenen Ingestion-Proxy, diese Bibliothek darf keine konkrete Route hart verdrahten.
 *
 * Bekannte, bewusst nicht in TF-855 geloeste Einschraenkung: Ein Error-getriggerter
 * Sampling-Upgrade (siehe {@link SessionReplayRecorder.notifyError}) zeichnet erst AB dem
 * Zeitpunkt des Fehlers auf, nicht rueckwirkend. Sentrys "Buffered Replay"-Modus haelt dafuer
 * einen rollierenden Ring-Buffer vor dem eigentlichen Recording-Start vor — das ist ein separater,
 * deutlich groesserer Baustein und liegt ausserhalb des Umfangs dieses Tasks.
 */

import { record } from "rrweb";
import type { eventWithTime } from "@rrweb/types";

/** Welcher Sampling-Pfad dieses Recording ausgeloest hat — Teil des Batch-Payloads, damit der
 * Server (bzw. spaeter ein Auswertungsdashboard) zwischen "normal gesampelte" und "wegen eines
 * Fehlers nachtraeglich hochgezogene" Sessions unterscheiden kann. */
export type SessionReplaySamplingMode = "normal" | "error";

export interface SessionReplayEventBatch {
  /** Stabile ID ueber die gesamte Lebensdauer eines {@link SessionReplayRecorder} — erlaubt dem
   * Server, mehrere Batches derselben Session zusammenzufuehren. */
  sessionId: string;
  /** Vom Aufrufer gelieferte Session-/Trace-Korrelations-ID (siehe {@link
   * SessionReplayOptions.getCorrelationId}), zum Zeitpunkt DIESES Batches abgefragt — kann sich
   * ueber die Lebensdauer einer Session aendern (z. B. neue Trace-ID pro Request), deshalb pro
   * Batch neu ermittelt statt einmalig bei {@link createSessionReplayRecorder} gecacht. */
  correlationId: string | undefined;
  samplingMode: SessionReplaySamplingMode;
  events: eventWithTime[];
}

export interface SessionReplayOptions {
  /**
   * Pfad (oder vollqualifizierte URL) des App-eigenen Session-Replay-Ingestion-Endpoints. Pflicht
   * (kein Default) — siehe Modul-Doc. Muss ein nicht-leerer String sein, sonst wirft {@link
   * createSessionReplayRecorder} sofort bei der Erzeugung.
   */
  endpoint: string;
  /**
   * Anteil der Sessions, die von Anfang an regulaer aufgezeichnet werden (0–1, Default 0.1 —
   * analog zu Sentrys niedriger Normal-Rate). Wird EINMAL bei {@link
   * SessionReplayRecorder.start} gewuerfelt.
   */
  sampleRate?: number;
  /**
   * Anteil, zu dem eine NICHT regulaer gesampelte Session doch aufgezeichnet wird, sobald {@link
   * SessionReplayRecorder.notifyError} nach einem erfassten Fehler aufgerufen wird (0–1, Default
   * 1 — analog zu Sentrys "100 % bei erfasstem Fehler").
   */
  errorSampleRate?: number;
  /**
   * Liefert die aktuell aktive Session-/Trace-Korrelations-ID (z. B. aus einem OTel-Kontext).
   * Optional, da diese Bibliothek keine Annahme ueber das konkrete Tracing-Setup eines Monitored
   * Products machen darf (analog zur Endpoint-Konfiguration ohne Bundler-/Env-Var-Annahme in
   * `errorReporting.ts`). Ohne Angabe wird `correlationId` im Batch-Payload `undefined`.
   */
  getCorrelationId?: () => string | undefined;
  /** Intervall zwischen automatischen Batch-Uploads in ms (Default 10000). */
  batchIntervalMs?: number;
  /** Batch wird sofort geflushed, sobald diese Anzahl gepufferter Events erreicht ist (Default
   * 100) — verhindert unbegrenztes Puffer-Wachstum bei sehr aktiven Sessions zwischen zwei
   * Intervall-Flushes. */
  batchMaxEvents?: number;
  /**
   * Schaltet die DSGVO-Defaults (Text-Maskierung + Medien-Blocking) explizit ab. Bewusst KEIN
   * einfaches `false`-Default-Flag, sondern ein separat benanntes, unmissverstaendlich
   * "gefaehrliches" Opt-out (Default `false`) — Akzeptanzkriterium TF-855 verlangt, dass die
   * Defaults nicht beilaeufig/versehentlich deaktivierbar sind, ein bewusster Opt-out aber
   * moeglich bleibt (z. B. fuer ein internes Tool ohne Publikumsverkehr).
   */
  dangerouslyDisableDefaultPrivacy?: boolean;
}

export interface SessionReplayRecorder {
  /** Stabile Session-ID, per `crypto.randomUUID()` bei Erzeugung generiert. */
  readonly sessionId: string;
  /**
   * Wuerfelt `sampleRate` und startet bei Erfolg sofort `rrweb.record()`. Bei Misserfolg bleibt
   * die Session "ungesampelt" — ein spaeterer {@link notifyError}-Aufruf kann das Recording
   * trotzdem noch nachtraeglich anstossen (zu `errorSampleRate`). Idempotent: wiederholte Aufrufe
   * nach einem bereits entschiedenen/gestarteten/gestoppten Recorder sind No-ops.
   */
  start(): void;
  /**
   * Meldet einen erfassten Fehler. Ist die Session bereits am Aufzeichnen (regulaer gesampelt
   * oder bereits Error-getriggert), ein No-op. Andernfalls wuerfelt sie `errorSampleRate` und
   * startet bei Erfolg das Recording ab JETZT (siehe bekannte Einschraenkung im Modul-Doc — keine
   * rueckwirkende Aufzeichnung). Kann mehrfach aufgerufen werden, z. B. bei wiederholten Fehlern
   * in einer nie gesampelten Session — jeder Aufruf wuerfelt unabhaengig neu.
   */
  notifyError(): void;
  /** Ob gerade aktiv aufgezeichnet wird (regulaer oder Error-getriggert). */
  isRecording(): boolean;
  /**
   * Sendet den aktuellen Event-Puffer sofort an `endpoint`, unabhaengig vom Intervall-Timer. Wirft
   * nie (Netzwerkfehler/HTTP-Fehlerstatus landen ueber `console.error`, analog {@link
   * createErrorReporter}) — ein fehlgeschlagener Upload darf die aufrufende App nie
   * beeintraechtigen. No-op, wenn der Puffer aktuell leer ist.
   */
  flush(): Promise<void>;
  /** Stoppt `rrweb.record()`, raeumt den Intervall-Timer ab und flusht den verbleibenden Puffer
   * ein letztes Mal. Danach sind {@link start}/{@link notifyError} dauerhaft No-ops — ein
   * gestoppter Recorder wird nicht wiederverwendet, Aufrufer erzeugen fuer eine neue Session eine
   * neue Instanz. */
  stop(): void;
}

const DEFAULT_SAMPLE_RATE = 0.1;
const DEFAULT_ERROR_SAMPLE_RATE = 1;
const DEFAULT_BATCH_INTERVAL_MS = 10_000;
const DEFAULT_BATCH_MAX_EVENTS = 100;

/**
 * Medien-Elemente, die als Default per `blockSelector` geblockt werden — rrweb kennt kein
 * eingebautes "block all media"-Flag, deshalb wird hier explizit auf die von Sentrys
 * `blockAllMedia` abgedeckte Elementmenge gezielt (bewusst ohne `iframe` — anders als reine Medien
 * sind eingebettete Frames oft funktionale Widgets, deren Blockieren ueberraschende
 * Funktionsluecken im Replay erzeugen wuerde, waehrend Sentrys `blockAllMedia` sie ebenfalls
 * ausnimmt).
 */
const DEFAULT_BLOCKED_MEDIA_SELECTOR = "img, image, video, object, embed, map, audio, picture, source";

function isValidRate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Erzeugt eine isolierte Recorder-Instanz mit eigenem, gekapseltem Sampling-/Batching-Zustand
 * (analog zu {@link createErrorReporter}). Wirft sofort (statt spaeter still zu versagen), wenn
 * `options.endpoint` leer oder eine der numerischen Optionen ungueltig ist.
 */
export function createSessionReplayRecorder(options: SessionReplayOptions): SessionReplayRecorder {
  const {
    endpoint,
    sampleRate = DEFAULT_SAMPLE_RATE,
    errorSampleRate = DEFAULT_ERROR_SAMPLE_RATE,
    getCorrelationId,
    batchIntervalMs = DEFAULT_BATCH_INTERVAL_MS,
    batchMaxEvents = DEFAULT_BATCH_MAX_EVENTS,
    dangerouslyDisableDefaultPrivacy = false,
  } = options;

  if (endpoint.trim() === "") {
    throw new Error("createSessionReplayRecorder: `endpoint` ist Pflicht und darf nicht leer sein.");
  }
  if (!isValidRate(sampleRate)) {
    throw new Error(
      `createSessionReplayRecorder: \`sampleRate\` muss zwischen 0 und 1 liegen, erhalten: ${String(sampleRate)}.`,
    );
  }
  if (!isValidRate(errorSampleRate)) {
    throw new Error(
      `createSessionReplayRecorder: \`errorSampleRate\` muss zwischen 0 und 1 liegen, erhalten: ${String(errorSampleRate)}.`,
    );
  }
  if (!Number.isFinite(batchIntervalMs) || batchIntervalMs <= 0) {
    throw new Error(
      `createSessionReplayRecorder: \`batchIntervalMs\` muss positiv und endlich sein, erhalten: ${String(batchIntervalMs)}.`,
    );
  }
  if (!Number.isInteger(batchMaxEvents) || batchMaxEvents <= 0) {
    throw new Error(
      `createSessionReplayRecorder: \`batchMaxEvents\` muss eine positive ganze Zahl sein, erhalten: ${String(batchMaxEvents)}.`,
    );
  }

  const sessionId = crypto.randomUUID();
  let buffer: eventWithTime[] = [];
  let stopRecordingFn: (() => void) | undefined;
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  // undefined = noch nicht entschieden/aufgezeichnet; bleibt danach dauerhaft gesetzt (auch nach
  // stop()) als Metadatum fuer den finalen flush()-Batch.
  let samplingMode: SessionReplaySamplingMode | undefined;
  let stopped = false;

  function handleEmit(event: eventWithTime): void {
    buffer.push(event);
    if (buffer.length >= batchMaxEvents) {
      void flush();
    }
  }

  function beginRecording(mode: SessionReplaySamplingMode): void {
    samplingMode = mode;
    stopRecordingFn = record({
      emit: handleEmit,
      maskAllInputs: !dangerouslyDisableDefaultPrivacy,
      maskTextSelector: dangerouslyDisableDefaultPrivacy ? undefined : "*",
      blockSelector: dangerouslyDisableDefaultPrivacy ? undefined : DEFAULT_BLOCKED_MEDIA_SELECTOR,
    });
    flushTimer = setInterval(() => void flush(), batchIntervalMs);
  }

  function isRecording(): boolean {
    return stopRecordingFn !== undefined;
  }

  function start(): void {
    if (stopped || samplingMode !== undefined) {
      return;
    }
    if (Math.random() < sampleRate) {
      beginRecording("normal");
    }
  }

  function notifyError(): void {
    if (stopped || isRecording()) {
      return;
    }
    if (Math.random() < errorSampleRate) {
      beginRecording("error");
    }
  }

  async function flush(): Promise<void> {
    if (buffer.length === 0) {
      return;
    }
    const events = buffer;
    buffer = [];
    const batch: SessionReplayEventBatch = {
      sessionId,
      // samplingMode ist an dieser Stelle nie undefined: buffer kann nur ueber handleEmit()
      // befuellt werden, und die ist erst nach beginRecording() (setzt samplingMode) als
      // rrweb-emit-Callback aktiv.
      samplingMode: samplingMode as SessionReplaySamplingMode,
      correlationId: getCorrelationId?.(),
      events,
    };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
        // Ein Flush kurz vor einem Seitenwechsel/Unload (z. B. aus stop() in einem
        // Effect-Cleanup) soll den Browser ueberleben statt gecancelt zu werden — analog
        // `errorReporting.ts`.
        keepalive: true,
      });
      if (!response.ok) {
        console.error(
          `specula-client: session-replay batch upload failed (endpoint=${endpoint}): HTTP ${response.status}`,
        );
      }
    } catch (err) {
      console.error(`specula-client: session-replay batch upload failed (endpoint=${endpoint}):`, err);
    }
  }

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    if (flushTimer !== undefined) {
      clearInterval(flushTimer);
      flushTimer = undefined;
    }
    if (stopRecordingFn !== undefined) {
      stopRecordingFn();
      stopRecordingFn = undefined;
    }
    void flush();
  }

  return { sessionId, start, notifyError, isRecording, flush, stop };
}
