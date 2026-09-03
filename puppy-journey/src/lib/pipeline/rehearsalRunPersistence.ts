import {
  REHEARSAL_STAGES,
  type RehearsalRunState,
  type RehearsalRunStatus,
  type RehearsalStage,
  type RehearsalStageState,
  type RehearsalStageStatus,
} from "./types";

export type RehearsalRunPersistenceRow = {
  id: string;
  couple_id: string;
  author_id: string;
  run_state: unknown;
  created_at: string;
  updated_at: string;
};

const RUN_STATUSES = new Set<RehearsalRunStatus>([
  "queued",
  "running",
  "completed",
  "failed",
]);
const STAGE_STATUSES = new Set<RehearsalStageStatus>([
  "pending",
  "ready",
  "running",
  "completed",
  "failed",
]);

export class RehearsalRunPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RehearsalRunPersistenceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RehearsalRunPersistenceError(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function parseStage(value: unknown, stage: RehearsalStage): RehearsalStageState {
  if (!isRecord(value) || !STAGE_STATUSES.has(value.status as RehearsalStageStatus)) {
    throw new RehearsalRunPersistenceError(`stages.${stage}.status is invalid`);
  }
  if (!Number.isInteger(value.attempt) || Number(value.attempt) < 0) {
    throw new RehearsalRunPersistenceError(`stages.${stage}.attempt must be a non-negative integer`);
  }
  return {
    status: value.status as RehearsalStageStatus,
    attempt: Number(value.attempt),
    startedAt: optionalString(value.startedAt, `stages.${stage}.startedAt`),
    completedAt: optionalString(value.completedAt, `stages.${stage}.completedAt`),
    error: optionalString(value.error, `stages.${stage}.error`),
  };
}

function assertValidTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new RehearsalRunPersistenceError(`${field} must be an ISO timestamp`);
  }
}

export function assertRehearsalRunState(run: RehearsalRunState): void {
  requiredString(run.id, "id");
  requiredString(run.coupleId, "coupleId");
  requiredString(run.authorId, "authorId");
  assertValidTimestamp(run.createdAt, "createdAt");
  assertValidTimestamp(run.updatedAt, "updatedAt");
  if (Date.parse(run.updatedAt) < Date.parse(run.createdAt)) {
    throw new RehearsalRunPersistenceError("updatedAt cannot precede createdAt");
  }

  let frontier: RehearsalStageState | undefined;
  for (const stage of REHEARSAL_STAGES) {
    const state = run.stages[stage];
    if (!state) {
      throw new RehearsalRunPersistenceError(`stages.${stage} is missing`);
    }
    if (!frontier && state.status === "completed") {
      if (state.attempt < 1 || !state.startedAt || !state.completedAt) {
        throw new RehearsalRunPersistenceError(`completed stage ${stage} lacks attempt timestamps`);
      }
      continue;
    }
    if (!frontier && ["ready", "running", "failed"].includes(state.status)) {
      frontier = state;
      if (state.status !== "ready" && (state.attempt < 1 || !state.startedAt)) {
        throw new RehearsalRunPersistenceError(`active stage ${stage} lacks start metadata`);
      }
      if (state.status === "failed" && (!state.completedAt || !state.error)) {
        throw new RehearsalRunPersistenceError(`failed stage ${stage} lacks failure metadata`);
      }
      continue;
    }
    if (state.status !== "pending") {
      throw new RehearsalRunPersistenceError(`stage ${stage} is out of pipeline order`);
    }
  }

  if (!frontier) {
    if (run.status !== "completed") {
      throw new RehearsalRunPersistenceError("a fully completed run must have completed status");
    }
    return;
  }

  const expectedStatus: RehearsalRunStatus =
    frontier.status === "failed"
      ? "failed"
      : frontier.status === "ready" && REHEARSAL_STAGES[0] === "context" && run.stages.context.attempt === 0
        ? "queued"
        : "running";
  if (run.status !== expectedStatus) {
    throw new RehearsalRunPersistenceError(
      `run status ${run.status} does not match active stage status ${frontier.status}`,
    );
  }
}

export function rehearsalRunToPersistence(
  run: RehearsalRunState,
): RehearsalRunPersistenceRow {
  assertRehearsalRunState(run);
  return {
    id: run.id,
    couple_id: run.coupleId,
    author_id: run.authorId,
    run_state: JSON.parse(JSON.stringify(run)) as unknown,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}

export function rehearsalRunFromPersistence(
  row: RehearsalRunPersistenceRow,
): RehearsalRunState {
  if (!isRecord(row.run_state)) {
    throw new RehearsalRunPersistenceError("run_state must be a JSON object");
  }
  const stored = row.run_state;
  if (stored.schemaVersion !== 1) {
    throw new RehearsalRunPersistenceError("unsupported rehearsal run schema version");
  }
  if (!isRecord(stored.stages)) {
    throw new RehearsalRunPersistenceError("run_state.stages must be a JSON object");
  }
  const storedStages = stored.stages;
  const run: RehearsalRunState = {
    schemaVersion: 1,
    id: requiredString(stored.id, "run_state.id"),
    coupleId: requiredString(stored.coupleId, "run_state.coupleId"),
    authorId: requiredString(stored.authorId, "run_state.authorId"),
    status: stored.status as RehearsalRunStatus,
    stages: Object.fromEntries(
      REHEARSAL_STAGES.map((stage) => [stage, parseStage(storedStages[stage], stage)]),
    ) as Record<RehearsalStage, RehearsalStageState>,
    createdAt: requiredString(stored.createdAt, "run_state.createdAt"),
    updatedAt: requiredString(stored.updatedAt, "run_state.updatedAt"),
  };
  if (!RUN_STATUSES.has(run.status)) {
    throw new RehearsalRunPersistenceError("run_state.status is invalid");
  }
  if (run.id !== row.id || run.coupleId !== row.couple_id || run.authorId !== row.author_id) {
    throw new RehearsalRunPersistenceError("run_state identity does not match its database row");
  }
  assertRehearsalRunState(run);
  return run;
}
