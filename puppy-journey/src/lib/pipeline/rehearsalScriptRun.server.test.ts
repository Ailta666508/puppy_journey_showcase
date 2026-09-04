import { describe, expect, it } from "vitest";

import {
  createRunningScriptRun,
  normalizeRehearsalIdempotencyKey,
  rehearsalRequestFingerprint,
} from "./rehearsalScriptRun.server";

const input = {
  userText: "Practise ordering coffee",
  imageDescription: "A quiet café",
  userImageDataUrl: "",
  userImageUrl: "",
  contextAchievements: "lesson 1",
  contextTravel: "Madrid",
  contextWishes: "Speak confidently",
};

describe("rehearsal script run", () => {
  it("normalizes safe idempotency keys and rejects ambiguous values", () => {
    expect(normalizeRehearsalIdempotencyKey("  run:2026-09-04.1  ")).toBe(
      "run:2026-09-04.1",
    );
    expect(normalizeRehearsalIdempotencyKey("")).toBeUndefined();
    expect(() => normalizeRehearsalIdempotencyKey("contains spaces")).toThrow(
      "URL-safe characters",
    );
  });

  it("fingerprints canonical request fields and detects changed input", () => {
    const first = rehearsalRequestFingerprint(input);
    const repeated = rehearsalRequestFingerprint({ ...input });
    const changed = rehearsalRequestFingerprint({ ...input, userText: "Order dinner" });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("persists context completion before starting script generation", () => {
    const run = createRunningScriptRun({
      id: "run-1",
      coupleId: "couple-1",
      authorId: "profile-1",
      now: "2026-09-04T09:00:00.000Z",
    });

    expect(run.status).toBe("running");
    expect(run.stages.context).toMatchObject({ status: "completed", attempt: 1 });
    expect(run.stages.script).toMatchObject({ status: "running", attempt: 1 });
    expect(run.stages.image.status).toBe("pending");
  });
});
