export const RECORDING_LIMIT_MS = 10_000;
export const RECORDING_LIMIT_BYTES = 3 * 1024 * 1024;
const PERMISSION_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 2_000;

export const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm",
] as const;

export function chooseRecordingMimeType(isSupported: (type: string) => boolean): string | null {
  for (const type of RECORDING_MIME_TYPES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      // Some browsers throw for an unsupported codec instead of returning false.
    }
  }
  return null;
}

export function recordingErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? error.name : null;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "没有获得麦克风权限。请在浏览器中允许麦克风后重试。";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "没有找到可用的麦克风，请连接设备后重试。";
  if (name === "NotReadableError" || name === "AbortError") return "麦克风暂时无法使用，可能被其他应用占用。请检查设备后重试。";
  return "录音未能完成，请检查麦克风后重试。";
}

export type RecordingPhase =
  | "idle" | "requesting_permission" | "countdown" | "recording" | "stopping"
  | "preview" | "uploading" | "uploaded" | "error";

export interface RecordingSnapshot {
  phase: RecordingPhase;
  countdown: number;
  elapsedMs: number;
  previewUrl: string | null;
  blob: Blob | null;
  mimeType: string;
  stoppedByLimit: boolean;
  interrupted: boolean;
  error: string | null;
}

export interface RecordingUpload {
  blob: Blob;
  mimeType: string;
  stoppedByLimit: boolean;
  signal?: AbortSignal;
}

export interface RecorderEnvironment {
  requestMicrophone: () => Promise<MediaStream>;
  supportedMimeType: () => string | null;
  createRecorder: (stream: MediaStream, mimeType: string) => MediaRecorder;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  now: () => number;
}

export function browserRecorderEnvironment(): RecorderEnvironment {
  return {
    requestMicrophone: () => {
      if (!globalThis.isSecureContext || !globalThis.navigator?.mediaDevices?.getUserMedia) {
        return Promise.reject({ name: "SecurityError" });
      }
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    },
    supportedMimeType: () => typeof MediaRecorder === "undefined"
      ? null : chooseRecordingMimeType((type) => MediaRecorder.isTypeSupported(type)),
    createRecorder: (stream, mimeType) => new MediaRecorder(stream, { mimeType }),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    now: () => performance.now(),
  };
}

const emptySnapshot = (): RecordingSnapshot => ({
  phase: "idle", countdown: 3, elapsedMs: 0, previewUrl: null, blob: null,
  mimeType: "", stoppedByLimit: false, interrupted: false, error: null,
});

export function canSaveRecording(snapshot: RecordingSnapshot): boolean {
  return snapshot.phase === "preview" && Boolean(snapshot.blob?.size) &&
    !snapshot.stoppedByLimit && !snapshot.interrupted;
}

export function hasUnsavedRecording(snapshot: RecordingSnapshot): boolean {
  return snapshot.phase === "recording" || snapshot.phase === "stopping" ||
    snapshot.phase === "uploading" || (snapshot.phase === "preview" && Boolean(snapshot.blob));
}

/** Owns one local recording; no network call occurs until save is explicitly requested. */
export class RoleRecordingController {
  private snapshot = emptySnapshot();
  private listeners = new Set<() => void>();
  private generation = 0;
  private active = true;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private startedAt = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private uploadController: AbortController | null = null;
  private trackEnded = () => this.interrupt("麦克风已断开，本次录音中断，请重录。");

  constructor(private readonly environment: RecorderEnvironment = browserRecorderEnvironment()) {}

  getSnapshot = (): RecordingSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // React Strict Mode can mount, clean up, then mount the same controller again.
  activate(): void { this.active = true; }

  private publish(update: Partial<RecordingSnapshot>): void {
    if (!this.active) return;
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach((listener) => listener());
  }

  private clearTimers(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    if (this.tick !== null) clearInterval(this.tick);
    this.timeout = null;
    this.tick = null;
  }

  private releaseMicrophone(): void {
    this.stream?.getTracks().forEach((track) => {
      track.removeEventListener("ended", this.trackEnded);
      track.stop();
    });
    this.stream = null;
  }

  private releasePreview(): void {
    if (this.snapshot.previewUrl) this.environment.revokeObjectURL(this.snapshot.previewUrl);
  }

  private detachRecorder(): void {
    if (!this.recorder) return;
    this.recorder.ondataavailable = null;
    this.recorder.onstop = null;
    this.recorder.onerror = null;
    if (this.recorder.state !== "inactive") {
      try { this.recorder.stop(); } catch { /* Already stopped by the device. */ }
    }
    this.recorder = null;
  }

  discard(): void {
    this.generation += 1;
    this.clearTimers();
    this.uploadController?.abort();
    this.uploadController = null;
    this.detachRecorder();
    this.releaseMicrophone();
    this.releasePreview();
    this.chunks = [];
    this.bytes = 0;
    this.publish(emptySnapshot());
  }

  dispose(): void {
    this.discard();
    this.active = false;
    this.listeners.clear();
  }

