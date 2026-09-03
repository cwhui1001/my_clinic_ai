create type public.member_role as enum ('staff', 'nurse', 'clinician');
create type public.escalation_status as enum ('required', 'queued', 'acknowledged', 'responded', 'closed');

create table public.clinic_memberships (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  role public.member_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_memberships_clinic_user_unique unique (clinic_id, auth_user_id),
  constraint clinic_memberships_id_clinic_unique unique (id, clinic_id)
);

create table public.escalations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null,
  patient_session_id uuid not null,
  trigger_message_id uuid not null references public.messages(id) on delete restrict,
  risk_assessment_id uuid not null unique references public.risk_assessments(id) on delete restrict,
  status public.escalation_status not null default 'required',
  triage_summary_ciphertext text,
  triage_summary_sha256 text,
  profile_snapshot_ciphertext text,
  profile_snapshot_sha256 text,
  attribution_snapshot jsonb,
  response_min_hours smallint,
  response_max_hours smallint,
  response_expected_by timestamptz,
  acknowledged_by_membership_id uuid,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint escalations_patient_clinic_fk
    foreign key (patient_id, clinic_id) references public.patients(id, clinic_id) on delete restrict,
  constraint escalations_session_clinic_fk
    foreign key (patient_session_id, clinic_id) references public.patient_sessions(id, clinic_id) on delete restrict,
  constraint escalations_acknowledger_clinic_fk
    foreign key (acknowledged_by_membership_id, clinic_id)
    references public.clinic_memberships(id, clinic_id) on delete restrict,
  constraint escalations_attribution_object_check
    check (attribution_snapshot is null or jsonb_typeof(attribution_snapshot) = 'object'),
  constraint escalations_response_window_check check (
    (response_min_hours is null and response_max_hours is null)
    or (response_min_hours > 0 and response_max_hours >= response_min_hours)
  ),
  constraint escalations_payload_state_check check (
    (
      status = 'required'
      and triage_summary_ciphertext is null
      and profile_snapshot_ciphertext is null
      and attribution_snapshot is null
      and sent_at is null
      and response_expected_by is null
    )
    or (
      status <> 'required'
      and triage_summary_ciphertext is not null
      and triage_summary_sha256 ~ '^[0-9a-f]{64}$'
      and profile_snapshot_ciphertext is not null
      and profile_snapshot_sha256 ~ '^[0-9a-f]{64}$'
      and attribution_snapshot is not null
      and sent_at is not null
      and response_min_hours is not null
      and response_max_hours is not null
      and response_expected_by is not null
    )
  ),
  constraint escalations_acknowledgement_check check (
    (acknowledged_by_membership_id is null) = (acknowledged_at is null)
  )
);

create table public.escalation_provenance (
  id uuid primary key default gen_random_uuid(),
  escalation_id uuid not null references public.escalations(id) on delete restrict,
  message_id uuid references public.messages(id) on delete restrict,
  memory_revision_id uuid references public.memory_revisions(id) on delete restrict,
  purpose text not null check (purpose in ('trigger', 'summary_support', 'profile_support')),
  created_at timestamptz not null default now(),
  constraint escalation_provenance_one_source_check
    check ((message_id is null) <> (memory_revision_id is null)),
  constraint escalation_provenance_unique
    unique nulls not distinct (escalation_id, message_id, memory_revision_id, purpose)
);

