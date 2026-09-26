import { describe, expect, it } from "vitest";

import {
  canRecoverInterruptedVideoSubmission,
  canRecoverInterruptedImage,
  canResumeVideoPolling,
  hasActiveRehearsalRuns,
  msUntilInterruptedImageRecovery,
  msUntilInterruptedVideoRecovery,
  parseRehearsalHistoryResponse,
  retryableFailedStage,
  summarizeRehearsalFailure,
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
        providerTaskId: "provider-1",
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
      providerTaskId: "provider-1",
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

  it("detects history that still needs background refresh", () => {
    const run = (status: RehearsalHistoryRun["status"]) => ({
      id: status,
      status,
    }) as RehearsalHistoryRun;

    expect(hasActiveRehearsalRuns([run("completed"), run("failed")])).toBe(false);
    expect(hasActiveRehearsalRuns([run("completed"), run("queued")])).toBe(true);
    expect(hasActiveRehearsalRuns([run("processing")])).toBe(true);
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
    expect(summarizeRehearsalFailure(run)).toEqual({
      stage: "image",
      label: "生成关键帧",
      attempt: 2,
      message: "provider timeout",
    });
  });

  it("falls back to the persisted job error for legacy failed runs", () => {
    const run = parseRehearsalHistoryResponse({
      runs: [{
        id: "legacy-failure",
        status: "failed",
        error: "legacy provider timeout",
        updatedAt: "2026-09-23T08:00:00.000Z",
      }],
    })[0]!;

    expect(summarizeRehearsalFailure(run)).toEqual({
      stage: null,
      label: "运行",
      attempt: null,
      message: "legacy provider timeout",
    });
    expect(summarizeRehearsalFailure({ ...run, status: "completed" })).toBeNull();
  });

  it("offers polling recovery only for an in-flight video with a saved script", () => {
    const run = {
      id: "run-6",
      status: "processing",
      userText: "练习旅行对话",
      script: SCRIPT,
      runState: {
        schemaVersion: 1,
        stages: { video: { status: "running", attempt: 1 } },
      },
      keyImageUrl: "https://example.com/frame.png",
      videoUrl: null,
      thumbnailUrl: null,
      providerTaskId: "provider-6",
      error: null,
      updatedAt: "",
    } as unknown as RehearsalHistoryRun;

    expect(canResumeVideoPolling(run)).toBe(true);
    expect(canResumeVideoPolling({ ...run, status: "failed" })).toBe(false);
    expect(canResumeVideoPolling({ ...run, script: null })).toBe(false);
    expect(canResumeVideoPolling({ ...run, providerTaskId: null })).toBe(false);
  });

  it("recovers a stale video claim only when provider submission was interrupted", () => {
    const run = {
      id: "run-video-recovery",
      status: "processing",
      userText: "练习旅行对话",
      script: SCRIPT,
      runState: {
        schemaVersion: 1,
        stages: {
          image: { status: "completed", attempt: 1 },
          video: {
            status: "running",
            attempt: 1,
            startedAt: "2026-09-26T08:00:00.000Z",
          },
        },
      },
      keyImageUrl: "https://example.com/frame.png",
      videoUrl: null,
      thumbnailUrl: null,
      providerTaskId: null,
      error: null,
      updatedAt: "2026-09-26T08:00:00.000Z",
    } as unknown as RehearsalHistoryRun;

    expect(
      canRecoverInterruptedVideoSubmission(run, Date.parse("2026-09-26T08:01:59.999Z")),
    ).toBe(false);
    expect(
      canRecoverInterruptedVideoSubmission(run, Date.parse("2026-09-26T08:02:00.000Z")),
    ).toBe(true);
    expect(
      canRecoverInterruptedVideoSubmission(
        { ...run, providerTaskId: "provider-1" },
        Date.parse("2026-09-26T09:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("returns the video submission recovery boundary delay", () => {
    const run = {
      id: "run-video-timer",
      status: "processing",
      script: SCRIPT,
      runState: {
        schemaVersion: 1,
        stages: {
          image: { status: "completed", attempt: 1 },
          video: { status: "running", attempt: 1, startedAt: "2026-09-26T08:00:00.000Z" },
        },
      },
      keyImageUrl: "https://example.com/frame.png",
      providerTaskId: null,
      updatedAt: "2026-09-26T08:00:00.000Z",
    } as unknown as RehearsalHistoryRun;

    expect(msUntilInterruptedVideoRecovery(run, Date.parse("2026-09-26T08:01:30.000Z"))).toBe(30_000);
    expect(msUntilInterruptedVideoRecovery(run, Date.parse("2026-09-26T08:02:00.000Z"))).toBeNull();
  });

  it("offers image recovery only after an interrupted claim becomes stale", () => {
    const run = {
      id: "run-7",
      status: "processing",
      userText: "练习旅行对话",
      script: SCRIPT,
      runState: {
        schemaVersion: 1,
        stages: {
          image: {
            status: "running",
            attempt: 1,
            startedAt: "2026-09-21T08:00:00.000Z",
          },
        },
      },
      keyImageUrl: null,
      videoUrl: null,
      thumbnailUrl: null,
      error: null,
      updatedAt: "2026-09-21T08:00:00.000Z",
    } as unknown as RehearsalHistoryRun;

    expect(canRecoverInterruptedImage(run, Date.parse("2026-09-21T08:01:59.999Z"))).toBe(false);
    expect(canRecoverInterruptedImage(run, Date.parse("2026-09-21T08:02:00.000Z"))).toBe(true);
    expect(canRecoverInterruptedImage({ ...run, script: null }, Date.parse("2026-09-21T09:00:00Z"))).toBe(false);
  });

  it("returns a timer delay for the recovery boundary", () => {
    const run = {
      id: "run-8",
      status: "processing",
      userText: "练习旅行对话",
      script: SCRIPT,
      runState: {
        schemaVersion: 1,
        stages: { image: { status: "running", attempt: 1, startedAt: "2026-09-21T08:00:00.000Z" } },
      },
      keyImageUrl: null,
      videoUrl: null,
      thumbnailUrl: null,
      error: null,
      updatedAt: "2026-09-21T08:00:00.000Z",
    } as unknown as RehearsalHistoryRun;

    expect(msUntilInterruptedImageRecovery(run, Date.parse("2026-09-21T08:01:30.000Z"))).toBe(30_000);
    expect(msUntilInterruptedImageRecovery(run, Date.parse("2026-09-21T08:02:00.000Z"))).toBeNull();
  });

  it("falls back to the terminal job status when legacy history has no stage state", () => {
    const run = parseRehearsalHistoryResponse({
      runs: [{ id: "legacy", status: "completed", videoUrl: "movie.mp4" }],
    })[0]!;

    expect(summarizeRehearsalProgress(run)).toMatchObject({ percent: 100, label: "全部完成" });
  });
});
