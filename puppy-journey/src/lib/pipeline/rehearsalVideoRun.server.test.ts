import { describe, expect, it } from "vitest";

import {
  beginVideoStage,
  completeVideoRun,
  isStaleVideoSubmission,
  reconcileCompletedVideoRun,
  resumeStaleVideoSubmission,
} from "./rehearsalVideoRun.server";
import {
  completeRehearsalStage,
  createRehearsalRunState,
  failRehearsalStage,
  startRehearsalStage,
} from "./rehearsalRunState";

function videoReadyRun() {
  let run = createRehearsalRunState({
    id: "run-1",
    coupleId: "couple-1",
    authorId: "profile-1",
    now: "2026-09-15T09:00:00.000Z",
  });
  for (const stage of ["context", "script", "image"] as const) {
    run = startRehearsalStage(run, stage, "2026-09-15T09:00:01.000Z");
    run = completeRehearsalStage(run, stage, "2026-09-15T09:00:02.000Z");
  }
  return run;
}

describe("rehearsal video run", () => {
  it("claims video once and completes the script-derived learning stage", () => {
    const running = beginVideoStage(videoReadyRun(), "2026-09-15T09:01:00.000Z");
    expect(running.stages.video).toMatchObject({ status: "running", attempt: 1 });

    const completed = completeVideoRun(running, "2026-09-15T09:02:00.000Z");
    expect(completed.status).toBe("completed");
    expect(completed.stages.video.status).toBe("completed");
    expect(completed.stages.learning).toMatchObject({ status: "completed", attempt: 1 });
  });

  it("retries only a failed video submission", () => {
    const running = beginVideoStage(videoReadyRun(), "2026-09-15T09:01:00.000Z");
    const failed = failRehearsalStage(
      running,
      "video",
      "provider timeout",
      "2026-09-15T09:02:00.000Z",
    );
    const retried = beginVideoStage(failed, "2026-09-15T09:03:00.000Z");

    expect(retried.stages.image.status).toBe("completed");
    expect(retried.stages.video).toMatchObject({ status: "running", attempt: 2 });
    expect(retried.stages.video.error).toBeUndefined();
  });

  it("rejects duplicate submission for running and completed video stages", () => {
    const running = beginVideoStage(videoReadyRun(), "2026-09-15T09:01:00.000Z");
    expect(() => beginVideoStage(running, "2026-09-15T09:01:01.000Z")).toThrow(
      "Cannot begin video from running",
    );
    const completed = completeVideoRun(running, "2026-09-15T09:02:00.000Z");
    expect(() => beginVideoStage(completed, "2026-09-15T09:02:01.000Z")).toThrow(
      "Cannot begin video from completed",
    );
  });

  it("recovers only an interrupted submission without a provider task", () => {
    const running = beginVideoStage(videoReadyRun(), "2026-09-15T09:00:00.000Z");
    expect(
      isStaleVideoSubmission(running, false, "2026-09-15T09:01:59.999Z"),
    ).toBe(false);
    expect(
      isStaleVideoSubmission(running, false, "2026-09-15T09:02:00.000Z"),
    ).toBe(true);
    expect(
      isStaleVideoSubmission(running, true, "2026-09-15T10:00:00.000Z"),
    ).toBe(false);

    const recovered = resumeStaleVideoSubmission(
      running,
      "2026-09-15T09:02:00.000Z",
    );
    expect(recovered.stages.video).toMatchObject({
      status: "running",
      attempt: 2,
      startedAt: "2026-09-15T09:02:00.000Z",
    });
  });

  it("reconciles a video URL persisted by the legacy route", () => {
    const reconciled = reconcileCompletedVideoRun(
      videoReadyRun(),
      "2026-09-15T09:02:00.000Z",
    );
    expect(reconciled.status).toBe("completed");
    expect(reconciled.stages.video.attempt).toBe(1);
    expect(reconciled.stages.learning.status).toBe("completed");
  });
});
