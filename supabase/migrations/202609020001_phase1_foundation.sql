create extension if not exists pgcrypto with schema extensions;

create type public.source_channel as enum (
  'staff_referral',
  'social_comment',
  'instagram_ad_click',
  'google_ad_click',
  'lead_form',
  'google_reviews',
  'website_widget'
);

create type public.social_platform as enum ('instagram', 'tiktok', 'facebook');
create type public.identity_level as enum ('anonymous', 'social_handle', 'email', 'authenticated');
create type public.lead_status as enum ('active', 'auth_started', 'converted', 'expired');
create type public.funnel_event_name as enum (
  'visitor',
  'conversation_started',
  'value_event',
  'auth_started',
  'consented',
  'patient_created',
  'escalation_sent'
);

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 160),
  timezone text not null default 'Asia/Kuala_Lumpur',
  response_min_hours smallint not null default 12 check (response_min_hours > 0),
  response_max_hours smallint not null default 18 check (response_max_hours >= response_min_hours),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lead_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  status public.lead_status not null default 'active',
  source_channel public.source_channel not null,
  social_platform public.social_platform,
  campaign_id text check (campaign_id is null or char_length(campaign_id) <= 160),
  creative text check (creative is null or char_length(creative) <= 160),
  identity_level public.identity_level not null,
  landing_timestamp timestamptz not null,
  landing_context jsonb not null default '{}'::jsonb,
  context_ciphertext text,
  social_handle_ciphertext text,
  recovery_token_hash text unique,
  request_fingerprint_hash text not null check (char_length(request_fingerprint_hash) = 64),
  expires_at timestamptz not null,
  converted_patient_id uuid,
  converted_patient_session_id uuid,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_social_platform_check check (
    (source_channel = 'social_comment' and social_platform is not null)
    or (source_channel <> 'social_comment' and social_platform is null)
  ),
  constraint lead_expiry_check check (expires_at > landing_timestamp),
  constraint lead_conversion_shape_check check (
    (status <> 'converted' and converted_at is null)
    or (status = 'converted' and converted_at is not null)
  ),
  constraint lead_landing_context_object_check check (jsonb_typeof(landing_context) = 'object')
);

create index lead_sessions_clinic_created_idx
  on public.lead_sessions (clinic_id, created_at desc);
create index lead_sessions_active_token_idx
  on public.lead_sessions (recovery_token_hash)
  where status in ('active', 'auth_started');
create index lead_sessions_rate_limit_idx
  on public.lead_sessions (clinic_id, request_fingerprint_hash, created_at desc);

create table public.channel_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics(id) on delete cascade,
  source_channel public.source_channel not null,
  identity_level public.identity_level not null,
  time_of_day text not null check (time_of_day in ('morning', 'afternoon', 'evening', 'overnight', 'any')),
  opening_strategy jsonb not null check (jsonb_typeof(opening_strategy) = 'object'),
  priority integer not null default 100,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (clinic_id, source_channel, identity_level, time_of_day, priority)
);

create table public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  lead_session_id uuid references public.lead_sessions(id) on delete set null,
  patient_session_id uuid,
  name public.funnel_event_name not null,
  source_channel public.source_channel not null,
  identity_level public.identity_level not null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique check (char_length(idempotency_key) <= 200),
  occurred_at timestamptz not null default now(),
  constraint funnel_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index funnel_events_clinic_channel_time_idx
  on public.funnel_events (clinic_id, source_channel, occurred_at desc);
create index funnel_events_lead_idx
  on public.funnel_events (lead_session_id, occurred_at);

create function public.prevent_lead_attribution_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.clinic_id is distinct from old.clinic_id
    or new.source_channel is distinct from old.source_channel
    or new.social_platform is distinct from old.social_platform
    or new.campaign_id is distinct from old.campaign_id
    or new.creative is distinct from old.creative
    or new.identity_level is distinct from old.identity_level
    or new.landing_timestamp is distinct from old.landing_timestamp
    or new.landing_context is distinct from old.landing_context then
    raise exception using errcode = '22000', message = 'LeadSession attribution is immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger lead_sessions_immutable_attribution
