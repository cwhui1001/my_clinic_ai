create type public.risk_level as enum ('low', 'medium', 'high');
create type public.response_confidence as enum ('low', 'med', 'high');

alter table public.patient_sessions
  add constraint patient_sessions_id_clinic_unique unique (id, clinic_id);

alter table public.messages
  alter column lead_session_id drop not null,
  add column patient_session_id uuid,
  add constraint messages_patient_session_clinic_fk
    foreign key (patient_session_id, clinic_id)
    references public.patient_sessions(id, clinic_id) on delete cascade,
  add constraint messages_exactly_one_session_check
    check ((lead_session_id is null) <> (patient_session_id is null));

create unique index messages_patient_sequence_unique
  on public.messages (patient_session_id, sequence_number)
  where patient_session_id is not null;

create unique index messages_patient_client_message_unique
  on public.messages (patient_session_id, client_message_id)
  where patient_session_id is not null and client_message_id is not null;

create index messages_patient_thread_idx
  on public.messages (patient_session_id, sequence_number)
  where patient_session_id is not null;

create index messages_patient_in_flight_idx
  on public.messages (patient_session_id, created_at)
  where actor = 'patient' and status = 'received';

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  publisher text not null,
  url text not null check (url ~ '^https://'),
  content text not null,
  version text not null,
  reviewed_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (url, version)
);

create table public.risk_assessments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_session_id uuid not null,
  message_id uuid not null unique references public.messages(id) on delete cascade,
  risk_level public.risk_level not null,
  risk_reason text not null check (char_length(risk_reason) between 1 and 200),
  confidence public.response_confidence not null,
  escalation_required boolean not null,
  rule_matches text[] not null default '{}',
  model_run_id uuid references public.model_runs(id) on delete restrict,
  pipeline_version text not null,
  provenance jsonb not null default '{}'::jsonb,
  assessed_at timestamptz not null default now(),
  foreign key (patient_session_id, clinic_id)
    references public.patient_sessions(id, clinic_id) on delete cascade,
  check (escalation_required = (risk_level <> 'low'))
);

create table public.citations (
  id uuid primary key default gen_random_uuid(),
  assistant_message_id uuid not null references public.messages(id) on delete cascade,
  knowledge_source_id uuid not null references public.knowledge_sources(id) on delete restrict,
  source_start integer not null check (source_start >= 0),
  source_end integer not null check (source_end > source_start),
  quoted_span_hash text not null check (quoted_span_hash ~ '^[0-9a-f]{64}$'),
  ordinal smallint not null check (ordinal > 0),
  created_at timestamptz not null default now(),
  unique (assistant_message_id, ordinal),
  unique (assistant_message_id, knowledge_source_id)
);

insert into public.knowledge_sources (
  id,
  title,
  publisher,
  url,
  content,
  version,
  reviewed_at
) values
  (
    '10000000-0000-4000-8000-000000000001',
    'Talking With Your Doctor',
    'MedlinePlus, U.S. National Library of Medicine',
    'https://medlineplus.gov/talkingwithyourdoctor.html',
    'Prepare for a healthcare visit by listing concerns, allergies, medicines, herbs, vitamins, and supplements. Describe symptoms including when they began and what makes them better or worse. Ask questions when something is unclear.',
    'reviewed-2026-09-03',
    '2026-09-03T00:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Stop - Learn - Go: Tips for Talking with Your Pharmacist',
    'U.S. Food and Drug Administration',
    'https://www.fda.gov/drugs/information-consumers-and-patients-drugs/stop-learn-go-tips-talking-your-pharmacist-learn-how-use-medicines-safely',
    'Keep a current record of prescription and nonprescription medicines, vitamins, herbals, supplements, allergies, reactions, and changes. Ask a pharmacist or other healthcare professional when medicine instructions or changes are unclear.',
    'reviewed-2026-09-03',
    '2026-09-03T00:00:00Z'
  )
on conflict (url, version) do nothing;

create function public.append_patient_message(
  p_patient_session_id uuid,
  p_client_message_id uuid,
  p_content_ciphertext text,
  p_content_sha256 text
)
returns setof public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid;
  v_session public.patient_sessions;
  v_message public.messages;
  v_sequence bigint;
  v_recent_count integer;