create table public.clinician_responses (
  id uuid primary key default gen_random_uuid(),
  escalation_id uuid not null references public.escalations(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  author_membership_id uuid not null,
  content_ciphertext text not null check (char_length(content_ciphertext) between 1 and 12000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint clinician_responses_author_clinic_fk
    foreign key (author_membership_id, clinic_id)
    references public.clinic_memberships(id, clinic_id) on delete restrict
);

create index clinic_memberships_user_active_idx
  on public.clinic_memberships (auth_user_id, clinic_id) where active = true;
create index escalations_clinic_queue_idx
  on public.escalations (clinic_id, status, sent_at desc);
create index escalations_patient_session_idx
  on public.escalations (patient_session_id, created_at desc);
create index escalation_provenance_parent_idx
  on public.escalation_provenance (escalation_id);
create index clinician_responses_parent_idx
  on public.clinician_responses (escalation_id, created_at);

create function public.has_active_clinic_membership(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_memberships
    where clinic_id = p_clinic_id
      and auth_user_id = auth.uid()
      and active = true
  );
$$;

create function public.has_consented_patient_access(p_clinic_id uuid, p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_active_clinic_membership(p_clinic_id)
    and coalesce((
      select consent_events.action
      from public.consent_events
      where consent_events.clinic_id = p_clinic_id
        and consent_events.patient_id = p_patient_id
        and consent_events.type = 'healthcare_sharing'
      order by consent_events.occurred_at desc
      limit 1
    ) = 'granted', false);
$$;

create function public.create_required_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.patient_sessions;
begin
  if new.escalation_required = false then
    return new;
  end if;

  select * into v_session
  from public.patient_sessions
  where id = new.patient_session_id;

  insert into public.escalations (
    clinic_id,
    patient_id,
    patient_session_id,
    trigger_message_id,
    risk_assessment_id,
    status
  ) values (
    new.clinic_id,
    v_session.patient_id,
    new.patient_session_id,
    new.message_id,
    new.id,
    'required'
  ) on conflict (risk_assessment_id) do nothing;

  return new;
end;
$$;

create trigger risk_assessment_requires_escalation
after insert on public.risk_assessments
for each row execute function public.create_required_escalation();

insert into public.escalations (
  clinic_id,
  patient_id,
  patient_session_id,
  trigger_message_id,
  risk_assessment_id,
  status,
  created_at
)
select
  risk_assessments.clinic_id,
  patient_sessions.patient_id,
  risk_assessments.patient_session_id,
  risk_assessments.message_id,
  risk_assessments.id,
  'required',
  risk_assessments.assessed_at
from public.risk_assessments
join public.patient_sessions on patient_sessions.id = risk_assessments.patient_session_id
where risk_assessments.escalation_required = true
on conflict (risk_assessment_id) do nothing;

create function public.queue_escalation(
  p_escalation_id uuid,
  p_triage_summary_ciphertext text,
  p_triage_summary_sha256 text,
  p_profile_snapshot_ciphertext text,
  p_profile_snapshot_sha256 text,
  p_provenance jsonb
)
returns setof public.escalations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_escalation public.escalations;
  v_session public.patient_sessions;
  v_clinic public.clinics;
  v_lead public.lead_sessions;
  v_source jsonb;
  v_message_id uuid;
  v_memory_revision_id uuid;
  v_purpose text;
  v_consent_action public.consent_action;
begin
  select escalations.* into v_escalation
  from public.escalations
  join public.patients on patients.id = escalations.patient_id
  where escalations.id = p_escalation_id
    and patients.auth_user_id = auth.uid()
  for update of escalations;

  if not found then
    raise exception using errcode = 'P0020', message = 'Escalation unavailable';
  end if;

  if v_escalation.status <> 'required' then
    return next v_escalation;
    return;
  end if;

  select consent_events.action into v_consent_action
    from public.consent_events
    where consent_events.clinic_id = v_escalation.clinic_id
      and consent_events.patient_id = v_escalation.patient_id
      and consent_events.type = 'healthcare_sharing'
    order by consent_events.occurred_at desc
    limit 1;

  if v_consent_action is distinct from 'granted'::public.consent_action then
    raise exception using errcode = 'P0021', message = 'Healthcare-sharing consent required';
  end if;

  if char_length(coalesce(p_triage_summary_ciphertext, '')) not between 1 and 12000
     or coalesce(p_triage_summary_sha256, '') !~ '^[0-9a-f]{64}$'
     or char_length(coalesce(p_profile_snapshot_ciphertext, '')) not between 1 and 50000
     or coalesce(p_profile_snapshot_sha256, '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(coalesce(p_provenance, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_provenance, '[]'::jsonb)) not between 1 and 100 then
    raise exception using errcode = 'P0040', message = 'Invalid escalation payload';
  end if;

  select * into v_session from public.patient_sessions where id = v_escalation.patient_session_id;
  select * into v_clinic from public.clinics where id = v_escalation.clinic_id;
  select * into v_lead from public.lead_sessions where id = v_session.origin_lead_session_id;

  if not exists (
    select 1
    from jsonb_array_elements(p_provenance) supplied
    where supplied ->> 'purpose' = 'trigger'
      and (supplied ->> 'message_id')::uuid = v_escalation.trigger_message_id
  ) then
    raise exception using errcode = 'P0040', message = 'Trigger provenance required';
  end if;

  for v_source in select value from jsonb_array_elements(p_provenance)
  loop
    begin
      v_message_id := nullif(v_source ->> 'message_id', '')::uuid;
      v_memory_revision_id := nullif(v_source ->> 'memory_revision_id', '')::uuid;
      v_purpose := v_source ->> 'purpose';
    exception when others then
      raise exception using errcode = 'P0040', message = 'Invalid escalation provenance';
    end;

    if (v_message_id is null) = (v_memory_revision_id is null)
       or v_purpose not in ('trigger', 'summary_support', 'profile_support') then
      raise exception using errcode = 'P0040', message = 'Invalid escalation provenance';
    end if;

    if v_message_id is not null and not exists (
      select 1 from public.messages
      where id = v_message_id
        and (
          patient_session_id = v_session.id
          or lead_session_id = v_session.origin_lead_session_id
        )
    ) then
      raise exception using errcode = 'P0040', message = 'Invalid message provenance';
    end if;

    if v_memory_revision_id is not null and not exists (
      select 1
      from public.memory_revisions
      join public.memory_items on memory_items.id = memory_revisions.memory_item_id
      where memory_revisions.id = v_memory_revision_id
        and memory_items.patient_id = v_escalation.patient_id
    ) then
      raise exception using errcode = 'P0040', message = 'Invalid profile provenance';
    end if;

    insert into public.escalation_provenance (
      escalation_id, message_id, memory_revision_id, purpose
    ) values (
      v_escalation.id, v_message_id, v_memory_revision_id, v_purpose
    ) on conflict do nothing;
  end loop;

  update public.escalations
  set status = 'queued',
      triage_summary_ciphertext = p_triage_summary_ciphertext,
      triage_summary_sha256 = p_triage_summary_sha256,
      profile_snapshot_ciphertext = p_profile_snapshot_ciphertext,
      profile_snapshot_sha256 = p_profile_snapshot_sha256,
      attribution_snapshot = jsonb_build_object(
        'source_channel', v_lead.source_channel,
        'social_platform', v_lead.social_platform,
        'campaign_id', v_lead.campaign_id,
        'creative', v_lead.creative,
        'landing_timestamp', v_lead.landing_timestamp,
        'landing_context', v_lead.landing_context
      ),
      response_min_hours = v_clinic.response_min_hours,
      response_max_hours = v_clinic.response_max_hours,
      response_expected_by = now() + make_interval(hours => v_clinic.response_max_hours),
      sent_at = now(),
      updated_at = now()
  where id = v_escalation.id
  returning * into v_escalation;

  insert into public.funnel_events (
    clinic_id,
    lead_session_id,
    patient_session_id,
    name,
    source_channel,
    identity_level,
    metadata,
    idempotency_key
  ) values (
    v_escalation.clinic_id,
    v_lead.id,
    v_escalation.patient_session_id,
    'escalation_sent',
    v_lead.source_channel,
    'authenticated',
    jsonb_build_object('escalation_id', v_escalation.id),
    'escalation_sent:' || v_escalation.id::text
  ) on conflict (idempotency_key) do nothing;

  return next v_escalation;
end;
$$;

create function public.acknowledge_escalation(p_escalation_id uuid)
returns setof public.escalations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_escalation public.escalations;
  v_membership public.clinic_memberships;
begin
  select * into v_escalation from public.escalations
  where id = p_escalation_id and status <> 'required'
  for update;
  if not found then
    raise exception using errcode = 'P0020', message = 'Escalation unavailable';
  end if;

  select * into v_membership from public.clinic_memberships
  where clinic_id = v_escalation.clinic_id
    and auth_user_id = auth.uid()
    and active = true;
  if not found or not public.has_consented_patient_access(v_escalation.clinic_id, v_escalation.patient_id) then
    raise exception using errcode = 'P0041', message = 'Staff access denied';
  end if;

  if v_escalation.status = 'queued' then
    update public.escalations
    set status = 'acknowledged',
        acknowledged_by_membership_id = v_membership.id,
        acknowledged_at = now(),
        updated_at = now()
    where id = v_escalation.id
    returning * into v_escalation;
  end if;

  return next v_escalation;
end;
$$;

create function public.respond_to_escalation(
  p_escalation_id uuid,
  p_content_ciphertext text,
  p_content_sha256 text
)
returns setof public.clinician_responses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_escalation public.escalations;
  v_membership public.clinic_memberships;
  v_response public.clinician_responses;
begin
  select * into v_escalation from public.escalations
  where id = p_escalation_id and status in ('queued', 'acknowledged', 'responded')
  for update;
  if not found then
    raise exception using errcode = 'P0020', message = 'Escalation unavailable';
  end if;

  select * into v_membership from public.clinic_memberships
  where clinic_id = v_escalation.clinic_id
    and auth_user_id = auth.uid()
    and active = true
    and role in ('nurse', 'clinician');
  if not found or not public.has_consented_patient_access(v_escalation.clinic_id, v_escalation.patient_id) then
    raise exception using errcode = 'P0041', message = 'Clinical response access denied';
  end if;

  if char_length(coalesce(p_content_ciphertext, '')) not between 1 and 12000
     or coalesce(p_content_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0040', message = 'Invalid clinician response';
  end if;

  insert into public.clinician_responses (
    escalation_id, clinic_id, author_membership_id, content_ciphertext, content_sha256
  ) values (
    v_escalation.id, v_escalation.clinic_id, v_membership.id, p_content_ciphertext, p_content_sha256
  ) returning * into v_response;

  update public.escalations
  set status = 'responded', updated_at = now()
  where id = v_escalation.id;

  return next v_response;
end;
$$;

create function public.close_escalation(p_escalation_id uuid)
returns setof public.escalations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_escalation public.escalations;
begin
  select escalations.* into v_escalation
  from public.escalations
  join public.clinic_memberships
    on clinic_memberships.clinic_id = escalations.clinic_id
   and clinic_memberships.auth_user_id = auth.uid()
   and clinic_memberships.active = true
   and clinic_memberships.role in ('nurse', 'clinician')
  where escalations.id = p_escalation_id
    and escalations.status in ('responded', 'closed')
  for update of escalations;

  if not found or not public.has_consented_patient_access(v_escalation.clinic_id, v_escalation.patient_id) then
    raise exception using errcode = 'P0041', message = 'Close escalation access denied';
  end if;

  if v_escalation.status = 'responded' then
    update public.escalations
    set status = 'closed', updated_at = now()
    where id = v_escalation.id
    returning * into v_escalation;
  end if;

  return next v_escalation;
end;
$$;

alter table public.clinic_memberships enable row level security;
alter table public.escalations enable row level security;
alter table public.escalation_provenance enable row level security;
alter table public.clinician_responses enable row level security;

revoke all on table public.clinic_memberships from anon, authenticated;
revoke all on table public.escalations from anon, authenticated;
revoke all on table public.escalation_provenance from anon, authenticated;
revoke all on table public.clinician_responses from anon, authenticated;
grant select on table public.clinic_memberships to authenticated;
grant select on table public.escalations to authenticated;
grant select on table public.escalation_provenance to authenticated;
grant select on table public.clinician_responses to authenticated;

create policy clinic_memberships_select_own
on public.clinic_memberships for select to authenticated
using (auth_user_id = (select auth.uid()));

create policy escalations_select_patient_or_staff
on public.escalations for select to authenticated
using (
  exists (
    select 1 from public.patients
    where patients.id = escalations.patient_id
      and patients.auth_user_id = (select auth.uid())
  )
  or (
    status <> 'required'
    and public.has_consented_patient_access(clinic_id, patient_id)
  )
);

create policy escalation_provenance_select_patient_or_staff
on public.escalation_provenance for select to authenticated
using (
  exists (
    select 1 from public.escalations
    where escalations.id = escalation_provenance.escalation_id
  )
);

create policy clinician_responses_select_patient_or_staff
on public.clinician_responses for select to authenticated
using (
  exists (
    select 1 from public.escalations
    where escalations.id = clinician_responses.escalation_id
  )
);

create policy patients_select_consented_staff
on public.patients for select to authenticated
using (public.has_consented_patient_access(clinic_id, id));

create policy patient_sessions_select_consented_staff
on public.patient_sessions for select to authenticated
using (public.has_consented_patient_access(clinic_id, patient_id));

create policy messages_select_consented_staff
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.patient_sessions
    where (
      patient_sessions.id = messages.patient_session_id
      or patient_sessions.origin_lead_session_id = messages.lead_session_id
    )
      and public.has_consented_patient_access(patient_sessions.clinic_id, patient_sessions.patient_id)
  )
);

create policy memory_items_select_consented_staff
on public.memory_items for select to authenticated
using (public.has_consented_patient_access(clinic_id, patient_id));

create policy memory_revisions_select_consented_staff
on public.memory_revisions for select to authenticated
using (
  exists (
    select 1 from public.memory_items
    where memory_items.id = memory_revisions.memory_item_id
      and public.has_consented_patient_access(memory_items.clinic_id, memory_items.patient_id)
  )
);

create policy risk_assessments_select_consented_staff
on public.risk_assessments for select to authenticated
using (
  exists (
    select 1 from public.patient_sessions
    where patient_sessions.id = risk_assessments.patient_session_id
      and public.has_consented_patient_access(patient_sessions.clinic_id, patient_sessions.patient_id)
  )
);

revoke execute on function public.has_active_clinic_membership(uuid) from public, anon;
revoke execute on function public.has_consented_patient_access(uuid, uuid) from public, anon;
revoke execute on function public.create_required_escalation() from public, anon, authenticated;
revoke execute on function public.queue_escalation(uuid, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.acknowledge_escalation(uuid) from public, anon;
revoke execute on function public.respond_to_escalation(uuid, text, text) from public, anon;
revoke execute on function public.close_escalation(uuid) from public, anon;

grant execute on function public.has_active_clinic_membership(uuid) to authenticated;
grant execute on function public.has_consented_patient_access(uuid, uuid) to authenticated;
grant execute on function public.queue_escalation(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.acknowledge_escalation(uuid) to authenticated;
grant execute on function public.respond_to_escalation(uuid, text, text) to authenticated;
grant execute on function public.close_escalation(uuid) to authenticated;

comment on table public.escalations is 'Patient-confirmed clinic handoffs with immutable point-in-time payload snapshots.';
comment on table public.escalation_provenance is 'Normalized message and memory-revision support for each escalation payload.';
comment on table public.clinician_responses is 'Protected human responses authored by same-clinic Nurse or Clinician memberships.';
