alter table public.lead_sessions
  add column phone_ciphertext text,
  add column phone_hash text check (phone_hash is null or phone_hash ~ '^[0-9a-f]{64}$'),
  add constraint lead_sessions_phone_pair_check
    check ((phone_ciphertext is null) = (phone_hash is null));

create function public.create_lead_session_v2(
  p_clinic_slug text,
  p_source_channel public.source_channel,
  p_social_platform public.social_platform,
  p_campaign_id text,
  p_creative text,
  p_identity_level public.identity_level,
  p_landing_timestamp timestamptz,
  p_landing_context jsonb,
  p_context_ciphertext text,
  p_social_handle_ciphertext text,
  p_recovery_token_hash text,
  p_request_fingerprint_hash text,
  p_expires_at timestamptz,
  p_phone_ciphertext text,
  p_phone_hash text
)
returns setof public.lead_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare v_lead public.lead_sessions;
begin
  if (p_phone_ciphertext is null) <> (p_phone_hash is null)
     or (p_phone_hash is not null and p_phone_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = 'P0013', message = 'Invalid captured phone';
  end if;
  select * into v_lead from public.create_lead_session(
    p_clinic_slug, p_source_channel, p_social_platform, p_campaign_id, p_creative,
    p_identity_level, p_landing_timestamp, p_landing_context, p_context_ciphertext,
    p_social_handle_ciphertext, p_recovery_token_hash, p_request_fingerprint_hash, p_expires_at
  );
  update public.lead_sessions
  set phone_ciphertext = p_phone_ciphertext, phone_hash = p_phone_hash, updated_at = now()
  where id = v_lead.id
  returning * into v_lead;
  return next v_lead;
end;
$$;

alter table public.patient_sessions
  add column acquisition_identity_level public.identity_level,
  add column current_identity_level public.identity_level not null default 'authenticated',
  add column authentication_method text,
  add column identity_verified boolean not null default true;

update public.patient_sessions as patient_sessions
set acquisition_identity_level = lead_sessions.identity_level,
    authentication_method = case
      when auth_users.email_confirmed_at is not null then 'email_password'
      when auth_users.phone_confirmed_at is not null then 'phone_otp'
      else 'legacy_unknown'
    end,
    identity_verified = auth_users.email_confirmed_at is not null or auth_users.phone_confirmed_at is not null
from public.lead_sessions as lead_sessions,
     public.patients as patients
join auth.users as auth_users on auth_users.id = patients.auth_user_id
where lead_sessions.id = patient_sessions.origin_lead_session_id
  and patients.id = patient_sessions.patient_id;

alter table public.patient_sessions
  alter column acquisition_identity_level set not null,
  alter column authentication_method set not null,
  add constraint patient_sessions_authentication_method_check
    check (authentication_method in ('email_password', 'phone_otp', 'legacy_unknown'));

create function public.convert_lead_to_patient_v2(
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
  v_auth_user_id uuid;
  v_auth_email text;
  v_auth_phone text;
  v_email_confirmed_at timestamptz;
  v_phone_confirmed_at timestamptz;
  v_auth_provider text;
  v_authentication_method text;
  v_lead public.lead_sessions;
  v_patient_id uuid;
  v_patient_session_id uuid;
  v_existing_auth_user_id uuid;
  v_email_hash text;
  v_auth_phone_hash text;
  v_social_handle_hash text;
begin
  v_auth_user_id := auth.uid();
  if v_auth_user_id is null then
    raise exception using errcode = 'P0010', message = 'Authentication required';
  end if;

  select email, phone, email_confirmed_at, phone_confirmed_at
  into v_auth_email, v_auth_phone, v_email_confirmed_at, v_phone_confirmed_at
  from auth.users
  where id = v_auth_user_id;

  if v_email_confirmed_at is null and v_phone_confirmed_at is null then
    raise exception using errcode = 'P0011', message = 'Verified email or phone required';
  end if;
  v_auth_provider := coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '');
  v_authentication_method := case when v_auth_provider = 'phone' then 'phone_otp' else 'email_password' end;

  if not p_consent_granted
    or nullif(trim(p_policy_version), '') is null
    or nullif(trim(p_notice_version), '') is null then
    raise exception using errcode = 'P0012', message = 'Explicit clinical consent required';
  end if;
  if p_marketing_consent and (
    nullif(trim(p_marketing_policy_version), '') is null
    or nullif(trim(p_marketing_notice_version), '') is null
  ) then
    raise exception using errcode = 'P0012', message = 'Versioned marketing consent required';
  end if;
  if p_phone_ciphertext is null or p_phone_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0013', message = 'Valid phone contact required';
  end if;

  if v_authentication_method = 'phone_otp' then
    v_auth_phone_hash := encode(sha256(convert_to(v_auth_phone, 'UTF8')), 'hex');
    if v_auth_phone_hash <> p_phone_hash then
      raise exception using errcode = 'P0013', message = 'Phone must match verified identity';
    end if;
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
    select auth_user_id into v_existing_auth_user_id from public.patients where id = v_lead.converted_patient_id;
    if v_existing_auth_user_id <> v_auth_user_id then
      raise exception using errcode = '42501', message = 'Lead already converted';
    end if;
    return v_lead.converted_patient_session_id;
  end if;
  if v_lead.status not in ('active', 'auth_started') or v_lead.expires_at <= now() then
    raise exception using errcode = 'P0003', message = 'Guest session not active';
  end if;
  if not exists (
    select 1 from public.funnel_events where lead_session_id = v_lead.id and name = 'value_event'
  ) and not exists (
    select 1 from public.messages where lead_session_id = v_lead.id and actor = 'assistant' and requires_secure_continue = true
  ) then
    raise exception using errcode = 'P0014', message = 'Guest value required before conversion';
  end if;

  insert into public.patients (clinic_id, auth_user_id)
  values (v_lead.clinic_id, v_auth_user_id)
  on conflict (clinic_id, auth_user_id) do update set updated_at = now()
  returning id into v_patient_id;

  if v_email_confirmed_at is not null and v_auth_email is not null then
    v_email_hash := encode(sha256(convert_to(lower(v_auth_email), 'UTF8')), 'hex');
    update public.contact_points set active = false, updated_at = now()
    where patient_id = v_patient_id and type = 'email' and active and value_hash <> v_email_hash;
    insert into public.contact_points (clinic_id, patient_id, type, value_hash, external_ref, verified_at)
    values (v_lead.clinic_id, v_patient_id, 'email', v_email_hash, 'auth.primary_email', v_email_confirmed_at)
    on conflict (patient_id, type, value_hash) do update
      set active = true, verified_at = excluded.verified_at, updated_at = now();
  end if;

  update public.contact_points set active = false, updated_at = now()
  where patient_id = v_patient_id and type = 'phone' and active and value_hash <> p_phone_hash;
  insert into public.contact_points (clinic_id, patient_id, type, value_ciphertext, value_hash, verified_at)
  values (
    v_lead.clinic_id, v_patient_id, 'phone', p_phone_ciphertext, p_phone_hash,
    case when v_authentication_method = 'phone_otp' then v_phone_confirmed_at else null end
  )
  on conflict (patient_id, type, value_hash) do update
    set value_ciphertext = excluded.value_ciphertext, active = true,
        verified_at = coalesce(excluded.verified_at, contact_points.verified_at), updated_at = now();

  if v_lead.social_handle_ciphertext is not null then
    v_social_handle_hash := encode(sha256(convert_to(v_lead.social_handle_ciphertext, 'UTF8')), 'hex');
    insert into public.contact_points (clinic_id, patient_id, type, value_ciphertext, value_hash, external_ref, verified_at, active)
    values (
      v_lead.clinic_id, v_patient_id, 'social_handle', v_lead.social_handle_ciphertext,
      v_social_handle_hash, 'lead_session:' || v_lead.id::text || ':social_handle', null
    )
    on conflict (patient_id, type, value_hash) do update
      set value_ciphertext = excluded.value_ciphertext, active = true, updated_at = now();
  end if;

  if v_lead.phone_ciphertext is not null and v_lead.phone_hash is not null then
    insert into public.contact_points (clinic_id, patient_id, type, value_ciphertext, value_hash, external_ref, verified_at)
    values (
      v_lead.clinic_id, v_patient_id, 'phone', v_lead.phone_ciphertext, v_lead.phone_hash,
      'lead_session:' || v_lead.id::text || ':phone',
      case when v_authentication_method = 'phone_otp' and v_lead.phone_hash = v_auth_phone_hash then v_phone_confirmed_at else null end,
      v_lead.phone_hash = p_phone_hash
    )
    on conflict (patient_id, type, value_hash) do update
      set value_ciphertext = excluded.value_ciphertext,
          external_ref = excluded.external_ref,
          active = contact_points.active or excluded.active,
          verified_at = coalesce(excluded.verified_at, contact_points.verified_at), updated_at = now();
  end if;

  insert into public.consent_events (
    clinic_id, patient_id, lead_session_id, type, action, policy_version,
    notice_version, captured_via, evidence_metadata, idempotency_key
  ) values (
    v_lead.clinic_id, v_patient_id, v_lead.id, 'healthcare_sharing', 'granted',
    p_policy_version, p_notice_version, 'conversion_page',
    jsonb_build_object('explicit_checkbox', true), 'healthcare_sharing:granted:' || v_lead.id::text
  );

  if p_marketing_consent then
    insert into public.consent_events (
      clinic_id, patient_id, lead_session_id, type, action, policy_version,
      notice_version, captured_via, evidence_metadata, idempotency_key
    ) values (
      v_lead.clinic_id, v_patient_id, v_lead.id, 'marketing_email', 'granted',
      p_marketing_policy_version, p_marketing_notice_version, 'conversion_page',
      jsonb_build_object('explicit_checkbox', true, 'default', false),
      'marketing_email:granted:' || v_lead.id::text
    );
  end if;

  insert into public.patient_sessions (
    clinic_id, patient_id, origin_lead_session_id, acquisition_identity_level,
    current_identity_level, authentication_method, identity_verified
  ) values (
    v_lead.clinic_id, v_patient_id, v_lead.id, v_lead.identity_level,
    'authenticated', v_authentication_method, true
  ) returning id into v_patient_session_id;

  insert into public.funnel_events (
    clinic_id, lead_session_id, patient_session_id, name, source_channel,
    identity_level, metadata, idempotency_key
  ) values
    (v_lead.clinic_id, v_lead.id, v_patient_session_id, 'consented', v_lead.source_channel,
     v_lead.identity_level, jsonb_build_object('current_identity_level', 'authenticated'), 'consented:' || v_lead.id::text),
    (v_lead.clinic_id, v_lead.id, v_patient_session_id, 'patient_created', v_lead.source_channel,
     v_lead.identity_level, jsonb_build_object('current_identity_level', 'authenticated'), 'patient_created:' || v_lead.id::text);

  update public.lead_sessions
  set status = 'converted', recovery_token_hash = null,
      conversion_idempotency_hash = p_recovery_token_hash,
      converted_patient_id = v_patient_id, converted_patient_session_id = v_patient_session_id,
      converted_at = now(), updated_at = now()
  where id = v_lead.id;
  return v_patient_session_id;
end;
$$;

create function public.record_marketing_email_consent(
  p_patient_session_id uuid,
  p_action public.consent_action,
  p_policy_version text,
  p_notice_version text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.patient_sessions;
  v_event_id uuid;
begin
  select patient_sessions.* into v_session
  from public.patient_sessions
  join public.patients on patients.id = patient_sessions.patient_id
  where patient_sessions.id = p_patient_session_id and patients.auth_user_id = auth.uid();
  if not found then raise exception using errcode = 'P0020', message = 'Patient session unavailable'; end if;
  if nullif(trim(p_policy_version), '') is null or nullif(trim(p_notice_version), '') is null
     or nullif(trim(p_idempotency_key), '') is null then
    raise exception using errcode = 'P0012', message = 'Versioned consent evidence required';
  end if;
  insert into public.consent_events (
    clinic_id, patient_id, lead_session_id, type, action, policy_version,
    notice_version, captured_via, evidence_metadata, idempotency_key
  ) values (
    v_session.clinic_id, v_session.patient_id, v_session.origin_lead_session_id,
    'marketing_email', p_action, p_policy_version, p_notice_version,
    'patient_preferences', jsonb_build_object('explicit_action', true), p_idempotency_key
  ) on conflict (idempotency_key) do nothing
  returning id into v_event_id;
  if v_event_id is null then
    select id into v_event_id
    from public.consent_events
    where idempotency_key = p_idempotency_key
      and clinic_id = v_session.clinic_id
      and patient_id = v_session.patient_id
      and type = 'marketing_email'
      and action = p_action;
    if v_event_id is null then
      raise exception using errcode = 'P0020', message = 'Consent idempotency conflict';
    end if;
  end if;
  return v_event_id;
end;
$$;

create function public.has_current_marketing_email_consent(p_patient_session_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((
    select consent_events.action = 'granted'::public.consent_action
    from public.consent_events
    join public.patient_sessions on patient_sessions.patient_id = consent_events.patient_id
      and patient_sessions.clinic_id = consent_events.clinic_id
    join public.patients on patients.id = patient_sessions.patient_id
    where patient_sessions.id = p_patient_session_id
      and patients.auth_user_id = auth.uid()
      and consent_events.type = 'marketing_email'
    order by consent_events.occurred_at desc, consent_events.id desc
    limit 1
  ), false)
$$;

create function public.enrich_escalation_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_session public.patient_sessions;
begin
  if new.status = 'queued' and old.status = 'required' then
    select * into v_session from public.patient_sessions where id = new.patient_session_id;
    new.attribution_snapshot := coalesce(new.attribution_snapshot, '{}'::jsonb) || jsonb_build_object(
      'acquisition_identity_level', v_session.acquisition_identity_level,
      'current_identity_level', v_session.current_identity_level,
      'identity_verified', v_session.identity_verified,
      'authentication_method', v_session.authentication_method
    );
    new.attribution_snapshot := new.attribution_snapshot - 'email' - 'phone' - 'social_handle';
  end if;
  return new;
end;
$$;

create trigger escalations_enrich_identity_before_queue
before update on public.escalations
for each row execute function public.enrich_escalation_identity();

create function public.preserve_acquisition_identity_on_funnel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_session public.patient_sessions;
begin
  if new.patient_session_id is not null then
    select * into v_session from public.patient_sessions where id = new.patient_session_id;
    if found then
      new.clinic_id := v_session.clinic_id;
      new.identity_level := v_session.acquisition_identity_level;
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
        'current_identity_level', v_session.current_identity_level,
        'identity_verified', v_session.identity_verified
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger funnel_events_preserve_acquisition_identity
before insert on public.funnel_events
for each row execute function public.preserve_acquisition_identity_on_funnel();

revoke execute on function public.convert_lead_to_patient_v2(text, text, text, boolean, text, text, boolean, text, text) from public, anon;
revoke execute on function public.create_lead_session_v2(text, public.source_channel, public.social_platform, text, text, public.identity_level, timestamptz, jsonb, text, text, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke execute on function public.convert_lead_to_patient(text, text, text, boolean, text, text) from authenticated;
revoke execute on function public.record_marketing_email_consent(uuid, public.consent_action, text, text, text) from public, anon;
revoke execute on function public.has_current_marketing_email_consent(uuid) from public, anon;
grant execute on function public.convert_lead_to_patient_v2(text, text, text, boolean, text, text, boolean, text, text) to authenticated;
grant execute on function public.create_lead_session_v2(text, public.source_channel, public.social_platform, text, text, public.identity_level, timestamptz, jsonb, text, text, text, text, timestamptz, text, text) to service_role;
grant execute on function public.record_marketing_email_consent(uuid, public.consent_action, text, text, text) to authenticated;
grant execute on function public.has_current_marketing_email_consent(uuid) to authenticated;

comment on column public.patient_sessions.acquisition_identity_level is 'Original lead identity classification, preserved separately from current authenticated identity.';
comment on column public.patient_sessions.authentication_method is 'Actual Supabase authentication path; social handles are never authentication.';
comment on function public.has_current_marketing_email_consent(uuid) is 'Defaults to false and resolves the newest independently revocable marketing-email event.';