begin
  v_auth_user_id := auth.uid();
  if v_auth_user_id is null then
    raise exception using errcode = 'P0010', message = 'Authentication required';
  end if;

  select patient_sessions.* into v_session
  from public.patient_sessions
  join public.patients on patients.id = patient_sessions.patient_id
  where patient_sessions.id = p_patient_session_id
    and patient_sessions.status = 'active'
    and patients.auth_user_id = v_auth_user_id
    and exists (
      select 1
      from public.consent_events
      where consent_events.patient_id = patient_sessions.patient_id
        and consent_events.clinic_id = patient_sessions.clinic_id
        and consent_events.type = 'healthcare_sharing'
      order by consent_events.occurred_at desc
      limit 1
    )
  for update of patient_sessions;

  if not found then
    raise exception using errcode = 'P0020', message = 'Patient session unavailable';
  end if;

  if (
    select action
    from public.consent_events
    where patient_id = v_session.patient_id
      and clinic_id = v_session.clinic_id
      and type = 'healthcare_sharing'
    order by occurred_at desc
    limit 1
  ) <> 'granted' then
    raise exception using errcode = 'P0021', message = 'Healthcare consent required';
  end if;

  select * into v_message
  from public.messages
  where patient_session_id = v_session.id
    and client_message_id = p_client_message_id;

  if found then
    if v_message.status = 'failed' and not exists (
      select 1 from public.messages
      where in_reply_to_message_id = v_message.id
        and actor = 'assistant'
    ) then
      update public.messages
      set status = 'received'
      where id = v_message.id
      returning * into v_message;
    end if;
    return next v_message;
    return;
  end if;

  update public.messages
  set status = 'failed'
  where patient_session_id = v_session.id
    and actor = 'patient'
    and status = 'received'
    and created_at < now() - interval '2 minutes';

  if exists (
    select 1 from public.messages
    where patient_session_id = v_session.id
      and actor = 'patient'
      and status = 'received'
  ) then
    raise exception using errcode = 'P0004', message = 'Patient turn already in progress';
  end if;

  select count(*) into v_recent_count
  from public.messages
  where patient_session_id = v_session.id
    and actor = 'patient'
    and created_at >= now() - interval '1 hour';

  if v_recent_count >= 30 then
    raise exception using errcode = 'P0001', message = 'Patient message rate limit exceeded';
  end if;

  select coalesce(max(sequence_number), 0) + 1 into v_sequence
  from public.messages
  where patient_session_id = v_session.id;

  insert into public.messages (
    clinic_id,
    patient_session_id,
    actor,
    status,
    content_ciphertext,
    content_sha256,
    client_message_id,
    sequence_number
  ) values (
    v_session.clinic_id,
    v_session.id,
    'patient',
    'received',
    p_content_ciphertext,
    p_content_sha256,
    p_client_message_id,
    v_sequence
  ) returning * into v_message;

  return next v_message;
end;
$$;

create function public.complete_patient_turn(
  p_patient_session_id uuid,
  p_source_message_id uuid,
  p_source_status public.message_status,
  p_redaction_status public.redaction_status,
  p_redaction_version text,
  p_redaction_summary jsonb,
  p_assistant_ciphertext text,
  p_assistant_sha256 text,
  p_risk_level public.risk_level,
  p_risk_reason text,
  p_confidence public.response_confidence,
  p_escalation_required boolean,
  p_rule_matches text[],
  p_pipeline_version text,
  p_risk_provenance jsonb,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_redacted_input_hash text,
  p_provider_response_id text,
  p_model_status public.model_run_status,
  p_duration_ms integer,
  p_error_code text,
  p_citations jsonb
)
returns setof public.messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.patient_sessions;
  v_source public.messages;
  v_assistant public.messages;
  v_model_run_id uuid;
  v_sequence bigint;
  v_citation_count integer;
