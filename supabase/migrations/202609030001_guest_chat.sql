create type public.message_actor as enum ('guest', 'assistant');
create type public.message_status as enum ('received', 'completed', 'blocked', 'failed');
create type public.redaction_status as enum ('not_required', 'passed', 'failed');
create type public.model_run_status as enum ('completed', 'failed', 'skipped');
create type public.value_event_type as enum (
  'service_answer',
  'hours_answer',
  'availability_answer',
  'general_education',
  'concern_summary',
  'question_preparation',
  'trust_explanation'
);

create table public.clinic_public_profiles (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  services text[] not null default '{}',
  hours_summary text not null,
  availability_summary text not null,
  general_note text not null,
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  lead_session_id uuid not null references public.lead_sessions(id) on delete cascade,
  actor public.message_actor not null,
  status public.message_status not null,
  content_ciphertext text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  client_message_id uuid,
  in_reply_to_message_id uuid references public.messages(id) on delete cascade,
  sequence_number bigint not null check (sequence_number > 0),
  redaction_status public.redaction_status not null default 'not_required',
  redaction_version text,
  redaction_summary jsonb not null default '{}'::jsonb,
  requires_secure_continue boolean not null default false,
  audio_recording_id text,
  audio_transcript_id text,
  created_at timestamptz not null default now(),
  unique (lead_session_id, sequence_number)
);

create unique index messages_lead_client_message_unique
  on public.messages (lead_session_id, client_message_id)
  where client_message_id is not null;
create index messages_lead_thread_idx
  on public.messages (lead_session_id, sequence_number);
create index messages_in_flight_idx
  on public.messages (lead_session_id, created_at)
  where actor = 'guest' and status = 'received';

create table public.model_runs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  source_message_id uuid not null unique references public.messages(id) on delete cascade,
  provider text not null,
  model text not null,
  prompt_version text not null,
  redacted_input_hash text not null check (redacted_input_hash ~ '^[0-9a-f]{64}$'),
  provider_response_id text,
  store_requested boolean not null default false check (store_requested = false),
  status public.model_run_status not null,
  duration_ms integer not null check (duration_ms >= 0),
  error_code text,
  created_at timestamptz not null default now()
);

create table public.value_events (
  funnel_event_id uuid primary key references public.funnel_events(id) on delete cascade,
  value_type public.value_event_type not null,
  source_query_id text,
  validated_at timestamptz
);

create function public.append_guest_message(
  p_recovery_token_hash text,
  p_client_message_id uuid,
  p_content_ciphertext text,
  p_content_sha256 text
)
returns setof public.messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead public.lead_sessions;
  v_message public.messages;
  v_sequence bigint;
  v_recent_count integer;
begin
  select * into v_lead
  from public.lead_sessions
  where recovery_token_hash = p_recovery_token_hash
    and status in ('active', 'auth_started')
    and expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0003', message = 'Guest session not found';
  end if;

  select * into v_message
  from public.messages
  where lead_session_id = v_lead.id
    and client_message_id = p_client_message_id;

  if found then
    return next v_message;
    return;
  end if;

  update public.messages
  set status = 'failed'
  where lead_session_id = v_lead.id
    and actor = 'guest'
    and status = 'received'
    and created_at < now() - interval '2 minutes';

  if exists (
    select 1 from public.messages
    where lead_session_id = v_lead.id
      and actor = 'guest'
      and status = 'received'
  ) then
    raise exception using errcode = 'P0004', message = 'Guest turn already in progress';
  end if;

  select count(*) into v_recent_count
  from public.messages
  where lead_session_id = v_lead.id
    and actor = 'guest'
    and created_at >= now() - interval '1 hour';

  if v_recent_count >= 30 then
    raise exception using errcode = 'P0001', message = 'Guest message rate limit exceeded';
  end if;

  select coalesce(max(sequence_number), 0) + 1 into v_sequence
  from public.messages
  where lead_session_id = v_lead.id;

  insert into public.messages (
    clinic_id,
    lead_session_id,
    actor,
    status,
    content_ciphertext,
    content_sha256,
    client_message_id,
    sequence_number
  ) values (
    v_lead.clinic_id,
    v_lead.id,
    'guest',
    'received',
    p_content_ciphertext,
    p_content_sha256,
    p_client_message_id,
    v_sequence
  ) returning * into v_message;

  insert into public.funnel_events (
    clinic_id,
    lead_session_id,
    name,
    source_channel,
    identity_level,
    metadata,
    idempotency_key
  ) values (
    v_lead.clinic_id,
    v_lead.id,
    'conversation_started',
    v_lead.source_channel,
    v_lead.identity_level,
    '{}'::jsonb,
    'conversation_started:' || v_lead.id::text
  ) on conflict (idempotency_key) do nothing;

  return next v_message;
end;
$$;

