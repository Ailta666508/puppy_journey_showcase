-- Role dubbing is opt-in. Only trusted API/worker clients can access these tables.
-- Membership snapshots deliberately survive relationship changes so recordings can
-- be revoked by their owners and storage cleanup can finish afterwards.
begin;

create table public.rehearsal_dubbing_guides (
  id uuid primary key default gen_random_uuid(),
  pipeline_job_id uuid not null,
  couple_id uuid not null,
  created_by uuid not null,
  participants jsonb not null check (jsonb_typeof(participants) = 'object'),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  status text not null default 'queued' check (status in ('queued','running','awaiting_confirmation','ready','failed','revoked')),
  result jsonb not null default '{}' check (jsonb_typeof(result) = 'object'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.rehearsal_dubbing_guides (couple_id, pipeline_job_id);

create table public.rehearsal_dubbing_sessions (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.rehearsal_dubbing_guides(id),
  couple_id uuid not null,
  participants jsonb not null,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guide_id)
);

create table public.rehearsal_dubbing_takes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.rehearsal_dubbing_sessions(id),
  guide_id uuid not null references public.rehearsal_dubbing_guides(id),
  owner_id uuid not null,
  role text not null check (role in ('yellow_dog','white_dog')),
  line_id text not null,
  status text not null default 'pending' check (status in ('pending','validating','ready','needs_trim','failed','revoked')),
  visibility text not null default 'private' check (visibility in ('private','shared','revoked')),
  result jsonb not null default '{}' check (jsonb_typeof(result) = 'object'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.rehearsal_dubbing_takes (session_id, owner_id);

create table public.rehearsal_dubbing_submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.rehearsal_dubbing_sessions(id),
  owner_id uuid not null,
  role text not null check (role in ('yellow_dog','white_dog')),
  revision integer not null check (revision > 0),
  choices jsonb not null check (jsonb_typeof(choices) = 'object'),
  shared boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (session_id, owner_id)
);

create table public.rehearsal_dubbing_renders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.rehearsal_dubbing_sessions(id),
  guide_id uuid not null references public.rehearsal_dubbing_guides(id),
  created_by uuid not null,
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  consents jsonb not null default '[]' check (jsonb_typeof(consents) = 'array'),
  status text not null default 'awaiting_consent' check (status in ('awaiting_consent','queued','running','completed','failed','cancelled','revoked')),
  result jsonb not null default '{}' check (jsonb_typeof(result) = 'object'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, digest)
);

