# Nightingale MVP Architecture

Status: Proposed architecture; no implementation yet  
Primary sources: `2026 48 Hour Build_ Nightingale Candidate Brief.pdf` and `REQUIREMENTS.md`  
Target stack: Next.js 16 + TypeScript, Tailwind CSS, Supabase PostgreSQL, Supabase Auth, OpenAI API

## 1. Goals and architectural decisions

The MVP is one deployable Next.js application backed by one Supabase project. It is intentionally a modular monolith: UI, HTTP endpoints, orchestration, and the server-only data-access layer live in one repository. PostgreSQL remains the durable source of truth. OpenAI is a stateless processor, not the conversation database.

Primary design goals:

1. Preserve acquisition, message, memory, consent, risk, and escalation provenance end to end.
2. Prevent PHI from reaching OpenAI or operational logs.
3. Enforce authorization close to the data with PostgreSQL RLS, with matching checks in the Next.js server layer.
4. Make high-risk behavior deterministic and fail safe even when OpenAI is unavailable.
5. Minimize moving parts so the core flows and required tests fit within 48 hours.

### MVP decisions

| Topic | Decision | Rationale |
|---|---|---|
| Deployment | One Next.js application and one Supabase project | Smallest production-credible unit; no distributed transaction or service coordination. |
| Next.js model | App Router, Server Components for reads, Client Components only for interactive UI, Route Handlers for mutation/chat boundaries | Keeps secrets and clinical data processing server-side. |
| Data access | A `server-only` Data Access Layer (DAL) is the only application module that queries clinical tables | Centralizes authorization and DTO minimization. |
| Browser database access | Browser uses Supabase for Auth only; clinical and guest data go through the Next.js server | Easier to audit and prevents broad client access to sensitive records. RLS still protects database access. |
| Messaging | One `messages` table supports guest and patient sessions | Original guest messages do not need to be copied, so provenance stays intact. |
| AI state | Stateless OpenAI Responses API calls with `store: false`; application supplies minimum redacted context | Supabase remains the source of truth and external persistence is minimized. |
| AI output | Structured output validated by the server | Risk, response, memory proposals, and citations require predictable fields. |
| Risk | Deterministic safety rules first, then structured model assessment, then a server policy gate | Mandatory emergency phrases cannot depend only on model behavior. |
| Memory | Current fact identity plus append-only fact revisions | Corrections update the live profile without destroying prior provenance. |
| Conversion | One atomic PostgreSQL function/RPC | Prevents partial consent, patient, session, attribution, or event creation. |
| Guest recovery | Opaque high-entropy token in a Secure, HttpOnly cookie; only a hash is stored | Avoids exposing a database identifier as authority. |
| Guest retention | Proposed default: seven days for unconverted guest content | Provides recovery while limiting exposure. This remains a product decision. |
| PWA caching | Cache static shell assets only; never cache clinical API responses, messages, or profiles offline | A PWA must not leave recoverable PHI in browser caches. |
| Realtime | Not required for MVP; use request/response plus refresh/polling where needed | Avoids extra authorization and synchronization complexity. |
| Knowledge/citations | Curated, versioned source records in PostgreSQL; no live web-search tool in the patient pipeline | Makes citations testable and prevents uncontrolled external disclosure. |

## 2. Application architecture

```text
Browser / installed PWA
├── Public guest experience
├── Supabase Auth screens and callback
├── Patient messenger and live profile
└── Staff warm-lead and escalation views
             │ HTTPS
             ▼
Next.js 16 application
├── App Router pages and layouts
├── Route Handlers (public request boundaries)
├── Input validation + rate limiting
├── AuthN/AuthZ context
├── Domain services
│   ├── Acquisition and channel rules
│   ├── PHI redaction
│   ├── Risk gate
│   ├── OpenAI orchestration
│   ├── Living Memory mutation
│   ├── Conversion
│   ├── Escalation
│   └── Funnel events and audit metadata
└── Server-only DAL and minimal DTOs
        │                       │
        ▼                       ▼
Supabase Auth/PostgreSQL     OpenAI Responses API
├── RLS and grants           ├── Redacted minimum input only
├── Atomic conversion RPC    ├── Structured output
├── Encrypted clinical data  └── No application conversation state
└── Durable provenance
```

### Request boundaries

- Server Components call the DAL directly for initial page reads. They do not call the application's own Route Handlers.
- Interactive clients call Route Handlers for chat turns, conversion, escalation, referral creation, and simulated acquisition/webhooks.
- Every Route Handler is treated as public: validate content type, body size, shape, session, role, clinic membership, and resource ownership.
- `proxy.ts` may refresh Supabase Auth cookies and perform optimistic redirects. It is not an authorization boundary.
- The OpenAI key, Supabase secret key, encryption key, and unredacted content are server-only.
- API responses return explicit DTOs rather than raw table rows.

### UI route groups

- Public/guest: acquisition landing, guest conversation, secure-continuation invitation, recovery.
- Auth: signup/login, callback, phone collection, consent.
- Patient: messenger, live profile, escalation state.
- Staff: warm leads, referral-link creation, escalation queue and review.

