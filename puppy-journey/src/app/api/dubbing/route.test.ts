import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { gate, bearer, store } = vi.hoisted(() => ({ gate: vi.fn(), bearer: vi.fn(), store: {
  getGuide: vi.fn(), guidesByPipeline: vi.fn(), getSession: vi.fn(), getTake: vi.fn(), getRender: vi.fn(),
  takesBySession: vi.fn(), submissionsBySession: vi.fn(), rendersBySession: vi.fn(), createGuide: vi.fn(),
  createSession: vi.fn(), confirmDuration: vi.fn(), submit: vi.fn(), createRender: vi.fn(), consent: vi.fn(),
  revokeTake: vi.fn(), cancelRender: vi.fn(), retryJob: vi.fn(), trimTake: vi.fn(),
} }));
vi.mock("@/lib/couple/coupleWorkspaceContext", () => ({ requireCoupleWorkspaceContext: gate }));
vi.mock("@/lib/auth/requireBearerUser", () => ({ requireBearerUser: bearer }));
vi.mock("@/lib/dubbing/store.server", async (original) => ({ ...await original<object>(), createDubbingStore: () => store }));
import { GET, POST } from "./route";
import { createDubbingPlan } from "@/lib/dubbing/plan";
import { buildDubbingTimeline } from "@/lib/dubbing/timeline";
import { guideRequestDigest } from "@/lib/dubbing/api.server";

const id = "11111111-1111-4111-8111-111111111111", sid = "22222222-2222-4222-8222-222222222222";
const script = { scene: "Café", theme: "Coffee", level: "beginner", script: [
  { id: 1, type: "player", character: "黄狗", text: "Un café.", startTime: 0, endTime: 2 },
  { id: 2, type: "player", character: "白狗", text: "Un té.", startTime: 2, endTime: 4 },
] };
const participants = { coupleId: "couple", yellowDogId: "yellow", whiteDogId: "white" };
async function setup() {
  const plan = await createDubbingPlan(script);
  const guide = { id, pipeline_job_id: id, created_by: "yellow", status: "ready", participants, plan,
    result: { requestDigest: await guideRequestDigest(id, plan.scriptDigest), timeline: buildDubbingTimeline(plan, plan.lines.map((l) => ({ lineId: l.lineId, durationMs: 1000 })), 8000),
      sourceUrl: "https://private-source.test/token=secret", sourceSha256: "a".repeat(64),
      videoPath: "private/guide.mp4", subtitlePath: "private/guide.vtt", synthetic: true, guideAudio: [] }, error_code: null };
  const row = { id, couple_id: "couple", status: "completed", script_json: script, video_url: "https://provider.test/private.mp4" };
  const pipeline = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
  pipeline.select.mockReturnValue(pipeline); pipeline.eq.mockReturnValue(pipeline);
  const sessions = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: sid, guide_id: id, status: "active" }, error: null }) };
  sessions.select.mockReturnValue(sessions); sessions.eq.mockReturnValue(sessions);
  const signed = vi.fn().mockImplementation((path: string) => Promise.resolve({ data: { signedUrl: `https://storage.test/signed/${path}` }, error: null }));
  const supabase = { from: vi.fn((table: string) => table === "rehearsal_pipeline_jobs" ? pipeline : sessions), rpc: vi.fn().mockResolvedValue({ error: null }), storage: { from: vi.fn().mockReturnValue({ createSignedUrl: signed }) } };
  gate.mockResolvedValue({ ok: true, ctx: { supabase, coupleId: "couple", userId: "yellow", role: "yellow_dog", coupleYellowDogId: "yellow", coupleWhiteDogId: "white" } });
  bearer.mockResolvedValue({ ok: true, auth: { supabase, user: { id: "yellow" } } });
  store.guidesByPipeline.mockResolvedValue([guide]); store.getGuide.mockResolvedValue(guide);
  store.getSession.mockResolvedValue({ id: sid, guide_id: id, status: "active" });
  store.takesBySession.mockResolvedValue([]); store.submissionsBySession.mockResolvedValue([]); store.rendersBySession.mockResolvedValue([]);
  store.createGuide.mockResolvedValue(guide); store.createSession.mockResolvedValue({ id: sid });
  store.revokeTake.mockResolvedValue(true);
  return { guide, pipeline, sessions, signed, supabase };
}
function post(body: object) { return POST(new Request("https://example.test/api/dubbing", { method: "POST", body: JSON.stringify({ pipelineJobId: id, ...body }) })); }
function get() { return GET(new Request(`https://example.test/api/dubbing?pipelineJobId=${id}`)); }

