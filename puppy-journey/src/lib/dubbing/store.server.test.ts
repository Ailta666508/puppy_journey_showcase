import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDubbingPlan } from "./plan";
import { buildDubbingTimeline, digestDubbingTimeline } from "./timeline";
import { buildDubbingRenderManifest } from "./renderPlan";
import { createDubbingStore, type DbGuide, type DbJob, type DbRender, type DbSession, type DbTake } from "./store.server";

const YELLOW = "10000000-0000-4000-8000-000000000001";
const WHITE = "10000000-0000-4000-8000-000000000002";
const OUTSIDER = "10000000-0000-4000-8000-000000000003";
const COUPLE = "20000000-0000-4000-8000-000000000001";
const PIPELINE = "30000000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
const participants = { coupleId: COUPLE, yellowDogId: YELLOW, whiteDogId: WHITE };
const saved = {
  scene: "咖啡馆", theme: "点单",
  script: [
    { id: 1, type: "player", character: "黄狗", text: "Un café." },
    { id: 2, type: "player", character: "白狗", text: "Un té." },
  ],
};
let db: PGlite;
let plan: Awaited<ReturnType<typeof createDubbingPlan>>;

async function rpc<T>(name: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
  const result = await db.query<{ value: T }>(`select to_jsonb(public.${name}(${placeholders})) as value`, args);
  return result.rows[0].value;
}
async function guide(actorId = YELLOW, key = randomUUID()) {
  return rpc<DbGuide>("dubbing_create_guide", [PIPELINE, actorId, key, HASH, plan]);
}
async function claim() { return rpc<DbJob>("dubbing_claim_job", ["local-test-worker", 90]); }
async function readyGuide() {
  const g = await guide();
  const job = await claim();
  const timeline = buildDubbingTimeline(plan, plan.lines.map((line) => ({ lineId: line.lineId, durationMs: 1000 })), 8000);
  const result = {
    timeline, timelineDigest: await digestDubbingTimeline(timeline), sourceSha256: HASH,
    sourcePath: "synthetic/source.mp4", videoPath: "synthetic/guide.mp4", subtitlePath: "synthetic/guide.vtt", synthetic: true,
  };
  await rpc("dubbing_finish_job", [job.id, job.lease_token, "completed", result, null]);
  const session = await rpc<DbSession>("dubbing_create_session", [g.id, YELLOW]);
  return { guide: { ...g, result, status: "ready" as const }, session, timeline };
}
async function take(session: DbSession, owner = YELLOW, duration = 1000) {
  const lineId = owner === YELLOW ? "line-1" : "line-2";
  const t = await rpc<DbTake>("dubbing_enqueue_take", [session.id, owner, lineId, randomUUID(), HASH, `uploads/${randomUUID()}.webm`]);
  const job = await claim();
  const result = { path: `normalized/${t.id}.wav`, durationMs: duration, sha256: HASH, sizeBytes: 96044 };
  await rpc("dubbing_finish_job", [job.id, job.lease_token, "completed", result, null]);
  return { ...t, result: { ...t.result, ...result }, status: duration > 2000 ? "needs_trim" as const : "ready" as const };
}
async function duet() {
  const setup = await readyGuide();
  const y = await take(setup.session, YELLOW);
  const w = await take(setup.session, WHITE);
  const choicesY = { "line-1": { kind: "take" as const, takeId: y.id } };
  const choicesW = { "line-2": { kind: "take" as const, takeId: w.id } };
  await rpc("dubbing_submit", [setup.session.id, YELLOW, 0, choicesY, true]);
  await rpc("dubbing_submit", [setup.session.id, WHITE, 0, choicesW, true]);
  const manifest = await buildDubbingRenderManifest({
    sessionId: setup.session.id, participants, actor: { ...participants, userId: YELLOW, role: "yellow_dog" },
    mode: "duet", timeline: setup.timeline, durationConfirmed: true, sourceVideoSha256: HASH,
    guideAudioSha256: Object.fromEntries(plan.lines.map((line) => [line.lineId, HASH])),
    submissions: [
      { ownerId: YELLOW, role: "yellow_dog", revision: 1, choices: choicesY },
      { ownerId: WHITE, role: "white_dog", revision: 1, choices: choicesW },
    ],
    takes: [y, w].map((t) => ({
      id: t.id, sessionId: t.session_id, planDigest: plan.scriptDigest, lineId: t.line_id,
      ownerId: t.owner_id, role: t.role, sha256: HASH, durationMs: 1000, status: "ready", visibility: "shared",
    })),
  });
  const render = await rpc<DbRender>("dubbing_create_render", [setup.session.id, YELLOW, manifest]);
  return { ...setup, y, w, render, choicesY };
}

