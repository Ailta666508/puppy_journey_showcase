import { beforeEach, describe, expect, it, vi } from "vitest";

const { gate } = vi.hoisted(() => ({ gate: vi.fn() }));
vi.mock("@/lib/couple/coupleWorkspaceContext", () => ({ requireCoupleWorkspaceContext: gate }));
import { GET } from "./route";

const id = "12345678-1234-4234-8234-123456789abc";
const script = {
  scene: "Café", theme: "Ordering", level: "beginner",
  script: [
    { id: 1, type: "npc", character: "服务员", text: "¿Qué desean?", startTime: 0, endTime: 2 },
    { id: 2, type: "player", character: "黄狗", text: "Un café.", translation: "一杯咖啡。", startTime: 2, endTime: 4 },
    { id: 3, type: "player", character: "白狗", text: "Un té.", startTime: 4, endTime: 6 },
  ],
};

function setup(row: Record<string, unknown> | null = { id, couple_id: "couple-a", script_json: script }, error: unknown = null) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error }) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  gate.mockResolvedValue({
    ok: true, ctx: { supabase: { from }, coupleId: "couple-a", userId: "user-a", role: "yellow_dog" },
  });
  return { from, query };
}

const request = () => new Request("https://example.test/api/pipeline/jobs/" + id + "/dubbing-plan?role=white_dog");
const params = (value = id) => ({ params: Promise.resolve({ id: value }) });

describe("authorized dubbing plan", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns roles from the stored script and identity from the authenticated context", async () => {
    const db = setup();
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body.myRole).toBe("yellow_dog");
    expect(body.plan.lines.map((line: { speakerKey: string }) => line.speakerKey)).toEqual([
      "npc:legacy-1", "yellow_dog", "white_dog",
    ]);
    expect(body.plan.scriptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(db.query.eq).toHaveBeenCalledWith("couple_id", "couple-a");
    expect(db.from).toHaveBeenCalledExactlyOnceWith("rehearsal_pipeline_jobs");
    expect(body).not.toHaveProperty("video_url");
  });

  it("does not access a job without authentication", async () => {
    const db = setup();
    gate.mockResolvedValue({ ok: false, response: Response.json({ ok: false }, { status: 401 }) });
    expect((await GET(request(), params())).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects invalid identifiers before querying", async () => {
    const db = setup();
    expect((await GET(request(), params("../other"))).status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each([null, { id, couple_id: "couple-b", script_json: script }, { id, couple_id: null, script_json: script }])(
    "does not disclose foreign, missing or author-only jobs", async (row) => {
      setup(row);
      const response = await GET(request(), params());
      expect(response.status).toBe(404);
      expect(await response.json()).not.toHaveProperty("plan");
    },
  );

  it("requires clarification for ambiguous player roles instead of assigning by nickname", async () => {
    setup({ id, couple_id: "couple-a", script_json: { ...script, script: [
      { ...script.script[1], character: "Alice" }, script.script[2],
    ] } });
    const response = await GET(request(), params());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ROLE_CONFIRMATION_REQUIRED" });
  });

  it("rejects an incomplete role pair", async () => {
    setup({ id, couple_id: "couple-a", script_json: { ...script, script: [script.script[1]] } });
    const response = await GET(request(), params());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MISSING_DOG_ROLE" });
  });

  it("does not return raw database errors", async () => {
    setup(null, { message: "database connection private.example with secret=value" });
    const response = await GET(request(), params());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });

  it("does not return raw thrown authentication errors", async () => {
    setup();
    gate.mockRejectedValue(new Error("private credential"));
    const response = await GET(request(), params());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("credential");
  });
});