### PWA behavior

- Provide a web manifest, icons, standalone display mode, responsive Tailwind layout, and HTTPS deployment.
- Do not promise offline clinical access in the MVP.
- If a service worker is added, its allowlist is limited to versioned static assets. Protected pages, RSC payloads, `/api/**`, and Supabase responses use network-only/no-store behavior.
- Protected responses use `Cache-Control: private, no-store` and should not be prefetched into a shared cache.

## 3. Database design principles

- UUID primary keys are immutable internal identifiers.
- Every tenant-owned row carries `clinic_id`, directly or through an unambiguous parent.
- Store timestamps as `timestamptz` in UTC; render with the clinic timezone.
- Acquisition fields and audit-style event rows are append-only.
- Consents and memory changes are versioned rather than overwritten.
- Clinical message content is application data, not a log. Operational logs contain IDs, hashes, categories, durations, and statuses only.
- Use database constraints for exclusive ownership, enum validity, unique event idempotency, and referential integrity.
- Enable RLS on every application table, including tables not currently queried from the browser.
- Revoke default table/function privileges and grant only required operations.

### Core enums

| Enum | Values |
|---|---|
| `member_role` | `staff`, `nurse`, `clinician` |
| `source_channel` | `staff_referral`, `social_comment`, `instagram_ad_click`, `google_ad_click`, `lead_form`, `google_reviews`, `website_widget` |
| `social_platform` | `instagram`, `tiktok`, `facebook` |
| `identity_level` | `anonymous`, `social_handle`, `email`, `authenticated` |
| `lead_status` | `active`, `auth_started`, `converted`, `expired` |
| `patient_session_status` | `active`, `closed` |
| `message_actor` | `guest`, `patient`, `assistant`, `staff`, `system` |
| `message_status` | `received`, `processing`, `complete`, `blocked`, `failed` |
| `memory_kind` | `chief_complaint`, `symptom`, `medication`, `allergy` |
| `memory_status` | `active`, `stopped`, `resolved`, `corrected` |
| `consent_type` | `clinic_healthcare_share`, `marketing_email` |
| `consent_action` | `granted`, `withdrawn` |
| `risk_level` | `low`, `medium`, `high` |
| `confidence_level` | `low`, `medium`, `high` |
| `escalation_status` | `required`, `queued`, `acknowledged`, `responded`, `closed` |
| `funnel_event_name` | `visitor`, `conversation_started`, `value_event`, `auth_started`, `consented`, `patient_created`, `escalation_sent` |

## 4. Database schema

The types below are logical PostgreSQL types. They are a design specification, not a migration.

### 4.1 Tenant and identity tables

#### `clinics`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Immutable clinic ID. |
| `slug` | text unique | Acquisition and display routing key. |
| `name` | text | Named clinic shown during consent. |
| `timezone` | text | Time-of-day rules and response expectation. |
| `response_min_hours` | smallint default 12 | Confirmation copy. |
| `response_max_hours` | smallint default 18 | Confirmation copy. |
| `created_at` | timestamptz | Audit metadata. |

#### `user_profiles`

| Field | Type/constraint | Purpose |
|---|---|---|
| `auth_user_id` | UUID PK/FK → `auth.users.id` | Supabase Auth identity. |
| `display_name_ciphertext` | text nullable | Optional protected display name. |
| `created_at`, `updated_at` | timestamptz | Lifecycle. |

#### `clinic_memberships`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Membership ID. |
| `clinic_id` | UUID FK | Tenant. |
| `auth_user_id` | UUID FK → `auth.users.id` | Staff identity. |
| `role` | `member_role` | Staff, nurse, or clinician. |
| `active` | boolean | Revocation without deleting history. |
| `created_at` | timestamptz | Audit metadata. |

Unique constraint: `(clinic_id, auth_user_id)`.

#### `patients`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Immutable patient ID. |
| `clinic_id` | UUID FK | MVP tenant boundary. |
| `auth_user_id` | UUID FK → `auth.users.id` | Login owner. |
| `created_from_lead_session_id` | UUID nullable FK | Original acquisition path. |
| `created_at`, `updated_at` | timestamptz | Lifecycle. |

Unique constraint: `(clinic_id, auth_user_id)`.

#### `patient_contact_points`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Contact version ID. |
| `patient_id`, `clinic_id` | UUID FK | Owner and tenant. |
| `type` | `email`, `phone`, `social` | Contact kind. |
| `value_ciphertext` | text | Protected value. |
| `value_hash` | text | Equality/deduplication without logging raw value. |
| `label` | text nullable | Social platform or user label. |
| `verified_at` | timestamptz nullable | Email verification evidence; phone semantics need confirmation. |
| `valid_from`, `valid_until` | timestamptz | Changeable contact history. |
| `is_primary` | boolean | Current contact choice. |

### 4.2 Acquisition tables

