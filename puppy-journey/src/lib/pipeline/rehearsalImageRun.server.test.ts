import { describe, expect, it } from "vitest";

import {
  beginImageStage,
  completeImageStage,
  isStaleImageStage,
  resumeStaleImageStage,
} from "./rehearsalImageRun.server";
import {
  completeRehearsalStage,
  createRehearsalRunState,
  failRehearsalStage,
  startRehearsalStage,
} from "./rehearsalRunState";

function imageReadyRun() {
  let run = createRehearsalRunState({
    id: "run-1",
    coupleId: "couple-1",
    authorId: "profile-1",
    now: "2026-09-12T09:00:00.000Z",
  });
  run = startRehearsalStage(run, "context", "2026-09-12T09:00:01.000Z");
  run = completeRehearsalStage(run, "context", "2026-09-12T09:00:02.000Z");
  run = startRehearsalStage(run, "script", "2026-09-12T09:00:03.000Z");
  return completeRehearsalStage(run, "script", "2026-09-12T09:00:04.000Z");
}

describe("rehearsal image run", () => {
  it("persists image progress and advances the video frontier", () => {
    const running = beginImageStage(imageReadyRun(), "2026-09-12T09:00:05.000Z");
    expect(running.stages.image).toMatchObject({ status: "running", attempt: 1 });

    const completed = completeImageStage(running, "2026-09-12T09:00:06.000Z");
    expect(completed.stages.image).toMatchObject({ status: "completed", attempt: 1 });
    expect(completed.stages.video).toEqual({ status: "ready", attempt: 0 });
  });

  it("retries a failed image stage without repeating earlier stages", () => {
    const firstAttempt = beginImageStage(imageReadyRun(), "2026-09-12T09:00:05.000Z");
    const failed = failRehearsalStage(
      firstAttempt,
      "image",
      "provider timeout",
      "2026-09-12T09:00:06.000Z",
    );
    const retried = beginImageStage(failed, "2026-09-12T09:01:00.000Z");

    expect(retried.stages.context.status).toBe("completed");
    expect(retried.stages.script.status).toBe("completed");
    expect(retried.stages.image).toMatchObject({ status: "running", attempt: 2 });
  });

  it("does not restart a completed or in-flight image stage", () => {
    const running = beginImageStage(imageReadyRun(), "2026-09-12T09:00:05.000Z");
    expect(() => beginImageStage(running, "2026-09-12T09:00:06.000Z")).toThrow(
      "Cannot begin image from running",
    );
    const completed = completeImageStage(running, "2026-09-12T09:00:06.000Z");
    expect(() => beginImageStage(completed, "2026-09-12T09:00:07.000Z")).toThrow(
      "Cannot begin image from completed",
    );
  });

  it("recovers an image stage left running by an interrupted request", () => {
    const running = beginImageStage(imageReadyRun(), "2026-09-12T09:00:05.000Z");
    expect(isStaleImageStage(running, "2026-09-12T09:02:04.999Z")).toBe(false);
    expect(isStaleImageStage(running, "2026-09-12T09:02:05.000Z")).toBe(true);

    const recovered = resumeStaleImageStage(
      running,
      "2026-09-12T09:02:05.000Z",
    );
    expect(recovered.stages.script.status).toBe("completed");
    expect(recovered.stages.image).toMatchObject({
      status: "running",
      attempt: 2,
      startedAt: "2026-09-12T09:02:05.000Z",
    });
  });

  it("does not recover a recent image request", () => {
    const running = beginImageStage(imageReadyRun(), "2026-09-12T09:00:05.000Z");
    expect(() =>
      resumeStaleImageStage(running, "2026-09-12T09:02:04.999Z"),
    ).toThrow("image stage is not stale enough");
  });
});
