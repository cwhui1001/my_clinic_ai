create table public.guest_retention_runs (
  id uuid primary key default gen_random_uuid(),
  scheduler text not null default 'supabase_pg_cron'
    check (scheduler = 'supabase_pg_cron'),
  expired_session_count integer not null check (expired_session_count >= 0),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  check (completed_at >= started_at)
);

create index guest_retention_runs_completed_idx
  on public.guest_retention_runs (completed_at desc);

create function public.run_guest_retention_cleanup()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_expired_count integer;
begin
  v_expired_count := public.expire_lead_sessions();

  insert into public.guest_retention_runs (
    scheduler,
    expired_session_count,
    started_at,
    completed_at
  ) values (
    'supabase_pg_cron',
    v_expired_count,
    v_started_at,
    clock_timestamp()
  );

  return v_expired_count;
end;
$$;

alter table public.guest_retention_runs enable row level security;
revoke all on table public.guest_retention_runs from anon, authenticated;
revoke execute on function public.run_guest_retention_cleanup() from public, anon, authenticated;
grant execute on function public.run_guest_retention_cleanup() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'nightingale-expire-guest-sessions-hourly';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'nightingale-expire-guest-sessions-hourly',
    '17 * * * *',
    'select public.run_guest_retention_cleanup()'
  );
end;
$$;

comment on table public.guest_retention_runs is
  'PHI-free evidence of successful database-native abandoned guest cleanup runs. Failed executions remain visible in cron.job_run_details.';
comment on function public.run_guest_retention_cleanup() is
  'Database-native Supabase pg_cron target; deletes expired abandoned guest content through expire_lead_sessions and records success.';

create function public.read_guest_messages(p_recovery_token_hash text)
returns setof public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id uuid;
begin
  select id into v_lead_id
  from public.lead_sessions
  where recovery_token_hash = p_recovery_token_hash
    and status in ('active', 'auth_started')
    and expires_at > now();

  if v_lead_id is null then
    raise exception using errcode = 'P0003', message = 'Guest session not found';
  end if;

  return query
  select messages.*
  from public.messages
  where lead_session_id = v_lead_id
    and status in ('completed', 'blocked')
  order by sequence_number;
end;
$$;

revoke execute on function public.read_guest_messages(text) from public, anon, authenticated;
grant execute on function public.read_guest_messages(text) to service_role;

comment on function public.read_guest_messages(text) is
  'Token-bound encrypted guest-thread reader; callers cannot select a LeadSession ID.';

create function public.convert_lead_to_patient_v3(
  p_recovery_token_hash text,
  p_phone_ciphertext text,
  p_phone_hash text,
  p_consent_granted boolean,
  p_policy_version text,
  p_notice_version text,
  p_marketing_consent boolean,
  p_marketing_policy_version text,
  p_marketing_notice_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0010', message = 'Authentication required';
  end if;

  select id into v_lead_id
  from public.lead_sessions
  where recovery_token_hash = p_recovery_token_hash
     or conversion_idempotency_hash = p_recovery_token_hash;

  if v_lead_id is null then
    raise exception using errcode = 'P0003', message = 'Guest session not found';
  end if;

  if not exists (
    select 1
    from public.funnel_events
    where lead_session_id = v_lead_id
      and name = 'value_event'
  ) then
    raise exception using errcode = 'P0014', message = 'Meaningful guest value required before conversion';
  end if;

  return public.convert_lead_to_patient_v2(
    p_recovery_token_hash,
    p_phone_ciphertext,
    p_phone_hash,
    p_consent_granted,
    p_policy_version,
    p_notice_version,
    p_marketing_consent,
    p_marketing_policy_version,
    p_marketing_notice_version
  );
end;
$$;

revoke execute on function public.convert_lead_to_patient_v2(text, text, text, boolean, text, text, boolean, text, text) from authenticated;
revoke execute on function public.convert_lead_to_patient_v3(text, text, text, boolean, text, text, boolean, text, text) from public, anon;
grant execute on function public.convert_lead_to_patient_v3(text, text, text, boolean, text, text, boolean, text, text) to authenticated;

comment on function public.convert_lead_to_patient_v3(text, text, text, boolean, text, text, boolean, text, text) is
  'Authenticated conversion boundary requiring a committed guest value_event; UI flags alone cannot unlock identity conversion.';
