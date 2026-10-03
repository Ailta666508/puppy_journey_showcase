import { describe, expect, it } from "vitest";

import {
  RehearsalRunPersistenceError,
  rehearsalRunFromPersistence,
  rehearsalRunToPersistence,
} from "./rehearsalRunPersistence";
import {
  completeRehearsalStage,
  createRehearsalRunState,
  failRehearsalStage,
  retryFailedRehearsalStage,
  startRehearsalStage,
} from "./rehearsalRunState";
import { REHEARSAL_STAGES, type RehearsalRunState } from "./types";

function failedScriptRun() {
  let run = createRehearsalRunState({
    id: "run-1",
    coupleId: "couple-1",
    authorId: "profile-1",
    now: "2026-09-03T09:00:00.000Z",
  });
  run = startRehearsalStage(run, "context", "2026-09-03T09:01:00.000Z");
  run = completeRehearsalStage(run, "context", "2026-09-03T09:02:00.000Z");
  run = startRehearsalStage(run, "script", "2026-09-03T09:03:00.000Z");
  return failRehearsalStage(run, "script", "provider timeout", "2026-09-03T09:04:00.000Z");
}

describe("rehearsal run persistence", () => {
  it("round-trips every pipeline boundary including retry and completion", () => {
    let run = createRehearsalRunState({
      id: "run-1", coupleId: "couple-1", authorId: "profile-1",
      now: "2026-10-03T09:00:00.000Z",
    });
    const now = "2026-10-03T09:01:00.000Z";
    const roundTrip = (value: RehearsalRunState) => {
      const restored = rehearsalRunFromPersistence(rehearsalRunToPersistence(value));
      expect(restored).toEqual(value);
      return restored;
    };
    run = roundTrip(run);
    for (const stage of REHEARSAL_STAGES) {
      run = roundTrip(startRehearsalStage(run, stage, now));
      run = roundTrip(failRehearsalStage(run, stage, "synthetic failure", now));
      run = roundTrip(retryFailedRehearsalStage(run, stage, now));
      run = roundTrip(completeRehearsalStage(run, stage, now));
    }
    expect(run.status).toBe("completed");
    expect(Object.values(run.stages).every((stage) => stage.attempt === 2)).toBe(true);
  });

  const invalidStates: [string, (run: RehearsalRunState) => void][] = [
    ["all pending marked completed", (run) => {
      for (const stage of REHEARSAL_STAGES) run.stages[stage] = { status: "pending", attempt: 0 };
      run.status = "completed";
    }],
    ["pending gap before frontier", (run) => { run.stages.context = { status: "pending", attempt: 0 }; }],
    ["completed after frontier", (run) => { run.stages.video = { ...run.stages.context }; }],
    ["negative attempt", (run) => { run.stages.script.attempt = -1; }],
    ["fractional attempt", (run) => { run.stages.script.attempt = 1.5; }],
    ["unsafe attempt", (run) => { run.stages.script.attempt = Number.MAX_SAFE_INTEGER + 1; }],
    ["pending with previous attempt", (run) => { run.stages.video.attempt = 1; }],
    ["invalid stage timestamp", (run) => { run.stages.script.startedAt = "invalid"; }],
    ["completion before start", (run) => { run.stages.script.completedAt = "2026-09-03T09:02:30.000Z"; }],
    ["start before predecessor completed", (run) => { run.stages.script.startedAt = "2026-09-03T09:01:30.000Z"; }],
    ["completion after run update", (run) => { run.stages.script.completedAt = "2026-09-03T09:05:00.000Z"; }],
    ["pending with start metadata", (run) => { run.stages.image.startedAt = run.updatedAt; }],
    ["running with completion metadata", (run) => {
      run.stages.script.status = "running";
      delete run.stages.script.error;
      run.status = "running";
    }],
    ["completed with error", (run) => { run.stages.context.error = "stale error"; }],
    ["ready with failure metadata", (run) => { run.stages.script.status = "ready"; run.status = "running"; }],
    ["invalid stage status", (run) => { Object.assign(run.stages.script, { status: "unknown" }); }],
    ["invalid run status", (run) => { Object.assign(run, { status: "unknown" }); }],
    ["invalid schema version", (run) => { Object.assign(run, { schemaVersion: 2 }); }],
  ];

  it.each(invalidStates)("rejects %s on both write and restore", (_name, mutate) => {
    const run = failedScriptRun();
    const row = rehearsalRunToPersistence(run);
    mutate(run);
    expect(() => rehearsalRunToPersistence(run)).toThrow(RehearsalRunPersistenceError);
    expect(() => rehearsalRunFromPersistence({ ...row, run_state: run })).toThrow(RehearsalRunPersistenceError);
  });

  it("round-trips a failed run without losing completed stage progress", () => {
    const run = failedScriptRun();
    const row = rehearsalRunToPersistence(run);
    const restored = rehearsalRunFromPersistence({
      ...row,
      run_state: JSON.parse(JSON.stringify(row.run_state)) as unknown,
    });

    expect(restored).toEqual(run);
    expect(restored.stages.context.status).toBe("completed");
    expect(restored.stages.script).toMatchObject({
      status: "failed",
      attempt: 1,
      error: "provider timeout",
    });
  });

  it("rejects state copied into another relationship row", () => {
    const row = rehearsalRunToPersistence(failedScriptRun());

    expect(() =>
      rehearsalRunFromPersistence({ ...row, couple_id: "different-couple" }),
    ).toThrow(RehearsalRunPersistenceError);
  });

  it("rejects unsupported versions and out-of-order stage progress", () => {
    const row = rehearsalRunToPersistence(failedScriptRun());
    const unsupported = { ...(row.run_state as Record<string, unknown>), schemaVersion: 2 };
    expect(() => rehearsalRunFromPersistence({ ...row, run_state: unsupported })).toThrow(
      "unsupported rehearsal run schema version",
    );

    const invalid = JSON.parse(JSON.stringify(row.run_state)) as Record<string, unknown>;
    const stages = invalid.stages as Record<string, Record<string, unknown>>;
    stages.video = { status: "ready", attempt: 0 };
    expect(() => rehearsalRunFromPersistence({ ...row, run_state: invalid })).toThrow(
      "stage video is out of pipeline order",
    );
  });
});
