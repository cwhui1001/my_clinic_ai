create type public.memory_kind as enum (
  'chief_complaint',
  'symptom',
  'medication',
  'allergy'
);

create type public.memory_status as enum (
  'active',
  'stopped',
  'resolved',
  'corrected'
);

create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind public.memory_kind not null,
  canonical_key text not null check (canonical_key ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memory_items_patient_kind_key_unique unique (patient_id, kind, canonical_key),
  constraint memory_items_id_patient_clinic_unique unique (id, patient_id, clinic_id),
  constraint memory_items_patient_clinic_fk
    foreign key (patient_id, clinic_id) references public.patients(id, clinic_id) on delete restrict
);

create table public.memory_revisions (
  id uuid primary key default gen_random_uuid(),
  memory_item_id uuid not null references public.memory_items(id) on delete restrict,
  value_ciphertext text not null check (char_length(value_ciphertext) between 1 and 12000),
  value_sha256 text not null check (value_sha256 ~ '^[0-9a-f]{64}$'),
  status public.memory_status not null,
  source_message_id uuid not null references public.messages(id) on delete restrict,
  supersedes_revision_id uuid references public.memory_revisions(id) on delete restrict,
  model_run_id uuid references public.model_runs(id) on delete restrict,
  confidence public.response_confidence not null,
  effective_at timestamptz,
  created_at timestamptz not null default now(),
  constraint memory_revision_source_unique unique (memory_item_id, source_message_id),
  constraint memory_revisions_id_item_unique unique (id, memory_item_id)
);

alter table public.memory_items
  add constraint memory_items_current_revision_fk
  foreign key (current_revision_id, id) references public.memory_revisions(id, memory_item_id) on delete restrict;

create index memory_items_profile_idx
  on public.memory_items (patient_id, kind, updated_at desc);

create index memory_revisions_history_idx
  on public.memory_revisions (memory_item_id, created_at desc);

create index memory_revisions_source_idx
  on public.memory_revisions (source_message_id);

create function public.reject_memory_revision_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0030', message = 'Memory revisions are immutable';
end;
$$;

create trigger memory_revisions_append_only
before update or delete on public.memory_revisions
for each row execute function public.reject_memory_revision_mutation();

create function public.apply_memory_revisions_internal(
  p_patient_session_id uuid,
  p_model_run_id uuid,
  p_proposals jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.patient_sessions;
  v_proposal jsonb;
  v_source public.messages;
  v_item public.memory_items;
  v_revision_id uuid;
  v_source_message_id uuid;
  v_kind public.memory_kind;
  v_status public.memory_status;
  v_confidence public.response_confidence;
  v_key text;
  v_value_ciphertext text;
  v_value_sha256 text;
  v_effective_at timestamptz;
begin
  if jsonb_typeof(coalesce(p_proposals, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_proposals, '[]'::jsonb)) > 12 then
    raise exception using errcode = 'P0031', message = 'Invalid memory proposal set';
  end if;

  select * into v_session
  from public.patient_sessions
  where id = p_patient_session_id
  for update;

  if not found then
    raise exception using errcode = 'P0020', message = 'Patient session unavailable';
  end if;

  if p_model_run_id is not null and not exists (
    select 1 from public.model_runs
    where id = p_model_run_id and clinic_id = v_session.clinic_id
  ) then
    raise exception using errcode = 'P0032', message = 'Invalid memory model provenance';
  end if;

  for v_proposal in select value from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb))
  loop
    begin
      v_source_message_id := (v_proposal ->> 'source_message_id')::uuid;
      v_kind := (v_proposal ->> 'kind')::public.memory_kind;
      v_status := (v_proposal ->> 'status')::public.memory_status;
      v_confidence := (v_proposal ->> 'confidence')::public.response_confidence;
      v_key := v_proposal ->> 'canonical_key';
      v_value_ciphertext := v_proposal ->> 'value_ciphertext';
      v_value_sha256 := v_proposal ->> 'value_sha256';
      v_effective_at := nullif(v_proposal ->> 'effective_at', '')::timestamptz;
    exception when others then
      raise exception using errcode = 'P0031', message = 'Invalid memory proposal';
    end;

    if v_key is null or v_key !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
       or char_length(coalesce(v_value_ciphertext, '')) not between 1 and 12000
       or coalesce(v_value_sha256, '') !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = 'P0031', message = 'Invalid memory proposal';
    end if;

    select * into v_source
    from public.messages
    where id = v_source_message_id
      and actor in ('guest', 'patient')
      and (
        patient_session_id = v_session.id
        or lead_session_id = v_session.origin_lead_session_id
      );

    if not found then
      raise exception using errcode = 'P0033', message = 'Invalid memory source provenance';
    end if;

    insert into public.memory_items (clinic_id, patient_id, kind, canonical_key)
    values (v_session.clinic_id, v_session.patient_id, v_kind, v_key)
    on conflict (patient_id, kind, canonical_key) do nothing;

    select * into v_item
    from public.memory_items
    where patient_id = v_session.patient_id
      and kind = v_kind
      and canonical_key = v_key
    for update;

    if v_item.current_revision_id is null and v_status <> 'active' then
      raise exception using errcode = 'P0034', message = 'A new memory fact must start active';
    end if;

    if v_status = 'stopped' and v_kind <> 'medication' then
      raise exception using errcode = 'P0034', message = 'Stopped status is valid only for medication';
    end if;

    if exists (
      select 1 from public.memory_revisions
      where memory_item_id = v_item.id and source_message_id = v_source_message_id
    ) then
      continue;
    end if;

    insert into public.memory_revisions (
      memory_item_id,
      value_ciphertext,
      value_sha256,
      status,
      source_message_id,
      supersedes_revision_id,
      model_run_id,
      confidence,
      effective_at
    ) values (
      v_item.id,
      v_value_ciphertext,
      v_value_sha256,
      v_status,
      v_source_message_id,
      v_item.current_revision_id,
      p_model_run_id,
      v_confidence,
      v_effective_at
    ) returning id into v_revision_id;

    update public.memory_items
    set current_revision_id = v_revision_id,
        updated_at = now()
    where id = v_item.id;
  end loop;