create function public.complete_guest_turn(
  p_recovery_token_hash text,
  p_source_message_id uuid,
  p_source_status public.message_status,
  p_redaction_status public.redaction_status,
  p_redaction_version text,
  p_redaction_summary jsonb,
  p_assistant_ciphertext text,
  p_assistant_sha256 text,
  p_requires_secure_continue boolean,
  p_value_type public.value_event_type,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_redacted_input_hash text,
  p_provider_response_id text,
  p_model_status public.model_run_status,
  p_duration_ms integer,
  p_error_code text
)
returns setof public.messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead public.lead_sessions;
  v_source public.messages;
  v_assistant public.messages;
  v_sequence bigint;
  v_funnel_event_id uuid;
begin
  select * into v_lead
  from public.lead_sessions
  where recovery_token_hash = p_recovery_token_hash
    and status in ('active', 'auth_started')
    and expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0003', message = 'Guest session not found';
  end if;

  select * into v_source
  from public.messages
  where id = p_source_message_id
    and lead_session_id = v_lead.id
    and actor = 'guest'
  for update;

  if not found then
    raise exception using errcode = 'P0003', message = 'Guest message not found';
  end if;

  if v_source.status <> 'received' then
    select * into v_assistant
    from public.messages
    where in_reply_to_message_id = v_source.id
      and actor = 'assistant'
    limit 1;

    if found then
      return next v_assistant;
      return;
    end if;

    raise exception using errcode = 'P0005', message = 'Guest message is not processable';
  end if;

  update public.messages
  set status = p_source_status,
      redaction_status = p_redaction_status,
      redaction_version = p_redaction_version,
      redaction_summary = coalesce(p_redaction_summary, '{}'::jsonb)
  where id = v_source.id;

  insert into public.model_runs (
    clinic_id,
    source_message_id,
    provider,
    model,
    prompt_version,
    redacted_input_hash,
    provider_response_id,
    store_requested,
    status,
    duration_ms,
    error_code
  ) values (
    v_lead.clinic_id,
    v_source.id,
    p_provider,
    p_model,
    p_prompt_version,
    p_redacted_input_hash,
    p_provider_response_id,
    false,
    p_model_status,
    p_duration_ms,
    p_error_code
  );

  select coalesce(max(sequence_number), 0) + 1 into v_sequence
  from public.messages
  where lead_session_id = v_lead.id;

  insert into public.messages (
    clinic_id,
    lead_session_id,
    actor,
    status,
    content_ciphertext,
    content_sha256,
    in_reply_to_message_id,
    sequence_number,
    redaction_status,
    redaction_version,
    requires_secure_continue
  ) values (
    v_lead.clinic_id,
    v_lead.id,
    'assistant',
    'completed',
    p_assistant_ciphertext,
    p_assistant_sha256,
    v_source.id,
    v_sequence,
    'not_required',
    null,
    p_requires_secure_continue
  ) returning * into v_assistant;

  if p_value_type is not null then
    insert into public.funnel_events (
      clinic_id,
      lead_session_id,
      name,
      source_channel,
      identity_level,
      metadata,
      idempotency_key
    ) values (
      v_lead.clinic_id,
      v_lead.id,
      'value_event',
      v_lead.source_channel,
      v_lead.identity_level,
      jsonb_build_object(
        'value_type', p_value_type,
        'assistant_message_id', v_assistant.id
      ),
      'value_event:' || v_assistant.id::text
    ) returning id into v_funnel_event_id;

    insert into public.value_events (
      funnel_event_id,
      value_type,
      validated_at
    ) values (
      v_funnel_event_id,
      p_value_type,
      null
    );
  end if;

  return next v_assistant;
end;
$$;

create or replace function public.expire_lead_sessions()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.messages
  where lead_session_id in (
    select id
    from public.lead_sessions
    where status in ('active', 'auth_started')
      and expires_at <= now()
  );

  update public.lead_sessions
  set status = 'expired',
      context_ciphertext = null,
      social_handle_ciphertext = null,
      recovery_token_hash = null,
      updated_at = now()
  where status in ('active', 'auth_started')
    and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.clinic_public_profiles enable row level security;
alter table public.messages enable row level security;
alter table public.model_runs enable row level security;
alter table public.value_events enable row level security;

revoke all on table public.clinic_public_profiles from anon, authenticated;
revoke all on table public.messages from anon, authenticated;
revoke all on table public.model_runs from anon, authenticated;
revoke all on table public.value_events from anon, authenticated;

revoke execute on function public.append_guest_message(text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.complete_guest_turn(text, uuid, public.message_status, public.redaction_status, text, jsonb, text, text, boolean, public.value_event_type, text, text, text, text, text, public.model_run_status, integer, text) from public, anon, authenticated;

grant execute on function public.append_guest_message(text, uuid, text, text) to service_role;
grant execute on function public.complete_guest_turn(text, uuid, public.message_status, public.redaction_status, text, jsonb, text, text, boolean, public.value_event_type, text, text, text, text, text, public.model_run_status, integer, text) to service_role;

comment on table public.messages is 'Encrypted guest messages in Phase 2; later migrations add patient-session ownership.';
comment on column public.messages.content_ciphertext is 'AES-GCM protected application content; never copy into logs or analytics.';
comment on column public.messages.redaction_summary is 'PHI-free category counts and pipeline metadata only.';
comment on table public.model_runs is 'PHI-free provenance for local or OpenAI response generation.';
comment on table public.value_events is 'Typed evidence that a guest received substantive value.';
