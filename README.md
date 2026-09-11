# Nightingale MVP

Nightingale is a secure first-touch-to-care prototype built for the 2026 Nightingale 48-Hour Candidate Build. It carries a guest from an attributed acquisition source through a useful AI-assisted exchange, verified authentication, explicit clinic-sharing consent, a patient intake conversation, Living Memory, safety gating, and a patient-confirmed clinician handoff.

The repository uses synthetic data only. It is a prototype, not a diagnostic system, medical device, production compliance claim, or substitute for emergency services.

## What is implemented

- Four simulated acquisition contracts: staff referral, social comment, Instagram ad click, and website widget.
- Immutable source/campaign/creative attribution and PHI-free funnel events.
- Recoverable guest sessions using an opaque HttpOnly credential with encrypted message storage.
- Useful guest responses, honest AI disclosure, and value-event tracking.
- Supabase email/password authentication and explicit named-clinic healthcare-sharing consent. A phone-OTP path is implemented but disabled in the submitted deployment because no SMS provider is configured.
- Separate, default-off, versioned marketing-email consent with append-only grant/withdrawal evidence.
- Atomic and idempotent `LeadSession -> PatientSession` conversion without re-asking the original concern.
- Authenticated patient chat with local PHI redaction before Gemini.
- Deterministic emergency rules followed by model assessment and a conservative server policy gate.
- Curated citations for releasable Low-risk educational responses.
- Living Memory with append-only revisions, corrections, and source-message/model provenance.
- Patient-confirmed Send to Clinic with an encrypted point-in-time summary/profile snapshot and acquisition provenance.
- A same-clinic clinician dashboard with Staff/Nurse/Clinician RBAC; only Nurse and Clinician roles can author clinical responses.
- Persisted clinician responses, a PHI-free notification outbox, and optional browser Web Push with authenticated exact-conversation return.
- One-time guest recovery-link exchange with intentionally different active, expired, and purged outcomes.
- Structured PHI-free operational audit logs.

Real social-platform integrations, staff-authored referral links, warm-lead ranking, funnel dashboards, transactional email, SMS/WhatsApp delivery, and Voice AI are deliberately deferred.

## Stack

- Next.js 16 App Router, React 19, and TypeScript
- Tailwind CSS 4
- Supabase PostgreSQL and Supabase Auth
- Google Gemini `generateContent` API
- Zod validation and Vitest

## Prerequisites

- Node.js 20.19+; Node.js 22 LTS is recommended
- npm
- A hosted Supabase project
- A restricted Gemini API key for model-backed responses
- HTTPS in deployment for optional Web Push (localhost works during development)

## Environment setup

Copy the template and replace every placeholder:

```powershell
Copy-Item .env.example .env.local
```

Generate independent application secrets:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use the base64 value for `LEAD_CONTEXT_ENCRYPTION_KEY` and the hex value for `RATE_LIMIT_HMAC_KEY`. `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, and both generated secrets are server-only and must never be prefixed with `NEXT_PUBLIC_` or committed.

The default model is configured by `GEMINI_MODEL`; the supplied template uses `gemini-flash-latest`. Gemini receives only locally redacted, minimum necessary context and must return JSON matching the supplied schema. The server independently validates that output and retains the existing explicit timeout and rule-only failure mode. The key must be restricted to the Gemini API and kept server-only. Provider terms and deployment controls still require review before processing real patient data.

Web Push is optional and disabled unless all three VAPID values in `.env.local` are valid. Generate a pair with `npx web-push generate-vapid-keys`, keep the private key server-only, and set `VAPID_SUBJECT` to a monitored `mailto:` or HTTPS contact. When disabled or unsupported, the UI tells patients to return to the secure conversation; it does not claim a notification was sent.

## Hosted Supabase setup

1. Create a Supabase project.
2. In **SQL Editor**, run every file in `supabase/migrations/` in filename order, from `202609020001_phase1_foundation.sql` through `202609100006_guest_boundary_enforcement.sql`.
3. Run `supabase/seed.sql`.
4. Copy the project URL, publishable key, and secret key into `.env.local`.
5. Under **Authentication -> URL Configuration**, set the local Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/confirm` as redirect URLs.
6. Keep email confirmation enabled. Add equivalent production URLs before deployment.
7. The submitted/demo configuration keeps **Authentication -> Providers -> Phone** disabled because an SMS provider could not be activated before the deadline. Use the tested email/password path. The repository contains a phone-OTP path for future activation, but it must not be presented as operational until a supported SMS provider is configured and Malaysian delivery is tested. The application never treats an Instagram or other social handle as authentication.

