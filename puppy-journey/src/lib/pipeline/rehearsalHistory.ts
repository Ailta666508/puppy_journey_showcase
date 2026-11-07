import {
  REHEARSAL_STAGES,
  type LessonScript,
  type PipelineJobStatus,
  type RehearsalRunState,
  type RehearsalStage,
} from "./types";

export type RehearsalHistoryRun = {
  id: string;
  authorId?: string | null;
  status: PipelineJobStatus;
  userText: string;
  script: LessonScript | null;
  runState: RehearsalRunState | null;
  keyImageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  providerTaskId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RetryableRehearsalStage = "image" | "video";

export type RehearsalProgressSummary = {
  completedStages: number;
  totalStages: number;
  percent: number;
  label: string;
  activeStage: RehearsalStage | null;
  activeAttempt: number | null;
  retryable: boolean;
};

export type RehearsalFailureSummary = {
  stage: RehearsalStage | null;
  label: string;
  attempt: number | null;
  message: string;
};

export type RehearsalStageTimelineEntry = {
  stage: RehearsalStage | null;
  label: string;
  status: string;
  attempt: number | null;
  timestamp: string | null;
  error: string | null;
};

const STAGE_LABELS: Record<RehearsalStage, string> = {
  context: "整理上下文",
  script: "生成剧本",
  image: "生成关键帧",
  video: "生成视频",
  learning: "准备学习卡片",
};

const STATUSES = new Set<PipelineJobStatus>(["queued", "processing", "completed", "failed"]);
export const REHEARSAL_IMAGE_RECOVERY_AFTER_MS = 2 * 60 * 1000;
export const REHEARSAL_VIDEO_RECOVERY_AFTER_MS = 2 * 60 * 1000;

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function optionalMediaUrl(value: unknown): string | null {
  const normalized = optionalString(value);
  if (!normalized) return null;
  if (normalized.startsWith("/")) return normalized;
  try {
    const parsed = new URL(normalized);
    return ["http:", "https:", "blob:"].includes(parsed.protocol) ? normalized : null;
  } catch {
    return null;
  }
}

function persistedTimestamp(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function isLessonScript(value: unknown): value is LessonScript {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LessonScript>;
  return (
    typeof candidate.scene === "string" &&
    typeof candidate.theme === "string" &&
    ["beginner", "intermediate", "advanced"].includes(candidate.level ?? "") &&
    Array.isArray(candidate.script)
  );
}

export function parseRehearsalHistoryPage(value: unknown): { runs: RehearsalHistoryRun[]; nextCursor: string | null } {
  if (!value || typeof value !== "object") throw new Error("排练历史接口返回无效");
  const runs = (value as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) throw new Error("排练历史接口缺少 runs");

  const parsed = runs.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || !STATUSES.has(row.status as PipelineJobStatus)) {
      return [];
    }
    return [{
      id,
      authorId: optionalString(row.authorId),
      status: row.status as PipelineJobStatus,
      userText: typeof row.userText === "string" ? row.userText : "",
      script: isLessonScript(row.script) ? row.script : null,
      runState: row.runState && typeof row.runState === "object"
        ? row.runState as RehearsalRunState
        : null,
      keyImageUrl: optionalMediaUrl(row.keyImageUrl),
      videoUrl: optionalMediaUrl(row.videoUrl),
      thumbnailUrl: optionalMediaUrl(row.thumbnailUrl),
      providerTaskId: optionalString(row.providerTaskId),
      error: optionalString(row.error),
      createdAt: persistedTimestamp(row.createdAt),
      updatedAt: persistedTimestamp(row.updatedAt),
    }];
  });
  const nextCursor = (value as { nextCursor?: unknown }).nextCursor;
  if (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== "string") {
    throw new Error("排练历史接口返回无效游标");
  }
  return { runs: appendUniqueRehearsalRuns([], parsed), nextCursor: typeof nextCursor === "string" ? nextCursor.trim() || null : null };
}

export function parseRehearsalHistoryResponse(value: unknown): RehearsalHistoryRun[] {
  return parseRehearsalHistoryPage(value).runs;
}

export function appendUniqueRehearsalRuns(
  current: RehearsalHistoryRun[], older: RehearsalHistoryRun[],
): RehearsalHistoryRun[] {
  const ids = new Set<string>();
  const result: RehearsalHistoryRun[] = [];
  for (const run of [...current, ...older]) {
    if (!run.id || ids.has(run.id)) continue;
    ids.add(run.id);
    result.push(run);
  }
  return result;
}