  async start(onRecordStart?: () => void): Promise<void> {
    if (!this.active || ["requesting_permission", "countdown", "recording", "stopping", "uploading"].includes(this.snapshot.phase)) return;
    this.discard();
    const generation = this.generation;
    const mimeType = this.environment.supportedMimeType();
    if (!mimeType) {
      this.publish({ phase: "error", error: "当前浏览器不支持可用的录音格式，请使用新版 Chrome 或 Safari。" });
      return;
    }
    this.publish({ phase: "requesting_permission", mimeType });
    this.timeout = setTimeout(() => {
      if (generation !== this.generation) return;
      this.generation += 1;
      this.publish({ phase: "error", error: "等待麦克风授权超时。请确认浏览器提示后重新开始。" });
    }, PERMISSION_TIMEOUT_MS);
    try {
      const stream = await this.environment.requestMicrophone();
      if (!this.active || generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.clearTimers();
      this.stream = stream;
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0 || audioTracks.every((track) => track.readyState === "ended")) {
        throw { name: "NotFoundError" };
      }
      stream.getTracks().forEach((track) => track.addEventListener("ended", this.trackEnded));
      const recorder = this.environment.createRecorder(stream, mimeType);
      this.recorder = recorder;
      recorder.ondataavailable = (event: BlobEvent) => {
        if (generation !== this.generation || !this.active || event.data.size === 0) return;
        this.bytes += event.data.size;
        if (this.bytes > RECORDING_LIMIT_BYTES) {
          this.interrupt("录音文件超过大小上限，请缩短这句后重录。");
          return;
        }
        this.chunks.push(event.data);
      };
      recorder.onerror = () => this.interrupt("录音设备发生错误，本次录音不能保存，请重录。");
      recorder.onstop = () => {
        if (!this.active || generation !== this.generation) return;
        const wasExpected = this.snapshot.phase === "stopping";
        this.clearTimers();
        this.releaseMicrophone();
        this.recorder = null;
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        const actualMimeType = recorder.mimeType || mimeType;
        const blob = new Blob(this.chunks, { type: actualMimeType });
        this.chunks = [];
        if (blob.size === 0) {
          this.publish({ phase: "error", interrupted: true, error: this.snapshot.error ?? "没有录到可播放的声音，请重录。" });
          return;
        }
        this.publish({
          phase: "preview", blob, mimeType: actualMimeType,
          previewUrl: this.environment.createObjectURL(blob),
          interrupted: this.snapshot.interrupted || !wasExpected,
          error: !wasExpected ? "录音意外结束，请重录。" : this.snapshot.error,
        });
      };
      onRecordStart?.();
      this.publish({ phase: "countdown", countdown: 3 });
      const countdownAt = this.environment.now();
      this.tick = setInterval(() => {
        if (generation !== this.generation || !this.active) return;
        const remaining = Math.max(0, 3 - Math.floor((this.environment.now() - countdownAt) / 1000));
        this.publish({ countdown: remaining });
        if (remaining === 0) this.beginRecording(generation);
      }, 100);
    } catch (error) {
      if (generation !== this.generation || !this.active) return;
      this.clearTimers();
      this.detachRecorder();
      this.releaseMicrophone();
      this.publish({ phase: "error", error: recordingErrorMessage(error) });
    }
  }

  private beginRecording(generation: number): void {
    this.clearTimers();
    try {
      this.startedAt = this.environment.now();
      this.recorder?.start(250);
      this.publish({ phase: "recording", elapsedMs: 0 });
      this.tick = setInterval(() => {
        if (generation !== this.generation) return;
        const elapsedMs = this.environment.now() - this.startedAt;
        this.publish({ elapsedMs });
        if (elapsedMs >= RECORDING_LIMIT_MS) this.stop(true);
      }, 100);
      this.timeout = setTimeout(() => this.stop(true), RECORDING_LIMIT_MS);
    } catch (error) {
      this.detachRecorder();
      this.releaseMicrophone();
      this.publish({ phase: "error", error: recordingErrorMessage(error) });
    }
  }

  stop(stoppedByLimit = false): void {
    if (this.snapshot.phase !== "recording") return;
    const elapsedMs = Math.max(0, this.environment.now() - this.startedAt);
    this.clearTimers();
    this.publish({ phase: "stopping", elapsedMs, stoppedByLimit: stoppedByLimit || elapsedMs >= RECORDING_LIMIT_MS });
    this.timeout = setTimeout(() => {
      this.generation += 1;
      this.detachRecorder();
      this.releaseMicrophone();
      this.publish({ phase: "error", interrupted: true, error: "录音文件未能完整结束，请重录。" });
    }, STOP_TIMEOUT_MS);
    try {
      if (!this.recorder || this.recorder.state === "inactive") throw new Error("inactive");
      this.recorder.stop();
    } catch {
      this.clearTimers();
      this.detachRecorder();
      this.releaseMicrophone();
      this.publish({ phase: "error", interrupted: true, error: "录音未能完整结束，请重录。" });
    }
  }

  interrupt(message = "页面已离开前台，本次录音中断，请重录。"): void {
    if (["requesting_permission", "countdown"].includes(this.snapshot.phase)) {
      this.discard();
      this.publish({ phase: "error", interrupted: true, error: message });
    } else if (this.snapshot.phase === "recording") {
      this.publish({ interrupted: true, error: message });
      this.stop();
    } else if (this.snapshot.phase === "stopping") {
      this.publish({ interrupted: true, error: message });
    }
  }

  async save(onSave: (upload: RecordingUpload) => Promise<void>): Promise<void> {
    if (!canSaveRecording(this.snapshot) || !this.snapshot.blob || !this.active) return;
    const generation = this.generation;
    const { blob, mimeType, stoppedByLimit } = this.snapshot;
    const uploadController = new AbortController();
    this.uploadController = uploadController;
    this.publish({ phase: "uploading", error: null });
    try {
      await onSave({ blob, mimeType, stoppedByLimit, signal: uploadController.signal });
      if (generation !== this.generation || !this.active || uploadController.signal.aborted) return;
      this.publish({ phase: "uploaded" });
    } catch {
      if (generation !== this.generation || !this.active || uploadController.signal.aborted) return;
      this.publish({ phase: "preview", error: "保存未完成，本机录音仍在。请重试；刷新或关闭页面后未保存录音会丢失。" });
    } finally {
      if (this.uploadController === uploadController) this.uploadController = null;
    }
  }
}