### Phone-auth deployment status

- **Application code:** implemented using Supabase `signInWithOtp` and `verifyOtp`.
- **Submitted hosted environment:** disabled; no active Twilio or alternative SMS-provider credentials are configured.
- **Working authentication path:** verified email and password.
- **Data continuity:** an optionally captured phone remains encrypted contact data and is not copied into escalation attribution.
- **Activation criteria:** configure a supported provider, test Malaysian OTP delivery and expiry, add abuse/rate-limit monitoring, and pass the hosted phone-conversion scenario test.

Do not enable the Phone provider with blank, inactive, trial-blocked, or untested credentials. Doing so would expose users to a sign-in path that cannot deliver its OTP.

If the project is linked to the Supabase CLI, preview and apply pending migrations with:

```powershell
npx supabase db push --dry-run
npx supabase db push
```

### Create a clinician account

1. In Supabase, open **Authentication -> Users -> Add user -> Create new user**.
2. Use a confirmed email and a password of at least eight characters containing a letter and number.
3. Replace the email below and run it in SQL Editor:

```sql
insert into public.clinic_memberships (clinic_id, auth_user_id, role)
select c.id, u.id, 'clinician'::public.member_role
from public.clinics c
join auth.users u on lower(u.email) = lower('clinician@example.com')
where c.slug = 'nightingale-demo'
on conflict (clinic_id, auth_user_id)
do update set role = excluded.role, active = true, updated_at = now();
```

The clinician signs in at `/staff/login`.

## Install and run

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). A useful Instagram demo entry is:

```text
http://localhost:3000/?source=instagram_ad_click&campaign=ivf_over40&creative=reel_01&page=/fertility/egg-freezing
```

## Run the checks

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

The suite covers attribution validation, guest-to-patient conversion contracts, consent, trust copy, redaction, deterministic and model-assisted risk policy, Living Memory mutation/provenance, escalation payload integrity, and RBAC/database contracts. Scenario-named P0 tests live in `tests/scenarios/`.

The explicit 01–21 mapping, execution depth, and honest automation limits are documented in `tests/scenarios/README.md`. Tests that only inspect a SQL/source contract are not treated as hosted execution evidence.

The tests are focused unit and SQL-contract tests. They do not replace hosted-Supabase integration, browser E2E, penetration, clinical-safety, accessibility, or legal review.

### Final feedback audit status

The adversarial 11 September 2026 audit classifies **6 scenarios SURVIVES, 15 PARTIAL, and 0 DOES NOT**. The detailed scenario-by-scenario evidence and exact execution paths are in `docs/FEEDBACK_GAP_ANALYSIS.md`. The lower score is deliberate: a SQL migration inspected by a test is not counted as an executed hosted database flow.

Final local verification:

- `npm test`: 123 passed, 8 skipped across 36 files. The skipped tests are the two opt-in hosted Supabase suites.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed with Next.js 16.3.4.

Important remaining gaps are: no live funnel-statistics query/dashboard; phone OTP is not operational in the submitted hosted environment; Web Push has no recorded device-delivery proof or retry worker; hosted tenant/guest-boundary/cleanup tests were not run; Living Memory, conversion, contradiction, and cold-handoff database paths lack hosted integration execution; provider/infrastructure retention is not independently verified; and voice/channel-rule readiness is only partial.

After applying all migrations to a non-production hosted Supabase project, run the opt-in boundary test with synthetic fixtures:

```powershell
$env:RUN_HOSTED_BOUNDARY_TESTS = "1"
npm test -- --run tests/integration/test_scenarios_04_12_hosted_boundary.test.ts
Remove-Item Env:\RUN_HOSTED_BOUNDARY_TESTS
```

The test creates temporary confirmed Auth users and synthetic lead/patient/message rows in the first seeded clinic, proves pre-consent staff denial, cross-patient isolation, guest direct-access denial, database rate-limit rejection, and expiry deletion, then removes its fixtures. It is skipped during the normal test suite because it mutates the configured hosted test project. Never point it at a production project.

To prove Clinic A/Clinic B isolation against the deployed policies and RPCs, use a non-production hosted project with every migration applied:

```powershell
$env:RUN_HOSTED_TENANT_TESTS = "1"
npm test -- --run tests/integration/test_scenario_20_hosted_multiclinic_isolation.test.ts
Remove-Item Env:\RUN_HOSTED_TENANT_TESTS
```

This test creates two temporary clinics, two patients, two clinicians, consented records, messages, and escalations. It verifies each clinician sees only their clinic, cross-clinic escalation mutation is denied, and each patient sees only their own records; cleanup runs afterward. It is intentionally skipped by default and must never target production.

## Where PHI redaction happens

The local redactor is `src/features/redaction/redact.ts`. It handles names expressed in supported contexts, Malaysian/Singaporean IC or ID formats, Malaysian phone numbers, and email addresses. Both guest and patient pipelines call it before any Gemini request:

```text
raw input -> deterministic multilingual emergency floor
          -> persist a non-PHI idempotency reservation
          -> local redaction + leak assertion (fail closed)
          -> minimum redacted context -> Gemini (structured output, explicit timeout)
          -> max(deterministic risk, model risk)
          -> deterministic output safety gate
          -> seal encrypted raw record + complete the turn
```

Raw message content is kept only as encrypted application data and is not written into the reservation row until all release gates finish. Operational logs use a runtime allowlist for UUID/SHA-256 identifiers and bounded codes; message text is not accepted. If redaction or its leak assertion fails, the model is not called and the response fails closed. A deterministic High still receives local 999 guidance even when redaction or the provider fails.

Relevant files:

- `src/features/redaction/redact.ts`: detection, replacement, and final leak assertion
- `src/features/risk/emergency-rules.ts`: shared English, Malay, and Chinese deterministic emergency floor
- `src/features/risk/output-safety.ts`: deterministic patient-facing diagnostic/reassurance gate
- `src/features/guest-chat/service.ts`: guest orchestration
- `src/features/patient-chat/pipeline.ts`: patient redaction, risk, model, and release gate
- `src/server/openai/guest-response.ts` and `patient-response.ts`: server-only Gemini boundary using native structured output and an abort deadline (the legacy directory name is retained to minimize migration churn)
- `src/server/logging/audit.ts`: structured PHI-free audit events with runtime sanitisation
- `supabase/migrations/202609100001_p0_safety_boundaries.sql`: non-PHI reservations and authenticated sealing
- `supabase/migrations/202609100002_guest_retention_schedule.sql`: hourly guest-expiry scheduling
- `supabase/migrations/202609100003_living_memory_integrity.sql`: durable guest bootstrap, immutable source snapshots, and append-only contradiction records
- `supabase/migrations/202609100004_identity_consent_escalation.sql`: verified phone conversion, encrypted contact continuity, distinct marketing consent, and minimized identity-aware escalation attribution
- `supabase/migrations/202609100005_continuity_reengagement.sql`: clinician-response timestamps, PHI-free Web Push outbox/attempts, patient-owned encrypted subscriptions, and guest recovery lifecycle/rotation
- `supabase/migrations/202609100006_guest_boundary_enforcement.sql`: value-event-only conversion boundary, observable database-native retention runs, and the hourly cleanup target

## Guest data boundary

The executable guest path is:

```text
opaque HttpOnly recovery cookie
  -> read_guest_messages resolves exactly one active LeadSession from the token hash
  -> append_guest_message enforces session ownership, idempotency, in-flight state, and 30/hour limit
  -> non-PHI reservation is stored
  -> raw risk, redaction, provider, and output gates run
  -> encrypted raw content and safe assistant response are sealed
  -> a typed value_event is committed only when meaningful non-diagnostic value was returned
  -> identity continuation becomes available only after that value_event
  -> verified authentication plus explicit healthcare-sharing consent converts the lead
  -> patient/staff reads remain constrained by patient ownership or active same-clinic consent RLS
  -> unconverted expired guest messages are deleted and protected lead fields cleared by Supabase pg_cron
```

Anon and authenticated roles have no direct guest-message mutation authority. Guest reads use the server-only recovery-token DAL and the service-role-only `read_guest_messages` RPC, which accepts only a token hash and resolves the LeadSession inside PostgreSQL; no client-supplied LeadSession ID selects a thread. The conversion route calls `convert_lead_to_patient_v3`, which requires a committed `value_event` and no longer accepts a UI `requires_secure_continue` flag as sufficient proof of value.

Supabase `pg_cron` calls `run_guest_retention_cleanup()` hourly. Successful executions write only timestamps and an expired-row count to `guest_retention_runs`; failures remain in `cron.job_run_details`. Because applying and operating the scheduler is deployment work, retention remains PARTIAL until the hosted job and an expired synthetic fixture are verified.

Useful hosted checks:

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'nightingale-expire-guest-sessions-hourly';

