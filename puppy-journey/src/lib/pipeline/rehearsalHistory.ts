import type { LessonScript, PipelineJobStatus, RehearsalRunState } from "@/lib/pipeline/types";

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

const STATUSES = new Set<PipelineJobStatus>(["queued", "processing", "completed", "failed"]);

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