export function nextRehearsalHistoryCursor(
  previous: string | null,
  next: string | null,
): string | null {
  const candidate = next?.trim() ?? "";
  const prior = previous?.trim() ?? "";
  return candidate && candidate !== prior ? candidate : null;
}

export function hasActiveRehearsalRuns(runs: RehearsalHistoryRun[]): boolean {
  return runs.some((run) => run.status === "queued" || run.status === "processing");
}

export function retryableFailedStage(
  run: RehearsalHistoryRun,
): RetryableRehearsalStage | null {
  const stages = run.runState?.stages;
  if (!stages || !run.script) return null;
  if (stages.video?.status === "failed" && stages.image?.status === "completed") {
    return "video";
  }
  if (stages.image?.status === "failed" && stages.script?.status === "completed") {
    return "image";
  }
  return null;
}

export function canResumeVideoPolling(run: RehearsalHistoryRun): boolean {
  return (
    run.status === "processing" &&
    run.runState?.stages?.video?.status === "running" &&
    run.script !== null &&
    run.providerTaskId !== null
  );
}

export function canRecoverInterruptedVideoSubmission(
  run: RehearsalHistoryRun,
  nowMs = Date.now(),
  staleAfterMs = REHEARSAL_VIDEO_RECOVERY_AFTER_MS,
): boolean {
  const video = run.runState?.stages?.video;
  if (
    run.status !== "processing" ||
    video?.status !== "running" ||
    run.runState?.stages?.image?.status !== "completed" ||
    run.script === null ||
    run.keyImageUrl === null ||
    run.providerTaskId !== null ||
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs <= 0
  ) {
    return false;
  }
  const activityMs = Math.max(
    Date.parse(video.startedAt ?? ""),
    Date.parse(run.updatedAt),
  );
  return Number.isFinite(activityMs) && nowMs - activityMs >= staleAfterMs;
}

export function msUntilInterruptedVideoRecovery(
  run: RehearsalHistoryRun,
  nowMs = Date.now(),
  staleAfterMs = REHEARSAL_VIDEO_RECOVERY_AFTER_MS,
): number | null {
  if (canRecoverInterruptedVideoSubmission(run, nowMs, staleAfterMs)) return null;
  const video = run.runState?.stages?.video;
  if (
    run.status !== "processing" ||
    video?.status !== "running" ||
    run.runState?.stages?.image?.status !== "completed" ||
    run.script === null ||
    run.keyImageUrl === null ||
    run.providerTaskId !== null ||
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs <= 0
  ) {
    return null;
  }
  const activityMs = Math.max(
    Date.parse(video.startedAt ?? ""),
    Date.parse(run.updatedAt),
  );
  if (!Number.isFinite(activityMs)) return null;
  const remainingMs = activityMs + staleAfterMs - nowMs;
  return remainingMs > 0 ? remainingMs : null;
}

export function canRecoverInterruptedImage(
  run: RehearsalHistoryRun,
  nowMs = Date.now(),
  staleAfterMs = REHEARSAL_IMAGE_RECOVERY_AFTER_MS,
): boolean {
  const image = run.runState?.stages?.image;
  if (
    run.status !== "processing" ||
    image?.status !== "running" ||
    run.script === null ||
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs <= 0
  ) {
    return false;
  }
  const activityMs = Math.max(
    Date.parse(image.startedAt ?? ""),
    Date.parse(run.updatedAt),
  );
  return Number.isFinite(activityMs) && nowMs - activityMs >= staleAfterMs;
}

export function msUntilInterruptedImageRecovery(
  run: RehearsalHistoryRun,
  nowMs = Date.now(),
  staleAfterMs = REHEARSAL_IMAGE_RECOVERY_AFTER_MS,
): number | null {
  const image = run.runState?.stages?.image;
  if (
    run.status !== "processing" ||
    image?.status !== "running" ||
    run.script === null ||
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs <= 0
  ) {
    return null;
  }
  const activityMs = Math.max(
    Date.parse(image.startedAt ?? ""),
    Date.parse(run.updatedAt),
  );
  if (!Number.isFinite(activityMs)) return null;
  const remainingMs = activityMs + staleAfterMs - nowMs;
  return remainingMs > 0 ? remainingMs : null;
}