select * from public.guest_retention_runs order by completed_at desc limit 10;

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid from cron.job
  where jobname = 'nightingale-expire-guest-sessions-hourly'
)
order by start_time desc limit 10;
```

## Continuity and notification behavior

The only implemented outbound transport is opt-in browser Web Push. A patient subscribes from an authenticated patient session. When a Nurse or Clinician records a response, the database trigger timestamps the escalation and creates a PHI-free job in the same transaction; the response route then attempts Web Push with a ten-second provider timeout and records the outcome. Notification text contains no clinical content. Its URL leads through re-authentication and only then to the exact patient session and escalation anchor; the URL itself grants no access.

`response_expected_by` is computed from the clinic's configured response window when the escalation is queued. `clinician_response_at` records the first actual response. The patient UI labels the deadline as an estimate, never a guarantee. There is no scheduled notification retry worker in this prototype: failed/no-subscription/unconfigured outcomes remain visible in the outbox for operational follow-up.

Guest recovery links put the opaque credential in a URL fragment, exchange it by POST, remove it from the address bar, rotate it once, and install a new HttpOnly cookie. Active links resume the guest chat. Expired links explain that the recovery window ended; purged links explain that cleanup completed. This supports cross-device recovery for still-active links created after this migration, subject to hosted migration and browser testing.

No transactional email, SMS, or WhatsApp sender exists. The application does not promise emailed summaries or notification delivery through those channels.

## How RBAC is enforced

Authorization is enforced server-side, not by hiding buttons:

1. Supabase Auth establishes the user identity in server-managed cookies.
2. PostgreSQL RLS limits patients to their own records and staff to active same-clinic memberships with effective healthcare-sharing consent.
3. Table grants deny direct mutation; narrow `SECURITY DEFINER` functions validate `auth.uid()`, membership, role, clinic, consent, status transitions, and payload integrity.
4. Next.js server services re-check identity/membership and return minimal DTOs.
5. UI routing is convenience only and is never treated as an authorization boundary.

| Role | Consented same-clinic escalation | Acknowledge | Clinical response | Close |
|---|---:|---:|---:|---:|
| Patient | Own status only | No | No | No |
| Staff | Read | Yes | No | No |
| Nurse | Read | Yes | Yes | Yes |
| Clinician | Read | Yes | Yes | Yes |

The main enforcement is in migrations `202609030002`, `202609030004`, `202609030005`, `202609030006`, `202609100003`, and `202609100004`, with matching server checks in `src/features/staff/`, `src/features/memory/`, authentication, and consent routes.

Clinic isolation has one central database rule: authorization comes from the authenticated `auth.uid()`, never a caller-provided `clinic_id`. `has_active_clinic_membership(clinic_id)` resolves that identity to an active membership, and `has_consented_patient_access(clinic_id, patient_id)` additionally requires the latest healthcare-sharing consent to be granted for the same clinic and patient. Staff RLS policies and mutation RPCs reuse these functions. Patient RLS independently joins each record to the patient row owned by `auth.uid()`. Protected API routes accept opaque resource IDs only; they obtain the clinic through the RLS-authorized record. Public `clinicSlug` acquisition chooses where a new lead is created but grants no read or staff authority.

Service-role use is limited to server-only work. On patient and staff read paths, an RLS-authorized session record or membership is resolved first, and any following privileged lookup is constrained by the clinic from that trusted record. Never expose the service key to the browser or use a request-supplied clinic identifier as authorization evidence.

## Manual acceptance path

1. Enter through the Instagram demo URL and confirm the source, campaign, and creative appear in acquisition details.
2. Ask a factual clinic question, then state a synthetic concern and choose **Continue securely**.
3. Create or sign in to a verified patient account, explicitly grant healthcare-sharing consent, and confirm the original guest conversation appears in the patient session.
4. Send `I take Advil`, then `Actually I stopped it last week`, then `Actually I started taking it again`; confirm the profile retains all three sourced revisions.
5. Send `No known allergies`, then `Penicillin gave me a rash`; confirm the patient profile flags an open contradiction and the clinician handoff preserves both sources.
6. Send `I have crushing chest pain`; confirm High risk, no clinical advice, emergency guidance, and a **Send to Clinic** action.
7. Send the escalation and confirm its status changes to `queued` with an honest response window.
8. Sign in at `/staff/login`, open the queue, and inspect the trigger, contradiction history, point-in-time profile, acquisition context, and provenance.
9. Record a clinician response and close the escalation.
10. With VAPID configured, enable device alerts from the patient session, record another clinician response, and confirm the neutral notification requires sign-in before opening the exact escalation. Without VAPID, confirm the UI and clinician action report that delivery is unavailable rather than claiming success.

Use only synthetic names, identifiers, contact details, and health scenarios.

## Failure behavior

| Failure | Behavior |
|---|---|
| Redaction/leak assertion | Do not call Gemini; fail closed. Preserve local emergency guidance when the raw-message floor is High. |
| Model timeout/API/schema failure | Preserve the deterministic floor and return explicitly labelled, non-advisory safety-only copy with PHI-free metadata. |
| Authentication outage or invalid session | Reject protected reads/mutations; do not expose patient or staff data. |
| Database transaction failure | Do not display an uncommitted response; idempotency supports safe retry. |

## Submission documents

- `REQUIREMENTS.md`: requirements extracted from the candidate brief
- `TECHNICAL_BRIEF.md`: implemented architecture, schema, channel analysis, assumptions, scope, and Voice AI extension
- `ATTRIBUTION.txt`: external libraries, hosted services, models, and licenses/terms
- `DEMO_SCRIPT.md`: timed three-minute recording plan and evidence checklist
- `ARCHITECTURE.md`: the original pre-implementation architecture design

## Known scope boundaries

- The staff-referral entry is simulated; there is no staff UI that creates a private referral link.
- There is no warm-lead ranking view or per-channel funnel analytics dashboard.
- No email, SMS, WhatsApp, or social-platform notification is implemented. Web Push is optional, opt-in, and only attempted when a clinician response is persisted—not when an escalation is merely queued.
- Notification retries are recorded but not scheduled automatically; hosted delivery and browser compatibility still require end-to-end verification.
- No production platform webhooks, scraping, direct messaging, or ad retargeting are implemented.
- No audio recording or transcription is implemented.
- Hosted database RLS should be integration-tested with separate Patient A, Patient B, Staff, Nurse, and Clinician accounts before any real-world use.
