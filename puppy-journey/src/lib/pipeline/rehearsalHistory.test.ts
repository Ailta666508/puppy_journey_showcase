import { describe, expect, it } from "vitest";

import { parseRehearsalHistoryResponse } from "./rehearsalHistory";

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
});