describe("dubbing migration and atomic RPCs in PostgreSQL", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now());
      create table public.profiles(id uuid primary key,couple_id uuid,role text);
      create table public.couples(id uuid primary key,yellow_dog_id uuid,white_dog_id uuid);
      create table public.rehearsal_pipeline_jobs(id uuid primary key,couple_id uuid,status text,video_url text);
      grant usage on schema public to service_role,anon,authenticated;
      grant all on public.profiles,public.couples,public.rehearsal_pipeline_jobs to service_role;
    `);
    const migration = await readFile(new URL("../../../supabase/migrations/20261008170000_role_dubbing.sql", import.meta.url), "utf8");
    await db.exec(migration);
    plan = await createDubbingPlan(saved);
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec(`truncate public.rehearsal_dubbing_guides,public.rehearsal_dubbing_requests,public.rehearsal_pipeline_jobs,public.profiles,public.couples,storage.objects cascade;`);
    await db.query("insert into public.profiles values($1,$4,'yellow_dog'),($2,$4,'white_dog'),($3,null,'yellow_dog')", [YELLOW, WHITE, OUTSIDER, COUPLE]);
    await db.query("insert into public.couples values($1,$2,$3)", [COUPLE, YELLOW, WHITE]);
    await db.query("insert into public.rehearsal_pipeline_jobs values($1,$2,'completed','https://provider.invalid/synthetic-video.mp4')", [PIPELINE, COUPLE]);
  });

  it("installs private storage and denies direct public table/RPC access", async () => {
    const result = await db.query<{ public: boolean }>("select public from storage.buckets where id='rehearsal-dubbing'");
    expect(result.rows[0].public).toBe(false);
    for (const role of ["anon", "authenticated"]) {
      const grants = await db.query<{ tables: boolean; functions: boolean }>(
        "select has_table_privilege($1,'public.rehearsal_dubbing_takes','select') tables,has_function_privilege($1,'public.dubbing_claim_job(text,integer)','execute') functions", [role],
      );
      expect(grants.rows[0]).toEqual({ tables: false, functions: false });
    }
    const policies = await db.query("select * from pg_policies where tablename like 'rehearsal_dubbing_%'");
    expect(policies.rows).toHaveLength(0);
  });

  it("atomically creates one guide and one durable job for a repeated request", async () => {
    const key = randomUUID();
    const first = await guide(YELLOW, key);
    const repeated = await guide(YELLOW, key);
    expect(repeated.id).toBe(first.id);
    expect(first.participants).toEqual(participants);
    expect(first.result.sourceUrl).toBe("https://provider.invalid/synthetic-video.mp4");
    expect((await db.query("select id from rehearsal_dubbing_jobs")).rows).toHaveLength(1);
    await expect(rpc("dubbing_create_guide", [PIPELINE, YELLOW, key, "b".repeat(64), plan])).rejects.toThrow("DUBBING_CONFLICT");
  });

  it("executes the same migration functions as service_role but rejects an authenticated direct caller", async () => {
    await db.exec("set role service_role");
    try { expect((await guide()).created_by).toBe(YELLOW); } finally { await db.exec("reset role"); }
    await db.exec("set role authenticated");
    try {
      await expect(rpc("dubbing_claim_job", ["intruder", 90])).rejects.toThrow("permission denied");
      await expect(db.query("select * from rehearsal_dubbing_guides")).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); }
  });

  it("does not create a guide for another member's space or a missing source video", async () => {
    await expect(guide(OUTSIDER)).rejects.toThrow("DUBBING_NOT_FOUND");
    await db.query("update rehearsal_pipeline_jobs set video_url=null where id=$1", [PIPELINE]);
    await expect(guide()).rejects.toThrow("DUBBING_VIDEO_NOT_READY");
    expect((await db.query("select id from rehearsal_dubbing_jobs")).rows).toHaveLength(0);
  });

  it("enforces a durable daily guide quota while allowing idempotent replay", async () => {
    const key = randomUUID();
    await guide(YELLOW, key);
    for (let i = 0; i < 9; i++) {
      await db.query("update rehearsal_pipeline_jobs set video_url=$2 where id=$1", [PIPELINE, `https://provider.invalid/synthetic-${i}.mp4`]);
      await guide();
    }
    await db.query("update rehearsal_pipeline_jobs set video_url='https://provider.invalid/eleventh.mp4' where id=$1", [PIPELINE]);
    await expect(guide()).rejects.toThrow("DUBBING_QUOTA_EXCEEDED");
    await expect(guide(YELLOW, key)).resolves.toBeDefined();
  });

  it("reuses the same failed guide across request keys and partners without issuing another TTS task", async () => {
    const first = await guide(); const running = await claim();
    await rpc("dubbing_finish_job", [running.id, running.lease_token, "failed", {}, "TTS_DELIVERY_UNKNOWN"]);
    const ownRepeat = await guide();
    const partnerRepeat = await guide(WHITE);
    expect(ownRepeat.id).toBe(first.id);
    expect(partnerRepeat.id).toBe(first.id);
    expect(partnerRepeat.status).toBe("failed");
    expect((await db.query("select id from rehearsal_dubbing_jobs")).rows).toHaveLength(1);
    expect(await rpc("dubbing_claim_job", ["worker", 90])).toBeNull();
    await expect(rpc("dubbing_retry_job", ["guide", first.id, YELLOW, false])).rejects.toThrow("DUBBING_TTS_CONFIRMATION_REQUIRED");
  });

  it("creates a new guide when the non-secret provider configuration fingerprint changes", async () => {
    const first = await guide();
    const next = await rpc<DbGuide>("dubbing_create_guide", [PIPELINE, YELLOW, randomUUID(), "b".repeat(64), plan]);
    expect(next.id).not.toBe(first.id);
    expect(next.result.requestDigest).toBe("b".repeat(64));
    expect((await db.query("select id from rehearsal_dubbing_jobs")).rows).toHaveLength(2);
  });

  it("fences checkpoints and publication after lease expiry or reassignment", async () => {
    await guide();
    const first = await claim();
    expect(await rpc("dubbing_checkpoint_job", [first.id, first.lease_token, { guideAudio: [{ lineId: "line-1" }] }])).toBe(true);
    await db.query("update rehearsal_dubbing_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [first.id]);
    expect(await rpc("dubbing_renew_job", [first.id, first.lease_token, 90])).toBe(false);
    const second = await claim();
    expect(second.id).toBe(first.id);
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(second.attempt).toBe(2);
    expect(second.result.guideAudio).toEqual([{ lineId: "line-1" }]);
    expect(await rpc("dubbing_checkpoint_job", [first.id, first.lease_token, { videoPath: "wrong" }])).toBe(false);
    expect(await rpc("dubbing_finish_job", [first.id, first.lease_token, "completed", {}, null])).toBe(false);
    expect(await rpc("dubbing_renew_job", [second.id, second.lease_token, 90])).toBe(true);
  });

  it("holds duration confirmation outside a lease and only accepts the creator's exact timeline", async () => {
    const g = await guide(); const job = await claim();
    const timeline = buildDubbingTimeline(plan, plan.lines.map((line) => ({ lineId: line.lineId, durationMs: 1000 })), 4000);
    expect(await rpc("dubbing_finish_job", [job.id, job.lease_token, "awaiting_confirmation", { timeline, timelineDigest: HASH, sourceSha256: HASH }, null])).toBe(true);
    expect(await rpc("dubbing_claim_job", ["other-worker", 90])).toBeNull();
    await expect(rpc("dubbing_confirm_duration", [g.id, WHITE, HASH])).rejects.toThrow("DUBBING_NOT_FOUND");
    await expect(rpc("dubbing_confirm_duration", [g.id, YELLOW, "b".repeat(64)])).rejects.toThrow("DUBBING_CONFLICT");
    expect((await rpc<DbGuide>("dubbing_confirm_duration", [g.id, YELLOW, HASH])).result.durationConfirmed).toBe(true);
    expect((await claim()).target_id).toBe(g.id);
  });

  it("records bounded over-window audio as needs_trim and rejects another role's line", async () => {
    const setup = await readyGuide();
    await expect(rpc("dubbing_enqueue_take", [setup.session.id, WHITE, "line-1", randomUUID(), HASH, "uploads/test.webm"])).rejects.toThrow("DUBBING_NOT_FOUND");
    const t = await take(setup.session, YELLOW, 2500);
    const current = await db.query<{ status: string; visibility: string }>("select status,visibility from rehearsal_dubbing_takes where id=$1", [t.id]);
    expect(current.rows[0]).toEqual({ status: "needs_trim", visibility: "private" });
    await expect(rpc("dubbing_submit", [setup.session.id, YELLOW, 0, { "line-1": { kind: "take", takeId: t.id } }, true])).rejects.toThrow("DUBBING_INVALID_TAKE");
  });

  it("rejects null actors and unfinished guides before opening recording sessions", async () => {
    const g = await guide();
    await expect(rpc("dubbing_create_session", [g.id, YELLOW])).rejects.toThrow("DUBBING_GUIDE_NOT_READY");
    await expect(rpc("dubbing_create_session", [g.id, null])).rejects.toThrow("DUBBING_NOT_FOUND");
  });

  it("keeps a repeated take request private and creates exactly one validation task", async () => {
    const setup = await readyGuide();
    const key = randomUUID();
    const args = [setup.session.id, YELLOW, "line-1", key, HASH, "uploads/recording.webm"];
    const first = await rpc<DbTake>("dubbing_enqueue_take", args);
    const repeat = await rpc<DbTake>("dubbing_enqueue_take", args);
    expect(repeat.id).toBe(first.id);
    expect(repeat.visibility).toBe("private");
    expect((await db.query("select id from rehearsal_dubbing_jobs where kind='validate_take'")).rows).toHaveLength(1);
    await expect(rpc("dubbing_enqueue_take", [setup.session.id, YELLOW, "line-1", key, "b".repeat(64), "uploads/new.webm"])).rejects.toThrow("DUBBING_CONFLICT");
  });

  it("rejects audio above the hard safety limit even if the worker calls it ready", async () => {
    const setup = await readyGuide();
    await rpc("dubbing_enqueue_take", [setup.session.id, YELLOW, "line-1", randomUUID(), HASH, "uploads/long.webm"]);
    const job = await claim();
    await expect(rpc("dubbing_finish_job", [job.id, job.lease_token, "completed", {
      durationMs: 10001, path: "normalized/too-long.wav", sha256: HASH, status: "ready",
    }, null])).rejects.toThrow("DUBBING_INVALID_MEDIA");
    const takeStates = await db.query<{ status: string }>("select status from rehearsal_dubbing_takes");
    expect(takeStates.rows[0].status).toBe("validating");
  });

  it("produces a new trim candidate and revokes its descendants without deleting unrelated guide assets", async () => {
    const setup = await readyGuide(); const original = await take(setup.session, YELLOW, 2500);
    const trimmed = await rpc<DbTake>("dubbing_trim_take", [original.id, YELLOW, 200, 1900, randomUUID(), HASH]);
    expect(trimmed.id).not.toBe(original.id);
    expect(trimmed.result).toMatchObject({ parentTakeId: original.id, trimStartMs: 200, trimEndMs: 1900, originalPath: original.result.path });
    const j = await claim();
    await rpc("dubbing_finish_job", [j.id, j.lease_token, "completed", { path: "normalized/trimmed.wav", durationMs: 1700, sha256: HASH }, null]);
    await rpc("dubbing_revoke_take", [original.id, YELLOW]);
    const rows = await db.query<{ status: string }>("select status from rehearsal_dubbing_takes");
    expect(rows.rows.every((row) => row.status === "revoked")).toBe(true);
    const cleanup = await claim();
    expect(cleanup.kind).toBe("purge");
    expect(cleanup.result.paths).toContain(original.result.path);
    expect(cleanup.result.paths).toContain("normalized/trimmed.wav");
    expect(cleanup.result.paths).not.toContain("synthetic/guide.vtt");
  });

  it("uses compare-and-swap for selections and queues a duet only after both exact consents", async () => {
    const setup = await duet();
    await expect(rpc("dubbing_submit", [setup.session.id, YELLOW, 0, setup.choicesY, true])).rejects.toThrow("DUBBING_CONFLICT");
    await expect(rpc("dubbing_consent", [setup.render.id, OUTSIDER, setup.render.digest])).rejects.toThrow("DUBBING_NOT_FOUND");
    const first = await rpc<DbRender>("dubbing_consent", [setup.render.id, YELLOW, setup.render.digest]);
    expect(first.status).toBe("awaiting_consent");
    expect(await rpc("dubbing_claim_job", ["worker", 90])).toBeNull();
    const second = await rpc<DbRender>("dubbing_consent", [setup.render.id, WHITE, setup.render.digest]);
    expect(second.status).toBe("queued");
    await rpc("dubbing_consent", [setup.render.id, WHITE, setup.render.digest]);
    expect((await db.query("select id from rehearsal_dubbing_jobs where kind='render'")).rows).toHaveLength(1);
  });

  it("cancels in-flight renders when selections change", async () => {
    const setup = await duet();
    await rpc("dubbing_consent", [setup.render.id, YELLOW, setup.render.digest]);
    await rpc("dubbing_consent", [setup.render.id, WHITE, setup.render.digest]);
    const running = await claim();
    await rpc("dubbing_submit", [setup.session.id, YELLOW, 1, setup.choicesY, true]);
    expect(await rpc("dubbing_finish_job", [running.id, running.lease_token, "completed", { videoPath: "late.mp4" }, null])).toBe(false);
    const r = await db.query<{ status: string; consents: unknown[] }>("select status,consents from rehearsal_dubbing_renders where id=$1", [setup.render.id]);
    expect(r.rows[0]).toEqual({ status: "cancelled", consents: [] });
  });

  it("requires the original owner to cancel and fences a late output after cancellation", async () => {
    const setup = await duet();
    await rpc("dubbing_consent", [setup.render.id, YELLOW, setup.render.digest]);
    await rpc("dubbing_consent", [setup.render.id, WHITE, setup.render.digest]);
    const running = await claim();
    await expect(rpc("dubbing_cancel_render", [setup.render.id, WHITE])).rejects.toThrow("DUBBING_NOT_FOUND");
    expect((await rpc<DbRender>("dubbing_cancel_render", [setup.render.id, YELLOW])).status).toBe("cancelled");
    expect(await rpc("dubbing_finish_job", [running.id, running.lease_token, "completed", { videoPath: "late/output.mp4" }, null])).toBe(false);
  });

  it("checks material hashes and all consent digests again at publication", async () => {
    const setup = await duet();
    await rpc("dubbing_consent", [setup.render.id, YELLOW, setup.render.digest]);
    await rpc("dubbing_consent", [setup.render.id, WHITE, setup.render.digest]);
    const running = await claim();
    await db.query("update rehearsal_dubbing_takes set result=result||jsonb_build_object('sha256',$2::text) where id=$1", [setup.y.id, "b".repeat(64)]);
    await expect(rpc("dubbing_finish_job", [running.id, running.lease_token, "completed", {}, null])).rejects.toThrow("DUBBING_REVOKED");
    await db.query("update rehearsal_dubbing_takes set result=result||jsonb_build_object('sha256',$2::text) where id=$1", [setup.y.id, HASH]);
    await db.query("update rehearsal_dubbing_renders set consents='[]' where id=$1", [setup.render.id]);
    await expect(rpc("dubbing_finish_job", [running.id, running.lease_token, "completed", {}, null])).rejects.toThrow("DUBBING_REVOKED");
  });

  it("revokes on membership change while keeping owner-only deletion available", async () => {
    const setup = await duet();
    await rpc("dubbing_consent", [setup.render.id, YELLOW, setup.render.digest]);
    await rpc("dubbing_consent", [setup.render.id, WHITE, setup.render.digest]);
    const running = await claim();
    await db.query("update couples set white_dog_id=$2 where id=$1", [COUPLE, OUTSIDER]);
    expect(await rpc("dubbing_finish_job", [running.id, running.lease_token, "completed", {}, null])).toBe(false);
    await expect(rpc("dubbing_create_session", [setup.guide.id, YELLOW])).rejects.toThrow("DUBBING_NOT_FOUND");
    expect(await rpc("dubbing_revoke_take", [setup.w.id, YELLOW])).toBe(false);
    expect(await rpc("dubbing_revoke_take", [setup.w.id, WHITE])).toBe(true);
    expect((await claim()).kind).toBe("purge");
  });

  it("blocks blind replay of uncertain TTS delivery and preserves completed guide steps", async () => {
    const g = await guide(); const running = await claim();
    await rpc("dubbing_checkpoint_job", [running.id, running.lease_token, { ttsPendingLine: "line-2", guideAudio: [{ lineId: "line-1", path: "guide/one.wav" }] }]);
    await rpc("dubbing_finish_job", [running.id, running.lease_token, "failed", {}, "TTS_DELIVERY_UNKNOWN"]);
    await expect(rpc("dubbing_retry_job", ["guide", g.id, YELLOW, false])).rejects.toThrow("DUBBING_TTS_CONFIRMATION_REQUIRED");
    const retry = await rpc<DbJob>("dubbing_retry_job", ["guide", g.id, YELLOW, true]);
    expect(retry.result.ttsPendingLine).toBeNull();
    expect(retry.result.guideAudio).toHaveLength(1);
    expect((await claim()).attempt).toBe(2);
  });

  it("revokes a guide in the profile change transaction, even if member slots are temporarily stale", async () => {
    const setup = await readyGuide();
    await db.query("update profiles set couple_id=null where id=$1", [WHITE]);
    const state = await db.query<{ status: string }>("select status from rehearsal_dubbing_guides where id=$1", [setup.guide.id]);
    expect(state.rows[0].status).toBe("revoked");
    await expect(rpc("dubbing_create_session", [setup.guide.id, YELLOW])).rejects.toThrow("DUBBING_NOT_FOUND");
  });

  it("expires only abandoned duration confirmations and queues media cleanup without physical SQL deletion", async () => {
    const g = await guide(); const job = await claim();
    const timeline = buildDubbingTimeline(plan, plan.lines.map((line) => ({ lineId: line.lineId, durationMs: 1000 })), 4000);
    const sourcePath = `guides/${g.id}/source.mp4`;
    await rpc("dubbing_finish_job", [job.id, job.lease_token, "awaiting_confirmation", {
      timeline, timelineDigest: HASH, sourceSha256: HASH, sourcePath, guideAudio: [{ lineId: "line-1", path: `guides/${g.id}/line.wav` }],
    }, null]);
    await db.query("update rehearsal_dubbing_guides set updated_at=now()-interval '8 days' where id=$1", [g.id]);
    await db.query("insert into storage.objects(bucket_id,name,created_at) values('rehearsal-dubbing',$1,now()-interval '8 days')", [sourcePath]);
    expect(await rpc("dubbing_sweep_maintenance", [100])).toMatchObject({ expiredGuides: 1, expiredTakes: 0, orphanObjects: 0 });
    const purge = await claim();
    expect(purge.kind).toBe("purge");
    expect(purge.result.paths).toContain(sourcePath);
    expect((await db.query("select name from storage.objects")).rows).toHaveLength(1);
    await expect(rpc("dubbing_retry_job", ["guide", g.id, YELLOW, false])).rejects.toThrow("DUBBING_GUIDE_EXPIRED");
    expect((await guide()).id).not.toBe(g.id);
  });

  it("cleans stale private drafts but preserves submitted recordings and their parent material", async () => {
    const setup = await readyGuide();
    const abandoned = await take(setup.session, WHITE);
    const original = await take(setup.session, YELLOW, 2500);
    const trimmed = await rpc<DbTake>("dubbing_trim_take", [original.id, YELLOW, 100, 1500, randomUUID(), HASH]);
    const running = await claim();
    await rpc("dubbing_finish_job", [running.id, running.lease_token, "completed", { durationMs: 1400, path: "normalized/preserved.wav", sha256: HASH }, null]);
    await rpc("dubbing_submit", [setup.session.id, YELLOW, 0, { "line-1": { kind: "take", takeId: trimmed.id } }, false]);
    await db.exec("update rehearsal_dubbing_takes set updated_at=now()-interval '8 days'");
    expect(await rpc("dubbing_sweep_maintenance", [100])).toMatchObject({ expiredGuides: 0, expiredTakes: 1, orphanObjects: 0 });
    const rows = await db.query<{ id: string; status: string }>("select id,status from rehearsal_dubbing_takes");
    expect(rows.rows.find((t) => t.id === abandoned.id)?.status).toBe("revoked");
    expect(rows.rows.find((t) => t.id === trimmed.id)?.status).toBe("ready");
    expect(rows.rows.find((t) => t.id === original.id)?.status).toBe("needs_trim");
  });

  it("queues only old, unreferenced application objects and leaves fresh or unknown objects alone", async () => {
    const setup = await readyGuide();
    const oldPath = `guides/${setup.guide.id}/orphan.mp4`;
    const freshPath = `guides/${setup.guide.id}/fresh.mp4`;
    const referenced = `guides/${setup.guide.id}/referenced.mp4`;
    await db.query("update rehearsal_dubbing_guides set result=result||jsonb_build_object('sourcePath',$2::text) where id=$1", [setup.guide.id, referenced]);
    for (const path of [oldPath, referenced, "unknown/operator-file.mp4"]) {
      await db.query("insert into storage.objects(bucket_id,name,created_at) values('rehearsal-dubbing',$1,now()-interval '2 days')", [path]);
    }
    await db.query("insert into storage.objects(bucket_id,name) values('rehearsal-dubbing',$1)", [freshPath]);
    expect(await rpc("dubbing_sweep_maintenance", [100])).toMatchObject({ expiredGuides: 0, expiredTakes: 0, orphanObjects: 1 });
    const purge = await claim();
    expect(purge.result.paths).toEqual([oldPath]);
    expect(await rpc("dubbing_sweep_maintenance", [100])).toMatchObject({ expiredGuides: 0, expiredTakes: 0, orphanObjects: 0 });
  });

  it("prevents delayed orphan purge from deleting a newly attached recording on the same path", async () => {
    const setup = await readyGuide();
    const path = `uploads/${setup.guide.id}/${YELLOW}/old-request/recording.webm`;
    await db.query("insert into storage.objects(bucket_id,name,created_at) values('rehearsal-dubbing',$1,now()-interval '2 days')", [path]);
    await rpc("dubbing_sweep_maintenance", [100]);
    const purge = await claim();
    expect(purge.result.reason).toBe("orphan");
    await expect(rpc("dubbing_enqueue_take", [setup.session.id, YELLOW, "line-1", randomUUID(), HASH, path])).rejects.toThrow("DUBBING_UPLOAD_EXPIRED");
    await rpc("dubbing_finish_job", [purge.id, purge.lease_token, "completed", { purgedPaths: [path] }, null]);
    // A storage upload observed before deletion is not proof the object still exists.
    await expect(rpc("dubbing_enqueue_take", [setup.session.id, YELLOW, "line-1", randomUUID(), HASH, path])).rejects.toThrow("DUBBING_UPLOAD_EXPIRED");
    const fresh = await rpc<DbTake>("dubbing_enqueue_take", [setup.session.id, YELLOW, "line-1", randomUUID(), HASH, `uploads/${setup.guide.id}/${YELLOW}/fresh-request/recording.webm`]);
    expect(fresh.status).toBe("pending");
  });

  it("retries failed recording deletion after a backoff and reports exhausted cleanup", async () => {
    const setup = await readyGuide();
    const recording = await take(setup.session);
    await rpc("dubbing_revoke_take", [recording.id, YELLOW]);
    let purge = await claim();
    expect(purge.kind).toBe("purge");
    expect(purge.result.paths).toContain(recording.result.path);
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(purge.attempt).toBe(attempt);
      await rpc("dubbing_finish_job", [purge.id, purge.lease_token, "failed", {}, "STORAGE_DELETE_FAILED"]);
      expect(await rpc("dubbing_sweep_maintenance", [100])).toMatchObject({ retriedPurges: 0, exhaustedPurges: attempt === 5 ? 1 : 0 });
      await db.query("update rehearsal_dubbing_jobs set updated_at=now()-interval '6 minutes' where id=$1", [purge.id]);
      const result = await rpc("dubbing_sweep_maintenance", [100]);
      if (attempt === 5) {
        expect(result).toMatchObject({ retriedPurges: 0, exhaustedPurges: 1 });
        expect(await claim()).toBeNull();
      } else {
        expect(result).toMatchObject({ retriedPurges: 1, exhaustedPurges: 0 });
        const retried = await claim();
        expect(retried.id).toBe(purge.id);
        expect(retried.result.paths).toEqual(purge.result.paths);
        expect(retried.lease_token).not.toBe(purge.lease_token);
        purge = retried;
      }
    }
  });
});

describe("server store boundary", () => {
  it("passes lease tokens to atomic RPCs and never leaks database diagnostics", async () => {
    const call = vi.fn().mockResolvedValue({ data: false, error: null });
    const store = createDubbingStore({ rpc: call } as unknown as SupabaseClient);
    expect(await store.finishJob("job", "lease", "completed", { videoPath: "private/output.mp4" })).toBe(false);
    expect(call).toHaveBeenCalledWith("dubbing_finish_job", expect.objectContaining({ p_job_id: "job", p_lease_token: "lease" }));
    call.mockResolvedValue({ data: null, error: { message: "DUBBING_CONFLICT detail: private-token-and-text" } });
    await expect(store.renewJob("job", "lease")).rejects.toMatchObject({ code: "DUBBING_CONFLICT", message: "DUBBING_CONFLICT" });
  });
});