end;
$$;

create function public.complete_patient_turn_with_memory(
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
  p_citations jsonb,
  p_memory_proposals jsonb
)
returns setof public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assistant public.messages;
  v_model_run_id uuid;
begin
  select * into v_assistant
  from public.complete_patient_turn(
    p_patient_session_id,
    p_source_message_id,
    p_source_status,
    p_redaction_status,
    p_redaction_version,
    p_redaction_summary,
    p_assistant_ciphertext,
    p_assistant_sha256,
    p_risk_level,
    p_risk_reason,
    p_confidence,
    p_escalation_required,
    p_rule_matches,
    p_pipeline_version,
    p_risk_provenance,
    p_provider,
    p_model,
    p_prompt_version,
    p_redacted_input_hash,
    p_provider_response_id,
    p_model_status,
    p_duration_ms,
    p_error_code,
    p_citations
  );

  select id into v_model_run_id
  from public.model_runs
  where source_message_id = p_source_message_id
  order by created_at desc
  limit 1;

  perform public.apply_memory_revisions_internal(
    p_patient_session_id,
    v_model_run_id,
    p_memory_proposals
  );

  return next v_assistant;
end;
$$;

create function public.apply_patient_memory(
  p_patient_session_id uuid,
  p_memory_proposals jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.apply_memory_revisions_internal(
    p_patient_session_id,
    null,
    p_memory_proposals
  );
end;
$$;

alter table public.memory_items enable row level security;
alter table public.memory_revisions enable row level security;

revoke all on table public.memory_items from anon, authenticated;
revoke all on table public.memory_revisions from anon, authenticated;
grant select on table public.memory_items to authenticated;
grant select on table public.memory_revisions to authenticated;

create policy memory_items_select_own
on public.memory_items for select to authenticated
using (
  exists (
    select 1 from public.patients
    where patients.id = memory_items.patient_id
      and patients.auth_user_id = (select auth.uid())
  )
);

create policy memory_revisions_select_own
on public.memory_revisions for select to authenticated
using (
  exists (
    select 1
    from public.memory_items
    join public.patients on patients.id = memory_items.patient_id
    where memory_items.id = memory_revisions.memory_item_id
      and patients.auth_user_id = (select auth.uid())
  )
);

revoke execute on function public.reject_memory_revision_mutation() from public, anon, authenticated;
revoke execute on function public.apply_memory_revisions_internal(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.complete_patient_turn(uuid, uuid, public.message_status, public.redaction_status, text, jsonb, text, text, public.risk_level, text, public.response_confidence, boolean, text[], text, jsonb, text, text, text, text, text, public.model_run_status, integer, text, jsonb) from service_role;
revoke execute on function public.complete_patient_turn_with_memory(uuid, uuid, public.message_status, public.redaction_status, text, jsonb, text, text, public.risk_level, text, public.response_confidence, boolean, text[], text, jsonb, text, text, text, text, text, public.model_run_status, integer, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_patient_memory(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.complete_patient_turn_with_memory(uuid, uuid, public.message_status, public.redaction_status, text, jsonb, text, text, public.risk_level, text, public.response_confidence, boolean, text[], text, jsonb, text, text, text, text, text, public.model_run_status, integer, text, jsonb, jsonb) to service_role;
grant execute on function public.apply_patient_memory(uuid, jsonb) to service_role;

comment on table public.memory_items is 'Stable patient fact identities whose current revision projects the live Patient Profile.';
comment on table public.memory_revisions is 'Append-only encrypted fact history with exact message and optional model-run provenance.';
