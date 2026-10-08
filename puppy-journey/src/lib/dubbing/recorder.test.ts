import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canSaveRecording,
  chooseRecordingMimeType,
  hasUnsavedRecording,
  RECORDING_LIMIT_BYTES,
  RECORDING_LIMIT_MS,
  recordingErrorMessage,
  RoleRecordingController,
  type RecorderEnvironment,
  type RecordingUpload,
} from "./recorder";

class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = "live";
  stop = vi.fn(() => { this.readyState = "ended"; });
}

class FakeRecorder {
  state: RecordingState = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  finalData = new Blob(["final-audio"]);
  emitStop = true;
  start = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => {
    this.state = "inactive";
    if (this.emitStop) setTimeout(() => {
      this.ondataavailable?.({ data: this.finalData });
      this.onstop?.();
    }, 10);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const recorder = new FakeRecorder();
  const environment = {
    requestMicrophone: vi.fn(async () => stream),
    supportedMimeType: vi.fn(() => "audio/webm;codecs=opus" as string | null),
    createRecorder: vi.fn(() => recorder as unknown as MediaRecorder),
    createObjectURL: vi.fn(() => "blob:local-recording"),
    revokeObjectURL: vi.fn(),
    now: () => Date.now(),
  } satisfies RecorderEnvironment;
  const controller = new RoleRecordingController(environment);
  const start = async () => {
    await controller.start();
    vi.advanceTimersByTime(3000);
  };
  const preview = async () => {
    await start();
    vi.advanceTimersByTime(1200);
    controller.stop();
    vi.advanceTimersByTime(10);
  };
  return { track, stream, recorder, environment, controller, start, preview };
}

describe("recording format and error handling", () => {
  it("chooses an actually supported format, falling back from Opus to AAC", () => {
    expect(chooseRecordingMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
    expect(chooseRecordingMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(chooseRecordingMimeType(() => false)).toBeNull();
    expect(chooseRecordingMimeType((type) => {
      if (type.includes("codecs")) throw new Error("unsupported");
      return type === "audio/mp4";
    })).toBe("audio/mp4");
  });

  it.each([
    ["NotAllowedError", "权限"], ["SecurityError", "权限"],
    ["NotFoundError", "没有找到"], ["OverconstrainedError", "没有找到"],
    ["NotReadableError", "暂时无法使用"], ["AbortError", "暂时无法使用"],
  ])("explains %s without leaking device details", (name, expected) => {
    expect(recordingErrorMessage({ name, message: "private-device-name" })).toContain(expected);
    expect(recordingErrorMessage({ name, message: "private-device-name" })).not.toContain("private-device-name");
  });
});

describe("RoleRecordingController lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("requests nothing until start and counts down before capturing", async () => {
    const { controller, environment, recorder } = setup();
    expect(environment.requestMicrophone).not.toHaveBeenCalled();
    const pauseDemonstration = vi.fn();
    await controller.start(pauseDemonstration);
    expect(controller.getSnapshot().phase).toBe("countdown");
    expect(pauseDemonstration).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2900);
    expect(recorder.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(recorder.start).toHaveBeenCalledWith(250);
    expect(controller.getSnapshot().phase).toBe("recording");
    controller.dispose();
  });

  it("does not ask for a microphone when no recording format is supported", async () => {
    const { controller, environment } = setup();
    environment.supportedMimeType.mockReturnValue(null);
    await controller.start();
    expect(environment.requestMicrophone).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ phase: "error" });
  });

  it("deduplicates clicks while permission is pending and stops a late granted stream after cancel", async () => {
    const { controller, environment, stream, track } = setup();
    const permission = deferred<MediaStream>();
    environment.requestMicrophone.mockReturnValue(permission.promise);
    const starting = controller.start();
    await controller.start();
    expect(environment.requestMicrophone).toHaveBeenCalledOnce();
    controller.discard();
    permission.resolve(stream);
    await starting;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(environment.createRecorder).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe("idle");
  });

  it("does not resurrect a microphone request after unmount", async () => {
    const { controller, environment, stream, track } = setup();
    const permission = deferred<MediaStream>();
    environment.requestMicrophone.mockReturnValue(permission.promise);
    const starting = controller.start();
    controller.dispose();
    permission.resolve(stream);
    await starting;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(environment.createRecorder).not.toHaveBeenCalled();
  });

  it("times out unanswered permission without keeping a late stream alive", async () => {
    const { controller, environment, stream, track } = setup();
    const permission = deferred<MediaStream>();
    environment.requestMicrophone.mockReturnValue(permission.promise);
    const starting = controller.start();
    vi.advanceTimersByTime(30_000);
    expect(controller.getSnapshot().error).toContain("超时");
    permission.resolve(stream);
    await starting;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().phase).toBe("error");
  });

  it("shows denied permission without starting a recorder", async () => {
    const { controller, environment } = setup();
    environment.requestMicrophone.mockRejectedValue({ name: "NotAllowedError" });
    await controller.start();
    expect(controller.getSnapshot().error).toContain("权限");
    expect(environment.createRecorder).not.toHaveBeenCalled();
  });

  it("waits for final data and stop before offering a local preview", async () => {
    const { controller, recorder, track, start } = setup();
    await start();
    recorder.ondataavailable?.({ data: new Blob(["first-part"]) });
    vi.advanceTimersByTime(1000);
    controller.stop();
    const upload = vi.fn();
    await controller.save(upload);
    expect(upload).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe("stopping");
    vi.advanceTimersByTime(10);
    expect(await controller.getSnapshot().blob?.text()).toBe("first-partfinal-audio");
    expect(canSaveRecording(controller.getSnapshot())).toBe(true);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(hasUnsavedRecording(controller.getSnapshot())).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it("blocks upload after a ten-second safety stop", async () => {
    const { controller, start } = setup();
    await start();
    vi.advanceTimersByTime(RECORDING_LIMIT_MS + 10);
    expect(controller.getSnapshot()).toMatchObject({ phase: "preview", stoppedByLimit: true });
    const upload = vi.fn();
    await controller.save(upload);
    expect(upload).not.toHaveBeenCalled();
    expect(canSaveRecording(controller.getSnapshot())).toBe(false);
  });

  it("also marks a late manual stop incomplete if the timer was delayed", async () => {
    const { controller, environment, start } = setup();
    await start();
    environment.now = () => Date.now() + RECORDING_LIMIT_MS;
    controller.stop();
    vi.advanceTimersByTime(10);
    expect(controller.getSnapshot().stoppedByLimit).toBe(true);
  });

  it.each(["requesting_permission", "countdown", "recording", "stopping"])("blocks saving when interrupted during %s", async (phase) => {
    const { controller, environment, stream } = setup();
    const permission = deferred<MediaStream>();
    environment.requestMicrophone.mockReturnValue(permission.promise);
    const starting = controller.start();
    if (phase !== "requesting_permission") {
      permission.resolve(stream);
      await starting;
    }
    if (phase === "recording" || phase === "stopping") vi.advanceTimersByTime(3000);
    if (phase === "stopping") controller.stop();
    controller.interrupt();
    if (phase === "requesting_permission") {
      permission.resolve(stream);
      await starting;
    }
    vi.advanceTimersByTime(10);
    const upload = vi.fn();
    await controller.save(upload);
    expect(controller.getSnapshot().interrupted).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it("marks disconnected microphones interrupted, not saved", async () => {
    const { controller, track, start } = setup();
    await start();
    track.dispatchEvent(new Event("ended"));
    vi.advanceTimersByTime(10);
    expect(controller.getSnapshot()).toMatchObject({ phase: "preview", interrupted: true });
    expect(canSaveRecording(controller.getSnapshot())).toBe(false);
  });

  it("rejects unexpectedly stopped, empty, and oversized recordings", async () => {
    const unexpected = setup();
    await unexpected.start();
    unexpected.recorder.stop();
    vi.advanceTimersByTime(10);
    expect(canSaveRecording(unexpected.controller.getSnapshot())).toBe(false);

    const empty = setup();
    empty.recorder.finalData = new Blob([]);
    await empty.preview();
    expect(empty.controller.getSnapshot().phase).toBe("error");

    const large = setup();
    await large.start();
    large.recorder.ondataavailable?.({ data: new Blob([new Uint8Array(RECORDING_LIMIT_BYTES + 1)]) });
    vi.advanceTimersByTime(10);
    expect(canSaveRecording(large.controller.getSnapshot())).toBe(false);
    expect(large.controller.getSnapshot().error).toContain("大小上限");
  });

  it("releases the microphone if a stop event never arrives", async () => {
    const { controller, recorder, track, start } = setup();
    await start();
    recorder.emitStop = false;
    controller.stop();
    vi.advanceTimersByTime(2000);
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", interrupted: true });
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("keeps the browser's actual MIME type for server validation", async () => {
    const { controller, recorder, preview } = setup();
    recorder.mimeType = "audio/mp4";
    await preview();
    expect(controller.getSnapshot().mimeType).toBe("audio/mp4");
    expect(controller.getSnapshot().blob?.type).toBe("audio/mp4");
  });

  it("preserves a failed upload for retry, without creating another microphone session", async () => {
    const { controller, environment, preview } = setup();
    await preview();
    const blob = controller.getSnapshot().blob;
    const upload = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined);
    await controller.save(upload);
    expect(controller.getSnapshot()).toMatchObject({ phase: "preview", blob });
    await controller.save(upload);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().phase).toBe("uploaded");
    expect(hasUnsavedRecording(controller.getSnapshot())).toBe(false);
    expect(environment.requestMicrophone).toHaveBeenCalledOnce();
  });

  it("deduplicates save and aborts an outstanding upload when closed", async () => {
    const { controller, preview } = setup();
    await preview();
    const response = deferred<void>();
    let uploadSignal: AbortSignal | undefined;
    const upload = vi.fn((value: RecordingUpload) => { uploadSignal = value.signal; return response.promise; });
    const saving = controller.save(upload);
    await controller.save(upload);
    expect(upload).toHaveBeenCalledOnce();
    controller.dispose();
    expect(uploadSignal?.aborted).toBe(true);
    response.resolve();
    await saving;
    expect(controller.getSnapshot().phase).toBe("idle");
  });

  it("revokes previews on rerecord and disposal, and allows strict-mode reactivation", async () => {
    const { controller, environment, preview, track } = setup();
    await preview();
    controller.discard();
    expect(environment.revokeObjectURL).toHaveBeenCalledWith("blob:local-recording");
    controller.dispose();
    controller.activate();
    track.readyState = "live";
    await preview();
    controller.dispose();
    expect(environment.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
