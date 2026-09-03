create type public.patient_session_status as enum ('active', 'closed');
create type public.contact_point_type as enum ('email', 'phone', 'social_handle');
create type public.consent_type as enum ('healthcare_sharing', 'marketing_email');
create type public.consent_action as enum ('granted', 'withdrawn');

alter table public.lead_sessions
  add constraint lead_sessions_id_clinic_unique unique (id, clinic_id);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, auth_user_id),
  unique (id, clinic_id)
);

create table public.contact_points (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null,
  type public.contact_point_type not null,
  value_ciphertext text,
  value_hash text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  external_ref text,
  verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, type, value_hash),
  foreign key (patient_id, clinic_id) references public.patients(id, clinic_id) on delete cascade,
  check (
    (type = 'email' and external_ref is not null and value_ciphertext is null)
    or (type <> 'email' and value_ciphertext is not null)
  )
);

create index contact_points_patient_active_idx
  on public.contact_points (patient_id, type)
  where active = true;

create table public.patient_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null,
  origin_lead_session_id uuid not null unique,
  status public.patient_session_status not null default 'active',
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'closed') = (closed_at is not null)),
  foreign key (patient_id, clinic_id) references public.patients(id, clinic_id) on delete cascade,
  foreign key (origin_lead_session_id, clinic_id) references public.lead_sessions(id, clinic_id) on delete restrict
);

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null,
  lead_session_id uuid,
  type public.consent_type not null,
  action public.consent_action not null,
  policy_version text not null,
  notice_version text not null,
  captured_via text not null,
  evidence_metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now(),
  foreign key (patient_id, clinic_id) references public.patients(id, clinic_id) on delete cascade,
  foreign key (lead_session_id, clinic_id) references public.lead_sessions(id, clinic_id) on delete restrict
);

alter table public.lead_sessions
  add column conversion_idempotency_hash text unique,
  add constraint lead_sessions_converted_patient_fk
    foreign key (converted_patient_id) references public.patients(id) on delete restrict,
  add constraint lead_sessions_converted_patient_session_fk
    foreign key (converted_patient_session_id) references public.patient_sessions(id) on delete restrict;

create function public.mark_lead_auth_started(p_recovery_token_hash text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead public.lead_sessions;
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

  if v_lead.status = 'active' then
    update public.lead_sessions
    set status = 'auth_started', updated_at = now()
    where id = v_lead.id;
  end if;

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
    'auth_started',
    v_lead.source_channel,
    v_lead.identity_level,
    '{}'::jsonb,
    'auth_started:' || v_lead.id::text
  ) on conflict (idempotency_key) do nothing;

  return v_lead.id;
end;
$$;

create function public.convert_lead_to_patient(
  p_recovery_token_hash text,
  p_phone_ciphertext text,
  p_phone_hash text,
  p_consent_granted boolean,
  p_policy_version text,
  p_notice_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid;
  v_auth_email text;
  v_email_confirmed_at timestamptz;
  v_lead public.lead_sessions;
  v_patient_id uuid;
  v_patient_session_id uuid;
  v_existing_auth_user_id uuid;
  v_email_hash text;
begin
  v_auth_user_id := auth.uid();
  if v_auth_user_id is null then
    raise exception using errcode = 'P0010', message = 'Authentication required';
  end if;

  select email, email_confirmed_at
  into v_auth_email, v_email_confirmed_at
  from auth.users
  where id = v_auth_user_id;

  if v_auth_email is null or v_email_confirmed_at is null then
    raise exception using errcode = 'P0011', message = 'Verified email required';
  end if;

  if not p_consent_granted
    or nullif(trim(p_policy_version), '') is null
    or nullif(trim(p_notice_version), '') is null then
    raise exception using errcode = 'P0012', message = 'Explicit consent required';
  end if;

  if p_phone_ciphertext is null
    or p_phone_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0013', message = 'Valid phone contact required';
  end if;

  select * into v_lead
  from public.lead_sessions
  where recovery_token_hash = p_recovery_token_hash
     or conversion_idempotency_hash = p_recovery_token_hash
  for update;

  if not found then
    raise exception using errcode = 'P0003', message = 'Guest session not found';
  end if;

  if v_lead.status = 'converted' then
    select auth_user_id into v_existing_auth_user_id
    from public.patients
    where id = v_lead.converted_patient_id;

    if v_existing_auth_user_id <> v_auth_user_id then
      raise exception using errcode = '42501', message = 'Lead already converted';
    end if;

    return v_lead.converted_patient_session_id;
  end if;

  if v_lead.status not in ('active', 'auth_started') or v_lead.expires_at <= now() then
    raise exception using errcode = 'P0003', message = 'Guest session not active';
  end if;

  if not exists (
    select 1
    from public.funnel_events
    where lead_session_id = v_lead.id
      and name = 'value_event'
  ) and not exists (
    select 1
    from public.messages
    where lead_session_id = v_lead.id
      and actor = 'assistant'
      and requires_secure_continue = true
  ) then
    raise exception using errcode = 'P0014', message = 'Guest value required before conversion';
  end if;

  insert into public.patients (clinic_id, auth_user_id)
  values (v_lead.clinic_id, v_auth_user_id)
  on conflict (clinic_id, auth_user_id)
  do update set updated_at = now()
  returning id into v_patient_id;

  v_email_hash := encode(
    sha256(convert_to(lower(v_auth_email), 'UTF8')),
    'hex'
  );

  update public.contact_points
  set active = false, updated_at = now()
  where patient_id = v_patient_id
    and type = 'email'
    and active = true
    and value_hash <> v_email_hash;

  insert into public.contact_points (
    clinic_id,
    patient_id,
    type,
    value_hash,
    external_ref,
    verified_at
  ) values (
    v_lead.clinic_id,
    v_patient_id,
    'email',
    v_email_hash,
    'auth.primary_email',
    v_email_confirmed_at
  ) on conflict (patient_id, type, value_hash)
  do update set
    active = true,
    verified_at = excluded.verified_at,
    updated_at = now();

  update public.contact_points
  set active = false, updated_at = now()
  where patient_id = v_patient_id
    and type = 'phone'
    and active = true
    and value_hash <> p_phone_hash;

  insert into public.contact_points (
    clinic_id,
    patient_id,
    type,
    value_ciphertext,
    value_hash,
    verified_at
  ) values (
    v_lead.clinic_id,
    v_patient_id,
    'phone',
    p_phone_ciphertext,
    p_phone_hash,
    null
  ) on conflict (patient_id, type, value_hash)
  do update set
    value_ciphertext = excluded.value_ciphertext,
    active = true,
    updated_at = now();

  insert into public.consent_events (
    clinic_id,
    patient_id,
    lead_session_id,
    type,
    action,
    policy_version,
    notice_version,
    captured_via,
    evidence_metadata,
    idempotency_key
  ) values (
    v_lead.clinic_id,
    v_patient_id,
    v_lead.id,
    'healthcare_sharing',
    'granted',
    p_policy_version,
    p_notice_version,
    'conversion_page',
    jsonb_build_object('explicit_checkbox', true),
    'healthcare_sharing:granted:' || v_lead.id::text
  );

  insert into public.patient_sessions (
    clinic_id,
    patient_id,
    origin_lead_session_id
  ) values (
    v_lead.clinic_id,
    v_patient_id,
    v_lead.id
  ) returning id into v_patient_session_id;

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
    v_lead.clinic_id,
    v_lead.id,
    v_patient_session_id,
    'consented',
    v_lead.source_channel,
    v_lead.identity_level,
    '{}'::jsonb,
    'consented:' || v_lead.id::text
  );

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
    v_lead.clinic_id,
    v_lead.id,
    v_patient_session_id,
    'patient_created',
    v_lead.source_channel,
    v_lead.identity_level,
    '{}'::jsonb,
    'patient_created:' || v_lead.id::text
  );

  update public.lead_sessions
  set status = 'converted',
      recovery_token_hash = null,
      conversion_idempotency_hash = p_recovery_token_hash,
      converted_patient_id = v_patient_id,
      converted_patient_session_id = v_patient_session_id,
      converted_at = now(),
      updated_at = now()
  where id = v_lead.id;

  return v_patient_session_id;
