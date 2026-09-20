import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { eventWithTime } from "@rrweb/types";

// rrweb.record() instrumentiert echtes DOM (MutationObserver, Canvas, ...) — fuer Batching-/
// Sampling-Unit-Tests wird nur der emit-Callback gebraucht, den `record()` erhaelt. Der Mock
// erfasst die zuletzt uebergebenen Optionen und liefert eine Stop-Spy-Funktion zurueck, damit
// Tests beides pruefen koennen, ohne echtes DOM-Recording anzustossen.
const recordMock = vi.fn();
vi.mock("rrweb", () => ({
  record: (options: Record<string, unknown>) => recordMock(options),
}));

const ENDPOINT = "/session-replay";

function makeEvent(overrides: Partial<eventWithTime> = {}): eventWithTime {
  return { type: 3, data: {}, timestamp: Date.now(), ...overrides } as eventWithTime;
}

/** Emittiert `n` synthetische rrweb-Events ueber den `emit`-Callback, mit dem `record()` zuletzt
 * aufgerufen wurde. */
function emitEvents(n: number): void {
  const { emit } = recordMock.mock.calls[recordMock.mock.calls.length - 1]![0] as {
    emit: (event: eventWithTime) => void;
  };
  for (let i = 0; i < n; i += 1) {
    emit(makeEvent());
  }
}

let stopRecordingSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  stopRecordingSpy = vi.fn();
  recordMock.mockReset();
  recordMock.mockReturnValue(stopRecordingSpy);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Importiert NACH dem vi.mock("rrweb", ...) oben (Hoisting durch Vitest garantiert, dass der Mock
// vor diesem Import-Statement greift).
const { createSessionReplayRecorder } = await import("./sessionReplay.js");

describe("createSessionReplayRecorder — Konstruktions-Validierung", () => {
  it("throws synchronously for an empty endpoint instead of failing silently later", () => {
    expect(() => createSessionReplayRecorder({ endpoint: "" })).toThrow(/endpoint/);
    expect(() => createSessionReplayRecorder({ endpoint: "   " })).toThrow(/endpoint/);
  });

  it("throws for a sampleRate outside [0, 1]", () => {
    expect(() => createSessionReplayRecorder({ endpoint: ENDPOINT, sampleRate: -0.1 })).toThrow(/sampleRate/);
    expect(() => createSessionReplayRecorder({ endpoint: ENDPOINT, sampleRate: 1.1 })).toThrow(/sampleRate/);
    expect(() => createSessionReplayRecorder({ endpoint: ENDPOINT, sampleRate: Number.NaN })).toThrow(/sampleRate/);
  });

  it("throws for an errorSampleRate outside [0, 1]", () => {
    expect(() => createSessionReplayRecorder({ endpoint: ENDPOINT, errorSampleRate: -1 })).toThrow(
      /errorSampleRate/,
    );
    expect(() => createSessionReplayRecorder({ endpoint: ENDPOINT, errorSampleRate: 2 })).toThrow(
      /errorSampleRate/,
    );
  });

  it("throws for a non-positive batchIntervalMs", () => {
    expect(() => createSessionReplayRecorder({ endpoint: ENDPOINT, batchIntervalMs: 0 })).toThrow(
      /batchIntervalMs/,
    );
    expect(() => createSessionReplayRecorder({ endpoint: ENDPOINT, batchIntervalMs: -5 })).toThrow(
      /batchIntervalMs/,
    );
  });

  it("throws for a non-integer or non-positive batchMaxEvents", () => {
    expect(() => createSessionReplayRecorder({ endpoint: ENDPOINT, batchMaxEvents: 0 })).toThrow(/batchMaxEvents/);
    expect(() => createSessionReplayRecorder({ endpoint: ENDPOINT, batchMaxEvents: 1.5 })).toThrow(
      /batchMaxEvents/,
    );
  });

  it("assigns each recorder a stable, unique sessionId", () => {
    const a = createSessionReplayRecorder({ endpoint: ENDPOINT });
    const b = createSessionReplayRecorder({ endpoint: ENDPOINT });

    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("createSessionReplayRecorder — DSGVO-Defaults", () => {
  it("passes maskAllInputs/maskTextSelector/blockSelector defaults to rrweb.record", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // < jeder sampleRate > 0 -> sofort gesampelt
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT });

    recorder.start();

    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maskAllInputs: true,
        maskTextSelector: "*",
        blockSelector: expect.stringContaining("img"),
      }),
    );
  });

  it("only disables masking/blocking via the explicit dangerouslyDisableDefaultPrivacy opt-out", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({
      endpoint: ENDPOINT,
      dangerouslyDisableDefaultPrivacy: true,
    });

    recorder.start();

    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maskAllInputs: false,
        maskTextSelector: undefined,
        blockSelector: undefined,
      }),
    );
  });
});

