alter table public.patient_sessions
  add column memory_bootstrap_status text not null default 'pending'
    check (memory_bootstrap_status in ('pending', 'completed', 'failed')),
  add column memory_bootstrap_attempts integer not null default 0
    check (memory_bootstrap_attempts >= 0),
  add column memory_bootstrap_error_code text,
  add column memory_bootstrap_completed_at timestamptz;

update public.patient_sessions
set memory_bootstrap_status = 'completed',
    memory_bootstrap_completed_at = now()
where memory_bootstrap_status = 'pending';

alter table public.memory_revisions
  add column source_content_sha256 text,
  add column source_snapshot_ciphertext text;

update public.memory_revisions as revisions
set source_content_sha256 = messages.content_sha256,
    source_snapshot_ciphertext = messages.content_ciphertext
from public.messages as messages
where messages.id = revisions.source_message_id;

alter table public.memory_revisions
  alter column source_content_sha256 set not null,
  alter column source_snapshot_ciphertext set not null,
  add constraint memory_revisions_source_hash_check
    check (source_content_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint memory_revisions_source_snapshot_check
    check (char_length(source_snapshot_ciphertext) between 1 and 12000);

create function public.capture_memory_revision_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select messages.content_sha256, messages.content_ciphertext
    into new.source_content_sha256, new.source_snapshot_ciphertext
  from public.messages
  where messages.id = new.source_message_id;

  if not found then
    raise exception using errcode = 'P0033', message = 'Invalid memory source provenance';
  end if;

  return new;
end;
$$;

create trigger memory_revision_captures_source
before insert on public.memory_revisions
for each row execute function public.capture_memory_revision_source();

create table public.memory_conflicts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null check (kind in ('allergy_presence', 'medication_status', 'dosage')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  left_revision_id uuid not null references public.memory_revisions(id) on delete restrict,
  right_revision_id uuid not null references public.memory_revisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (left_revision_id <> right_revision_id),
  unique (kind, left_revision_id, right_revision_id)
);

create index memory_conflicts_patient_open_idx
  on public.memory_conflicts (patient_id, created_at desc)
  where status = 'open';

create function public.detect_memory_revision_conflicts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.memory_items;
  v_previous public.memory_revisions;
  v_other record;
begin
  select * into v_item
  from public.memory_items
  where id = new.memory_item_id;

  if new.supersedes_revision_id is not null then
    select * into v_previous
    from public.memory_revisions
    where id = new.supersedes_revision_id
      and memory_item_id = new.memory_item_id;

    if found and v_item.kind = 'medication' then
      if v_previous.status <> new.status then
        insert into public.memory_conflicts (
          clinic_id, patient_id, kind, left_revision_id, right_revision_id
        ) values (
          v_item.clinic_id, v_item.patient_id, 'medication_status', v_previous.id, new.id
        ) on conflict do nothing;
      elsif new.status = 'active' and v_previous.value_sha256 <> new.value_sha256 then
        insert into public.memory_conflicts (
          clinic_id, patient_id, kind, left_revision_id, right_revision_id
        ) values (
          v_item.clinic_id, v_item.patient_id, 'dosage', v_previous.id, new.id
        ) on conflict do nothing;
      end if;
    end if;
  end if;

  if v_item.kind = 'allergy' and new.status = 'active' then
    for v_other in
      select revisions.id
      from public.memory_items as items
      join public.memory_revisions as revisions
        on revisions.id = items.current_revision_id
      where items.patient_id = v_item.patient_id
        and items.kind = 'allergy'
        and items.id <> v_item.id
        and revisions.status = 'active'
        and (
          (v_item.canonical_key = 'none_known' and items.canonical_key <> 'none_known')
          or (v_item.canonical_key <> 'none_known' and items.canonical_key = 'none_known')
        )
    loop
      insert into public.memory_conflicts (
        clinic_id, patient_id, kind, left_revision_id, right_revision_id
      ) values (
        v_item.clinic_id, v_item.patient_id, 'allergy_presence', v_other.id, new.id
      ) on conflict do nothing;
    end loop;
  end if;

  return new;
end;
$$;

create trigger memory_revision_detects_conflicts
after insert on public.memory_revisions
for each row execute function public.detect_memory_revision_conflicts();

create function public.reject_memory_conflict_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0035', message = 'Memory conflicts are append-only';
end;
$$;

create trigger memory_conflicts_append_only
before update or delete on public.memory_conflicts
for each row execute function public.reject_memory_conflict_mutation();

create function public.record_memory_bootstrap_result(
  p_patient_session_id uuid,
  p_succeeded boolean,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not p_succeeded and coalesce(p_error_code, '') !~ '^[a-z0-9_.-]{1,64}$' then
    raise exception using errcode = 'P0036', message = 'Invalid bootstrap result';
  end if;

  update public.patient_sessions
  set memory_bootstrap_status = case when p_succeeded then 'completed' else 'failed' end,
      memory_bootstrap_attempts = memory_bootstrap_attempts + 1,
      memory_bootstrap_error_code = case when p_succeeded then null else p_error_code end,
      memory_bootstrap_completed_at = case when p_succeeded then now() else null end,
      updated_at = now()
  where id = p_patient_session_id;

  if not found then
    raise exception using errcode = 'P0020', message = 'Patient session unavailable';
  end if;
end;
$$;

alter table public.memory_conflicts enable row level security;

revoke all on table public.memory_conflicts from anon, authenticated;
grant select on table public.memory_conflicts to authenticated;

create policy memory_conflicts_select_patient_or_staff
on public.memory_conflicts for select to authenticated
using (
  exists (
    select 1 from public.patients
    where patients.id = memory_conflicts.patient_id
      and patients.auth_user_id = (select auth.uid())
  )
  or public.has_consented_patient_access(clinic_id, patient_id)
);

revoke execute on function public.capture_memory_revision_source() from public, anon, authenticated, service_role;
revoke execute on function public.detect_memory_revision_conflicts() from public, anon, authenticated, service_role;
revoke execute on function public.reject_memory_conflict_mutation() from public, anon, authenticated, service_role;
revoke execute on function public.record_memory_bootstrap_result(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.record_memory_bootstrap_result(uuid, boolean, text) to service_role;

comment on column public.memory_revisions.source_content_sha256 is
  'Immutable hash of the source message content at revision creation time.';
comment on column public.memory_revisions.source_snapshot_ciphertext is
  'Encrypted immutable source snapshot retained for integrity-aware provenance.';
comment on table public.memory_conflicts is
  'Append-only safety-sensitive contradictions between preserved memory revisions.';