end;
$$;

alter table public.patients enable row level security;
alter table public.contact_points enable row level security;
alter table public.patient_sessions enable row level security;
alter table public.consent_events enable row level security;

revoke all on table public.patients from anon, authenticated;
revoke all on table public.contact_points from anon, authenticated;
revoke all on table public.patient_sessions from anon, authenticated;
revoke all on table public.consent_events from anon, authenticated;

grant select on table public.patients to authenticated;
grant select on table public.contact_points to authenticated;
grant select on table public.patient_sessions to authenticated;
grant select on table public.consent_events to authenticated;
grant select on table public.messages to authenticated;

create policy patients_select_own
on public.patients for select to authenticated
using ((select auth.uid()) = auth_user_id);

create policy contact_points_select_own
on public.contact_points for select to authenticated
using (
  exists (
    select 1 from public.patients
    where patients.id = contact_points.patient_id
      and patients.auth_user_id = (select auth.uid())
  )
);

create policy patient_sessions_select_own
on public.patient_sessions for select to authenticated
using (
  exists (
    select 1 from public.patients
    where patients.id = patient_sessions.patient_id
      and patients.auth_user_id = (select auth.uid())
  )
);

create policy consent_events_select_own
on public.consent_events for select to authenticated
using (
  exists (
    select 1 from public.patients
    where patients.id = consent_events.patient_id
      and patients.auth_user_id = (select auth.uid())
  )
);

create policy messages_select_converted_origin
on public.messages for select to authenticated
using (
  exists (
    select 1
    from public.patient_sessions
    join public.patients on patients.id = patient_sessions.patient_id
    where patient_sessions.origin_lead_session_id = messages.lead_session_id
      and patients.auth_user_id = (select auth.uid())
  )
);

revoke execute on function public.mark_lead_auth_started(text) from public, anon, authenticated;
revoke execute on function public.convert_lead_to_patient(text, text, text, boolean, text, text) from public, anon;

grant execute on function public.mark_lead_auth_started(text) to service_role;
grant execute on function public.convert_lead_to_patient(text, text, text, boolean, text, text) to authenticated;

comment on table public.patients is 'Clinic-scoped immutable patient identities linked to Supabase Auth users.';
comment on table public.contact_points is 'Versionable patient contact points; email remains authoritative in Supabase Auth.';
comment on table public.consent_events is 'Append-only, versioned consent evidence for healthcare sharing and marketing.';
comment on table public.patient_sessions is 'Authenticated patient sessions linked one-to-one with their origin LeadSession.';
comment on column public.lead_sessions.conversion_idempotency_hash is 'Revoked guest credential hash retained solely for authenticated conversion retry idempotency.';