create table public.rehearsal_dubbing_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('guide','validate_take','render','purge')),
  target_id uuid not null,
  guide_id uuid not null references public.rehearsal_dubbing_guides(id),
  status text not null default 'queued' check (status in ('queued','running','awaiting_confirmation','completed','failed','cancelled')),
  attempt integer not null default 0 check (attempt >= 0),
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb not null default '{}' check (jsonb_typeof(result) = 'object'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index rehearsal_dubbing_jobs_active on public.rehearsal_dubbing_jobs(kind,target_id)
  where status in ('queued','running','awaiting_confirmation');
create index on public.rehearsal_dubbing_jobs(status,created_at);

create table public.rehearsal_dubbing_assets (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.rehearsal_dubbing_guides(id),
  owner_id uuid,
  purpose text not null check (purpose in ('source','guide_audio','guide_video','take','render','subtitle')),
  object_path text not null unique,
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  duration_ms integer check (duration_ms > 0),
  bytes bigint check (bytes > 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.rehearsal_dubbing_requests (
  actor_id uuid not null,
  operation text not null,
  request_key text not null check (char_length(request_key) between 8 and 128),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor_id,operation,request_key)
);

insert into storage.buckets (id,name,public,file_size_limit)
values ('rehearsal-dubbing','rehearsal-dubbing',false,67108864)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Locks the current relationship and profiles through the publishing transaction.
create function public.dubbing_assert_scope(p_guide_id uuid,p_actor_id uuid default null)
returns public.rehearsal_dubbing_guides language plpgsql set search_path = public as $$
declare g public.rehearsal_dubbing_guides; c public.couples; y uuid; w uuid;
begin
  select * into g from public.rehearsal_dubbing_guides where id=p_guide_id;
  if not found or g.status='revoked' then raise exception 'DUBBING_NOT_FOUND'; end if;
  select * into c from public.couples where id=g.couple_id for share;
  if not found then raise exception 'DUBBING_NOT_FOUND'; end if;
  y := (g.participants->>'yellowDogId')::uuid;
  w := (g.participants->>'whiteDogId')::uuid;
  if c.yellow_dog_id is distinct from y or c.white_dog_id is distinct from w
     or (y is not null and y=w) then raise exception 'DUBBING_NOT_FOUND'; end if;
  if y is not null then
    perform 1 from public.profiles where id=y and couple_id=c.id and role='yellow_dog' for share;
    if not found then raise exception 'DUBBING_NOT_FOUND'; end if;
  end if;
  if w is not null then
    perform 1 from public.profiles where id=w and couple_id=c.id and role='white_dog' for share;
    if not found then raise exception 'DUBBING_NOT_FOUND'; end if;
  end if;
  if p_actor_id is not null and p_actor_id is distinct from y and p_actor_id is distinct from w then
    raise exception 'DUBBING_NOT_FOUND';
  end if;
  return g;
end $$;

create function public.dubbing_create_guide(p_pipeline_job_id uuid,p_actor_id uuid,p_request_key text,p_request_digest text,p_plan jsonb)
returns public.rehearsal_dubbing_guides language plpgsql set search_path = public as $$
declare j public.rehearsal_pipeline_jobs; c public.couples; g public.rehearsal_dubbing_guides; r public.rehearsal_dubbing_requests; op text;
begin
  if p_actor_id is null or p_plan->>'planVersion' is distinct from '1' or p_plan->>'locale' is distinct from 'es-ES'
    or coalesce(p_plan->>'scriptDigest','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_plan->'lines') is distinct from 'array'
    or char_length(p_request_key) not between 8 and 128 or p_request_digest !~ '^[a-f0-9]{64}$' then raise exception 'DUBBING_INVALID_INPUT'; end if;
  select * into j from public.rehearsal_pipeline_jobs where id=p_pipeline_job_id;
  if not found or j.couple_id is null then raise exception 'DUBBING_NOT_FOUND'; end if;
  select * into c from public.couples where id=j.couple_id for share;
  if not found or (p_actor_id is distinct from c.yellow_dog_id and p_actor_id is distinct from c.white_dog_id) then raise exception 'DUBBING_NOT_FOUND'; end if;
  op := 'guide:' || p_pipeline_job_id;
  perform pg_advisory_xact_lock(hashtext(p_actor_id::text || op || p_request_key));
  select * into r from public.rehearsal_dubbing_requests where actor_id=p_actor_id and operation=op and request_key=p_request_key;
  if found then
    if r.request_digest<>p_request_digest then raise exception 'DUBBING_CONFLICT'; end if;
    return public.dubbing_assert_scope(r.resource_id,p_actor_id);
  end if;
  if coalesce(j.video_url,'')='' or j.status<>'completed' then raise exception 'DUBBING_VIDEO_NOT_READY'; end if;
  perform pg_advisory_xact_lock(hashtext('guide-quota:'||c.id));
  select * into g from public.rehearsal_dubbing_guides
    where pipeline_job_id=j.id and status<>'revoked' and plan->>'scriptDigest'=p_plan->>'scriptDigest'
      and error_code is distinct from 'GUIDE_EXPIRED'
      and result->>'sourceUrl'=j.video_url
      and result->>'requestDigest'=p_request_digest
      and participants=jsonb_build_object('coupleId',c.id,'yellowDogId',c.yellow_dog_id,'whiteDogId',c.white_dog_id)
    order by created_at desc limit 1;
  if found then
    perform public.dubbing_assert_scope(g.id,p_actor_id);
    insert into public.rehearsal_dubbing_requests values(p_actor_id,op,p_request_key,p_request_digest,g.id,now());
    return g;
  end if;
  if (select count(*) from public.rehearsal_dubbing_guides where couple_id=c.id and created_at>now()-interval '1 day')>=10 then raise exception 'DUBBING_QUOTA_EXCEEDED'; end if;
  insert into public.rehearsal_dubbing_guides(pipeline_job_id,couple_id,created_by,participants,plan,result)
  values (j.id,c.id,p_actor_id,jsonb_build_object('coupleId',c.id,'yellowDogId',c.yellow_dog_id,'whiteDogId',c.white_dog_id),p_plan,jsonb_build_object('sourceUrl',j.video_url,'requestDigest',p_request_digest)) returning * into g;
  perform public.dubbing_assert_scope(g.id,p_actor_id);
  insert into public.rehearsal_dubbing_requests values (p_actor_id,op,p_request_key,p_request_digest,g.id,now());
  insert into public.rehearsal_dubbing_jobs(kind,target_id,guide_id) values ('guide',g.id,g.id);
  return g;
end $$;

create function public.dubbing_create_session(p_guide_id uuid,p_actor_id uuid)
returns public.rehearsal_dubbing_sessions language plpgsql set search_path = public as $$
declare g public.rehearsal_dubbing_guides; s public.rehearsal_dubbing_sessions;
begin
  if p_actor_id is null then raise exception 'DUBBING_NOT_FOUND'; end if;
  g := public.dubbing_assert_scope(p_guide_id,p_actor_id);
  if g.status<>'ready' then raise exception 'DUBBING_GUIDE_NOT_READY'; end if;
  insert into public.rehearsal_dubbing_sessions(guide_id,couple_id,participants)
    values (g.id,g.couple_id,g.participants) on conflict (guide_id) do nothing;
  select * into s from public.rehearsal_dubbing_sessions where guide_id=g.id;
  if s.status<>'active' then raise exception 'DUBBING_NOT_FOUND'; end if;
  return s;
end $$;

create function public.dubbing_enqueue_take(p_session_id uuid,p_actor_id uuid,p_line_id text,p_request_key text,p_request_digest text,p_original_path text)
returns public.rehearsal_dubbing_takes language plpgsql set search_path = public as $$
declare s public.rehearsal_dubbing_sessions; g public.rehearsal_dubbing_guides; t public.rehearsal_dubbing_takes; r public.rehearsal_dubbing_requests; role_key text; op text;
begin
  if p_actor_id is null then raise exception 'DUBBING_NOT_FOUND'; end if;
  select * into s from public.rehearsal_dubbing_sessions where id=p_session_id;
  if not found or s.status<>'active' then raise exception 'DUBBING_NOT_FOUND'; end if;
  g := public.dubbing_assert_scope(s.guide_id,p_actor_id);
  if g.status<>'ready' then raise exception 'DUBBING_GUIDE_NOT_READY'; end if;
  role_key := case when g.participants->>'yellowDogId'=p_actor_id::text then 'yellow_dog' else 'white_dog' end;
  if not exists(select 1 from jsonb_array_elements(g.plan->'lines') l where l->>'lineId'=p_line_id and l->>'speakerKey'=role_key and l->>'dubbable'='true') then raise exception 'DUBBING_NOT_FOUND'; end if;
  if p_original_path is null or p_original_path !~ '^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.[a-zA-Z0-9]+$' or position('..' in p_original_path)>0 then raise exception 'DUBBING_INVALID_INPUT'; end if;
  op := 'take:' || s.id;
  perform pg_advisory_xact_lock(hashtext(p_actor_id::text || op || p_request_key));
  select * into r from public.rehearsal_dubbing_requests where actor_id=p_actor_id and operation=op and request_key=p_request_key;
  if found then
    if r.request_digest<>p_request_digest then raise exception 'DUBBING_CONFLICT'; end if;
    select * into t from public.rehearsal_dubbing_takes where id=r.resource_id;
    return t;
  end if;
  perform pg_advisory_xact_lock(hashtext('dubbing-storage-path:'||p_original_path));
  -- Once orphan cleanup has reserved a path, never attach it to a new take.
  -- This also covers a lost Storage delete response and already-completed purge.
  if exists(select 1 from public.rehearsal_dubbing_jobs j where j.kind='purge'
    and j.result->>'reason'='orphan' and j.result->'paths' ? p_original_path) then raise exception 'DUBBING_UPLOAD_EXPIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('take-quota:'||p_actor_id));
  if (select count(*) from public.rehearsal_dubbing_takes where owner_id=p_actor_id and created_at>now()-interval '1 day')>=100
    or (select count(*) from public.rehearsal_dubbing_takes where session_id=s.id and owner_id=p_actor_id)>=60 then raise exception 'DUBBING_QUOTA_EXCEEDED'; end if;
  insert into public.rehearsal_dubbing_takes(session_id,guide_id,owner_id,role,line_id,result)
    values (s.id,g.id,p_actor_id,role_key,p_line_id,jsonb_build_object('originalPath',p_original_path)) returning * into t;
  insert into public.rehearsal_dubbing_requests values(p_actor_id,op,p_request_key,p_request_digest,t.id,now());
  insert into public.rehearsal_dubbing_jobs(kind,target_id,guide_id) values('validate_take',t.id,g.id);
  return t;
end $$;

-- All publishers take membership locks, then material/target locks, then the job
-- lease lock. Membership changes and voice revocation follow the same direction.
create function public.dubbing_lock_target(p_kind text,p_target_id uuid)
returns void language plpgsql set search_path = public as $$
begin
  if p_kind='guide' then
    perform id from public.rehearsal_dubbing_guides where id=p_target_id for update;
  elsif p_kind='validate_take' then
    perform id from public.rehearsal_dubbing_takes where id=p_target_id for update;
  elsif p_kind='render' then
    perform t.id from public.rehearsal_dubbing_takes t where exists(
      select 1 from public.rehearsal_dubbing_renders r cross join lateral jsonb_array_elements(r.manifest->'lines') l
      where r.id=p_target_id and l->'source'->>'takeId'=t.id::text
    ) order by t.id for update;
    perform id from public.rehearsal_dubbing_renders where id=p_target_id for update;
  end if;
end $$;

create function public.dubbing_claim_job(p_worker_id text,p_lease_seconds integer default 90)
returns public.rehearsal_dubbing_jobs language plpgsql set search_path = public as $$
declare j public.rehearsal_dubbing_jobs; candidate public.rehearsal_dubbing_jobs;
begin
  if p_worker_id is null or char_length(p_worker_id) not between 1 and 128 or p_lease_seconds is null or p_lease_seconds not between 15 and 300 then raise exception 'DUBBING_INVALID_INPUT'; end if;
  for candidate in select * from public.rehearsal_dubbing_jobs
    where status='queued' or (status='running' and lease_expires_at<now())
    order by created_at,id limit 20 loop
    begin
      if candidate.kind<>'purge' then perform public.dubbing_assert_scope(candidate.guide_id); end if;
    exception when raise_exception then
      if sqlerrm='DUBBING_NOT_FOUND' then continue; else raise; end if;
    end;
    perform public.dubbing_lock_target(candidate.kind,candidate.target_id);
    select * into j from public.rehearsal_dubbing_jobs where id=candidate.id
      and (status='queued' or (status='running' and lease_expires_at<now())) for update skip locked;
    if not found then continue; end if;
    update public.rehearsal_dubbing_jobs set status='running',attempt=attempt+1,worker_id=p_worker_id,
      lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
      where id=j.id returning * into j;
    if j.kind='guide' then update public.rehearsal_dubbing_guides set status='running',updated_at=now() where id=j.target_id and status not in ('ready','revoked'); end if;
    if j.kind='validate_take' then update public.rehearsal_dubbing_takes set status='validating',updated_at=now() where id=j.target_id and status='pending'; end if;
    if j.kind='render' then update public.rehearsal_dubbing_renders set status='running',updated_at=now() where id=j.target_id and status='queued'; end if;
    return j;
  end loop;
  return null;
end $$;

create function public.dubbing_renew_job(p_job_id uuid,p_lease_token uuid,p_lease_seconds integer default 90)
returns boolean language plpgsql set search_path = public as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then raise exception 'DUBBING_INVALID_INPUT'; end if;
  update public.rehearsal_dubbing_jobs set lease_expires_at=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
    where id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now();
  return found;
end $$;

create function public.dubbing_checkpoint_job(p_job_id uuid,p_lease_token uuid,p_result jsonb)
returns boolean language plpgsql set search_path = public as $$
declare j public.rehearsal_dubbing_jobs;
begin
  if jsonb_typeof(p_result) is distinct from 'object' then raise exception 'DUBBING_INVALID_INPUT'; end if;
  select * into j from public.rehearsal_dubbing_jobs where id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now();
  if not found then return false; end if;
  if j.kind<>'purge' then perform public.dubbing_assert_scope(j.guide_id); end if;
  perform public.dubbing_lock_target(j.kind,j.target_id);
  select * into j from public.rehearsal_dubbing_jobs where id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  update public.rehearsal_dubbing_jobs set result=result||p_result,updated_at=now() where id=j.id;
  if j.kind='guide' then update public.rehearsal_dubbing_guides set result=result||p_result,updated_at=now() where id=j.target_id and status='running'; end if;
  if j.kind='validate_take' then update public.rehearsal_dubbing_takes set result=result||p_result,updated_at=now() where id=j.target_id and status='validating'; end if;
  if j.kind='render' then update public.rehearsal_dubbing_renders set result=result||p_result,updated_at=now() where id=j.target_id and status='running'; end if;
  return true;
end $$;

create function public.dubbing_finish_job(p_job_id uuid,p_lease_token uuid,p_status text,p_result jsonb,p_error_code text default null)
returns boolean language plpgsql set search_path = public as $$
declare j public.rehearsal_dubbing_jobs; new_status text; window_ms numeric; target_render public.rehearsal_dubbing_renders; merged_result jsonb;
begin
  if p_status not in ('completed','failed','awaiting_confirmation') or jsonb_typeof(p_result) is distinct from 'object' then raise exception 'DUBBING_INVALID_INPUT'; end if;
  select * into j from public.rehearsal_dubbing_jobs where id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now();
  if not found then return false; end if;
  if p_status='awaiting_confirmation' and j.kind<>'guide' then raise exception 'DUBBING_INVALID_INPUT'; end if;
  if j.kind<>'purge' then perform public.dubbing_assert_scope(j.guide_id); end if;
  perform public.dubbing_lock_target(j.kind,j.target_id);
  select * into j from public.rehearsal_dubbing_jobs where id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  if j.kind='guide' then
    select result||p_result into merged_result from public.rehearsal_dubbing_guides where id=j.target_id;
    if p_status in ('completed','awaiting_confirmation') and (
      coalesce(merged_result->>'sourceSha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(merged_result->>'timelineDigest','') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(merged_result->'timeline') is distinct from 'object'
      or merged_result->'timeline'->>'status' not in ('ready','needs_confirmation')
    ) then raise exception 'DUBBING_INVALID_MEDIA'; end if;
    if p_status='completed' and (coalesce(merged_result->>'videoPath','')=''
      or (merged_result->'timeline'->>'status'='needs_confirmation' and merged_result->>'durationConfirmed' is distinct from 'true')) then raise exception 'DUBBING_INVALID_MEDIA'; end if;
    if p_status='awaiting_confirmation' and merged_result->'timeline'->>'status' is distinct from 'needs_confirmation' then raise exception 'DUBBING_INVALID_MEDIA'; end if;
    new_status := case p_status when 'completed' then 'ready' else p_status end;
    update public.rehearsal_dubbing_guides set status=new_status,result=result||p_result,error_code=p_error_code,updated_at=now() where id=j.target_id and status='running';
    if not found then return false; end if;
  elsif j.kind='validate_take' then
    if p_status='completed' and (coalesce(p_result->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce((p_result->>'durationMs')::numeric,0)<=0 or (p_result->>'durationMs')::numeric>10000) then raise exception 'DUBBING_INVALID_MEDIA'; end if;
    select (l->>'windowMs')::numeric into window_ms from public.rehearsal_dubbing_takes t
      join public.rehearsal_dubbing_guides g on g.id=t.guide_id cross join lateral jsonb_array_elements(g.result->'timeline'->'lines') l
      where t.id=j.target_id and l->>'lineId'=t.line_id;
    if p_status='completed' and (window_ms is null or window_ms<=0) then raise exception 'DUBBING_INVALID_MEDIA'; end if;
    new_status := case when p_status='failed' then 'failed' when (p_result->>'durationMs')::numeric>window_ms then 'needs_trim' else 'ready' end;
    update public.rehearsal_dubbing_takes set status=new_status,result=result||p_result,error_code=p_error_code,updated_at=now() where id=j.target_id and status='validating' and visibility<>'revoked';
    if not found then return false; end if;
  elsif j.kind='render' then
    -- A voice revoked after queueing may not be published by a late worker.
    if exists(select 1 from public.rehearsal_dubbing_renders r cross join lateral jsonb_array_elements(r.manifest->'lines') l
      left join public.rehearsal_dubbing_takes t on t.id=(l->'source'->>'takeId')::uuid
      where r.id=j.target_id and l->'source'->>'kind'='take' and (t.id is null or t.status<>'ready' or t.visibility='revoked'
        or t.session_id<>r.session_id or t.owner_id::text is distinct from l->'source'->>'ownerId'
        or t.result->>'sha256' is distinct from l->'source'->>'sha256'
        or (r.manifest->>'mode'='duet' and t.visibility<>'shared'))) then raise exception 'DUBBING_REVOKED'; end if;
    select * into target_render from public.rehearsal_dubbing_renders where id=j.target_id;
    if exists(select 1 from jsonb_array_elements_text(target_render.manifest->'requiredConsentIds') uid
      where not exists(select 1 from jsonb_array_elements(target_render.consents) c where c->>'userId'=uid and c->>'digest'=target_render.digest)) then raise exception 'DUBBING_REVOKED'; end if;
    if p_status='completed' and coalesce(p_result->>'videoPath',target_render.result->>'videoPath','')='' then raise exception 'DUBBING_INVALID_MEDIA'; end if;
    update public.rehearsal_dubbing_renders set status=p_status,result=result||p_result,error_code=p_error_code,updated_at=now() where id=j.target_id and status='running';
    if not found then return false; end if;
  end if;
  update public.rehearsal_dubbing_jobs set status=p_status,result=result||p_result,error_code=p_error_code,lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
  return true;
end $$;

create function public.dubbing_confirm_duration(p_guide_id uuid,p_actor_id uuid,p_timeline_digest text)
returns public.rehearsal_dubbing_guides language plpgsql set search_path = public as $$
declare g public.rehearsal_dubbing_guides;
begin
  if p_actor_id is null or p_timeline_digest is null then raise exception 'DUBBING_NOT_FOUND'; end if;
  perform public.dubbing_assert_scope(p_guide_id,p_actor_id);
  select * into g from public.rehearsal_dubbing_guides where id=p_guide_id for update;
  if g.created_by<>p_actor_id then raise exception 'DUBBING_NOT_FOUND'; end if;
  if g.result->>'timelineDigest' is distinct from p_timeline_digest then raise exception 'DUBBING_CONFLICT'; end if;
  if g.status in ('queued','running','ready') and g.result->>'durationConfirmed'='true' then return g; end if;
  if g.status<>'awaiting_confirmation' then raise exception 'DUBBING_CONFLICT'; end if;
  update public.rehearsal_dubbing_guides set status='queued',result=result||'{"durationConfirmed":true}',updated_at=now() where id=g.id returning * into g;
  update public.rehearsal_dubbing_jobs set status='queued',result=result||'{"durationConfirmed":true}',updated_at=now() where kind='guide' and target_id=g.id and status='awaiting_confirmation';
  if not found then raise exception 'DUBBING_CONFLICT'; end if;
  return g;
end $$;

create function public.dubbing_submit(p_session_id uuid,p_actor_id uuid,p_expected_revision integer,p_choices jsonb,p_share boolean)
returns public.rehearsal_dubbing_submissions language plpgsql set search_path = public as $$
declare s public.rehearsal_dubbing_sessions; g public.rehearsal_dubbing_guides; sub public.rehearsal_dubbing_submissions; l jsonb; choice jsonb; role_key text; n integer;
begin
  if p_actor_id is null then raise exception 'DUBBING_NOT_FOUND'; end if;
  select * into s from public.rehearsal_dubbing_sessions where id=p_session_id;
  if not found or s.status<>'active' then raise exception 'DUBBING_NOT_FOUND'; end if;
  g := public.dubbing_assert_scope(s.guide_id,p_actor_id);
  role_key := case when g.participants->>'yellowDogId'=p_actor_id::text then 'yellow_dog' else 'white_dog' end;
  if jsonb_typeof(p_choices) is distinct from 'object' then raise exception 'DUBBING_INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext(s.id::text||p_actor_id::text));
  select * into sub from public.rehearsal_dubbing_submissions where session_id=s.id and owner_id=p_actor_id for update;
  if coalesce(sub.revision,0)<>p_expected_revision then raise exception 'DUBBING_CONFLICT'; end if;
  select count(*) into n from jsonb_array_elements(g.plan->'lines') x where x->>'speakerKey'=role_key;
  if (select count(*) from jsonb_object_keys(p_choices))<>n then raise exception 'DUBBING_INCOMPLETE_CHOICES'; end if;
  perform t.id from public.rehearsal_dubbing_takes t where t.session_id=s.id and t.owner_id=p_actor_id
    and exists(select 1 from jsonb_each(p_choices) choice_row where choice_row.value->>'takeId'=t.id::text)
    order by t.id for update;
  for l in select value from jsonb_array_elements(g.plan->'lines') where value->>'speakerKey'=role_key loop
    choice := p_choices->(l->>'lineId');
    if choice->>'kind'='ai' then continue; end if;
    if choice->>'kind' is distinct from 'take' then raise exception 'DUBBING_INCOMPLETE_CHOICES'; end if;
    perform 1 from public.rehearsal_dubbing_takes where id=(choice->>'takeId')::uuid and session_id=s.id and owner_id=p_actor_id and role=role_key and line_id=l->>'lineId' and status='ready' and visibility<>'revoked' for update;
    if not found then raise exception 'DUBBING_INVALID_TAKE'; end if;
    if p_share then update public.rehearsal_dubbing_takes set visibility='shared',updated_at=now() where id=(choice->>'takeId')::uuid; end if;
  end loop;
  insert into public.rehearsal_dubbing_submissions(session_id,owner_id,role,revision,choices,shared)
    values(s.id,p_actor_id,role_key,p_expected_revision+1,p_choices,p_share)
    on conflict(session_id,owner_id) do update set revision=excluded.revision,choices=excluded.choices,shared=excluded.shared,updated_at=now() returning * into sub;
  update public.rehearsal_dubbing_renders set status='cancelled',consents='[]',updated_at=now()
    where session_id=s.id and status in ('awaiting_consent','queued','running') and manifest->'requiredConsentIds' ? p_actor_id::text;
  update public.rehearsal_dubbing_jobs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
    where kind='render' and target_id in(select id from public.rehearsal_dubbing_renders where session_id=s.id and status='cancelled') and status in ('queued','running');
  return sub;
end $$;

create function public.dubbing_create_render(p_session_id uuid,p_actor_id uuid,p_manifest jsonb)
returns public.rehearsal_dubbing_renders language plpgsql set search_path = public as $$
declare s public.rehearsal_dubbing_sessions; g public.rehearsal_dubbing_guides; r public.rehearsal_dubbing_renders;
begin
  if p_actor_id is null then raise exception 'DUBBING_NOT_FOUND'; end if;
  select * into s from public.rehearsal_dubbing_sessions where id=p_session_id;
  if not found or s.status<>'active' then raise exception 'DUBBING_NOT_FOUND'; end if;
  g := public.dubbing_assert_scope(s.guide_id,p_actor_id);
  if p_manifest->>'sessionId' is distinct from s.id::text or p_manifest->>'requesterId' is distinct from p_actor_id::text
    or p_manifest->'participants' is distinct from g.participants or p_manifest->>'planDigest' is distinct from g.plan->>'scriptDigest'
    or p_manifest->>'timelineDigest' is distinct from g.result->>'timelineDigest'
    or p_manifest->>'sourceVideoSha256' is distinct from g.result->>'sourceSha256'
    or jsonb_typeof(p_manifest->'requiredConsentIds') is distinct from 'array' or jsonb_array_length(p_manifest->'requiredConsentIds') not between 1 and 2
    then raise exception 'DUBBING_INVALID_MANIFEST'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_manifest->'requiredConsentIds') u where u is distinct from g.participants->>'yellowDogId' and u is distinct from g.participants->>'whiteDogId') then raise exception 'DUBBING_INVALID_MANIFEST'; end if;
  select * into r from public.rehearsal_dubbing_renders where session_id=s.id and digest=p_manifest->>'digest';
  if found then return r; end if;
  perform pg_advisory_xact_lock(hashtext('render-quota:'||g.couple_id));
  if (select count(*) from public.rehearsal_dubbing_renders x join public.rehearsal_dubbing_guides y on y.id=x.guide_id where y.couple_id=g.couple_id and x.created_at>now()-interval '1 day')>=20 then raise exception 'DUBBING_QUOTA_EXCEEDED'; end if;
  insert into public.rehearsal_dubbing_renders(session_id,guide_id,created_by,manifest,digest)
    values(s.id,g.id,p_actor_id,p_manifest,p_manifest->>'digest') on conflict(session_id,digest) do nothing;
  select * into r from public.rehearsal_dubbing_renders where session_id=s.id and digest=p_manifest->>'digest';
  return r;
end $$;

create function public.dubbing_consent(p_render_id uuid,p_actor_id uuid,p_digest text)
returns public.rehearsal_dubbing_renders language plpgsql set search_path = public as $$
declare r public.rehearsal_dubbing_renders; consent_list jsonb;
begin
  if p_actor_id is null then raise exception 'DUBBING_NOT_FOUND'; end if;
  select * into r from public.rehearsal_dubbing_renders where id=p_render_id;
  if not found then raise exception 'DUBBING_NOT_FOUND'; end if;
  perform public.dubbing_assert_scope(r.guide_id,p_actor_id);
  perform public.dubbing_lock_target('render',p_render_id);
  select * into r from public.rehearsal_dubbing_renders where id=p_render_id for update;
  if r.digest is distinct from p_digest or not (r.manifest->'requiredConsentIds' ? p_actor_id::text) then raise exception 'DUBBING_CONFLICT'; end if;
  if r.status in ('queued','running','completed') then return r; end if;
  if r.status<>'awaiting_consent' then raise exception 'DUBBING_CONFLICT'; end if;
  if exists(select 1 from jsonb_array_elements(r.manifest->'submissions') x
    left join public.rehearsal_dubbing_submissions s on s.session_id=r.session_id and s.owner_id=(x->>'ownerId')::uuid
    where s.id is null or s.revision<>(x->>'revision')::integer) then raise exception 'DUBBING_CONFLICT'; end if;
  if exists(select 1 from jsonb_array_elements(r.manifest->'lines') l
    left join public.rehearsal_dubbing_takes t on t.id=(l->'source'->>'takeId')::uuid
    where l->'source'->>'kind'='take' and (t.id is null or t.status<>'ready' or t.visibility='revoked' or t.owner_id::text<>l->'source'->>'ownerId' or t.result->>'sha256' is distinct from l->'source'->>'sha256')) then raise exception 'DUBBING_INVALID_TAKE'; end if;
  select coalesce(jsonb_agg(v),'[]') into consent_list from jsonb_array_elements(r.consents) v where v->>'userId'<>p_actor_id::text;
  consent_list := consent_list || jsonb_build_array(jsonb_build_object('userId',p_actor_id,'digest',p_digest));
  update public.rehearsal_dubbing_renders set consents=consent_list,updated_at=now() where id=r.id returning * into r;
  if not exists(select 1 from jsonb_array_elements_text(r.manifest->'requiredConsentIds') uid where not exists(select 1 from jsonb_array_elements(consent_list) c where c->>'userId'=uid and c->>'digest'=p_digest)) then
    update public.rehearsal_dubbing_renders set status='queued',updated_at=now() where id=r.id returning * into r;
    insert into public.rehearsal_dubbing_jobs(kind,target_id,guide_id) values('render',r.id,r.guide_id);
  end if;
  return r;
end $$;

create function public.dubbing_revoke_take(p_take_id uuid,p_actor_id uuid)
returns boolean language plpgsql set search_path = public as $$
declare t public.rehearsal_dubbing_takes; purge_paths jsonb; revoked_ids uuid[];
begin
  select * into t from public.rehearsal_dubbing_takes where id=p_take_id and owner_id=p_actor_id for update;
  if not found then return false; end if;
  with recursive descendants as (
    select id from public.rehearsal_dubbing_takes where id=t.id
    union all select child.id from public.rehearsal_dubbing_takes child join descendants parent on child.result->>'parentTakeId'=parent.id::text where child.owner_id=p_actor_id
  ) select array_agg(id) into revoked_ids from descendants;
  update public.rehearsal_dubbing_takes set status='revoked',visibility='revoked',updated_at=now() where id=any(revoked_ids);
  update public.rehearsal_dubbing_renders set status='revoked',consents='[]',updated_at=now()
    where session_id=t.session_id and exists(select 1 from jsonb_array_elements(manifest->'lines') l where (l->'source'->>'takeId')::uuid=any(revoked_ids));
  update public.rehearsal_dubbing_jobs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
    where (kind='validate_take' and target_id=any(revoked_ids) or kind='render' and target_id in(select id from public.rehearsal_dubbing_renders where session_id=t.session_id and status='revoked')) and status in('queued','running','awaiting_confirmation');
  select coalesce(jsonb_agg(distinct path),'[]') into purge_paths from (
    select x.result->>'originalPath' path from public.rehearsal_dubbing_takes x where x.id=any(revoked_ids) and x.result->>'parentTakeId' is null
    union all select x.result->>'path' from public.rehearsal_dubbing_takes x where x.id=any(revoked_ids)
    union all select r.result->>'videoPath' from public.rehearsal_dubbing_renders r where r.session_id=t.session_id and r.status='revoked'
      and exists(select 1 from jsonb_array_elements(r.manifest->'lines') l where (l->'source'->>'takeId')::uuid=any(revoked_ids))
  ) paths where path is not null;
  insert into public.rehearsal_dubbing_jobs(kind,target_id,guide_id,result) values('purge',t.id,t.guide_id,jsonb_build_object('paths',purge_paths))
    on conflict(kind,target_id) where status in ('queued','running','awaiting_confirmation') do nothing;
  return true;
end $$;

create function public.dubbing_trim_take(p_take_id uuid,p_actor_id uuid,p_start_ms integer,p_end_ms integer,p_request_key text,p_request_digest text)
returns public.rehearsal_dubbing_takes language plpgsql set search_path = public as $$
declare t public.rehearsal_dubbing_takes; trimmed public.rehearsal_dubbing_takes;
begin
  select * into t from public.rehearsal_dubbing_takes where id=p_take_id and owner_id=p_actor_id;
  if not found then raise exception 'DUBBING_NOT_FOUND'; end if;
  perform public.dubbing_assert_scope(t.guide_id,p_actor_id);
  select * into t from public.rehearsal_dubbing_takes where id=p_take_id and owner_id=p_actor_id for update;
  if not found or t.status<>'needs_trim' or t.visibility='revoked' then raise exception 'DUBBING_NOT_FOUND'; end if;
  if p_start_ms is null or p_end_ms is null or p_start_ms<0 or p_end_ms<=p_start_ms or p_end_ms>coalesce((t.result->>'durationMs')::integer,0) then raise exception 'DUBBING_INVALID_INPUT'; end if;
  trimmed := public.dubbing_enqueue_take(t.session_id,p_actor_id,t.line_id,p_request_key,p_request_digest,t.result->>'path');
  if trimmed.status='pending' then
    update public.rehearsal_dubbing_takes set result=result||jsonb_build_object('trimStartMs',p_start_ms,'trimEndMs',p_end_ms,'parentTakeId',t.id),updated_at=now() where id=trimmed.id returning * into trimmed;
  end if;
  return trimmed;
end $$;

create function public.dubbing_cancel_render(p_render_id uuid,p_actor_id uuid)
returns public.rehearsal_dubbing_renders language plpgsql set search_path = public as $$
declare r public.rehearsal_dubbing_renders;
begin
  if p_actor_id is null then raise exception 'DUBBING_NOT_FOUND'; end if;
  select * into r from public.rehearsal_dubbing_renders where id=p_render_id;
  if not found or r.created_by<>p_actor_id then raise exception 'DUBBING_NOT_FOUND'; end if;
  perform public.dubbing_assert_scope(r.guide_id,p_actor_id);
  perform public.dubbing_lock_target('render',p_render_id);
  select * into r from public.rehearsal_dubbing_renders where id=p_render_id for update;
  if r.status not in ('awaiting_consent','queued','running','failed','cancelled') then raise exception 'DUBBING_CONFLICT'; end if;
  update public.rehearsal_dubbing_renders set status='cancelled',consents='[]',updated_at=now() where id=r.id returning * into r;
  update public.rehearsal_dubbing_jobs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now() where kind='render' and target_id=r.id and status in ('queued','running');
  return r;
end $$;

create function public.dubbing_retry_job(p_kind text,p_target_id uuid,p_actor_id uuid,p_acknowledge_unknown boolean default false)
returns public.rehearsal_dubbing_jobs language plpgsql set search_path = public as $$
declare j public.rehearsal_dubbing_jobs; allowed boolean;
begin
  if p_actor_id is null then raise exception 'DUBBING_NOT_FOUND'; end if;
  select * into j from public.rehearsal_dubbing_jobs where kind=p_kind and target_id=p_target_id order by created_at desc limit 1;
  if not found or p_kind not in ('guide','validate_take','render') then raise exception 'DUBBING_NOT_FOUND'; end if;
  perform public.dubbing_assert_scope(j.guide_id,p_actor_id);
  perform public.dubbing_lock_target(j.kind,j.target_id);
  select * into j from public.rehearsal_dubbing_jobs where id=j.id for update;
  if p_kind='guide' then select created_by=p_actor_id into allowed from public.rehearsal_dubbing_guides where id=p_target_id;
  elsif p_kind='validate_take' then select owner_id=p_actor_id and visibility<>'revoked' into allowed from public.rehearsal_dubbing_takes where id=p_target_id;
  else select created_by=p_actor_id and status<>'revoked' into allowed from public.rehearsal_dubbing_renders where id=p_target_id; end if;
  if allowed is distinct from true then raise exception 'DUBBING_NOT_FOUND'; end if;
  if j.status in ('queued','running') then return j; end if;
  if j.status<>'failed' then raise exception 'DUBBING_CONFLICT'; end if;
  if j.error_code='GUIDE_EXPIRED' then raise exception 'DUBBING_GUIDE_EXPIRED'; end if;
  if j.attempt>=5 then raise exception 'DUBBING_QUOTA_EXCEEDED'; end if;
  if p_kind='guide' and (j.error_code='TTS_DELIVERY_UNKNOWN' or j.result->>'ttsPendingLine' is not null) and not p_acknowledge_unknown then raise exception 'DUBBING_TTS_CONFIRMATION_REQUIRED'; end if;
  update public.rehearsal_dubbing_jobs set status='queued',error_code=null,result=result||jsonb_build_object('ttsPendingLine',null),lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id returning * into j;
  if p_kind='guide' then update public.rehearsal_dubbing_guides set status='queued',error_code=null,result=result||jsonb_build_object('ttsPendingLine',null),updated_at=now() where id=p_target_id and status='failed';
  elsif p_kind='validate_take' then update public.rehearsal_dubbing_takes set status='pending',error_code=null,updated_at=now() where id=p_target_id and status='failed';
  else update public.rehearsal_dubbing_renders set status='queued',error_code=null,updated_at=now() where id=p_target_id and status='failed'; end if;
  if not found then raise exception 'DUBBING_CONFLICT'; end if;
  return j;
end $$;

create function public.dubbing_media_paths(p_result jsonb)
returns setof text language sql immutable set search_path = public as $$
  select p_result->>field from unnest(array['sourcePath','path','originalPath','videoPath','subtitlePath']) field
    where jsonb_typeof(p_result->field)='string'
  union select clip->>'path' from jsonb_array_elements(case when jsonb_typeof(p_result->'guideAudio')='array' then p_result->'guideAudio' else '[]'::jsonb end) clip
    where jsonb_typeof(clip->'path')='string';
$$;

create function public.dubbing_referenced_media_paths()
returns setof text language sql stable set search_path = public as $$
  select p from public.rehearsal_dubbing_guides g cross join lateral public.dubbing_media_paths(g.result) p
  union select p from public.rehearsal_dubbing_takes t cross join lateral public.dubbing_media_paths(t.result) p
  union select p from public.rehearsal_dubbing_renders r cross join lateral public.dubbing_media_paths(r.result) p
  union select p from public.rehearsal_dubbing_jobs j cross join lateral public.dubbing_media_paths(j.result) p
  union select object_path from public.rehearsal_dubbing_assets;
$$;

-- Bounded metadata maintenance. Objects are removed through the Storage API by a
-- durable purge task; deleting storage.objects directly would not remove bytes.
create function public.dubbing_sweep_maintenance(p_limit integer default 100)
returns jsonb language plpgsql set search_path = public as $$
declare g public.rehearsal_dubbing_guides; t public.rehearsal_dubbing_takes; o record; failed_purge public.rehearsal_dubbing_jobs;
  paths jsonb; descendants uuid[]; locked_count integer; guide_count integer:=0; take_count integer:=0; orphan_count integer:=0;
  retried_purges integer:=0; exhausted_purges integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'DUBBING_INVALID_INPUT'; end if;
  if not pg_try_advisory_xact_lock(hashtext('dubbing-maintenance')) then
    return jsonb_build_object('expiredGuides',0,'expiredTakes',0,'orphanObjects',0,'retriedPurges',0,'exhaustedPurges',0);
  end if;
  for failed_purge in select * from public.rehearsal_dubbing_jobs j
    where kind='purge' and status='failed' and attempt<5 and updated_at<now()-interval '5 minutes'
    order by updated_at for update skip locked limit p_limit loop
    if exists(select 1 from public.rehearsal_dubbing_jobs active where active.kind='purge' and active.target_id=failed_purge.target_id
      and active.status in ('queued','running','awaiting_confirmation')) then continue; end if;
    update public.rehearsal_dubbing_jobs set status='queued',error_code=null,lease_token=null,lease_expires_at=null,updated_at=now() where id=failed_purge.id;
    retried_purges:=retried_purges+1;
  end loop;
  for g in select * from public.rehearsal_dubbing_guides candidate
    where status='awaiting_confirmation' and updated_at<now()-interval '7 days'
      and not exists(select 1 from public.rehearsal_dubbing_renders r where r.guide_id=candidate.id and r.status in ('awaiting_consent','queued','running','completed'))
    order by updated_at for update skip locked limit p_limit loop
    select coalesce(jsonb_agg(distinct p),'[]') into paths from public.dubbing_media_paths(g.result) p;
    update public.rehearsal_dubbing_guides set status='failed',error_code='GUIDE_EXPIRED',updated_at=now(),
      result=jsonb_build_object('sourceUrl',g.result->'sourceUrl','requestDigest',g.result->'requestDigest','expiredAt',now()) where id=g.id;
    update public.rehearsal_dubbing_jobs set status='failed',error_code='GUIDE_EXPIRED',result='{}',lease_token=null,lease_expires_at=null,updated_at=now()
      where guide_id=g.id and kind='guide' and status='awaiting_confirmation';
    if jsonb_array_length(paths)>0 then
      insert into public.rehearsal_dubbing_jobs(kind,target_id,guide_id,result) values('purge',g.id,g.id,jsonb_build_object('paths',paths))
        on conflict(kind,target_id) where status in ('queued','running','awaiting_confirmation') do nothing;
    end if;
    guide_count:=guide_count+1;
  end loop;
  for t in select * from public.rehearsal_dubbing_takes candidate
    where visibility='private' and status in ('pending','validating','ready','needs_trim','failed') and updated_at<now()-interval '7 days'
    order by id limit p_limit loop
    with recursive lineage as (
      select id from public.rehearsal_dubbing_takes where id=t.id
      union all select child.id from public.rehearsal_dubbing_takes child join lineage parent on child.result->>'parentTakeId'=parent.id::text where child.owner_id=t.owner_id
    ) select array_agg(id) into descendants from lineage;
    -- Never wait on an actively selected/processed recording while holding other
    -- draft locks. Recheck usage only after every member of this lineage is locked.
    select count(*) into locked_count from (
      select id from public.rehearsal_dubbing_takes where id=any(descendants) order by id for update skip locked
    ) locked;
    if locked_count<>cardinality(descendants) then continue; end if;
    if exists(select 1 from public.rehearsal_dubbing_takes child where child.id=any(descendants)
      and (child.visibility='shared' or child.updated_at>=now()-interval '7 days')) then continue; end if;
    if exists(select 1 from public.rehearsal_dubbing_submissions s cross join lateral jsonb_each(s.choices) ch
      where (ch.value->>'takeId')::uuid=any(descendants)) then continue; end if;
    if exists(select 1 from public.rehearsal_dubbing_renders r cross join lateral jsonb_array_elements(r.manifest->'lines') l
      where r.status in ('awaiting_consent','queued','running','completed') and (l->'source'->>'takeId')::uuid=any(descendants)) then continue; end if;
    perform public.dubbing_revoke_take(t.id,t.owner_id);
    take_count:=take_count+1;
  end loop;
  -- Only namespaces created by this feature are eligible. Unknown objects remain
  -- available for an operator to inspect instead of being guessed safe to delete.
  for o in select objects.name,guides.id as guide_id from storage.objects objects
    join public.rehearsal_dubbing_guides guides on (
      (split_part(objects.name,'/',1) in ('guides','uploads') and split_part(objects.name,'/',2)=guides.id::text)
      or (split_part(objects.name,'/',1)='takes' and exists(select 1 from public.rehearsal_dubbing_takes x where x.guide_id=guides.id and x.id::text=split_part(objects.name,'/',2)))
      or (split_part(objects.name,'/',1)='renders' and exists(select 1 from public.rehearsal_dubbing_renders x where x.guide_id=guides.id and x.id::text=split_part(objects.name,'/',2)))
    )
    where objects.bucket_id='rehearsal-dubbing' and objects.created_at<now()-interval '24 hours'
      and not exists(select 1 from public.dubbing_referenced_media_paths() p where p=objects.name)
      and not exists(select 1 from public.rehearsal_dubbing_jobs j where j.guide_id=guides.id and j.status in ('queued','running','awaiting_confirmation'))
    order by objects.created_at limit p_limit loop
    perform pg_advisory_xact_lock(hashtext('dubbing-storage-path:'||o.name));
    -- Recheck after locking: a retried upload may have committed since selection.
    if exists(select 1 from public.dubbing_referenced_media_paths() p where p=o.name)
      or exists(select 1 from public.rehearsal_dubbing_jobs j where j.guide_id=o.guide_id and j.status in ('queued','running','awaiting_confirmation')) then continue; end if;
    insert into public.rehearsal_dubbing_jobs(kind,target_id,guide_id,result)
      values('purge',gen_random_uuid(),o.guide_id,jsonb_build_object('paths',jsonb_build_array(o.name),'reason','orphan'));
    orphan_count:=orphan_count+1;
  end loop;
  select count(*) into exhausted_purges from public.rehearsal_dubbing_jobs where kind='purge' and status='failed' and attempt>=5;
  return jsonb_build_object('expiredGuides',guide_count,'expiredTakes',take_count,'orphanObjects',orphan_count,'retriedPurges',retried_purges,'exhaustedPurges',exhausted_purges);
end $$;

create function public.dubbing_invalidate_membership()
returns trigger language plpgsql security definer set search_path = public as $$
declare scope_ids uuid[];
begin
  if tg_table_name='couples' then
    if tg_op='UPDATE' and new.yellow_dog_id is not distinct from old.yellow_dog_id and new.white_dog_id is not distinct from old.white_dog_id then return new; end if;
    scope_ids := array[old.id];
  else
    if tg_op='UPDATE' and new.couple_id is not distinct from old.couple_id and new.role is not distinct from old.role then return new; end if;
    scope_ids := array[old.couple_id];
  end if;
  update public.rehearsal_dubbing_guides set status='revoked',updated_at=now() where couple_id=any(scope_ids) and status<>'revoked';
  update public.rehearsal_dubbing_sessions set status='revoked',updated_at=now() where couple_id=any(scope_ids);
  update public.rehearsal_dubbing_renders set status='revoked',consents='[]',updated_at=now() where guide_id in(select id from public.rehearsal_dubbing_guides where couple_id=any(scope_ids));
  update public.rehearsal_dubbing_jobs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
    where guide_id in(select id from public.rehearsal_dubbing_guides where couple_id=any(scope_ids)) and kind<>'purge' and status in('queued','running','awaiting_confirmation');
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger dubbing_couple_membership before update of yellow_dog_id,white_dog_id or delete on public.couples
  for each row execute function public.dubbing_invalidate_membership();
create trigger dubbing_profile_membership before update of couple_id,role or delete on public.profiles
  for each row execute function public.dubbing_invalidate_membership();

do $$ declare n text; f record; begin
  foreach n in array array['guides','sessions','takes','submissions','renders','jobs','assets','requests'] loop
    execute format('alter table public.rehearsal_dubbing_%I enable row level security',n);
    execute format('revoke all on public.rehearsal_dubbing_%I from public, anon, authenticated',n);
    execute format('grant all on public.rehearsal_dubbing_%I to service_role',n);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname like 'dubbing\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

commit;
