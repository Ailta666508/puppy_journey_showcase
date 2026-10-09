import type { SupabaseClient } from "@supabase/supabase-js";
import type { DubbingParticipants } from "./access";
import type { DogSpeakerKey, DubbingPlan, DubbingTimeline } from "./contracts";
import type { DubbingRenderManifest, RenderChoice } from "./renderPlan";

export const DUBBING_BUCKET = "rehearsal-dubbing";
export type DubbingMediaResult = {
  path?: string;
  originalPath?: string;
  sha256?: string;
  durationMs?: number;
  sizeBytes?: number;
  status?: "ready" | "needs_trim";
  trimStartMs?: number;
  trimEndMs?: number;
  [key: string]: unknown;
};
export type DubbingGuideResult = {
  requestDigest?: string;
  sourceUrl?: string;
  sourcePath?: string;
  sourceSha256?: string;
  sourceDurationMs?: number;
  timeline?: DubbingTimeline;
  timelineDigest?: string;
  durationConfirmed?: boolean;
  guideAudio?: { lineId: string; path: string; sha256: string; durationMs: number }[];
  videoPath?: string;
  subtitlePath?: string;
  synthetic?: boolean;
  ttsPendingLine?: string | null;
  [key: string]: unknown;
};
type Dates = { created_at: string; updated_at: string };
export type DbGuide = Dates & {
  id: string; pipeline_job_id: string; couple_id: string; created_by: string;
  participants: DubbingParticipants; plan: DubbingPlan;
  status: "queued" | "running" | "awaiting_confirmation" | "ready" | "failed" | "revoked";
  result: DubbingGuideResult; error_code: string | null;
};
export type DbSession = Dates & {
  id: string; guide_id: string; couple_id: string; participants: DubbingParticipants;
  status: "active" | "revoked";
};
export type DbTake = Dates & {
  id: string; session_id: string; guide_id: string; owner_id: string;
  role: DogSpeakerKey; line_id: string;
  status: "pending" | "validating" | "ready" | "needs_trim" | "failed" | "revoked";
  visibility: "private" | "shared" | "revoked";
  result: DubbingMediaResult; error_code: string | null;
};
export type DbSubmission = {
  id: string; session_id: string; owner_id: string; role: DogSpeakerKey;
  revision: number; choices: Record<string, RenderChoice>; shared: boolean; updated_at: string;
};
export type DbRender = Dates & {
  id: string; session_id: string; guide_id: string; created_by: string;
  manifest: DubbingRenderManifest; digest: string;
  consents: { userId: string; digest: string }[];
  status: "awaiting_consent" | "queued" | "running" | "completed" | "failed" | "cancelled" | "revoked";
  result: { videoPath?: string; subtitlePath?: string; synthetic?: boolean; [key: string]: unknown };
  error_code: string | null;
};
export type DbJob = Dates & {
  id: string; kind: "guide" | "validate_take" | "render" | "purge";
  target_id: string; guide_id: string;
  status: "queued" | "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled";
  attempt: number; worker_id: string | null; lease_token: string | null;
  lease_expires_at: string | null; result: Record<string, unknown>; error_code: string | null;
};

export class DubbingStoreError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DubbingStoreError";
  }
}

function fail(error: { message?: string; code?: string }): never {
  // Database detail/context can contain SQL values. Return only our stable code.
  const code = error.message?.match(/\bDUBBING_[A-Z_]+\b/)?.[0] ?? "DUBBING_STORE_UNAVAILABLE";
  throw new DubbingStoreError(code);
}