#### `lead_sessions`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Internal LeadSession ID. |
| `clinic_id` | UUID FK | Tenant and attribution. |
| `status` | `lead_status` | Active through converted/expired. |
| `source_channel` | enum | Required channel contract. |
| `social_platform` | enum nullable | Required for social comments. |
| `campaign_id` | text nullable | Attribution. |
| `creative` | text nullable | Attribution. |
| `identity_level` | enum | Authority/contact awareness. |
| `landing_timestamp` | timestamptz | Required attribution. |
| `landing_context` | jsonb | Non-sensitive page/topic/channel parameters. |
| `context_ciphertext` | text nullable | Protected volunteered topic/context. |
| `social_handle_ciphertext` | text nullable | Optional protected handle. |
| `volunteered_email_ciphertext` | text nullable | Lead-form/earned-email data. |
| `recovery_token_hash` | text unique | Hash of opaque recovery credential. |
| `expires_at` | timestamptz | Guest retention boundary. |
| `converted_patient_id` | UUID nullable FK | Set atomically on conversion. |
| `converted_patient_session_id` | UUID nullable FK | Conversion result. |
| `converted_at` | timestamptz nullable | Conversion provenance. |
| `created_at`, `updated_at` | timestamptz | Lifecycle. |

Attribution fields become immutable after insert. A converted lead is retained with its patient record; an expired, unconverted lead has protected content erased/deleted while PHI-free aggregate events may remain.

#### `staff_referrals`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Referral ID. |
| `clinic_id` | UUID FK | Tenant. |
| `created_by_membership_id` | UUID FK | Staff provenance. |
| `topic_ciphertext` | text | Preloaded protected topic. |
| `public_token_hash` | text unique | One-way lookup credential. |
| `redeemed_lead_session_id` | UUID nullable FK | Created LeadSession. |
| `expires_at`, `created_at` | timestamptz | Link lifecycle. |

#### `channel_rules`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Rule ID. |
| `clinic_id` | UUID nullable FK | Clinic override or global default. |
| `source_channel` | enum | Rule dimension. |
| `identity_level` | enum | Rule dimension. |
| `time_window` | text/range | Clinic-local time category. |
| `opening_strategy` | jsonb | Declarative template and behavior. |
| `priority`, `active`, `version` | scalar | Deterministic rule selection. |

### 4.3 Session and message tables

#### `patient_sessions`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | PatientSession ID. |
| `clinic_id`, `patient_id` | UUID FK | Tenant and owner. |
| `origin_lead_session_id` | UUID unique FK | One-to-one conversion origin. |
| `status` | enum | Active/closed. |
| `started_at`, `closed_at`, `updated_at` | timestamptz | Lifecycle. |

#### `messages`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Stable provenance target. |
| `clinic_id` | UUID FK | Tenant. |
| `lead_session_id` | UUID nullable FK | Guest thread owner. |
| `patient_session_id` | UUID nullable FK | Patient thread owner. |
| `actor` | `message_actor` | Sender. |
| `status` | `message_status` | Processing/failure visibility. |
| `content_ciphertext` | text | Protected raw clinical/application content. |
| `content_sha256` | text | Integrity/deduplication without logging content. |
| `in_reply_to_message_id` | UUID nullable FK | Turn relationship. |
| `sequence_number` | bigint | Stable thread order. |
| `redaction_status` | text | Not required, passed, or failed. |
| `redaction_version` | text nullable | Pipeline provenance. |
| `audio_recording_id` | text nullable | Future voice integration. |
| `audio_transcript_id` | text nullable | Future voice integration. |
| `created_at` | timestamptz | Source timestamp. |

Check constraint: exactly one of `lead_session_id` and `patient_session_id` is non-null. Guest messages remain lead-owned after conversion; the patient is authorized to read the origin lead thread through `patient_sessions.origin_lead_session_id`.

#### `model_runs`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Model provenance. |
| `clinic_id`, `source_message_id` | UUID FK | Tenant and triggering turn. |
| `provider`, `model`, `prompt_version` | text | Reproducibility. |
| `redacted_input_hash` | text | Proves exact sanitized input identity without logging content. |
| `provider_response_id` | text nullable | Provider metadata only. |
| `store_requested` | boolean fixed false | Data-minimization evidence. |
| `status`, `duration_ms`, `error_code` | scalar | PHI-free operations metadata. |
| `created_at` | timestamptz | Provenance time. |

### 4.4 Risk, citations, and Living Memory

#### `risk_assessments`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Assessment ID. |
| `clinic_id`, `message_id` | UUID FK | One assessment per patient message. |
| `risk_level` | enum | Low/Medium/High. |
| `risk_reason` | text | Short, PHI-redacted reason. |
| `confidence` | enum | Required response confidence. |
| `escalation_required` | boolean | Policy result. |
| `rule_matches` | text[] | Deterministic rule provenance. |
| `model_run_id` | UUID nullable FK | Model provenance. |
| `pipeline_version` | text | Risk-policy version. |
| `assessed_at` | timestamptz | Required timestamp provenance. |

Unique constraint: `message_id`.

#### `knowledge_sources`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Approved source ID. |
| `title`, `publisher`, `url` | text | Human-readable citation. |
| `content` | text | Curated non-patient reference text. |
| `version`, `reviewed_at` | scalar | Grounding provenance. |
| `active` | boolean | Remove from future use without breaking history. |