describe("createSessionReplayRecorder — Sampling", () => {
  it("starts recording immediately when the sampleRate roll succeeds", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, sampleRate: 0.1 });

    recorder.start();

    expect(recorder.isRecording()).toBe(true);
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it("does not start recording when the sampleRate roll fails", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, sampleRate: 0.1 });

    recorder.start();

    expect(recorder.isRecording()).toBe(false);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("is idempotent: a second start() call does not roll or record again", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT });

    recorder.start();
    recorder.start();

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(randomSpy).toHaveBeenCalledTimes(1);
  });

  it("upgrades an unsampled session to recording at errorSampleRate via notifyError", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, sampleRate: 0.1, errorSampleRate: 1 });

    recorder.start();
    expect(recorder.isRecording()).toBe(false);

    recorder.notifyError();

    expect(recorder.isRecording()).toBe(true);
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it("does not upgrade when the errorSampleRate roll fails", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0.99);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, sampleRate: 0.1, errorSampleRate: 0.1 });

    recorder.start();
    recorder.notifyError();

    expect(recorder.isRecording()).toBe(false);
  });

  it("notifyError is a no-op once a session is already recording (normal sampling)", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT });

    recorder.start();
    recorder.notifyError();

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(randomSpy).toHaveBeenCalledTimes(1); // notifyError() hat nicht erneut gewuerfelt
  });

  it("re-rolls errorSampleRate on each notifyError call until it succeeds", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.99) // start(): nicht regulaer gesampelt
      .mockReturnValueOnce(0.99) // 1. notifyError(): Fehlschlag
      .mockReturnValueOnce(0.99) // 2. notifyError(): Fehlschlag
      .mockReturnValueOnce(0); // 3. notifyError(): Erfolg
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, sampleRate: 0.1, errorSampleRate: 0.1 });

    recorder.start();
    recorder.notifyError();
    recorder.notifyError();
    expect(recorder.isRecording()).toBe(false);

    recorder.notifyError();

    expect(recorder.isRecording()).toBe(true);
  });
});

describe("createSessionReplayRecorder — Batching", () => {
  it("does not upload anything before the batch interval elapses or the max size is hit", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, batchIntervalMs: 5000, batchMaxEvents: 50 });

    recorder.start();
    emitEvents(3);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("flushes automatically once batchIntervalMs elapses", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, batchIntervalMs: 5000, batchMaxEvents: 50 });

    recorder.start();
    emitEvents(3);
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(call[0]).toBe(ENDPOINT);
    const body = JSON.parse((call[1] as RequestInit).body as string) as { events: unknown[] };
    expect(body.events).toHaveLength(3);
  });

  it("flushes immediately once batchMaxEvents is reached, without waiting for the timer", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, batchIntervalMs: 60_000, batchMaxEvents: 5 });

    recorder.start();
    emitEvents(5);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh buffer after each flush instead of re-sending already-flushed events", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, batchIntervalMs: 1000, batchMaxEvents: 50 });

    recorder.start();
    emitEvents(2);
    await vi.advanceTimersByTimeAsync(1000);
    emitEvents(1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetch).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string,
    ) as { events: unknown[] };
    expect(secondBody.events).toHaveLength(1);
  });

  it("includes sessionId, samplingMode and correlationId in every batch", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({
      endpoint: ENDPOINT,
      batchIntervalMs: 1000,
      getCorrelationId: () => "trace-abc-123",
    });

    recorder.start();
    emitEvents(1);
    await vi.advanceTimersByTimeAsync(1000);

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.sessionId).toBe(recorder.sessionId);
    expect(body.samplingMode).toBe("normal");
    expect(body.correlationId).toBe("trace-abc-123");
  });

  it("omits correlationId when no getCorrelationId callback was provided", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, batchIntervalMs: 1000 });

    recorder.start();
    emitEvents(1);
    await vi.advanceTimersByTimeAsync(1000);

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.correlationId).toBeUndefined();
  });

  it("does not upload when flush() is called with an empty buffer", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT });

    recorder.start();
    await recorder.flush();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("flush() swallows network errors instead of throwing", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT });

    recorder.start();
    emitEvents(1);

    await expect(recorder.flush()).resolves.toBeUndefined();
  });

  it("logs to the console when the backend rejects a batch upload", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 413 } as Response);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT });

    recorder.start();
    emitEvents(1);
    await recorder.flush();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("413"));
  });
});

describe("createSessionReplayRecorder — stop", () => {
  it("stops rrweb recording and clears the interval timer", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT });

    recorder.start();
    recorder.stop();

    expect(stopRecordingSpy).toHaveBeenCalledTimes(1);
    expect(recorder.isRecording()).toBe(false);
  });

  it("flushes any buffered events one last time on stop", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, batchIntervalMs: 60_000 });

    recorder.start();
    emitEvents(2);
    recorder.stop();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("does not upload again once the interval timer would have fired after stop()", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, batchIntervalMs: 1000 });

    recorder.start();
    emitEvents(1);
    recorder.stop();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("start() and notifyError() are permanent no-ops after stop()", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // start() waere ungesampelt
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT, errorSampleRate: 1 });

    recorder.start();
    recorder.stop();
    recorder.notifyError();
    recorder.start();

    expect(recorder.isRecording()).toBe(false);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("is idempotent: a second stop() call does not stop recording or flush again", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recorder = createSessionReplayRecorder({ endpoint: ENDPOINT });

    recorder.start();
    emitEvents(1);
    recorder.stop();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    recorder.stop();

    expect(stopRecordingSpy).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