begin
  select * into v_session
  from public.patient_sessions
  where id = p_patient_session_id
    and status = 'active'
  for update;

  if not found then
    raise exception using errcode = 'P0020', message = 'Patient session unavailable';
  end if;

  select * into v_source
  from public.messages
  where id = p_source_message_id
    and patient_session_id = v_session.id
    and actor = 'patient'
  for update;

  if not found then
    raise exception using errcode = 'P0003', message = 'Patient message not found';
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

    raise exception using errcode = 'P0005', message = 'Patient message is not processable';
  end if;

  if p_escalation_required <> (p_risk_level <> 'low') then
    raise exception using errcode = 'P0022', message = 'Invalid risk policy result';
  end if;

  if p_risk_level = 'low' and jsonb_array_length(coalesce(p_citations, '[]'::jsonb)) = 0 then
    raise exception using errcode = 'P0023', message = 'Low-risk response requires a citation';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_citations, '[]'::jsonb))
      as supplied(source_id uuid, source_start integer, source_end integer, quoted_span_hash text, ordinal smallint)
    left join public.knowledge_sources on knowledge_sources.id = supplied.source_id
    where knowledge_sources.id is null
      or knowledge_sources.active = false
      or supplied.source_start < 0
      or supplied.source_end <= supplied.source_start
      or supplied.source_end > char_length(knowledge_sources.content)
      or supplied.quoted_span_hash <> encode(
        sha256(convert_to(substr(knowledge_sources.content, supplied.source_start + 1, supplied.source_end - supplied.source_start), 'UTF8')),
        'hex'
      )
  ) then
    raise exception using errcode = 'P0024', message = 'Invalid citation provenance';
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
    v_session.clinic_id,
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
  ) returning id into v_model_run_id;

  insert into public.risk_assessments (
    clinic_id,
    patient_session_id,
    message_id,
    risk_level,
    risk_reason,
    confidence,
    escalation_required,
    rule_matches,
    model_run_id,
    pipeline_version,
    provenance
  ) values (
    v_session.clinic_id,
    v_session.id,
    v_source.id,
    p_risk_level,
    p_risk_reason,
    p_confidence,
    p_escalation_required,
    coalesce(p_rule_matches, '{}'::text[]),
    v_model_run_id,
    p_pipeline_version,
    coalesce(p_risk_provenance, '{}'::jsonb)
  );

  select coalesce(max(sequence_number), 0) + 1 into v_sequence
  from public.messages
  where patient_session_id = v_session.id;

  insert into public.messages (
    clinic_id,
    patient_session_id,
    actor,
    status,
    content_ciphertext,
    content_sha256,
    in_reply_to_message_id,
    sequence_number
  ) values (
    v_session.clinic_id,
    v_session.id,
    'assistant',
    'completed',
    p_assistant_ciphertext,
    p_assistant_sha256,
    v_source.id,
    v_sequence
  ) returning * into v_assistant;

  insert into public.citations (
    assistant_message_id,
    knowledge_source_id,
    source_start,
    source_end,
    quoted_span_hash,
    ordinal
  )
  select
    v_assistant.id,
    supplied.source_id,
    supplied.source_start,
    supplied.source_end,
    supplied.quoted_span_hash,
    supplied.ordinal
  from jsonb_to_recordset(coalesce(p_citations, '[]'::jsonb))
    as supplied(source_id uuid, source_start integer, source_end integer, quoted_span_hash text, ordinal smallint);

  get diagnostics v_citation_count = row_count;
  if p_risk_level = 'low' and v_citation_count = 0 then
    raise exception using errcode = 'P0023', message = 'Low-risk response requires a citation';
  end if;

  return next v_assistant;
end;
$$;

alter table public.knowledge_sources enable row level security;
alter table public.risk_assessments enable row level security;
alter table public.citations enable row level security;

revoke all on table public.knowledge_sources from anon, authenticated;
revoke all on table public.risk_assessments from anon, authenticated;
revoke all on table public.citations from anon, authenticated;

grant select on table public.knowledge_sources to authenticated;
grant select on table public.risk_assessments to authenticated;
grant select on table public.citations to authenticated;

create policy knowledge_sources_select_active
on public.knowledge_sources for select to authenticated
using (active = true);

create policy knowledge_sources_select_own_historical_citation
on public.knowledge_sources for select to authenticated
using (
  exists (
    select 1
    from public.citations
    join public.messages on messages.id = citations.assistant_message_id
    join public.patient_sessions on patient_sessions.id = messages.patient_session_id
    join public.patients on patients.id = patient_sessions.patient_id
    where citations.knowledge_source_id = knowledge_sources.id
      and patients.auth_user_id = (select auth.uid())
  )
);

create policy risk_assessments_select_own
on public.risk_assessments for select to authenticated
using (
  exists (
    select 1
    from public.patient_sessions
    join public.patients on patients.id = patient_sessions.patient_id
    where patient_sessions.id = risk_assessments.patient_session_id
      and patients.auth_user_id = (select auth.uid())
  )
);

create policy citations_select_own
on public.citations for select to authenticated
using (
  exists (
    select 1
    from public.messages
    join public.patient_sessions on patient_sessions.id = messages.patient_session_id
    join public.patients on patients.id = patient_sessions.patient_id
    where messages.id = citations.assistant_message_id
      and patients.auth_user_id = (select auth.uid())
  )
);

create policy messages_select_own_patient_session
on public.messages for select to authenticated
using (
  exists (
    select 1
    from public.patient_sessions
    join public.patients on patients.id = patient_sessions.patient_id
    where patient_sessions.id = messages.patient_session_id
      and patients.auth_user_id = (select auth.uid())
  )
);

revoke execute on function public.append_patient_message(uuid, uuid, text, text) from public, anon;
revoke execute on function public.complete_patient_turn(uuid, uuid, public.message_status, public.redaction_status, text, jsonb, text, text, public.risk_level, text, public.response_confidence, boolean, text[], text, jsonb, text, text, text, text, text, public.model_run_status, integer, text, jsonb) from public, anon, authenticated;

grant execute on function public.append_patient_message(uuid, uuid, text, text) to authenticated;
grant execute on function public.complete_patient_turn(uuid, uuid, public.message_status, public.redaction_status, text, jsonb, text, text, public.risk_level, text, public.response_confidence, boolean, text[], text, jsonb, text, text, text, text, text, public.model_run_status, integer, text, jsonb) to service_role;

comment on table public.risk_assessments is 'One immutable, PHI-redacted risk decision per patient message.';
comment on table public.knowledge_sources is 'Curated non-patient reference excerpts approved for grounded low-risk education.';
comment on table public.citations is 'Resolvable source-span provenance for low-risk assistant messages.';
