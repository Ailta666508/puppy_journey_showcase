import type { DogSpeakerKey, DubbingPlan, DubbingTimeline } from "@/lib/dubbing/contracts";
import type { DubbingRenderManifest, RenderChoice } from "@/lib/dubbing/renderPlan";

export type StudioTake = {
  id: string;
  ownerId: string;
  lineId: string;
  status: "pending" | "validating" | "ready" | "needs_trim" | "failed" | "revoked";
  durationMs?: number;
  audioUrl?: string;
  errorCode?: string;
};
export type StudioRender = {
  id: string;
  status: "awaiting_consent" | "queued" | "running" | "completed" | "failed" | "cancelled" | "revoked";
  mode: "solo" | "duet";
  manifestDigest: string;
  manifest?: DubbingRenderManifest;
  requiredConsentIds: string[];
  consentedBy: string[];
  videoUrl?: string;
  downloadUrl?: string;
  subtitleUrl?: string;
  errorCode?: string;
};
export type StudioSnapshot = {
  ok: true;
  capabilities: { enabled: boolean; ttsMode: "disabled" | "mock" | "doubao" };
  myRole: DogSpeakerKey;
  userId: string;
  plan: DubbingPlan;
  guide: null | {
    id: string;
    createdBy?: string;
    status: "queued" | "running" | "awaiting_confirmation" | "ready" | "failed" | "revoked";
    errorCode?: string;
    synthetic?: boolean;
    timeline?: DubbingTimeline;
    timelineDigest?: string;
    durationConfirmed?: boolean;
    videoUrl?: string;
    subtitleUrl?: string;
    lineAudioUrls?: Record<string, string>;
  };
  session: null | { id: string };
  takes: StudioTake[];
  partnerProgress: { ready: number; total: number };
  mySubmission: null | { revision: number; choices: Record<string, RenderChoice>; shared?: boolean };
  renders: StudioRender[];
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseStudioSnapshot(value: unknown): StudioSnapshot {
  if (!record(value) || value.ok !== true || !record(value.capabilities) || typeof value.capabilities.enabled !== "boolean" ||
      !["disabled", "mock", "doubao"].includes(String(value.capabilities.ttsMode)) || typeof value.userId !== "string" || !value.userId ||
      (value.myRole !== "yellow_dog" && value.myRole !== "white_dog") || !record(value.plan) ||
      value.plan.planVersion !== 1 || value.plan.locale !== "es-ES" || typeof value.plan.scriptDigest !== "string" ||
      !Array.isArray(value.plan.lines) || !value.plan.lines.length ||
      !value.plan.lines.every((line: unknown) => record(line) && typeof line.lineId === "string" &&
        typeof line.text === "string" && typeof line.speakerKey === "string" && typeof line.dubbable === "boolean" &&
        (line.translation === undefined || typeof line.translation === "string")) ||
      !Array.isArray(value.takes) || !value.takes.every((take: unknown) => record(take) && typeof take.id === "string" && typeof take.ownerId === "string" && typeof take.lineId === "string" &&
        ["pending", "validating", "ready", "needs_trim", "failed", "revoked"].includes(String(take.status))) ||
      !Array.isArray(value.renders) || !value.renders.every((render: unknown) => record(render) && typeof render.id === "string" && typeof render.manifestDigest === "string" &&
        (render.mode === "solo" || render.mode === "duet") &&
        ["awaiting_consent", "queued", "running", "completed", "failed", "cancelled", "revoked"].includes(String(render.status)) &&
        Array.isArray(render.requiredConsentIds) && Array.isArray(render.consentedBy)) ||
      !record(value.partnerProgress) || !Number.isSafeInteger(value.partnerProgress.ready) || !Number.isSafeInteger(value.partnerProgress.total) ||
      !(value.guide === null || (record(value.guide) && typeof value.guide.id === "string" &&
        ["queued", "running", "awaiting_confirmation", "ready", "failed", "revoked"].includes(String(value.guide.status)))) ||
      !(value.session === null || (record(value.session) && typeof value.session.id === "string")) ||
      !(value.mySubmission === null || (record(value.mySubmission) && Number.isSafeInteger(value.mySubmission.revision) && record(value.mySubmission.choices)))) {
    throw new Error("配音状态格式不完整，请重新读取。");
  }
  return value as StudioSnapshot;
}

export function studioHasPendingWork(snapshot: StudioSnapshot): boolean {
  return Boolean(snapshot.guide && ["queued", "running"].includes(snapshot.guide.status)) ||
    snapshot.takes.some((take) => take.status === "pending" || take.status === "validating") ||
    snapshot.renders.some((render) => ["awaiting_consent", "queued", "running"].includes(render.status)) ||
    Boolean(snapshot.mySubmission?.shared && snapshot.partnerProgress.total > snapshot.partnerProgress.ready);
}

export function choicesAreReady(snapshot: StudioSnapshot, choices: Record<string, RenderChoice>): boolean {
  const lines = snapshot.plan.lines.filter((line) => line.dubbable && line.speakerKey === snapshot.myRole);
  if (!lines.length || Object.keys(choices).length !== lines.length) return false;
  return lines.every((line) => {
    const choice = choices[line.lineId];
    if (choice?.kind === "ai") return true;
    return choice?.kind === "take" && snapshot.takes.some((take) => take.id === choice.takeId && take.ownerId === snapshot.userId && take.lineId === line.lineId && take.status === "ready");
  });
}

export function safeStudioMediaUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.startsWith("//")) return undefined;
  if (value.startsWith("/") && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return value;
  } catch { /* A missing or invalid URL must not create a media request. */ }
  return undefined;
}

