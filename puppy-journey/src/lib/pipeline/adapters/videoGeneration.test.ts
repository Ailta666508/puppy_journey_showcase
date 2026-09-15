import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pipeline/config", () => ({
  ARK_VIDEO_CREATE_TASK_PATH: "/contents/generations/tasks",
  ARK_VIDEO_GET_TASK_PATH_TEMPLATE: "/contents/generations/tasks/{id}",
  getVideoHttpRuntimeConfig: () => ({
    apiKey: "",
    baseUrl: "",
    model: "mock-model",
    provider: "mock",
  }),
}));

vi.mock("@/lib/pipeline/prompts", () => ({
  AGENT3_IMAGE_TO_VIDEO_SOURCE_LOCK: "image lock",
  AGENT3_TEXT_TO_VIDEO_SCRIPT_LOCK: "text lock",
  AGENT3_VIDEO_TASK_COMMON: "video task",
}));

import { getVideoJobStatus, startVideoGeneration } from "./videoGeneration";
import type { LessonScript } from "../types";

const script: LessonScript = {
  scene: "A quiet café",
  theme: "Ordering a drink",
  level: "beginner",
  script: [
    {
      id: 1,
      type: "player",
      character: "白狗",
      text: "Un café, por favor.",
      translation: "请给我一杯咖啡。",
      startTime: 0,
      endTime: 3,
    },
  ],
};

describe("mock video generation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an opaque job token and becomes playable after processing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T09:00:00.000Z"));

    const { jobId } = await startVideoGeneration({
      script,
      firstFrameImageUrl: "https://example.com/key-frame.png",
    });
    expect(jobId).not.toContain("A quiet café");
    await expect(getVideoJobStatus(jobId)).resolves.toMatchObject({
      status: "processing",
      providerTaskId: "mock",
    });

    vi.advanceTimersByTime(4_000);
    await expect(getVideoJobStatus(jobId)).resolves.toMatchObject({
      status: "completed",
      videoUrl: expect.stringMatching(/^https:\/\//),
      providerTaskId: "mock",
    });
  });

  it("rejects malformed provider job tokens", async () => {
    await expect(getVideoJobStatus("not-a-job-token")).resolves.toEqual({
      status: "failed",
      error: "无效 jobId",
    });
  });
});