#### `citations`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Citation ID. |
| `assistant_message_id` | UUID FK | Cited response. |
| `knowledge_source_id` | UUID FK | Real source. |
| `source_start`, `source_end` | integer | Resolving span. |
| `quoted_span_hash` | text | Integrity without duplicating large source text. |
| `ordinal` | smallint | Display order. |

#### `memory_items`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Stable fact identity. |
| `clinic_id`, `patient_id` | UUID FK | Tenant and owner. |
| `kind` | `memory_kind` | Required fact category. |
| `canonical_key` | text | Identity such as normalized medication name. |
| `current_revision_id` | UUID nullable FK | Live profile pointer. |
| `created_at`, `updated_at` | timestamptz | Lifecycle. |

#### `memory_revisions`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Immutable revision ID. |
| `memory_item_id` | UUID FK | Stable fact. |
| `value_ciphertext` | text | Protected structured value. |
| `status` | `memory_status` | Active/stopped/resolved/corrected. |
| `source_message_id` | UUID FK | Required provenance pointer. |
| `supersedes_revision_id` | UUID nullable FK | Unbroken mutation chain. |
| `model_run_id` | UUID nullable FK | Extractor provenance. |
| `confidence` | enum | Extraction confidence. |
| `effective_at` | timestamptz nullable | Patient-stated timeline when present. |
| `created_at` | timestamptz | Required update time. |

The visible Patient Profile is a projection of each `memory_item.current_revision_id`. A correction inserts a revision and changes the pointer in one transaction; it never rewrites or deletes the previous revision.

### 4.5 Consent and escalation tables

#### `consent_events`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Append-only evidence ID. |
| `clinic_id`, `patient_id` | UUID FK | Named clinic and patient. |
| `lead_session_id` | UUID nullable FK | Conversion provenance. |
| `type` | `consent_type` | Healthcare sharing or marketing email. |
| `action` | `consent_action` | Granted or withdrawn. |
| `policy_version`, `notice_version` | text | What was accepted. |
| `captured_via` | text | Signup, checkbox, or another explicit surface. |
| `evidence_metadata` | jsonb | PHI-free evidence only. |
| `occurred_at` | timestamptz | Required timestamp. |

Effective consent is the latest event per `(clinic_id, patient_id, type)`. Marketing consent is never inferred from healthcare-sharing consent.

#### `escalations`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Escalation ID. |
| `clinic_id`, `patient_id`, `patient_session_id` | UUID FK | Tenant/context. |
| `trigger_message_id` | UUID FK | Triggering message. |
| `risk_assessment_id` | UUID FK | Explainable gate. |
| `status` | enum | Required through clinician review. |
| `triage_summary_ciphertext` | text | One-to-five-bullet snapshot. |
| `profile_snapshot_ciphertext` | text | Immutable profile at send time. |
| `attribution_snapshot` | jsonb | Required acquisition context. |
| `response_expected_by` | timestamptz | 12–18-hour expectation. |
| `created_at`, `sent_at`, `updated_at` | timestamptz | Lifecycle. |

#### `escalation_provenance`

| Field | Type/constraint | Purpose |
|---|---|---|
| `escalation_id` | UUID FK | Parent. |
| `message_id` | UUID nullable FK | Supporting message. |
| `memory_revision_id` | UUID nullable FK | Supporting fact revision. |
| `purpose` | text | Trigger, summary support, or profile support. |

Each row references either a message or memory revision.

#### `clinician_responses`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Response ID. |
| `escalation_id`, `clinic_id` | UUID FK | Queue item and tenant. |
| `author_membership_id` | UUID FK | Human provenance. |
| `content_ciphertext` | text | Protected response. |
| `created_at` | timestamptz | Review history. |

### 4.6 Funnel, value, and audit records

#### `funnel_events`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Event ID. |
| `clinic_id` | UUID FK | Tenant metric. |
| `lead_session_id` | UUID nullable FK | Acquisition identity. |
| `patient_session_id` | UUID nullable FK | Post-conversion identity. |
| `name` | enum | Required funnel stage. |
| `source_channel` | enum | Immutable metric dimension. |
| `identity_level` | enum | Metric dimension. |
| `metadata` | jsonb | Allowlisted PHI-free values only. |
| `idempotency_key` | text unique | Prevent duplicate events. |
| `occurred_at` | timestamptz | Event time. |

#### `value_events`

| Field | Type/constraint | Purpose |
|---|---|---|
| `funnel_event_id` | UUID PK/FK | Exactly one associated funnel event. |
| `value_type` | text | Service answer, summary, prepared questions, etc. |
| `source_query_id` | text nullable | Traceability for live statistics. |
| `validated_at` | timestamptz nullable | Accuracy validation evidence. |

#### `audit_events`

| Field | Type/constraint | Purpose |
|---|---|---|
| `id` | UUID PK | Audit event. |
| `clinic_id` | UUID nullable FK | Tenant. |
| `actor_hash` | text nullable | Non-identifying actor correlation. |
| `action`, `resource_type` | text | Structured operation. |
| `resource_id` | UUID nullable | Record ID only. |
| `outcome`, `error_code` | text | Result. |
| `metadata` | jsonb | Schema-allowlisted PHI-free metadata. |
| `occurred_at` | timestamptz | Event time. |

