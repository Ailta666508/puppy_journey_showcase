export type RehearsalScriptRequestBody = {
  user_text: string;
  image_description: string;
  user_image_data_url: string;
  user_image_url: string;
  context_achievements: string;
  context_travel: string;
  context_wishes: string;
  idempotency_key: string;
  retry_failed?: true;
};

type ScriptInputFields = Omit<
  RehearsalScriptRequestBody,
  "idempotency_key" | "retry_failed"
>;

export function createRehearsalScriptRequest(
  input: ScriptInputFields,
  idempotencyKey: string,
): RehearsalScriptRequestBody {
  const key = idempotencyKey.trim();
  if (!key) throw new Error("A rehearsal idempotency key is required");
  return { ...input, idempotency_key: key };
}

export function asFailedRehearsalScriptRetry(
  request: RehearsalScriptRequestBody,
): RehearsalScriptRequestBody {
  return { ...request, retry_failed: true };
}

export type RehearsalVideoPollDecision =
  | { kind: "retry" }
  | { kind: "pending" }
  | { kind: "completed"; videoUrl: string }
  | { kind: "failed"; message: string };

export function interpretRehearsalVideoPollResponse(
  httpStatus: number,
  value: unknown,
): RehearsalVideoPollDecision {
  if (httpStatus === 409) return { kind: "retry" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "failed", message: "视频轮询响应格式无效" };
  }
  const payload = value as Record<string, unknown>;
  const message =
    typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : null;
  if (httpStatus < 200 || httpStatus >= 300 || payload.ok !== true) {
    return { kind: "failed", message: message ?? `视频轮询失败（HTTP ${httpStatus}）` };
  }
  if (payload.status === "failed") {
    return { kind: "failed", message: message ?? "视频任务失败" };
  }
  if (payload.status === "completed") {
    const videoUrl =
      typeof payload.videoUrl === "string" ? payload.videoUrl.trim() : "";
    return videoUrl
      ? { kind: "completed", videoUrl }
      : { kind: "failed", message: "视频已完成但未返回播放地址" };
  }
  if (payload.status === "queued" || payload.status === "processing") {
    return { kind: "pending" };
  }
  return { kind: "failed", message: "视频轮询响应包含未知状态" };
}
