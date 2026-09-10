alter table public.messages
  add column content_sealed boolean not null default true;

create function public.mark_received_message_unsealed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.actor in ('guest', 'patient')
     and new.status = 'received'
     and new.in_reply_to_message_id is null then
    new.content_sealed := false;
  end if;
  return new;
end;
$$;

create trigger received_message_starts_unsealed
before insert on public.messages
for each row execute function public.mark_received_message_unsealed();

create function public.reject_reply_to_unsealed_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.actor = 'assistant'
     and new.in_reply_to_message_id is not null
     and not exists (
       select 1 from public.messages
       where id = new.in_reply_to_message_id
         and content_sealed = true
     ) then
    raise exception using errcode = 'P0050', message = 'Source message has not passed the safety boundary';
  end if;
  return new;
end;
$$;

create trigger assistant_requires_sealed_source
before insert on public.messages
for each row execute function public.reject_reply_to_unsealed_message();

create function public.seal_guest_message(
  p_recovery_token_hash text,
  p_source_message_id uuid,
  p_content_ciphertext text,
  p_content_sha256 text
)
returns setof public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
begin
  if char_length(coalesce(p_content_ciphertext, '')) not between 1 and 12000
     or coalesce(p_content_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0005', message = 'Invalid protected message';
  end if;

  select messages.* into v_message
  from public.messages
  join public.lead_sessions on lead_sessions.id = messages.lead_session_id
  where messages.id = p_source_message_id
    and messages.actor = 'guest'
    and messages.status = 'received'
    and lead_sessions.recovery_token_hash = p_recovery_token_hash
    and lead_sessions.status in ('active', 'auth_started')
    and lead_sessions.expires_at > now()
  for update of messages;

  if not found then
    raise exception using errcode = 'P0003', message = 'Guest session not found';
  end if;

  if v_message.content_sealed then
    if v_message.content_sha256 <> p_content_sha256 then
      raise exception using errcode = 'P0005', message = 'Message content is immutable';
    end if;
    return next v_message;
    return;
  end if;

  update public.messages
  set content_ciphertext = p_content_ciphertext,
      content_sha256 = p_content_sha256,
      content_sealed = true
  where id = v_message.id
  returning * into v_message;

  return next v_message;
end;
$$;

create function public.seal_patient_message(
  p_patient_session_id uuid,
  p_source_message_id uuid,
  p_content_ciphertext text,
  p_content_sha256 text
)
returns setof public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
  v_patient_id uuid;
  v_clinic_id uuid;
  v_consent_action public.consent_action;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0010', message = 'Authentication required';
  end if;

  if char_length(coalesce(p_content_ciphertext, '')) not between 1 and 12000
     or coalesce(p_content_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0022', message = 'Invalid protected message';
  end if;

  select patient_sessions.patient_id, patient_sessions.clinic_id
    into v_patient_id, v_clinic_id
  from public.patient_sessions
  join public.patients on patients.id = patient_sessions.patient_id
  where patient_sessions.id = p_patient_session_id
    and patient_sessions.status = 'active'
    and patients.auth_user_id = auth.uid();

  if not found then
    raise exception using errcode = 'P0020', message = 'Patient session unavailable';
  end if;

  select consent_events.action into v_consent_action
  from public.consent_events
  where consent_events.patient_id = v_patient_id
    and consent_events.clinic_id = v_clinic_id
    and consent_events.type = 'healthcare_sharing'
  order by consent_events.occurred_at desc
  limit 1;

  if v_consent_action is distinct from 'granted'::public.consent_action then
    raise exception using errcode = 'P0021', message = 'Healthcare-sharing consent required';
  end if;

  select * into v_message
  from public.messages
  where id = p_source_message_id
    and patient_session_id = p_patient_session_id
    and actor = 'patient'
    and status = 'received'
  for update;

  if not found then
    raise exception using errcode = 'P0020', message = 'Patient message unavailable';
  end if;

  if v_message.content_sealed then
    if v_message.content_sha256 <> p_content_sha256 then
      raise exception using errcode = 'P0023', message = 'Message content is immutable';
    end if;
    return next v_message;
    return;
  end if;

  update public.messages
  set content_ciphertext = p_content_ciphertext,
      content_sha256 = p_content_sha256,
      content_sealed = true
  where id = v_message.id
  returning * into v_message;

  return next v_message;
end;
$$;

revoke execute on function public.mark_received_message_unsealed() from public, anon, authenticated, service_role;
revoke execute on function public.reject_reply_to_unsealed_message() from public, anon, authenticated, service_role;
revoke execute on function public.seal_guest_message(text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.seal_patient_message(uuid, uuid, text, text) from public, anon;
grant execute on function public.seal_guest_message(text, uuid, text, text) to service_role;
grant execute on function public.seal_patient_message(uuid, uuid, text, text) to authenticated;

comment on column public.messages.content_sealed is
  'False while a non-PHI reservation placeholder is stored; true only after raw risk, redaction, provider and output gates complete.';