No message text, names, phone numbers, IC/ID values, email addresses, triage summaries, profile values, or free-form exception messages may enter `audit_events` or application logs.

## 5. Guest LeadSession model

### Creation

1. Validate the clinic and channel contract.
2. Normalize attribution with the declarative channel adapter.
3. Generate a random recovery credential and store only its cryptographic hash.
4. Create `LeadSession` plus `visitor` event.
5. Put the raw recovery credential in a Secure, HttpOnly, SameSite cookie.
6. Select the opening using channel, identity level, and clinic-local time.

For personal/referral links, the URL token is single-purpose. Exchange it for the cookie and immediately redirect to a clean URL so tokens do not remain in browser history, screenshots, analytics, or referrer headers.

### Access

- Anonymous users receive no direct Supabase table grants.
- Guest endpoints authorize by hashing the cookie credential and resolving one active, unexpired lead.
- The DAL never accepts a caller-supplied `lead_session_id` as sufficient authority.
- Rate limits combine lead credential, endpoint, and a one-way network/device signal. Raw IP addresses are not logged.
- Staff can see PHI-free warm-lead metadata before consent, not raw guest messages or protected contact/context.

### Expiry

- Proposed default: seven days after last activity, capped by the selected retention policy.
- Unconverted protected message/contact/context data is deleted or cryptographically erased at expiry.
- Only justified, PHI-free funnel dimensions remain for abandonment analytics.
- Converted lead messages are retained under the patient record because the brief requires permanent provenance.

## 6. PatientSession and Message models

### PatientSession

- A `PatientSession` belongs to exactly one patient and clinic.
- It has exactly one optional origin `LeadSession`; converted sessions require it.
- It does not duplicate guest messages. The session relationship authorizes the patient and consented care team to view the origin thread.
- It stays active after an escalation so chat can continue.
- Closing the session does not delete messages, facts, risk assessments, or escalation provenance.

### Message lifecycle

1. Receive and validate a guest or patient turn.
2. Persist protected content with `received`/`processing` state.
3. Run local redaction and risk checks.
4. Call OpenAI only when the redaction gate passes and deterministic emergency handling permits it.
5. Persist risk before making an assistant response visible.
6. Validate the proposed assistant response and citations.
7. Persist assistant message, citations, memory changes, and any escalation transition atomically where possible.
8. Return a minimal DTO to the browser.

Assistant output is not streamed to the patient before risk classification and policy validation. The UI can display a typing/processing state. This avoids leaking advice that is later classified as unsafe.

## 7. Living Memory with provenance

The memory system has two layers:

- `memory_items`: stable identity of a clinical fact.
- `memory_revisions`: immutable history of values/statuses and their source messages.

Example mutation:

```text
Message M1: "I take Advil."
  MemoryItem medication:advil
  Revision R1: active, source=M1

Message M2: "Actually I stopped last week."
  Same MemoryItem
  Revision R2: stopped, source=M2, supersedes=R1
  current_revision_id changes from R1 to R2
```

Rules:

- A model proposes memory changes; the server validates allowed fact types and status transitions.
- Every accepted revision has one source message and optional model-run provenance.
- Corrections never modify or delete old revisions.
- Guest-message IDs remain valid sources after conversion.
- The live sidebar reads current revisions only; the clinician view can expand the revision chain.
- Low-confidence extraction may be shown as unconfirmed or omitted from the live profile. Exact UX remains a product decision.

## 8. Consent model

- Consent is append-only evidence, not a mutable boolean.
- Healthcare-sharing consent is scoped to one patient and named clinic.
- Marketing-email consent is a separate type and is never implied by signup, earned email, or healthcare-sharing consent.
- The effective state is derived from the most recent grant/withdrawal event.
- Conversion requires current healthcare-sharing consent.
- Staff access to patient clinical content requires active clinic membership and effective healthcare-sharing consent.
- Contact suggestions require both an active contact point and the appropriate effective consent.
- Consent evidence records the policy/notice version, capture surface, timestamp, and allowlisted PHI-free evidence metadata.

Consent withdrawal behavior after an escalation or during an active care relationship is not defined in the source requirements and requires a later policy decision.

## 9. Escalation model

### State flow

```text
required → queued → acknowledged → responded → closed
```

- `required` means the safety policy requires the Send-to-Clinic path.
- `queued` means the complete immutable payload has been sent/persisted for care-team review.
- `acknowledged` records that a staff member opened/claimed the item.
- `responded` requires a `clinician_responses` record.
- `closed` ends review but does not delete provenance.

### Payload construction

At queue time, persist:

- Triggering message ID and protected content reference.
- Associated risk assessment.
- One-to-five-bullet protected triage summary.
- Protected point-in-time profile snapshot.
- Normalized acquisition/attribution snapshot.
- Normalized provenance rows linking supporting messages and memory revisions.
- Expected response time calculated from the clinic's 12–18-hour settings.

