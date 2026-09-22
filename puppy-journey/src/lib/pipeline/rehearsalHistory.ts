import {
  REHEARSAL_STAGES,
  type LessonScript,
  type PipelineJobStatus,
  type RehearsalRunState,
  type RehearsalStage,
} from "./types";

export type RehearsalHistoryRun = {
  id: string;
  status: PipelineJobStatus;
  userText: string;
  script: LessonScript | null;
  runState: RehearsalRunState | null;
  keyImageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
  updatedAt: string;
};

export type RetryableRehearsalStage = "image" | "video";

export type RehearsalProgressSummary = {
  completedStages: number;
  totalStages: number;
  percent: number;
  label: string;
  activeStage: RehearsalStage | null;
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

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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

export function parseRehearsalHistoryResponse(value: unknown): RehearsalHistoryRun[] {
  if (!value || typeof value !== "object") throw new Error("排练历史接口返回无效");
  const runs = (value as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) throw new Error("排练历史接口缺少 runs");

  return runs.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || !STATUSES.has(row.status as PipelineJobStatus)) {
      return [];
    }
    return [{
      id: row.id,
      status: row.status as PipelineJobStatus,
      userText: typeof row.userText === "string" ? row.userText : "",
      script: isLessonScript(row.script) ? row.script : null,
      runState: row.runState && typeof row.runState === "object"
        ? row.runState as RehearsalRunState
        : null,
      keyImageUrl: optionalString(row.keyImageUrl),
      videoUrl: optionalString(row.videoUrl),
      thumbnailUrl: optionalString(row.thumbnailUrl),
      error: optionalString(row.error),
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
    }];
  });
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
    run.script !== null
  );
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
  };
}