export function summarizeRehearsalProgress(
  run: RehearsalHistoryRun,
): RehearsalProgressSummary {
  const totalStages = REHEARSAL_STAGES.length;
  const stages = run.runState?.stages;
  if (!stages) {
    const completed = run.status === "completed" ? totalStages : 0;
    return {
      completedStages: completed,
      totalStages,
      percent: completed === totalStages ? 100 : 0,
      label: run.status === "completed" ? "全部完成" : run.status === "failed" ? "运行失败" : "等待开始",
      activeStage: null,
      activeAttempt: null,
      retryable: false,
    };
  }

  const completedStages = REHEARSAL_STAGES.filter(
    (stage) => stages[stage]?.status === "completed",
  ).length;
  const activeStage = REHEARSAL_STAGES.find(
    (stage) => stages[stage]?.status === "failed",
  ) ?? REHEARSAL_STAGES.find(
    (stage) => stages[stage]?.status === "running",
  ) ?? REHEARSAL_STAGES.find(
    (stage) => stages[stage]?.status === "ready",
  ) ?? null;
  const activeStatus = activeStage ? stages[activeStage]?.status : undefined;
  const label = completedStages === totalStages
    ? "全部完成"
    : activeStage
      ? `${STAGE_LABELS[activeStage]}${activeStatus === "failed" ? "失败" : activeStatus === "running" ? "中" : "待开始"}`
      : "等待开始";

  return {
    completedStages,
    totalStages,
    percent: Math.round((completedStages / totalStages) * 100),
    label,
    activeStage,
    activeAttempt: activeStage ? stages[activeStage]?.attempt ?? 0 : null,
    retryable: activeStatus === "failed" && retryableFailedStage(run) !== null,
  };
}

export function summarizeRehearsalFailure(
  run: RehearsalHistoryRun,
): RehearsalFailureSummary | null {
  if (run.status !== "failed") return null;

  const failedStage = REHEARSAL_STAGES.find(
    (stage) => run.runState?.stages?.[stage]?.status === "failed",
  ) ?? null;
  const stageState = failedStage ? run.runState?.stages?.[failedStage] : undefined;
  const message = optionalString(stageState?.error) ?? run.error ?? "未提供失败原因";
  return {
    stage: failedStage,
    label: failedStage ? STAGE_LABELS[failedStage] : "运行",
    attempt: stageState?.attempt ?? null,
    message,
  };
}

export function rehearsalStageTimeline(run: RehearsalHistoryRun): RehearsalStageTimelineEntry[] {
  const stages = run.runState?.stages;
  if (!stages) {
    return [{
      stage: null,
      label: "运行记录",
      status: run.status,
      attempt: null,
      timestamp: run.updatedAt || null,
      error: run.error,
    }];
  }
  return REHEARSAL_STAGES.map((stage) => {
    const state = stages[stage];
    return {
      stage,
      label: STAGE_LABELS[stage],
      status: state?.status ?? "pending",
      attempt: state?.attempt ?? 0,
      timestamp: state?.completedAt ?? state?.startedAt ?? null,
      error: optionalString(state?.error),
    };
  });
}


export type RehearsalHistoryFilter = "all" | "active" | "failed" | "completed" | "retryable";

/** Browse the authorized response only; filtering never affects background polling. */
export function selectRehearsalHistory(
  runs: RehearsalHistoryRun[],
  options: { query?: string; status?: RehearsalHistoryFilter; page?: number; pageSize?: number } = {},
): { runs: RehearsalHistoryRun[]; total: number; page: number; pageCount: number } {
  const { query = "", status = "all", page = 1, pageSize = 4 } = options;
  if (!["all", "active", "failed", "completed", "retryable"].includes(status)) throw new Error("无效的历史状态筛选");
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error("历史分页参数必须是正整数");
  }
  const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().trim();
  const needle = normalize(query);
  const matches = runs.filter((run) => {
    const statusMatches = status === "all" || (status === "active"
      ? run.status === "queued" || run.status === "processing"
      : status === "retryable"
        ? retryableFailedStage(run) !== null
        : run.status === status);
    const failedStage = run.status === "failed" ? summarizeRehearsalFailure(run) : null;
    const textMatches = !needle || [
      run.userText, run.script?.scene ?? "", run.script?.theme ?? "",
      run.error ?? "", failedStage?.label ?? "", failedStage?.message ?? "",
    ]
      .some((text) => normalize(text).includes(needle));
    return statusMatches && textMatches;
  });
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const resolvedPage = Math.min(page, pageCount);
  const start = (resolvedPage - 1) * pageSize;
  return { runs: matches.slice(start, start + pageSize), total: matches.length, page: resolvedPage, pageCount };
}