The snapshot is deliberate: later chat or memory changes must not rewrite what the clinician was originally sent.

### Outstanding decision

The brief is unclear whether High/Medium escalation is automatic or patient-confirmed. Recommended MVP behavior is:

- The system creates `required` immediately when policy requires escalation.
- The single Send-to-Clinic action transitions it to `queued` and freezes the payload.
- High-risk UI also displays emergency guidance prominently and never waits on the 12–18-hour clinic response.

This choice must be confirmed before implementation because auto-queueing High risk would also be defensible.

## 10. Funnel and value-event model

- Funnel events are append-only and idempotent.
- Every event retains `clinic_id`, lead/patient linkage where applicable, channel, identity level, and timestamp.
- Conversion preserves the same `lead_session_id`; later events add `patient_session_id` rather than starting an unrelated funnel.
- A `value_event` extends a funnel event with an explicit value type and accuracy/query provenance.
- Per-channel metrics are live aggregate queries over `funnel_events`, not stored marketing claims.
- If a statistic is zero or below the configured truthful-display threshold, the UI suppresses it or uses non-numeric copy.
- Warm-lead score is computed from transparent recency, channel, identity level, and funnel stage inputs. It is not an opaque model score.
- A clinical-risk flag overrides sales ranking and routes the record to the escalation/compassion queue.
- Audit events and funnel events are separate: funnel events describe product progression; audit events describe system access/actions.

## 11. RBAC strategy

RBAC has three reinforcing layers:

1. **UI routing:** optimistic redirects and role-appropriate navigation.
2. **Next.js DAL:** re-authenticate, resolve active clinic membership, authorize the exact resource, and return a minimal DTO.
3. **Supabase grants and RLS:** final row-level enforcement even if an application check is missed.

UI checks and `proxy.ts` are never treated as sufficient authorization.

### Access matrix

| Resource | Guest | Patient | Staff | Nurse | Clinician |
|---|---:|---:|---:|---:|---:|
| Own active LeadSession via opaque token | Limited | No | No raw content pre-consent | No raw content pre-consent | No raw content pre-consent |
| PHI-free warm-lead projection | No | No | Same clinic | Same clinic | Same clinic |
| Own PatientSession/messages/profile | No | Own only | Same clinic + effective consent | Same clinic + effective consent | Same clinic + effective consent |
| Other patient's data | No | No | Same clinic + effective consent only | Same clinic + effective consent only | Same clinic + effective consent only |
| Escalation queue | No | Own escalation status only | Same clinic, read | Same clinic, read/respond | Same clinic, read/respond |
| Create staff referral | No | No | Same clinic | Same clinic | Same clinic |
| Channel metrics/rules | No | No | Same clinic | Same clinic | Same clinic |

The source brief does not distinguish Staff, Nurse, and Clinician permissions precisely. The MVP gives all three read access to consented same-clinic patients to satisfy the required test, while only Nurse and Clinician create clinical responses. This is an explicit design decision to confirm.

### RLS policy shape

- Patient ownership is based on `patients.auth_user_id = auth.uid()`.
- Staff access joins `clinic_memberships` using `auth.uid()`, matching `clinic_id`, active membership, and effective consent.
- Authorization data is read from database membership rows, not user-editable metadata.
- `anon` receives no direct clinical/guest table access.
- Views exposed to app roles must be security-invoker views so underlying RLS still applies.
- Supabase secret/service credentials stay server-only and are not used for routine patient reads.
- Narrow privileged operations—guest-token access, assistant/system writes, expiry, and conversion—live behind audited server-only functions/repositories.
- RLS tests cover cross-patient, cross-clinic, queue, unconsented, expired membership, and anon access.

## 12. PHI redaction pipeline

Redaction happens locally in the Next.js server before any OpenAI request or transactional email construction.

```text
Inbound text
  → validate type/size
  → encrypt and persist as clinical application data
  → deterministic/local PHI detection
  → replace matches with [REDACTED]
  → leak scan and redaction assertion
  → minimum-context builder
  → OpenAI request with store=false
```

### Detection layers

1. Exact known identifiers from the authenticated profile/contact records, decrypted only in server memory.
2. Deterministic patterns for Malaysian IC/ID formats, email addresses, and phone numbers.
3. Local contextual name patterns such as “my name is …” and known user names.
4. A final leak assertion that none of the exact known identifiers or configured sensitive patterns remain.

The replacement token is consistently `[REDACTED]` so the required test is unambiguous.

### Storage and logging rules

- Raw input may exist only in protected clinical/application records, never in `audit_events`, funnel metadata, console logs, traces, URLs, analytics, or exception messages.
- Operational records store redaction status/version, category counts, input hash, duration, and error code only.
- Redacted model context is minimized to the current turn, necessary recent turns, current fact projection, and approved knowledge excerpts.
- OpenAI response/conversation state is not used as the clinical record.
- Transactional earned-email content passes through the same redaction assertion before sending.

### Failure behavior

Recommended MVP decision: fail closed. If the redactor throws, returns an invalid result, or the leak assertion fails:

- Do not call OpenAI.
- Do not send email.
- Mark the message `blocked` with a PHI-free error code.
- Show a safe message explaining that automated processing is temporarily unavailable and offer the clinic handoff.
- Emit a PHI-free audit event.

The source documents require the failure mode to be documented but do not explicitly mandate fail-closed behavior; this is a production-safety decision.

### OpenAI boundary

- Use a server-side Responses API request with a model selected by environment configuration.
- Set `store: false` and manage context in Supabase.
- Request structured output and validate it before use.
- Use a stable hashed safety identifier rather than an email, phone number, or patient ID that is meaningful outside this system.
- Do not enable live web search or upload files in the MVP patient pipeline.
- The build uses synthetic data only. Processing real PHI would additionally require contractual, retention, residency, and healthcare eligibility review; redaction alone is not a claim of regulatory compliance.

## 13. Risk-gating pipeline

Risk is decided before an assistant response becomes visible.

```text
Patient message
  → normalize locally
  → deterministic emergency phrase/variant gate
  → PHI-redact
  → structured OpenAI assessment + draft + memory proposals
  → schema validation
  → conservative server policy
  → persist risk assessment
  ├── Low: validate citations and release non-diagnostic response
  └── Medium/High/uncertain: suppress advice, require escalation, use safe response
```

### Deterministic gate

- Exact and normalized variants of the four mandatory emergency phrases always produce High risk.
- Conservative locally defined patterns cover obvious close variants.
- Known ambiguous symptom patterns produce at least Medium unless a stricter rule makes them High.
- A deterministic High result cannot be downgraded by the model.

### Structured model result

The model proposes:

- Risk level and short redacted reason.
- Confidence.
- Non-diagnostic draft response.
- Whether the patient is asking for diagnosis/clarity or sounds unsure.
- Memory revision proposals.
- Citation source IDs/spans selected only from supplied approved sources.

### Server policy gate

- Invalid structured output, timeout, low confidence, uncertainty, diagnostic request, or ungrounded citation fails toward escalation, never toward reassurance.
- Medium/High suppresses generated clinical advice and uses approved safety/logistics copy.
- Low responses are rejected if they contain diagnosis, medication-change, treatment-plan, or false-reassurance patterns.
- Citations must reference supplied active sources and valid spans.
- The risk record is committed before the assistant message is returned.
- After escalation, subsequent turns repeat the full risk gate. High-risk conversations may continue only with supportive/logistical copy and emergency guidance, not clinical advice.

### Failure modes

| Failure | Patient behavior | Persistence |
|---|---|---|
| OpenAI timeout/error | Honest temporary-unavailability response; no clinical advice; offer clinic handoff | Failed `model_run`, conservative risk/escalation state, PHI-free audit event |
| Invalid model schema | Same as timeout | Validation error code only |
| Redaction failure | Do not call OpenAI; offer clinic handoff | Blocked message processing state and PHI-free event |
| Auth unavailable | Do not expose protected data or accept patient mutation; preserve guest recovery where safely possible | PHI-free availability event |
| Database transaction failure | Return retry-safe error; do not display uncommitted response | Idempotency key allows safe retry |

## 14. LeadSession to PatientSession conversion

Conversion is an authenticated, idempotent, atomic database operation.

### Preconditions

- Active, unexpired guest recovery credential resolves to one `LeadSession`.
- Supabase Auth session is valid.
- Email is verified in Supabase Auth.
- Phone contact has been collected.
- The user explicitly grants healthcare-sharing consent naming the lead's clinic.
- The lead has not already been converted by another user.

### Transaction

1. Lock the `LeadSession` row and revalidate token hash, status, expiry, and clinic.
2. Resolve or create the immutable `(clinic_id, auth_user_id)` patient.
3. Insert/version required contact points.
4. Append the healthcare-sharing consent event and evidence version.
5. Create the `PatientSession` linked to the original `LeadSession`.
6. Link the lead to the patient and session; mark it converted.
7. Preserve messages in place—do not copy or rewrite them.
8. Emit idempotent `consented` and `patient_created` events linked to the same lead funnel.
9. Commit and rotate/revoke the guest recovery credential.

The database function returns only the new `patient_session_id`. If retried after success, it returns the same result rather than creating duplicates.

### After commit

- Redirect to the patient messenger.
- Load the origin guest thread and current patient thread through an authorized DTO.
- Run post-consent fact extraction over permitted guest messages if needed; new memory revisions point directly to original message IDs.
- Seed the conversation context so the AI does not re-ask the concern.
- Staff access becomes possible only through same-clinic membership plus effective consent.

The conversion function is the one justified `SECURITY DEFINER` workflow in the MVP. It must use an empty search path, fully qualified relation names, explicit `auth.uid()` checks, restricted execute grants, row locking, and idempotency.

## 15. Recommended folder structure