before update on public.lead_sessions
for each row execute function public.prevent_lead_attribution_mutation();

create function public.create_lead_session(
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
  p_expires_at timestamptz
)
returns setof public.lead_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_lead public.lead_sessions;
  v_recent_count integer;
begin
  select id into v_clinic_id
  from public.clinics
  where slug = p_clinic_slug;

  if v_clinic_id is null then
    raise exception using errcode = 'P0002', message = 'Clinic not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_clinic_id::text || ':' || p_request_fingerprint_hash, 0)
  );

  select count(*) into v_recent_count
  from public.lead_sessions
  where clinic_id = v_clinic_id
    and request_fingerprint_hash = p_request_fingerprint_hash
    and created_at >= now() - interval '1 hour';

  if v_recent_count >= 10 then
    raise exception using errcode = 'P0001', message = 'LeadSession rate limit exceeded';
  end if;

  insert into public.lead_sessions (
    clinic_id,
    source_channel,
    social_platform,
    campaign_id,
    creative,
    identity_level,
    landing_timestamp,
    landing_context,
    context_ciphertext,
    social_handle_ciphertext,
    recovery_token_hash,
    request_fingerprint_hash,
    expires_at
  ) values (
    v_clinic_id,
    p_source_channel,
    p_social_platform,
    nullif(p_campaign_id, ''),
    nullif(p_creative, ''),
    p_identity_level,
    p_landing_timestamp,
    coalesce(p_landing_context, '{}'::jsonb),
    p_context_ciphertext,
    p_social_handle_ciphertext,
    p_recovery_token_hash,
    p_request_fingerprint_hash,
    p_expires_at
  ) returning * into v_lead;

  insert into public.funnel_events (
    clinic_id,
    lead_session_id,
    name,
    source_channel,
    identity_level,
    metadata,
    idempotency_key,
    occurred_at
  ) values (
    v_clinic_id,
    v_lead.id,
    'visitor',
    p_source_channel,
    p_identity_level,
    jsonb_build_object('landing_context', coalesce(p_landing_context, '{}'::jsonb)),
    'visitor:' || v_lead.id::text,
    p_landing_timestamp
  );

  return next v_lead;
end;
$$;

create function public.expire_lead_sessions()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
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

alter table public.clinics enable row level security;
alter table public.lead_sessions enable row level security;
alter table public.channel_rules enable row level security;
alter table public.funnel_events enable row level security;

revoke all on table public.clinics from anon, authenticated;
revoke all on table public.lead_sessions from anon, authenticated;
revoke all on table public.channel_rules from anon, authenticated;
revoke all on table public.funnel_events from anon, authenticated;

revoke execute on function public.prevent_lead_attribution_mutation() from public, anon, authenticated;
revoke execute on function public.create_lead_session(text, public.source_channel, public.social_platform, text, text, public.identity_level, timestamptz, jsonb, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.expire_lead_sessions() from public, anon, authenticated;

grant execute on function public.create_lead_session(text, public.source_channel, public.social_platform, text, text, public.identity_level, timestamptz, jsonb, text, text, text, text, timestamptz) to service_role;
grant execute on function public.expire_lead_sessions() to service_role;

comment on table public.lead_sessions is 'Unauthenticated acquisition sessions with immutable attribution and opaque-token recovery.';
comment on column public.lead_sessions.landing_context is 'Allowlisted PHI-free attribution context only.';
comment on column public.lead_sessions.context_ciphertext is 'Optional AES-GCM encrypted topic/context; never use in operational logs.';
comment on column public.lead_sessions.social_handle_ciphertext is 'Optional AES-GCM encrypted social handle; never use in attribution events or logs.';
comment on table public.funnel_events is 'Append-only, PHI-free product funnel events.';
