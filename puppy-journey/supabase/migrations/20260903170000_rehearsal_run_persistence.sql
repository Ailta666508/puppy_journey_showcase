-- Persist resumable rehearsal stage state and deduplicate client retries.
alter table public.rehearsal_pipeline_jobs
  add column if not exists run_state jsonb,
  add column if not exists idempotency_key text;

create unique index if not exists rehearsal_pipeline_jobs_idempotency_idx
  on public.rehearsal_pipeline_jobs (couple_id, author_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists rehearsal_pipeline_jobs_history_idx
  on public.rehearsal_pipeline_jobs (couple_id, updated_at desc);

comment on column public.rehearsal_pipeline_jobs.run_state is
  'Versioned state for resumable context, script, image, video, and learning stages.';
comment on column public.rehearsal_pipeline_jobs.idempotency_key is
  'Client-generated key used to deduplicate run creation within one author and relationship.';
