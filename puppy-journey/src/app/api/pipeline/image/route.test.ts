import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { gate, generateImage } = vi.hoisted(() => ({
  gate: vi.fn(),
  generateImage: vi.fn(),
}));

vi.mock("@/lib/couple/coupleWorkspaceContext", () => ({
  requireCoupleWorkspaceContext: gate,
}));
vi.mock("@/lib/pipeline/service", () => ({
  generateLessonKeyVisual: generateImage,
}));

import { POST } from "./route";
import {
  completeRehearsalStage,
  createRehearsalRunState,
  failRehearsalStage,
  startRehearsalStage,
} from "@/lib/pipeline/rehearsalRunState";
import { rehearsalRunToPersistence } from "@/lib/pipeline/rehearsalRunPersistence";
import type { LessonScript, RehearsalRunState } from "@/lib/pipeline/types";

const jobId = "12345678-1234-4234-8234-123456789abc";
const now = "2026-10-08T09:00:00.000Z";
const savedScript: LessonScript = {
  scene: "A quiet café",
  theme: "Ordering a drink",
  level: "beginner",
  script: [{
    id: 1, type: "player", character: "白狗",
    text: "Un café, por favor.", translation: "请给我一杯咖啡。",
    startTime: 0, endTime: 3,
  }],
};

function readyRun(): RehearsalRunState {
  let run = createRehearsalRunState({
    id: jobId, coupleId: "couple-a", authorId: "user-a", now,
  });
  for (const stage of ["context", "script"] as const) {
    run = startRehearsalStage(run, stage, now);
    run = completeRehearsalStage(run, stage, now);
  }
  return run;
}

function savedRow(run = readyRun()) {
  return {
    ...rehearsalRunToPersistence(run),
    script_json: savedScript as unknown,
    key_image_url: null as string | null,
  };
}

function query(data: Record<string, unknown> | null) {
  const result = Promise.resolve({ data, error: null });
  const chain = {
    select: vi.fn(), update: vi.fn(), eq: vi.fn(),
    maybeSingle: vi.fn().mockReturnValue(result),
    then: result.then.bind(result),
  };
  for (const method of [chain.select, chain.update, chain.eq]) {
    method.mockReturnValue(chain);
  }
  return chain;
}

function database(row: Record<string, unknown> | null = savedRow(), claimed = true) {
  const read = query(row);
  const claim = query(claimed ? { id: jobId } : null);
  const write = query({ id: jobId });
  const from = vi.fn()
    .mockReturnValueOnce(read)
    .mockReturnValueOnce(claim)
    .mockReturnValue(write);
  gate.mockResolvedValue({
    ok: true,
    ctx: { supabase: { from }, coupleId: "couple-a", userId: "user-a" },
  });
  return { from, read, claim, write };
}

function request(extra: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/pipeline/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pipeline_job_id: jobId, ...extra }),
  });
}

describe("persisted rehearsal image API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    generateImage.mockResolvedValue({ imageUrl: "https://example.com/key-frame.png" });
  });
  afterEach(() => vi.useRealTimers());

  it("generates from the saved script using only a run ID and persists progress", async () => {
    const db = database();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(db.read.select).toHaveBeenCalledWith(expect.stringContaining("script_json"));
    expect(generateImage).toHaveBeenCalledExactlyOnceWith(savedScript);
    expect(db.claim.eq).toHaveBeenCalledWith("couple_id", "couple-a");
    expect(db.claim.eq).toHaveBeenCalledWith("updated_at", now);
    expect(db.write.update).toHaveBeenCalledWith(expect.objectContaining({
      key_image_url: "https://example.com/key-frame.png",
      run_state: expect.objectContaining({ stages: expect.objectContaining({
        image: expect.objectContaining({ status: "completed", attempt: 1 }),
        video: { status: "ready", attempt: 0 },
      }) }),
    }));
  });

  it("ignores a replacement script sent by a legacy client", async () => {
    database();
    const response = await POST(request({ script: { ...savedScript, scene: "Unrelated scene" } }));
    expect(response.status).toBe(200);
    expect(generateImage).toHaveBeenCalledExactlyOnceWith(savedScript);
  });

  it("retries a failed image with the saved script without repeating earlier stages", async () => {
    const failed = failRehearsalStage(
      startRehearsalStage(readyRun(), "image", now), "image", "provider timeout", now,
    );
    database(savedRow(failed));
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.run.stages.image).toMatchObject({ status: "completed", attempt: 2 });
    expect(payload.run.stages.script).toEqual(failed.stages.script);
    expect(payload.run.stages.context).toEqual(failed.stages.context);
    expect(generateImage).toHaveBeenCalledExactlyOnceWith(savedScript);
  });

  it("replays an existing key frame without requiring or generating a script", async () => {
    const completed = completeRehearsalStage(
      startRehearsalStage(readyRun(), "image", now), "image", now,
    );
    const row = savedRow(completed);
    row.key_image_url = "https://example.com/existing.png";
    row.script_json = null;
    const db = database(row);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      replayed: true, imageUrl: row.key_image_url,
    });
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it.each([null, {}, { ...savedScript, script: [] }, { ...savedScript, scene: " " }])(
    "rejects an unusable saved script without falling back to the client (%j)",
    async (script) => {
      const db = database({ ...savedRow(), script_json: script });
      const response = await POST(request({ script: savedScript }));
      expect(response.status).toBe(409);
      expect(db.from).toHaveBeenCalledTimes(1);
      expect(generateImage).not.toHaveBeenCalled();
    },
  );

  it("does not read jobs or call the provider before authentication", async () => {
    const db = database();
    gate.mockResolvedValue({ ok: false, response: Response.json({ ok: false }, { status: 401 }) });
    expect((await POST(request())).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
    expect(generateImage).not.toHaveBeenCalled();
  });

  it.each([null, { ...savedRow(), couple_id: "couple-b" }])(
    "hides missing or foreign jobs and never starts generation", async (row) => {
      const db = database(row);
      const response = await POST(request({ script: savedScript }));
      expect(response.status).toBe(404);
      expect(db.from).toHaveBeenCalledTimes(1);
      expect(generateImage).not.toHaveBeenCalled();
    },
  );

  it("does not call the provider when another request claims the stage", async () => {
    const db = database(savedRow(), false);
    expect((await POST(request())).status).toBe(409);
    expect(db.from).toHaveBeenCalledTimes(2);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("persists provider failure so the same saved input can be retried", async () => {
    const db = database();
    generateImage.mockRejectedValue(new Error("provider timeout"));
    expect((await POST(request())).status).toBe(500);
    expect(db.write.eq).toHaveBeenCalledWith("updated_at", now);
    expect(db.write.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      run_state: expect.objectContaining({ stages: expect.objectContaining({
        image: expect.objectContaining({ status: "failed", error: "provider timeout" }),
      }) }),
    }));
  });
});