/** Trusted server/worker DAL. HTTP handlers still authorize reads before returning data. */
export function createDubbingStore(client: SupabaseClient) {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) fail(error);
    return data as T;
  }
  async function row<T>(suffix: string, id: string): Promise<T | null> {
    const { data, error } = await client.from(`rehearsal_dubbing_${suffix}`).select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data as T | null;
  }
  async function rows<T>(suffix: string, field: string, value: string): Promise<T[]> {
    const { data, error } = await client.from(`rehearsal_dubbing_${suffix}`).select("*").eq(field, value).order("created_at", { ascending: false });
    if (error) fail(error);
    return (data ?? []) as T[];
  }
  return {
    getGuide: (id: string) => row<DbGuide>("guides", id),
    getSession: (id: string) => row<DbSession>("sessions", id),
    getTake: (id: string) => row<DbTake>("takes", id),
    getRender: (id: string) => row<DbRender>("renders", id),
    getJob: (id: string) => row<DbJob>("jobs", id),
    guidesByPipeline: (id: string) => rows<DbGuide>("guides", "pipeline_job_id", id),
    async sessionByGuide(id: string): Promise<DbSession | null> {
      const { data, error } = await client.from("rehearsal_dubbing_sessions").select("*").eq("guide_id", id).maybeSingle();
      if (error) fail(error);
      return data as DbSession | null;
    },
    takesBySession: (id: string) => rows<DbTake>("takes", "session_id", id),
    takesByOwner: (id: string) => rows<DbTake>("takes", "owner_id", id),
    rendersBySession: (id: string) => rows<DbRender>("renders", "session_id", id),
    async submissionsBySession(id: string): Promise<DbSubmission[]> {
      const { data, error } = await client.from("rehearsal_dubbing_submissions").select("*").eq("session_id", id).order("updated_at", { ascending: false });
      if (error) fail(error);
      return (data ?? []) as DbSubmission[];
    },
    createGuide(input: { pipelineJobId: string; actorId: string; requestKey: string; requestDigest: string; plan: DubbingPlan }) {
      return rpc<DbGuide>("dubbing_create_guide", {
        p_pipeline_job_id: input.pipelineJobId, p_actor_id: input.actorId,
        p_request_key: input.requestKey, p_request_digest: input.requestDigest, p_plan: input.plan,
      });
    },
    createSession(guideId: string, actorId: string) {
      return rpc<DbSession>("dubbing_create_session", { p_guide_id: guideId, p_actor_id: actorId });
    },
    enqueueTake(input: { sessionId: string; actorId: string; lineId: string; requestKey: string; requestDigest: string; originalPath: string }) {
      return rpc<DbTake>("dubbing_enqueue_take", {
        p_session_id: input.sessionId, p_actor_id: input.actorId, p_line_id: input.lineId,
        p_request_key: input.requestKey, p_request_digest: input.requestDigest, p_original_path: input.originalPath,
      });
    },
    claimJob(workerId: string, leaseSeconds = 90) {
      return rpc<DbJob | null>("dubbing_claim_job", { p_worker_id: workerId, p_lease_seconds: leaseSeconds });
    },
    renewJob(jobId: string, token: string, leaseSeconds = 90) {
      return rpc<boolean>("dubbing_renew_job", { p_job_id: jobId, p_lease_token: token, p_lease_seconds: leaseSeconds });
    },
    checkpointJob(jobId: string, token: string, result: Record<string, unknown>) {
      return rpc<boolean>("dubbing_checkpoint_job", { p_job_id: jobId, p_lease_token: token, p_result: result });
    },
    finishJob(jobId: string, token: string, status: "completed" | "failed" | "awaiting_confirmation", result: Record<string, unknown>, errorCode: string | null = null) {
      return rpc<boolean>("dubbing_finish_job", { p_job_id: jobId, p_lease_token: token, p_status: status, p_result: result, p_error_code: errorCode });
    },
    confirmDuration(guideId: string, actorId: string, timelineDigest: string) {
      return rpc<DbGuide>("dubbing_confirm_duration", { p_guide_id: guideId, p_actor_id: actorId, p_timeline_digest: timelineDigest });
    },
    submit(input: { sessionId: string; actorId: string; expectedRevision: number; choices: Record<string, RenderChoice>; share: boolean }) {
      return rpc<DbSubmission>("dubbing_submit", { p_session_id: input.sessionId, p_actor_id: input.actorId, p_expected_revision: input.expectedRevision, p_choices: input.choices, p_share: input.share });
    },
    createRender(sessionId: string, actorId: string, manifest: DubbingRenderManifest) {
      return rpc<DbRender>("dubbing_create_render", { p_session_id: sessionId, p_actor_id: actorId, p_manifest: manifest });
    },
    consent(renderId: string, actorId: string, digest: string) {
      return rpc<DbRender>("dubbing_consent", { p_render_id: renderId, p_actor_id: actorId, p_digest: digest });
    },
    revokeTake(takeId: string, actorId: string) {
      return rpc<boolean>("dubbing_revoke_take", { p_take_id: takeId, p_actor_id: actorId });
    },
    trimTake(input: { takeId: string; actorId: string; startMs: number; endMs: number; requestKey: string; requestDigest: string }) {
      return rpc<DbTake>("dubbing_trim_take", {
        p_take_id: input.takeId, p_actor_id: input.actorId, p_start_ms: input.startMs, p_end_ms: input.endMs,
        p_request_key: input.requestKey, p_request_digest: input.requestDigest,
      });
    },
    cancelRender(renderId: string, actorId: string) {
      return rpc<DbRender>("dubbing_cancel_render", { p_render_id: renderId, p_actor_id: actorId });
    },
    retryJob(kind: "guide" | "validate_take" | "render", targetId: string, actorId: string, acknowledgeUnknown = false) {
      return rpc<DbJob>("dubbing_retry_job", { p_kind: kind, p_target_id: targetId, p_actor_id: actorId, p_acknowledge_unknown: acknowledgeUnknown });
    },
    sweepMaintenance(limit = 100) {
      return rpc<{ expiredGuides: number; expiredTakes: number; orphanObjects: number; retriedPurges: number; exhaustedPurges: number }>("dubbing_sweep_maintenance", { p_limit: limit });
    },
  };
}

export type DubbingStore = ReturnType<typeof createDubbingStore>;
