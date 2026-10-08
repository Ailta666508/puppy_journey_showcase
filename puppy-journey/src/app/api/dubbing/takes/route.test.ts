import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { gate, bearer, store } = vi.hoisted(() => ({ gate: vi.fn(), bearer: vi.fn(), store: {
  getGuide: vi.fn(), getSession: vi.fn(), getTake: vi.fn(), takesBySession: vi.fn(), takesByOwner: vi.fn(),
  rendersBySession: vi.fn(), enqueueTake: vi.fn(), revokeTake: vi.fn(),
} }));
vi.mock("@/lib/couple/coupleWorkspaceContext", () => ({ requireCoupleWorkspaceContext: gate }));
vi.mock("@/lib/auth/requireBearerUser", () => ({ requireBearerUser: bearer }));
vi.mock("@/lib/dubbing/store.server", async (original) => ({ ...await original<object>(), createDubbingStore: () => store }));
import { GET, POST, DELETE } from "./route";
import { boundedBody } from "@/lib/dubbing/api.server";
import { DubbingStoreError } from "@/lib/dubbing/store.server";

const id = "11111111-1111-4111-8111-111111111111";
const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(32)]);
function setup() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const replay = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  replay.select.mockReturnValue(replay); replay.eq.mockReturnValue(replay);
  const supabase = { rpc: vi.fn().mockResolvedValue({ error: null }), from: vi.fn().mockReturnValue(replay), storage: { from: vi.fn().mockReturnValue({ upload, remove }) } };
  gate.mockResolvedValue({ ok: true, ctx: { supabase, coupleId: "couple", userId: "yellow", role: "yellow_dog", coupleYellowDogId: "yellow", coupleWhiteDogId: "white" } });
  bearer.mockResolvedValue({ ok: true, auth: { supabase, user: { id: "yellow" } } });
  store.getSession.mockResolvedValue({ id, guide_id: id, status: "active" });
  store.getGuide.mockResolvedValue({ id, status: "ready", participants: { coupleId: "couple", yellowDogId: "yellow", whiteDogId: "white" }, plan: { lines: [
    { lineId: "line-1", speakerKey: "yellow_dog", dubbable: true }, { lineId: "line-2", speakerKey: "white_dog", dubbable: true },
  ] } });
  store.takesBySession.mockResolvedValue([]); store.takesByOwner.mockResolvedValue([]); store.rendersBySession.mockResolvedValue([]);
  store.enqueueTake.mockResolvedValue({ id, status: "pending" }); store.revokeTake.mockResolvedValue(true);
  return { upload, remove, replay, supabase };
}
function request(options: { lineId?: string; bytes?: Uint8Array; type?: string; extra?: boolean } = {}) {
  const form = new FormData(); form.set("sessionId", id); form.set("lineId", options.lineId ?? "line-1"); form.set("requestKey", "request_12345");
  form.set("file", new Blob([Buffer.from(options.bytes ?? wav)], { type: options.type ?? "audio/wav" }), "untrusted-name.wav");
  if (options.extra) form.set("ownerId", "white");
  return new Request("https://example.test/api/dubbing/takes", { method: "POST", body: form });
}
describe("private recording upload boundaries", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("DUBBING_ENABLED", "true"); });
  afterEach(() => vi.unstubAllEnvs());
  it("uploads only to a server-owned private path then queues validation", async () => {
    const { upload, supabase } = setup(); const response = await POST(request());
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ ok: true, takeId: id, status: "pending" });
    expect(supabase.storage.from).toHaveBeenCalledWith("rehearsal-dubbing");
    expect(upload.mock.calls[0][0]).toMatch(/^uploads\/[a-f0-9-]+\/yellow\/[a-f0-9]{64}\/[a-f0-9]{64}\.wav$/);
    expect(store.enqueueTake).toHaveBeenCalledWith(expect.objectContaining({ actorId: "yellow", lineId: "line-1" }));
  });
  it("rejects partner-role recording and client-supplied owner fields", async () => {
    const { upload } = setup();
    expect((await POST(request({ lineId: "line-2" }))).status).toBe(404);
    expect((await POST(request({ extra: true }))).status).toBe(400); expect(upload).not.toHaveBeenCalled();
  });
  it("rejects MIME spoofing and oversize without uploading", async () => {
    const { upload } = setup();
    expect((await POST(request({ bytes: Buffer.from("not audio") }))).status).toBe(415);
    expect((await POST(request({ type: "video/mp4" }))).status).toBe(415);
    expect((await POST(request({ bytes: new Uint8Array(3 * 1024 * 1024 + 1) }))).status).toBe(413);
    expect(upload).not.toHaveBeenCalled();
  });
  it("bounds chunked bodies without trusting Content-Length", async () => {
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(12)); c.enqueue(new Uint8Array(12)); c.close(); } });
    const req = new Request("https://example.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(boundedBody(req, 20)).rejects.toMatchObject({ status: 413 });
  });
  it("accepts identical retry at quota without another upload", async () => {
    const { replay, upload } = setup();
    await POST(request());
    const args = store.enqueueTake.mock.calls[0][0];
    replay.maybeSingle.mockResolvedValue({ data: { request_digest: args.requestDigest, resource_id: id }, error: null });
    store.getTake.mockResolvedValue({ id, owner_id: "yellow", session_id: id, status: "ready" });
    store.takesBySession.mockResolvedValue(Array.from({ length: 60 }, () => ({ owner_id: "yellow" })));
    const result = await POST(request()); expect(result.status).toBe(202); expect(await result.json()).toMatchObject({ status: "ready" });
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it("rejects changed request payload before storing another object", async () => {
    const { replay, upload } = setup(); replay.maybeSingle.mockResolvedValue({ data: { request_digest: "different", resource_id: id }, error: null });
    expect((await POST(request())).status).toBe(409); expect(upload).not.toHaveBeenCalled();
  });
  it("does not delete an object after an uncertain database outcome", async () => {
    const { remove } = setup(); store.enqueueTake.mockRejectedValue(new DubbingStoreError("DUBBING_STORE_UNAVAILABLE"));
    expect((await POST(request())).status).toBe(503); expect(remove).not.toHaveBeenCalled();
  });
  it("cleans a fresh unreferenced upload after definite conflict", async () => {
    const { remove } = setup(); store.enqueueTake.mockRejectedValue(new DubbingStoreError("DUBBING_CONFLICT"));
    expect((await POST(request())).status).toBe(409); expect(remove).toHaveBeenCalledTimes(1);
  });
  it("does not upload before authentication", async () => {
    const { upload } = setup(); gate.mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) });
    expect((await POST(request())).status).toBe(401); expect(upload).not.toHaveBeenCalled();
  });
  it("exposes own metadata and deletion after leaving, never private URLs", async () => {
    setup(); store.takesByOwner.mockResolvedValue([{ id, session_id: id, line_id: "line-1", role: "yellow_dog", status: "ready", result: { path: "secret/path.wav" } }]);
    store.rendersBySession.mockResolvedValue([{ manifest: { lines: [{ source: { kind: "take", takeId: id } }] } }]);
    const response = await GET(new Request("https://example.test/api/dubbing/takes"));
    const body = await response.json(); expect(body.takes[0].affectedRenders).toBe(1); expect(JSON.stringify(body)).not.toMatch(/secret|Url/);
    expect((await DELETE(new Request(`https://example.test/api/dubbing/takes?id=${id}`))).status).toBe(200);
    expect(store.revokeTake).toHaveBeenCalledWith(id, "yellow"); expect(gate).not.toHaveBeenCalled();
  });
});