```text
my_clinic_ai/
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   ├── g/[entryToken]/page.tsx
│   │   │   └── recover/page.tsx
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── consent/page.tsx
│   │   ├── (patient)/patient/sessions/[sessionId]/page.tsx
│   │   ├── (staff)/staff/
│   │   │   ├── leads/page.tsx
│   │   │   ├── referrals/page.tsx
│   │   │   └── escalations/[escalationId]/page.tsx
│   │   ├── api/
│   │   │   ├── auth/callback/route.ts
│   │   │   ├── guest/sessions/route.ts
│   │   │   ├── guest/messages/route.ts
│   │   │   ├── patient/messages/route.ts
│   │   │   ├── conversion/route.ts
│   │   │   ├── escalations/route.ts
│   │   │   ├── staff/referrals/route.ts
│   │   │   └── channels/social-comment/route.ts
│   │   ├── manifest.ts
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── chat/
│   │   ├── patient-profile/
│   │   ├── escalation/
│   │   ├── staff/
│   │   └── ui/
│   ├── features/
│   │   ├── acquisition/
│   │   ├── consent/
│   │   ├── conversion/
│   │   ├── escalation/
│   │   ├── funnel/
│   │   ├── memory/
│   │   ├── messaging/
│   │   ├── redaction/
│   │   └── risk/
│   ├── server/
│   │   ├── auth/
│   │   ├── dal/
│   │   ├── dto/
│   │   ├── crypto/
│   │   ├── logging/
│   │   ├── openai/
│   │   ├── supabase/
│   │   └── rate-limit/
│   ├── config/
│   │   ├── channel-rules.ts
│   │   ├── risk-rules.ts
│   │   └── retention.ts
│   └── types/
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   └── tests/
│       └── rls/
├── tests/
│   ├── unit/
│   │   ├── redaction/
│   │   ├── risk/
│   │   ├── memory/
│   │   └── channel-rules/
│   ├── integration/
│   │   ├── guest-to-patient/
│   │   ├── escalation/
│   │   ├── access-control/
│   │   └── value-events/
│   └── e2e/
├── public/
│   └── pwa-icons/
├── proxy.ts
├── REQUIREMENTS.md
├── ARCHITECTURE.md
└── ATTRIBUTION.txt
```

Folder rules:

- `app/**/route.ts` validates HTTP concerns and delegates; it contains no domain logic.
- `features/*` contains domain types, schemas, and orchestration grouped by requirement area.
- `server/dal` is `server-only` and owns queries, resource authorization, and DTO construction.
- `server/openai`, `server/crypto`, and privileged Supabase clients are `server-only`.
- Client Components never import database rows, OpenAI types containing internals, secrets, or protected domain entities.
- Configurable channel and risk rules live in one declarative location, not UI/handler conditionals.

## 16. Production-credibility boundaries for the 48-hour MVP

### Build now

- Four simulated contracts: `staff_referral`, `social_comment`, `instagram_ad_click`, and `website_widget`.
- Guest value, attribution, recovery, conversion, consent, patient chat, deterministic risk, redaction, memory mutation, escalation, warm leads, metrics, required tests, manifest, and mobile UI.
- RLS and grants from the first migration, not as final polish.
- Curated citation records sufficient to prove resolvable grounding.

The two additional simulated contracts are a recommended scope choice, not a source-document mandate. They are the lowest-risk combination for the Instagram demo and website acquisition path.

### Defer

- Real Meta/TikTok/WhatsApp integration.
- Full dashboard and composite scoring/decay.
- Voice recording and transcription.
- Push notifications and offline clinical data.
- Contact-point change workflow.
- Conflict detection beyond the required mutation chain.
- Marketing re-engagement lifecycle.
- Background job infrastructure; use explicit request/response workflows and a scheduled Supabase cleanup task only if time permits.

## 17. Decisions still requiring confirmation

1. Whether High-risk escalation is automatically queued or requires the patient to press the single action.
2. Whether a seven-day guest retention period is acceptable and how converted guest messages inherit patient retention.
3. The complete PHI detector scope beyond names, IC/ID numbers, phones, and email used by the earned-email flow.
4. Whether staff may create clinical responses or only Nurses and Clinicians may respond.
5. Whether phone verification is required or phone collection alone satisfies signup.
6. Approved clinical education sources and review ownership for citations.
7. Consent withdrawal behavior after conversion or after an escalation has been queued.
8. Whether a patient may belong to multiple clinics in the future. The MVP uses one patient row per `(clinic, auth user)` to keep tenant authorization simple.

## 18. External platform notes

These notes validate stack behavior; they do not replace the candidate brief or `REQUIREMENTS.md` as product requirements.

- Next.js 16's bundled security guidance recommends a server-only DAL, minimal DTOs, and authorization inside every Server Action/Route Handler rather than relying on layouts or optimistic routing.
- Supabase Auth SSR uses cookie-based sessions. The current `@supabase/ssr` helper is recommended by Supabase but documented as beta, so its version should be pinned.
- Supabase RLS combines table grants with policies; both must be configured. Secret/service credentials bypass RLS and must never reach the browser.
- OpenAI's Responses API supports stateless operation with `store: false` and structured output. Application state and abuse-monitoring retention are separate concerns; the MVP sends redacted synthetic content only and does not claim that `store: false` alone establishes healthcare compliance.

