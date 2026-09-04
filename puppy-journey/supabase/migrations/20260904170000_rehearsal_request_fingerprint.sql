-- Prevent an idempotency key from silently replaying a different request body.
alter table public.rehearsal_pipeline_jobs
  add column if not exists request_fingerprint text;

comment on column public.rehearsal_pipeline_jobs.request_fingerprint is
  'SHA-256 of canonical script-generation inputs associated with an idempotency key.';
