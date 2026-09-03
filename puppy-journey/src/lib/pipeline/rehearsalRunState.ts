import {
  REHEARSAL_STAGES,
  type RehearsalRunState,
  type RehearsalStage,
  type RehearsalStageState,
} from "./types";

type NewRunInput = Pick<RehearsalRunState, "id" | "coupleId" | "authorId"> & { now: string };

function stageIndex(stage: RehearsalStage): number {
  return REHEARSAL_STAGES.indexOf(stage);
}

function withStage(
  run: RehearsalRunState,
  stage: RehearsalStage,
  state: RehearsalStageState,
  now: string,
  status: RehearsalRunState["status"],
): RehearsalRunState {
  return {
    ...run,
    status,
    stages: { ...run.stages, [stage]: state },
    updatedAt: now,
  };
}

export function createRehearsalRunState(input: NewRunInput): RehearsalRunState {
  const stages = Object.fromEntries(
    REHEARSAL_STAGES.map((stage, index) => [
      stage,
      { status: index === 0 ? "ready" : "pending", attempt: 0 },
    ]),
  ) as RehearsalRunState["stages"];

  return {
    schemaVersion: 1,
    id: input.id,
    coupleId: input.coupleId,
    authorId: input.authorId,
    status: "queued",
    stages,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function startRehearsalStage(
  run: RehearsalRunState,
  stage: RehearsalStage,
  now: string,
): RehearsalRunState {
  const current = run.stages[stage];
  if (current.status !== "ready") {
    throw new Error(`Cannot start ${stage} from ${current.status}`);
  }

  return withStage(
    run,
    stage,
    { status: "running", attempt: current.attempt + 1, startedAt: now },
    now,
    "running",
  );
}

export function completeRehearsalStage(
  run: RehearsalRunState,
  stage: RehearsalStage,
  now: string,
): RehearsalRunState {
  const current = run.stages[stage];
  if (current.status !== "running") {
    throw new Error(`Cannot complete ${stage} from ${current.status}`);
  }

  const index = stageIndex(stage);
  const nextStage = REHEARSAL_STAGES[index + 1];
  const stages = {
    ...run.stages,
    [stage]: { ...current, status: "completed" as const, completedAt: now },
  };
  if (nextStage) {
    stages[nextStage] = { status: "ready", attempt: stages[nextStage].attempt };
  }

  return {
    ...run,
    status: nextStage ? "running" : "completed",
    stages,
    updatedAt: now,
  };
}

export function failRehearsalStage(
  run: RehearsalRunState,
  stage: RehearsalStage,
  error: string,
  now: string,
): RehearsalRunState {
  const current = run.stages[stage];
  if (current.status !== "running") {
    throw new Error(`Cannot fail ${stage} from ${current.status}`);
  }

  return withStage(
    run,
    stage,
    {
      ...current,
      status: "failed",
      completedAt: now,
      error: error.trim() || "Unknown stage failure",
    },
    now,
    "failed",
  );
}

export function retryFailedRehearsalStage(
  run: RehearsalRunState,
  stage: RehearsalStage,
  now: string,
): RehearsalRunState {
  const current = run.stages[stage];
  if (current.status !== "failed") {
    throw new Error(`Cannot retry ${stage} from ${current.status}`);
  }

  const ready = withStage(
    run,
    stage,
    { status: "ready", attempt: current.attempt },
    now,
    "running",
  );
  return startRehearsalStage(ready, stage, now);
}
