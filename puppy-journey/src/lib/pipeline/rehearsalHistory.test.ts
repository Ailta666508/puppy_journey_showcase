import { describe, expect, it } from "vitest";

import {
  parseRehearsalHistoryResponse,
  retryableFailedStage,
  summarizeRehearsalProgress,
  type RehearsalHistoryRun,
} from "./rehearsalHistory";

const SCRIPT = {
  scene: "Station",
  theme: "Travel",
  level: "beginner",
  script: [],
} as const;

describe("parseRehearsalHistoryResponse", () => {
  it("keeps playable fields from valid persisted runs", () => {
    const runs = parseRehearsalHistoryResponse({
      runs: [{
        id: "run-1",
        status: "completed",
        userText: "去看雪山",
        script: SCRIPT,
        runState: { schemaVersion: 1 },
        keyImageUrl: "https://example.com/frame.png",
        videoUrl: "https://example.com/movie.mp4",
        thumbnailUrl: null,
        error: null,
        updatedAt: "2026-09-16T08:00:00Z",
      }],
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "run-1",
      status: "completed",
      userText: "去看雪山",
      videoUrl: "https://example.com/movie.mp4",
      script: SCRIPT,
    });
  });

  it("drops malformed rows while preserving failed runs", () => {
    const runs = parseRehearsalHistoryResponse({
      runs: [
        null,
        { id: "", status: "completed" },
        { id: "run-2", status: "unknown" },
        { id: "run-3", status: "failed", error: "provider timeout", updatedAt: "" },
      ],
    });

    expect(runs).toEqual([expect.objectContaining({
      id: "run-3",
      status: "failed",
      error: "provider timeout",
    })]);
  });

  it("rejects a response without a run collection", () => {
    expect(() => parseRehearsalHistoryResponse({ ok: true })).toThrow("缺少 runs");
  });

  it.each([
    ["image", "failed", "pending", "image"],
    ["video", "completed", "failed", "video"],
    ["script", "pending", "pending", null],
  ])("selects only a retryable failed media stage for %s failures", (_, image, video, expected) => {
    const run = {
      id: "run-4",
      status: "failed",
      userText: "练习旅行对话",
      script: SCRIPT,
      runState: {
        schemaVersion: 1,
        stages: {
          script: { status: expected ? "completed" : "failed", attempt: 1 },
          image: { status: image, attempt: 1 },
          video: { status: video, attempt: 1 },
        },
      },
      keyImageUrl: image === "completed" ? "https://example.com/frame.png" : null,
      videoUrl: null,
      thumbnailUrl: null,
      error: "provider timeout",
      updatedAt: "",
    } as unknown as RehearsalHistoryRun;

    expect(retryableFailedStage(run)).toBe(expected);
  });

  it("summarizes persisted stage progress and surfaces the failed frontier", () => {
    const run = {
      id: "run-5",
      status: "failed",
      userText: "练习旅行对话",
      script: SCRIPT,
      runState: {
        schemaVersion: 1,
        stages: {
          context: { status: "completed", attempt: 1 },
          script: { status: "completed", attempt: 1 },
          image: { status: "failed", attempt: 2 },
          video: { status: "pending", attempt: 0 },
          learning: { status: "pending", attempt: 0 },
        },
      },
      keyImageUrl: null,
      videoUrl: null,
      thumbnailUrl: null,
      error: "provider timeout",
      updatedAt: "",
    } as unknown as RehearsalHistoryRun;

    expect(summarizeRehearsalProgress(run)).toEqual({
      completedStages: 2,
      totalStages: 5,
      percent: 40,
      label: "生成关键帧失败",
      activeStage: "image",
    });
  });

  it("falls back to the terminal job status when legacy history has no stage state", () => {
    const run = parseRehearsalHistoryResponse({
      runs: [{ id: "legacy", status: "completed", videoUrl: "movie.mp4" }],
    })[0]!;

    expect(summarizeRehearsalProgress(run)).toMatchObject({ percent: 100, label: "全部完成" });
  });
});
