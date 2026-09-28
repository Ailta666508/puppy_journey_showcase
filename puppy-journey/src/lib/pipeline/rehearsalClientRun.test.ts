import { describe, expect, it } from "vitest";

import {
  asFailedRehearsalScriptRetry,
  createRehearsalScriptRequest,
  interpretRehearsalVideoPollResponse,
} from "./rehearsalClientRun";

const input = {
  user_text: "Practise ordering coffee",
  image_description: "A quiet café",
  user_image_data_url: "",
  user_image_url: "",
  context_achievements: "",
  context_travel: "Madrid",
  context_wishes: "",
};

describe("rehearsal client run", () => {
  it("reuses the exact payload and idempotency key for failed-stage retry", () => {
    const original = createRehearsalScriptRequest(input, " run-2026-09-06 ");
    const retry = asFailedRehearsalScriptRetry(original);

    expect(retry).toEqual({ ...original, retry_failed: true });
    expect(retry.idempotency_key).toBe("run-2026-09-06");
    expect(original.retry_failed).toBeUndefined();
  });

  it("rejects a request that cannot be replayed idempotently", () => {
    expect(() => createRehearsalScriptRequest(input, "   ")).toThrow(
      "idempotency key is required",
    );
  });

  it("retries a poll when another request committed the transition", () => {
    expect(
      interpretRehearsalVideoPollResponse(409, {
        ok: false,
        error: "视频状态已被其他请求更新",
      }),
    ).toEqual({ kind: "retry" });
  });

  it("accepts only structured pending and completed poll states", () => {
    expect(
      interpretRehearsalVideoPollResponse(200, {
        ok: true,
        status: "processing",
      }),
    ).toEqual({ kind: "pending" });
    expect(
      interpretRehearsalVideoPollResponse(200, {
        ok: true,
        status: "completed",
        videoUrl: " https://example.com/video.mp4 ",
      }),
    ).toEqual({
      kind: "completed",
      videoUrl: "https://example.com/video.mp4",
    });
  });

  it("rejects failed, incomplete, and unknown poll responses", () => {
    expect(
      interpretRehearsalVideoPollResponse(200, {
        ok: true,
        status: "failed",
        error: "provider timeout",
      }),
    ).toEqual({ kind: "failed", message: "provider timeout" });
    expect(
      interpretRehearsalVideoPollResponse(200, {
        ok: true,
        status: "completed",
      }),
    ).toEqual({
      kind: "failed",
      message: "视频已完成但未返回播放地址",
    });
    expect(
      interpretRehearsalVideoPollResponse(200, {
        ok: true,
        status: "mystery",
      }),
    ).toEqual({
      kind: "failed",
      message: "视频轮询响应包含未知状态",
    });
  });
});
