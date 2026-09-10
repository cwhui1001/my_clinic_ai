alter table public.escalations
  add column clinician_response_at timestamptz;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null,
  subscription_ciphertext text not null check (char_length(subscription_ciphertext) between 1 and 12000),
  endpoint_hash text not null check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  expires_at timestamptz,
  last_success_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, endpoint_hash),
  foreign key (patient_id, clinic_id) references public.patients(id, clinic_id) on delete cascade
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null,
  patient_session_id uuid not null references public.patient_sessions(id) on delete cascade,
  escalation_id uuid not null references public.escalations(id) on delete cascade,
  clinician_response_id uuid not null unique references public.clinician_responses(id) on delete cascade,
  transport text not null default 'web_push' check (transport = 'web_push'),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'no_subscription', 'transport_unavailable')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  delivered_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_.-]{1,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (patient_id, clinic_id) references public.patients(id, clinic_id) on delete cascade
);

create table public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_job_id uuid not null references public.notification_jobs(id) on delete cascade,
  push_subscription_id uuid references public.push_subscriptions(id) on delete set null,
  outcome text not null check (outcome in ('delivered', 'failed', 'gone', 'transport_unavailable')),
  provider_status integer,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_.-]{1,64}$'),
  attempted_at timestamptz not null default now()
);

create index notification_jobs_pending_idx on public.notification_jobs (created_at) where status in ('pending', 'failed');
create index push_subscriptions_patient_active_idx on public.push_subscriptions (patient_id) where active;

create function public.enqueue_response_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_escalation public.escalations;
begin
  select * into v_escalation from public.escalations where id = new.escalation_id;
  update public.escalations
  set clinician_response_at = coalesce(clinician_response_at, new.created_at),
      status = 'responded',
      updated_at = now()
  where id = new.escalation_id;

  insert into public.notification_jobs (
    clinic_id, patient_id, patient_session_id, escalation_id, clinician_response_id
  ) values (
    new.clinic_id, v_escalation.patient_id, v_escalation.patient_session_id,
    new.escalation_id, new.id
  ) on conflict (clinician_response_id) do nothing;
  return new;
end;
$$;

create trigger clinician_responses_enqueue_notification
after insert on public.clinician_responses
for each row execute function public.enqueue_response_notification();

create function public.upsert_push_subscription(
  p_patient_session_id uuid,
  p_subscription_ciphertext text,
  p_endpoint_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.patient_sessions;
  v_id uuid;
begin
  select patient_sessions.* into v_session
  from public.patient_sessions
  join public.patients on patients.id = patient_sessions.patient_id
  where patient_sessions.id = p_patient_session_id
    and patients.auth_user_id = auth.uid();
  if not found then raise exception using errcode = 'P0020', message = 'Patient session unavailable'; end if;
  if char_length(coalesce(p_subscription_ciphertext, '')) not between 1 and 12000
     or coalesce(p_endpoint_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0040', message = 'Invalid push subscription';
  end if;

  insert into public.push_subscriptions (
    clinic_id, patient_id, subscription_ciphertext, endpoint_hash, expires_at
  ) values (
    v_session.clinic_id, v_session.patient_id, p_subscription_ciphertext, p_endpoint_hash, p_expires_at
  ) on conflict (patient_id, endpoint_hash) do update
    set subscription_ciphertext = excluded.subscription_ciphertext,
        expires_at = excluded.expires_at, active = true, failure_count = 0, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create function public.deactivate_push_subscription(
  p_patient_session_id uuid,
  p_endpoint_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.push_subscriptions
  set active = false, updated_at = now()
  where endpoint_hash = p_endpoint_hash
    and patient_id in (
      select patient_sessions.patient_id
      from public.patient_sessions
      join public.patients on patients.id = patient_sessions.patient_id
      where patient_sessions.id = p_patient_session_id
        and patients.auth_user_id = auth.uid()
    );
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

create table public.lead_recovery_tombstones (
  recovery_token_hash text primary key check (recovery_token_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'expired' check (state in ('expired', 'purged')),
  expired_at timestamptz not null,
  purged_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create function public.rotate_lead_recovery_token(
  p_current_token_hash text,
  p_new_token_hash text
)
returns setof public.lead_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare v_lead public.lead_sessions;
begin
  select * into v_lead from public.lead_sessions
  where recovery_token_hash = p_current_token_hash
    and status in ('active', 'auth_started')
    and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0003', message = 'Guest session unavailable'; end if;
  update public.lead_sessions
  set recovery_token_hash = p_new_token_hash, updated_at = now()
  where id = v_lead.id
  returning * into v_lead;
  return next v_lead;
end;
$$;

create or replace function public.expire_lead_sessions()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  insert into public.lead_recovery_tombstones (recovery_token_hash, state, expired_at, purged_at)
  select recovery_token_hash, 'expired', expires_at, expires_at + interval '30 days'
  from public.lead_sessions
  where status in ('active', 'auth_started') and expires_at <= now() and recovery_token_hash is not null
  on conflict (recovery_token_hash) do nothing;

  delete from public.messages where lead_session_id in (
    select id from public.lead_sessions where status in ('active', 'auth_started') and expires_at <= now()
  );
  update public.lead_sessions
  set status = 'expired', context_ciphertext = null, social_handle_ciphertext = null,
      phone_ciphertext = null, phone_hash = null, recovery_token_hash = null, updated_at = now()
  where status in ('active', 'auth_started') and expires_at <= now();
  get diagnostics v_count = row_count;

  update public.lead_recovery_tombstones
  set state = 'purged', updated_at = now()
  where state = 'expired' and purged_at <= now();
  return v_count;
end;
$$;

alter table public.push_subscriptions enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.notification_attempts enable row level security;
alter table public.lead_recovery_tombstones enable row level security;
revoke all on table public.push_subscriptions, public.notification_jobs, public.notification_attempts, public.lead_recovery_tombstones from anon, authenticated;
revoke execute on function public.enqueue_response_notification() from public, anon, authenticated;
revoke execute on function public.upsert_push_subscription(uuid, text, text, timestamptz) from public, anon;
revoke execute on function public.deactivate_push_subscription(uuid, text) from public, anon;
revoke execute on function public.rotate_lead_recovery_token(text, text) from public, anon, authenticated;
grant execute on function public.upsert_push_subscription(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.deactivate_push_subscription(uuid, text) to authenticated;
grant execute on function public.rotate_lead_recovery_token(text, text) to service_role;

comment on table public.notification_jobs is 'PHI-free Web Push outbox created atomically with clinician responses.';
comment on table public.push_subscriptions is 'Encrypted patient-owned Web Push capabilities; endpoints never enter logs or notification payloads.';
comment on table public.lead_recovery_tombstones is 'Hashed-token lifecycle evidence used only to distinguish expired and purged guest recovery.';
