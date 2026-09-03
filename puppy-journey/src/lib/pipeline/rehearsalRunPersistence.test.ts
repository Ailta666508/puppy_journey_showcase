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
  startRehearsalStage,
} from "./rehearsalRunState";

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