describe("role dubbing API", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("DUBBING_ENABLED", "true"); vi.stubEnv("DUBBING_TTS_MODE", "mock"); });
  afterEach(() => vi.unstubAllEnvs());
  it("returns plan when disabled without requiring migration or causing work", async () => {
    await setup(); vi.stubEnv("DUBBING_ENABLED", "false");
    expect(await (await get()).json()).toMatchObject({ capabilities: { enabled: false }, guide: null });
    expect(store.guidesByPipeline).not.toHaveBeenCalled(); expect(store.createGuide).not.toHaveBeenCalled();
  });
  it("never leaks private partner recordings, storage paths or source URLs", async () => {
    const { signed } = await setup();
    store.takesBySession.mockResolvedValue([
      { id: "own", owner_id: "yellow", role: "yellow_dog", visibility: "private", status: "ready", line_id: "line-1", result: { path: "takes/own.wav", originalPath: "uploads/private.webm", durationMs: 1000 } },
      { id: "hidden-partner", owner_id: "white", role: "white_dog", visibility: "private", status: "ready", line_id: "line-2", result: { path: "takes/secret.wav", durationMs: 1000 } },
    ]);
    const response = await get(); const body = await response.json();
    expect(body.takes).toHaveLength(1); expect(body.takes[0].id).toBe("own");
    expect(JSON.stringify(body)).not.toMatch(/hidden-partner|secret|originalPath|sourceUrl/);
    expect(body.partnerProgress).toEqual({ ready: 1, total: 1 });
    expect(signed).not.toHaveBeenCalledWith("takes/secret.wav", expect.anything(), expect.anything());
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("hides a partner's solo render and exposes only consented completed media", async () => {
    await setup();
    const manifest = { mode: "solo", requiredConsentIds: ["white"], lines: [] };
    store.rendersBySession.mockResolvedValue([{ id: "private-render", created_by: "white", manifest, digest: "d", consents: [], status: "completed", result: { videoPath: "renders/partner.mp4" } }]);
    expect((await (await get()).json()).renders).toEqual([]);
  });
  it("rechecks membership before signing stored assets", async () => {
    const { supabase, signed } = await setup(); supabase.rpc.mockResolvedValue({ error: { message: "scope changed" } });
    expect((await get()).status).toBe(404); expect(signed).not.toHaveBeenCalled();
  });
  it("does not create work or disclose source on GET", async () => {
    await setup(); const body = await (await get()).json();
    expect(body.guide.synthetic).toBe(true); expect(body.guide).not.toHaveProperty("result");
    expect(store.createSession).not.toHaveBeenCalled(); expect(store.createGuide).not.toHaveBeenCalled();
  });
  it("keeps a completed guide readable after changing voice configuration", async () => {
    const { guide } = await setup();
    vi.stubEnv("DUBBING_VOICE_YELLOW_DOG", "new-voice");
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).guide.id).toBe(guide.id);
    expect(store.createGuide).not.toHaveBeenCalled();
  });
  it("does not reuse expired, changed-script or changed-participant guides", async () => {
    const { guide } = await setup();
    for (const candidate of [
      { ...guide, status: "failed", error_code: "GUIDE_EXPIRED" },
      { ...guide, plan: { ...guide.plan, scriptDigest: "changed" } },
      { ...guide, participants: { ...guide.participants, whiteDogId: "new-partner" } },
    ]) {
      store.guidesByPipeline.mockResolvedValue([candidate]);
      expect((await (await get()).json()).guide).toBeNull();
    }
  });
  it("returns a recoverable conflict when no valid recording is selected", async () => {
    await setup();
    expect((await post({ action: "render", sessionId: sid, mode: "solo" })).status).toBe(409);
    expect(store.createRender).not.toHaveBeenCalled();
  });
  it("derives prepare plan from saved script, not client-provided speakers", async () => {
    const { guide } = await setup();
    expect((await post({ action: "prepare", requestKey: "request_1234", plan: { fake: true } })).status).toBe(202);
    expect(store.createGuide).toHaveBeenCalledWith(expect.objectContaining({ actorId: "yellow", plan: guide.plan }));
  });
  it("does not queue TTS when unconfigured or source incomplete", async () => {
    const { pipeline } = await setup(); vi.stubEnv("DUBBING_TTS_MODE", "disabled");
    expect((await post({ action: "prepare", requestKey: "request_1234" })).status).toBe(503);
    vi.stubEnv("DUBBING_TTS_MODE", "mock"); pipeline.maybeSingle.mockResolvedValue({ data: { id, couple_id: "couple", script_json: script, status: "running" }, error: null });
    expect((await post({ action: "prepare", requestKey: "request_1234" })).status).toBe(409);
    expect(store.createGuide).not.toHaveBeenCalled();
  });
  it("requires explicit sharing consent but permits private solo choices", async () => {
    await setup(); const body = { action: "submit", sessionId: sid, expectedRevision: 0, choices: { "line-1": { kind: "ai" } } };
    expect((await post(body)).status).toBe(400);
    expect((await post({ ...body, share: true })).status).toBe(400);
    expect((await post({ ...body, share: false })).status).toBe(200);
    expect(store.submit).toHaveBeenCalledWith(expect.objectContaining({ share: false, actorId: "yellow" }));
    expect((await post({ ...body, share: true, shareConsent: true })).status).toBe(200);
  });
  it("requires explicit immutable manifest consent, not merely opening a render", async () => {
    await setup(); store.getRender.mockResolvedValue({ id: sid, guide_id: id });
    expect((await post({ action: "consent", renderId: sid, manifestDigest: "d" })).status).toBe(400);
    expect(store.consent).not.toHaveBeenCalled();
    expect((await post({ action: "consent", renderId: sid, manifestDigest: "d", accepted: true })).status).toBe(202);
  });
  it("allows owner revocation after leaving without the couple gate", async () => {
    await setup(); gate.mockResolvedValue({ ok: false, response: Response.json({}, { status: 403 }) });
    expect((await post({ action: "revoke_take", takeId: sid })).status).toBe(200);
    expect(gate).not.toHaveBeenCalled(); expect(store.revokeTake).toHaveBeenCalledWith(sid, "yellow");
  });
  it.each(["get", "post"])("denies unauthenticated %s", async (method) => {
    await setup(); gate.mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) });
    expect((await (method === "get" ? get() : post({ action: "prepare" }))).status).toBe(401);
    expect(store.createGuide).not.toHaveBeenCalled();
  });
  it("rejects oversized JSON and unknown operations", async () => {
    await setup(); expect((await post({ action: "unknown" })).status).toBe(400);
    expect((await post({ action: "prepare", padding: "x".repeat(33000) })).status).toBe(413);
  });
  it("sanitizes provider/database diagnostics", async () => {
    await setup(); store.guidesByPipeline.mockRejectedValue(new Error("postgres secret private data"));
    const response = await get(); expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/secret|postgres/);
  });
});