export function dubbingFailureLabel(errorCode?: string): string {
  const messages: Record<string, string> = {
    TTS_NOT_CONFIGURED: "语音服务尚未配置，请联系空间维护者。",
    SOURCE_UNAVAILABLE: "原视频暂时无法读取，请检查原排练后重试。",
    DURATION_OVERFLOW: "台词超过画面可用时长，请缩短剧本后重新创建排练。",
    SILENT_AUDIO: "这句录音没有检测到清楚的声音，请检查麦克风后重录。",
    INVALID_AUDIO: "录音文件未通过校验，请重新录制。",
    TAKE_TOO_LONG: "录音超过安全时长，请缩短后重录。",
    ACCESS_REVOKED: "会话或声音授权已撤回，不能继续使用。",
    WORKER_UNAVAILABLE: "后台媒体服务暂时不可用，已保存的录音不会因此重录。",
    TTS_DELIVERY_UNKNOWN: "语音请求结果不明，可能已产生费用。请先核对服务方记录，确认后再由维护者处理，不自动重发。",
    TTS_DISABLED: "语音服务尚未启用，请先完成服务配置。",
    TTS_CREDENTIALS_MISSING: "语音服务尚未配置，请联系空间维护者。",
    TTS_SPANISH_VOICE_NOT_CONFIGURED: "还没有配置经过验证的西语音色，暂时不能生成学习示范。",
    TTS_PROVIDER_REJECTED: "语音服务没有接受本次请求，请核对服务权限和台词配置。",
    TTS_LINE_TOO_LONG: "示范台词太长，请缩短剧本后重新创建排练。",
    DUBBING_SOURCE_UNAVAILABLE: "原视频暂时无法读取，请检查原排练后重试。",
    DUBBING_SOURCE_INVALID: "原视频未通过格式或时长检查，请重新生成原排练。",
    DUBBING_TIMELINE_OVERFLOW: "完整台词超过可用画面时长，不能开始录音，请缩短剧本后重新创建排练。",
    RECORDING_SILENT: "录音没有检测到清楚的声音，请检查麦克风后重录。",
    RECORDING_DURATION_INVALID: "录音过短或超过 10 秒，请重新录制完整的一句。",
    RECORDING_EXCEEDS_WINDOW: "录音超过本句窗口，请裁去首尾空白或重录，不能直接合成。",
    INVALID_TRIM_RANGE: "裁剪时间不正确，请重新试听并选择有效的首尾范围。",
    AUDIO_ONLY_REQUIRED: "需要纯音频录音，不能包含视频画面。",
    INVALID_MEDIA: "录音文件无法解码，请重新录制。",
    INVALID_MEDIA_SIZE: "媒体文件为空或超过大小上限，请检查后重试。",
    DUBBING_TAKE_REVOKED: "这条声音已撤回，不能继续用于合成。",
    DUBBING_RENDER_REVOKED: "这份成片已取消或撤回。",
    DUBBING_MEMBERSHIP_CHANGED: "空间成员或角色已经变化，请建立新的配音会话。",
    DUBBING_MANIFEST_CHANGED: "成片清单已改变，请重新创建清单并确认。",
    DUBBING_ASSET_DOWNLOAD_FAILED: "后台暂时无法读取媒体文件，已保存的录音会保留。",
    DUBBING_ASSET_UPLOAD_FAILED: "媒体保存未完成，请稍后重试处理。",
    MEDIA_PROCESSING_FAILED: "后台媒体处理失败，已保存的声音会保留，可稍后重试。",
  };
  return (errorCode && Object.hasOwn(messages, errorCode) && messages[errorCode]) || "处理未完成。已保存的其他素材会保留，请检查状态或联系维护者。";
}

/** SPA navigation must respect the recorder guard; beforeunload does not run here. */
export function runGuardedNavigation(guard: (() => boolean) | null, navigate: () => void): boolean {
  if (guard?.() === false) return false;
  navigate();
  return true;
}
